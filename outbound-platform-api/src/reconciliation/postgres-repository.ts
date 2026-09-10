import { randomUUID } from 'node:crypto';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import {
  repairTaskReconciliationResultSchema,
  taskReconciliationPageSchema,
  taskReconciliationSchema,
  type RepairTaskReconciliationInput,
  type RepairTaskReconciliationResult,
  type TaskReconciliation,
  type TaskReconciliationPage,
  type TaskReconciliationStatus,
} from '@outbound/contracts';
import type { Database } from '../db/client.js';
import {
  auditLogs,
  callbackInbox,
  callInstances,
  deadLetterEvents,
  platformTasks,
  taskReconciliations,
} from '../db/schema.js';
import { OperationsConsoleFailure } from '../operations/service.js';
import type {
  ClaimedReconciliation,
  ReconciliationCycleUpdate,
  ReconciliationRepository,
} from './service.js';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

type ClaimRow = ClaimedReconciliation;

export type ReconciliationListInput = {
  keyword?: string;
  status?: TaskReconciliationStatus;
  pageNum: number;
  pageSize: number;
};

export interface ReconciliationOperations {
  listReconciliations(
    input: ReconciliationListInput,
  ): Promise<TaskReconciliationPage>;
  requestRepair(
    taskNo: string,
    input: RepairTaskReconciliationInput,
    actorId: string,
    requestId: string,
  ): Promise<RepairTaskReconciliationResult>;
}

export class PostgresReconciliationRepository
  implements ReconciliationRepository, ReconciliationOperations
{
  constructor(
    private readonly db: Database,
    private readonly clock: () => Date = () => new Date(),
    private readonly createId: () => string = randomUUID,
  ) {}

  async seedCandidates(input: {
    staleBefore: Date;
    now?: Date;
  }): Promise<number> {
    const now = input.now ?? this.clock();
    const rows = await this.db.execute<{ taskId: string }>(sql`
      INSERT INTO ${taskReconciliations} (
        task_id,
        expected_call_count,
        platform_call_count,
        next_check_at,
        created_at,
        updated_at
      )
      SELECT
        task.id,
        CASE
          WHEN task.import_succeeded_count > 0 THEN task.import_succeeded_count
          ELSE task.phone_count
        END,
        task.call_instance_count,
        ${now.toISOString()}::timestamptz,
        ${now.toISOString()}::timestamptz,
        ${now.toISOString()}::timestamptz
      FROM ${platformTasks} AS task
      WHERE task.baiying_call_job_id IS NOT NULL
        AND task.execution_status IN ('CALLING', 'PAUSED', 'CALL_COMPLETED', 'RECONCILING', 'COMPLETED')
        AND (
          (
            task.execution_status IN ('CALL_COMPLETED', 'RECONCILING', 'COMPLETED')
            AND (
              task.contract_version <> '2.0'
              OR coalesce(task.provider_completed_at, task.updated_at) <= ${input.staleBefore.toISOString()}::timestamptz
            )
          )
          OR task.updated_at <= ${input.staleBefore.toISOString()}::timestamptz
        )
      ON CONFLICT (task_id) DO NOTHING
      RETURNING task_id AS "taskId"
    `);
    return rows.length;
  }

  async claimNext(input: {
    workerId: string;
    lockTimeoutSeconds: number;
  }): Promise<ClaimedReconciliation | null> {
    assertWorkerId(input.workerId);
    if (
      !Number.isInteger(input.lockTimeoutSeconds) ||
      input.lockTimeoutSeconds < 1
    ) {
      throw new TypeError('Reconciliation 锁超时必须是正整数秒');
    }
    const rows = await this.db.execute<ClaimRow>(sql`
      WITH candidate AS (
        SELECT
          reconciliation.task_id,
          task.task_no,
          task.baiying_company_id,
          task.baiying_call_job_id,
          reconciliation.expected_call_count,
          reconciliation.provider_call_count,
          reconciliation.platform_call_count,
          reconciliation.stable_rounds,
          reconciliation.mismatch_since,
          reconciliation.failure_attempts
        FROM ${taskReconciliations} AS reconciliation
        INNER JOIN ${platformTasks} AS task ON task.id = reconciliation.task_id
        WHERE (
          reconciliation.status IN ('PENDING', 'STABLE_ONCE', 'FAILED')
          AND reconciliation.next_check_at <= now()
        ) OR (
          reconciliation.status = 'RUNNING'
          AND reconciliation.locked_at < now() - (${input.lockTimeoutSeconds} * interval '1 second')
        )
        ORDER BY reconciliation.next_check_at, reconciliation.task_id
        FOR UPDATE OF reconciliation SKIP LOCKED
        LIMIT 1
      )
      UPDATE ${taskReconciliations} AS reconciliation
      SET
        status = 'RUNNING',
        locked_at = now(),
        locked_by = ${input.workerId},
        updated_at = now()
      FROM candidate
      WHERE reconciliation.task_id = candidate.task_id
      RETURNING
        candidate.task_id AS "taskId",
        candidate.task_no AS "taskNo",
        candidate.baiying_company_id AS "companyId",
        candidate.baiying_call_job_id AS "callJobId",
        candidate.expected_call_count AS "expectedCallCount",
        candidate.provider_call_count AS "providerCallCount",
        candidate.platform_call_count AS "platformCallCount",
        candidate.stable_rounds AS "stableRounds",
        candidate.mismatch_since AS "mismatchSince",
        candidate.failure_attempts AS "failureAttempts"
    `);
    const row = rows[0];
    return row
      ? {
          ...row,
          mismatchSince: row.mismatchSince ? new Date(row.mismatchSince) : null,
        }
      : null;
  }

  async countPlatformCalls(taskId: string): Promise<number> {
    const [row] = await this.db
      .select({ total: count(callInstances.id) })
      .from(callInstances)
      .where(eq(callInstances.taskId, taskId));
    return Number(row?.total ?? 0);
  }

  async countPendingInbox(input: {
    companyId: string;
    callJobId: string;
  }): Promise<number> {
    const [row] = await this.db
      .select({ total: count(callbackInbox.id) })
      .from(callbackInbox)
      .where(
        and(
          eq(callbackInbox.companyId, input.companyId),
          eq(callbackInbox.callJobId, input.callJobId),
          sql`${callbackInbox.processStatus} <> 'SUCCEEDED'`,
        ),
      );
    return Number(row?.total ?? 0);
  }

  async finishCycle(input: ReconciliationCycleUpdate): Promise<void> {
    await this.db.transaction(async (tx) => {
      const rows = await tx
        .update(taskReconciliations)
        .set({
          status: input.status,
          providerState: input.providerState,
          providerCallCount: input.providerCallCount,
          platformCallCount: input.platformCallCount,
          pendingInboxCount: input.pendingInboxCount,
          stableRounds: input.stableRounds,
          mismatchSince: input.mismatchSince,
          lastCheckedAt: input.checkedAt,
          nextCheckAt: input.nextCheckAt,
          lastSuccessfulAt: input.checkedAt,
          lastProviderRequestId: input.lastProviderRequestId,
          failureAttempts: 0,
          lastError: null,
          manualReviewAt:
            input.status === 'MANUAL_REVIEW' ? input.checkedAt : null,
          lockedAt: null,
          lockedBy: null,
          updatedAt: input.checkedAt,
        })
        .where(
          and(
            eq(taskReconciliations.taskId, input.taskId),
            eq(taskReconciliations.status, 'RUNNING'),
            eq(taskReconciliations.lockedBy, input.workerId),
          ),
        )
        .returning({ taskId: taskReconciliations.taskId });
      if (!rows.length) throw claimLost(input.taskId);

      if (input.status === 'MANUAL_REVIEW') {
        await tx
          .update(platformTasks)
          .set({
            failureStage: 'RECONCILIATION',
            failureCode: 'BAIYING_CALL_COUNT_MISMATCH',
            failureMessage: mismatchMessage(input),
            failureRetryable: true,
            updatedAt: input.checkedAt,
            lockVersion: sql`${platformTasks.lockVersion} + 1`,
          })
          .where(eq(platformTasks.id, input.taskId));
      } else if (input.status === 'RECONCILED') {
        await tx
          .update(platformTasks)
          .set({
            failureStage: null,
            failureCode: null,
            failureMessage: null,
            failureRetryable: null,
            updatedAt: input.checkedAt,
            lockVersion: sql`${platformTasks.lockVersion} + 1`,
          })
          .where(
            and(
              eq(platformTasks.id, input.taskId),
              eq(platformTasks.failureStage, 'RECONCILIATION'),
            ),
          );
      }
    });
  }

  async failCycle(input: {
    taskId: string;
    workerId: string;
    error: string;
    nextCheckAt: Date;
    failedAt: Date;
  }): Promise<void> {
    const rows = await this.db
      .update(taskReconciliations)
      .set({
        status: 'FAILED',
        failureAttempts: sql`${taskReconciliations.failureAttempts} + 1`,
        lastError: input.error.slice(0, 4_000),
        nextCheckAt: input.nextCheckAt,
        lockedAt: null,
        lockedBy: null,
        updatedAt: input.failedAt,
      })
      .where(
        and(
          eq(taskReconciliations.taskId, input.taskId),
          eq(taskReconciliations.status, 'RUNNING'),
          eq(taskReconciliations.lockedBy, input.workerId),
        ),
      )
      .returning({ taskId: taskReconciliations.taskId });
    if (!rows.length) throw claimLost(input.taskId);
  }

  async listReconciliations(
    input: ReconciliationListInput,
  ): Promise<TaskReconciliationPage> {
    const keyword = input.keyword?.trim();
    const where = and(
      input.status ? eq(taskReconciliations.status, input.status) : undefined,
      keyword
        ? sql`(${platformTasks.taskNo} ilike ${contains(keyword)} OR ${platformTasks.taskName} ilike ${contains(keyword)} OR ${platformTasks.baiyingCallJobId} ilike ${contains(keyword)})`
        : undefined,
    );
    const [totalRow, rows] = await Promise.all([
      this.db
        .select({ total: count(taskReconciliations.taskId) })
        .from(taskReconciliations)
        .innerJoin(
          platformTasks,
          eq(platformTasks.id, taskReconciliations.taskId),
        )
        .where(where),
      this.db
        .select({
          taskId: taskReconciliations.taskId,
          taskNo: platformTasks.taskNo,
          taskName: platformTasks.taskName,
          status: taskReconciliations.status,
          providerState: taskReconciliations.providerState,
          expectedCallCount: taskReconciliations.expectedCallCount,
          providerCallCount: taskReconciliations.providerCallCount,
          platformCallCount: taskReconciliations.platformCallCount,
          pendingInboxCount: taskReconciliations.pendingInboxCount,
          stableRounds: taskReconciliations.stableRounds,
          mismatchSince: taskReconciliations.mismatchSince,
          lastCheckedAt: taskReconciliations.lastCheckedAt,
          nextCheckAt: taskReconciliations.nextCheckAt,
          lastSuccessfulAt: taskReconciliations.lastSuccessfulAt,
          lastProviderRequestId: taskReconciliations.lastProviderRequestId,
          failureAttempts: taskReconciliations.failureAttempts,
          lastError: taskReconciliations.lastError,
          manualReviewAt: taskReconciliations.manualReviewAt,
          repairCount: taskReconciliations.repairCount,
          lastRepairRequestedAt: taskReconciliations.lastRepairRequestedAt,
          updatedAt: taskReconciliations.updatedAt,
        })
        .from(taskReconciliations)
        .innerJoin(
          platformTasks,
          eq(platformTasks.id, taskReconciliations.taskId),
        )
        .where(where)
        .orderBy(
          desc(taskReconciliations.updatedAt),
          desc(taskReconciliations.taskId),
        )
        .limit(input.pageSize)
        .offset(input.pageNum * input.pageSize),
    ]);
    const total = Number(totalRow[0]?.total ?? 0);
    return taskReconciliationPageSchema.parse({
      total,
      pages: Math.ceil(total / input.pageSize),
      pageNum: input.pageNum,
      pageSize: input.pageSize,
      items: rows.map(toContract),
    });
  }

  async requestRepair(
    taskNo: string,
    input: RepairTaskReconciliationInput,
    actorId: string,
    requestId: string,
  ): Promise<RepairTaskReconciliationResult> {
    const outcome = await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`reconciliation-repair:${input.idempotencyKey}`}))`,
      );
      const prior = await findRepairAudit(tx, input.idempotencyKey);
      if (prior) {
        if (prior.taskNo !== taskNo) throw idempotencyConflict();
        return {
          idempotentReplay: true,
          replayedInboxCount: prior.replayedInboxCount,
        };
      }
      const target = await lockByTaskNo(tx, taskNo);
      const now = this.clock();
      const failedInbox = await tx.execute<{ id: string }>(sql`
        SELECT ${callbackInbox.id} AS id
        FROM ${callbackInbox}
        WHERE ${callbackInbox.companyId} = ${target.companyId}
          AND ${callbackInbox.callJobId} = ${target.callJobId}
          AND (
            ${callbackInbox.processStatus} = 'FAILED'
            OR ${callbackInbox.deadLetteredAt} IS NOT NULL
          )
        FOR UPDATE
      `);
      const inboxIds = failedInbox.map((row) => row.id);
      if (inboxIds.length) {
        await tx.execute(sql`
          UPDATE ${deadLetterEvents}
          SET
            status = 'REPLAYING',
            replay_count = replay_count + 1,
            resolved_by = NULL,
            resolved_at = NULL,
            resolution_note = NULL
          WHERE source_type = 'CALLBACK'
            AND source_id IN ${sql`(${sql.join(
              inboxIds.map((id) => sql`${id}::uuid`),
              sql`, `,
            )})`}
            AND status = 'OPEN'
        `);
        await tx.execute(sql`
          UPDATE ${callbackInbox}
          SET
            parse_status = 'PENDING',
            process_status = 'PENDING',
            process_attempts = 0,
            available_at = ${now.toISOString()}::timestamptz,
            locked_at = NULL,
            locked_by = NULL,
            dead_lettered_at = NULL,
            parse_error = NULL,
            process_error = NULL,
            processed_at = NULL
          WHERE id IN ${sql`(${sql.join(
            inboxIds.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})`}
        `);
      }
      await tx
        .update(taskReconciliations)
        .set({
          status: 'PENDING',
          stableRounds: 0,
          mismatchSince: null,
          nextCheckAt: now,
          failureAttempts: 0,
          lastError: null,
          manualReviewAt: null,
          repairCount: sql`${taskReconciliations.repairCount} + 1`,
          lastRepairRequestedAt: now,
          lockedAt: null,
          lockedBy: null,
          updatedAt: now,
        })
        .where(eq(taskReconciliations.taskId, target.taskId));
      await tx
        .update(platformTasks)
        .set({
          failureStage: null,
          failureCode: null,
          failureMessage: null,
          failureRetryable: null,
          updatedAt: now,
          lockVersion: sql`${platformTasks.lockVersion} + 1`,
        })
        .where(
          and(
            eq(platformTasks.id, target.taskId),
            eq(platformTasks.failureStage, 'RECONCILIATION'),
          ),
        );
      await tx.insert(auditLogs).values({
        id: this.createId(),
        requestId,
        actorId,
        action: 'TASK_RECONCILIATION_REPAIR_REQUESTED',
        objectType: 'PLATFORM_TASK',
        objectId: target.taskId,
        detail: {
          taskNo,
          reason: input.reason,
          idempotencyKey: input.idempotencyKey,
          replayedInboxCount: inboxIds.length,
        },
        occurredAt: now,
      });
      return { idempotentReplay: false, replayedInboxCount: inboxIds.length };
    });
    const reconciliation = await this.requireByTaskNo(taskNo);
    return repairTaskReconciliationResultSchema.parse({
      reconciliation,
      ...outcome,
      message: outcome.idempotentReplay
        ? '该人工修复请求已经受理，无需重复提交'
        : '失败 Inbox 已恢复为待处理，对账任务已安排立即复查',
    });
  }

  private async requireByTaskNo(taskNo: string): Promise<TaskReconciliation> {
    const result = await this.listReconciliations({
      keyword: taskNo,
      pageNum: 0,
      pageSize: 20,
    });
    const item = result.items.find((candidate) => candidate.taskNo === taskNo);
    if (!item) {
      throw new OperationsConsoleFailure(
        'RECONCILIATION_NOT_FOUND',
        '任务尚未进入对账流程',
        404,
      );
    }
    return item;
  }
}

function toContract(row: {
  taskId: string;
  taskNo: string;
  taskName: string;
  status: TaskReconciliationStatus;
  providerState: string | null;
  expectedCallCount: number;
  providerCallCount: number | null;
  platformCallCount: number;
  pendingInboxCount: number;
  stableRounds: number;
  mismatchSince: Date | null;
  lastCheckedAt: Date | null;
  nextCheckAt: Date | null;
  lastSuccessfulAt: Date | null;
  lastProviderRequestId: string | null;
  failureAttempts: number;
  lastError: string | null;
  manualReviewAt: Date | null;
  repairCount: number;
  lastRepairRequestedAt: Date | null;
  updatedAt: Date;
}): TaskReconciliation {
  return taskReconciliationSchema.parse({
    ...row,
    mismatchSince: row.mismatchSince?.toISOString() ?? null,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    nextCheckAt: row.nextCheckAt?.toISOString() ?? null,
    lastSuccessfulAt: row.lastSuccessfulAt?.toISOString() ?? null,
    manualReviewAt: row.manualReviewAt?.toISOString() ?? null,
    lastRepairRequestedAt: row.lastRepairRequestedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  });
}

async function lockByTaskNo(tx: Transaction, taskNo: string) {
  const rows = await tx.execute<{
    taskId: string;
    companyId: string;
    callJobId: string;
  }>(sql`
    SELECT
      task.id AS "taskId",
      task.baiying_company_id AS "companyId",
      task.baiying_call_job_id AS "callJobId"
    FROM ${platformTasks} AS task
    INNER JOIN ${taskReconciliations} AS reconciliation
      ON reconciliation.task_id = task.id
    WHERE task.task_no = ${taskNo}
    FOR UPDATE OF task, reconciliation
  `);
  const row = rows[0];
  if (!row) {
    throw new OperationsConsoleFailure(
      'RECONCILIATION_NOT_FOUND',
      '任务尚未进入对账流程',
      404,
    );
  }
  return row;
}

async function findRepairAudit(tx: Transaction, idempotencyKey: string) {
  const [row] = await tx
    .select({ detail: auditLogs.detail })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.action, 'TASK_RECONCILIATION_REPAIR_REQUESTED'),
        sql`${auditLogs.detail}->>'idempotencyKey' = ${idempotencyKey}`,
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    taskNo: typeof row.detail.taskNo === 'string' ? row.detail.taskNo : '',
    replayedInboxCount:
      typeof row.detail.replayedInboxCount === 'number'
        ? row.detail.replayedInboxCount
        : 0,
  };
}

function mismatchMessage(input: ReconciliationCycleUpdate): string {
  return [
    `百应完成通话 ${input.providerCallCount} 条`,
    `平台 ${input.platformCallCount} 条`,
    `待处理 Inbox ${input.pendingInboxCount} 条`,
    '持续不一致超过 15 分钟，请人工核对后触发修复',
  ].join('；');
}

function claimLost(taskId: string): Error {
  return new Error(`Reconciliation ${taskId} 的处理锁已丢失`);
}

function assertWorkerId(workerId: string): void {
  if (!workerId || workerId.length > 128) {
    throw new TypeError('Reconciliation workerId 长度必须为 1～128 字符');
  }
}

function contains(value: string): string {
  return `%${value.replace(/[\\%_]/g, '\\$&')}%`;
}

function idempotencyConflict(): OperationsConsoleFailure {
  return new OperationsConsoleFailure(
    'IDEMPOTENCY_CONFLICT',
    '该幂等键已用于其他任务的人工修复',
    409,
  );
}

import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import {
  operatorTaskActionResultSchema,
  type ConsoleTaskCommand,
  type OperatorTaskActionResult,
  type OperatorTaskCommandInput,
  type OperatorTaskRetryInput,
  type TaskExecutionStatus,
} from '@outbound/contracts';
import { BaiyingProviderError } from '../baiying/call-job-client.js';
import {
  addMoney,
  moneyToMicros,
  negateMoney,
  normalizeMoney,
  subtractMoney,
} from '../billing/money.js';
import { nextTaskHoldReleaseBusinessKey } from '../billing/hold-cycle.js';
import type { Database } from '../db/client.js';
import {
  accountLedger,
  auditLogs,
  deadLetterEvents,
  fundHolds,
  platformTasks,
  queueOutbox,
  studioAccounts,
  taskOperations,
} from '../db/schema.js';
import { OperationsConsoleFailure } from './service.js';
import { redactOperatorText, sanitizeOperatorDetail } from './redaction.js';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

type LockedTask = {
  id: string;
  taskNo: string;
  sourceSystem: 'ERP' | 'CRM';
  studioId: string;
  executionStatus: TaskExecutionStatus;
  failureRetryable: boolean | null;
  billingStatus: 'RESERVED' | 'SETTLING' | 'SETTLED' | 'FAILED';
  baiyingCompanyId: string;
  baiyingCallJobId: string | null;
  callInstanceCount: number;
};

type LockedHold = {
  id: string;
  studioId: string;
  originalAmount: string;
  remainingAmount: string;
  status: 'ACTIVE' | 'CAPTURED' | 'RELEASED';
};

type LockedAccount = {
  studioId: string;
  balance: string;
  activeHoldAmount: string;
  status: 'ACTIVE' | 'LOW_BALANCE' | 'OVERDUE' | 'DISABLED';
};

type ExistingCommand = {
  id: string;
  taskId: string;
  taskNo: string;
  operationType: ConsoleTaskCommand;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
  executionStatus: TaskExecutionStatus;
  payload: Record<string, unknown>;
  startedAt: Date;
};

export type TaskCommandProviderMode = 'LOCAL_SIMULATION' | 'BAIYING';

export interface TaskCommandExecutor {
  readonly mode: TaskCommandProviderMode;
  execute(input: {
    companyId: string;
    callJobId: string;
    command: ConsoleTaskCommand;
  }): Promise<{
    requestId?: string;
    response: Record<string, unknown>;
    confirmedState: 'CALLING' | 'PAUSED' | 'TERMINATED';
  }>;
}

/**
 * 本地安全适配器：只返回确定性模拟结果，不联网、不访问百应，也不会发起电话。
 */
export class LocalTaskCommandExecutor implements TaskCommandExecutor {
  readonly mode = 'LOCAL_SIMULATION' as const;

  async execute(input: {
    companyId: string;
    callJobId: string;
    command: ConsoleTaskCommand;
  }) {
    const confirmedState =
      input.command === 'PAUSE'
        ? ('PAUSED' as const)
        : input.command === 'RESUME'
          ? ('CALLING' as const)
          : ('TERMINATED' as const);
    return {
      requestId: `local-command-${randomUUID()}`,
      response: {
        code: 200,
        resultMsg: 'local simulation confirmed',
        command: input.command,
        companyId: input.companyId,
        callJobId: input.callJobId,
        state: confirmedState,
      },
      confirmedState,
    };
  }
}

export interface TaskControlService {
  commandTask(
    taskNo: string,
    input: OperatorTaskCommandInput,
    actorId: string,
    requestId: string,
  ): Promise<OperatorTaskActionResult>;
  retryTask(
    taskNo: string,
    input: OperatorTaskRetryInput,
    actorId: string,
    requestId: string,
  ): Promise<OperatorTaskActionResult>;
}

export class PostgresTaskControlService implements TaskControlService {
  constructor(
    private readonly db: Database,
    private readonly executor: TaskCommandExecutor,
    private readonly options: {
      taskQueueName?: string;
      lowBalanceThreshold?: string;
      clock?: () => Date;
      createId?: () => string;
    } = {},
  ) {}

  async commandTask(
    taskNo: string,
    input: OperatorTaskCommandInput,
    actorId: string,
    requestId: string,
  ): Promise<OperatorTaskActionResult> {
    const started = await this.db.transaction(async (tx) => {
      await advisoryLock(tx, `operator-action:${input.idempotencyKey}`);
      const existing = await findCommandByIdempotencyKey(
        tx,
        input.idempotencyKey,
      );
      if (existing) {
        assertSameCommand(existing, taskNo, input.command);
        return { existing } as const;
      }
      await assertNoRetryWithIdempotencyKey(tx, input.idempotencyKey);
      const task = await lockTaskByNo(tx, taskNo);
      assertCommandAllowed(task, input.command);
      const now = this.clock();
      const [operation] = await tx
        .insert(taskOperations)
        .values({
          id: this.createId(),
          taskId: task.id,
          operationType: input.command,
          attemptNo: await nextOperationAttempt(tx, task.id, input.command),
          requestPayloadRedacted: {
            idempotencyKey: input.idempotencyKey,
            actorId,
            requestId,
            reason: input.reason,
            providerMode: this.executor.mode,
            companyId: task.baiyingCompanyId,
            callJobId: task.baiyingCallJobId,
            command: input.command,
          },
          status: 'PENDING',
          startedAt: now,
        })
        .returning({
          id: taskOperations.id,
          startedAt: taskOperations.startedAt,
        });
      await tx.insert(auditLogs).values({
        id: this.createId(),
        requestId,
        actorId,
        action: 'TASK_COMMAND_REQUESTED',
        objectType: 'PLATFORM_TASK',
        objectId: task.id,
        detail: {
          taskNo,
          command: input.command,
          reason: input.reason,
          operationId: operation!.id,
          idempotencyKey: input.idempotencyKey,
          providerMode: this.executor.mode,
        },
        occurredAt: now,
      });
      return { task, operation: operation! } as const;
    });

    if ('existing' in started && started.existing) {
      return commandResultFromExisting(started.existing, this.executor.mode);
    }

    const { task, operation } = started;
    try {
      const result = await this.executor.execute({
        companyId: task.baiyingCompanyId,
        callJobId: task.baiyingCallJobId!,
        command: input.command,
      });
      const target = targetStatus(input.command);
      if (result.confirmedState !== target) {
        throw new OperationsConsoleFailure(
          'TASK_COMMAND_CONFIRMATION_MISMATCH',
          `供应商确认状态为 ${result.confirmedState}，与命令目标 ${target} 不一致，任务状态未变更`,
          502,
        );
      }
      const completed = await this.db.transaction(async (tx) => {
        const locked = await lockTaskById(tx, task.id);
        if (
          locked.executionStatus !== target &&
          !commandStatuses(input.command).includes(locked.executionStatus)
        ) {
          throw new OperationsConsoleFailure(
            'TASK_STATE_CHANGED',
            `任务状态已变为 ${locked.executionStatus}，命令结果已记录但未覆盖新状态`,
            409,
          );
        }
        const now = this.clock();
        if (locked.executionStatus !== target) {
          if (target === 'TERMINATED') {
            await releaseRemainingTaskHold(
              tx,
              locked,
              actorId,
              now,
              this.options.lowBalanceThreshold ?? '500.000000',
              this.createId.bind(this),
            );
          }
          await tx
            .update(platformTasks)
            .set({
              executionStatus: target,
              providerStatus: providerStatusFor(input.command),
              billingStatus: target === 'TERMINATED' ? 'SETTLED' : undefined,
              providerCompletedAt: target === 'TERMINATED' ? now : undefined,
              reconciledAt: target === 'TERMINATED' ? now : undefined,
              closedAt: target === 'TERMINATED' ? now : undefined,
              updatedAt: now,
              lockVersion: sql`${platformTasks.lockVersion} + 1`,
            })
            .where(eq(platformTasks.id, locked.id));
        }
        await finishOperation(tx, operation.id, {
          status: 'SUCCEEDED',
          response: sanitizeOperatorDetail(result.response),
          providerRequestId: result.requestId,
          now,
        });
        await tx.insert(auditLogs).values({
          id: this.createId(),
          requestId,
          actorId,
          action: 'TASK_COMMAND_SUCCEEDED',
          objectType: 'PLATFORM_TASK',
          objectId: locked.id,
          detail: {
            taskNo,
            command: input.command,
            operationId: operation.id,
            executionStatus: target,
            providerMode: this.executor.mode,
          },
          occurredAt: now,
        });
        return { executionStatus: target, now };
      });
      return operatorTaskActionResultSchema.parse({
        actionId: operation.id,
        taskNo,
        action: input.command,
        status: 'SUCCEEDED',
        executionStatus: completed.executionStatus,
        providerMode: this.executor.mode,
        idempotentReplay: false,
        requestedAt: operation.startedAt.toISOString(),
        message:
          this.executor.mode === 'LOCAL_SIMULATION'
            ? '本地安全模拟已确认命令；未联网、未产生真实外呼'
            : '百应已确认任务命令',
      });
    } catch (error) {
      const operationStatus =
        error instanceof BaiyingProviderError &&
        error.kind === 'UNKNOWN_OUTCOME'
          ? 'UNKNOWN'
          : 'FAILED';
      const message =
        redactOperatorText(
          error instanceof Error ? error.message : String(error),
        ) ?? '任务命令执行失败';
      await this.db.transaction(async (tx) => {
        const now = this.clock();
        await finishOperation(tx, operation.id, {
          status: operationStatus,
          response:
            error instanceof BaiyingProviderError
              ? sanitizeOperatorDetail(error.metadata.response ?? {})
              : undefined,
          providerRequestId:
            error instanceof BaiyingProviderError
              ? error.metadata.requestId
              : undefined,
          errorClass:
            error instanceof BaiyingProviderError
              ? error.kind
              : error instanceof OperationsConsoleFailure
                ? 'COMMAND_GUARDRAIL'
                : 'COMMAND_ERROR',
          errorCode:
            error instanceof BaiyingProviderError
              ? error.code
              : error instanceof OperationsConsoleFailure
                ? error.code
                : 'TASK_COMMAND_FAILED',
          errorMessage: message,
          now,
        });
        await tx.insert(auditLogs).values({
          id: this.createId(),
          requestId,
          actorId,
          action:
            operationStatus === 'UNKNOWN'
              ? 'TASK_COMMAND_UNKNOWN'
              : 'TASK_COMMAND_FAILED',
          objectType: 'PLATFORM_TASK',
          objectId: task.id,
          detail: {
            taskNo,
            command: input.command,
            operationId: operation.id,
            error: message,
            providerMode: this.executor.mode,
          },
          occurredAt: now,
        });
      });
      if (error instanceof OperationsConsoleFailure) throw error;
      throw new OperationsConsoleFailure(
        operationStatus === 'UNKNOWN'
          ? 'TASK_COMMAND_OUTCOME_UNKNOWN'
          : 'TASK_COMMAND_FAILED',
        operationStatus === 'UNKNOWN'
          ? '命令结果暂时无法确认，请先查询供应商状态，禁止直接重复操作'
          : message,
        503,
        { operationId: operation.id },
      );
    }
  }

  async retryTask(
    taskNo: string,
    input: OperatorTaskRetryInput,
    actorId: string,
    requestId: string,
  ): Promise<OperatorTaskActionResult> {
    return this.db.transaction(async (tx) => {
      await advisoryLock(tx, `operator-action:${input.idempotencyKey}`);
      const existing = await findRetryAudit(tx, input.idempotencyKey);
      if (existing) {
        if (existing.taskNo !== taskNo) {
          throw idempotencyConflict();
        }
        const task = await lockTaskByNo(tx, taskNo);
        return operatorTaskActionResultSchema.parse({
          actionId: existing.eventId,
          taskNo,
          action: 'RETRY',
          status: 'QUEUED',
          executionStatus: task.executionStatus,
          providerMode: this.executor.mode,
          idempotentReplay: true,
          requestedAt: new Date(existing.occurredAt).toISOString(),
          message: '该重试请求已提交，无需重复操作',
        });
      }
      await assertNoCommandWithIdempotencyKey(tx, input.idempotencyKey);
      const task = await lockTaskByNo(tx, taskNo);
      const hold = await lockHold(tx, task.id);
      const targetStatus = retryTarget(task, hold);
      const now = this.clock();
      if (hold.status === 'RELEASED') {
        await restoreTaskHold(
          tx,
          task,
          hold,
          actorId,
          input.idempotencyKey,
          now,
          this.options.lowBalanceThreshold ?? '500.000000',
          this.createId.bind(this),
        );
      }
      const eventId = this.createId();
      await tx
        .update(platformTasks)
        .set({
          executionStatus: targetStatus,
          billingStatus: 'RESERVED',
          failureStage: null,
          failureCode: null,
          failureMessage: null,
          failureRetryable: null,
          closedAt: null,
          lastRetryAt: now,
          recordingArchiveStatus: 'PENDING',
          recordingDeliveryStatus: 'PENDING',
          updatedAt: now,
          lockVersion: sql`${platformTasks.lockVersion} + 1`,
        })
        .where(eq(platformTasks.id, task.id));
      await tx.insert(queueOutbox).values({
        id: eventId,
        eventType: 'TASK_ACCEPTED',
        queueName: this.options.taskQueueName ?? 'task-orchestration-queue',
        payload: {
          schemaVersion: '1.0',
          taskId: task.id,
          taskNo: task.taskNo,
          sourceSystem: task.sourceSystem,
          recovery: {
            requestedBy: actorId,
            reason: input.reason,
          },
        },
        availableAt: now,
        createdAt: now,
      });
      await tx.insert(auditLogs).values({
        id: this.createId(),
        requestId,
        actorId,
        action: 'TASK_RETRY_REQUESTED',
        objectType: 'PLATFORM_TASK',
        objectId: task.id,
        detail: {
          taskNo,
          reason: input.reason,
          idempotencyKey: input.idempotencyKey,
          eventId,
          recoveryStatus: targetStatus,
        },
        occurredAt: now,
      });
      await tx
        .update(deadLetterEvents)
        .set({
          status: 'RESOLVED',
          resolvedBy: actorId,
          resolvedAt: now,
          resolutionNote: '运营人员已通过安全重试生成新的编排事件',
        })
        .where(
          and(
            eq(deadLetterEvents.sourceType, 'OUTBOX'),
            eq(deadLetterEvents.status, 'OPEN'),
            sql`${deadLetterEvents.sourceId} in (
              select id from queue_outbox
              where payload_json->>'taskId' = ${task.id}
            )`,
          ),
        );
      return operatorTaskActionResultSchema.parse({
        actionId: eventId,
        taskNo,
        action: 'RETRY',
        status: 'QUEUED',
        executionStatus: targetStatus,
        providerMode: this.executor.mode,
        idempotentReplay: false,
        requestedAt: now.toISOString(),
        message: '任务已安全恢复到待确认状态，并重新加入编排队列',
      });
    });
  }

  private clock(): Date {
    return this.options.clock?.() ?? new Date();
  }

  private createId(): string {
    return this.options.createId?.() ?? randomUUID();
  }
}

async function findCommandByIdempotencyKey(
  tx: Transaction,
  idempotencyKey: string,
): Promise<ExistingCommand | undefined> {
  const rows = await tx.execute<ExistingCommand>(sql`
    select
      operation.id,
      operation.task_id as "taskId",
      task.task_no as "taskNo",
      operation.operation_type as "operationType",
      operation.status,
      task.execution_status as "executionStatus",
      operation.request_payload_redacted_json as payload,
      operation.started_at as "startedAt"
    from task_operation operation
    join platform_task task on task.id = operation.task_id
    where operation.request_payload_redacted_json->>'idempotencyKey' = ${idempotencyKey}
    limit 1
  `);
  return rows[0];
}

async function findRetryAudit(
  tx: Transaction,
  idempotencyKey: string,
): Promise<{ taskNo: string; eventId: string; occurredAt: Date } | undefined> {
  const rows = await tx.execute<{
    taskNo: string;
    eventId: string;
    occurredAt: Date;
  }>(sql`
    select
      detail_json->>'taskNo' as "taskNo",
      detail_json->>'eventId' as "eventId",
      occurred_at as "occurredAt"
    from audit_log
    where action = 'TASK_RETRY_REQUESTED'
      and detail_json->>'idempotencyKey' = ${idempotencyKey}
    limit 1
  `);
  return rows[0];
}

async function assertNoRetryWithIdempotencyKey(
  tx: Transaction,
  idempotencyKey: string,
) {
  if (await findRetryAudit(tx, idempotencyKey)) throw idempotencyConflict();
}

async function assertNoCommandWithIdempotencyKey(
  tx: Transaction,
  idempotencyKey: string,
) {
  if (await findCommandByIdempotencyKey(tx, idempotencyKey)) {
    throw idempotencyConflict();
  }
}

function assertSameCommand(
  existing: ExistingCommand,
  taskNo: string,
  command: ConsoleTaskCommand,
) {
  if (existing.taskNo !== taskNo || existing.operationType !== command) {
    throw idempotencyConflict();
  }
}

function commandResultFromExisting(
  existing: ExistingCommand,
  mode: TaskCommandProviderMode,
): OperatorTaskActionResult {
  const status = existing.status === 'PENDING' ? 'UNKNOWN' : existing.status;
  return operatorTaskActionResultSchema.parse({
    actionId: existing.id,
    taskNo: existing.taskNo,
    action: existing.operationType,
    status,
    executionStatus: existing.executionStatus,
    providerMode:
      existing.payload.providerMode === 'BAIYING' ||
      existing.payload.providerMode === 'LOCAL_SIMULATION'
        ? existing.payload.providerMode
        : mode,
    idempotentReplay: true,
    requestedAt: new Date(existing.startedAt).toISOString(),
    message:
      existing.status === 'PENDING'
        ? '原命令仍待确认，请勿更换幂等键重复提交'
        : '已返回同一幂等命令的既有处理结果',
  });
}

function assertCommandAllowed(task: LockedTask, command: ConsoleTaskCommand) {
  if (!task.baiyingCallJobId) {
    throw new OperationsConsoleFailure(
      'BAIYING_JOB_ID_MISSING',
      '任务尚未生成百应任务 ID，不能执行控制命令',
      409,
    );
  }
  if (!commandStatuses(command).includes(task.executionStatus)) {
    throw new OperationsConsoleFailure(
      'TASK_STATE_CONFLICT',
      `任务当前状态 ${task.executionStatus} 不允许执行 ${command}`,
      409,
    );
  }
}

function commandStatuses(command: ConsoleTaskCommand): TaskExecutionStatus[] {
  return command === 'RESUME'
    ? ['PAUSED']
    : ['CALLING', ...(command === 'TERMINATE' ? ['PAUSED' as const] : [])];
}

function targetStatus(command: ConsoleTaskCommand): TaskExecutionStatus {
  if (command === 'PAUSE') return 'PAUSED';
  if (command === 'RESUME') return 'CALLING';
  return 'TERMINATED';
}

function providerStatusFor(command: ConsoleTaskCommand): number {
  if (command === 'PAUSE') return 4;
  if (command === 'RESUME') return 1;
  return 6;
}

function retryTarget(
  task: LockedTask,
  hold: LockedHold,
): 'BAIYING_CREATING' | 'STARTING' {
  if (task.executionStatus === 'IMPORT_FAILED') {
    throw new OperationsConsoleFailure(
      'TASK_RETRY_REQUIRES_NEW_TASK',
      '导入失败后百应任务可能已终止；为避免部分号码重复外呼，请核查后新建任务',
      409,
    );
  }
  if (!task.failureRetryable) {
    throw new OperationsConsoleFailure(
      'TASK_NOT_RETRYABLE',
      '该任务失败已被判定为不可重试，请修复配置后新建任务',
      409,
    );
  }
  if (task.callInstanceCount > 0) {
    throw new OperationsConsoleFailure(
      'TASK_RETRY_UNSAFE',
      '任务已产生通话记录，禁止重新执行启动编排',
      409,
    );
  }
  if (task.executionStatus === 'CREATE_FAILED') {
    if (
      hold.status === 'RELEASED' ||
      (hold.status === 'ACTIVE' && task.billingStatus === 'RESERVED')
    ) {
      return 'BAIYING_CREATING';
    }
    throw new OperationsConsoleFailure(
      'TASK_RETRY_UNSAFE',
      '创建失败任务的冻结状态不允许安全重试，请先人工核查账务',
      409,
    );
  }
  if (
    task.executionStatus === 'START_FAILED' &&
    hold.status === 'ACTIVE' &&
    task.billingStatus === 'RESERVED' &&
    task.baiyingCallJobId
  ) {
    return 'STARTING';
  }
  throw new OperationsConsoleFailure(
    'TASK_RETRY_UNSAFE',
    '当前供应商或资金状态不足以安全重试，请先人工核查',
    409,
  );
}

async function restoreTaskHold(
  tx: Transaction,
  task: LockedTask,
  hold: LockedHold,
  actorId: string,
  idempotencyKey: string,
  now: Date,
  lowBalanceThreshold: string,
  createId: () => string,
) {
  if (task.executionStatus !== 'CREATE_FAILED') {
    throw new OperationsConsoleFailure(
      'TASK_RETRY_UNSAFE',
      '只有创建阶段失败可在资金已释放后重新冻结并重试',
      409,
    );
  }
  const account = await lockAccount(tx, hold.studioId);
  const available = subtractMoney(account.balance, account.activeHoldAmount);
  if (moneyToMicros(available) < moneyToMicros(hold.originalAmount)) {
    throw new OperationsConsoleFailure(
      'INSUFFICIENT_BALANCE',
      '当前可用余额不足，无法为重试任务重新冻结资金',
      409,
    );
  }
  const activeHoldAmount = addMoney(
    account.activeHoldAmount,
    hold.originalAmount,
  );
  const availableAfter = subtractMoney(account.balance, activeHoldAmount);
  await tx
    .update(fundHolds)
    .set({
      remainingAmount: normalizeMoney(hold.originalAmount),
      status: 'ACTIVE',
      releasedAt: null,
    })
    .where(eq(fundHolds.id, hold.id));
  await tx
    .update(studioAccounts)
    .set({
      activeHoldAmount,
      status: accountStatusAfter(
        account.balance,
        availableAfter,
        account.status,
        lowBalanceThreshold,
      ),
      updatedAt: now,
      lockVersion: sql`${studioAccounts.lockVersion} + 1`,
    })
    .where(eq(studioAccounts.studioId, account.studioId));
  await tx.insert(accountLedger).values({
    id: createId(),
    studioId: account.studioId,
    taskId: task.id,
    entryType: 'TASK_HOLD',
    amount: negateMoney(hold.originalAmount),
    balanceAfter: normalizeMoney(account.balance),
    availableBalanceAfter: availableAfter,
    businessKey: `TASK_HOLD_RETRY:${task.id}:${idempotencyKey}`,
    operatorId: actorId,
    reason: '运营后台安全重试任务，重新冻结原任务金额',
    occurredAt: now,
  });
}

async function releaseRemainingTaskHold(
  tx: Transaction,
  task: LockedTask,
  actorId: string,
  now: Date,
  lowBalanceThreshold: string,
  createId: () => string,
) {
  const hold = await lockHold(tx, task.id);
  if (hold.status !== 'ACTIVE') return;
  const remaining = normalizeMoney(hold.remainingAmount);
  const account = await lockAccount(tx, hold.studioId);
  const activeHoldAmount = subtractMoney(account.activeHoldAmount, remaining);
  if (moneyToMicros(activeHoldAmount) < 0n) {
    throw new OperationsConsoleFailure(
      'HOLD_BALANCE_CONFLICT',
      '账户冻结汇总小于任务待释放金额，已停止终止结算',
      409,
    );
  }
  const availableAfter = subtractMoney(account.balance, activeHoldAmount);
  await tx
    .update(fundHolds)
    .set({ remainingAmount: '0.000000', status: 'RELEASED', releasedAt: now })
    .where(eq(fundHolds.id, hold.id));
  await tx
    .update(studioAccounts)
    .set({
      activeHoldAmount,
      status: accountStatusAfter(
        account.balance,
        availableAfter,
        account.status,
        lowBalanceThreshold,
      ),
      updatedAt: now,
      lockVersion: sql`${studioAccounts.lockVersion} + 1`,
    })
    .where(eq(studioAccounts.studioId, account.studioId));
  await tx
    .insert(accountLedger)
    .values({
      id: createId(),
      studioId: account.studioId,
      taskId: task.id,
      entryType: 'TASK_HOLD_RELEASE',
      amount: remaining,
      balanceAfter: normalizeMoney(account.balance),
      availableBalanceAfter: availableAfter,
      businessKey: await nextTaskHoldReleaseBusinessKey(tx, task.id),
      operatorId: actorId,
      reason: '运营后台终止任务，供应商终态确认后释放剩余冻结',
      occurredAt: now,
    })
    .onConflictDoNothing({ target: accountLedger.businessKey });
}

async function finishOperation(
  tx: Transaction,
  operationId: string,
  input: {
    status: 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
    response?: Record<string, unknown>;
    providerRequestId?: string;
    errorClass?: string;
    errorCode?: string;
    errorMessage?: string;
    now: Date;
  },
) {
  const rows = await tx
    .update(taskOperations)
    .set({
      status: input.status,
      responsePayloadRedacted: input.response,
      providerRequestId: input.providerRequestId?.slice(0, 128),
      errorClass: input.errorClass?.slice(0, 128),
      errorCode: input.errorCode?.slice(0, 128),
      errorMessage: input.errorMessage?.slice(0, 1_000),
      finishedAt: input.now,
    })
    .where(
      and(
        eq(taskOperations.id, operationId),
        eq(taskOperations.status, 'PENDING'),
      ),
    )
    .returning({ id: taskOperations.id });
  if (!rows.length) {
    throw new OperationsConsoleFailure(
      'TASK_OPERATION_ALREADY_FINISHED',
      '任务操作已完成或不存在',
      409,
    );
  }
}

async function nextOperationAttempt(
  tx: Transaction,
  taskId: string,
  operationType: ConsoleTaskCommand,
) {
  const rows = await tx.execute<{ attempt: number }>(sql`
    select coalesce(max(attempt_no), 0)::int + 1 as attempt
    from task_operation
    where task_id = ${taskId} and operation_type = ${operationType}
  `);
  return rows[0]?.attempt ?? 1;
}

async function lockTaskByNo(
  tx: Transaction,
  taskNo: string,
): Promise<LockedTask> {
  const rows = await tx.execute<LockedTask>(sql`
    select
      id,
      task_no as "taskNo",
      source_system as "sourceSystem",
      studio_id as "studioId",
      execution_status as "executionStatus",
      failure_retryable as "failureRetryable",
      billing_status as "billingStatus",
      baiying_company_id as "baiyingCompanyId",
      baiying_call_job_id as "baiyingCallJobId",
      call_instance_count as "callInstanceCount"
    from platform_task
    where task_no = ${taskNo}
    for update
  `);
  const task = rows[0];
  if (!task) {
    throw new OperationsConsoleFailure('TASK_NOT_FOUND', '任务不存在', 404);
  }
  return task;
}

async function lockTaskById(
  tx: Transaction,
  taskId: string,
): Promise<LockedTask> {
  const rows = await tx.execute<LockedTask>(sql`
    select
      id,
      task_no as "taskNo",
      source_system as "sourceSystem",
      studio_id as "studioId",
      execution_status as "executionStatus",
      failure_retryable as "failureRetryable",
      billing_status as "billingStatus",
      baiying_company_id as "baiyingCompanyId",
      baiying_call_job_id as "baiyingCallJobId",
      call_instance_count as "callInstanceCount"
    from platform_task
    where id = ${taskId}
    for update
  `);
  const task = rows[0];
  if (!task) {
    throw new OperationsConsoleFailure('TASK_NOT_FOUND', '任务不存在', 404);
  }
  return task;
}

async function lockHold(tx: Transaction, taskId: string): Promise<LockedHold> {
  const rows = await tx.execute<LockedHold>(sql`
    select
      id,
      studio_id as "studioId",
      original_amount::text as "originalAmount",
      remaining_amount::text as "remainingAmount",
      status
    from fund_hold
    where task_id = ${taskId}
    for update
  `);
  const hold = rows[0];
  if (!hold) {
    throw new OperationsConsoleFailure(
      'TASK_HOLD_NOT_FOUND',
      '任务缺少资金冻结记录',
      409,
    );
  }
  return hold;
}

async function lockAccount(
  tx: Transaction,
  studioId: string,
): Promise<LockedAccount> {
  const rows = await tx.execute<LockedAccount>(sql`
    select
      studio_id as "studioId",
      balance::text as balance,
      active_hold_amount::text as "activeHoldAmount",
      status
    from studio_account
    where studio_id = ${studioId}
    for update
  `);
  const account = rows[0];
  if (!account) {
    throw new OperationsConsoleFailure(
      'STUDIO_ACCOUNT_NOT_FOUND',
      '影楼账户不存在',
      409,
    );
  }
  return account;
}

function accountStatusAfter(
  balance: string,
  available: string,
  current: LockedAccount['status'],
  lowBalanceThreshold: string,
): LockedAccount['status'] {
  if (current === 'DISABLED') return current;
  if (moneyToMicros(balance) <= 0n) return 'OVERDUE';
  if (moneyToMicros(available) < moneyToMicros(lowBalanceThreshold)) {
    return 'LOW_BALANCE';
  }
  return 'ACTIVE';
}

async function advisoryLock(tx: Transaction, key: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
  );
}

function idempotencyConflict() {
  return new OperationsConsoleFailure(
    'IDEMPOTENCY_CONFLICT',
    '同一幂等键已用于不同的任务操作',
    409,
  );
}

import { randomUUID } from 'node:crypto';
import { and, count, eq, sql } from 'drizzle-orm';
import {
  taskStartedEventSchema,
  taskStartFailedEventSchema,
  type SourceSystem,
  type TaskExecutionStatus,
} from '@outbound/contracts';
import type { BaiyingImportSummary } from '../baiying/call-job-client.js';
import {
  moneyToMicros,
  normalizeMoney,
  subtractMoney,
} from '../billing/money.js';
import type { Database } from '../db/client.js';
import {
  accountLedger,
  fundHolds,
  platformTasks,
  queueOutbox,
  studioAccounts,
  taskCallItems,
  taskOperations,
} from '../db/schema.js';
import {
  TaskNotFoundError,
  TaskStateConflictError,
  type OperationHandle,
  type OrchestrationTask,
  type TaskOperationType,
  type TaskOrchestrationRepository,
} from './repository.js';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

type LockedTask = {
  id: string;
  taskNo: string;
  sourceSystem: string;
  mcCode: string;
  baiyingCallJobId: string | null;
  executionStatus: TaskExecutionStatus;
};

type LockedHold = {
  id: string;
  studioId: string;
  remainingAmount: string;
  status: 'ACTIVE' | 'CAPTURED' | 'RELEASED';
};

type LockedAccount = {
  studioId: string;
  balance: string;
  activeHoldAmount: string;
  status: 'ACTIVE' | 'LOW_BALANCE' | 'OVERDUE' | 'DISABLED';
};

export class PostgresTaskOrchestrationRepository implements TaskOrchestrationRepository {
  constructor(
    private readonly db: Database,
    private readonly options: {
      deliveryQueueName?: string;
      lowBalanceThreshold?: string;
      clock?: () => Date;
      createId?: () => string;
    } = {},
  ) {}

  async getTask(taskId: string): Promise<OrchestrationTask | null> {
    const [task] = await this.db
      .select({
        id: platformTasks.id,
        taskNo: platformTasks.taskNo,
        taskName: platformTasks.taskName,
        sourceSystem: platformTasks.sourceSystem,
        mcCode: platformTasks.mcCodeSnapshot,
        phoneCount: platformTasks.phoneCount,
        baiyingCompanyId: platformTasks.baiyingCompanyId,
        baiyingCallJobId: platformTasks.baiyingCallJobId,
        robotDefId: platformTasks.robotDefId,
        userPhoneId: platformTasks.userPhoneId,
        executionStatus: platformTasks.executionStatus,
      })
      .from(platformTasks)
      .where(eq(platformTasks.id, taskId))
      .limit(1);
    if (!task) return null;
    if (!isSourceSystem(task.sourceSystem)) {
      throw new Error(`任务 ${task.taskNo} 的来源系统无效`);
    }
    const callItems = await this.db
      .select({
        id: taskCallItems.id,
        ordinal: taskCallItems.ordinal,
        phoneCiphertext: taskCallItems.phoneCiphertext,
        customerNameCiphertext: taskCallItems.customerNameCiphertext,
        mappedPropertiesCiphertext: taskCallItems.mappedPropertiesCiphertext,
      })
      .from(taskCallItems)
      .where(eq(taskCallItems.taskId, taskId))
      .orderBy(taskCallItems.ordinal);
    return { ...task, sourceSystem: task.sourceSystem, callItems };
  }

  async beginOperation(input: {
    taskId: string;
    operationType: TaskOperationType;
    expectedStatuses: TaskExecutionStatus[];
    nextStatus?: TaskExecutionStatus;
    requestPayloadRedacted: Record<string, unknown>;
  }): Promise<OperationHandle> {
    return this.db.transaction(async (tx) => {
      const task = await lockTask(tx, input.taskId);
      if (!input.expectedStatuses.includes(task.executionStatus)) {
        throw new TaskStateConflictError(
          `任务 ${task.taskNo} 当前状态 ${task.executionStatus} 不允许执行 ${input.operationType}`,
        );
      }
      const attempts = await tx.execute<{ nextAttempt: number }>(sql`
        select coalesce(max(${taskOperations.attemptNo}), 0)::int + 1 as "nextAttempt"
        from ${taskOperations}
        where ${taskOperations.taskId} = ${input.taskId}
          and ${taskOperations.operationType} = ${input.operationType}
      `);
      const now = this.clock();
      const [operation] = await tx
        .insert(taskOperations)
        .values({
          id: this.createId(),
          taskId: input.taskId,
          operationType: input.operationType,
          attemptNo: attempts[0]?.nextAttempt ?? 1,
          requestPayloadRedacted: input.requestPayloadRedacted,
          status: 'PENDING',
          startedAt: now,
        })
        .returning({
          id: taskOperations.id,
          attemptNo: taskOperations.attemptNo,
        });
      if (input.nextStatus && input.nextStatus !== task.executionStatus) {
        await tx
          .update(platformTasks)
          .set({
            executionStatus: input.nextStatus,
            updatedAt: now,
            lockVersion: sql`${platformTasks.lockVersion} + 1`,
          })
          .where(eq(platformTasks.id, input.taskId));
      }
      return operation!;
    });
  }

  async finishOperation(input: {
    operationId: string;
    status: 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
    responsePayloadRedacted?: Record<string, unknown>;
    providerRequestId?: string;
    errorClass?: string;
    errorCode?: string;
    errorMessage?: string;
  }): Promise<void> {
    const updated = await this.db
      .update(taskOperations)
      .set({
        status: input.status,
        responsePayloadRedacted: input.responsePayloadRedacted,
        providerRequestId: truncate(input.providerRequestId, 128),
        errorClass: truncate(input.errorClass, 128),
        errorCode: truncate(input.errorCode, 128),
        errorMessage: truncate(input.errorMessage, 1_000),
        finishedAt: this.clock(),
      })
      .where(
        and(
          eq(taskOperations.id, input.operationId),
          eq(taskOperations.status, 'PENDING'),
        ),
      )
      .returning({ id: taskOperations.id });
    if (!updated.length) {
      throw new TaskStateConflictError(
        `任务操作 ${input.operationId} 已结束或不存在`,
      );
    }
  }

  async markPendingOperationsUnknown(input: {
    taskId: string;
    operationType: TaskOperationType;
    message: string;
  }): Promise<void> {
    await this.db
      .update(taskOperations)
      .set({
        status: 'UNKNOWN',
        errorClass: 'WORKER_INTERRUPTED',
        errorCode: 'OPERATION_RESULT_NOT_PERSISTED',
        errorMessage: truncate(input.message, 1_000),
        finishedAt: this.clock(),
      })
      .where(
        and(
          eq(taskOperations.taskId, input.taskId),
          eq(taskOperations.operationType, input.operationType),
          eq(taskOperations.status, 'PENDING'),
        ),
      );
  }

  async countOperations(
    taskId: string,
    operationType: TaskOperationType,
  ): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(taskOperations)
      .where(
        and(
          eq(taskOperations.taskId, taskId),
          eq(taskOperations.operationType, operationType),
        ),
      );
    return Number(row?.value ?? 0);
  }

  async recordCreated(taskId: string, callJobId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const task = await lockTask(tx, taskId);
      if (
        task.baiyingCallJobId === callJobId &&
        hasReached(task.executionStatus, 'BAIYING_CREATED')
      ) {
        return;
      }
      if (task.executionStatus !== 'BAIYING_CREATING') {
        throw new TaskStateConflictError(
          `任务 ${task.taskNo} 当前状态 ${task.executionStatus} 不能确认百应任务`,
        );
      }
      await tx
        .update(platformTasks)
        .set({
          baiyingCallJobId: callJobId,
          executionStatus: 'BAIYING_CREATED',
          failureStage: null,
          failureCode: null,
          failureMessage: null,
          failureRetryable: null,
          updatedAt: this.clock(),
          lockVersion: sql`${platformTasks.lockVersion} + 1`,
        })
        .where(eq(platformTasks.id, taskId));
    });
  }

  async recordImported(
    taskId: string,
    summary: BaiyingImportSummary,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const task = await lockTask(tx, taskId);
      if (hasReached(task.executionStatus, 'IMPORTED')) return;
      if (task.executionStatus !== 'IMPORTING') {
        throw new TaskStateConflictError(
          `任务 ${task.taskNo} 当前状态 ${task.executionStatus} 不能确认导入`,
        );
      }
      const now = this.clock();
      await tx
        .update(taskCallItems)
        .set({ importStatus: 'SUCCEEDED', importError: null, updatedAt: now })
        .where(eq(taskCallItems.taskId, taskId));
      await tx
        .update(platformTasks)
        .set({
          executionStatus: 'IMPORTED',
          importRequestedCount: summary.total,
          importSucceededCount: summary.successNum,
          importFailedCount: summary.placeFailNum,
          importRepeatedCount: summary.repeatNum,
          updatedAt: now,
          lockVersion: sql`${platformTasks.lockVersion} + 1`,
        })
        .where(eq(platformTasks.id, taskId));
    });
  }

  async recordCalling(taskId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const task = await lockTask(tx, taskId);
      if (task.executionStatus === 'CALLING') return;
      if (
        task.executionStatus !== 'STARTING' &&
        task.executionStatus !== 'IMPORTED'
      ) {
        throw new TaskStateConflictError(
          `任务 ${task.taskNo} 当前状态 ${task.executionStatus} 不能确认启动`,
        );
      }
      if (!task.baiyingCallJobId) {
        throw new TaskStateConflictError(
          `任务 ${task.taskNo} 缺少百应任务 ID，不能确认启动`,
        );
      }
      const now = this.clock();
      const eventId = this.createId();
      const event = taskStartedEventSchema.parse({
        schemaVersion: '1.0',
        eventId,
        eventType: 'OUTBOUND_TASK_STARTED',
        occurredAt: now.toISOString(),
        sourceSystem: requireSourceSystem(task.sourceSystem),
        mcCode: task.mcCode,
        taskNo: task.taskNo,
        baiyingCallJobId: task.baiyingCallJobId,
        executionStatus: 'CALLING',
        startedAt: now.toISOString(),
      });
      await tx
        .update(platformTasks)
        .set({
          executionStatus: 'CALLING',
          startedAt: now,
          updatedAt: now,
          lockVersion: sql`${platformTasks.lockVersion} + 1`,
        })
        .where(eq(platformTasks.id, taskId));
      await tx.insert(queueOutbox).values({
        id: eventId,
        eventType: event.eventType,
        queueName: this.options.deliveryQueueName ?? 'callback-delivery-queue',
        payload: event,
        availableAt: now,
        createdAt: now,
      });
    });
  }

  async recordFailure(input: {
    taskId: string;
    executionStatus: 'CREATE_FAILED' | 'IMPORT_FAILED' | 'START_FAILED';
    stage: 'BAIYING_CREATE' | 'BAIYING_IMPORT' | 'BAIYING_START';
    code: string;
    message: string;
    retryable: boolean;
    releaseHold: boolean;
    importSummary?: BaiyingImportSummary;
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      const task = await lockTask(tx, input.taskId);
      const alreadyFailed = task.executionStatus === input.executionStatus;
      if (
        !alreadyFailed &&
        !canFailFrom(task.executionStatus, input.executionStatus)
      ) {
        throw new TaskStateConflictError(
          `任务 ${task.taskNo} 当前状态 ${task.executionStatus} 不能转为 ${input.executionStatus}`,
        );
      }

      if (input.releaseHold) await this.releaseTaskHold(tx, input.taskId);
      if (alreadyFailed) {
        if (input.releaseHold) {
          await tx
            .update(platformTasks)
            .set({ billingStatus: 'SETTLED', updatedAt: this.clock() })
            .where(eq(platformTasks.id, input.taskId));
        }
        return;
      }

      const now = this.clock();
      const code = truncate(input.code, 128) ?? 'BAIYING_OPERATION_FAILED';
      const message = truncate(input.message, 1_000) ?? '百应任务编排失败';
      const eventId = this.createId();
      const failureEvent = taskStartFailedEventSchema.parse({
        schemaVersion: '1.0',
        eventId,
        eventType: 'OUTBOUND_TASK_START_FAILED',
        occurredAt: now.toISOString(),
        sourceSystem: requireSourceSystem(task.sourceSystem),
        mcCode: task.mcCode,
        taskNo: task.taskNo,
        baiyingCallJobId: task.baiyingCallJobId,
        executionStatus: input.executionStatus,
        failure: {
          stage: input.stage,
          code,
          message,
          retryable: input.retryable,
          occurredAt: now.toISOString(),
        },
      });
      if (input.executionStatus === 'IMPORT_FAILED') {
        await tx
          .update(taskCallItems)
          .set({
            importStatus: 'FAILED',
            importError: message,
            updatedAt: now,
          })
          .where(eq(taskCallItems.taskId, input.taskId));
      }
      await tx
        .update(platformTasks)
        .set({
          executionStatus: input.executionStatus,
          failureStage: input.stage,
          failureCode: code,
          failureMessage: message,
          failureRetryable: input.retryable,
          lastRetryAt: now,
          closedAt: now,
          billingStatus: input.releaseHold ? 'SETTLED' : undefined,
          recordingArchiveStatus: 'NOT_AVAILABLE',
          recordingDeliveryStatus: 'NOT_APPLICABLE',
          ...(input.importSummary
            ? {
                importRequestedCount: input.importSummary.total,
                importSucceededCount: input.importSummary.successNum,
                importFailedCount: input.importSummary.placeFailNum,
                importRepeatedCount: input.importSummary.repeatNum,
              }
            : {}),
          updatedAt: now,
          lockVersion: sql`${platformTasks.lockVersion} + 1`,
        })
        .where(eq(platformTasks.id, input.taskId));
      await tx.insert(queueOutbox).values({
        id: eventId,
        eventType: failureEvent.eventType,
        queueName: this.options.deliveryQueueName ?? 'callback-delivery-queue',
        payload: failureEvent,
        availableAt: now,
        createdAt: now,
      });
    });
  }

  private async releaseTaskHold(tx: Transaction, taskId: string) {
    const holds = await tx.execute<LockedHold>(sql`
      select
        ${fundHolds.id} as "id",
        ${fundHolds.studioId} as "studioId",
        ${fundHolds.remainingAmount} as "remainingAmount",
        ${fundHolds.status} as "status"
      from ${fundHolds}
      where ${fundHolds.taskId} = ${taskId}
      for update
    `);
    const hold = holds[0];
    if (!hold) throw new Error(`任务 ${taskId} 缺少资金冻结记录`);
    if (hold.status === 'RELEASED') return;
    if (hold.status === 'CAPTURED') {
      throw new Error(`任务 ${taskId} 的冻结金额已经结算，不能释放`);
    }

    const accounts = await tx.execute<LockedAccount>(sql`
      select
        ${studioAccounts.studioId} as "studioId",
        ${studioAccounts.balance} as "balance",
        ${studioAccounts.activeHoldAmount} as "activeHoldAmount",
        ${studioAccounts.status} as "status"
      from ${studioAccounts}
      where ${studioAccounts.studioId} = ${hold.studioId}
      for update
    `);
    const account = accounts[0];
    if (!account) throw new Error(`影楼 ${hold.studioId} 缺少账户`);
    const amount = normalizeMoney(hold.remainingAmount);
    const activeHoldAmount = subtractMoney(account.activeHoldAmount, amount);
    if (moneyToMicros(activeHoldAmount) < 0n) {
      throw new Error(`任务 ${taskId} 的冻结汇总小于待释放金额`);
    }
    const availableBalance = subtractMoney(account.balance, activeHoldAmount);
    const now = this.clock();
    await tx
      .update(studioAccounts)
      .set({
        activeHoldAmount,
        status: accountStatusAfter(
          account.balance,
          availableBalance,
          account.status,
          this.options.lowBalanceThreshold ?? '500.000000',
        ),
        lockVersion: sql`${studioAccounts.lockVersion} + 1`,
        updatedAt: now,
      })
      .where(eq(studioAccounts.studioId, account.studioId));
    await tx
      .update(fundHolds)
      .set({
        remainingAmount: '0.000000',
        status: 'RELEASED',
        releasedAt: now,
      })
      .where(eq(fundHolds.id, hold.id));
    await tx
      .insert(accountLedger)
      .values({
        id: this.createId(),
        studioId: hold.studioId,
        taskId,
        entryType: 'TASK_HOLD_RELEASE',
        amount,
        balanceAfter: normalizeMoney(account.balance),
        availableBalanceAfter: availableBalance,
        businessKey: `TASK_HOLD_RELEASE:${taskId}`,
        operatorId: 'task-orchestration-worker',
        reason: '百应任务启动前失败，释放冻结金额',
        occurredAt: now,
      })
      .onConflictDoNothing();
  }

  private clock(): Date {
    return this.options.clock?.() ?? new Date();
  }

  private createId(): string {
    return this.options.createId?.() ?? randomUUID();
  }
}

async function lockTask(tx: Transaction, taskId: string): Promise<LockedTask> {
  const rows = await tx.execute<LockedTask>(sql`
    select
      ${platformTasks.id} as "id",
      ${platformTasks.taskNo} as "taskNo",
      ${platformTasks.sourceSystem} as "sourceSystem",
      ${platformTasks.mcCodeSnapshot} as "mcCode",
      ${platformTasks.baiyingCallJobId} as "baiyingCallJobId",
      ${platformTasks.executionStatus} as "executionStatus"
    from ${platformTasks}
    where ${platformTasks.id} = ${taskId}
    for update
  `);
  const task = rows[0];
  if (!task) throw new TaskNotFoundError(`任务 ${taskId} 不存在`);
  return task;
}

function hasReached(
  current: TaskExecutionStatus,
  milestone: 'BAIYING_CREATED' | 'IMPORTED',
): boolean {
  const order: TaskExecutionStatus[] = [
    'ACCEPTED',
    'BAIYING_CREATING',
    'BAIYING_CREATED',
    'IMPORTING',
    'IMPORTED',
    'STARTING',
    'CALLING',
    'PAUSED',
    'CALL_COMPLETED',
    'RECONCILING',
    'COMPLETED',
  ];
  const currentIndex = order.indexOf(current);
  return currentIndex >= order.indexOf(milestone);
}

function canFailFrom(
  current: TaskExecutionStatus,
  failure: 'CREATE_FAILED' | 'IMPORT_FAILED' | 'START_FAILED',
): boolean {
  if (failure === 'CREATE_FAILED') {
    return current === 'ACCEPTED' || current === 'BAIYING_CREATING';
  }
  if (failure === 'IMPORT_FAILED') {
    return current === 'BAIYING_CREATED' || current === 'IMPORTING';
  }
  return current === 'IMPORTED' || current === 'STARTING';
}

function accountStatusAfter(
  balance: string,
  availableBalance: string,
  current: LockedAccount['status'],
  lowBalanceThreshold: string,
): LockedAccount['status'] {
  if (current === 'DISABLED') return current;
  if (moneyToMicros(balance) <= 0n) return 'OVERDUE';
  if (moneyToMicros(availableBalance) < moneyToMicros(lowBalanceThreshold)) {
    return 'LOW_BALANCE';
  }
  return 'ACTIVE';
}

function truncate(value: string | undefined, maximum: number) {
  return value ? value.slice(0, maximum) : undefined;
}

function isSourceSystem(value: string): value is SourceSystem {
  return value === 'ERP' || value === 'CRM';
}

function requireSourceSystem(value: string): SourceSystem {
  if (!isSourceSystem(value)) throw new Error(`无效来源系统 ${value}`);
  return value;
}

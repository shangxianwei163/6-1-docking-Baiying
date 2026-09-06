import { randomUUID } from 'node:crypto';
import { and, count, countDistinct, eq, sql } from 'drizzle-orm';
import type { TaskExecutionStatus } from '@outbound/contracts';
import {
  moneyToMicros,
  microsToMoney,
  multiplyMoneyByInteger,
  negateMoney,
  normalizeMoney,
  subtractMoney,
} from '../billing/money.js';
import type { Database } from '../db/client.js';
import {
  accountLedger,
  callInstances,
  fundHolds,
  platformTasks,
  recordingAssets,
  studioAccounts,
  taskCallItems,
} from '../db/schema.js';
import type { DataProtector } from '../security/data-protector.js';
import {
  calculateBillingMinutes,
  normalizePhone,
  type BaiyingCallResult,
  type BaiyingJobResult,
  type NormalizedCallStatus,
  type ParsedBaiyingCallback,
} from './schema.js';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

type LockedTask = {
  id: string;
  taskNo: string;
  studioId: string;
  phoneCount: number;
  importSucceededCount: number;
  customerRate: string;
  executionStatus: TaskExecutionStatus;
  billingStatus: 'RESERVED' | 'SETTLING' | 'SETTLED' | 'FAILED';
  providerStatus: number | null;
};

type LockedHold = {
  id: string;
  remainingAmount: string;
  status: 'ACTIVE' | 'CAPTURED' | 'RELEASED';
};

type LockedAccount = {
  studioId: string;
  balance: string;
  activeHoldAmount: string;
  status: 'ACTIVE' | 'LOW_BALANCE' | 'OVERDUE' | 'DISABLED';
};

export type CallbackProcessingOutcome = {
  callbackType: ParsedBaiyingCallback['callbackType'];
  taskId: string;
  duplicate: boolean;
  settled: boolean;
};

export class CallbackTaskNotFoundError extends Error {}
export class CallbackItemNotFoundError extends Error {}
export class CallbackBusinessConflictError extends Error {}

export interface BaiyingCallbackProcessor {
  process(
    inboxId: string,
    callback: ParsedBaiyingCallback,
  ): Promise<CallbackProcessingOutcome>;
}

export class PostgresBaiyingCallbackProcessor implements BaiyingCallbackProcessor {
  private readonly lowBalanceThreshold: string;

  constructor(
    private readonly db: Database,
    private readonly protector: DataProtector,
    private readonly options: {
      lowBalanceThreshold?: string;
      clock?: () => Date;
      createId?: () => string;
    } = {},
  ) {
    this.lowBalanceThreshold = normalizeMoney(
      options.lowBalanceThreshold ?? '500.000000',
    );
  }

  async process(
    inboxId: string,
    callback: ParsedBaiyingCallback,
  ): Promise<CallbackProcessingOutcome> {
    return callback.callbackType === 'CALL_INSTANCE_RESULT'
      ? this.processCall(inboxId, callback)
      : this.processJob(callback);
  }

  private async processCall(
    inboxId: string,
    callback: BaiyingCallResult,
  ): Promise<CallbackProcessingOutcome> {
    return this.db.transaction(async (tx) => {
      const task = await lockTaskByProvider(
        tx,
        callback.companyId,
        callback.callJobId,
      );
      const now = this.clock();
      const [existing] = await tx
        .select({ id: callInstances.id, taskId: callInstances.taskId })
        .from(callInstances)
        .where(
          and(
            eq(callInstances.companyId, callback.companyId),
            eq(callInstances.callInstanceId, callback.callInstanceId),
          ),
        )
        .limit(1);
      if (existing) {
        if (existing.taskId !== task.id) {
          throw new CallbackBusinessConflictError(
            `通话 ${callback.callInstanceId} 已属于其他平台任务`,
          );
        }
        const recordingDiscovered = await storeFullRecording(
          tx,
          existing.id,
          callback.recordingUrls.full,
          this.protector,
          this.createId(),
          now,
        );
        if (recordingDiscovered) {
          await tx
            .update(platformTasks)
            .set({
              recordingDiscoveredCount: sql`${platformTasks.recordingDiscoveredCount} + 1`,
              recordingArchiveStatus: 'PENDING',
              recordingDeliveryStatus: 'PENDING',
              updatedAt: now,
              lockVersion: sql`${platformTasks.lockVersion} + 1`,
            })
            .where(eq(platformTasks.id, task.id));
        }
        return {
          callbackType: callback.callbackType,
          taskId: task.id,
          duplicate: true,
          settled: task.billingStatus === 'SETTLED',
        };
      }

      const item = await matchCallItem(tx, task.id, callback, this.protector);
      const billingMinutes = calculateBillingMinutes(callback.durationSeconds);
      const customerCharge = multiplyMoneyByInteger(
        task.customerRate,
        billingMinutes,
      );
      const callInstanceId = this.createId();
      await tx.insert(callInstances).values({
        id: callInstanceId,
        companyId: callback.companyId,
        callInstanceId: callback.callInstanceId,
        taskId: task.id,
        taskCallItemId: item.id,
        callbackInboxId: inboxId,
        callStatus: callback.callStatus,
        providerCallStatus: callback.callInstanceStatus,
        finishStatus: callback.finishStatus,
        calledTimes: callback.calledTimes,
        durationSeconds: callback.durationSeconds,
        billingMinutes,
        customerCharge,
        collectProperties: callback.collectProperties,
        providerOccurredAt: callback.providerOccurredAt,
        createdAt: now,
        updatedAt: now,
      });

      await settleCallCharge(tx, {
        task,
        callInstanceId,
        companyId: callback.companyId,
        providerCallInstanceId: callback.callInstanceId,
        customerCharge,
        lowBalanceThreshold: this.lowBalanceThreshold,
        now,
      });

      await tx
        .update(taskCallItems)
        .set({
          callStatus: aggregateCallStatus(item.callStatus, callback.callStatus),
          durationSeconds: sql`${taskCallItems.durationSeconds} + ${callback.durationSeconds}`,
          billingMinutes: sql`${taskCallItems.billingMinutes} + ${billingMinutes}`,
          customerCharge: sql`${taskCallItems.customerCharge} + ${customerCharge}::numeric`,
          updatedAt: now,
        })
        .where(eq(taskCallItems.id, item.id));

      const recordingDiscovered = await storeFullRecording(
        tx,
        callInstanceId,
        callback.recordingUrls.full,
        this.protector,
        this.createId(),
        now,
      );

      await tx
        .update(platformTasks)
        .set({
          callInstanceCount: sql`${platformTasks.callInstanceCount} + 1`,
          totalDurationSeconds: sql`${platformTasks.totalDurationSeconds} + ${callback.durationSeconds}`,
          billingMinutes: sql`${platformTasks.billingMinutes} + ${billingMinutes}`,
          customerCharge: sql`${platformTasks.customerCharge} + ${customerCharge}::numeric`,
          recordingDiscoveredCount: recordingDiscovered
            ? sql`${platformTasks.recordingDiscoveredCount} + 1`
            : platformTasks.recordingDiscoveredCount,
          recordingArchiveStatus: recordingDiscovered ? 'PENDING' : undefined,
          recordingDeliveryStatus: recordingDiscovered ? 'PENDING' : undefined,
          updatedAt: now,
          lockVersion: sql`${platformTasks.lockVersion} + 1`,
        })
        .where(eq(platformTasks.id, task.id));

      const settled = await tryFinalizeTask(
        tx,
        task.id,
        now,
        this.lowBalanceThreshold,
      );
      return {
        callbackType: callback.callbackType,
        taskId: task.id,
        duplicate: false,
        settled,
      };
    });
  }

  private async processJob(
    callback: BaiyingJobResult,
  ): Promise<CallbackProcessingOutcome> {
    return this.db.transaction(async (tx) => {
      const task = await lockTaskByProvider(
        tx,
        callback.companyId,
        callback.callJobId,
      );
      const now = this.clock();
      let settled = task.billingStatus === 'SETTLED';
      let changed = false;
      const terminal = isPlatformTerminal(task.executionStatus);

      if (callback.callJobStatus === 2 && !terminal) {
        await tx
          .update(platformTasks)
          .set({
            providerStatus: callback.callJobStatus,
            executionStatus: 'RECONCILING',
            billingStatus: 'SETTLING',
            providerCompletedAt: callback.providerOccurredAt ?? now,
            updatedAt: now,
            lockVersion: sql`${platformTasks.lockVersion} + 1`,
          })
          .where(eq(platformTasks.id, task.id));
        changed = true;
        settled = await tryFinalizeTask(
          tx,
          task.id,
          now,
          this.lowBalanceThreshold,
        );
      } else if (
        isProviderTermination(callback.callJobStatus) &&
        !terminal &&
        task.executionStatus !== 'RECONCILING'
      ) {
        await releaseRemainingHold(
          tx,
          task.id,
          task.studioId,
          now,
          this.lowBalanceThreshold,
        );
        const [stats] = await tx
          .select({ recordings: count(recordingAssets.id) })
          .from(recordingAssets)
          .innerJoin(
            callInstances,
            eq(recordingAssets.callInstanceId, callInstances.id),
          )
          .where(eq(callInstances.taskId, task.id));
        await tx
          .update(platformTasks)
          .set({
            providerStatus: callback.callJobStatus,
            executionStatus: 'TERMINATED',
            billingStatus: 'SETTLED',
            providerCompletedAt: callback.providerOccurredAt ?? now,
            reconciledAt: now,
            closedAt: now,
            recordingArchiveStatus:
              Number(stats?.recordings ?? 0) === 0
                ? 'NOT_AVAILABLE'
                : undefined,
            recordingDeliveryStatus:
              Number(stats?.recordings ?? 0) === 0
                ? 'NOT_APPLICABLE'
                : undefined,
            updatedAt: now,
            lockVersion: sql`${platformTasks.lockVersion} + 1`,
          })
          .where(eq(platformTasks.id, task.id));
        changed = true;
        settled = true;
      } else if (!terminal && task.executionStatus !== 'RECONCILING') {
        const nextStatus = statusFromProvider(
          task.executionStatus,
          callback.callJobStatus,
        );
        await tx
          .update(platformTasks)
          .set({
            providerStatus: callback.callJobStatus,
            executionStatus: nextStatus,
            updatedAt: now,
            lockVersion: sql`${platformTasks.lockVersion} + 1`,
          })
          .where(eq(platformTasks.id, task.id));
        changed = true;
      }

      return {
        callbackType: callback.callbackType,
        taskId: task.id,
        duplicate: !changed,
        settled,
      };
    });
  }

  private clock(): Date {
    return this.options.clock?.() ?? new Date();
  }

  private createId(): string {
    return this.options.createId?.() ?? randomUUID();
  }
}

async function storeFullRecording(
  tx: Transaction,
  callInstanceId: string,
  providerUrl: string | null,
  protector: DataProtector,
  recordingId: string,
  now: Date,
): Promise<boolean> {
  if (!providerUrl) return false;
  const [recording] = await tx
    .insert(recordingAssets)
    .values({
      id: recordingId,
      callInstanceId,
      kind: 'FULL',
      providerUrlCiphertext: protector.encryptUtf8(providerUrl),
      discoveredAt: now,
    })
    .onConflictDoNothing({
      target: [recordingAssets.callInstanceId, recordingAssets.kind],
    })
    .returning({ id: recordingAssets.id });
  return Boolean(recording);
}

async function matchCallItem(
  tx: Transaction,
  taskId: string,
  callback: BaiyingCallResult,
  protector: DataProtector,
): Promise<{
  id: string;
  callStatus: 'PENDING' | NormalizedCallStatus;
}> {
  if (callback.platformItemId) {
    const [item] = await tx
      .select({ id: taskCallItems.id, callStatus: taskCallItems.callStatus })
      .from(taskCallItems)
      .where(
        and(
          eq(taskCallItems.id, callback.platformItemId),
          eq(taskCallItems.taskId, taskId),
        ),
      )
      .limit(1)
      .catch((error: unknown) => {
        throw new CallbackItemNotFoundError(
          `sx_platform_item_id 无效：${errorMessage(error)}`,
        );
      });
    if (!item) {
      throw new CallbackItemNotFoundError(
        `sx_platform_item_id ${callback.platformItemId} 不属于当前任务`,
      );
    }
    return item;
  }

  if (!callback.customerTelephone) {
    throw new CallbackItemNotFoundError(
      '回调既没有 sx_platform_item_id，也没有可用于后备匹配的手机号',
    );
  }
  const phoneHmac = protector.phoneHmac(
    normalizePhone(callback.customerTelephone),
  );
  const matches = await tx
    .select({ id: taskCallItems.id, callStatus: taskCallItems.callStatus })
    .from(taskCallItems)
    .where(
      and(
        eq(taskCallItems.taskId, taskId),
        eq(taskCallItems.phoneHmac, phoneHmac),
      ),
    )
    .limit(2);
  if (matches.length !== 1) {
    throw new CallbackItemNotFoundError(
      matches.length
        ? '手机号后备匹配得到多条客户明细'
        : '手机号后备匹配未找到客户明细',
    );
  }
  return matches[0]!;
}

async function settleCallCharge(
  tx: Transaction,
  input: {
    task: LockedTask;
    callInstanceId: string;
    companyId: string;
    providerCallInstanceId: string;
    customerCharge: string;
    lowBalanceThreshold: string;
    now: Date;
  },
): Promise<void> {
  const hold = await lockHold(tx, input.task.id);
  const account = await lockAccount(tx, input.task.studioId);
  const chargeMicros = moneyToMicros(input.customerCharge);
  const remainingMicros =
    hold.status === 'ACTIVE' ? moneyToMicros(hold.remainingAmount) : 0n;
  const capturedMicros =
    chargeMicros < remainingMicros ? chargeMicros : remainingMicros;
  const overageMicros = chargeMicros - capturedMicros;
  const captured = microsToMoney(capturedMicros);
  const overage = microsToMoney(overageMicros);
  const remainingAfter = microsToMoney(remainingMicros - capturedMicros);
  const activeHoldAfter = subtractMoney(account.activeHoldAmount, captured);
  if (moneyToMicros(activeHoldAfter) < 0n) {
    throw new CallbackBusinessConflictError(
      `账户冻结汇总不足以捕获任务 ${input.task.taskNo} 的通话费用`,
    );
  }
  const balanceAfterCapture = subtractMoney(account.balance, captured);
  const balanceAfter = subtractMoney(balanceAfterCapture, overage);
  const availableAfter = subtractMoney(balanceAfter, activeHoldAfter);

  if (hold.status === 'ACTIVE' && capturedMicros > 0n) {
    await tx
      .update(fundHolds)
      .set({
        remainingAmount: remainingAfter,
        status: moneyToMicros(remainingAfter) === 0n ? 'CAPTURED' : 'ACTIVE',
      })
      .where(eq(fundHolds.id, hold.id));
  }

  await tx
    .update(studioAccounts)
    .set({
      balance: balanceAfter,
      activeHoldAmount: activeHoldAfter,
      status: accountStatus(
        balanceAfter,
        availableAfter,
        account.status,
        input.lowBalanceThreshold,
      ),
      lockVersion: sql`${studioAccounts.lockVersion} + 1`,
      updatedAt: input.now,
    })
    .where(eq(studioAccounts.studioId, account.studioId));

  await tx.insert(accountLedger).values({
    id: randomUUID(),
    studioId: input.task.studioId,
    taskId: input.task.id,
    callInstanceId: input.callInstanceId,
    entryType: 'CALL_CHARGE',
    amount: negateMoney(captured),
    balanceAfter: balanceAfterCapture,
    availableBalanceAfter: subtractMoney(balanceAfterCapture, activeHoldAfter),
    businessKey: `CALL_CHARGE:${input.companyId}:${input.providerCallInstanceId}`,
    reason: `逐通话结算；客户费用 ${normalizeMoney(input.customerCharge)}，冻结捕获 ${captured}`,
    occurredAt: input.now,
  });

  if (overageMicros > 0n) {
    await tx.insert(accountLedger).values({
      id: randomUUID(),
      studioId: input.task.studioId,
      taskId: input.task.id,
      callInstanceId: input.callInstanceId,
      entryType: 'OVERAGE_DEBIT',
      amount: negateMoney(overage),
      balanceAfter,
      availableBalanceAfter: availableAfter,
      businessKey: `OVERAGE_DEBIT:${input.companyId}:${input.providerCallInstanceId}`,
      reason: '实际通话费用超过任务剩余冻结金额',
      occurredAt: input.now,
    });
  }
}

async function tryFinalizeTask(
  tx: Transaction,
  taskId: string,
  now: Date,
  lowBalanceThreshold: string,
): Promise<boolean> {
  const task = await lockTaskById(tx, taskId);
  if (task.executionStatus === 'COMPLETED') return true;
  if (task.executionStatus !== 'RECONCILING') return false;
  const [stats] = await tx
    .select({
      calls: countDistinct(callInstances.taskCallItemId),
      recordings: count(recordingAssets.id),
    })
    .from(callInstances)
    .leftJoin(
      recordingAssets,
      eq(recordingAssets.callInstanceId, callInstances.id),
    )
    .where(eq(callInstances.taskId, taskId));
  const expected = task.importSucceededCount || task.phoneCount;
  if (Number(stats?.calls ?? 0) < expected) return false;

  await releaseRemainingHold(
    tx,
    taskId,
    task.studioId,
    now,
    lowBalanceThreshold,
  );
  const noRecordings = Number(stats?.recordings ?? 0) === 0;
  await tx
    .update(platformTasks)
    .set({
      executionStatus: 'COMPLETED',
      billingStatus: 'SETTLED',
      recordingArchiveStatus: noRecordings ? 'NOT_AVAILABLE' : undefined,
      recordingDeliveryStatus: noRecordings ? 'NOT_APPLICABLE' : undefined,
      reconciledAt: now,
      closedAt: now,
      updatedAt: now,
      lockVersion: sql`${platformTasks.lockVersion} + 1`,
    })
    .where(eq(platformTasks.id, taskId));
  return true;
}

async function releaseRemainingHold(
  tx: Transaction,
  taskId: string,
  studioId: string,
  now: Date,
  lowBalanceThreshold: string,
): Promise<void> {
  const hold = await lockHold(tx, taskId);
  if (hold.status !== 'ACTIVE') return;
  const remaining = normalizeMoney(hold.remainingAmount);
  const account = await lockAccount(tx, studioId);
  const activeHoldAfter = subtractMoney(account.activeHoldAmount, remaining);
  if (moneyToMicros(activeHoldAfter) < 0n) {
    throw new CallbackBusinessConflictError('账户冻结汇总小于任务待释放金额');
  }
  await tx
    .update(fundHolds)
    .set({ remainingAmount: '0.000000', status: 'RELEASED', releasedAt: now })
    .where(eq(fundHolds.id, hold.id));
  await tx
    .update(studioAccounts)
    .set({
      activeHoldAmount: activeHoldAfter,
      status: accountStatus(
        account.balance,
        subtractMoney(account.balance, activeHoldAfter),
        account.status,
        lowBalanceThreshold,
      ),
      lockVersion: sql`${studioAccounts.lockVersion} + 1`,
      updatedAt: now,
    })
    .where(eq(studioAccounts.studioId, account.studioId));
  await tx
    .insert(accountLedger)
    .values({
      studioId: account.studioId,
      taskId,
      entryType: 'TASK_HOLD_RELEASE',
      amount: remaining,
      balanceAfter: account.balance,
      availableBalanceAfter: subtractMoney(account.balance, activeHoldAfter),
      businessKey: `TASK_HOLD_RELEASE:${taskId}`,
      operatorId: 'callback-worker',
      reason: '百应任务终态对账后释放剩余冻结',
      occurredAt: now,
    })
    .onConflictDoNothing({ target: accountLedger.businessKey });
}

async function lockTaskByProvider(
  tx: Transaction,
  companyId: string,
  callJobId: string,
): Promise<LockedTask> {
  const rows = await tx.execute<LockedTask>(sql`
    SELECT
      ${platformTasks.id} AS "id",
      ${platformTasks.taskNo} AS "taskNo",
      ${platformTasks.studioId} AS "studioId",
      ${platformTasks.phoneCount} AS "phoneCount",
      ${platformTasks.importSucceededCount} AS "importSucceededCount",
      ${platformTasks.customerRate} AS "customerRate",
      ${platformTasks.executionStatus} AS "executionStatus",
      ${platformTasks.billingStatus} AS "billingStatus",
      ${platformTasks.providerStatus} AS "providerStatus"
    FROM ${platformTasks}
    WHERE ${platformTasks.baiyingCompanyId} = ${companyId}
      AND ${platformTasks.baiyingCallJobId} = ${callJobId}
    FOR UPDATE
  `);
  const task = rows[0];
  if (!task) {
    throw new CallbackTaskNotFoundError(
      `未找到百应任务 companyId=${companyId}, callJobId=${callJobId}`,
    );
  }
  return task;
}

async function lockTaskById(
  tx: Transaction,
  taskId: string,
): Promise<LockedTask> {
  const rows = await tx.execute<LockedTask>(sql`
    SELECT
      ${platformTasks.id} AS "id",
      ${platformTasks.taskNo} AS "taskNo",
      ${platformTasks.studioId} AS "studioId",
      ${platformTasks.phoneCount} AS "phoneCount",
      ${platformTasks.importSucceededCount} AS "importSucceededCount",
      ${platformTasks.customerRate} AS "customerRate",
      ${platformTasks.executionStatus} AS "executionStatus",
      ${platformTasks.billingStatus} AS "billingStatus",
      ${platformTasks.providerStatus} AS "providerStatus"
    FROM ${platformTasks}
    WHERE ${platformTasks.id} = ${taskId}
    FOR UPDATE
  `);
  const task = rows[0];
  if (!task) throw new CallbackTaskNotFoundError(`平台任务 ${taskId} 不存在`);
  return task;
}

async function lockHold(tx: Transaction, taskId: string): Promise<LockedHold> {
  const rows = await tx.execute<LockedHold>(sql`
    SELECT
      ${fundHolds.id} AS "id",
      ${fundHolds.remainingAmount} AS "remainingAmount",
      ${fundHolds.status} AS "status"
    FROM ${fundHolds}
    WHERE ${fundHolds.taskId} = ${taskId}
    FOR UPDATE
  `);
  const hold = rows[0];
  if (!hold) {
    throw new CallbackBusinessConflictError(`任务 ${taskId} 缺少资金冻结记录`);
  }
  return hold;
}

async function lockAccount(
  tx: Transaction,
  studioId: string,
): Promise<LockedAccount> {
  const rows = await tx.execute<LockedAccount>(sql`
    SELECT
      ${studioAccounts.studioId} AS "studioId",
      ${studioAccounts.balance} AS "balance",
      ${studioAccounts.activeHoldAmount} AS "activeHoldAmount",
      ${studioAccounts.status} AS "status"
    FROM ${studioAccounts}
    WHERE ${studioAccounts.studioId} = ${studioId}
    FOR UPDATE
  `);
  const account = rows[0];
  if (!account) {
    throw new CallbackBusinessConflictError(`影楼账户 ${studioId} 不存在`);
  }
  return account;
}

function statusFromProvider(
  current: TaskExecutionStatus,
  providerStatus: number,
): TaskExecutionStatus {
  if (isPlatformTerminal(current) || current === 'RECONCILING') return current;
  if (providerStatus === 1) return 'CALLING';
  if (providerStatus === 4 || providerStatus === 5) return 'PAUSED';
  // 未开始、调度中、排队中均不能把已进入 CALLING/PAUSED 的平台状态倒退。
  return current;
}

function isProviderTermination(status: number): boolean {
  return [6, 8, 9, 10, 11].includes(status);
}

function isPlatformTerminal(status: TaskExecutionStatus): boolean {
  return [
    'COMPLETED',
    'CREATE_FAILED',
    'IMPORT_FAILED',
    'START_FAILED',
    'CANCELLED',
    'TERMINATED',
  ].includes(status);
}

function aggregateCallStatus(
  current: 'PENDING' | NormalizedCallStatus,
  next: NormalizedCallStatus,
): NormalizedCallStatus {
  const rank: Record<'PENDING' | NormalizedCallStatus, number> = {
    PENDING: 0,
    UNKNOWN: 1,
    FAILED: 2,
    NO_ANSWER: 3,
    BUSY: 4,
    REJECTED: 5,
    ANSWERED: 6,
  };
  return rank[next] >= rank[current]
    ? next
    : current === 'PENDING'
      ? next
      : current;
}

function accountStatus(
  balance: string,
  available: string,
  current: LockedAccount['status'],
  lowBalanceThreshold: string,
): LockedAccount['status'] {
  if (current === 'DISABLED') return current;
  if (moneyToMicros(balance) < 0n) return 'OVERDUE';
  if (moneyToMicros(available) < moneyToMicros(lowBalanceThreshold)) {
    return 'LOW_BALANCE';
  }
  return 'ACTIVE';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

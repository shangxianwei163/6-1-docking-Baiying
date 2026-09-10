import { randomUUID, timingSafeEqual } from 'node:crypto';
import { and, count, countDistinct, eq, isNull, sql } from 'drizzle-orm';
import {
  callResultBatchEventSchema,
  outboundCallResultInternalEventV2Schema,
  taskCompletedEventSchema,
  type SourceSystem,
  type TaskExecutionStatus,
} from '@outbound/contracts';
import {
  moneyToMicros,
  microsToMoney,
  multiplyMoneyByInteger,
  negateMoney,
  normalizeMoney,
  subtractMoney,
} from '../billing/money.js';
import { nextTaskHoldReleaseBusinessKey } from '../billing/hold-cycle.js';
import type { Database } from '../db/client.js';
import {
  accountLedger,
  callInstances,
  fundHolds,
  platformTasks,
  queueOutbox,
  recordingAssets,
  studioAccounts,
  taskCallItems,
} from '../db/schema.js';
import { refreshTaskDeliverySummary } from '../delivery/postgres-repository.js';
import { refreshIntakeBatchLifecycle } from '../outbound-task/batch-lifecycle.js';
import type { DataProtector } from '../security/data-protector.js';
import { buildCallItemCorrelationToken } from '../security/correlation-token.js';
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
  batchId: string | null;
  contractVersion: string;
  taskNo: string;
  sourceSystem: string;
  mcCode: string;
  studioId: string;
  phoneCount: number;
  importSucceededCount: number;
  callInstanceCount: number;
  customerRate: string;
  baiyingCallJobId: string | null;
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
      deliveryQueueName?: string;
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

      const item = await matchCallItem(tx, task, callback, this.protector);
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
        taskResults: callback.taskResults,
        resultComplete: callback.resultComplete,
        matchMethod: item.matchMethod,
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

      if (task.contractVersion === '2.0') {
        const resultEventId = this.createId();
        const marked = await tx
          .update(taskCallItems)
          .set({ resultEventId, updatedAt: now })
          .where(
            and(
              eq(taskCallItems.id, item.id),
              isNull(taskCallItems.resultEventId),
            ),
          )
          .returning({ id: taskCallItems.id });
        if (marked.length) {
          const event = outboundCallResultInternalEventV2Schema.parse({
            schemaVersion: '2.1',
            eventId: resultEventId,
            eventType: 'OUTBOUND_CALL_RESULT_V2',
            occurredAt: now.toISOString(),
            sourceSystem: requireSourceSystem(task.sourceSystem),
            mcCode: task.mcCode,
            taskNo: task.taskNo,
            result: {
              event_id: resultEventId,
              event_type: 'OUTBOUND_CALL_RESULT',
              occurred_at: now.toISOString(),
              company_code: task.mcCode,
              batch_id: task.batchId,
              task_no: task.taskNo,
              customer: {
                guid: item.externalCustomerId,
                customer_name: item.customerNameCiphertext
                  ? this.protector.decryptUtf8(item.customerNameCiphertext)
                  : callback.customerName,
                phone_masked: maskPhoneForCallback(
                  this.protector.decryptUtf8(item.phoneCiphertext),
                ),
              },
              customer_result: {
                result_code: callback.customerResult.resultCode,
                result_text: callback.customerResult.resultText,
                contacted: callback.customerResult.contacted,
                intention_level: callback.customerResult.intentionLevel,
                intention_text: callback.customerResult.intentionText,
                summary: callback.customerResult.summary,
                follow_up_required: callback.customerResult.followUpRequired,
                recommended_action: callback.customerResult.recommendedAction,
                customer_concerns: callback.customerResult.customerConcerns,
                customer_tags: callback.customerResult.customerTags,
                collected_data: callback.customerResult.collectedData,
              },
              call: {
                status: callback.callStatus,
                status_text: callback.callStatusText,
                called_at: callback.calledAt?.toISOString() ?? null,
                duration_seconds: callback.durationSeconds,
              },
              conversation_logs: callback.conversationLogs,
              billing: {
                billing_minutes: billingMinutes,
                customer_charge: customerCharge,
                currency: 'CNY',
              },
            },
          });
          await tx.insert(queueOutbox).values({
            id: resultEventId,
            eventType: event.eventType,
            queueName: this.deliveryQueueName,
            payload: event,
            availableAt: now,
            createdAt: now,
          });
        }
      } else {
        const callEventId = this.createId();
        const expectedCalls = task.importSucceededCount || task.phoneCount;
        const callEvent = callResultBatchEventSchema.parse({
          schemaVersion: '1.0',
          eventId: callEventId,
          eventType: 'OUTBOUND_CALL_RESULT_BATCH',
          occurredAt: now.toISOString(),
          sourceSystem: requireSourceSystem(task.sourceSystem),
          mcCode: task.mcCode,
          taskNo: task.taskNo,
          baiyingCallJobId: callback.callJobId,
          batchNo: task.callInstanceCount + 1,
          isLastBatch:
            task.executionStatus === 'RECONCILING' &&
            task.callInstanceCount + 1 >= expectedCalls,
          calls: [
            {
              externalCustomerId: item.externalCustomerId,
              platformCallId: callInstanceId,
              baiyingCallInstanceId: callback.callInstanceId,
              phoneMasked: `*******${item.phoneTail4}`,
              callStatus: callback.callStatus,
              finishStatus: callback.finishStatus,
              durationSeconds: callback.durationSeconds,
              billingMinutes,
              customerCharge,
              collectProperties: legacyV1CollectProperties(callback),
            },
          ],
        });
        await tx.insert(queueOutbox).values({
          id: callEventId,
          eventType: callEvent.eventType,
          queueName: this.deliveryQueueName,
          payload: callEvent,
          availableAt: now,
          createdAt: now,
        });
      }

      const settled = await tryFinalizeTask(
        tx,
        task.id,
        now,
        this.lowBalanceThreshold,
        this.deliveryQueueName,
        () => this.createId(),
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
        await refreshIntakeBatchLifecycle(tx, task.batchId, now);
        changed = true;
        settled = await tryFinalizeTask(
          tx,
          task.id,
          now,
          this.lowBalanceThreshold,
          this.deliveryQueueName,
          () => this.createId(),
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
        if (task.contractVersion === '2.0') {
          await queueMissingV2FailureResults(
            tx,
            task,
            now,
            this.protector,
            this.deliveryQueueName,
          );
        }
        await refreshIntakeBatchLifecycle(tx, task.batchId, now);
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

  private get deliveryQueueName(): string {
    return this.options.deliveryQueueName ?? 'callback-delivery-queue';
  }
}

async function queueMissingV2FailureResults(
  tx: Transaction,
  task: LockedTask,
  now: Date,
  protector: DataProtector,
  deliveryQueueName: string,
): Promise<void> {
  const unresolved = await tx.execute<{
    externalCustomerId: string;
    phoneCiphertext: string;
    customerNameCiphertext: string | null;
    resultEventId: string;
  }>(sql`
    UPDATE ${taskCallItems}
    SET
      result_event_id = gen_random_uuid(),
      call_status = 'FAILED',
      updated_at = ${now}
    WHERE ${taskCallItems.taskId} = ${task.id}
      AND ${taskCallItems.resultEventId} IS NULL
    RETURNING
      ${taskCallItems.externalCustomerId} AS "externalCustomerId",
      ${taskCallItems.phoneCiphertext} AS "phoneCiphertext",
      ${taskCallItems.customerNameCiphertext} AS "customerNameCiphertext",
      ${taskCallItems.resultEventId} AS "resultEventId"
  `);
  const events = unresolved.map((item) => {
    const event = outboundCallResultInternalEventV2Schema.parse({
      schemaVersion: '2.1',
      eventId: item.resultEventId,
      eventType: 'OUTBOUND_CALL_RESULT_V2',
      occurredAt: now.toISOString(),
      sourceSystem: requireSourceSystem(task.sourceSystem),
      mcCode: task.mcCode,
      taskNo: task.taskNo,
      result: {
        event_id: item.resultEventId,
        event_type: 'OUTBOUND_CALL_RESULT',
        occurred_at: now.toISOString(),
        company_code: task.mcCode,
        batch_id: task.batchId,
        task_no: task.taskNo,
        customer: {
          guid: item.externalCustomerId,
          customer_name: item.customerNameCiphertext
            ? protector.decryptUtf8(item.customerNameCiphertext)
            : null,
          phone_masked: maskPhoneForCallback(
            protector.decryptUtf8(item.phoneCiphertext),
          ),
        },
        customer_result: failedCustomerResult(
          '百应任务已结束，但未取得该客户的完整通话结果。',
        ),
        call: {
          status: 'FAILED',
          status_text: '未取得通话结果',
          called_at: null,
          duration_seconds: 0,
        },
        conversation_logs: [],
        billing: {
          billing_minutes: 0,
          customer_charge: '0.000000',
          currency: 'CNY',
        },
      },
    });
    return {
      id: item.resultEventId,
      eventType: event.eventType,
      queueName: deliveryQueueName,
      payload: event,
      availableAt: now,
      createdAt: now,
    };
  });
  for (let offset = 0; offset < events.length; offset += 500) {
    await tx.insert(queueOutbox).values(events.slice(offset, offset + 500));
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
  task: Pick<LockedTask, 'id' | 'contractVersion'>,
  callback: BaiyingCallResult,
  protector: DataProtector,
): Promise<{
  id: string;
  callStatus: 'PENDING' | NormalizedCallStatus;
  externalCustomerId: string;
  phoneTail4: string;
  phoneHmac: string;
  phoneCiphertext: string;
  customerNameCiphertext: string | null;
  matchMethod: 'ITEM_TOKEN' | 'ITEM_PHONE' | 'PHONE_FALLBACK' | null;
}> {
  if (callback.platformItemId) {
    const [item] = await tx
      .select({
        id: taskCallItems.id,
        callStatus: taskCallItems.callStatus,
        externalCustomerId: taskCallItems.externalCustomerId,
        phoneTail4: taskCallItems.phoneTail4,
        phoneHmac: taskCallItems.phoneHmac,
        phoneCiphertext: taskCallItems.phoneCiphertext,
        customerNameCiphertext: taskCallItems.customerNameCiphertext,
      })
      .from(taskCallItems)
      .where(
        and(
          eq(taskCallItems.id, callback.platformItemId),
          eq(taskCallItems.taskId, task.id),
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
    const callbackPhoneHmac = callback.customerTelephone
      ? protector.phoneHmac(normalizePhone(callback.customerTelephone))
      : null;
    if (callbackPhoneHmac && callbackPhoneHmac !== item.phoneHmac) {
      throw new CallbackBusinessConflictError(
        `回调明细 ${callback.platformItemId} 与回调手机号不属于同一客户`,
      );
    }
    if (task.contractVersion === '2.0') {
      if (!callback.correlationToken) {
        throw new CallbackBusinessConflictError(
          `v2 回调明细 ${callback.platformItemId} 缺少 sx_correlation_token`,
        );
      }
      if (
        !verifyCallItemCorrelationToken(
          protector,
          task.id,
          item.id,
          item.phoneHmac,
          callback.correlationToken,
        )
      ) {
        throw new CallbackBusinessConflictError(
          `v2 回调明细 ${callback.platformItemId} 的关联签名无效`,
        );
      }
      return { ...item, matchMethod: 'ITEM_TOKEN' };
    }
    return {
      ...item,
      matchMethod: callbackPhoneHmac ? 'ITEM_PHONE' : null,
    };
  }

  if (task.contractVersion === '2.0') {
    throw new CallbackItemNotFoundError(
      'v2 回调缺少 sx_platform_item_id，禁止仅按手机号后备匹配',
    );
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
    .select({
      id: taskCallItems.id,
      callStatus: taskCallItems.callStatus,
      externalCustomerId: taskCallItems.externalCustomerId,
      phoneTail4: taskCallItems.phoneTail4,
      phoneHmac: taskCallItems.phoneHmac,
      phoneCiphertext: taskCallItems.phoneCiphertext,
      customerNameCiphertext: taskCallItems.customerNameCiphertext,
    })
    .from(taskCallItems)
    .where(
      and(
        eq(taskCallItems.taskId, task.id),
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
  return { ...matches[0]!, matchMethod: 'PHONE_FALLBACK' };
}

export function verifyCallItemCorrelationToken(
  protector: Pick<DataProtector, 'correlationHmac'>,
  taskId: string,
  itemId: string,
  phoneHmac: string,
  actualToken: string,
): boolean {
  const expectedToken = buildCallItemCorrelationToken(
    protector,
    taskId,
    itemId,
    phoneHmac,
  );
  return safeTokenEqual(actualToken, expectedToken);
}

function safeTokenEqual(actual: string, expected: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(actual) || !/^[a-f0-9]{64}$/i.test(expected)) {
    return false;
  }
  return timingSafeEqual(
    Buffer.from(actual, 'hex'),
    Buffer.from(expected, 'hex'),
  );
}

export function maskPhoneForCallback(phone: string): string {
  const normalized = normalizePhone(phone);
  if (normalized.length < 7) return '*'.repeat(normalized.length);
  return `${normalized.slice(0, 3)}${'*'.repeat(normalized.length - 7)}${normalized.slice(-4)}`;
}

function failedCustomerResult(summary: string) {
  return {
    result_code: 'CALL_FAILED' as const,
    result_text: '本次外呼失败',
    contacted: false,
    intention_level: null,
    intention_text: '外呼失败，无法判断',
    summary: summary.slice(0, 2_000),
    follow_up_required: true,
    recommended_action: '建议检查任务状态后重新发起外呼',
    customer_concerns: [],
    customer_tags: [],
    collected_data: {},
  };
}

export function legacyV1CollectProperties(
  callback: Pick<
    BaiyingCallResult,
    'importedProperties' | 'collectProperties' | 'taskResults'
  >,
): Record<string, unknown> {
  return {
    ...callback.importedProperties,
    ...callback.collectProperties,
    ...(callback.taskResults.length
      ? { taskResult: callback.taskResults }
      : {}),
  };
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
  deliveryQueueName: string,
  createId: () => string,
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
  await refreshIntakeBatchLifecycle(tx, task.batchId, now);
  if (task.contractVersion === '2.0') {
    // Per-number v2 results may all be delivered before the later job-complete
    // callback. Re-evaluate the aggregate once the task itself is terminal.
    await refreshTaskDeliverySummary(tx, taskId, 'RESULT', now);
    return true;
  }
  const [completed] = await tx.execute<{
    sourceSystem: string;
    mcCode: string;
    taskNo: string;
    baiyingCallJobId: string | null;
    phoneCount: number;
    importedCount: number;
    callInstanceCount: number;
    answeredCount: number;
    totalDurationSeconds: number;
    billingMinutes: number;
    customerCharge: string;
    recordingDiscoveredCount: number;
    recordingArchivedCount: number;
  }>(sql`
    SELECT
      task.source_system AS "sourceSystem",
      task.mc_code_snapshot AS "mcCode",
      task.task_no AS "taskNo",
      task.baiying_call_job_id AS "baiyingCallJobId",
      task.phone_count AS "phoneCount",
      task.import_succeeded_count AS "importedCount",
      task.call_instance_count AS "callInstanceCount",
      count(call.id) FILTER (WHERE call.call_status = 'ANSWERED')::int AS "answeredCount",
      task.total_duration_seconds AS "totalDurationSeconds",
      task.billing_minutes AS "billingMinutes",
      task.customer_charge AS "customerCharge",
      task.recording_discovered_count AS "recordingDiscoveredCount",
      task.recording_archived_count AS "recordingArchivedCount"
    FROM platform_task AS task
    LEFT JOIN call_instance AS call ON call.task_id = task.id
    WHERE task.id = ${taskId}
    GROUP BY task.id
  `);
  if (!completed?.baiyingCallJobId) {
    throw new CallbackBusinessConflictError(
      `任务 ${taskId} 完成时缺少百应任务 ID`,
    );
  }
  const eventId = createId();
  const event = taskCompletedEventSchema.parse({
    schemaVersion: '1.0',
    eventId,
    eventType: 'OUTBOUND_TASK_COMPLETED',
    occurredAt: now.toISOString(),
    sourceSystem: requireSourceSystem(completed.sourceSystem),
    mcCode: completed.mcCode,
    taskNo: completed.taskNo,
    baiyingCallJobId: completed.baiyingCallJobId,
    executionStatus: 'COMPLETED',
    summary: {
      phoneCount: completed.phoneCount,
      importedCount: completed.importedCount,
      callInstanceCount: completed.callInstanceCount,
      answeredCount: completed.answeredCount,
      totalDurationSeconds: completed.totalDurationSeconds,
      billingMinutes: completed.billingMinutes,
      customerCharge: completed.customerCharge,
      recordingDiscoveredCount: completed.recordingDiscoveredCount,
      recordingArchivedCount: completed.recordingArchivedCount,
    },
    completedAt: now.toISOString(),
  });
  await tx.insert(queueOutbox).values({
    id: eventId,
    eventType: event.eventType,
    queueName: deliveryQueueName,
    payload: event,
    availableAt: now,
    createdAt: now,
  });
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
      businessKey: await nextTaskHoldReleaseBusinessKey(tx, taskId),
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
      ${platformTasks.batchId} AS "batchId",
      ${platformTasks.contractVersion} AS "contractVersion",
      ${platformTasks.taskNo} AS "taskNo",
      ${platformTasks.sourceSystem} AS "sourceSystem",
      ${platformTasks.mcCodeSnapshot} AS "mcCode",
      ${platformTasks.studioId} AS "studioId",
      ${platformTasks.phoneCount} AS "phoneCount",
      ${platformTasks.importSucceededCount} AS "importSucceededCount",
      ${platformTasks.callInstanceCount} AS "callInstanceCount",
      ${platformTasks.customerRate} AS "customerRate",
      ${platformTasks.baiyingCallJobId} AS "baiyingCallJobId",
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
      ${platformTasks.batchId} AS "batchId",
      ${platformTasks.contractVersion} AS "contractVersion",
      ${platformTasks.taskNo} AS "taskNo",
      ${platformTasks.sourceSystem} AS "sourceSystem",
      ${platformTasks.mcCodeSnapshot} AS "mcCode",
      ${platformTasks.studioId} AS "studioId",
      ${platformTasks.phoneCount} AS "phoneCount",
      ${platformTasks.importSucceededCount} AS "importSucceededCount",
      ${platformTasks.callInstanceCount} AS "callInstanceCount",
      ${platformTasks.customerRate} AS "customerRate",
      ${platformTasks.baiyingCallJobId} AS "baiyingCallJobId",
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

function requireSourceSystem(value: string): SourceSystem {
  if (value === 'ERP' || value === 'CRM') return value;
  throw new CallbackBusinessConflictError(`任务来源系统无效：${value}`);
}

import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  outboundCallPageSchema,
  type CreateOutboundTaskRequest,
} from '@outbound/contracts';
import { LocalBaiyingCallJobClient } from '../baiying/local-call-job-client.js';
import { PostgresAccountRepository } from '../billing/postgres-repository.js';
import { addMoney, moneyToMicros, subtractMoney } from '../billing/money.js';
import { BaiyingCallbackIngressService } from '../callback/ingress-service.js';
import { PostgresBaiyingCallbackProcessor } from '../callback/processor.js';
import { PostgresCallbackInboxRepository } from '../callback/postgres-repository.js';
import { BaiyingCallbackWorker } from '../callback/worker.js';
import { readConfig } from '../config.js';
import { stableJsonSha256 } from '../openapi/request-hash.js';
import { PostgresTaskOrchestrationRepository } from '../orchestration/postgres-repository.js';
import { TaskOrchestrationService } from '../orchestration/service.js';
import { TaskOrchestrationWorker } from '../orchestration/worker.js';
import { PostgresOutboundTaskService } from '../outbound-task/service.js';
import { PostgresOutboxRepository } from '../outbox/postgres-repository.js';
import { LocalDataProtector } from '../security/data-protector.js';
import { bootstrapStage2Local } from './bootstrap-stage2-local.js';
import { createDatabase, type Database } from './client.js';
import {
  accountLedger,
  callInstances,
  callbackInbox,
  deadLetterEvents,
  fundHolds,
  idempotencyRecords,
  integrationClients,
  platformTasks,
  queueOutbox,
  recordingAssets,
  studioAccounts,
  studios,
  taskCallItems,
  taskMappingSnapshots,
  taskOperations,
} from './schema.js';

type AcceptedFixture = {
  taskId: string;
  taskNo: string;
  callJobId: string;
  itemIds: string[];
  phones: string[];
};

async function main() {
  const config = readConfig();
  if (config.NODE_ENV === 'production') {
    throw new Error('生产环境禁止运行 Stage 4 本地模拟回调验证');
  }
  const database = createDatabase(config.DATABASE_URL);
  const protector = new LocalDataProtector(
    config.WORKER_SHARED_SECRET,
    config.NODE_ENV,
  );
  const suffix = randomUUID();
  const queueName = `stage4-orchestration-${suffix}`;
  const deliveryQueueName = `stage4-delivery-${suffix}`;
  const tasks: AcceptedFixture[] = [];
  const inboxIds = new Set<string>();

  try {
    await bootstrapStage2Local(database.db);
    const [client] = await database.db
      .select({ id: integrationClients.id })
      .from(integrationClients)
      .where(eq(integrationClients.clientId, 'erp-local-01'))
      .limit(1);
    assert.ok(client, 'Stage 2 本地 ERP 客户端不存在');
    const [initialAccount] = await database.db
      .select({
        studioId: studioAccounts.studioId,
        balance: studioAccounts.balance,
        activeHoldAmount: studioAccounts.activeHoldAmount,
      })
      .from(studioAccounts)
      .innerJoin(studios, eq(studios.id, studioAccounts.studioId))
      .where(eq(studios.mcCode, 'MC-ZTY-001'))
      .limit(1);
    assert.ok(initialAccount, 'Stage 4 本地验证账户不存在');
    const principal = {
      integrationClientId: client.id,
      clientId: 'erp-local-01',
      sourceSystem: 'ERP' as const,
    };

    const intake = new PostgresOutboundTaskService(database.db, protector, {
      baiyingCompanyId: 'LOCAL-MOCK',
      queueName,
    });
    const orchestrationRepository = new PostgresTaskOrchestrationRepository(
      database.db,
      { deliveryQueueName },
    );
    const outbox = new PostgresOutboxRepository(database.db);
    const callbackRepository = new PostgresCallbackInboxRepository(
      database.db,
      {
        provider: `BAIYING_STAGE4_${suffix.slice(0, 8)}`,
      },
    );
    const ingress = new BaiyingCallbackIngressService(
      callbackRepository,
      protector,
    );
    const processor = new PostgresBaiyingCallbackProcessor(
      database.db,
      protector,
      { deliveryQueueName },
    );

    const acceptAndStart = async (
      label: string,
      phones: string[],
    ): Promise<AcceptedFixture> => {
      const request = createRequest(`${label}-${suffix}`, phones);
      const accepted = await intake.accept({
        principal,
        idempotencyKey: `stage4-${label}-${suffix}`,
        requestId: randomUUID(),
        requestHash: stableJsonSha256(request),
        request,
      });
      const orchestration = new TaskOrchestrationService(
        orchestrationRepository,
        new LocalBaiyingCallJobClient('SUCCESS'),
        protector,
      );
      const worker = new TaskOrchestrationWorker(outbox, orchestration, {
        queueName,
        workerId: `stage4-orchestration-${randomUUID().slice(0, 8)}`,
      });
      const result = await worker.runOnce();
      assert.equal(result.status, 'COMPLETED');
      const [task] = await database.db
        .select({
          id: platformTasks.id,
          taskNo: platformTasks.taskNo,
          callJobId: platformTasks.baiyingCallJobId,
          executionStatus: platformTasks.executionStatus,
        })
        .from(platformTasks)
        .where(eq(platformTasks.id, accepted.body.data.taskId))
        .limit(1);
      assert.ok(task?.callJobId);
      assert.equal(task.executionStatus, 'CALLING');
      const items = await database.db
        .select({ id: taskCallItems.id })
        .from(taskCallItems)
        .where(eq(taskCallItems.taskId, task.id))
        .orderBy(taskCallItems.ordinal);
      const fixture = {
        taskId: task.id,
        taskNo: task.taskNo,
        callJobId: task.callJobId,
        itemIds: items.map((item) => item.id),
        phones,
      };
      tasks.push(fixture);
      return fixture;
    };

    const ingest = async (rawBody: string) => {
      const result = await ingress.ingest({
        rawBody,
        headers: new Headers({
          'content-type': 'application/json;charset=utf-8',
          'user-agent': 'stage4-local-verifier',
          authorization: 'never-persist-this-header',
        }),
      });
      inboxIds.add(result.id);
      return result;
    };
    const process = async (eventKey: string, maxAttempts = 2) => {
      const worker = new BaiyingCallbackWorker(
        callbackRepository,
        processor,
        protector,
        {
          workerId: `stage4-callback-${randomUUID().slice(0, 8)}`,
          eventKey,
          maxAttempts,
          retryDelaysMs: [0],
        },
      );
      return worker.runOnce();
    };

    const standard = await acceptAndStart('standard', [
      '13900000001',
      '13900000002',
    ]);

    const completedJob = await ingest(jobCallback(standard.callJobId, 2));
    const completedJobResult = await process(completedJob.eventKey);
    assert.equal(completedJobResult.status, 'SUCCEEDED');
    assert.equal(completedJobResult.settled, false);
    await assertTask(database.db, standard.taskId, {
      executionStatus: 'RECONCILING',
      billingStatus: 'SETTLING',
      providerStatus: 2,
    });

    const firstCallRaw = callCallback({
      callJobId: standard.callJobId,
      callInstanceId: `CALL-${suffix}-1`,
      itemId: standard.itemIds[0],
      phone: standard.phones[0],
      finishStatus: 0,
      duration: 61,
      recordingUrl: 'https://recording.mock.invalid/stage4/full-1.mp3',
    });
    const firstCall = await ingest(firstCallRaw);
    assert.equal(firstCall.replayed, false);
    for (let index = 1; index < 16; index += 1) {
      const duplicate = await ingest(firstCallRaw);
      assert.equal(duplicate.replayed, true);
      assert.equal(duplicate.id, firstCall.id);
    }
    const firstCallResult = await process(firstCall.eventKey);
    assert.equal(firstCallResult.status, 'SUCCEEDED');
    assert.equal(firstCallResult.duplicate, false);
    const reformattedCall = await ingest(
      JSON.stringify(JSON.parse(firstCallRaw), null, 2),
    );
    assert.notEqual(reformattedCall.id, firstCall.id);
    const reformattedResult = await process(reformattedCall.eventKey);
    assert.equal(reformattedResult.status, 'SUCCEEDED');
    assert.equal(reformattedResult.duplicate, true);
    await assertTask(database.db, standard.taskId, {
      executionStatus: 'RECONCILING',
      billingStatus: 'SETTLING',
      providerStatus: 2,
      callInstanceCount: 1,
      billingMinutes: 2,
      customerCharge: '0.960000',
    });
    const duplicateRows = await database.db
      .select({ id: callbackInbox.id })
      .from(callbackInbox)
      .where(eq(callbackInbox.eventKey, firstCall.eventKey));
    assert.equal(duplicateRows.length, 1);
    const [storedRaw] = await database.db
      .select({
        raw: callbackInbox.rawBodyCiphertext,
        headers: callbackInbox.headers,
      })
      .from(callbackInbox)
      .where(eq(callbackInbox.id, firstCall.id));
    assert.ok(storedRaw);
    assert.equal(protector.decryptUtf8(storedRaw.raw), firstCallRaw);
    assert.ok(!storedRaw.raw.includes(standard.phones[0]!));
    assert.deepEqual(storedRaw.headers, {
      'content-type': 'application/json;charset=utf-8',
      'user-agent': 'stage4-local-verifier',
    });

    const staleJob = await ingest(jobCallback(standard.callJobId, 1));
    const staleResult = await process(staleJob.eventKey);
    assert.equal(staleResult.status, 'SUCCEEDED');
    assert.equal(staleResult.duplicate, true);
    await assertTask(database.db, standard.taskId, {
      executionStatus: 'RECONCILING',
      providerStatus: 2,
    });

    const secondCall = await ingest(
      callCallback({
        callJobId: standard.callJobId,
        callInstanceId: `CALL-${suffix}-2`,
        // Deliberately omit itemId to exercise the phone-HMAC fallback.
        phone: `+86${standard.phones[1]}`,
        finishStatus: 8,
        duration: 0,
      }),
    );
    const secondResult = await process(secondCall.eventKey);
    assert.equal(secondResult.status, 'SUCCEEDED');
    assert.equal(secondResult.settled, true);
    await assertTask(database.db, standard.taskId, {
      executionStatus: 'COMPLETED',
      billingStatus: 'SETTLED',
      providerStatus: 2,
      callInstanceCount: 2,
      billingMinutes: 2,
      customerCharge: '0.960000',
      recordingDiscoveredCount: 1,
    });
    await assertStandardSettlement(database.db, standard.taskId);
    const taskDetail = await intake.getTask(principal, standard.taskNo);
    assert.deepEqual(taskDetail.providerStatus, {
      code: 2,
      description: '已完成',
    });
    assert.equal(taskDetail.statuses.display, '执行完成');
    const firstPage = await intake.listCalls(principal, standard.taskNo, {
      limit: 1,
    });
    outboundCallPageSchema.parse(firstPage);
    assert.equal(firstPage.items.length, 1);
    assert.ok(firstPage.nextCursor);
    const secondPage = await intake.listCalls(principal, standard.taskNo, {
      limit: 1,
      cursor: firstPage.nextCursor,
    });
    outboundCallPageSchema.parse(secondPage);
    assert.equal(secondPage.items.length, 1);
    assert.equal(secondPage.nextCursor, null);
    assert.deepEqual(
      new Set(
        [...firstPage.items, ...secondPage.items].map(
          (call) => call.callStatus,
        ),
      ),
      new Set(['ANSWERED', 'NO_ANSWER']),
    );
    assert.ok(
      [...firstPage.items, ...secondPage.items].every(
        (call) => !call.phoneMasked.includes('139000000'),
      ),
    );

    const overage = await acceptAndStart('overage', ['13900000003']);
    const overageCall = await ingest(
      callCallback({
        callJobId: overage.callJobId,
        callInstanceId: `CALL-${suffix}-OVERAGE`,
        itemId: overage.itemIds[0],
        phone: overage.phones[0],
        finishStatus: 0,
        duration: 181,
      }),
    );
    assert.equal((await process(overageCall.eventKey)).status, 'SUCCEEDED');
    const lateRecording = await ingest(
      callCallback({
        callJobId: overage.callJobId,
        callInstanceId: `CALL-${suffix}-OVERAGE`,
        itemId: overage.itemIds[0],
        phone: overage.phones[0],
        finishStatus: 0,
        duration: 181,
        recordingUrl: 'https://recording.mock.invalid/stage4/late-full.mp3',
      }),
    );
    const lateRecordingResult = await process(lateRecording.eventKey);
    assert.equal(lateRecordingResult.status, 'SUCCEEDED');
    assert.equal(lateRecordingResult.duplicate, true);
    const overageJob = await ingest(jobCallback(overage.callJobId, 2));
    const overageResult = await process(overageJob.eventKey);
    assert.equal(overageResult.status, 'SUCCEEDED');
    assert.equal(overageResult.settled, true);
    await assertTask(database.db, overage.taskId, {
      executionStatus: 'COMPLETED',
      billingStatus: 'SETTLED',
      callInstanceCount: 1,
      billingMinutes: 4,
      customerCharge: '1.920000',
      recordingDiscoveredCount: 1,
    });
    await assertOverageSettlement(database.db, overage.taskId);
    const [settledAccount] = await database.db
      .select({
        balance: studioAccounts.balance,
        activeHoldAmount: studioAccounts.activeHoldAmount,
      })
      .from(studioAccounts)
      .where(eq(studioAccounts.studioId, initialAccount.studioId));
    assert.equal(
      settledAccount?.balance,
      subtractMoney(initialAccount.balance, '2.880000'),
    );
    assert.equal(
      settledAccount?.activeHoldAmount,
      initialAccount.activeHoldAmount,
    );

    const unknownTask = await ingest(jobCallback(`UNKNOWN-${suffix}`, 2));
    const unknownResult = await process(unknownTask.eventKey, 1);
    assert.equal(unknownResult.status, 'DEAD_LETTERED');
    await assertDeadLetter(database.db, unknownTask.id, 'VALID');

    const invalid = await ingest(`{"stage4InvalidProbe":"${suffix}"`);
    const invalidResult = await process(invalid.eventKey);
    assert.deepEqual(invalidResult, {
      status: 'REJECTED',
      inboxId: invalid.id,
      parseStatus: 'INVALID',
    });
    await assertDeadLetter(database.db, invalid.id, 'INVALID');

    const unsupported = await ingest(
      JSON.stringify({
        data: { callbackType: 'FUTURE_CALLBACK', data: {} },
      }),
    );
    const concurrentClaims = await Promise.all([
      callbackRepository.claimNext({
        workerId: 'stage4-concurrent-a',
        eventKey: unsupported.eventKey,
      }),
      callbackRepository.claimNext({
        workerId: 'stage4-concurrent-b',
        eventKey: unsupported.eventKey,
      }),
    ]);
    const winner = concurrentClaims.find((claim) => claim !== null);
    assert.ok(winner);
    assert.equal(concurrentClaims.filter(Boolean).length, 1);
    const winnerId = concurrentClaims[0]
      ? 'stage4-concurrent-a'
      : 'stage4-concurrent-b';
    await callbackRepository.reject({
      inboxId: unsupported.id,
      workerId: winnerId,
      parseStatus: 'UNKNOWN_TYPE',
      error: 'Stage 4 验证：不支持的回调类型',
    });
    await assertDeadLetter(database.db, unsupported.id, 'UNKNOWN_TYPE');

    const staleLock = await ingest(
      JSON.stringify({
        data: { callbackType: 'ANOTHER_FUTURE_CALLBACK', data: {} },
      }),
    );
    const staleClaim = await callbackRepository.claimNext({
      workerId: 'stage4-stale-worker',
      eventKey: staleLock.eventKey,
    });
    assert.ok(staleClaim);
    await database.db
      .update(callbackInbox)
      .set({ lockedAt: new Date(0) })
      .where(eq(callbackInbox.id, staleLock.id));
    const recovered = await callbackRepository.claimNext({
      workerId: 'stage4-recovery-worker',
      eventKey: staleLock.eventKey,
      lockTimeoutSeconds: 1,
    });
    assert.equal(recovered?.processAttempts, 2);
    await callbackRepository.reject({
      inboxId: staleLock.id,
      workerId: 'stage4-recovery-worker',
      parseStatus: 'UNKNOWN_TYPE',
      error: 'Stage 4 验证：恢复超时锁后隔离未知类型',
    });
    await assertDeadLetter(database.db, staleLock.id, 'UNKNOWN_TYPE');

    console.info(
      JSON.stringify(
        {
          status: 'passed',
          mode: 'LOCAL_MOCK_NO_NETWORK',
          checks: [
            '回调原始正文加密落库后才 ACK，敏感请求头不保存',
            '同一回调重复投递 16 次仅保留一个 Inbox 并只计费一次',
            'JOB_INFO_RESULT 先到时进入 RECONCILING，后到的旧状态不会倒退',
            '优先使用 sx_platform_item_id，缺失时用手机号 HMAC 后备匹配',
            '61 秒逐通话计为 2 分钟，未接通 0 秒计为 0 分钟',
            '任务完成后捕获实际费用并释放剩余冻结',
            '实际费用超过冻结时生成 OVERAGE_DEBIT 且账务平衡',
            '录音临时 URL 只加密保存，不发起任何下载请求',
            '未知任务有界重试后进入死信，非法和未知类型回调直接隔离',
            '并发 Worker 只能领取一次，同一 Inbox 的超时处理锁可恢复',
          ],
          verifiedTaskCount: tasks.length,
          verifiedInboxCount: inboxIds.size,
        },
        null,
        2,
      ),
    );
  } finally {
    await cleanup(database.db, tasks, [...inboxIds]);
    await database.close();
  }
}

function createRequest(
  externalRequestId: string,
  phones: string[],
): CreateOutboundTaskRequest {
  return {
    schemaVersion: '1.0',
    externalRequestId,
    sourceSystem: 'ERP',
    mcCode: 'MC-ZTY-001',
    taskName: `Stage 4 本地回调验证 ${externalRequestId}`,
    customers: phones.map((phone, index) => ({
      externalCustomerId: `${externalRequestId}-customer-${index + 1}`,
      name: `Stage4验证客户${index + 1}`,
      phone,
      dataCategoryId: 'LOCAL-ERP-WEDDING',
      fields: {
        salutation: `第${index + 1}位客户`,
        appointment_date: '2026-09-20',
        consultant_name: '本地顾问',
      },
    })),
  };
}

function jobCallback(callJobId: string, callJobStatus: number): string {
  return JSON.stringify({
    code: 200,
    data: {
      callbackType: 'JOB_INFO_RESULT',
      data: {
        companyId: 'LOCAL-MOCK',
        callJobId,
        callJobStatus,
        updateTime: '2026-09-06 18:00:00',
      },
    },
    resultMsg: '成功',
  });
}

function callCallback(input: {
  callJobId: string;
  callInstanceId: string;
  itemId?: string;
  phone: string;
  finishStatus: number;
  duration: number;
  recordingUrl?: string;
}): string {
  return JSON.stringify({
    code: 200,
    data: {
      callbackType: 'CALL_INSTANCE_RESULT',
      data: {
        callInstance: {
          companyId: 'LOCAL-MOCK',
          callJobId: input.callJobId,
          callInstanceId: input.callInstanceId,
          callInstanceStatus: 2,
          finishStatus: input.finishStatus,
          calledTimes: 1,
          customerTelephone: input.phone,
          duration: input.duration,
          properties: input.itemId
            ? { sx_platform_item_id: input.itemId, intention: 'A' }
            : { intention: 'B' },
          endTime: '2026-09-06 18:05:00',
          ...(input.recordingUrl ? { luyinOssUrl: input.recordingUrl } : {}),
        },
        taskResult: [{ key: 'intention', value: 'A' }],
      },
    },
    resultMsg: '成功',
  });
}

async function assertTask(
  db: Database,
  taskId: string,
  expected: Partial<typeof platformTasks.$inferSelect>,
) {
  const [task] = await db
    .select()
    .from(platformTasks)
    .where(eq(platformTasks.id, taskId))
    .limit(1);
  assert.ok(task);
  assert.partialDeepStrictEqual(task, expected);
}

async function assertStandardSettlement(db: Database, taskId: string) {
  const [hold] = await db
    .select()
    .from(fundHolds)
    .where(eq(fundHolds.taskId, taskId));
  assert.equal(hold?.originalAmount, '1.920000');
  assert.equal(hold?.remainingAmount, '0.000000');
  assert.equal(hold?.status, 'RELEASED');
  const ledger = await db
    .select()
    .from(accountLedger)
    .where(eq(accountLedger.taskId, taskId));
  assert.equal(
    ledger.filter((entry) => entry.entryType === 'CALL_CHARGE').length,
    2,
  );
  assert.equal(
    ledger.filter((entry) => entry.entryType === 'TASK_HOLD_RELEASE').length,
    1,
  );
  assert.equal(
    ledger.find((entry) => entry.entryType === 'TASK_HOLD_RELEASE')?.amount,
    '0.960000',
  );
  assert.equal(
    ledger.filter((entry) => entry.entryType === 'OVERAGE_DEBIT').length,
    0,
  );
  const calls = await db
    .select()
    .from(callInstances)
    .where(eq(callInstances.taskId, taskId));
  assert.equal(calls.length, 2);
  assert.deepEqual(
    new Set(calls.map((call) => call.callStatus)),
    new Set(['ANSWERED', 'NO_ANSWER']),
  );
  const recordings = await db
    .select()
    .from(recordingAssets)
    .innerJoin(
      callInstances,
      eq(recordingAssets.callInstanceId, callInstances.id),
    )
    .where(eq(callInstances.taskId, taskId));
  assert.equal(recordings.length, 1);
}

async function assertOverageSettlement(db: Database, taskId: string) {
  const [hold] = await db
    .select()
    .from(fundHolds)
    .where(eq(fundHolds.taskId, taskId));
  assert.equal(hold?.originalAmount, '0.960000');
  assert.equal(hold?.remainingAmount, '0.000000');
  assert.equal(hold?.status, 'CAPTURED');
  const ledger = await db
    .select()
    .from(accountLedger)
    .where(eq(accountLedger.taskId, taskId));
  assert.equal(
    ledger.find((entry) => entry.entryType === 'CALL_CHARGE')?.amount,
    '-0.960000',
  );
  assert.equal(
    ledger.find((entry) => entry.entryType === 'OVERAGE_DEBIT')?.amount,
    '-0.960000',
  );
  assert.equal(
    ledger.filter((entry) => entry.entryType === 'TASK_HOLD_RELEASE').length,
    0,
  );
}

async function assertDeadLetter(
  db: Database,
  inboxId: string,
  parseStatus: 'VALID' | 'INVALID' | 'UNKNOWN_TYPE',
) {
  const [inbox] = await db
    .select()
    .from(callbackInbox)
    .where(eq(callbackInbox.id, inboxId));
  assert.equal(inbox?.parseStatus, parseStatus);
  assert.equal(inbox?.processStatus, 'FAILED');
  assert.ok(inbox?.deadLetteredAt);
  const [deadLetter] = await db
    .select()
    .from(deadLetterEvents)
    .where(
      and(
        eq(deadLetterEvents.sourceType, 'CALLBACK'),
        eq(deadLetterEvents.sourceId, inboxId),
      ),
    );
  assert.equal(deadLetter?.status, 'OPEN');
  assert.ok(!JSON.stringify(deadLetter?.originalEvent).includes('139000000'));
}

async function cleanup(
  db: Database,
  tasks: AcceptedFixture[],
  inboxIds: string[],
) {
  const taskIds = tasks.map((task) => task.taskId);
  let refund = '0.000000';
  if (taskIds.length) {
    const taskRows = await db
      .select({
        id: platformTasks.id,
        customerCharge: platformTasks.customerCharge,
      })
      .from(platformTasks)
      .where(inArray(platformTasks.id, taskIds));
    refund = taskRows.reduce(
      (total, task) => addMoney(total, task.customerCharge),
      refund,
    );
    const accountRepository = new PostgresAccountRepository(db);
    for (const task of taskRows) {
      const [hold] = await db
        .select({ status: fundHolds.status })
        .from(fundHolds)
        .where(eq(fundHolds.taskId, task.id));
      if (hold?.status === 'ACTIVE') {
        await accountRepository.releaseHold({
          taskId: task.id,
          operatorId: 'stage4-verifier',
          reason: 'Stage 4 验证清理剩余冻结',
        });
      }
    }
  }

  await db.transaction(async (tx) => {
    const callIds = taskIds.length
      ? (
          await tx
            .select({ id: callInstances.id })
            .from(callInstances)
            .where(inArray(callInstances.taskId, taskIds))
        ).map((call) => call.id)
      : [];
    const outboxIdSet = new Set<string>();
    for (const task of tasks) {
      const events = await tx
        .select({ id: queueOutbox.id })
        .from(queueOutbox)
        .where(
          sql`${queueOutbox.payload}->>'taskId' = ${task.taskId} or ${queueOutbox.payload}->>'taskNo' = ${task.taskNo}`,
        );
      for (const event of events) outboxIdSet.add(event.id);
    }
    const outboxIds = [...outboxIdSet];
    const deadLetterSourceIds = [...inboxIds, ...outboxIds];
    if (deadLetterSourceIds.length) {
      await tx
        .delete(deadLetterEvents)
        .where(inArray(deadLetterEvents.sourceId, deadLetterSourceIds));
    }
    if (callIds.length) {
      await tx
        .delete(recordingAssets)
        .where(inArray(recordingAssets.callInstanceId, callIds));
    }
    if (taskIds.length) {
      await tx
        .delete(accountLedger)
        .where(inArray(accountLedger.taskId, taskIds));
      await tx
        .delete(callInstances)
        .where(inArray(callInstances.taskId, taskIds));
      await tx
        .delete(idempotencyRecords)
        .where(inArray(idempotencyRecords.taskId, taskIds));
      await tx
        .delete(taskOperations)
        .where(inArray(taskOperations.taskId, taskIds));
      if (outboxIds.length) {
        await tx.delete(queueOutbox).where(inArray(queueOutbox.id, outboxIds));
      }
      await tx.delete(fundHolds).where(inArray(fundHolds.taskId, taskIds));
      await tx
        .delete(taskMappingSnapshots)
        .where(inArray(taskMappingSnapshots.taskId, taskIds));
      await tx
        .delete(taskCallItems)
        .where(inArray(taskCallItems.taskId, taskIds));
      await tx.delete(platformTasks).where(inArray(platformTasks.id, taskIds));
    }
    if (inboxIds.length) {
      await tx.delete(callbackInbox).where(inArray(callbackInbox.id, inboxIds));
    }
    if (moneyToMicros(refund) > 0n) {
      const [localAccount] = await tx.execute<{
        studioId: string;
        balance: string;
        activeHoldAmount: string;
        status: 'ACTIVE' | 'LOW_BALANCE' | 'OVERDUE' | 'DISABLED';
      }>(sql`
        SELECT
          account.studio_id AS "studioId",
          account.balance AS "balance",
          account.active_hold_amount AS "activeHoldAmount",
          account.status AS "status"
        FROM studio_account AS account
        INNER JOIN studio ON studio.id = account.studio_id
        WHERE studio.mc_code = 'MC-ZTY-001'
        FOR UPDATE OF account
      `);
      assert.ok(localAccount);
      const balance = addMoney(localAccount.balance, refund);
      const available = subtractMoney(balance, localAccount.activeHoldAmount);
      await tx
        .update(studioAccounts)
        .set({
          balance,
          status:
            localAccount.status === 'DISABLED'
              ? 'DISABLED'
              : moneyToMicros(balance) < 0n
                ? 'OVERDUE'
                : moneyToMicros(available) < moneyToMicros('500.000000')
                  ? 'LOW_BALANCE'
                  : 'ACTIVE',
          lockVersion: sql`${studioAccounts.lockVersion} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(studioAccounts.studioId, localAccount.studioId));
    }
  });
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

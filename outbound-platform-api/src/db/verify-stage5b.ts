import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  outboundCallbackEventSchema,
  type CreateOutboundTaskRequest,
} from '@outbound/contracts';
import { LocalBaiyingCallJobClient } from '../baiying/local-call-job-client.js';
import { addMoney, moneyToMicros, subtractMoney } from '../billing/money.js';
import { PostgresAccountRepository } from '../billing/postgres-repository.js';
import { BaiyingCallbackIngressService } from '../callback/ingress-service.js';
import { PostgresBaiyingCallbackProcessor } from '../callback/processor.js';
import { PostgresCallbackInboxRepository } from '../callback/postgres-repository.js';
import { BaiyingCallbackWorker } from '../callback/worker.js';
import { readConfig } from '../config.js';
import { DeliveryOutboxProjector } from '../delivery/outbox-projector.js';
import { PostgresDeliveryRepository } from '../delivery/postgres-repository.js';
import { PostgresRecordingDeliveryEventBuilder } from '../delivery/recording-event-builder.js';
import { LocalNoNetworkDeliveryTransport } from '../delivery/transport.js';
import { CallbackDeliveryWorker } from '../delivery/worker.js';
import { PostgresRecoveryOperationsService } from '../operations/recovery-service.js';
import { stableJsonSha256 } from '../openapi/request-hash.js';
import { PostgresTaskOrchestrationRepository } from '../orchestration/postgres-repository.js';
import { TaskOrchestrationService } from '../orchestration/service.js';
import { TaskOrchestrationWorker } from '../orchestration/worker.js';
import { PostgresOutboundTaskService } from '../outbound-task/service.js';
import { PostgresOutboxRepository } from '../outbox/postgres-repository.js';
import { RecordingAccessService } from '../recording/access-service.js';
import { RecordingArchiveService } from '../recording/archive-service.js';
import { LocalFixtureRecordingSource } from '../recording/local-fixture-source.js';
import { LocalRecordingObjectStore } from '../recording/local-object-store.js';
import { PostgresRecordingAccessRepository } from '../recording/postgres-access-repository.js';
import { PostgresRecordingArchiveRepository } from '../recording/postgres-repository.js';
import { PostgresRecordingUrlReissueService } from '../recording/reissue-service.js';
import { LocalRecordingUrlSigner } from '../recording/url-signer.js';
import { RecordingArchiveWorker } from '../recording/worker.js';
import { LocalDataProtector } from '../security/data-protector.js';
import { LocalDevelopmentSecretProvider } from '../security/secret-provider.js';
import { bootstrapStage2Local } from './bootstrap-stage2-local.js';
import { createDatabase, type Database } from './client.js';
import {
  accountLedger,
  auditLogs,
  callbackInbox,
  callInstances,
  deadLetterEvents,
  deliveryAttempts,
  deliveryEvents,
  fundHolds,
  idempotencyRecords,
  integrationClients,
  platformTasks,
  queueOutbox,
  recordingAssets,
  recordingUrlIssues,
  studioAccounts,
  taskCallItems,
  taskMappingSnapshots,
  taskOperations,
} from './schema.js';

async function main() {
  const config = readConfig();
  if (config.NODE_ENV === 'production') {
    throw new Error('生产环境禁止运行 Stage 5B 本地零网络投递验证');
  }
  const database = createDatabase(config.DATABASE_URL);
  const protector = new LocalDataProtector(
    config.WORKER_SHARED_SECRET,
    config.NODE_ENV,
  );
  const secrets = new LocalDevelopmentSecretProvider(
    config.WORKER_SHARED_SECRET,
    config.NODE_ENV,
  );
  const suffix = randomUUID();
  const provider = `BAIYING_STAGE5B_${suffix.slice(0, 8)}`;
  const orchestrationQueue = `stage5b-orchestration-${suffix}`;
  const deliveryQueue = `stage5b-delivery-${suffix}`;
  const callbackIds: string[] = [];
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'stage5b-recordings-'));
  let taskId: string | undefined;
  let taskNo: string | undefined;

  try {
    await bootstrapStage2Local(database.db);
    const [client] = await database.db
      .select({ id: integrationClients.id })
      .from(integrationClients)
      .where(eq(integrationClients.clientId, 'erp-local-01'))
      .limit(1);
    assert.ok(client, 'Stage 2 本地 ERP 客户端不存在');
    const principal = {
      integrationClientId: client.id,
      clientId: 'erp-local-01',
      sourceSystem: 'ERP' as const,
    };
    const request = createRequest(suffix);
    const intake = new PostgresOutboundTaskService(database.db, protector, {
      baiyingCompanyId: 'LOCAL-MOCK',
      queueName: orchestrationQueue,
    });
    const accepted = await intake.accept({
      principal,
      idempotencyKey: `stage5b-${suffix}`,
      requestId: randomUUID(),
      requestHash: stableJsonSha256(request),
      request,
    });
    taskId = accepted.body.data.taskId;
    taskNo = accepted.body.data.taskNo;

    const outbox = new PostgresOutboxRepository(database.db);
    const orchestrationWorker = new TaskOrchestrationWorker(
      outbox,
      new TaskOrchestrationService(
        new PostgresTaskOrchestrationRepository(database.db, {
          deliveryQueueName: deliveryQueue,
        }),
        new LocalBaiyingCallJobClient('SUCCESS'),
        protector,
      ),
      {
        queueName: orchestrationQueue,
        workerId: `stage5b-orchestration-${suffix.slice(0, 8)}`,
      },
    );
    assert.equal((await orchestrationWorker.runOnce()).status, 'COMPLETED');
    const [task] = await database.db
      .select({ callJobId: platformTasks.baiyingCallJobId })
      .from(platformTasks)
      .where(eq(platformTasks.id, taskId));
    const [item] = await database.db
      .select({ id: taskCallItems.id })
      .from(taskCallItems)
      .where(eq(taskCallItems.taskId, taskId));
    assert.ok(task?.callJobId && item);

    const callbackRepository = new PostgresCallbackInboxRepository(
      database.db,
      { provider },
    );
    const ingress = new BaiyingCallbackIngressService(
      callbackRepository,
      protector,
    );
    const callbackProcessor = new PostgresBaiyingCallbackProcessor(
      database.db,
      protector,
      { deliveryQueueName: deliveryQueue },
    );
    const processCallback = async (rawBody: string) => {
      const stored = await ingress.ingest({
        rawBody,
        headers: new Headers({ 'content-type': 'application/json' }),
      });
      callbackIds.push(stored.id);
      const callbackWorker = new BaiyingCallbackWorker(
        callbackRepository,
        callbackProcessor,
        protector,
        {
          workerId: `stage5b-callback-${randomUUID().slice(0, 8)}`,
          eventKey: stored.eventKey,
          retryDelaysMs: [0],
        },
      );
      assert.equal((await callbackWorker.runOnce()).status, 'SUCCEEDED');
    };

    await processCallback(
      callCallback({
        callJobId: task.callJobId,
        itemId: item.id,
        callInstanceId: `STAGE5B-CALL-${suffix}`,
        recordingUrl: `https://recording.mock.invalid/stage5b/${suffix}/full.mp3?temporary-token=never-log`,
      }),
    );
    await processCallback(jobCallback(task.callJobId));

    const [recording] = await database.db
      .select({ id: recordingAssets.id })
      .from(recordingAssets)
      .innerJoin(
        callInstances,
        eq(recordingAssets.callInstanceId, callInstances.id),
      )
      .where(eq(callInstances.taskId, taskId));
    assert.ok(recording);
    const objectStore = new LocalRecordingObjectStore(temporaryRoot);
    const archiveWorker = new RecordingArchiveWorker(
      new PostgresRecordingArchiveRepository(
        database.db,
        () => new Date(),
        deliveryQueue,
      ),
      new RecordingArchiveService(
        protector,
        new LocalFixtureRecordingSource(),
        objectStore,
        {
          bucket: 'local-recordings',
          maxBytes: 1_024 * 1_024,
          retentionDays: 180,
        },
      ),
      {
        workerId: `stage5b-recording-${suffix.slice(0, 8)}`,
        recordingId: recording.id,
      },
    );
    assert.equal((await archiveWorker.runOnce()).status, 'ARCHIVED');

    const recordingUrlSigner = new LocalRecordingUrlSigner(
      config.WORKER_SHARED_SECRET,
      config.NODE_ENV,
    );
    const recordingAccess = new RecordingAccessService(
      new PostgresRecordingAccessRepository(database.db),
      objectStore,
      recordingUrlSigner,
      {
        publicBaseUrl: config.RECORDING_CALLBACK_BASE_URL,
        ttlSeconds: config.RECORDING_DOWNLOAD_TTL_SECONDS,
        environment: config.NODE_ENV,
      },
    );
    const deliveryRepository = new PostgresDeliveryRepository(database.db);
    const projector = new DeliveryOutboxProjector(
      outbox,
      deliveryRepository,
      new PostgresRecordingDeliveryEventBuilder(database.db, recordingAccess),
      {
        queueName: deliveryQueue,
        workerId: `stage5b-projector-${suffix.slice(0, 8)}`,
        retryDelaysMs: [0],
      },
    );
    const projected = [];
    for (let index = 0; index < 10; index += 1) {
      const result = await projector.runOnce();
      if (result.status === 'IDLE') break;
      assert.equal(result.status, 'MATERIALIZED');
      projected.push(result);
    }
    assert.equal(projected.length, 4);

    const eventRows = await database.db
      .select()
      .from(deliveryEvents)
      .where(eq(deliveryEvents.taskId, taskId));
    assert.deepEqual(
      new Set(eventRows.map((event) => event.eventType)),
      new Set([
        'OUTBOUND_TASK_STARTED',
        'OUTBOUND_CALL_RESULT_BATCH',
        'OUTBOUND_TASK_COMPLETED',
        'OUTBOUND_RECORDING_AVAILABLE_BATCH',
      ]),
    );
    for (const event of eventRows) {
      outboundCallbackEventSchema.parse(event.payload);
      assert.ok(!event.targetUrlSnapshot.includes('temporary-token'));
    }

    const receiverAttempts = new Map<string, number>();
    const receiver = new LocalNoNetworkDeliveryTransport({
      environment: config.NODE_ENV,
      allowedHosts: ['erp.mock.invalid'],
      secretForUrl: async () =>
        secrets.getSecretBytes('local-hkdf://callback:erp-local-01'),
      responseForAttempt: (_request, receipt) => {
        const attempt = (receiverAttempts.get(receipt.eventType) ?? 0) + 1;
        receiverAttempts.set(receipt.eventType, attempt);
        if (
          receipt.eventType === 'OUTBOUND_CALL_RESULT_BATCH' &&
          attempt === 1
        ) {
          return { status: 503, body: 'temporary receiver failure' };
        }
        if (
          receipt.eventType === 'OUTBOUND_RECORDING_AVAILABLE_BATCH' &&
          attempt === 1
        ) {
          return { status: 400, body: 'permanent receiver rejection' };
        }
        return { status: 200, body: '{"code":200,"message":"success"}' };
      },
    });
    const deliveryWorker = new CallbackDeliveryWorker(
      deliveryRepository,
      receiver,
      secrets,
      {
        workerId: `stage5b-delivery-${suffix.slice(0, 8)}`,
        maxAttempts: 2,
        retryDelaysMs: [60_000],
      },
    );
    const firstPass = [];
    for (let index = 0; index < 10; index += 1) {
      const result = await deliveryWorker.runOnce();
      if (result.status === 'IDLE') break;
      firstPass.push(result);
    }
    assert.equal(firstPass.length, 4);
    assert.ok(firstPass.some((result) => result.status === 'RETRY_SCHEDULED'));
    assert.ok(firstPass.some((result) => result.status === 'DEAD_LETTERED'));

    const callResultEvent = eventRows.find(
      (event) => event.eventType === 'OUTBOUND_CALL_RESULT_BATCH',
    );
    const recordingEvent = eventRows.find(
      (event) => event.eventType === 'OUTBOUND_RECORDING_AVAILABLE_BATCH',
    );
    assert.ok(callResultEvent && recordingEvent);
    await database.db
      .update(deliveryEvents)
      .set({ availableAt: new Date() })
      .where(eq(deliveryEvents.id, callResultEvent.id));
    assert.equal((await deliveryWorker.runOnce()).status, 'SUCCEEDED');

    const [recordingDeadLetter] = await database.db
      .select()
      .from(deadLetterEvents)
      .where(
        and(
          eq(deadLetterEvents.sourceType, 'DELIVERY'),
          eq(deadLetterEvents.sourceId, recordingEvent.id),
        ),
      );
    assert.equal(recordingDeadLetter?.status, 'OPEN');
    assert.ok(
      !JSON.stringify(recordingDeadLetter?.originalEvent).includes(
        'downloadUrl',
      ),
    );
    const recovery = new PostgresRecoveryOperationsService(database.db);
    const replayed = await recovery.replayDeadLetter(
      recordingDeadLetter!.id,
      {
        idempotencyKey: randomUUID(),
        reason: 'Stage 5B 验证：修复接收端后原位重放',
      },
      'stage5b-verifier',
      randomUUID(),
    );
    assert.equal(replayed.deadLetter.status, 'REPLAYING');
    assert.equal((await deliveryWorker.runOnce()).status, 'SUCCEEDED');

    const attempts = await database.db
      .select()
      .from(deliveryAttempts)
      .where(
        inArray(
          deliveryAttempts.deliveryEventId,
          eventRows.map((event) => event.id),
        ),
      );
    assert.equal(attempts.length, 6);
    assert.deepEqual(
      attempts
        .filter((attempt) => attempt.deliveryEventId === recordingEvent.id)
        .map((attempt) => attempt.attemptNo)
        .sort((left, right) => left - right),
      [1, 2],
    );
    const callReceipts = receiver.receipts.filter(
      (receipt) => receipt.eventType === 'OUTBOUND_CALL_RESULT_BATCH',
    );
    const recordingReceipts = receiver.receipts.filter(
      (receipt) => receipt.eventType === 'OUTBOUND_RECORDING_AVAILABLE_BATCH',
    );
    assert.equal(callReceipts.length, 2);
    assert.equal(recordingReceipts.length, 2);
    assert.equal(callReceipts[0]!.body, callReceipts[1]!.body);
    assert.equal(recordingReceipts[0]!.body, recordingReceipts[1]!.body);
    assert.equal(callReceipts[1]!.duplicate, true);
    assert.equal(recordingReceipts[1]!.duplicate, true);

    const recordingPayload = outboundCallbackEventSchema.parse(
      recordingEvent.payload,
    );
    assert.equal(
      recordingPayload.eventType,
      'OUTBOUND_RECORDING_AVAILABLE_BATCH',
    );
    if (recordingPayload.eventType !== 'OUTBOUND_RECORDING_AVAILABLE_BATCH') {
      throw new Error('录音事件类型收窄失败');
    }
    const downloadUrl = new URL(recordingPayload.recordings[0]!.downloadUrl);
    const opened = await recordingAccess.openSignedUrl(recording.id, {
      audience: downloadUrl.searchParams.get('aud')!,
      expiresAtEpochSeconds: Number(downloadUrl.searchParams.get('exp')),
      signature: downloadUrl.searchParams.get('sig')!,
      requestId: randomUUID(),
    });
    let downloadedBytes = 0;
    for await (const chunk of opened.body) downloadedBytes += chunk.byteLength;
    assert.equal(
      downloadedBytes,
      Number(recordingPayload.recordings[0]!.sizeBytes),
    );

    const reissueService = new PostgresRecordingUrlReissueService(
      database.db,
      recordingUrlSigner,
      {
        publicBaseUrl: config.RECORDING_CALLBACK_BASE_URL,
        ttlSeconds: config.RECORDING_DOWNLOAD_TTL_SECONDS,
        environment: config.NODE_ENV,
      },
    );
    const reissueIdempotencyKey = `stage5b-reissue-${suffix}`;
    const reissues = await Promise.all([
      reissueService.issue({
        recordingId: recording.id,
        principal,
        idempotencyKey: reissueIdempotencyKey,
        requestId: `stage5b-reissue-first-${suffix}`,
      }),
      reissueService.issue({
        recordingId: recording.id,
        principal,
        idempotencyKey: reissueIdempotencyKey,
        requestId: `stage5b-reissue-concurrent-${suffix}`,
      }),
    ]);
    assert.deepEqual(
      reissues
        .map((result) => result.replayed)
        .sort((left, right) => Number(left) - Number(right)),
      [false, true],
    );
    assert.deepEqual(reissues[1]!.body, reissues[0]!.body);
    await assert.rejects(
      reissueService.issue({
        recordingId: randomUUID(),
        principal,
        idempotencyKey: reissueIdempotencyKey,
        requestId: `stage5b-reissue-conflict-${suffix}`,
      }),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'IDEMPOTENCY_CONFLICT',
    );
    const issuedRows = await database.db
      .select()
      .from(recordingUrlIssues)
      .where(eq(recordingUrlIssues.recordingId, recording.id));
    assert.equal(issuedRows.length, 1);

    const [finishedTask] = await database.db
      .select({
        resultDeliveryStatus: platformTasks.resultDeliveryStatus,
        recordingDeliveryStatus: platformTasks.recordingDeliveryStatus,
        discovered: platformTasks.recordingDiscoveredCount,
        archived: platformTasks.recordingArchivedCount,
        delivered: platformTasks.recordingDeliveredCount,
      })
      .from(platformTasks)
      .where(eq(platformTasks.id, taskId));
    assert.deepEqual(finishedTask, {
      resultDeliveryStatus: 'SUCCEEDED',
      recordingDeliveryStatus: 'SUCCEEDED',
      discovered: 1,
      archived: 1,
      delivered: 1,
    });
    const [resolved] = await database.db
      .select({ status: deadLetterEvents.status })
      .from(deadLetterEvents)
      .where(eq(deadLetterEvents.id, recordingDeadLetter!.id));
    assert.equal(resolved?.status, 'RESOLVED');

    console.info(
      JSON.stringify(
        {
          status: 'passed',
          mode: 'LOCAL_RECEIVER_NO_NETWORK',
          checks: [
            '启动、通话结果、任务完成和录音清单四类事件均由业务 Outbox 投影',
            '出站 HMAC 绑定 POST、路径、毫秒时间戳、eventId 和原始 Body SHA-256',
            '任意 2xx 成功，503 按计划重试，400 直接进入死信',
            '重试与人工重放沿用原 eventId 和完全相同的 Body',
            '人工重放保留累计 attempt 编号，并重新开始独立重试周期',
            '录音事件只含平台短期签名 URL，下载可校验大小与 SHA-256',
            '录音 URL 重签按客户端与幂等键持久化，同键重试返回原响应且跨录音冲突',
            '任务结果/录音投递状态及 discovered/archived/delivered 计数闭环',
          ],
          taskNo,
          deliveryEvents: eventRows.length,
          deliveryAttempts: attempts.length,
        },
        null,
        2,
      ),
    );
  } finally {
    await cleanup(database.db, taskId, taskNo, callbackIds);
    await database.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function createRequest(suffix: string): CreateOutboundTaskRequest {
  return {
    schemaVersion: '1.0',
    externalRequestId: `stage5b-${suffix}`,
    sourceSystem: 'ERP',
    mcCode: 'MC-ZTY-001',
    taskName: `Stage 5B 本地投递验证 ${suffix}`,
    customers: [
      {
        externalCustomerId: `stage5b-customer-${suffix}`,
        name: 'Stage5B验证客户',
        phone: '13900000501',
        dataCategoryId: 'LOCAL-ERP-WEDDING',
        fields: {
          salutation: '测试客户',
          appointment_date: '2026-09-20',
          consultant_name: '本地顾问',
        },
      },
    ],
  };
}

function callCallback(input: {
  callJobId: string;
  itemId: string;
  callInstanceId: string;
  recordingUrl: string;
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
          finishStatus: 0,
          calledTimes: 1,
          customerTelephone: '13900000501',
          duration: 61,
          properties: {
            sx_platform_item_id: input.itemId,
            intention: 'A',
          },
          endTime: '2026-09-06 21:00:00',
          luyinOssUrl: input.recordingUrl,
        },
        taskResult: [{ key: 'intention', value: 'A' }],
      },
    },
    resultMsg: '成功',
  });
}

function jobCallback(callJobId: string): string {
  return JSON.stringify({
    code: 200,
    data: {
      callbackType: 'JOB_INFO_RESULT',
      data: {
        companyId: 'LOCAL-MOCK',
        callJobId,
        callJobStatus: 2,
        updateTime: '2026-09-06 21:01:00',
      },
    },
    resultMsg: '成功',
  });
}

async function cleanup(
  db: Database,
  taskId: string | undefined,
  taskNo: string | undefined,
  callbackIds: string[],
) {
  if (!taskId) return;
  const [task] = await db
    .select({ customerCharge: platformTasks.customerCharge })
    .from(platformTasks)
    .where(eq(platformTasks.id, taskId));
  const [hold] = await db
    .select({ status: fundHolds.status })
    .from(fundHolds)
    .where(eq(fundHolds.taskId, taskId));
  if (hold?.status === 'ACTIVE') {
    await new PostgresAccountRepository(db).releaseHold({
      taskId,
      operatorId: 'stage5b-verifier',
      reason: 'Stage 5B 验证清理剩余冻结',
    });
  }

  await db.transaction(async (tx) => {
    const deliveryIds = (
      await tx
        .select({ id: deliveryEvents.id })
        .from(deliveryEvents)
        .where(eq(deliveryEvents.taskId, taskId))
    ).map((event) => event.id);
    const callIds = (
      await tx
        .select({ id: callInstances.id })
        .from(callInstances)
        .where(eq(callInstances.taskId, taskId))
    ).map((call) => call.id);
    const recordingIds = callIds.length
      ? (
          await tx
            .select({ id: recordingAssets.id })
            .from(recordingAssets)
            .where(inArray(recordingAssets.callInstanceId, callIds))
        ).map((recording) => recording.id)
      : [];
    const outboxIds = (
      await tx
        .select({ id: queueOutbox.id })
        .from(queueOutbox)
        .where(
          sql`${queueOutbox.payload}->>'taskId' = ${taskId} OR ${queueOutbox.payload}->>'taskNo' = ${taskNo ?? ''}`,
        )
    ).map((event) => event.id);
    const sourceIds = [
      ...recordingIds,
      ...callbackIds,
      ...outboxIds,
      ...deliveryIds,
    ];
    const deadLetterIds = sourceIds.length
      ? (
          await tx
            .select({ id: deadLetterEvents.id })
            .from(deadLetterEvents)
            .where(inArray(deadLetterEvents.sourceId, sourceIds))
        ).map((deadLetter) => deadLetter.id)
      : [];
    const auditObjectIds = [...deadLetterIds, ...recordingIds];
    if (auditObjectIds.length) {
      await tx
        .delete(auditLogs)
        .where(inArray(auditLogs.objectId, auditObjectIds));
    }
    if (sourceIds.length) {
      await tx
        .delete(deadLetterEvents)
        .where(inArray(deadLetterEvents.sourceId, sourceIds));
    }
    if (deliveryIds.length) {
      await tx
        .delete(deliveryAttempts)
        .where(inArray(deliveryAttempts.deliveryEventId, deliveryIds));
      await tx
        .delete(deliveryEvents)
        .where(inArray(deliveryEvents.id, deliveryIds));
    }
    if (recordingIds.length) {
      await tx
        .delete(recordingUrlIssues)
        .where(inArray(recordingUrlIssues.recordingId, recordingIds));
      await tx
        .delete(recordingAssets)
        .where(inArray(recordingAssets.id, recordingIds));
    }
    await tx.delete(accountLedger).where(eq(accountLedger.taskId, taskId));
    await tx.delete(callInstances).where(eq(callInstances.taskId, taskId));
    await tx
      .delete(idempotencyRecords)
      .where(eq(idempotencyRecords.taskId, taskId));
    await tx.delete(taskOperations).where(eq(taskOperations.taskId, taskId));
    if (outboxIds.length) {
      await tx.delete(queueOutbox).where(inArray(queueOutbox.id, outboxIds));
    }
    await tx.delete(fundHolds).where(eq(fundHolds.taskId, taskId));
    await tx
      .delete(taskMappingSnapshots)
      .where(eq(taskMappingSnapshots.taskId, taskId));
    await tx.delete(taskCallItems).where(eq(taskCallItems.taskId, taskId));
    await tx.delete(platformTasks).where(eq(platformTasks.id, taskId));
    if (callbackIds.length) {
      await tx
        .delete(callbackInbox)
        .where(inArray(callbackInbox.id, callbackIds));
    }
    if (task && moneyToMicros(task.customerCharge) > 0n) {
      const [account] = await tx.execute<{
        studioId: string;
        balance: string;
        activeHoldAmount: string;
        status: 'ACTIVE' | 'LOW_BALANCE' | 'OVERDUE' | 'DISABLED';
      }>(sql`
        SELECT
          account.studio_id AS "studioId",
          account.balance,
          account.active_hold_amount AS "activeHoldAmount",
          account.status
        FROM studio_account AS account
        INNER JOIN studio ON studio.id = account.studio_id
        WHERE studio.mc_code = 'MC-ZTY-001'
        FOR UPDATE OF account
      `);
      assert.ok(account);
      const balance = addMoney(account.balance, task.customerCharge);
      const available = subtractMoney(balance, account.activeHoldAmount);
      await tx
        .update(studioAccounts)
        .set({
          balance,
          status:
            account.status === 'DISABLED'
              ? 'DISABLED'
              : moneyToMicros(balance) < 0n
                ? 'OVERDUE'
                : moneyToMicros(available) < moneyToMicros('500.000000')
                  ? 'LOW_BALANCE'
                  : 'ACTIVE',
          lockVersion: sql`${studioAccounts.lockVersion} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(studioAccounts.studioId, account.studioId));
    }
  });
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

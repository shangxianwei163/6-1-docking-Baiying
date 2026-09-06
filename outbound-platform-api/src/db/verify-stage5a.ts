import 'dotenv/config';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { CreateOutboundTaskRequest } from '@outbound/contracts';
import { LocalBaiyingCallJobClient } from '../baiying/local-call-job-client.js';
import { addMoney, moneyToMicros, subtractMoney } from '../billing/money.js';
import { PostgresAccountRepository } from '../billing/postgres-repository.js';
import { BaiyingCallbackIngressService } from '../callback/ingress-service.js';
import { PostgresBaiyingCallbackProcessor } from '../callback/processor.js';
import { PostgresCallbackInboxRepository } from '../callback/postgres-repository.js';
import { BaiyingCallbackWorker } from '../callback/worker.js';
import { readConfig } from '../config.js';
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
import { PostgresRecordingArchiveRepository } from '../recording/postgres-repository.js';
import { PostgresRecordingAccessRepository } from '../recording/postgres-access-repository.js';
import type {
  OpenedRecordingSource,
  RecordingSource,
} from '../recording/source.js';
import { RecordingArchiveWorker } from '../recording/worker.js';
import { LocalRecordingUrlSigner } from '../recording/url-signer.js';
import { LocalDataProtector } from '../security/data-protector.js';
import { bootstrapStage2Local } from './bootstrap-stage2-local.js';
import { createDatabase, type Database } from './client.js';
import {
  accountLedger,
  auditLogs,
  callbackInbox,
  callInstances,
  deadLetterEvents,
  fundHolds,
  idempotencyRecords,
  integrationClients,
  platformTasks,
  queueOutbox,
  recordingAssets,
  studioAccounts,
  taskCallItems,
  taskMappingSnapshots,
  taskOperations,
} from './schema.js';

async function main() {
  const config = readConfig();
  if (config.NODE_ENV === 'production') {
    throw new Error('生产环境禁止运行 Stage 5A 本地录音归档验证');
  }
  const database = createDatabase(config.DATABASE_URL);
  const protector = new LocalDataProtector(
    config.WORKER_SHARED_SECRET,
    config.NODE_ENV,
  );
  const suffix = randomUUID();
  const provider = `BAIYING_STAGE5A_${suffix.slice(0, 8)}`;
  const orchestrationQueue = `stage5a-orchestration-${suffix}`;
  const deliveryQueue = `stage5a-delivery-${suffix}`;
  const callbackIds: string[] = [];
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'stage5a-recordings-'));
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
      idempotencyKey: `stage5a-${suffix}`,
      requestId: randomUUID(),
      requestHash: stableJsonSha256(request),
      request,
    });
    taskId = accepted.body.data.taskId;
    taskNo = accepted.body.data.taskNo;

    const orchestrationRepository = new PostgresTaskOrchestrationRepository(
      database.db,
      { deliveryQueueName: deliveryQueue },
    );
    const orchestrationWorker = new TaskOrchestrationWorker(
      new PostgresOutboxRepository(database.db),
      new TaskOrchestrationService(
        orchestrationRepository,
        new LocalBaiyingCallJobClient('SUCCESS'),
        protector,
      ),
      {
        queueName: orchestrationQueue,
        workerId: `stage5a-orchestration-${suffix.slice(0, 8)}`,
      },
    );
    assert.equal((await orchestrationWorker.runOnce()).status, 'COMPLETED');
    const [startedTask] = await database.db
      .select({ callJobId: platformTasks.baiyingCallJobId })
      .from(platformTasks)
      .where(eq(platformTasks.id, taskId));
    const [item] = await database.db
      .select({ id: taskCallItems.id })
      .from(taskCallItems)
      .where(eq(taskCallItems.taskId, taskId));
    assert.ok(startedTask?.callJobId && item);

    const callbackRepository = new PostgresCallbackInboxRepository(
      database.db,
      {
        provider,
      },
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
      const worker = new BaiyingCallbackWorker(
        callbackRepository,
        callbackProcessor,
        protector,
        {
          workerId: `stage5a-callback-${randomUUID().slice(0, 8)}`,
          eventKey: stored.eventKey,
          retryDelaysMs: [0],
        },
      );
      const result = await worker.runOnce();
      assert.equal(result.status, 'SUCCEEDED');
    };

    await processCallback(
      callCallback({
        callJobId: startedTask.callJobId,
        itemId: item.id,
        callInstanceId: `STAGE5A-CALL-${suffix}`,
        recordingUrl: `https://recording.mock.invalid/stage5a/${suffix}/full.mp3?temporary-token=never-log`,
      }),
    );
    await processCallback(jobCallback(startedTask.callJobId));

    const [recording] = await database.db
      .select()
      .from(recordingAssets)
      .innerJoin(
        callInstances,
        eq(recordingAssets.callInstanceId, callInstances.id),
      )
      .where(eq(callInstances.taskId, taskId));
    assert.ok(recording);
    const recordingId = recording.recording_asset.id;
    assert.ok(
      !recording.recording_asset.providerUrlCiphertext.includes(
        'temporary-token',
      ),
    );

    const archiveRepository = new PostgresRecordingArchiveRepository(
      database.db,
      () => new Date(),
      deliveryQueue,
    );
    const staleClaim = await archiveRepository.claimNext({
      workerId: 'stage5a-stale-worker',
      recordingId,
    });
    assert.equal(staleClaim?.downloadAttempts, 1);
    await database.db
      .update(recordingAssets)
      .set({ lockedAt: new Date(0) })
      .where(eq(recordingAssets.id, recordingId));
    const recoveredClaim = await archiveRepository.claimNext({
      workerId: 'stage5a-recovered-worker',
      recordingId,
      lockTimeoutSeconds: 1,
    });
    assert.equal(recoveredClaim?.downloadAttempts, 2);
    await database.db
      .update(recordingAssets)
      .set({
        archiveStatus: 'PENDING',
        downloadAttempts: 0,
        lockedAt: null,
        lockedBy: null,
        lastError: null,
      })
      .where(eq(recordingAssets.id, recordingId));
    const fixtureSource = new FlakySource(new LocalFixtureRecordingSource(), 2);
    const objectStore = new LocalRecordingObjectStore(temporaryRoot);
    const archiveService = new RecordingArchiveService(
      protector,
      fixtureSource,
      objectStore,
      {
        bucket: 'local-recordings',
        maxBytes: 1_024 * 1_024,
        retentionDays: 180,
      },
    );
    const worker = new RecordingArchiveWorker(
      archiveRepository,
      archiveService,
      {
        workerId: `stage5a-recording-${suffix.slice(0, 8)}`,
        recordingId,
        maxAttempts: 2,
        retryDelaysMs: [0],
      },
    );

    const firstAttempt = await worker.runOnce();
    assert.equal(firstAttempt.status, 'RETRY_SCHEDULED');
    const secondAttempt = await worker.runOnce();
    assert.equal(secondAttempt.status, 'DEAD_LETTERED');
    const [openDeadLetter] = await database.db
      .select()
      .from(deadLetterEvents)
      .where(
        and(
          eq(deadLetterEvents.sourceType, 'RECORDING'),
          eq(deadLetterEvents.sourceId, recordingId),
        ),
      );
    assert.equal(openDeadLetter?.status, 'OPEN');
    assert.ok(
      !JSON.stringify(openDeadLetter?.originalEvent).includes(
        'temporary-token',
      ),
    );

    const recovery = new PostgresRecoveryOperationsService(database.db);
    const replay = await recovery.replayDeadLetter(
      openDeadLetter!.id,
      {
        idempotencyKey: randomUUID(),
        reason: 'Stage 5A 验证：模拟录音源恢复后人工重放',
      },
      'stage5a-verifier',
      randomUUID(),
    );
    assert.equal(replay.deadLetter.status, 'REPLAYING');
    const archivedResult = await worker.runOnce();
    assert.equal(archivedResult.status, 'ARCHIVED');
    assert.equal((await worker.runOnce()).status, 'IDLE');

    const [archived] = await database.db
      .select()
      .from(recordingAssets)
      .where(eq(recordingAssets.id, recordingId));
    assert.equal(archived?.archiveStatus, 'ARCHIVED');
    assert.equal(archived?.downloadAttempts, 1);
    assert.ok(
      archived?.ossObjectKey &&
        archived.sha256 &&
        archived.archivedAt &&
        archived.retentionUntil,
    );
    assert.ok(archived.retentionUntil > archived.archivedAt);
    const storedBytes = await readFile(
      objectStore.objectPath(archived.ossBucket!, archived.ossObjectKey),
    );
    assert.equal(storedBytes.byteLength, Number(archived.sizeBytes));
    assert.equal(
      createHash('sha256').update(storedBytes).digest('hex'),
      archived.sha256,
    );
    const accessService = new RecordingAccessService(
      new PostgresRecordingAccessRepository(database.db),
      objectStore,
      new LocalRecordingUrlSigner(config.WORKER_SHARED_SECRET, config.NODE_ENV),
      {
        publicBaseUrl: 'http://127.0.0.1:8788',
        ttlSeconds: 900,
        environment: config.NODE_ENV,
      },
    );
    const issued = await accessService.issueOperatorUrl(
      recordingId,
      'stage5a-verifier',
      randomUUID(),
    );
    const signedUrl = new URL(issued.downloadUrl);
    assert.ok(!issued.downloadUrl.includes('stage5a-verifier'));
    const opened = await accessService.openSignedUrl(recordingId, {
      audience: signedUrl.searchParams.get('aud')!,
      expiresAtEpochSeconds: Number(signedUrl.searchParams.get('exp')),
      signature: signedUrl.searchParams.get('sig')!,
      requestId: randomUUID(),
    });
    const downloadedBytes = await collect(opened.body);
    assert.deepEqual(downloadedBytes, storedBytes);
    assert.equal(opened.sha256, archived.sha256);
    const validSignature = signedUrl.searchParams.get('sig')!;
    await assert.rejects(
      accessService.openSignedUrl(recordingId, {
        audience: signedUrl.searchParams.get('aud')!,
        expiresAtEpochSeconds: Number(signedUrl.searchParams.get('exp')),
        signature: `${validSignature[0] === '0' ? '1' : '0'}${validSignature.slice(1)}`,
        requestId: randomUUID(),
      }),
      { code: 'RECORDING_URL_INVALID' },
    );
    const [finishedTask] = await database.db
      .select({
        archiveStatus: platformTasks.recordingArchiveStatus,
        discovered: platformTasks.recordingDiscoveredCount,
        archived: platformTasks.recordingArchivedCount,
        delivered: platformTasks.recordingDeliveredCount,
      })
      .from(platformTasks)
      .where(eq(platformTasks.id, taskId));
    assert.deepEqual(finishedTask, {
      archiveStatus: 'ARCHIVED',
      discovered: 1,
      archived: 1,
      delivered: 0,
    });
    const [resolvedDeadLetter] = await database.db
      .select({ status: deadLetterEvents.status })
      .from(deadLetterEvents)
      .where(eq(deadLetterEvents.id, openDeadLetter!.id));
    assert.equal(resolvedDeadLetter?.status, 'RESOLVED');

    console.info(
      JSON.stringify(
        {
          status: 'passed',
          mode: 'LOCAL_FIXTURE_NO_NETWORK',
          checks: [
            '录音 Worker 使用数据库租约并支持超时恢复',
            '失败按次数重试，耗尽后进入死信并可人工原位重放',
            '录音临时 URL 全程加密，日志与死信摘要不含令牌',
            '音频流校验文件头、类型、长度和最大字节数',
            '对象路径不含手机号和姓名，并以临时文件原子落盘',
            '归档后保存 SHA-256、大小、类型和 180 天保留期限',
            '授权操作人可重新签发 15 分钟下载 URL，篡改签名会被拒绝',
            '发现、归档、回传三个计数保持 1 / 1 / 0',
          ],
          taskNo,
          recordingId,
          objectKey: archived.ossObjectKey,
          sizeBytes: archived.sizeBytes?.toString(),
          sha256: archived.sha256,
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

class FlakySource implements RecordingSource {
  private attempts = 0;

  constructor(
    private readonly delegate: RecordingSource,
    private readonly failures: number,
  ) {}

  async open(sourceUrl: string): Promise<OpenedRecordingSource> {
    this.attempts += 1;
    if (this.attempts <= this.failures) {
      throw new Error('Stage 5A 可重试录音源故障');
    }
    return this.delegate.open(sourceUrl);
  }
}

function createRequest(suffix: string): CreateOutboundTaskRequest {
  return {
    schemaVersion: '1.0',
    externalRequestId: `stage5a-${suffix}`,
    sourceSystem: 'ERP',
    mcCode: 'MC-ZTY-001',
    taskName: `Stage 5A 本地录音验证 ${suffix}`,
    customers: [
      {
        externalCustomerId: `stage5a-customer-${suffix}`,
        name: 'Stage5A验证客户',
        phone: '13900000500',
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
          customerTelephone: '13900000500',
          duration: 61,
          properties: {
            sx_platform_item_id: input.itemId,
            intention: 'A',
          },
          endTime: '2026-09-06 20:00:00',
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
        updateTime: '2026-09-06 20:01:00',
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
      operatorId: 'stage5a-verifier',
      reason: 'Stage 5A 验证清理剩余冻结',
    });
  }

  await db.transaction(async (tx) => {
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
    const sourceIds = [...recordingIds, ...callbackIds, ...outboxIds];
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
    if (recordingIds.length) {
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

async function collect(body: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

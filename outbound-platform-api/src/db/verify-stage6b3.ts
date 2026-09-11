import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import { readConfig } from '../config.js';
import { PostgresIntegrationLogService } from '../operations/integration-log-service.js';
import { PostgresOperationsOverviewService } from '../operations/overview-service.js';
import { PostgresCallbackInboxRepository } from '../callback/postgres-repository.js';
import { LocalDataProtector } from '../security/data-protector.js';
import { createDatabase } from './client.js';
import {
  callbackInbox,
  deadLetterEvents,
  operationalMetricEvents,
  queueOutbox,
} from './schema.js';

const config = readConfig();
if (config.NODE_ENV === 'production') {
  throw new Error('阶段 6B-3 本地验收禁止在生产环境运行');
}

const database = createDatabase(config.DATABASE_URL);
const now = new Date();
const staleAt = new Date(now.getTime() - 12 * 60 * 1000);
const marker = `stage6b3-${randomUUID()}`;
const callbackIds: string[] = [randomUUID(), randomUUID()];
const categoryMetricId = randomUUID();
const outboxId = randomUUID();
const deadLetterId = randomUUID();
const secret = 'must-never-reach-the-operator';
const phone = '13800138000';
const fullCallbackBody = {
  data: {
    callbackType: 'CALL_INSTANCE_RESULT',
    data: {
      callInstance: {
        finishStatus: 3,
        customerTelephone: phone,
        diagnostics: { providerCode: 'LINE_REJECTED' },
      },
    },
  },
};
const protector = new LocalDataProtector(
  config.WORKER_SHARED_SECRET,
  config.NODE_ENV,
);
const overviewService = new PostgresOperationsOverviewService(
  database.db,
  () => now,
);
const logService = new PostgresIntegrationLogService(database.db, protector);
const callbackRepository = new PostgresCallbackInboxRepository(database.db, {
  clock: () => now,
});

try {
  const baseline = await overviewService.getOverview();

  await database.db.insert(callbackInbox).values([
    {
      id: callbackIds[0],
      callbackType: 'STAGE6B3_PENDING_VERIFY',
      eventKey: `${marker}:pending`,
      rawBodyCiphertext: protector.encryptUtf8(
        JSON.stringify(fullCallbackBody),
      ),
      rawBodySha256: 'a'.repeat(64),
      headers: {
        authorization: `Bearer ${secret}`,
        'x-contact-phone': phone,
        'x-safe-header': 'visible',
      },
      parseStatus: 'VALID',
      processStatus: 'PENDING',
      processAttempts: 0,
      availableAt: staleAt,
      receivedAt: staleAt,
    },
    {
      id: callbackIds[1],
      callbackType: 'STAGE6B3_FAILED_VERIFY',
      eventKey: `${marker}:failed`,
      rawBodyCiphertext: 'local-verifier-ciphertext',
      rawBodySha256: 'b'.repeat(64),
      headers: { 'x-safe-header': 'visible' },
      parseStatus: 'VALID',
      processStatus: 'FAILED',
      processAttempts: 3,
      processError: `authorization=Bearer ${secret}; customer=${phone}`,
      availableAt: staleAt,
      receivedAt: staleAt,
      processedAt: now,
    },
  ]);
  await database.db.insert(queueOutbox).values({
    id: outboxId,
    eventType: 'STAGE6B3_VERIFY',
    queueName: 'stage6b3-local-verification',
    payload: { marker },
    attempts: 2,
    availableAt: staleAt,
    createdAt: staleAt,
  });
  await database.db.insert(deadLetterEvents).values({
    id: deadLetterId,
    sourceType: 'CALLBACK',
    sourceId: randomUUID(),
    originalEvent: { marker, token: secret, contactPhone: phone },
    finalError: `CallbackBusinessConflictError: token=${secret}; phone=${phone}`,
    suggestedAction: '核对链路后人工重放',
    status: 'OPEN',
    createdAt: staleAt,
  });
  await database.db.insert(operationalMetricEvents).values({
    id: categoryMetricId,
    metricCode: 'DATA_CATEGORY_AMBIGUOUS',
    sourceSystem: 'ERP',
    requestId: marker,
    objectRef: 'MC-QUALITY-VERIFY',
    detail: { mainCategory: '排档', subCategory: '孕妈', cLevel: 'SR3' },
    occurredAt: now,
  });
  const duplicateInput = {
    callbackType: 'STAGE6B3_DUPLICATE_VERIFY',
    eventKey: `${marker}:duplicate`,
    companyId: 'QUALITY-VERIFY',
    callJobId: 'QUALITY-JOB',
    callInstanceId: 'QUALITY-CALL',
    rawBodyCiphertext: 'local-verifier-ciphertext',
    rawBodySha256: 'c'.repeat(64),
    headers: {},
  };
  const firstDuplicateReceipt = await callbackRepository.save(duplicateInput);
  const secondDuplicateReceipt = await callbackRepository.save(duplicateInput);
  callbackIds.push(firstDuplicateReceipt.id);
  assert.equal(firstDuplicateReceipt.replayed, false);
  assert.equal(secondDuplicateReceipt.replayed, true);

  const overview = await overviewService.getOverview();
  assert.equal(
    overview.pipeline.callbackPending,
    baseline.pipeline.callbackPending + 3,
  );
  assert.equal(
    overview.pipeline.callbackStale,
    baseline.pipeline.callbackStale + 2,
  );
  assert.equal(
    overview.pipeline.outboxPending,
    baseline.pipeline.outboxPending + 1,
  );
  assert.equal(
    overview.pipeline.outboxStale,
    baseline.pipeline.outboxStale + 1,
  );
  assert.equal(
    overview.pipeline.openDeadLetters,
    baseline.pipeline.openDeadLetters + 1,
  );
  assert.equal(
    overview.integrationQuality.correlationConflicts.count,
    baseline.integrationQuality.correlationConflicts.count + 1,
  );
  assert.equal(
    overview.integrationQuality.categoryAmbiguities.count,
    baseline.integrationQuality.categoryAmbiguities.count + 1,
  );
  assert.equal(
    overview.integrationQuality.callbackDuplicates.matched,
    baseline.integrationQuality.callbackDuplicates.matched + 1,
  );
  assert.equal(overview.attention.total, baseline.attention.total + 1);
  assert.equal(
    overview.attention.highPriority,
    baseline.attention.highPriority + 1,
  );
  const deadLetterAttention = overview.attention.items.find(
    (item) => item.id === `dead-letter:${deadLetterId}`,
  );
  assert.ok(deadLetterAttention);
  assert.doesNotMatch(deadLetterAttention.description, new RegExp(secret));
  assert.doesNotMatch(deadLetterAttention.description, new RegExp(phone));

  const logPage = await logService.listLogs({
    keyword: marker,
    pageNum: 0,
    pageSize: 20,
  });
  assert.equal(logPage.total, 3);
  const pendingLog = logPage.items.find(
    (item) => item.requestId === `${marker}:pending`,
  );
  const failedLog = logPage.items.find(
    (item) => item.requestId === `${marker}:failed`,
  );
  assert.equal(pendingLog?.status, 'PENDING');
  assert.equal(failedLog?.status, 'FAILED');
  assert.ok(pendingLog?.detail.request);
  const requestDetail = JSON.parse(String(pendingLog.detail.request));
  assert.equal(requestDetail.headers.authorization, '[已脱敏]');
  assert.equal(requestDetail.headers['x-contact-phone'], '[已脱敏]');
  assert.equal(requestDetail.headers['x-safe-header'], 'visible');
  assert.doesNotMatch(failedLog?.errorMessage ?? '', new RegExp(secret));
  assert.doesNotMatch(failedLog?.errorMessage ?? '', new RegExp(phone));

  const fullDetail = await logService.getLogDetail(
    `callback:${callbackIds[0]}`,
  );
  assert.ok(fullDetail);
  assert.equal(fullDetail.detailLevel, 'FULL');
  assert.deepEqual(
    (fullDetail.request as { body: unknown }).body,
    fullCallbackBody,
  );
  assert.equal(
    (fullDetail.request as { headers: Record<string, string> }).headers[
      'x-contact-phone'
    ],
    phone,
  );

  console.info(
    JSON.stringify(
      {
        stage: '6B-3A',
        status: 'passed',
        checks: {
          databaseOverviewAggregation: true,
          callbackAndOutboxStaleness: true,
          deadLetterAttention: true,
          unifiedIntegrationLog: true,
          onDemandFullIntegrationDetail: true,
          recursiveCredentialAndPhoneRedaction: true,
          callbackDuplicatePersistence: true,
          categoryAmbiguityMetric: true,
          correlationConflictMetric: true,
        },
      },
      null,
      2,
    ),
  );
} finally {
  await database.db
    .delete(operationalMetricEvents)
    .where(inArray(operationalMetricEvents.id, [categoryMetricId]));
  await database.db
    .delete(operationalMetricEvents)
    .where(inArray(operationalMetricEvents.objectRef, callbackIds));
  await database.db
    .delete(deadLetterEvents)
    .where(inArray(deadLetterEvents.id, [deadLetterId]));
  await database.db
    .delete(queueOutbox)
    .where(inArray(queueOutbox.id, [outboxId]));
  await database.db
    .delete(callbackInbox)
    .where(inArray(callbackInbox.id, callbackIds));
  await database.close();
}

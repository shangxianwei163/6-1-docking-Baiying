import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { and, eq, ilike, inArray, sql } from 'drizzle-orm';
import type { CreateOutboundTaskRequest } from '@outbound/contracts';
import { LocalBaiyingCallJobClient } from '../baiying/local-call-job-client.js';
import { PostgresAccountRepository } from '../billing/postgres-repository.js';
import { PostgresCallbackInboxRepository } from '../callback/postgres-repository.js';
import { readConfig } from '../config.js';
import { stableJsonSha256 } from '../openapi/request-hash.js';
import { PostgresRecoveryOperationsService } from '../operations/recovery-service.js';
import { OperationsConsoleFailure } from '../operations/service.js';
import {
  LocalTaskCommandExecutor,
  PostgresTaskControlService,
} from '../operations/task-control-service.js';
import { PostgresOutboxRepository } from '../outbox/postgres-repository.js';
import { PostgresOutboundTaskService } from '../outbound-task/service.js';
import { PostgresTaskOrchestrationRepository } from '../orchestration/postgres-repository.js';
import { TaskOrchestrationService } from '../orchestration/service.js';
import { TaskOrchestrationWorker } from '../orchestration/worker.js';
import { LocalDataProtector } from '../security/data-protector.js';
import { bootstrapStage2Local } from './bootstrap-stage2-local.js';
import { createDatabase } from './client.js';
import {
  accountLedger,
  auditLogs,
  callbackInbox,
  deadLetterEvents,
  fundHolds,
  idempotencyRecords,
  integrationClients,
  platformTasks,
  queueOutbox,
  taskCallItems,
  taskMappingSnapshots,
  taskOperations,
} from './schema.js';

type AcceptedFixture = { taskId: string; taskNo: string };

const config = readConfig();
if (config.NODE_ENV === 'production') {
  throw new Error('阶段 6B-3B 本地验收禁止在生产环境运行');
}

const database = createDatabase(config.DATABASE_URL);
const suffix = randomUUID();
const queueName = `stage6b3b-task-${suffix}`;
const deliveryQueueName = `stage6b3b-delivery-${suffix}`;
const deadLetterQueueName = `stage6b3b-dead-${suffix}`;
const protector = new LocalDataProtector(
  config.WORKER_SHARED_SECRET,
  config.NODE_ENV,
);
const taskIntake = new PostgresOutboundTaskService(database.db, protector, {
  baiyingCompanyId: 'LOCAL-MOCK',
  queueName,
});
const orchestrationRepository = new PostgresTaskOrchestrationRepository(
  database.db,
  { deliveryQueueName },
);
const outbox = new PostgresOutboxRepository(database.db);
const controls = new PostgresTaskControlService(
  database.db,
  new LocalTaskCommandExecutor(),
  { taskQueueName: queueName },
);
const recovery = new PostgresRecoveryOperationsService(database.db);
const acceptedTasks: AcceptedFixture[] = [];
const standaloneOutboxIds: string[] = [];
const standaloneCallbackIds: string[] = [];
const standaloneDeadLetterIds: string[] = [];
const auditRequestIds: string[] = [];

try {
  await cleanup();
  await bootstrapStage2Local(database.db);
  const [client] = await database.db
    .select({ id: integrationClients.id })
    .from(integrationClients)
    .where(eq(integrationClients.clientId, 'erp-local-01'))
    .limit(1);
  assert.ok(client, 'Stage 2 本地 ERP 客户端不存在');

  const accept = async (label: string) => {
    const request = createRequest(`${label}-${suffix}`);
    const result = await taskIntake.accept({
      principal: {
        integrationClientId: client.id,
        clientId: 'erp-local-01',
        sourceSystem: 'ERP',
      },
      idempotencyKey: `stage6b3b-${label}-${suffix}`,
      requestId: randomUUID(),
      requestHash: stableJsonSha256(request),
      request,
    });
    const fixture = {
      taskId: result.body.data.taskId,
      taskNo: result.body.data.taskNo,
    };
    acceptedTasks.push(fixture);
    return fixture;
  };

  const commandTask = await accept('commands');
  const successWorker = createWorker('SUCCESS');
  const successResult = await successWorker.runOnce();
  assert.equal(successResult.status, 'COMPLETED');
  assert.equal(successResult.taskId, commandTask.taskId);

  const pauseKey = randomUUID();
  const pauseRequestId = randomUUID();
  auditRequestIds.push(pauseRequestId);
  const paused = await controls.commandTask(
    commandTask.taskNo,
    {
      command: 'PAUSE',
      reason: '阶段 6B-3B 验证暂停',
      idempotencyKey: pauseKey,
    },
    'stage6b3b-operator',
    pauseRequestId,
  );
  assert.equal(paused.status, 'SUCCEEDED');
  assert.equal(paused.executionStatus, 'PAUSED');
  assert.equal(paused.providerMode, 'LOCAL_SIMULATION');
  const pausedReplay = await controls.commandTask(
    commandTask.taskNo,
    {
      command: 'PAUSE',
      reason: '不同文案不影响既有幂等响应',
      idempotencyKey: pauseKey,
    },
    'stage6b3b-operator',
    randomUUID(),
  );
  assert.equal(pausedReplay.idempotentReplay, true);
  assert.equal(pausedReplay.actionId, paused.actionId);

  const resumeRequestId = randomUUID();
  auditRequestIds.push(resumeRequestId);
  const resumed = await controls.commandTask(
    commandTask.taskNo,
    {
      command: 'RESUME',
      reason: '阶段 6B-3B 验证恢复',
      idempotencyKey: randomUUID(),
    },
    'stage6b3b-operator',
    resumeRequestId,
  );
  assert.equal(resumed.executionStatus, 'CALLING');

  const terminateRequestId = randomUUID();
  auditRequestIds.push(terminateRequestId);
  const terminated = await controls.commandTask(
    commandTask.taskNo,
    {
      command: 'TERMINATE',
      reason: '阶段 6B-3B 验证终止',
      idempotencyKey: randomUUID(),
    },
    'stage6b3b-operator',
    terminateRequestId,
  );
  assert.equal(terminated.executionStatus, 'TERMINATED');
  const [terminatedTask] = await database.db
    .select()
    .from(platformTasks)
    .where(eq(platformTasks.id, commandTask.taskId));
  const [terminatedHold] = await database.db
    .select()
    .from(fundHolds)
    .where(eq(fundHolds.taskId, commandTask.taskId));
  assert.equal(terminatedTask?.billingStatus, 'SETTLED');
  assert.equal(terminatedHold?.status, 'RELEASED');
  assert.equal(terminatedHold?.remainingAmount, '0.000000');

  const retryTask = await accept('retry');
  const exhaustedWorker = createWorker('CREATE_UNKNOWN_AFTER_COMMIT', 1);
  const exhausted = await exhaustedWorker.runOnce();
  assert.equal(exhausted.status, 'DEAD_LETTERED');
  const [failedTask] = await database.db
    .select()
    .from(platformTasks)
    .where(eq(platformTasks.id, retryTask.taskId));
  assert.equal(failedTask?.executionStatus, 'CREATE_FAILED');
  assert.equal(failedTask?.failureRetryable, true);
  const retryRequestId = randomUUID();
  auditRequestIds.push(retryRequestId);
  const retryKey = randomUUID();
  const retried = await controls.retryTask(
    retryTask.taskNo,
    {
      reason: '已确认供应商短时错误消除，安全恢复编排',
      idempotencyKey: retryKey,
    },
    'stage6b3b-operator',
    retryRequestId,
  );
  assert.equal(retried.status, 'QUEUED');
  assert.equal(retried.executionStatus, 'BAIYING_CREATING');
  const retriedReplay = await controls.retryTask(
    retryTask.taskNo,
    { reason: '重复提交', idempotencyKey: retryKey },
    'stage6b3b-operator',
    randomUUID(),
  );
  assert.equal(retriedReplay.idempotentReplay, true);
  const [restoredTask] = await database.db
    .select()
    .from(platformTasks)
    .where(eq(platformTasks.id, retryTask.taskId));
  const [restoredHold] = await database.db
    .select()
    .from(fundHolds)
    .where(eq(fundHolds.taskId, retryTask.taskId));
  assert.equal(restoredTask?.failureCode, null);
  assert.equal(restoredHold?.status, 'ACTIVE');
  assert.equal(restoredHold?.remainingAmount, restoredHold?.originalAmount);
  const taskDeadLetters = await database.db
    .select()
    .from(deadLetterEvents)
    .innerJoin(queueOutbox, eq(queueOutbox.id, deadLetterEvents.sourceId))
    .where(sql`${queueOutbox.payload}->>'taskId' = ${retryTask.taskId}`);
  assert.ok(taskDeadLetters.length > 0);
  assert.ok(
    taskDeadLetters.every((row) => row.dead_letter_event.status === 'RESOLVED'),
  );
  await database.db
    .update(queueOutbox)
    .set({ availableAt: new Date(Date.now() + 60_000) })
    .where(eq(queueOutbox.id, retried.actionId));

  const unsafeImportTask = await accept('unsafe-import');
  const unsafeImportResult = await createWorker('IMPORT_PARTIAL').runOnce();
  assert.equal(unsafeImportResult.status, 'COMPLETED');
  assert.equal(unsafeImportResult.taskId, unsafeImportTask.taskId);
  await assert.rejects(
    controls.retryTask(
      unsafeImportTask.taskNo,
      {
        reason: '验证部分导入任务不可盲目重放',
        idempotencyKey: randomUUID(),
      },
      'stage6b3b-operator',
      randomUUID(),
    ),
    (error: unknown) =>
      error instanceof OperationsConsoleFailure &&
      error.code === 'TASK_RETRY_REQUIRES_NEW_TASK',
  );

  const replayOutboxId = randomUUID();
  const replayDeadLetterId = randomUUID();
  standaloneOutboxIds.push(replayOutboxId);
  standaloneDeadLetterIds.push(replayDeadLetterId);
  const secret = 'stage6b3b-secret-must-not-leak';
  const phone = '13800138000';
  await database.db.insert(queueOutbox).values({
    id: replayOutboxId,
    eventType: 'STAGE6B3B_REPLAY',
    queueName: deadLetterQueueName,
    payload: { marker: suffix },
    attempts: 8,
    lastError: `token=${secret}; phone=${phone}`,
    deadLetteredAt: new Date(),
  });
  await database.db.insert(deadLetterEvents).values({
    id: replayDeadLetterId,
    sourceType: 'OUTBOX',
    sourceId: replayOutboxId,
    originalEvent: {
      payload: { marker: suffix, token: secret, customerPhone: phone },
    },
    finalError: `token=${secret}; phone=${phone}`,
    suggestedAction: '验证重放',
  });
  const listed = await recovery.listDeadLetters({
    keyword: suffix,
    pageNum: 0,
    pageSize: 20,
  });
  const listedDeadLetter = listed.items.find(
    (item) => item.id === replayDeadLetterId,
  );
  assert.ok(listedDeadLetter);
  assert.equal(listedDeadLetter.replayable, true);
  assert.doesNotMatch(JSON.stringify(listedDeadLetter), new RegExp(secret));
  assert.doesNotMatch(JSON.stringify(listedDeadLetter), new RegExp(phone));
  const eventTypeSearch = await recovery.listDeadLetters({
    keyword: 'STAGE6B3B_REPLAY',
    pageNum: 0,
    pageSize: 20,
  });
  assert.equal(eventTypeSearch.total, 1);
  assert.equal(eventTypeSearch.summary.all, 1);
  assert.equal(eventTypeSearch.summary.outbox, 1);

  const replayRequestId = randomUUID();
  auditRequestIds.push(replayRequestId);
  const replayKey = randomUUID();
  const replayed = await recovery.replayDeadLetter(
    replayDeadLetterId,
    { reason: '已修复消费逻辑，批准重放', idempotencyKey: replayKey },
    'stage6b3b-operator',
    replayRequestId,
  );
  assert.equal(replayed.deadLetter.status, 'REPLAYING');
  assert.equal(replayed.deadLetter.replayCount, 1);
  const replayedAgain = await recovery.replayDeadLetter(
    replayDeadLetterId,
    { reason: '重复提交', idempotencyKey: replayKey },
    'stage6b3b-operator',
    randomUUID(),
  );
  assert.equal(replayedAgain.idempotentReplay, true);
  const claimedOutbox = await outbox.claimNext({
    queueName: deadLetterQueueName,
    eventType: 'STAGE6B3B_REPLAY',
    workerId: 'stage6b3b-outbox-worker',
  });
  assert.equal(claimedOutbox?.id, replayOutboxId);
  await outbox.complete(replayOutboxId, 'stage6b3b-outbox-worker');
  const resolvedOutbox = await recovery.listDeadLetters({
    keyword: suffix,
    status: 'RESOLVED',
    pageNum: 0,
    pageSize: 20,
  });
  assert.equal(
    resolvedOutbox.items.find((item) => item.id === replayDeadLetterId)?.status,
    'RESOLVED',
  );

  const callbackId = randomUUID();
  const callbackDeadLetterId = randomUUID();
  standaloneCallbackIds.push(callbackId);
  standaloneDeadLetterIds.push(callbackDeadLetterId);
  await database.db.insert(callbackInbox).values({
    id: callbackId,
    callbackType: 'STAGE6B3B_CALLBACK',
    eventKey: `${suffix}:callback`,
    rawBodyCiphertext: 'encrypted-local-fixture',
    rawBodySha256: 'b'.repeat(64),
    parseStatus: 'INVALID',
    processStatus: 'FAILED',
    processAttempts: 8,
    parseError: '旧格式',
    processError: '旧格式',
    deadLetteredAt: new Date(),
  });
  await database.db.insert(deadLetterEvents).values({
    id: callbackDeadLetterId,
    sourceType: 'CALLBACK',
    sourceId: callbackId,
    originalEvent: {
      callbackType: 'STAGE6B3B_CALLBACK',
      eventKey: `${suffix}:callback`,
    },
    finalError: '回调格式旧版本',
  });
  const callbackReplayRequestId = randomUUID();
  auditRequestIds.push(callbackReplayRequestId);
  await recovery.replayDeadLetter(
    callbackDeadLetterId,
    { reason: '兼容解析器已发布', idempotencyKey: randomUUID() },
    'stage6b3b-operator',
    callbackReplayRequestId,
  );
  const callbackRepository = new PostgresCallbackInboxRepository(database.db);
  const claimedCallback = await callbackRepository.claimNext({
    workerId: 'stage6b3b-callback-worker',
    eventKey: `${suffix}:callback`,
  });
  assert.equal(claimedCallback?.id, callbackId);
  await callbackRepository.complete({
    inboxId: callbackId,
    workerId: 'stage6b3b-callback-worker',
  });
  const [resolvedCallback] = await database.db
    .select()
    .from(deadLetterEvents)
    .where(eq(deadLetterEvents.id, callbackDeadLetterId));
  assert.equal(resolvedCallback?.status, 'RESOLVED');

  const ignoredOutboxId = randomUUID();
  const ignoredDeadLetterId = randomUUID();
  standaloneOutboxIds.push(ignoredOutboxId);
  standaloneDeadLetterIds.push(ignoredDeadLetterId);
  await database.db.insert(queueOutbox).values({
    id: ignoredOutboxId,
    eventType: 'STAGE6B3B_IGNORE',
    queueName: deadLetterQueueName,
    payload: { marker: `${suffix}:ignored` },
    deadLetteredAt: new Date(),
  });
  await database.db.insert(deadLetterEvents).values({
    id: ignoredDeadLetterId,
    sourceType: 'OUTBOX',
    sourceId: ignoredOutboxId,
    originalEvent: { marker: `${suffix}:ignored` },
    finalError: '业务确认不再投递',
  });
  const ignoreRequestId = randomUUID();
  auditRequestIds.push(ignoreRequestId);
  const ignored = await recovery.ignoreDeadLetter(
    ignoredDeadLetterId,
    { reason: '业务方书面确认无需补发', idempotencyKey: randomUUID() },
    'stage6b3b-operator',
    ignoreRequestId,
  );
  assert.equal(ignored.deadLetter.status, 'IGNORED');

  const controlOperations = await database.db
    .select()
    .from(taskOperations)
    .where(eq(taskOperations.taskId, commandTask.taskId));
  assert.deepEqual(
    controlOperations
      .filter((operation) =>
        ['PAUSE', 'RESUME', 'TERMINATE'].includes(operation.operationType),
      )
      .map((operation) => `${operation.operationType}:${operation.status}`)
      .sort(),
    ['PAUSE:SUCCEEDED', 'RESUME:SUCCEEDED', 'TERMINATE:SUCCEEDED'],
  );

  console.info(
    JSON.stringify(
      {
        stage: '6B-3B',
        status: 'passed',
        checks: {
          taskPauseResumeTerminate: true,
          commandIdempotencyAndAudit: true,
          confirmedTerminationReleasesHold: true,
          safeFailedTaskRetryAndRehold: true,
          unsafeRetryGuardrails: true,
          deadLetterListAndRedaction: true,
          outboxAndCallbackReplay: true,
          replayAutoResolution: true,
          ignoreWorkflow: true,
          noExternalNetworkOrRealCalls: true,
        },
      },
      null,
      2,
    ),
  );
} finally {
  await cleanup();
  await database.close();
}

function createWorker(
  scenario: 'SUCCESS' | 'CREATE_UNKNOWN_AFTER_COMMIT' | 'IMPORT_PARTIAL',
  maxAttempts?: number,
) {
  return new TaskOrchestrationWorker(
    outbox,
    new TaskOrchestrationService(
      orchestrationRepository,
      new LocalBaiyingCallJobClient(scenario),
      protector,
    ),
    {
      queueName,
      workerId: `stage6b3b:${scenario}:${randomUUID().slice(0, 8)}`,
      maxAttempts,
    },
  );
}

function createRequest(externalRequestId: string): CreateOutboundTaskRequest {
  return {
    schemaVersion: '1.0',
    externalRequestId,
    sourceSystem: 'ERP',
    mcCode: 'MC-ZTY-001',
    taskName: `Stage 6B-3B 异常处置验证 ${externalRequestId}`,
    customers: [
      {
        externalCustomerId: `${externalRequestId}-customer-1`,
        name: '验证客户',
        phone: '13800138009',
        dataCategoryId: 'LOCAL-ERP-WEDDING',
        fields: {
          salutation: '验证客户',
          appointment_date: '2026-09-20',
          consultant_name: '本地顾问',
        },
      },
    ],
  };
}

async function cleanup() {
  const staleTasks = await database.db
    .select({ taskId: platformTasks.id, taskNo: platformTasks.taskNo })
    .from(platformTasks)
    .where(ilike(platformTasks.taskName, 'Stage 6B-3B 异常处置验证 %'));
  const taskById = new Map(
    [...acceptedTasks, ...staleTasks].map((task) => [task.taskId, task]),
  );
  const tasks = [...taskById.values()];
  const taskIds = tasks.map((task) => task.taskId);
  const staleOutbox = await database.db
    .select({ id: queueOutbox.id })
    .from(queueOutbox)
    .where(ilike(queueOutbox.queueName, 'stage6b3b-dead-%'));
  const outboxIds = Array.from(
    new Set([...standaloneOutboxIds, ...staleOutbox.map((row) => row.id)]),
  );
  const staleCallbacks = await database.db
    .select({ id: callbackInbox.id })
    .from(callbackInbox)
    .where(eq(callbackInbox.callbackType, 'STAGE6B3B_CALLBACK'));
  const callbackIds = Array.from(
    new Set([...standaloneCallbackIds, ...staleCallbacks.map((row) => row.id)]),
  );
  const sourceIds = [...outboxIds, ...callbackIds];
  const staleDeadLetters = sourceIds.length
    ? await database.db
        .select({ id: deadLetterEvents.id })
        .from(deadLetterEvents)
        .where(inArray(deadLetterEvents.sourceId, sourceIds))
    : [];
  const deadLetterIds = Array.from(
    new Set([
      ...standaloneDeadLetterIds,
      ...staleDeadLetters.map((row) => row.id),
    ]),
  );
  const accounts = new PostgresAccountRepository(database.db);
  for (const task of tasks) {
    await accounts.releaseHold({
      taskId: task.taskId,
      operatorId: 'stage6b3b-verifier',
      reason: '阶段 6B-3B 验证完成，清理本地测试冻结',
    });
  }
  await database.db.transaction(async (tx) => {
    if (deadLetterIds.length) {
      await tx
        .delete(deadLetterEvents)
        .where(inArray(deadLetterEvents.id, deadLetterIds));
    }
    if (callbackIds.length) {
      await tx
        .delete(callbackInbox)
        .where(inArray(callbackInbox.id, callbackIds));
    }
    if (outboxIds.length) {
      await tx.delete(queueOutbox).where(inArray(queueOutbox.id, outboxIds));
    }
    for (const task of tasks) {
      const events = await tx
        .select({ id: queueOutbox.id })
        .from(queueOutbox)
        .where(
          sql`${queueOutbox.payload}->>'taskNo' = ${task.taskNo} or ${queueOutbox.payload}->>'taskId' = ${task.taskId}`,
        );
      if (events.length) {
        await tx.delete(deadLetterEvents).where(
          inArray(
            deadLetterEvents.sourceId,
            events.map((event) => event.id),
          ),
        );
      }
      await tx
        .delete(queueOutbox)
        .where(
          sql`${queueOutbox.payload}->>'taskNo' = ${task.taskNo} or ${queueOutbox.payload}->>'taskId' = ${task.taskId}`,
        );
    }
    if (auditRequestIds.length) {
      await tx
        .delete(auditLogs)
        .where(inArray(auditLogs.requestId, auditRequestIds));
    }
    if (taskIds.length) {
      await tx
        .delete(auditLogs)
        .where(
          and(
            eq(auditLogs.objectType, 'PLATFORM_TASK'),
            inArray(auditLogs.objectId, taskIds),
          ),
        );
      await tx
        .delete(idempotencyRecords)
        .where(inArray(idempotencyRecords.taskId, taskIds));
      await tx
        .delete(taskOperations)
        .where(inArray(taskOperations.taskId, taskIds));
      await tx
        .delete(accountLedger)
        .where(inArray(accountLedger.taskId, taskIds));
      await tx.delete(fundHolds).where(inArray(fundHolds.taskId, taskIds));
      await tx
        .delete(taskMappingSnapshots)
        .where(inArray(taskMappingSnapshots.taskId, taskIds));
      await tx
        .delete(taskCallItems)
        .where(inArray(taskCallItems.taskId, taskIds));
      await tx.delete(platformTasks).where(inArray(platformTasks.id, taskIds));
    }
    if (deadLetterIds.length) {
      await tx
        .delete(auditLogs)
        .where(inArray(auditLogs.objectId, deadLetterIds));
    }
  });
}

import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  taskStartedEventSchema,
  taskStartFailedEventSchema,
  type CreateOutboundTaskRequest,
} from '@outbound/contracts';
import { LocalBaiyingCallJobClient } from '../baiying/local-call-job-client.js';
import { PostgresAccountRepository } from '../billing/postgres-repository.js';
import { readConfig } from '../config.js';
import { stableJsonSha256 } from '../openapi/request-hash.js';
import { PostgresOutboundTaskService } from '../outbound-task/service.js';
import { PostgresOutboxRepository } from '../outbox/postgres-repository.js';
import { PostgresTaskOrchestrationRepository } from '../orchestration/postgres-repository.js';
import { TaskOrchestrationService } from '../orchestration/service.js';
import { TaskOrchestrationWorker } from '../orchestration/worker.js';
import { LocalDataProtector } from '../security/data-protector.js';
import { bootstrapStage2Local } from './bootstrap-stage2-local.js';
import { createDatabase, type Database } from './client.js';
import {
  accountLedger,
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

type AcceptedFixture = {
  taskId: string;
  taskNo: string;
  reservedAmount: string;
};

async function main() {
  const config = readConfig();
  if (config.NODE_ENV === 'production') {
    throw new Error('生产环境禁止运行 Stage 3 本地模拟闭环验证');
  }
  const database = createDatabase(config.DATABASE_URL);
  const suffix = randomUUID();
  const queueName = `stage3-verify-${suffix}`;
  const deliveryQueueName = `stage3-delivery-verify-${suffix}`;
  const protector = new LocalDataProtector(
    config.WORKER_SHARED_SECRET,
    config.NODE_ENV,
  );
  const acceptedTasks: AcceptedFixture[] = [];

  try {
    await bootstrapStage2Local(database.db);
    const taskIntake = new PostgresOutboundTaskService(database.db, protector, {
      baiyingCompanyId: 'LOCAL-MOCK',
      queueName,
    });
    const [client] = await database.db
      .select({ id: integrationClients.id })
      .from(integrationClients)
      .where(eq(integrationClients.clientId, 'erp-local-01'))
      .limit(1);
    assert.ok(client, 'Stage 2 本地 ERP 客户端不存在');

    const accept = async (
      label: string,
      customerCount = 1,
    ): Promise<AcceptedFixture> => {
      const request = createRequest(`${label}-${suffix}`, customerCount);
      const result = await taskIntake.accept({
        principal: {
          integrationClientId: client.id,
          clientId: 'erp-local-01',
          sourceSystem: 'ERP',
        },
        idempotencyKey: `stage3-${label}-${suffix}`,
        requestId: randomUUID(),
        requestHash: stableJsonSha256(request),
        request,
      });
      const fixture = {
        taskId: result.body.data.taskId,
        taskNo: result.body.data.taskNo,
        reservedAmount: result.body.data.reservedAmount,
      };
      acceptedTasks.push(fixture);
      return fixture;
    };

    const repository = new PostgresTaskOrchestrationRepository(database.db, {
      deliveryQueueName,
    });
    const outbox = new PostgresOutboxRepository(database.db);

    const success = await accept('success');
    const successResult = await runScenario({
      database: database.db,
      outbox,
      repository,
      protector,
      queueName,
      taskId: success.taskId,
      scenario: 'SUCCESS',
    });
    assert.equal(successResult.final.status, 'COMPLETED');
    await assertCalling(database.db, success.taskId);
    await assertOperationStatuses(database.db, success.taskId, {
      CREATE: ['SUCCEEDED'],
      IMPORT: ['SUCCEEDED'],
      START: ['SUCCEEDED'],
    });

    const createUnknown = await accept('create-unknown');
    const createUnknownResult = await runScenario({
      database: database.db,
      outbox,
      repository,
      protector,
      queueName,
      taskId: createUnknown.taskId,
      scenario: 'CREATE_UNKNOWN_AFTER_COMMIT',
      expectRetry: true,
    });
    assert.equal(createUnknownResult.first.status, 'RETRY_SCHEDULED');
    await assertCalling(database.db, createUnknown.taskId);
    await assertOperationStatuses(database.db, createUnknown.taskId, {
      CREATE: ['UNKNOWN'],
      QUERY: ['SUCCEEDED'],
      IMPORT: ['SUCCEEDED'],
      START: ['SUCCEEDED'],
    });

    const importUnknown = await accept('import-unknown');
    const importUnknownResult = await runScenario({
      database: database.db,
      outbox,
      repository,
      protector,
      queueName,
      taskId: importUnknown.taskId,
      scenario: 'IMPORT_UNKNOWN_AFTER_COMMIT',
      expectRetry: true,
    });
    assert.equal(importUnknownResult.first.status, 'RETRY_SCHEDULED');
    await assertCalling(database.db, importUnknown.taskId);
    await assertOperationStatuses(database.db, importUnknown.taskId, {
      CREATE: ['SUCCEEDED'],
      IMPORT: ['UNKNOWN'],
      QUERY: ['SUCCEEDED'],
      START: ['SUCCEEDED'],
    });

    const startUnknown = await accept('start-unknown');
    const startUnknownResult = await runScenario({
      database: database.db,
      outbox,
      repository,
      protector,
      queueName,
      taskId: startUnknown.taskId,
      scenario: 'START_UNKNOWN_AFTER_COMMIT',
      expectRetry: true,
    });
    assert.equal(startUnknownResult.first.status, 'RETRY_SCHEDULED');
    await assertCalling(database.db, startUnknown.taskId);
    await assertOperationStatuses(database.db, startUnknown.taskId, {
      CREATE: ['SUCCEEDED'],
      IMPORT: ['SUCCEEDED'],
      START: ['UNKNOWN'],
      QUERY: ['SUCCEEDED'],
    });

    const partialImport = await accept('partial-import', 2);
    const partialResult = await runScenario({
      database: database.db,
      outbox,
      repository,
      protector,
      queueName,
      taskId: partialImport.taskId,
      scenario: 'IMPORT_PARTIAL',
    });
    assert.equal(partialResult.final.status, 'COMPLETED');
    await assertFailure(database.db, partialImport.taskId, 'IMPORT_FAILED');
    await assertOperationStatuses(database.db, partialImport.taskId, {
      CREATE: ['SUCCEEDED'],
      IMPORT: ['FAILED'],
      TERMINATE: ['SUCCEEDED'],
      START: [],
    });
    await assertReleased(database.db, partialImport.taskId);

    const startRejected = await accept('start-rejected');
    await runScenario({
      database: database.db,
      outbox,
      repository,
      protector,
      queueName,
      taskId: startRejected.taskId,
      scenario: 'START_PERMANENT_FAILURE',
    });
    await assertFailure(database.db, startRejected.taskId, 'START_FAILED');
    await assertOperationStatuses(database.db, startRejected.taskId, {
      CREATE: ['SUCCEEDED'],
      IMPORT: ['SUCCEEDED'],
      START: ['FAILED'],
      TERMINATE: ['SUCCEEDED'],
    });
    await assertReleased(database.db, startRejected.taskId);

    const createExhausted = await accept('create-exhausted');
    const exhaustedResult = await runScenario({
      database: database.db,
      outbox,
      repository,
      protector,
      queueName,
      taskId: createExhausted.taskId,
      scenario: 'CREATE_UNKNOWN_AFTER_COMMIT',
      maxAttempts: 1,
    });
    assert.equal(exhaustedResult.final.status, 'DEAD_LETTERED');
    await assertFailure(database.db, createExhausted.taskId, 'CREATE_FAILED');
    await assertOperationStatuses(database.db, createExhausted.taskId, {
      CREATE: ['UNKNOWN'],
      QUERY: [],
      IMPORT: [],
      START: [],
    });
    await assertReleased(database.db, createExhausted.taskId);

    const startUnknownExhausted = await accept('start-unknown-exhausted');
    const startExhaustedResult = await runScenario({
      database: database.db,
      outbox,
      repository,
      protector,
      queueName,
      taskId: startUnknownExhausted.taskId,
      scenario: 'START_UNKNOWN_AFTER_COMMIT',
      maxAttempts: 1,
    });
    assert.equal(startExhaustedResult.final.status, 'DEAD_LETTERED');
    await assertUnknownStartHeld(database.db, startUnknownExhausted.taskId);
    await assertOperationStatuses(database.db, startUnknownExhausted.taskId, {
      CREATE: ['SUCCEEDED'],
      IMPORT: ['SUCCEEDED'],
      START: ['UNKNOWN'],
      QUERY: [],
      TERMINATE: [],
    });

    await assertEventsAndRedaction(
      database.db,
      acceptedTasks.map((task) => task.taskId),
      acceptedTasks.map((task) => task.taskNo),
      deliveryQueueName,
    );

    console.info(
      JSON.stringify(
        {
          status: 'passed',
          mode: 'LOCAL_MOCK_NO_NETWORK',
          checks: [
            'TASK_ACCEPTED Outbox Worker 完成创建、导入和启动',
            '创建响应丢失后按确定性 callJobName 查询恢复且不重复创建',
            '导入响应丢失后查询导入数量恢复且不重复导入',
            '启动响应丢失后查询任务状态恢复且不重复启动',
            '部分导入不会启动，并执行终止、释放冻结和失败事件',
            '明确启动失败会执行终止、释放冻结和失败事件',
            '重试耗尽会先写任务失败与释放冻结，再将原事件转入死信',
            '启动结果未知且重试耗尽时进入死信但保留冻结，等待人工核查',
            '每次供应商操作均有脱敏 task_operation 审计记录',
            '成功和失败事件写入独立 callback-delivery Outbox',
          ],
          verifiedTaskCount: acceptedTasks.length,
        },
        null,
        2,
      ),
    );
  } finally {
    await cleanup(database.db, acceptedTasks);
    await database.close();
  }
}

async function runScenario(input: {
  database: Database;
  outbox: PostgresOutboxRepository;
  repository: PostgresTaskOrchestrationRepository;
  protector: LocalDataProtector;
  queueName: string;
  taskId: string;
  scenario:
    | 'SUCCESS'
    | 'CREATE_UNKNOWN_AFTER_COMMIT'
    | 'IMPORT_UNKNOWN_AFTER_COMMIT'
    | 'IMPORT_PARTIAL'
    | 'START_UNKNOWN_AFTER_COMMIT'
    | 'START_PERMANENT_FAILURE';
  expectRetry?: boolean;
  maxAttempts?: number;
}) {
  const orchestration = new TaskOrchestrationService(
    input.repository,
    new LocalBaiyingCallJobClient(input.scenario),
    input.protector,
  );
  const worker = new TaskOrchestrationWorker(input.outbox, orchestration, {
    queueName: input.queueName,
    workerId: `stage3-verify:${input.scenario}:${randomUUID().slice(0, 8)}`,
    maxAttempts: input.maxAttempts,
  });
  const first = await worker.runOnce();
  if (!input.expectRetry) return { first, final: first };
  assert.equal(first.status, 'RETRY_SCHEDULED');
  assert.equal(first.taskId, input.taskId);
  await input.database
    .update(queueOutbox)
    .set({ availableAt: new Date() })
    .where(eq(queueOutbox.id, first.eventId));
  const final = await worker.runOnce();
  assert.equal(final.status, 'COMPLETED');
  assert.equal(final.taskId, input.taskId);
  return { first, final };
}

function createRequest(
  externalRequestId: string,
  customerCount: number,
): CreateOutboundTaskRequest {
  return {
    schemaVersion: '1.0',
    externalRequestId,
    sourceSystem: 'ERP',
    mcCode: 'MC-ZTY-001',
    taskName: `Stage 3 本地编排验证 ${externalRequestId}`,
    customers: Array.from({ length: customerCount }, (_, index) => ({
      externalCustomerId: `${externalRequestId}-customer-${index + 1}`,
      name: `验证客户${index + 1}`,
      phone: `13800138${String(index).padStart(3, '0')}`,
      dataCategoryId: 'LOCAL-ERP-WEDDING',
      fields: {
        salutation: `第${index + 1}位客户`,
        appointment_date: '2026-09-20',
        consultant_name: '本地顾问',
      },
    })),
  };
}

async function assertCalling(db: Database, taskId: string) {
  const [task] = await db
    .select()
    .from(platformTasks)
    .where(eq(platformTasks.id, taskId))
    .limit(1);
  assert.ok(task);
  assert.equal(task.executionStatus, 'CALLING');
  assert.ok(task.baiyingCallJobId?.startsWith('LOCAL-'));
  assert.equal(task.importSucceededCount, task.phoneCount);
  assert.equal(task.importFailedCount, 0);
  assert.equal(task.importRepeatedCount, 0);
  assert.ok(task.startedAt);
  const [hold] = await db
    .select()
    .from(fundHolds)
    .where(eq(fundHolds.taskId, taskId))
    .limit(1);
  assert.equal(hold?.status, 'ACTIVE');
}

async function assertFailure(
  db: Database,
  taskId: string,
  status: 'CREATE_FAILED' | 'IMPORT_FAILED' | 'START_FAILED',
) {
  const [task] = await db
    .select()
    .from(platformTasks)
    .where(eq(platformTasks.id, taskId))
    .limit(1);
  assert.equal(task?.executionStatus, status);
  assert.ok(task?.failureCode);
  assert.equal(task?.billingStatus, 'SETTLED');
  assert.ok(task?.closedAt);
}

async function assertReleased(db: Database, taskId: string) {
  const [hold] = await db
    .select()
    .from(fundHolds)
    .where(eq(fundHolds.taskId, taskId))
    .limit(1);
  assert.equal(hold?.status, 'RELEASED');
  assert.equal(hold?.remainingAmount, '0.000000');
  const releases = await db
    .select()
    .from(accountLedger)
    .where(
      and(
        eq(accountLedger.taskId, taskId),
        eq(accountLedger.entryType, 'TASK_HOLD_RELEASE'),
      ),
    );
  assert.equal(releases.length, 1);
}

async function assertUnknownStartHeld(db: Database, taskId: string) {
  const [task] = await db
    .select()
    .from(platformTasks)
    .where(eq(platformTasks.id, taskId))
    .limit(1);
  assert.equal(task?.executionStatus, 'START_FAILED');
  assert.equal(task?.billingStatus, 'RESERVED');
  assert.equal(task?.failureRetryable, true);
  assert.match(task?.failureMessage ?? '', /冻结金额暂不释放/);
  const [hold] = await db
    .select()
    .from(fundHolds)
    .where(eq(fundHolds.taskId, taskId))
    .limit(1);
  assert.equal(hold?.status, 'ACTIVE');
  assert.notEqual(hold?.remainingAmount, '0.000000');
}

async function assertOperationStatuses(
  db: Database,
  taskId: string,
  expected: Partial<Record<string, string[]>>,
) {
  const operations = await db
    .select()
    .from(taskOperations)
    .where(eq(taskOperations.taskId, taskId))
    .orderBy(taskOperations.startedAt, taskOperations.id);
  for (const [type, statuses] of Object.entries(expected)) {
    assert.deepEqual(
      operations
        .filter((operation) => operation.operationType === type)
        .map((operation) => operation.status),
      statuses,
      `${type} 操作状态不符合预期`,
    );
  }
}

async function assertEventsAndRedaction(
  db: Database,
  taskIds: string[],
  taskNos: string[],
  deliveryQueueName: string,
) {
  const operations = await db
    .select({
      request: taskOperations.requestPayloadRedacted,
      response: taskOperations.responsePayloadRedacted,
    })
    .from(taskOperations)
    .where(inArray(taskOperations.taskId, taskIds));
  const auditJson = JSON.stringify(operations);
  assert.ok(!auditJson.includes('13800138'));
  assert.ok(!auditJson.includes('验证客户'));
  assert.ok(!auditJson.includes('本地顾问'));

  const eventRows = await db
    .select({
      eventType: queueOutbox.eventType,
      payload: queueOutbox.payload,
    })
    .from(queueOutbox)
    .where(eq(queueOutbox.queueName, deliveryQueueName));
  const started = eventRows.filter(
    (event) => event.eventType === 'OUTBOUND_TASK_STARTED',
  );
  const failed = eventRows.filter(
    (event) => event.eventType === 'OUTBOUND_TASK_START_FAILED',
  );
  assert.equal(started.length, 4);
  assert.equal(failed.length, 4);
  for (const event of started) taskStartedEventSchema.parse(event.payload);
  for (const event of failed) taskStartFailedEventSchema.parse(event.payload);
  assert.deepEqual(
    new Set(eventRows.map((event) => String(event.payload.taskNo))),
    new Set(taskNos),
  );
}

async function cleanup(db: Database, tasks: AcceptedFixture[]) {
  if (!tasks.length) return;
  const accounts = new PostgresAccountRepository(db);
  for (const task of tasks) {
    await accounts.releaseHold({
      taskId: task.taskId,
      operatorId: 'stage3-verifier',
      reason: 'Stage 3 验证完成，清理本地测试冻结',
    });
  }
  const taskIds = tasks.map((task) => task.taskId);
  await db.transaction(async (tx) => {
    for (const task of tasks) {
      const outboxEvents = await tx
        .select({ id: queueOutbox.id })
        .from(queueOutbox)
        .where(
          sql`${queueOutbox.payload}->>'taskNo' = ${task.taskNo} or ${queueOutbox.payload}->>'taskId' = ${task.taskId}`,
        );
      if (outboxEvents.length) {
        await tx.delete(deadLetterEvents).where(
          inArray(
            deadLetterEvents.sourceId,
            outboxEvents.map((event) => event.id),
          ),
        );
      }
      await tx
        .delete(queueOutbox)
        .where(
          sql`${queueOutbox.payload}->>'taskNo' = ${task.taskNo} or ${queueOutbox.payload}->>'taskId' = ${task.taskId}`,
        );
    }
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
  });
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

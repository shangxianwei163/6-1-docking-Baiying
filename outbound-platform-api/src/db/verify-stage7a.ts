import 'dotenv/config';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  createOutboundTaskRequestSchema,
  externalApiErrorSchema,
  taskAcceptedEnvelopeSchema,
  type CreateOutboundTaskRequest,
} from '@outbound/contracts';
import { LocalBaiyingCallJobClient } from '../baiying/local-call-job-client.js';
import { BaiyingCallbackIngressService } from '../callback/ingress-service.js';
import { PostgresCallbackInboxRepository } from '../callback/postgres-repository.js';
import type { BaiyingCallbackProcessor } from '../callback/processor.js';
import { BaiyingCallbackWorker } from '../callback/worker.js';
import { readConfig } from '../config.js';
import { createApp } from '../http/app.js';
import { PostgresMappingRepository } from '../mapping/postgres-repository.js';
import { PostgresExternalRequestAuthenticator } from '../openapi/authenticator.js';
import { TaskOrchestrationService } from '../orchestration/service.js';
import { PostgresTaskOrchestrationRepository } from '../orchestration/postgres-repository.js';
import { TaskOrchestrationWorker } from '../orchestration/worker.js';
import { PostgresOutboundTaskService } from '../outbound-task/service.js';
import { PostgresOutboxRepository } from '../outbox/postgres-repository.js';
import { LocalDataProtector } from '../security/data-protector.js';
import { signRequest } from '../security/request-signature.js';
import { LocalDevelopmentSecretProvider } from '../security/secret-provider.js';
import { createDatabase, type Database } from './client.js';
import {
  accountLedger,
  apiRequestNonces,
  baiyingLineStudioBindings,
  baiyingPhoneLines,
  baiyingSceneCompanies,
  baiyingScenes,
  callbackInbox,
  deadLetterEvents,
  fundHolds,
  idempotencyRecords,
  integrationClients,
  integrationClientStudios,
  integrationEndpoints,
  mappingRules,
  mappingVersions,
  platformTasks,
  queueOutbox,
  sceneMappingReadiness,
  scriptBindings,
  scriptCategoryBindings,
  sourceDataCategories,
  studioAccounts,
  studioPricingVersions,
  studios,
  taskCallItems,
  taskMappingSnapshots,
  taskOperations,
} from './schema.js';

const CAPACITY_CUSTOMERS = 10_000;
const BUSINESS_FIELDS_PER_CUSTOMER = 20;
const CONCURRENT_REQUESTS = 50;
const IDEMPOTENT_REPLAYS = 20;
const CALLBACK_BURST = 10_000;
const CALLBACK_CONCURRENCY = 10;
const CALLBACK_BUDGET_MS = 60_000;
const CALLBACK_P95_BUDGET_MS = 500;
const ORCHESTRATION_BUDGET_MS = 30_000;
const STANDARD_ACCEPTANCE_P95_BUDGET_MS = 2_000;
const baseUrl = 'http://stage7.local';

type Fixture = {
  suffix: string;
  studioId: string;
  businessCode: string;
  mcCode: string;
  clientDatabaseId: string;
  clientId: string;
  endpointId: string;
  pricingId: string;
  mappingVersionId: string;
  categoryId: string;
  scriptBindingId: string;
  robotDefId: string;
  sceneDefId: string;
  lineId: string;
  orchestrationQueue: string;
  deliveryQueue: string;
  callbackProvider: string;
};

async function main() {
  const config = readConfig();
  if (config.NODE_ENV === 'production') {
    throw new Error('生产环境禁止运行 Stage 7A 本地容量与并发验证');
  }

  const database = createDatabase(config.DATABASE_URL);
  const fixture = makeFixture();
  const memoryBefore = process.memoryUsage().rss;

  try {
    await insertFixture(database.db, fixture);
    const protector = new LocalDataProtector(
      config.WORKER_SHARED_SECRET,
      config.NODE_ENV,
    );
    const secrets = new LocalDevelopmentSecretProvider(
      config.WORKER_SHARED_SECRET,
      config.NODE_ENV,
    );
    const taskService = new PostgresOutboundTaskService(
      database.db,
      protector,
      {
        baiyingCompanyId: 'LOCAL-MOCK',
        queueName: fixture.orchestrationQueue,
      },
    );
    const app = createApp({
      mappingRepository: new PostgresMappingRepository(
        database.db,
        `stage7-variable-sync-${fixture.suffix}`,
      ),
      consoleOrigin: config.CONSOLE_ORIGIN,
      workerSharedSecret: config.WORKER_SHARED_SECRET,
      externalRequestAuthenticator: new PostgresExternalRequestAuthenticator(
        database.db,
        secrets,
      ),
      outboundTaskService: taskService,
    });
    const secret = await secrets.getSecretBytes(
      `local-hkdf://${fixture.clientId}`,
    );

    const capacityRequest = createCapacityRequest(fixture);
    assert.equal(
      Object.keys(capacityRequest.customers[0]!.fields).length,
      BUSINESS_FIELDS_PER_CUSTOMER,
    );
    assert.equal(capacityRequest.customers.length, CAPACITY_CUSTOMERS);
    createOutboundTaskRequestSchema.parse(capacityRequest);
    const overLimit = createOutboundTaskRequestSchema.safeParse({
      ...capacityRequest,
      customers: [
        ...capacityRequest.customers,
        {
          ...createCustomer(CAPACITY_CUSTOMERS),
          dataCategoryId: fixture.categoryId,
        },
      ],
    });
    assert.equal(overLimit.success, false, '10,001 条客户必须被契约拒绝');
    assert.ok(
      !overLimit.success &&
        overLimit.error.issues.some(
          (issue) => issue.code === 'too_big' && issue.path[0] === 'customers',
        ),
      '10,001 条必须因为 customers 数量上限而被拒绝',
    );

    const capacityRawBody = Buffer.from(JSON.stringify(capacityRequest));
    const capacityStarted = performance.now();
    const capacityResponse = await signedRequest({
      app,
      secret,
      fixture,
      rawBody: capacityRawBody,
      idempotencyKey: `stage7-capacity-${fixture.suffix}`,
    });
    const capacityAcceptanceMs = performance.now() - capacityStarted;
    assert.equal(capacityResponse.status, 202);
    const capacityAccepted = taskAcceptedEnvelopeSchema.parse(
      await capacityResponse.json(),
    );
    assert.equal(capacityAccepted.data.phoneCount, CAPACITY_CUSTOMERS);
    assert.equal(capacityAccepted.data.reservedAmount, '10000.000000');

    const capacityCounts = await taskCounts(
      database.db,
      capacityAccepted.data.taskId,
    );
    assert.deepEqual(capacityCounts, {
      tasks: 1,
      callItems: CAPACITY_CUSTOMERS,
      holds: 1,
      ledgers: 1,
      idempotency: 1,
      acceptedOutbox: 1,
    });
    const [sampleEncryptedItem] = await database.db
      .select({
        phoneCiphertext: taskCallItems.phoneCiphertext,
        sourceFieldsCiphertext: taskCallItems.sourceFieldsCiphertext,
      })
      .from(taskCallItems)
      .where(eq(taskCallItems.taskId, capacityAccepted.data.taskId))
      .limit(1);
    assert.ok(sampleEncryptedItem);
    assert.ok(!sampleEncryptedItem.phoneCiphertext.includes('13100000000'));
    assert.ok(!sampleEncryptedItem.sourceFieldsCiphertext.includes('字段值'));

    const orchestrationStarted = performance.now();
    const orchestrationWorker = new TaskOrchestrationWorker(
      new PostgresOutboxRepository(database.db),
      new TaskOrchestrationService(
        new PostgresTaskOrchestrationRepository(database.db, {
          deliveryQueueName: fixture.deliveryQueue,
        }),
        new LocalBaiyingCallJobClient('SUCCESS'),
        protector,
      ),
      {
        queueName: fixture.orchestrationQueue,
        workerId: `stage7-orchestration-${fixture.suffix}`,
      },
    );
    const orchestration = await orchestrationWorker.runOnce();
    const orchestrationMs = performance.now() - orchestrationStarted;
    assert.equal(orchestration.status, 'COMPLETED');
    if (orchestration.status !== 'COMPLETED') {
      throw new Error('Stage 7A 容量任务编排未完成');
    }
    assert.equal(orchestration.taskId, capacityAccepted.data.taskId);
    assert.ok(
      orchestrationMs <= ORCHESTRATION_BUDGET_MS,
      `10,000 条本地编排耗时 ${formatMs(orchestrationMs)}，超过 ${formatMs(ORCHESTRATION_BUDGET_MS)}`,
    );
    const [orchestratedTask] = await database.db
      .select({
        executionStatus: platformTasks.executionStatus,
        imported: platformTasks.importSucceededCount,
      })
      .from(platformTasks)
      .where(eq(platformTasks.id, capacityAccepted.data.taskId));
    assert.deepEqual(orchestratedTask, {
      executionStatus: 'CALLING',
      imported: CAPACITY_CUSTOMERS,
    });

    const replayRequest = createSmallRequest(
      fixture,
      `idempotent-${fixture.suffix}`,
      0,
    );
    const replayRawBody = Buffer.from(JSON.stringify(replayRequest));
    const replayResponses = await Promise.all(
      Array.from({ length: IDEMPOTENT_REPLAYS }, () =>
        signedRequest({
          app,
          secret,
          fixture,
          rawBody: replayRawBody,
          idempotencyKey: `stage7-idempotent-${fixture.suffix}`,
        }),
      ),
    );
    assert.ok(replayResponses.every((response) => response.status === 202));
    assert.equal(
      replayResponses.filter(
        (response) => response.headers.get('idempotent-replayed') === 'true',
      ).length,
      IDEMPOTENT_REPLAYS - 1,
    );
    const replayedBodies = await Promise.all(
      replayResponses.map(async (response) =>
        taskAcceptedEnvelopeSchema.parse(await response.json()),
      ),
    );
    assert.equal(
      new Set(replayedBodies.map((body) => body.data.taskId)).size,
      1,
      '并发同键请求必须只生成一个任务',
    );

    const concurrentStarted = performance.now();
    const concurrentResults = await Promise.all(
      Array.from({ length: CONCURRENT_REQUESTS }, async (_, index) => {
        const request = createSmallRequest(
          fixture,
          `balance-${fixture.suffix}-${index}`,
          index + 1,
        );
        const started = performance.now();
        const response = await signedRequest({
          app,
          secret,
          fixture,
          rawBody: Buffer.from(JSON.stringify(request)),
          idempotencyKey: `stage7-balance-${fixture.suffix}-${index}`,
        });
        return { response, elapsedMs: performance.now() - started };
      }),
    );
    const concurrentMs = performance.now() - concurrentStarted;
    const concurrentP95Ms = percentile(
      Float64Array.from(concurrentResults.map((result) => result.elapsedMs)),
      0.95,
    );
    assert.ok(
      concurrentP95Ms <= STANDARD_ACCEPTANCE_P95_BUDGET_MS,
      `普通任务本地受理 P95 ${formatMs(concurrentP95Ms)}，超过 ${formatMs(STANDARD_ACCEPTANCE_P95_BUDGET_MS)}`,
    );
    const concurrentResponses = concurrentResults.map(
      (result) => result.response,
    );
    const acceptedResponses = concurrentResponses.filter(
      (response) => response.status === 202,
    );
    const rejectedResponses = concurrentResponses.filter(
      (response) => response.status === 409,
    );
    assert.equal(acceptedResponses.length, 25);
    assert.equal(rejectedResponses.length, 25);
    for (const response of rejectedResponses) {
      const body = externalApiErrorSchema.parse(await response.json());
      assert.equal(body.code, 'INSUFFICIENT_BALANCE');
    }
    const aggregate = await aggregateTaskState(database.db, fixture);
    assert.deepEqual(aggregate, {
      tasks: 27,
      callItems: 10_026,
      holds: 27,
      holdLedgers: 27,
      idempotency: 27,
      balance: '10026.000000',
      activeHoldAmount: '10026.000000',
      availableBalance: '0.000000',
    });

    const callbackMetrics = await verifyCallbackBurst(
      database.db,
      protector,
      fixture,
      capacityAccepted.data.taskId,
    );
    const memoryAfter = process.memoryUsage().rss;

    console.info(
      JSON.stringify(
        {
          status: 'passed',
          mode: 'LOCAL_POSTGRES_NO_NETWORK',
          workload: {
            capacityCustomers: CAPACITY_CUSTOMERS,
            businessFieldsPerCustomer: BUSINESS_FIELDS_PER_CUSTOMER,
            concurrentRequests: CONCURRENT_REQUESTS,
            idempotentReplays: IDEMPOTENT_REPLAYS,
            callbackBurst: CALLBACK_BURST,
            callbackWorkers: CALLBACK_CONCURRENCY,
          },
          timings: {
            capacityAcceptanceMs: rounded(capacityAcceptanceMs),
            capacityOrchestrationMs: rounded(orchestrationMs),
            concurrentBatchMs: rounded(concurrentMs),
            concurrentAcceptanceP95Ms: rounded(concurrentP95Ms),
            callbackIngressMs: rounded(callbackMetrics.ingressMs),
            callbackIngressP95Ms: rounded(callbackMetrics.ingressP95Ms),
            callbackDrainMs: rounded(callbackMetrics.drainMs),
            callbackEndToEndMs: rounded(callbackMetrics.endToEndMs),
          },
          memory: {
            rssBeforeMiB: bytesToMiB(memoryBefore),
            rssAfterMiB: bytesToMiB(memoryAfter),
            rssDeltaMiB: bytesToMiB(Math.max(0, memoryAfter - memoryBefore)),
          },
          checks: [
            '10,000 条、每条 20 个业务字段通过 HTTP 受理并原子落库',
            '10,001 条在共享契约层被拒绝',
            '10,000 条客户由本地零网络百应适配器完成创建、导入和启动',
            '20 个同幂等键并发请求只生成一个任务和一笔冻结',
            '50 个并发任务在仅够 25 个任务的余额下严格 25 成功、25 拒绝',
            '普通任务本地受理 P95 不超过 2 秒',
            '10,000 个回调在 1 分钟预算内完成 Inbox 写入和并发积压恢复',
            '回调写入 P95 不超过 500 ms，精确重复不会新增 Inbox',
          ],
        },
        null,
        2,
      ),
    );
  } finally {
    await cleanup(database.db, fixture);
    await database.close();
  }
}

async function verifyCallbackBurst(
  db: Database,
  protector: LocalDataProtector,
  fixture: Fixture,
  taskId: string,
) {
  const repository = new PostgresCallbackInboxRepository(db, {
    provider: fixture.callbackProvider,
  });
  const ingress = new BaiyingCallbackIngressService(repository, protector);
  const latencies = new Float64Array(CALLBACK_BURST);
  const ingressStarted = performance.now();
  await runConcurrent(CALLBACK_BURST, CALLBACK_CONCURRENCY, async (index) => {
    const started = performance.now();
    const result = await ingress.ingest({
      rawBody: callbackBody(fixture.suffix, index),
      headers: new Headers({
        'content-type': 'application/json',
        'user-agent': 'stage7-local-load-verifier',
      }),
    });
    latencies[index] = performance.now() - started;
    assert.equal(result.replayed, false);
  });
  const ingressMs = performance.now() - ingressStarted;
  const ingressP95Ms = percentile(latencies, 0.95);
  assert.ok(
    ingressP95Ms <= CALLBACK_P95_BUDGET_MS,
    `回调 Inbox 写入 P95 ${formatMs(ingressP95Ms)}，超过 ${formatMs(CALLBACK_P95_BUDGET_MS)}`,
  );

  const duplicateResults = await Promise.all(
    Array.from({ length: 16 }, () =>
      ingress.ingest({
        rawBody: callbackBody(fixture.suffix, 0),
        headers: new Headers({ 'content-type': 'application/json' }),
      }),
    ),
  );
  assert.ok(duplicateResults.every((result) => result.replayed));
  const [pending] = await db.execute<{ total: number }>(sql`
    select count(*)::int as total
    from ${callbackInbox}
    where ${callbackInbox.provider} = ${fixture.callbackProvider}
      and ${callbackInbox.processStatus} = 'PENDING'
  `);
  assert.equal(pending?.total, CALLBACK_BURST);

  const processor: BaiyingCallbackProcessor = {
    async process(_inboxId, callback) {
      return {
        callbackType: callback.callbackType,
        taskId,
        duplicate: false,
        settled: false,
      };
    },
  };
  let processed = 0;
  const drainStarted = performance.now();
  await Promise.all(
    Array.from({ length: CALLBACK_CONCURRENCY }, async (_, workerIndex) => {
      const worker = new BaiyingCallbackWorker(
        repository,
        processor,
        protector,
        {
          workerId: `stage7-callback-${fixture.suffix}-${workerIndex}`,
          maxAttempts: 1,
          retryDelaysMs: [0],
        },
      );
      while (true) {
        const result = await worker.runOnce();
        if (result.status === 'IDLE') return;
        assert.equal(result.status, 'SUCCEEDED');
        processed += 1;
      }
    }),
  );
  const drainMs = performance.now() - drainStarted;
  const endToEndMs = ingressMs + drainMs;
  assert.equal(processed, CALLBACK_BURST);
  assert.ok(
    endToEndMs <= CALLBACK_BUDGET_MS,
    `10,000 个回调写入并清空积压耗时 ${formatMs(endToEndMs)}，超过 1 分钟预算`,
  );
  const [completed] = await db.execute<{
    total: number;
    succeeded: number;
    attempts: number;
  }>(sql`
    select
      count(*)::int as total,
      count(*) filter (where ${callbackInbox.processStatus} = 'SUCCEEDED')::int as succeeded,
      sum(${callbackInbox.processAttempts})::int as attempts
    from ${callbackInbox}
    where ${callbackInbox.provider} = ${fixture.callbackProvider}
  `);
  assert.deepEqual(completed, {
    total: CALLBACK_BURST,
    succeeded: CALLBACK_BURST,
    attempts: CALLBACK_BURST,
  });
  return { ingressMs, ingressP95Ms, drainMs, endToEndMs };
}

async function signedRequest(input: {
  app: ReturnType<typeof createApp>;
  secret: Buffer;
  fixture: Fixture;
  rawBody: Buffer;
  idempotencyKey: string;
}) {
  const timestamp = String(Date.now());
  const nonce = randomUUID();
  const path = '/openapi/v1/outbound/tasks';
  const url = `${baseUrl}${path}`;
  const signature = signRequest(
    {
      method: 'POST',
      url,
      timestamp,
      nonce,
      rawBody: input.rawBody,
    },
    input.secret,
  );
  return input.app.request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': String(input.rawBody.byteLength),
      'x-client-id': input.fixture.clientId,
      'x-timestamp': timestamp,
      'x-nonce': nonce,
      'x-signature': signature,
      'idempotency-key': input.idempotencyKey,
      'x-request-id': `stage7-${randomUUID()}`,
    },
    body: input.rawBody.toString('utf8'),
  });
}

function createCapacityRequest(fixture: Fixture): CreateOutboundTaskRequest {
  return {
    schemaVersion: '1.0',
    externalRequestId: `capacity-${fixture.suffix}`,
    sourceSystem: 'ERP',
    mcCode: fixture.mcCode,
    taskName: `Stage 7A 10,000 条容量验证 ${fixture.suffix}`,
    customers: Array.from({ length: CAPACITY_CUSTOMERS }, (_, index) => ({
      ...createCustomer(index),
      dataCategoryId: fixture.categoryId,
    })),
  };
}

function createSmallRequest(
  fixture: Fixture,
  externalRequestId: string,
  index: number,
): CreateOutboundTaskRequest {
  return {
    schemaVersion: '1.0',
    externalRequestId,
    sourceSystem: 'ERP',
    mcCode: fixture.mcCode,
    taskName: `Stage 7A 并发验证 ${index}`,
    customers: [
      {
        ...createCustomer(CAPACITY_CUSTOMERS + index),
        externalCustomerId: `${externalRequestId}-customer`,
        dataCategoryId: fixture.categoryId,
      },
    ],
  };
}

function createCustomer(index: number) {
  const serial = String(index).padStart(5, '0');
  const fields: Record<string, string> = {
    salutation: `容量客户${serial}`,
    appointment_date: '2026-09-20',
    consultant_name: 'Stage7本地顾问',
  };
  for (let field = 4; field <= BUSINESS_FIELDS_PER_CUSTOMER; field += 1) {
    fields[`field_${String(field).padStart(2, '0')}`] =
      `字段值-${serial}-${field}`;
  }
  return {
    externalCustomerId: `stage7-customer-${serial}`,
    name: `容量客户${serial}`,
    phone: String(13_100_000_000 + index),
    dataCategoryId: '',
    fields,
  };
}

function callbackBody(suffix: string, index: number): string {
  return JSON.stringify({
    code: 200,
    data: {
      callbackType: 'JOB_INFO_RESULT',
      data: {
        companyId: 'LOCAL-MOCK',
        callJobId: `STAGE7-BURST-${suffix}-${index}`,
        callJobStatus: 1,
        updateTime: '2026-09-06 21:00:00',
      },
    },
    resultMsg: '成功',
  });
}

async function taskCounts(db: Database, taskId: string) {
  const [counts] = await db.execute<{
    tasks: number;
    callItems: number;
    holds: number;
    ledgers: number;
    idempotency: number;
    acceptedOutbox: number;
  }>(sql`
    select
      (select count(*)::int from ${platformTasks} where ${platformTasks.id} = ${taskId}) as tasks,
      (select count(*)::int from ${taskCallItems} where ${taskCallItems.taskId} = ${taskId}) as "callItems",
      (select count(*)::int from ${fundHolds} where ${fundHolds.taskId} = ${taskId}) as holds,
      (select count(*)::int from ${accountLedger} where ${accountLedger.taskId} = ${taskId}) as ledgers,
      (select count(*)::int from ${idempotencyRecords} where ${idempotencyRecords.taskId} = ${taskId}) as idempotency,
      (select count(*)::int from ${queueOutbox} where ${queueOutbox.eventType} = 'TASK_ACCEPTED' and ${queueOutbox.payload}->>'taskId' = ${taskId}) as "acceptedOutbox"
  `);
  assert.ok(counts);
  return counts;
}

async function aggregateTaskState(db: Database, fixture: Fixture) {
  const [state] = await db.execute<{
    tasks: number;
    callItems: number;
    holds: number;
    holdLedgers: number;
    idempotency: number;
    balance: string;
    activeHoldAmount: string;
    availableBalance: string;
  }>(sql`
    select
      (select count(*)::int from ${platformTasks} where ${platformTasks.integrationClientId} = ${fixture.clientDatabaseId}) as tasks,
      (select count(*)::int from ${taskCallItems} item inner join ${platformTasks} task on task.id = item.task_id where task.integration_client_id = ${fixture.clientDatabaseId}) as "callItems",
      (select count(*)::int from ${fundHolds} hold_row inner join ${platformTasks} task on task.id = hold_row.task_id where task.integration_client_id = ${fixture.clientDatabaseId}) as holds,
      (select count(*)::int from ${accountLedger} ledger inner join ${platformTasks} task on task.id = ledger.task_id where task.integration_client_id = ${fixture.clientDatabaseId} and ledger.entry_type = 'TASK_HOLD') as "holdLedgers",
      (select count(*)::int from ${idempotencyRecords} where ${idempotencyRecords.clientId} = ${fixture.clientId}) as idempotency,
      account.balance,
      account.active_hold_amount as "activeHoldAmount",
      (account.balance - account.active_hold_amount)::numeric(18, 6) as "availableBalance"
    from ${studioAccounts} account
    where account.studio_id = ${fixture.studioId}
  `);
  assert.ok(state);
  return state;
}

function makeFixture(): Fixture {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
  return {
    suffix,
    studioId: randomUUID(),
    businessCode: `S7-${suffix}`,
    mcCode: `MC-S7-${suffix}`,
    clientDatabaseId: randomUUID(),
    clientId: `stage7-erp-${suffix}`,
    endpointId: randomUUID(),
    pricingId: randomUUID(),
    mappingVersionId: randomUUID(),
    categoryId: `S7-CATEGORY-${suffix}`,
    scriptBindingId: randomUUID(),
    robotDefId: `S7-ROBOT-${suffix}`,
    sceneDefId: `S7-SCENE-${suffix}`,
    lineId: `S7-LINE-${suffix}`,
    orchestrationQueue: `stage7-orchestration-${suffix}`,
    deliveryQueue: `stage7-delivery-${suffix}`,
    callbackProvider: `BAIYING_STAGE7_${suffix}`,
  };
}

async function insertFixture(db: Database, fixture: Fixture) {
  const now = new Date();
  const variables = ['客户称呼', '预约日期', '顾问姓名'];
  const variablesHash = createHash('sha256')
    .update(JSON.stringify([...variables].sort()), 'utf8')
    .digest('hex');
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended('stage7-mapping-version', 0))`,
    );
    const [versionRow] = await tx.execute<{ nextVersion: number }>(sql`
      select coalesce(max(${mappingVersions.version}), 0)::int + 1 as "nextVersion"
      from ${mappingVersions}
    `);
    assert.ok(versionRow);

    await tx.insert(studios).values({
      id: fixture.studioId,
      businessCode: fixture.businessCode,
      mcCode: fixture.mcCode,
      name: 'Stage 7A 隔离容量影楼',
      status: 'ACTIVE',
      createdBy: 'stage7-verifier',
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(studioAccounts).values({
      studioId: fixture.studioId,
      balance: '10026.000000',
      activeHoldAmount: '0.000000',
      status: 'ACTIVE',
      updatedAt: now,
    });
    await tx.insert(integrationClients).values({
      id: fixture.clientDatabaseId,
      clientId: fixture.clientId,
      sourceSystem: 'ERP',
      displayName: 'Stage 7A 隔离 ERP 客户端',
      secretRef: `local-hkdf://${fixture.clientId}`,
      status: 'ACTIVE',
      rateLimitPerMinute: 1_000,
      createdBy: 'stage7-verifier',
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(integrationClientStudios).values({
      integrationClientId: fixture.clientDatabaseId,
      studioId: fixture.studioId,
      createdAt: now,
    });
    await tx.insert(integrationEndpoints).values({
      id: fixture.endpointId,
      studioId: fixture.studioId,
      sourceSystem: 'ERP',
      version: 1,
      resultUrl: 'https://erp.mock.invalid/stage7/result',
      recordingUrl: 'https://erp.mock.invalid/stage7/recording',
      signingSecretRef: `local-hkdf://callback:${fixture.clientId}`,
      status: 'ACTIVE',
      effectiveAt: now,
      createdBy: 'stage7-verifier',
      createdAt: now,
    });
    await tx.insert(studioPricingVersions).values({
      id: fixture.pricingId,
      studioId: fixture.studioId,
      version: 1,
      voiceRate: '1.000000',
      smsRate: '0.000000',
      frozenMinutes: 1,
      sourceMode: 'PER_STUDIO',
      status: 'ACTIVE',
      effectiveFrom: new Date(now.getTime() - 60_000),
      publishedBy: 'stage7-verifier',
      publishedAt: now,
    });
    await tx.insert(sourceDataCategories).values({
      sourceSystem: 'ERP',
      externalId: fixture.categoryId,
      name: 'Stage 7A 容量分类',
      categoryPath: `本地验收/Stage7/${fixture.suffix}`,
      level: 3,
      active: true,
      fields: { fixture: 'STAGE7_LOCAL_CAPACITY' },
      syncedAt: now,
    });
    await tx.insert(baiyingPhoneLines).values({
      userPhoneId: fixture.lineId,
      phone: '01000000000',
      phoneName: 'Stage 7A 零网络线路',
      phoneType: 1,
      sceneType: 1,
      rateType: 1,
      localSellingRate: 0,
      nonlocalSellingRate: 0,
      lineAmount: 0,
      billPeriod: 60,
      syncedAt: now,
    });
    await tx.insert(baiyingLineStudioBindings).values({
      userPhoneId: fixture.lineId,
      studioId: fixture.businessCode,
      studioName: 'Stage 7A 隔离容量影楼',
      updatedBy: 'stage7-verifier',
      updatedAt: now,
    });
    await tx.insert(mappingVersions).values({
      id: fixture.mappingVersionId,
      version: Number(versionRow.nextVersion),
      publisherId: 'stage7-verifier',
      changeSummary: `STAGE7_LOCAL_CAPACITY_${fixture.suffix}`,
      publishedAt: now,
    });
    await tx.insert(mappingRules).values([
      {
        mappingVersionId: fixture.mappingVersionId,
        baiyingVariableName: '客户称呼',
        erpField: 'salutation',
        transformConfig: { type: 'TEXT', mode: 'TRIM' },
        emptyPolicy: 'BLOCK',
        status: 'PUBLISHED',
        createdAt: now,
      },
      {
        mappingVersionId: fixture.mappingVersionId,
        baiyingVariableName: '预约日期',
        erpField: 'appointment_date',
        transformConfig: { type: 'DATE', outputFormat: 'YYYY年MM月DD日' },
        emptyPolicy: 'BLOCK',
        status: 'PUBLISHED',
        createdAt: now,
      },
      {
        mappingVersionId: fixture.mappingVersionId,
        baiyingVariableName: '顾问姓名',
        erpField: 'consultant_name',
        transformConfig: { type: 'TEXT', mode: 'TRIM' },
        emptyPolicy: 'BLOCK',
        status: 'PUBLISHED',
        createdAt: now,
      },
    ]);
    await tx.insert(baiyingScenes).values({
      sceneDefId: fixture.sceneDefId,
      robotDefId: fixture.robotDefId,
      sceneName: 'Stage 7A 零网络话术',
      disabled: false,
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(baiyingSceneCompanies).values({
      sceneDefId: fixture.sceneDefId,
      companyId: 'LOCAL-MOCK',
      enabled: true,
      createdAt: now,
    });
    await tx.insert(sceneMappingReadiness).values({
      sceneDefId: fixture.sceneDefId,
      status: 'ACTIVE',
      expectedVariablesHash: variablesHash,
      publishedMappingVersionId: fixture.mappingVersionId,
      variables,
      missingVariables: [],
      lastSuccessfulSyncAt: now,
      issueSummary: null,
      updatedAt: now,
    });
    await tx.insert(scriptBindings).values({
      id: fixture.scriptBindingId,
      robotDefId: fixture.robotDefId,
      studioId: fixture.studioId,
      sourceSystem: 'ERP',
      userPhoneId: fixture.lineId,
      status: 'ACTIVE',
      version: 1,
      createdBy: 'stage7-verifier',
      createdAt: now,
    });
    await tx.insert(scriptCategoryBindings).values({
      scriptBindingId: fixture.scriptBindingId,
      studioId: fixture.studioId,
      sourceSystem: 'ERP',
      sourceCategoryId: fixture.categoryId,
      categoryPath: `本地验收/Stage7/${fixture.suffix}`,
      active: true,
      createdAt: now,
    });
  });
}

async function cleanup(db: Database, fixture: Fixture) {
  const callbackRows = await db
    .select({ id: callbackInbox.id })
    .from(callbackInbox)
    .where(eq(callbackInbox.provider, fixture.callbackProvider));
  const callbackIds = callbackRows.map((callback) => callback.id);
  if (callbackIds.length) {
    await db
      .delete(deadLetterEvents)
      .where(
        and(
          eq(deadLetterEvents.sourceType, 'CALLBACK'),
          inArray(deadLetterEvents.sourceId, callbackIds),
        ),
      );
  }
  await db
    .delete(callbackInbox)
    .where(eq(callbackInbox.provider, fixture.callbackProvider));
  const tasks = await db
    .select({ id: platformTasks.id })
    .from(platformTasks)
    .where(eq(platformTasks.integrationClientId, fixture.clientDatabaseId));
  const taskIds = tasks.map((task) => task.id);
  const outboxRows = await db
    .select({ id: queueOutbox.id })
    .from(queueOutbox)
    .where(
      inArray(queueOutbox.queueName, [
        fixture.orchestrationQueue,
        fixture.deliveryQueue,
      ]),
    );
  const outboxIds = outboxRows.map((event) => event.id);

  await db.transaction(async (tx) => {
    if (outboxIds.length) {
      await tx
        .delete(deadLetterEvents)
        .where(inArray(deadLetterEvents.sourceId, outboxIds));
    }
    if (taskIds.length) {
      await tx
        .delete(accountLedger)
        .where(inArray(accountLedger.taskId, taskIds));
      await tx
        .delete(idempotencyRecords)
        .where(inArray(idempotencyRecords.taskId, taskIds));
      await tx
        .delete(taskOperations)
        .where(inArray(taskOperations.taskId, taskIds));
      await tx.delete(fundHolds).where(inArray(fundHolds.taskId, taskIds));
      await tx
        .delete(taskMappingSnapshots)
        .where(inArray(taskMappingSnapshots.taskId, taskIds));
      await tx
        .delete(taskCallItems)
        .where(inArray(taskCallItems.taskId, taskIds));
      await tx.delete(platformTasks).where(inArray(platformTasks.id, taskIds));
    }
    if (outboxIds.length) {
      await tx.delete(queueOutbox).where(inArray(queueOutbox.id, outboxIds));
    }
    await tx
      .delete(apiRequestNonces)
      .where(
        eq(apiRequestNonces.integrationClientId, fixture.clientDatabaseId),
      );
    await tx
      .delete(scriptCategoryBindings)
      .where(
        eq(scriptCategoryBindings.scriptBindingId, fixture.scriptBindingId),
      );
    await tx
      .delete(scriptBindings)
      .where(eq(scriptBindings.id, fixture.scriptBindingId));
    await tx
      .delete(sceneMappingReadiness)
      .where(eq(sceneMappingReadiness.sceneDefId, fixture.sceneDefId));
    await tx
      .delete(baiyingSceneCompanies)
      .where(eq(baiyingSceneCompanies.sceneDefId, fixture.sceneDefId));
    await tx
      .delete(baiyingScenes)
      .where(eq(baiyingScenes.sceneDefId, fixture.sceneDefId));
    await tx
      .delete(mappingRules)
      .where(eq(mappingRules.mappingVersionId, fixture.mappingVersionId));
    await tx
      .delete(mappingVersions)
      .where(eq(mappingVersions.id, fixture.mappingVersionId));
    await tx
      .delete(baiyingLineStudioBindings)
      .where(
        and(
          eq(baiyingLineStudioBindings.userPhoneId, fixture.lineId),
          eq(baiyingLineStudioBindings.studioId, fixture.businessCode),
        ),
      );
    await tx
      .delete(integrationClientStudios)
      .where(
        eq(
          integrationClientStudios.integrationClientId,
          fixture.clientDatabaseId,
        ),
      );
    await tx
      .delete(integrationEndpoints)
      .where(eq(integrationEndpoints.id, fixture.endpointId));
    await tx
      .delete(studioPricingVersions)
      .where(eq(studioPricingVersions.id, fixture.pricingId));
    await tx
      .delete(integrationClients)
      .where(eq(integrationClients.id, fixture.clientDatabaseId));
    await tx
      .delete(sourceDataCategories)
      .where(
        and(
          eq(sourceDataCategories.sourceSystem, 'ERP'),
          eq(sourceDataCategories.externalId, fixture.categoryId),
        ),
      );
    await tx
      .delete(baiyingPhoneLines)
      .where(eq(baiyingPhoneLines.userPhoneId, fixture.lineId));
    await tx
      .delete(studioAccounts)
      .where(eq(studioAccounts.studioId, fixture.studioId));
    await tx.delete(studios).where(eq(studios.id, fixture.studioId));
  });
}

async function runConcurrent(
  total: number,
  concurrency: number,
  operation: (index: number) => Promise<void>,
) {
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= total) return;
        await operation(index);
      }
    }),
  );
}

function percentile(values: Float64Array, quantile: number): number {
  const sorted = Array.from(values).sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * quantile) - 1] ?? 0;
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

function bytesToMiB(value: number): number {
  return rounded(value / 1024 / 1024);
}

function formatMs(value: number): string {
  return `${rounded(value)} ms`;
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

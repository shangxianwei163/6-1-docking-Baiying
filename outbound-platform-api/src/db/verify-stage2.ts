import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  externalApiErrorSchema,
  outboundCallPageEnvelopeSchema,
  taskAcceptedEnvelopeSchema,
  taskDetailEnvelopeSchema,
  type CreateOutboundTaskRequest,
} from '@outbound/contracts';
import { readConfig } from '../config.js';
import { createApp } from '../http/app.js';
import { PostgresMappingRepository } from '../mapping/postgres-repository.js';
import { PostgresExternalRequestAuthenticator } from '../openapi/authenticator.js';
import { PostgresOutboundTaskService } from '../outbound-task/service.js';
import { LocalDataProtector } from '../security/data-protector.js';
import { signRequest } from '../security/request-signature.js';
import { LocalDevelopmentSecretProvider } from '../security/secret-provider.js';
import { bootstrapStage2Local } from './bootstrap-stage2-local.js';
import { createDatabase } from './client.js';
import {
  accountLedger,
  apiRequestNonces,
  fundHolds,
  idempotencyRecords,
  integrationClients,
  platformTasks,
  queueOutbox,
  studioAccounts,
  taskCallItems,
  taskMappingSnapshots,
} from './schema.js';

const baseUrl = 'http://localhost:8788';

async function main() {
  const config = readConfig();
  if (config.NODE_ENV === 'production') {
    throw new Error('生产环境禁止运行 Stage 2 本地闭环验证');
  }
  const database = createDatabase(config.DATABASE_URL);
  const nonces: string[] = [];
  let taskId: string | undefined;
  let reservedAmount: string | undefined;
  let rateLimitClientId: string | undefined;
  try {
    await bootstrapStage2Local(database.db);
    const secrets = new LocalDevelopmentSecretProvider(
      config.WORKER_SHARED_SECRET,
      config.NODE_ENV,
    );
    const app = createApp({
      mappingRepository: new PostgresMappingRepository(
        database.db,
        config.VARIABLE_SYNC_QUEUE_NAME,
      ),
      consoleOrigin: config.CONSOLE_ORIGIN,
      workerSharedSecret: config.WORKER_SHARED_SECRET,
      externalRequestAuthenticator: new PostgresExternalRequestAuthenticator(
        database.db,
        secrets,
      ),
      outboundTaskService: new PostgresOutboundTaskService(
        database.db,
        new LocalDataProtector(config.WORKER_SHARED_SECRET, config.NODE_ENV),
        {
          baiyingCompanyId: config.BAIYING_COMPANY_ID ?? 'LOCAL-MOCK',
          queueName: config.TASK_ORCHESTRATION_QUEUE_NAME,
        },
      ),
    });
    const clientId = 'erp-local-01';
    const secret = await secrets.getSecretBytes(`local-hkdf://${clientId}`);
    const suffix = randomUUID();
    const request: CreateOutboundTaskRequest = {
      schemaVersion: '1.0',
      externalRequestId: `verify-stage2-${suffix}`,
      sourceSystem: 'ERP',
      mcCode: 'MC-ZTY-001',
      taskName: 'Stage 2 原子受理验证',
      customers: [
        {
          externalCustomerId: `customer-${suffix}`,
          name: '验证客户',
          phone: '13800138000',
          dataCategoryId: 'LOCAL-ERP-WEDDING',
          fields: {
            salutation: '王女士',
            appointment_date: '2026-09-20',
            consultant_name: '陈顾问',
          },
        },
      ],
    };
    const rawBody = Buffer.from(JSON.stringify(request));
    const idempotencyKey = `verify-${suffix}`;

    const acceptedResponse = await signedRequest({
      app,
      secret,
      clientId,
      method: 'POST',
      path: '/openapi/v1/outbound/tasks',
      rawBody,
      idempotencyKey,
      nonces,
    });
    assert.equal(acceptedResponse.status, 202);
    const accepted = taskAcceptedEnvelopeSchema.parse(
      await acceptedResponse.json(),
    );
    taskId = accepted.data.taskId;
    reservedAmount = accepted.data.reservedAmount;
    const generatedTaskName = `${accepted.data.taskNo.slice(3, 11)}本地联调ERP婚礼邀约-${accepted.data.taskNo.slice(-5)}`;
    assert.equal(accepted.data.taskName, generatedTaskName);

    const replayResponse = await signedRequest({
      app,
      secret,
      clientId,
      method: 'POST',
      path: '/openapi/v1/outbound/tasks',
      rawBody,
      idempotencyKey,
      nonces,
    });
    assert.equal(replayResponse.status, 202);
    assert.equal(replayResponse.headers.get('idempotent-replayed'), 'true');
    const replay = taskAcceptedEnvelopeSchema.parse(
      await replayResponse.json(),
    );
    assert.equal(replay.data.taskId, taskId);
    assert.equal(replay.data.taskNo, accepted.data.taskNo);

    const changedBody = Buffer.from(
      JSON.stringify({ ...request, taskName: '同键但不同报文' }),
    );
    const conflictResponse = await signedRequest({
      app,
      secret,
      clientId,
      method: 'POST',
      path: '/openapi/v1/outbound/tasks',
      rawBody: changedBody,
      idempotencyKey,
      nonces,
    });
    assert.equal(conflictResponse.status, 409);
    assert.equal(
      externalApiErrorSchema.parse(await conflictResponse.json()).code,
      'IDEMPOTENCY_CONFLICT',
    );

    const rejectedExternalIds: string[] = [];
    const reject = async (
      changed: CreateOutboundTaskRequest,
      expectedStatus: number,
      expectedCode: string,
    ) => {
      rejectedExternalIds.push(changed.externalRequestId);
      const response = await signedRequest({
        app,
        secret,
        clientId,
        method: 'POST',
        path: '/openapi/v1/outbound/tasks',
        rawBody: Buffer.from(JSON.stringify(changed)),
        idempotencyKey: `reject-${randomUUID()}`,
        nonces,
      });
      assert.equal(response.status, expectedStatus);
      assert.equal(
        externalApiErrorSchema.parse(await response.json()).code,
        expectedCode,
      );
    };
    await reject(
      {
        ...request,
        externalRequestId: `missing-studio-${suffix}`,
        mcCode: 'MC-NOT-FOUND',
      },
      404,
      'STUDIO_NOT_FOUND',
    );
    await reject(
      {
        ...request,
        externalRequestId: `missing-category-${suffix}`,
        customers: request.customers.map((customer) => ({
          ...customer,
          dataCategoryId: 'CATEGORY-NOT-FOUND',
        })),
      },
      422,
      'DATA_CATEGORY_NOT_FOUND',
    );
    await reject(
      {
        ...request,
        externalRequestId: `mapping-invalid-${suffix}`,
        customers: request.customers.map((customer) => ({
          ...customer,
          fields: { salutation: '王女士', consultant_name: '陈顾问' },
        })),
      },
      422,
      'MAPPING_VALUE_INVALID',
    );
    await reject(
      {
        ...request,
        externalRequestId: `phone-invalid-${suffix}`,
        customers: request.customers.map((customer) => ({
          ...customer,
          phone: '123',
        })),
      },
      422,
      'PHONE_INVALID',
    );
    await reject(
      {
        ...request,
        externalRequestId: `phone-duplicate-${suffix}`,
        customers: [
          request.customers[0]!,
          {
            ...request.customers[0]!,
            externalCustomerId: `customer-duplicate-${suffix}`,
            phone: '+8613800138000',
          },
        ],
      },
      422,
      'PHONE_DUPLICATED',
    );
    await reject(
      {
        ...request,
        externalRequestId: `source-mismatch-${suffix}`,
        sourceSystem: 'CRM',
      },
      403,
      'AUTHENTICATION_FAILED',
    );

    const detailPath = accepted.data.statusUrl;
    const detailNonce = randomUUID();
    const detailResponse = await signedRequest({
      app,
      secret,
      clientId,
      method: 'GET',
      path: detailPath,
      rawBody: Buffer.alloc(0),
      nonce: detailNonce,
      nonces,
    });
    assert.equal(detailResponse.status, 200);
    const detail = taskDetailEnvelopeSchema.parse(await detailResponse.json());
    assert.equal(detail.data.taskId, taskId);
    assert.equal(detail.data.taskName, generatedTaskName);
    assert.equal(detail.data.billing.reservedAmount, reservedAmount);
    assert.equal(detail.data.mapping.variableCount, 3);

    const replayedNonceResponse = await signedRequest({
      app,
      secret,
      clientId,
      method: 'GET',
      path: detailPath,
      rawBody: Buffer.alloc(0),
      nonce: detailNonce,
      nonces,
    });
    assert.equal(replayedNonceResponse.status, 409);
    assert.equal(
      externalApiErrorSchema.parse(await replayedNonceResponse.json()).code,
      'REPLAY_DETECTED',
    );

    const badSignatureResponse = await app.request(`${baseUrl}${detailPath}`, {
      headers: {
        'x-client-id': clientId,
        'x-timestamp': String(Date.now()),
        'x-nonce': randomUUID(),
        'x-signature': 'invalid-signature',
      },
    });
    assert.equal(badSignatureResponse.status, 401);
    assert.equal(
      externalApiErrorSchema.parse(await badSignatureResponse.json()).code,
      'AUTHENTICATION_FAILED',
    );

    const expiredTimestampResponse = await signedRequest({
      app,
      secret,
      clientId,
      method: 'GET',
      path: detailPath,
      rawBody: Buffer.alloc(0),
      timestamp: String(Date.now() - 10 * 60 * 1000),
      nonces,
    });
    assert.equal(expiredTimestampResponse.status, 401);
    assert.equal(
      externalApiErrorSchema.parse(await expiredTimestampResponse.json()).code,
      'AUTHENTICATION_FAILED',
    );

    rateLimitClientId = `rate-limit-${suffix}`;
    await database.db.insert(integrationClients).values({
      clientId: rateLimitClientId,
      sourceSystem: 'ERP',
      displayName: 'Stage 2 限流验证客户端',
      secretRef: `local-hkdf://${rateLimitClientId}`,
      status: 'ACTIVE',
      rateLimitPerMinute: 1,
      createdBy: 'stage2-verifier',
    });
    const rateLimitSecret = await secrets.getSecretBytes(
      `local-hkdf://${rateLimitClientId}`,
    );
    const firstRateResponse = await signedRequest({
      app,
      secret: rateLimitSecret,
      clientId: rateLimitClientId,
      method: 'GET',
      path: detailPath,
      rawBody: Buffer.alloc(0),
      nonces,
    });
    assert.equal(firstRateResponse.status, 404);
    const limitedResponse = await signedRequest({
      app,
      secret: rateLimitSecret,
      clientId: rateLimitClientId,
      method: 'GET',
      path: detailPath,
      rawBody: Buffer.alloc(0),
      nonces,
    });
    assert.equal(limitedResponse.status, 429);
    assert.equal(
      externalApiErrorSchema.parse(await limitedResponse.json()).code,
      'RATE_LIMITED',
    );

    const callsResponse = await signedRequest({
      app,
      secret,
      clientId,
      method: 'GET',
      path: `${detailPath}/calls?limit=20`,
      rawBody: Buffer.alloc(0),
      nonces,
    });
    assert.equal(callsResponse.status, 200);
    assert.deepEqual(
      outboundCallPageEnvelopeSchema.parse(await callsResponse.json()),
      {
        code: 'OK',
        message: 'success',
        requestId: callsResponse.headers.get('x-request-id'),
        data: { items: [], nextCursor: null },
      },
    );

    const countRows = await database.db.execute<{
      tasks: number;
      callItems: number;
      holds: number;
      ledger: number;
      outbox: number;
      idempotency: number;
    }>(sql`
      select
        (select count(*)::int from ${platformTasks} where ${platformTasks.id} = ${taskId}) as "tasks",
        (select count(*)::int from ${taskCallItems} where ${taskCallItems.taskId} = ${taskId}) as "callItems",
        (select count(*)::int from ${fundHolds} where ${fundHolds.taskId} = ${taskId}) as "holds",
        (select count(*)::int from ${accountLedger} where ${accountLedger.taskId} = ${taskId}) as "ledger",
        (select count(*)::int from ${queueOutbox} where ${queueOutbox.payload}->>'taskId' = ${taskId}) as "outbox",
        (select count(*)::int from ${idempotencyRecords} where ${idempotencyRecords.taskId} = ${taskId}) as "idempotency"
    `);
    const counts = countRows[0];
    assert.deepEqual(counts, {
      tasks: 1,
      callItems: 1,
      holds: 1,
      ledger: 1,
      outbox: 1,
      idempotency: 1,
    });
    const rejectedRows = await database.db
      .select({ externalRequestId: platformTasks.externalRequestId })
      .from(platformTasks)
      .where(inArray(platformTasks.externalRequestId, rejectedExternalIds));
    assert.equal(rejectedRows.length, 0);
    const [storedItem] = await database.db
      .select({
        phoneCiphertext: taskCallItems.phoneCiphertext,
        sourceFieldsCiphertext: taskCallItems.sourceFieldsCiphertext,
      })
      .from(taskCallItems)
      .where(eq(taskCallItems.taskId, taskId))
      .limit(1);
    assert.ok(storedItem);
    assert.ok(!storedItem.phoneCiphertext.includes('13800138000'));
    assert.ok(!storedItem.sourceFieldsCiphertext.includes('陈顾问'));

    console.info(
      JSON.stringify(
        {
          status: 'passed',
          checks: [
            'HMAC authentication and raw-body signature',
            'timestamp and nonce replay protection',
            'per-client rate limiting',
            'same-key replay returns the original task',
            'same-key changed payload returns IDEMPOTENCY_CONFLICT',
            'schema, studio, category, mapping and credential rejections leave no task',
            'task, call item, snapshot, hold, ledger, idempotency and Outbox commit atomically',
            'task detail and pre-provider empty call page satisfy contracts',
            'phone and customer fields are encrypted at rest',
          ],
          taskNo: accepted.data.taskNo,
          reservedAmount,
        },
        null,
        2,
      ),
    );
  } finally {
    if (taskId && reservedAmount) {
      await cleanup(database.db, taskId, reservedAmount, nonces);
    }
    if (rateLimitClientId) {
      await database.db
        .delete(integrationClients)
        .where(eq(integrationClients.clientId, rateLimitClientId));
    }
    await database.close();
  }
}

async function signedRequest(input: {
  app: ReturnType<typeof createApp>;
  secret: Buffer;
  clientId: string;
  method: 'GET' | 'POST';
  path: string;
  rawBody: Buffer;
  idempotencyKey?: string;
  nonce?: string;
  timestamp?: string;
  nonces: string[];
}) {
  const timestamp = input.timestamp ?? String(Date.now());
  const nonce = input.nonce ?? randomUUID();
  input.nonces.push(nonce);
  const url = `${baseUrl}${input.path}`;
  const signature = signRequest(
    {
      method: input.method,
      url,
      timestamp,
      nonce,
      rawBody: input.rawBody,
    },
    input.secret,
  );
  return input.app.request(url, {
    method: input.method,
    headers: {
      'content-type': 'application/json',
      'x-client-id': input.clientId,
      'x-timestamp': timestamp,
      'x-nonce': nonce,
      'x-signature': signature,
      ...(input.idempotencyKey
        ? { 'idempotency-key': input.idempotencyKey }
        : {}),
    },
    body: input.method === 'POST' ? input.rawBody.toString('utf8') : undefined,
  });
}

async function cleanup(
  db: ReturnType<typeof createDatabase>['db'],
  taskId: string,
  reservedAmount: string,
  nonces: string[],
) {
  await db.transaction(async (tx) => {
    const [task] = await tx
      .select({ studioId: platformTasks.studioId })
      .from(platformTasks)
      .where(eq(platformTasks.id, taskId))
      .limit(1);
    await tx
      .delete(idempotencyRecords)
      .where(eq(idempotencyRecords.taskId, taskId));
    await tx
      .delete(queueOutbox)
      .where(sql`${queueOutbox.payload}->>'taskId' = ${taskId}`);
    await tx.delete(accountLedger).where(eq(accountLedger.taskId, taskId));
    await tx.delete(fundHolds).where(eq(fundHolds.taskId, taskId));
    await tx
      .delete(taskMappingSnapshots)
      .where(eq(taskMappingSnapshots.taskId, taskId));
    await tx.delete(taskCallItems).where(eq(taskCallItems.taskId, taskId));
    await tx.delete(platformTasks).where(eq(platformTasks.id, taskId));
    if (task) {
      await tx
        .update(studioAccounts)
        .set({
          activeHoldAmount: sql`${studioAccounts.activeHoldAmount} - ${reservedAmount}`,
          lockVersion: sql`${studioAccounts.lockVersion} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(studioAccounts.studioId, task.studioId));
    }
    if (nonces.length) {
      const [client] = await tx
        .select({ id: integrationClients.id })
        .from(integrationClients)
        .where(eq(integrationClients.clientId, 'erp-local-01'))
        .limit(1);
      if (client) {
        await tx
          .delete(apiRequestNonces)
          .where(
            and(
              eq(apiRequestNonces.integrationClientId, client.id),
              inArray(apiRequestNonces.nonce, Array.from(new Set(nonces))),
            ),
          );
      }
    }
  });
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

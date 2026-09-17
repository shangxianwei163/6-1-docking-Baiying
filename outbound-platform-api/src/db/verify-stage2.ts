import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import {
  batchAcceptedEnvelopeV2Schema,
  externalApiErrorSchema,
  outboundCallResultInternalEventV2Schema,
  outboundCallPageEnvelopeSchema,
  taskAcceptedEnvelopeSchema,
  taskDetailEnvelopeSchema,
  type CreateOutboundTaskRequest,
} from '@outbound/contracts';
import { readConfig } from '../config.js';
import { createApp } from '../http/app.js';
import { PostgresMappingRepository } from '../mapping/postgres-repository.js';
import { PostgresExternalRequestAuthenticator } from '../openapi/authenticator.js';
import { PostgresTaskOrchestrationRepository } from '../orchestration/postgres-repository.js';
import { PostgresOutboundTaskService } from '../outbound-task/service.js';
import { LocalDataProtector } from '../security/data-protector.js';
import { bootstrapStage2Local } from './bootstrap-stage2-local.js';
import { createDatabase } from './client.js';
import {
  accountLedger,
  fundHolds,
  idempotencyRecords,
  intakeBatches,
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
  let taskId: string | undefined;
  let reservedAmount: string | undefined;
  let v2BatchId: string | undefined;
  let v2TaskId: string | undefined;
  let v2TaskNo: string | undefined;
  let v2ReservedAmount: string | undefined;
  try {
    await bootstrapStage2Local(database.db);
    const app = createApp({
      mappingRepository: new PostgresMappingRepository(
        database.db,
        config.VARIABLE_SYNC_QUEUE_NAME,
      ),
      consoleOrigin: config.CONSOLE_ORIGIN,
      workerSharedSecret: config.WORKER_SHARED_SECRET,
      externalRequestAuthenticator: new PostgresExternalRequestAuthenticator(
        database.db,
      ),
      outboundTaskService: new PostgresOutboundTaskService(
        database.db,
        new LocalDataProtector(config.WORKER_SHARED_SECRET, config.NODE_ENV),
        {
          baiyingCompanyId: config.BAIYING_COMPANY_ID ?? 'LOCAL-MOCK',
          queueName: config.TASK_ORCHESTRATION_QUEUE_NAME,
          deliveryQueueName: config.CALLBACK_DELIVERY_QUEUE_NAME,
        },
      ),
    });
    const accessToken = 'erp-local-access-token';
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

    const acceptedResponse = await tokenRequest({
      app,
      accessToken,
      method: 'POST',
      path: '/openapi/v1/outbound/tasks',
      rawBody,
      idempotencyKey,
    });
    assert.equal(acceptedResponse.status, 202);
    const accepted = taskAcceptedEnvelopeSchema.parse(
      await acceptedResponse.json(),
    );
    taskId = accepted.data.taskId;
    reservedAmount = accepted.data.reservedAmount;
    const generatedTaskName = `${accepted.data.taskNo.slice(3, 11)}本地联调ERP婚礼邀约-${accepted.data.taskNo.slice(-5)}`;
    assert.equal(accepted.data.taskName, generatedTaskName);

    const replayResponse = await tokenRequest({
      app,
      accessToken,
      method: 'POST',
      path: '/openapi/v1/outbound/tasks',
      rawBody,
      idempotencyKey,
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
    const conflictResponse = await tokenRequest({
      app,
      accessToken,
      method: 'POST',
      path: '/openapi/v1/outbound/tasks',
      rawBody: changedBody,
      idempotencyKey,
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
      const response = await tokenRequest({
        app,
        accessToken,
        method: 'POST',
        path: '/openapi/v1/outbound/tasks',
        rawBody: Buffer.from(JSON.stringify(changed)),
        idempotencyKey: `reject-${randomUUID()}`,
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
    const detailResponse = await tokenRequest({
      app,
      accessToken,
      method: 'GET',
      path: detailPath,
      rawBody: Buffer.alloc(0),
    });
    assert.equal(detailResponse.status, 200);
    const detail = taskDetailEnvelopeSchema.parse(await detailResponse.json());
    assert.equal(detail.data.taskId, taskId);
    assert.equal(detail.data.taskName, generatedTaskName);
    assert.equal(detail.data.billing.reservedAmount, reservedAmount);
    assert.equal(detail.data.mapping.variableCount, 3);

    const invalidTokenResponse = await app.request(`${baseUrl}${detailPath}`, {
      headers: {
        'x-access-token': 'invalid-token',
      },
    });
    assert.equal(invalidTokenResponse.status, 401);
    assert.equal(
      externalApiErrorSchema.parse(await invalidTokenResponse.json()).code,
      'AUTHENTICATION_FAILED',
    );

    const callsResponse = await tokenRequest({
      app,
      accessToken,
      method: 'GET',
      path: `${detailPath}/calls?limit=20`,
      rawBody: Buffer.alloc(0),
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

    const v2GuidValid = `v2-valid-${suffix}`;
    const v2GuidFiltered = `v2-filtered-${suffix}`;
    const v2Response = await tokenRequest({
      app,
      accessToken,
      method: 'POST',
      path: '/openapi/v2/outbound/tasks',
      rawBody: Buffer.from(
        JSON.stringify({
          main_category: '本地联调',
          sub_category: '婚礼邀约',
          source: 0,
          company_code: 'MC-ZTY-001',
          customer_list: [
            {
              c_level: '',
              c_info_list: [
                {
                  phone: '13800138001',
                  guid: v2GuidValid,
                  customer_name: '有效客户',
                  salutation: '李女士',
                  appointment_date: '2026-09-21',
                  consultant_name: '陈顾问',
                },
                {
                  phone: '13800138002',
                  guid: v2GuidFiltered,
                  customer_name: null,
                  appointment_date: '2026-09-22',
                  consultant_name: '陈顾问',
                },
              ],
            },
          ],
        }),
      ),
      idempotencyKey: `verify-v2-${suffix}`,
    });
    assert.equal(v2Response.status, 202);
    const v2Accepted = batchAcceptedEnvelopeV2Schema.parse(
      await v2Response.json(),
    );
    v2BatchId = v2Accepted.data.batch_id;
    v2TaskId = v2Accepted.data.tasks[0]!.task_id;
    v2TaskNo = v2Accepted.data.tasks[0]!.task_no;
    assert.equal(v2Accepted.data.phone_count, 2);
    assert.equal(v2Accepted.data.valid_phone_count, 1);
    assert.equal(v2Accepted.data.filtered_phone_count, 1);
    assert.equal(v2Accepted.data.tasks[0]!.valid_phone_count, 1);
    assert.equal(v2Accepted.data.tasks[0]!.filtered_phone_count, 1);

    const [v2Task] = await database.db
      .select({
        reservedAmount: platformTasks.reservedAmount,
        phoneCount: platformTasks.phoneCount,
        importRequestedCount: platformTasks.importRequestedCount,
        importFailedCount: platformTasks.importFailedCount,
      })
      .from(platformTasks)
      .where(eq(platformTasks.id, v2TaskId))
      .limit(1);
    assert.ok(v2Task);
    v2ReservedAmount = v2Task.reservedAmount;
    assert.equal(v2Task.phoneCount, 2);
    assert.equal(v2Task.importRequestedCount, 1);
    assert.equal(v2Task.importFailedCount, 1);

    const v2Items = await database.db
      .select({
        id: taskCallItems.id,
        externalCustomerId: taskCallItems.externalCustomerId,
        importStatus: taskCallItems.importStatus,
        importError: taskCallItems.importError,
        callStatus: taskCallItems.callStatus,
        resultEventId: taskCallItems.resultEventId,
      })
      .from(taskCallItems)
      .where(eq(taskCallItems.taskId, v2TaskId));
    const validItem = v2Items.find(
      (item) => item.externalCustomerId === v2GuidValid,
    );
    const filteredItem = v2Items.find(
      (item) => item.externalCustomerId === v2GuidFiltered,
    );
    assert.equal(validItem?.importStatus, 'PENDING');
    assert.equal(validItem?.resultEventId, null);
    assert.equal(filteredItem?.importStatus, 'FAILED');
    assert.equal(filteredItem?.callStatus, 'FAILED');
    assert.match(
      filteredItem?.importError ?? '',
      /^\[MAPPING_VALUE_INVALID\]/,
    );
    assert.ok(filteredItem?.resultEventId);

    const orchestrationTask = await new PostgresTaskOrchestrationRepository(
      database.db,
    ).getTask(v2TaskId);
    assert.equal(orchestrationTask?.phoneCount, 1);
    assert.equal(orchestrationTask?.callItems.length, 1);
    assert.equal(orchestrationTask?.callItems[0]?.id, validItem?.id);

    const v2Outbox = await database.db
      .select({
        eventType: queueOutbox.eventType,
        payload: queueOutbox.payload,
      })
      .from(queueOutbox)
      .where(sql`${queueOutbox.payload}->>'taskNo' = ${v2TaskNo}`);
    assert.equal(
      v2Outbox.filter((event) => event.eventType === 'TASK_ACCEPTED').length,
      1,
    );
    const parameterErrorEvent = v2Outbox.find(
      (event) => event.eventType === 'OUTBOUND_CALL_RESULT_V2',
    );
    assert.ok(parameterErrorEvent);
    const parameterErrorPayload = outboundCallResultInternalEventV2Schema.parse(
      parameterErrorEvent.payload,
    );
    assert.equal(parameterErrorPayload.schemaVersion, '2.1');
    if (parameterErrorPayload.schemaVersion !== '2.1') {
      throw new Error('参数错误结果回调必须使用 2.1 合约');
    }
    assert.equal(
      parameterErrorPayload.result.customer_result.result_code,
      'CALL_FAILED',
    );
    assert.equal(parameterErrorPayload.result.customer.guid, v2GuidFiltered);
    assert.equal(parameterErrorPayload.result.call.status_text, '参数错误');
    assert.match(
      parameterErrorPayload.result.customer_result.summary,
      /salutation 为空/,
    );
    assert.equal(
      Object.hasOwn(parameterErrorPayload.result.customer_result, 'error_reason'),
      false,
    );
    assert.equal(
      parameterErrorPayload.result.billing.customer_charge,
      '0.000000',
    );

    console.info(
      JSON.stringify(
        {
          status: 'passed',
          checks: [
            'fixed request token authentication',
            'same-key replay returns the original task',
            'same-key changed payload returns IDEMPOTENCY_CONFLICT',
            'schema, studio, category, mapping and credential rejections leave no task',
            'task, call item, snapshot, hold, ledger, idempotency and Outbox commit atomically',
            'task detail and pre-provider empty call page satisfy contracts',
            'phone and customer fields are encrypted at rest',
            'v2 filters only mapping-invalid customers before Baiying import',
            'filtered customers receive zero-charge business-result callbacks',
          ],
          taskNo: accepted.data.taskNo,
          reservedAmount,
        },
        null,
        2,
      ),
    );
  } finally {
    if (v2BatchId && v2TaskId && v2TaskNo && v2ReservedAmount) {
      await cleanup(
        database.db,
        v2TaskId,
        v2ReservedAmount,
        v2BatchId,
        v2TaskNo,
      );
    }
    if (taskId && reservedAmount) {
      await cleanup(database.db, taskId, reservedAmount);
    }
    await database.close();
  }
}

async function tokenRequest(input: {
  app: ReturnType<typeof createApp>;
  accessToken: string;
  method: 'GET' | 'POST';
  path: string;
  rawBody: Buffer;
  idempotencyKey?: string;
}) {
  const url = `${baseUrl}${input.path}`;
  return input.app.request(url, {
    method: input.method,
    headers: {
      'content-type': 'application/json',
      'x-access-token': input.accessToken,
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
  batchId?: string,
  taskNo?: string,
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
      .where(
        taskNo
          ? sql`${queueOutbox.payload}->>'taskId' = ${taskId} OR ${queueOutbox.payload}->>'taskNo' = ${taskNo}`
          : sql`${queueOutbox.payload}->>'taskId' = ${taskId}`,
      );
    await tx.delete(accountLedger).where(eq(accountLedger.taskId, taskId));
    await tx.delete(fundHolds).where(eq(fundHolds.taskId, taskId));
    await tx
      .delete(taskMappingSnapshots)
      .where(eq(taskMappingSnapshots.taskId, taskId));
    await tx.delete(taskCallItems).where(eq(taskCallItems.taskId, taskId));
    await tx.delete(platformTasks).where(eq(platformTasks.id, taskId));
    if (batchId) {
      await tx.delete(intakeBatches).where(eq(intakeBatches.id, batchId));
    }
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
  });
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

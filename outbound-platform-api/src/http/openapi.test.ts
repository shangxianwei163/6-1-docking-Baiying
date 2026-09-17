import { describe, expect, it, vi } from 'vitest';
import type { CreateOutboundBatchRequestV2 } from '@outbound/contracts';
import type { MappingRepository } from '../mapping/repository.js';
import type {
  AuthenticationInput,
  ExternalPrincipal,
  ExternalRequestAuthenticator,
} from '../openapi/authenticator.js';
import { ExternalApiFailure } from '../openapi/errors.js';
import { rawBodySha256, stableJsonSha256 } from '../openapi/request-hash.js';
import type { ExternalRequestLogStartInput } from '../operations/external-request-log-writer.js';
import type { OutboundTaskService } from '../outbound-task/service.js';
import { createApp } from './app.js';

const principal: ExternalPrincipal = {
  integrationClientId: '7c9a8722-e675-4bc7-860a-6c8cca66534c',
  clientId: 'erp-local-01',
  sourceSystem: 'ERP',
};

const validRequest = {
  schemaVersion: '1.0' as const,
  externalRequestId: 'erp-order-001',
  sourceSystem: 'ERP' as const,
  mcCode: 'MC-ZTY-001',
  taskName: '婚礼邀约',
  customers: [
    {
      externalCustomerId: 'customer-001',
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

const validV2Request = {
  main_category: '排档',
  sub_category: '孕妈',
  source: 0 as const,
  company_code: '5903679116',
  customer_list: [
    {
      c_level: '',
      c_info_list: [
        {
          phone: '13500000001',
          guid: '11111111-1111-4111-8111-111111111101',
          customer_name: '测试客户A',
          photoshop: null,
          custom_variable_101: '可扩展字段',
        },
      ],
    },
  ],
};

function setup() {
  const startExternalRequestLog = vi.fn(
    async (_input: ExternalRequestLogStartInput) =>
      '9ad1229a-7586-4ff5-ac85-1207ba2f7ba2',
  );
  const completeExternalRequestLog = vi.fn(async () => undefined);
  const authenticate = vi.fn(async (_input: AuthenticationInput) => principal);
  const listCallCharges = vi.fn(async () => ({
    company_code: '5903679116',
    currency: 'CNY' as const,
    balance: '18152.650000',
    available_balance: '18152.650000',
    total_count: 1,
    total_charge: '0.960000',
    items: [
      {
        ledger_id: '22222222-2222-4222-8222-222222222221',
        occurred_at: '2026-09-14T02:32:18.000Z',
        type: 'CALL_CHARGE' as const,
        amount: '-0.960000',
        balance_after: '18152.650000',
        available_balance_after: '18152.650000',
        task_no: 'PT-20260914-00001',
        platform_call_id: '33333333-3333-4333-8333-333333333331',
        remark: '通话结算',
      },
    ],
    next_cursor: null,
  }));
  const accept = vi.fn(async () => ({
    status: 202 as const,
    replayed: false,
    body: {
      code: 'TASK_ACCEPTED' as const,
      message: '外呼任务已受理',
      requestId: 'request-001',
      data: {
        taskId: 'cf9806bb-2166-43b0-8fdc-c7bb48115880',
        taskNo: 'PT-20260906-00001',
        executionStatus: 'ACCEPTED' as const,
        displayStatus: '执行中' as const,
        phoneCount: 1,
        reservedAmount: '0.960000',
        currency: 'CNY' as const,
        statusUrl: '/openapi/v1/outbound/tasks/PT-20260906-00001',
      },
    },
  }));
  const authenticator: ExternalRequestAuthenticator = { authenticate };
  const acceptV2 = vi.fn(async () => ({
    status: 202 as const,
    replayed: false,
    body: {
      code: 'BATCH_ACCEPTED' as const,
      message: '外呼批次已受理',
      request_id: 'request-001',
      data: {
        batch_id: 'b37dd640-3b48-4e9c-b719-cf650fc9907a',
        execution_status: 'ACCEPTED' as const,
        phone_count: 1,
        valid_phone_count: 1,
        filtered_phone_count: 0,
        task_count: 1,
        tasks: [
          {
            task_id: 'cf9806bb-2166-43b0-8fdc-c7bb48115880',
            task_no: 'PT-20260906-00001',
            phone_count: 1,
            valid_phone_count: 1,
            filtered_phone_count: 0,
            status_url: '/openapi/v1/outbound/tasks/PT-20260906-00001',
          },
        ],
        status_url:
          '/openapi/v2/outbound/batches/b37dd640-3b48-4e9c-b719-cf650fc9907a',
      },
    },
  }));
  const taskService = {
    accept,
    acceptV2,
    getBatchV2: vi.fn(),
    getTask: vi.fn(),
    listCalls: vi.fn(),
  } as unknown as OutboundTaskService;
  const app = createApp({
    mappingRepository: {} as MappingRepository,
    consoleOrigin: 'http://localhost:4173',
    workerSharedSecret: 'test-worker-secret-at-least-24',
    externalRequestAuthenticator: authenticator,
    outboundTaskService: taskService,
    externalCallChargeService: { listCallCharges },
    externalRequestLogWriter: {
      start: startExternalRequestLog,
      complete: completeExternalRequestLog,
    },
    createId: () => 'request-001',
  });
  return {
    app,
    authenticate,
    accept,
    acceptV2,
    listCallCharges,
    startExternalRequestLog,
    completeExternalRequestLog,
  };
}

describe('external outbound task HTTP API', () => {
  it('authenticates the fixed request token and accepts a validated task', async () => {
    const { app, authenticate, accept } = setup();
    const rawBody = JSON.stringify(validRequest);
    const response = await app.request('/openapi/v1/outbound/tasks', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-access-token': 'erp-local-access-token',
        'idempotency-key': 'idempotency-001',
        'x-request-id': 'request-001',
      },
      body: rawBody,
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      code: 'TASK_ACCEPTED',
      data: { taskNo: 'PT-20260906-00001' },
    });
    expect(authenticate).toHaveBeenCalledWith({
      accessToken: 'erp-local-access-token',
    });
    expect(accept).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'idempotency-001',
        requestHash: stableJsonSha256(validRequest),
      }),
    );
  });

  it('accepts the nested v2 batch and hashes its normalized contract', async () => {
    const { app, authenticate, acceptV2, completeExternalRequestLog } = setup();
    const rawBody = JSON.stringify(validV2Request);
    const response = await app.request('/openapi/v2/outbound/tasks', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-access-token': 'erp-local-access-token',
        'idempotency-key': 'idempotency-v2-001',
      },
      body: rawBody,
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      code: 'BATCH_ACCEPTED',
      data: {
        batch_id: 'b37dd640-3b48-4e9c-b719-cf650fc9907a',
        task_count: 1,
      },
    });
    expect(authenticate).toHaveBeenLastCalledWith({
      accessToken: 'erp-local-access-token',
    });
    expect(acceptV2).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'idempotency-v2-001',
        requestHash: rawBodySha256(new TextEncoder().encode(rawBody)),
        request: expect.objectContaining({ company_code: '5903679116' }),
      }),
    );
    expect(completeExternalRequestLog).toHaveBeenCalledWith(
      expect.objectContaining({
        responseStatus: 202,
        responseSummary: expect.objectContaining({
          phoneCount: 1,
          validPhoneCount: 1,
          filteredPhoneCount: 0,
        }),
      }),
    );
  });

  it('returns only the authorized studio call-charge ledger query', async () => {
    const { app, authenticate, listCallCharges } = setup();
    const response = await app.request(
      '/openapi/v2/billing/call-charges?company_code=5903679116&occurred_from=2026-09-01T00%3A00%3A00%2B08%3A00&occurred_before=2026-10-01T00%3A00%3A00%2B08%3A00&limit=50',
      { headers: { 'x-access-token': 'erp-local-access-token' } },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      code: 'OK',
      request_id: 'request-001',
      data: {
        company_code: '5903679116',
        items: [{ type: 'CALL_CHARGE', amount: '-0.960000' }],
      },
    });
    expect(authenticate).toHaveBeenLastCalledWith({
      accessToken: 'erp-local-access-token',
    });
    expect(listCallCharges).toHaveBeenCalledWith(principal, {
      companyCode: '5903679116',
      occurredFrom: new Date('2026-09-01T00:00:00+08:00'),
      occurredBefore: new Date('2026-10-01T00:00:00+08:00'),
      cursor: undefined,
      limit: 50,
    });
  });

  it('rejects an inverted call-charge time range before querying the ledger', async () => {
    const { app, listCallCharges } = setup();
    const response = await app.request(
      '/openapi/v2/billing/call-charges?company_code=5903679116&occurred_from=2026-10-01T00%3A00%3A00%2B08%3A00&occurred_before=2026-09-01T00%3A00%3A00%2B08%3A00',
      { headers: { 'x-access-token': 'erp-local-access-token' } },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'INVALID_REQUEST',
      message: '请求参数不合法',
    });
    expect(listCallCharges).not.toHaveBeenCalled();
  });

  it.each([
    ['guid', 'GUID_DUPLICATED'],
    ['phone', 'PHONE_DUPLICATED'],
  ] as const)(
    'rejects a v2 batch with a duplicate %s before calling the service',
    async (field, code) => {
      const { app, acceptV2 } = setup();
      const duplicate: CreateOutboundBatchRequestV2 =
        structuredClone(validV2Request);
      duplicate.customer_list.push({
        c_level: 'SR3',
        c_info_list: [
          {
            phone:
              field === 'phone'
                ? validV2Request.customer_list[0]!.c_info_list[0]!.phone
                : '18300000003',
            guid:
              field === 'guid'
                ? validV2Request.customer_list[0]!.c_info_list[0]!.guid
                : '11111111-1111-4111-8111-111111111103',
          },
        ],
      });
      const response = await app.request('/openapi/v2/outbound/tasks', {
        method: 'POST',
        headers: {
          'x-access-token': 'erp-local-access-token',
          'idempotency-key': `idempotency-${field}-001`,
        },
        body: JSON.stringify(duplicate),
      });

      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({ code });
      expect(acceptV2).not.toHaveBeenCalled();
    },
  );

  it('returns the flat external error contract for invalid payloads', async () => {
    const { app, accept } = setup();
    const response = await app.request('/openapi/v1/outbound/tasks', {
      method: 'POST',
      headers: {
        'x-access-token': 'erp-local-access-token',
        'idempotency-key': 'idempotency-001',
      },
      body: '{}',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: 'INVALID_REQUEST',
      message: '请求参数不合法',
      requestId: 'request-001',
    });
    expect(accept).not.toHaveBeenCalled();
  });

  it('preserves typed synchronous rejection codes', async () => {
    const { app, accept } = setup();
    accept.mockRejectedValueOnce(
      new ExternalApiFailure('INSUFFICIENT_BALANCE', '影楼可用余额不足', 409, {
        availableBalance: '0.000000',
      }),
    );
    const response = await app.request('/openapi/v1/outbound/tasks', {
      method: 'POST',
      headers: {
        'x-access-token': 'erp-local-access-token',
        'idempotency-key': 'idempotency-001',
      },
      body: JSON.stringify(validRequest),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: 'INSUFFICIENT_BALANCE',
      message: '影楼可用余额不足',
      requestId: 'request-001',
      details: { availableBalance: '0.000000' },
    });
  });

  it('returns the recharge QR code URL when a v2 batch is rejected for insufficient balance', async () => {
    const { app, acceptV2 } = setup();
    acceptV2.mockRejectedValueOnce(
      new ExternalApiFailure('INSUFFICIENT_BALANCE', '影楼可用余额不足', 409, {
        availableBalance: '1.000000',
        reservedAmount: '9.600000',
      }),
    );
    const response = await app.request('/openapi/v2/outbound/tasks', {
      method: 'POST',
      headers: {
        'x-access-token': 'erp-local-access-token',
        'idempotency-key': 'idempotency-v2-balance-001',
      },
      body: JSON.stringify(validV2Request),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: 'INSUFFICIENT_BALANCE',
      message: '影楼可用余额不足',
      requestId: 'request-001',
      recharge_qr_code_url:
        'https://scheduling.paiyide.cc/recharge/ums-recharge-qr-code.png',
      details: {
        availableBalance: '1.000000',
        reservedAmount: '9.600000',
      },
    });
  });

  it('records a failed v2 mapping precheck independently from the task transaction', async () => {
    const {
      app,
      acceptV2,
      startExternalRequestLog,
      completeExternalRequestLog,
    } = setup();
    acceptV2.mockRejectedValueOnce(
      new ExternalApiFailure(
        'MAPPING_VALUE_INVALID',
        '客户字段无法转换为话术变量',
        422,
        {
          issues: [
            {
              externalCustomerId: '11111111-1111-4111-8111-111111111101',
              variable: '客户称呼',
              reason: '客户称呼: 来源字段 customer_name 为空',
            },
          ],
          errorCount: 1,
          truncated: false,
        },
      ),
    );
    const rawBody = JSON.stringify(validV2Request);
    const response = await app.request('/openapi/v2/outbound/tasks', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-access-token': 'erp-local-access-token',
        'idempotency-key': 'mapping-failure-001',
      },
      body: rawBody,
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: 'MAPPING_VALUE_INVALID',
      details: { errorCount: 1 },
    });
    expect(startExternalRequestLog).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceSystem: 'UNKNOWN',
        operationCode: 'CREATE_OUTBOUND_BATCH',
        idempotencyKey: 'mapping-failure-001',
      }),
    );
    expect(
      Object.getPrototypeOf(startExternalRequestLog.mock.calls[0]![0].query),
    ).toBe(Object.prototype);
    expect(completeExternalRequestLog).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceSystem: 'ERP',
        clientId: 'erp-local-01',
        requestBody: rawBody,
        responseStatus: 422,
        errorCode: 'MAPPING_VALUE_INVALID',
        errorMessage: '客户字段无法转换为话术变量',
        responseSummary: expect.objectContaining({
          code: 'MAPPING_VALUE_INVALID',
          errorCount: 1,
        }),
      }),
    );
  });

  it('does not leak unexpected failures or switch to the admin error envelope', async () => {
    const { app, accept } = setup();
    accept.mockRejectedValueOnce(new Error('database connection details'));
    const response = await app.request('/openapi/v1/outbound/tasks', {
      method: 'POST',
      headers: {
        'x-access-token': 'erp-local-access-token',
        'idempotency-key': 'idempotency-001',
      },
      body: JSON.stringify(validRequest),
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      code: 'SERVICE_TEMPORARILY_UNAVAILABLE',
      message: '平台暂不可受理请求，请稍后重试',
      requestId: 'request-001',
    });
  });
});

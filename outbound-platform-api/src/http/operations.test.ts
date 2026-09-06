import { describe, expect, it, vi } from 'vitest';
import type { MappingRepository } from '../mapping/repository.js';
import {
  OperationsConsoleFailure,
  type OperationsConsoleService,
} from '../operations/service.js';
import { createApp } from './app.js';

function setup() {
  const listStudios = vi.fn(async () => ({ total: 0, studios: [] }));
  const createStudio = vi.fn(async () => ({ id: 'studio-created' }));
  const updateStudio = vi.fn(async () => ({ id: 'studio-updated' }));
  const setStudioStatus = vi.fn(async () => ({ id: 'studio-disabled' }));
  const listLedger = vi.fn(async () => ({ total: 0, items: [] }));
  const topUp = vi.fn(async () => ({ entry: { ledgerId: 'ledger-1' } }));
  const getPricingOverview = vi.fn(async () => ({
    studios: [],
    supplierTiers: [],
  }));
  const previewPricing = vi.fn(async () => ({ affectedStudioCount: 5 }));
  const publishPricing = vi.fn(async () => ({
    published: [{ version: 2 }],
  }));
  const service = {
    listStudios,
    createStudio,
    updateStudio,
    setStudioStatus,
    listLedger,
    topUp,
    getPricingOverview,
    previewPricing,
    publishPricing,
  } as unknown as OperationsConsoleService;
  const app = createApp({
    mappingRepository: {} as MappingRepository,
    operationsConsoleService: service,
    consoleOrigin: 'http://localhost:4173',
    workerSharedSecret: 'test-worker-secret-at-least-24',
    createId: () => 'request-operations-001',
  });
  return {
    app,
    listStudios,
    createStudio,
    updateStudio,
    setStudioStatus,
    listLedger,
    topUp,
    getPricingOverview,
    previewPricing,
    publishPricing,
  };
}

const actorHeaders = { 'x-actor-id': 'platform-admin' };
const jsonHeaders = {
  ...actorHeaders,
  'content-type': 'application/json',
};
const studioId = 'cf9806bb-2166-43b0-8fdc-c7bb48115880';

describe('operator configuration and billing HTTP API', () => {
  it('lists studios with database filters and requires an actor', async () => {
    const { app, listStudios } = setup();
    const unauthorized = await app.request('/api/v1/studios');
    expect(unauthorized.status).toBe(401);

    const response = await app.request(
      '/api/v1/studios?keyword=%E7%B4%AB%E8%97%A4&studioStatus=ACTIVE&accountStatus=LOW_BALANCE&pageNum=1&pageSize=50',
      { headers: actorHeaders },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      requestId: 'request-operations-001',
      data: { total: 0 },
    });
    expect(listStudios).toHaveBeenCalledWith({
      keyword: '紫藤',
      studioStatus: 'ACTIVE',
      accountStatus: 'LOW_BALANCE',
      pageNum: 1,
      pageSize: 50,
    });
  });

  it('creates, updates and disables a studio with audit identity', async () => {
    const { app, createStudio, updateStudio, setStudioStatus } = setup();
    const created = await app.request('/api/v1/studios', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        name: '阶段六测试影楼',
        mcCode: 'MC-STAGE6-001',
        contactName: '测试联系人',
        contactPhone: '13800138000',
      }),
    });
    expect(created.status).toBe(201);
    expect(createStudio).toHaveBeenCalledWith(
      expect.objectContaining({ mcCode: 'MC-STAGE6-001' }),
      'platform-admin',
      'request-operations-001',
    );

    const updated = await app.request(`/api/v1/studios/${studioId}`, {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({ name: '阶段六测试影楼（更新）' }),
    });
    expect(updated.status).toBe(200);
    expect(updateStudio).toHaveBeenCalledWith(
      studioId,
      { name: '阶段六测试影楼（更新）' },
      'platform-admin',
      'request-operations-001',
    );

    const disabled = await app.request(`/api/v1/studios/${studioId}/status`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ status: 'DISABLED', reason: '暂停新任务' }),
    });
    expect(disabled.status).toBe(200);
    expect(setStudioStatus).toHaveBeenCalledWith(
      studioId,
      'DISABLED',
      '暂停新任务',
      'platform-admin',
      'request-operations-001',
    );
  });

  it('lists ledger entries and posts idempotent top-ups with evidence', async () => {
    const { app, listLedger, topUp: topUpOperation } = setup();
    const ledgerResponse = await app.request(
      `/api/v1/account-ledger?studioId=${studioId}&entryType=TOP_UP&pageNum=0&pageSize=20`,
      { headers: actorHeaders },
    );
    expect(ledgerResponse.status).toBe(200);
    expect(listLedger).toHaveBeenCalledWith({
      keyword: undefined,
      studioId,
      entryType: 'TOP_UP',
      pageNum: 0,
      pageSize: 20,
    });

    const topUp = await app.request('/api/v1/account-ledger/top-ups', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        studioId,
        amount: '1000.00',
        idempotencyKey: '3ff4d93c-91a8-4a34-a2f2-127f429d0e37',
        channel: 'CORPORATE_TRANSFER',
        receiptReference: 'BANK-20260906-001',
        receiptFileName: 'bank-receipt.pdf',
        reason: '线下到账核验完成',
      }),
    });
    expect(topUp.status).toBe(201);
    expect(topUpOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: '1000.00',
        receiptReference: 'BANK-20260906-001',
      }),
      'platform-admin',
      'request-operations-001',
    );
  });

  it('previews and publishes immutable pricing versions', async () => {
    const { app, previewPricing, publishPricing } = setup();
    const overview = await app.request('/api/v1/pricing', {
      headers: actorHeaders,
    });
    expect(overview.status).toBe(200);

    const input = {
      mode: 'UNIFORM',
      rate: {
        voiceRate: '0.52',
        smsRate: '0.08',
        frozenMinutes: 2,
      },
      effectiveFrom: '2026-09-06T10:00:00.000Z',
      reason: '阶段六统一调价验证',
    };
    const preview = await app.request('/api/v1/pricing/preview', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(input),
    });
    expect(preview.status).toBe(200);
    expect(previewPricing).toHaveBeenCalledWith(input);

    const published = await app.request('/api/v1/pricing/publish', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(input),
    });
    expect(published.status).toBe(201);
    expect(publishPricing).toHaveBeenCalledWith(
      input,
      'platform-admin',
      'request-operations-001',
    );
  });

  it('keeps operational failures in the admin error envelope', async () => {
    const { app, listStudios } = setup();
    listStudios.mockRejectedValueOnce(
      new OperationsConsoleFailure(
        'MC_CODE_CONFLICT',
        'MC code 已被其他影楼使用',
        409,
      ),
    );
    const response = await app.request('/api/v1/studios', {
      headers: actorHeaders,
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'MC_CODE_CONFLICT',
        message: 'MC code 已被其他影楼使用',
        requestId: 'request-operations-001',
      },
    });
  });
});

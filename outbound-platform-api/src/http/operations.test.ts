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
  const previewSupplierPricing = vi.fn(async () => ({
    tierCount: 2,
    effectiveFrom: '2026-10-31T16:00:00.000Z',
  }));
  const publishSupplierPricing = vi.fn(async () => ({
    published: [{ tierCode: 'tier-basic' }, { tierCode: 'tier-scale' }],
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
    previewSupplierPricing,
    publishSupplierPricing,
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
    previewSupplierPricing,
    publishSupplierPricing,
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
        endpoints: [
          {
            sourceSystem: 'ERP',
            resultUrl: 'https://erp.example.com/result',
            recordingUrl: 'https://erp.example.com/recording',
          },
          {
            sourceSystem: 'CRM',
            resultUrl: 'https://crm.example.com/result',
            recordingUrl: 'https://crm.example.com/recording',
          },
        ],
      }),
    });
    expect(created.status).toBe(201);
    expect(createStudio).toHaveBeenCalledWith(
      expect.objectContaining({
        mcCode: 'MC-STAGE6-001',
        endpoints: expect.arrayContaining([
          expect.objectContaining({ sourceSystem: 'ERP' }),
          expect.objectContaining({ sourceSystem: 'CRM' }),
        ]),
      }),
      'platform-admin',
      'request-operations-001',
    );

    const updated = await app.request(`/api/v1/studios/${studioId}`, {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({
        name: '阶段六测试影楼（更新）',
        endpoints: [
          {
            sourceSystem: 'ERP',
            resultUrl: 'https://erp-v2.example.com/result',
            recordingUrl: 'https://erp-v2.example.com/recording',
          },
        ],
      }),
    });
    expect(updated.status).toBe(200);
    expect(updateStudio).toHaveBeenCalledWith(
      studioId,
      {
        name: '阶段六测试影楼（更新）',
        endpoints: [
          {
            sourceSystem: 'ERP',
            resultUrl: 'https://erp-v2.example.com/result',
            recordingUrl: 'https://erp-v2.example.com/recording',
          },
        ],
      },
      'platform-admin',
      'request-operations-001',
    );

    const legacyHttpEndpoint = await app.request('/api/v1/studios', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        name: '旧系统 HTTP 端点影楼',
        mcCode: 'MC-HTTP-001',
        endpoints: [
          {
            sourceSystem: 'ERP',
            resultUrl: 'http://testmc.6161520.cn:8083/SAi/Sx_AI_CallResult',
            recordingUrl:
              'http://testmc.6161520.cn:8083/SAi/Sx_AI_UpdateVoiceUrl',
          },
        ],
      }),
    });
    expect(legacyHttpEndpoint.status).toBe(201);
    expect(createStudio).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mcCode: 'MC-HTTP-001',
        endpoints: [
          expect.objectContaining({
            sourceSystem: 'ERP',
            resultUrl: 'http://testmc.6161520.cn:8083/SAi/Sx_AI_CallResult',
            recordingUrl:
              'http://testmc.6161520.cn:8083/SAi/Sx_AI_UpdateVoiceUrl',
          }),
        ],
      }),
      'platform-admin',
      'request-operations-001',
    );

    const invalidEndpoint = await app.request('/api/v1/studios', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        name: '非 HTTP 端点影楼',
        mcCode: 'MC-FTP-001',
        endpoints: [
          {
            sourceSystem: 'ERP',
            resultUrl: 'ftp://erp.example.com/result',
            recordingUrl: 'https://erp.example.com/recording',
          },
        ],
      }),
    });
    expect(invalidEndpoint.status).toBe(400);
    expect(createStudio).toHaveBeenCalledTimes(2);

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

  it('previews and publishes a complete operator-maintained supplier tier set', async () => {
    const { app, previewSupplierPricing, publishSupplierPricing } = setup();
    const input = {
      effectiveFrom: '2026-10-31T16:00:00.000Z',
      reason: '海南人像新一期供应价格确认',
      tiers: [
        {
          tierCode: 'tier-basic',
          name: '基础阶梯',
          minMonthlyMinutes: '0',
          maxMonthlyMinutes: '10000',
          voiceRate: '0.20',
          smsRate: '0.08',
        },
        {
          tierCode: 'tier-scale',
          name: '规模阶梯',
          minMonthlyMinutes: '10000',
          maxMonthlyMinutes: null,
          voiceRate: '0.18',
          smsRate: '0.07',
        },
      ],
    };

    const preview = await app.request('/api/v1/supplier-pricing/preview', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(input),
    });
    expect(preview.status).toBe(200);
    expect(previewSupplierPricing).toHaveBeenCalledWith(input);

    const published = await app.request('/api/v1/supplier-pricing/publish', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(input),
    });
    expect(published.status).toBe(201);
    expect(publishSupplierPricing).toHaveBeenCalledWith(
      input,
      'platform-admin',
      'request-operations-001',
    );

    const invalid = await app.request('/api/v1/supplier-pricing/preview', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        ...input,
        tiers: [
          input.tiers[0],
          { ...input.tiers[1], minMonthlyMinutes: '12000' },
        ],
      }),
    });
    expect(invalid.status).toBe(400);
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

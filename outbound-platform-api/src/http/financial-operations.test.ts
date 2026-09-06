import { describe, expect, it, vi } from 'vitest';
import type { MappingRepository } from '../mapping/repository.js';
import type { AccountAdjustmentService } from '../operations/adjustment-service.js';
import type { OperatorAuditService } from '../operations/audit-service.js';
import { OperationsConsoleFailure } from '../operations/service.js';
import { createApp } from './app.js';

const adjustmentId = '9a18bd58-aa86-46d6-bfc7-18ce85447b3c';
const studioId = 'cf9806bb-2166-43b0-8fdc-c7bb48115880';
const actorHeaders = { 'x-actor-id': 'finance-checker' };
const jsonHeaders = { ...actorHeaders, 'content-type': 'application/json' };

function setup() {
  const listAdjustments = vi.fn(async () => ({ total: 0, items: [] }));
  const createAdjustment = vi.fn(async () => ({ id: adjustmentId }));
  const decideAdjustment = vi.fn(async () => ({
    id: adjustmentId,
    status: 'APPROVED',
  }));
  const listAuditEvents = vi.fn(async () => ({ total: 0, items: [] }));
  const app = createApp({
    mappingRepository: {} as MappingRepository,
    accountAdjustmentService: {
      listAdjustments,
      createAdjustment,
      decideAdjustment,
    } as unknown as AccountAdjustmentService,
    operatorAuditService: {
      listAuditEvents,
    } as unknown as OperatorAuditService,
    consoleOrigin: 'http://localhost:4173',
    workerSharedSecret: 'test-worker-secret-at-least-24',
    createId: () => 'request-finance-001',
  });
  return {
    app,
    listAdjustments,
    createAdjustment,
    decideAdjustment,
    listAuditEvents,
  };
}

describe('financial approval and audit HTTP API', () => {
  it('requires an actor and forwards adjustment filters', async () => {
    const { app, listAdjustments } = setup();
    const unauthorized = await app.request('/api/v1/account-adjustments');
    expect(unauthorized.status).toBe(401);

    const response = await app.request(
      `/api/v1/account-adjustments?studioId=${studioId}&kind=REFUND&status=PENDING&pageNum=1&pageSize=50`,
      { headers: actorHeaders },
    );
    expect(response.status).toBe(200);
    expect(listAdjustments).toHaveBeenCalledWith(
      {
        keyword: undefined,
        studioId,
        kind: 'REFUND',
        status: 'PENDING',
        pageNum: 1,
        pageSize: 50,
      },
      'finance-checker',
    );
  });

  it('creates a pending request with idempotency input', async () => {
    const { app, createAdjustment } = setup();
    const response = await app.request('/api/v1/account-adjustments', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        studioId,
        kind: 'ADJUSTMENT_CREDIT',
        amount: '250.00',
        reason: '补录历史到账差额',
        supportingReference: 'WORKORDER-20260906-001',
        idempotencyKey: '3ff4d93c-91a8-4a34-a2f2-127f429d0e37',
      }),
    });
    expect(response.status).toBe(201);
    expect(createAdjustment).toHaveBeenCalledWith(
      expect.objectContaining({
        studioId,
        kind: 'ADJUSTMENT_CREDIT',
        amount: '250.00',
      }),
      'finance-checker',
      'request-finance-001',
    );
  });

  it('approves or rejects through the dedicated decision route', async () => {
    const { app, decideAdjustment } = setup();
    const response = await app.request(
      `/api/v1/account-adjustments/${adjustmentId}/decisions`,
      {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
          decision: 'APPROVE',
          note: '已核对工单与账户流水',
        }),
      },
    );
    expect(response.status).toBe(200);
    expect(decideAdjustment).toHaveBeenCalledWith(
      adjustmentId,
      { decision: 'APPROVE', note: '已核对工单与账户流水' },
      'finance-checker',
      'request-finance-001',
    );
  });

  it('returns typed maker-checker conflicts without writing a generic 500', async () => {
    const { app, decideAdjustment } = setup();
    decideAdjustment.mockRejectedValueOnce(
      new OperationsConsoleFailure(
        'SELF_REVIEW_NOT_ALLOWED',
        '申请人与复核人必须是不同管理员',
        409,
      ),
    );
    const response = await app.request(
      `/api/v1/account-adjustments/${adjustmentId}/decisions`,
      {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ decision: 'REJECT', note: '复核拒绝' }),
      },
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'SELF_REVIEW_NOT_ALLOWED',
        message: '申请人与复核人必须是不同管理员',
        requestId: 'request-finance-001',
      },
    });
  });

  it('lists sanitized audit events by category', async () => {
    const { app, listAuditEvents } = setup();
    const response = await app.request(
      '/api/v1/audit-logs?keyword=AR-20260906&category=FINANCIAL&pageNum=0&pageSize=20',
      { headers: actorHeaders },
    );
    expect(response.status).toBe(200);
    expect(listAuditEvents).toHaveBeenCalledWith({
      keyword: 'AR-20260906',
      category: 'FINANCIAL',
      pageNum: 0,
      pageSize: 20,
    });
  });
});

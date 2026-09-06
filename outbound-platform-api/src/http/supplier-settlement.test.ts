import { describe, expect, it, vi } from 'vitest';
import type { MappingRepository } from '../mapping/repository.js';
import type { SupplierMonthlySettlementService } from '../billing/monthly-settlement-service.js';
import { OperationsConsoleFailure } from '../operations/service.js';
import { createApp } from './app.js';

const actorHeaders = { 'x-actor-id': 'finance-settlement-operator' };
const jsonHeaders = { ...actorHeaders, 'content-type': 'application/json' };
const sourceHash = 'a'.repeat(64);
const idempotencyKey = '9a18bd58-aa86-46d6-bfc7-18ce85447b3c';

const summary = {
  settlementId: null,
  settlementMonth: '2026-08',
  timezone: 'Asia/Shanghai' as const,
  periodStart: '2026-07-31T16:00:00.000Z',
  periodEnd: '2026-08-31T16:00:00.000Z',
  status: 'OPEN' as const,
  taskCount: 2,
  totalBillingMinutes: '10000',
  tier: {
    id: '1842e74b-f55b-4280-837a-e7a45c22279a',
    tierCode: 'growth',
    name: '成长阶梯',
    minMonthlyMinutes: '10000',
    maxMonthlyMinutes: '50000',
    voiceRate: '0.180000',
  },
  totalCustomerCharge: '4800.000000',
  totalPlatformCost: '1800.000000',
  totalProfit: '3000.000000',
  sourceHash,
  reconciliation: {
    status: 'BALANCED' as const,
    discrepancyCount: 0,
    blockingTaskCount: 0,
    lateTaskCount: 0,
    issues: [],
    issuesTruncated: false,
  },
  finalizedBy: null,
  finalizedAt: null,
  idempotentReplay: false,
};

function setup() {
  const preview = vi.fn(async () => summary);
  const finalize = vi.fn(async () => ({
    ...summary,
    settlementId: '2d767c12-8f26-443c-9cd2-87b237e21cf6',
    status: 'FINALIZED' as const,
    finalizedBy: 'finance-settlement-operator',
    finalizedAt: '2026-09-01T01:00:00.000Z',
  }));
  const app = createApp({
    mappingRepository: {} as MappingRepository,
    supplierMonthlySettlementService: {
      preview,
      finalize,
    } as SupplierMonthlySettlementService,
    consoleOrigin: 'http://localhost:4173',
    workerSharedSecret: 'test-worker-secret-at-least-24',
    createId: () => 'request-settlement-001',
  });
  return { app, preview, finalize };
}

describe('supplier monthly settlement HTTP API', () => {
  it('requires an operator and validates the month before previewing', async () => {
    const { app, preview } = setup();
    expect(
      (await app.request('/api/v1/supplier-settlements/2026-08/preview'))
        .status,
    ).toBe(401);
    expect(
      (
        await app.request('/api/v1/supplier-settlements/2026-13/preview', {
          headers: actorHeaders,
        })
      ).status,
    ).toBe(400);

    const response = await app.request(
      '/api/v1/supplier-settlements/2026-08/preview',
      { headers: actorHeaders },
    );
    expect(response.status).toBe(200);
    expect(preview).toHaveBeenCalledWith('2026-08');
  });

  it('finalizes an audited preview with optimistic and idempotency keys', async () => {
    const { app, finalize } = setup();
    const response = await app.request(
      '/api/v1/supplier-settlements/2026-08/finalize',
      {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
          expectedSourceHash: sourceHash,
          reason: '月度账务核对无差异，执行封账',
          idempotencyKey,
        }),
      },
    );
    expect(response.status).toBe(201);
    expect(finalize).toHaveBeenCalledWith(
      '2026-08',
      {
        expectedSourceHash: sourceHash,
        reason: '月度账务核对无差异，执行封账',
        idempotencyKey,
      },
      'finance-settlement-operator',
      'request-settlement-001',
    );
  });

  it('returns reconciliation conflicts without exposing an internal error', async () => {
    const { app, finalize } = setup();
    finalize.mockRejectedValueOnce(
      new OperationsConsoleFailure(
        'SETTLEMENT_PREVIEW_STALE',
        '预览后账务数据已变化，请重新预览并核对',
        409,
        { currentSourceHash: 'b'.repeat(64) },
      ),
    );
    const response = await app.request(
      '/api/v1/supplier-settlements/2026-08/finalize',
      {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
          expectedSourceHash: sourceHash,
          reason: '月度账务核对无差异，执行封账',
          idempotencyKey,
        }),
      },
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'SETTLEMENT_PREVIEW_STALE',
        message: '预览后账务数据已变化，请重新预览并核对',
        requestId: 'request-settlement-001',
        details: { currentSourceHash: 'b'.repeat(64) },
      },
    });
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { PlatformCostDetailService } from '../billing/platform-cost-detail-service.js';
import type { MappingRepository } from '../mapping/repository.js';
import { createApp } from './app.js';

const actorHeaders = { 'x-actor-id': 'platform-finance-operator' };
const studioId = '11111111-1111-4111-8111-111111111111';

function setup() {
  const listDetails = vi.fn(async () => ({
    total: 0,
    pages: 0,
    pageNum: 0,
    pageSize: 20,
    summary: {
      taskCount: 0,
      totalBillingMinutes: '0',
      totalCustomerCharge: '0.000000',
      totalPlatformCost: '0.000000',
      totalProfit: '0.000000',
      unpricedBillingMinutes: '0',
      statusCounts: {
        all: 0,
        provisional: 0,
        final: 0,
        adjustmentPending: 0,
        unavailable: 0,
      },
    },
    items: [],
  }));
  const exportDetails = vi.fn(async () => ({
    fileName: '平台明细_2026-09-01_2026-09-14.csv',
    csv: '\uFEFF"任务编号"\r\n"PT-20260914-00001"',
    rowCount: 1,
  }));
  const service = { listDetails, exportDetails } as PlatformCostDetailService;
  const app = createApp({
    mappingRepository: {} as MappingRepository,
    platformCostDetailService: service,
    consoleOrigin: 'http://localhost:4173',
    workerSharedSecret: 'test-worker-secret-at-least-24',
    createId: () => 'request-platform-detail-001',
  });
  return { app, listDetails, exportDetails };
}

describe('platform cost detail HTTP API', () => {
  it('requires an operator and delegates all list filters', async () => {
    const { app, listDetails } = setup();
    expect((await app.request('/api/v1/platform-cost-details')).status).toBe(
      401,
    );

    const search = new URLSearchParams({
      keyword: '海南门店',
      studioId,
      costStatus: 'FINAL',
      occurredFrom: '2026-08-31T16:00:00.000Z',
      occurredBefore: '2026-09-14T16:00:00.000Z',
      pageNum: '2',
      pageSize: '50',
    });
    const response = await app.request(
      `/api/v1/platform-cost-details?${search}`,
      { headers: actorHeaders },
    );
    expect(response.status).toBe(200);
    expect(listDetails).toHaveBeenCalledWith({
      keyword: '海南门店',
      studioId,
      costStatus: 'FINAL',
      occurredFrom: new Date('2026-08-31T16:00:00.000Z'),
      occurredBefore: new Date('2026-09-14T16:00:00.000Z'),
      pageNum: 2,
      pageSize: 50,
    });
  });

  it('exports the complete filtered result as a no-store UTF-8 CSV', async () => {
    const { app, exportDetails } = setup();
    const search = new URLSearchParams({
      costStatus: 'PROVISIONAL',
      occurredFrom: '2026-08-31T16:00:00.000Z',
      occurredBefore: '2026-09-14T16:00:00.000Z',
    });
    const response = await app.request(
      `/api/v1/platform-cost-details/export?${search}`,
      { headers: actorHeaders },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-export-row-count')).toBe('1');
    expect(response.headers.get('content-disposition')).toContain(
      "filename*=UTF-8''",
    );
    expect(await response.text()).toContain('PT-20260914-00001');
    expect(exportDetails).toHaveBeenCalledWith({
      keyword: undefined,
      studioId: undefined,
      costStatus: 'PROVISIONAL',
      occurredFrom: new Date('2026-08-31T16:00:00.000Z'),
      occurredBefore: new Date('2026-09-14T16:00:00.000Z'),
    });
  });

  it('rejects reversed and overlong date ranges before querying data', async () => {
    const { app, listDetails } = setup();
    const reversed = new URLSearchParams({
      occurredFrom: '2026-09-14T16:00:00.000Z',
      occurredBefore: '2026-09-01T16:00:00.000Z',
    });
    expect(
      (
        await app.request(`/api/v1/platform-cost-details?${reversed}`, {
          headers: actorHeaders,
        })
      ).status,
    ).toBe(400);

    const overlong = new URLSearchParams({
      occurredFrom: '2025-01-01T00:00:00.000Z',
      occurredBefore: '2026-09-01T00:00:00.000Z',
    });
    expect(
      (
        await app.request(`/api/v1/platform-cost-details?${overlong}`, {
          headers: actorHeaders,
        })
      ).status,
    ).toBe(400);
    expect(listDetails).not.toHaveBeenCalled();
  });
});

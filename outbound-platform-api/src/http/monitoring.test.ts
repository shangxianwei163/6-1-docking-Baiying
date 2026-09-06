import { describe, expect, it, vi } from 'vitest';
import type { MappingRepository } from '../mapping/repository.js';
import type { IntegrationLogService } from '../operations/integration-log-service.js';
import type { OperationsOverviewService } from '../operations/overview-service.js';
import { createApp } from './app.js';

const actorHeaders = { 'x-actor-id': 'operations-observer' };

function setup() {
  const getOverview = vi.fn(async () => ({
    generatedAt: '2026-09-06T12:00:00.000Z',
    businessDate: '2026-09-06',
  }));
  const listLogs = vi.fn(async () => ({
    total: 0,
    pages: 0,
    pageNum: 0,
    pageSize: 20,
    summary: { all: 0 },
    items: [],
  }));
  const app = createApp({
    mappingRepository: {} as MappingRepository,
    operationsOverviewService: {
      getOverview,
    } as unknown as OperationsOverviewService,
    integrationLogService: {
      listLogs,
    } as unknown as IntegrationLogService,
    consoleOrigin: 'http://localhost:4173',
    workerSharedSecret: 'test-worker-secret-at-least-24',
    createId: () => 'request-monitoring-001',
  });
  return { app, getOverview, listLogs };
}

describe('operator monitoring HTTP API', () => {
  it('requires an actor before returning the database overview', async () => {
    const { app, getOverview } = setup();
    const unauthorized = await app.request('/api/v1/operations-overview');
    expect(unauthorized.status).toBe(401);

    const response = await app.request('/api/v1/operations-overview', {
      headers: actorHeaders,
    });
    expect(response.status).toBe(200);
    expect(getOverview).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toMatchObject({
      requestId: 'request-monitoring-001',
      data: { businessDate: '2026-09-06' },
    });
  });

  it('validates and forwards interface log filters', async () => {
    const { app, listLogs } = setup();
    const response = await app.request(
      '/api/v1/integration-logs?keyword=PT-20260906&sourceSystem=BAIYING&direction=OUTBOUND&status=FAILED&pageNum=2&pageSize=50',
      { headers: actorHeaders },
    );
    expect(response.status).toBe(200);
    expect(listLogs).toHaveBeenCalledWith({
      keyword: 'PT-20260906',
      sourceSystem: 'BAIYING',
      direction: 'OUTBOUND',
      status: 'FAILED',
      pageNum: 2,
      pageSize: 50,
    });
  });

  it('rejects unsupported interface-log filters before querying storage', async () => {
    const { app, listLogs } = setup();
    const response = await app.request(
      '/api/v1/integration-logs?sourceSystem=OTHER&pageSize=500',
      { headers: actorHeaders },
    );
    expect(response.status).toBe(400);
    expect(listLogs).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from 'vitest';
import type {
  BaiyingCompletedCall,
  BaiyingCompletedCallPage,
} from '../baiying/call-job-client.js';
import {
  BaiyingReconciliationService,
  type ClaimedReconciliation,
  type ReconciliationRepository,
} from './service.js';

const now = new Date('2026-09-08T08:00:00.000Z');

function task(
  overrides: Partial<ClaimedReconciliation> = {},
): ClaimedReconciliation {
  return {
    taskId: '11111111-1111-4111-8111-111111111111',
    taskNo: 'PT-20260908-00001',
    companyId: '263120',
    callJobId: '241491320',
    expectedCallCount: 501,
    providerCallCount: null,
    platformCallCount: 0,
    stableRounds: 0,
    mismatchSince: null,
    failureAttempts: 0,
    ...overrides,
  };
}

function call(index: number): BaiyingCompletedCall {
  return {
    callInstanceId: String(900_000 + index),
    callJobId: '241491320',
    callInstanceStatus: 2,
    finishStatus: index % 2 ? 0 : 8,
    calledTimes: 1,
    customerTelephone: `1380000${String(index).padStart(4, '0')}`,
    customerName: null,
    durationSeconds: index % 2 ? 61 : 0,
    startTime: 1788854400000 + index * 1_000,
    endTime: 1788854401000 + index * 1_000,
    fullRecordingUrl:
      index % 2 ? `https://recording.example/${index}.mp3` : null,
    userRecordingUrl: null,
    properties: { sx_platform_item_id: `item-${index}` },
    userProperties: {},
    resultList: [{ name: '客户意向等级', value: 'A' }],
  };
}

function page(
  pageNum: number,
  calls: BaiyingCompletedCall[],
  total = 501,
  pages = 2,
): BaiyingCompletedCallPage {
  return {
    total,
    pages,
    pageNum,
    calls,
    requestId: `request-${pageNum}`,
    response: { code: 200 },
  };
}

function repository(claimed: ClaimedReconciliation | null) {
  return {
    claimNext: vi.fn(async () => claimed),
    countPlatformCalls: vi.fn(async () => 0),
    countPendingInbox: vi.fn(async () => 0),
    finishCycle: vi.fn(async () => undefined),
    failCycle: vi.fn(async () => undefined),
  } satisfies ReconciliationRepository;
}

describe('BaiyingReconciliationService', () => {
  it('pages at 500 and writes every provider call through the encrypted callback ingress', async () => {
    const first = Array.from({ length: 500 }, (_, index) => call(index));
    const last = call(500);
    const repo = repository(task());
    repo.countPendingInbox.mockResolvedValue(502);
    const client = {
      getCallJob: vi.fn(async () => ({
        job: {
          callJobId: '241491320',
          callJobName: 'LIVE',
          state: 'COMPLETED' as const,
          importedCustomerCount: 501,
        },
        requestId: 'job-request',
        response: { code: 200 },
      })),
      listCompletedCalls: vi
        .fn()
        .mockResolvedValueOnce(page(1, first))
        .mockResolvedValueOnce(page(2, [last])),
    };
    const ingress = { ingest: vi.fn(async () => ({ replayed: false })) };
    const service = new BaiyingReconciliationService(repo, client, ingress, {
      workerId: 'worker-1',
      clock: () => now,
    });

    await expect(service.runOnce()).resolves.toMatchObject({
      status: 'SYNCED',
      providerCallCount: 501,
      insertedInboxCount: 502,
      reconciliationStatus: 'PENDING',
    });
    expect(client.listCompletedCalls).toHaveBeenNthCalledWith(1, {
      companyId: '263120',
      callJobId: '241491320',
      pageNum: 1,
      pageSize: 500,
    });
    expect(client.listCompletedCalls).toHaveBeenNthCalledWith(2, {
      companyId: '263120',
      callJobId: '241491320',
      pageNum: 2,
      pageSize: 500,
    });
    expect(ingress.ingest).toHaveBeenCalledTimes(502);
    const ingressCalls = ingress.ingest.mock.calls as unknown as Array<
      [{ rawBody: string; headers: Headers }]
    >;
    const firstCallBody = JSON.parse(ingressCalls[1]![0].rawBody);
    expect(firstCallBody.data).toMatchObject({
      callbackType: 'CALL_INSTANCE_RESULT',
      data: {
        callInstance: {
          companyId: '263120',
          callJobId: '241491320',
          callInstanceId: '900000',
          properties: { sx_platform_item_id: 'item-0' },
          collectProperties: {},
          resultComplete: false,
        },
      },
    });
  });

  it('requires two unchanged complete rounds before marking reconciliation complete', async () => {
    const completed = call(1);
    const repo = repository(
      task({
        expectedCallCount: 1,
        providerCallCount: 1,
        platformCallCount: 1,
        stableRounds: 1,
      }),
    );
    repo.countPlatformCalls.mockResolvedValue(1);
    const client = {
      getCallJob: vi.fn(async () => ({
        job: {
          callJobId: '241491320',
          callJobName: 'LIVE',
          state: 'COMPLETED' as const,
          importedCustomerCount: 1,
        },
        response: { code: 200 },
      })),
      listCompletedCalls: vi.fn(async () => page(1, [completed], 1, 1)),
    };
    const ingress = { ingest: vi.fn(async () => ({ replayed: true })) };
    const service = new BaiyingReconciliationService(repo, client, ingress, {
      workerId: 'worker-1',
      clock: () => now,
    });

    await expect(service.runOnce()).resolves.toMatchObject({
      reconciliationStatus: 'RECONCILED',
      stableRounds: 2,
    });
    expect(repo.finishCycle).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'RECONCILED',
        stableRounds: 2,
        mismatchSince: null,
      }),
    );
  });

  it('moves a mismatch older than 15 minutes to manual review without completing the task', async () => {
    const repo = repository(
      task({
        expectedCallCount: 2,
        providerCallCount: 1,
        platformCallCount: 0,
        mismatchSince: new Date(now.getTime() - 15 * 60_000),
      }),
    );
    const client = {
      getCallJob: vi.fn(async () => ({
        job: {
          callJobId: '241491320',
          callJobName: 'LIVE',
          state: 'COMPLETED' as const,
          importedCustomerCount: 2,
        },
        response: { code: 200 },
      })),
      listCompletedCalls: vi.fn(async () => page(1, [call(1)], 1, 1)),
    };
    const ingress = { ingest: vi.fn(async () => ({ replayed: true })) };
    const service = new BaiyingReconciliationService(repo, client, ingress, {
      workerId: 'worker-1',
      clock: () => now,
    });

    await expect(service.runOnce()).resolves.toMatchObject({
      reconciliationStatus: 'MANUAL_REVIEW',
      providerCallCount: 1,
      platformCallCount: 0,
    });
    expect(repo.finishCycle).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'MANUAL_REVIEW',
        stableRounds: 0,
      }),
    );
  });
});

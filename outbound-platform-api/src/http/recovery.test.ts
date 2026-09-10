import { describe, expect, it, vi } from 'vitest';
import type { MappingRepository } from '../mapping/repository.js';
import type { RecoveryOperationsService } from '../operations/recovery-service.js';
import type { TaskControlService } from '../operations/task-control-service.js';
import type { ReconciliationOperations } from '../reconciliation/postgres-repository.js';
import { createApp } from './app.js';

const taskNo = 'PT-20260906-00001';
const fixedId = '5f9ad46d-d4a7-4cbc-b388-f505b6141724';
const secondId = '612df6af-84f5-4dad-961d-cb0a5f921db7';
const thirdId = '8d246d65-c692-4c97-b1f5-1d029a2a94f8';

function mappingRepository(): MappingRepository {
  return {
    variableExistsInLatestSnapshot: vi.fn(async () => true),
    saveDraft: vi.fn(),
    stageRemoval: vi.fn(),
    listDrafts: vi.fn(async () => []),
    listPublishedRules: vi.fn(async () => []),
    listVersions: vi.fn(async () => []),
    publishDrafts: vi.fn(),
    recordSuccessfulObservation: vi.fn(),
    listSceneReadiness: vi.fn(async () => []),
    enqueueVariableSync: vi.fn(),
  };
}

function deadLetter(status: 'OPEN' | 'REPLAYING' | 'IGNORED' = 'OPEN') {
  return {
    id: fixedId,
    sourceType: 'OUTBOX' as const,
    sourceId: secondId,
    sourceLabel: '队列事件',
    eventType: 'TASK_ACCEPTED',
    taskNo,
    status,
    replayCount: status === 'REPLAYING' ? 1 : 0,
    finalError: '模拟消费失败',
    suggestedAction: '修复后重放',
    replayable: status === 'OPEN',
    replayBlockedReason: status === 'OPEN' ? null : '当前状态不允许重放',
    sourceStatus: 'DEAD_LETTERED',
    originalSummary: { eventType: 'TASK_ACCEPTED' },
    createdAt: '2026-09-06T10:00:00.000Z',
    resolvedBy: status === 'IGNORED' ? 'operator-2' : null,
    resolvedAt: status === 'IGNORED' ? '2026-09-06T10:01:00.000Z' : null,
    resolutionNote: status === 'IGNORED' ? '业务确认无需补发' : null,
  };
}

function reconciliation(status: 'MANUAL_REVIEW' | 'PENDING' = 'MANUAL_REVIEW') {
  return {
    taskId: fixedId,
    taskNo,
    taskName: '阶段 4B 测试任务',
    status,
    providerState: 'COMPLETED',
    expectedCallCount: 2,
    providerCallCount: 2,
    platformCallCount: 1,
    pendingInboxCount: 0,
    stableRounds: 0,
    mismatchSince: '2026-09-06T09:40:00.000Z',
    lastCheckedAt: '2026-09-06T10:00:00.000Z',
    nextCheckAt: status === 'PENDING' ? '2026-09-06T10:01:00.000Z' : null,
    lastSuccessfulAt: '2026-09-06T10:00:00.000Z',
    lastProviderRequestId: 'provider-request-1',
    failureAttempts: 0,
    lastError: null,
    manualReviewAt:
      status === 'MANUAL_REVIEW' ? '2026-09-06T10:00:00.000Z' : null,
    repairCount: status === 'PENDING' ? 1 : 0,
    lastRepairRequestedAt:
      status === 'PENDING' ? '2026-09-06T10:01:00.000Z' : null,
    updatedAt: '2026-09-06T10:00:00.000Z',
  } as const;
}

describe('operator recovery APIs', () => {
  it('lists reconciliation mismatches and submits an audited manual repair', async () => {
    const listReconciliations = vi.fn<
      ReconciliationOperations['listReconciliations']
    >(async () => ({
      total: 1,
      pages: 1,
      pageNum: 0,
      pageSize: 20,
      items: [reconciliation()],
    }));
    const requestRepair = vi.fn<ReconciliationOperations['requestRepair']>(
      async () => ({
        reconciliation: reconciliation('PENDING'),
        idempotentReplay: false,
        replayedInboxCount: 1,
        message: '失败 Inbox 已恢复为待处理，对账任务已安排立即复查',
      }),
    );
    const app = createApp({
      mappingRepository: mappingRepository(),
      consoleOrigin: 'http://localhost:4173',
      workerSharedSecret: 'a-worker-secret-longer-than-24-characters',
      createId: () => fixedId,
      reconciliationOperations: { listReconciliations, requestRepair },
    });

    const listResponse = await app.request(
      '/api/v1/reconciliations?status=MANUAL_REVIEW&pageNum=0&pageSize=20',
      { headers: { 'x-actor-id': 'operator-4b' } },
    );
    expect(listResponse.status).toBe(200);
    expect(listReconciliations).toHaveBeenCalledWith({
      status: 'MANUAL_REVIEW',
      pageNum: 0,
      pageSize: 20,
    });

    const repairResponse = await app.request(
      `/api/v1/outbound-tasks/${taskNo}/reconciliation/repair`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-actor-id': 'operator-4b',
          'x-request-id': 'request-reconciliation-repair',
        },
        body: JSON.stringify({
          reason: '已核对百应任务和漏回调，重新拉取并处理',
          idempotencyKey: thirdId,
        }),
      },
    );
    expect(repairResponse.status).toBe(202);
    expect(requestRepair).toHaveBeenCalledWith(
      taskNo,
      {
        reason: '已核对百应任务和漏回调，重新拉取并处理',
        idempotencyKey: thirdId,
      },
      'operator-4b',
      'request-reconciliation-repair',
    );
  });

  it('validates and delegates task commands with actor and request identity', async () => {
    const commandTask = vi.fn<TaskControlService['commandTask']>(
      async (_taskNo, input) => ({
        actionId: fixedId,
        taskNo,
        action: input.command,
        status: 'SUCCEEDED',
        executionStatus: 'PAUSED',
        providerMode: 'LOCAL_SIMULATION',
        idempotentReplay: false,
        requestedAt: '2026-09-06T10:00:00.000Z',
        message: '本地安全模拟已确认命令',
      }),
    );
    const app = createApp({
      mappingRepository: mappingRepository(),
      consoleOrigin: 'http://localhost:4173',
      workerSharedSecret: 'a-worker-secret-longer-than-24-characters',
      createId: () => fixedId,
      taskControlService: {
        commandTask,
        retryTask: vi.fn(),
      },
    });
    const response = await app.request(
      `/api/v1/outbound-tasks/${taskNo}/commands`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-actor-id': 'operator-1',
          'x-request-id': 'request-command-1',
        },
        body: JSON.stringify({
          command: 'PAUSE',
          reason: '影楼临时暂停活动',
          idempotencyKey: secondId,
        }),
      },
    );
    expect(response.status).toBe(200);
    expect(commandTask).toHaveBeenCalledWith(
      taskNo,
      {
        command: 'PAUSE',
        reason: '影楼临时暂停活动',
        idempotencyKey: secondId,
      },
      'operator-1',
      'request-command-1',
    );
  });

  it('lists and replays dead letters through audited routes', async () => {
    const listDeadLetters = vi.fn<RecoveryOperationsService['listDeadLetters']>(
      async () => ({
        total: 1,
        pages: 1,
        pageNum: 0,
        pageSize: 20,
        summary: {
          all: 1,
          open: 1,
          replaying: 0,
          resolved: 0,
          ignored: 0,
          outbox: 1,
          callback: 0,
          recording: 0,
          delivery: 0,
        },
        items: [deadLetter()],
      }),
    );
    const replayDeadLetter = vi.fn<
      RecoveryOperationsService['replayDeadLetter']
    >(async () => ({
      deadLetter: deadLetter('REPLAYING'),
      idempotentReplay: false,
      message: '原事件已恢复到待处理队列',
    }));
    const app = createApp({
      mappingRepository: mappingRepository(),
      consoleOrigin: 'http://localhost:4173',
      workerSharedSecret: 'a-worker-secret-longer-than-24-characters',
      createId: () => fixedId,
      recoveryOperationsService: {
        listDeadLetters,
        replayDeadLetter,
        ignoreDeadLetter: vi.fn(),
      },
    });
    const listResponse = await app.request(
      '/api/v1/dead-letters?sourceType=OUTBOX&status=OPEN&pageNum=0&pageSize=20',
      { headers: { 'x-actor-id': 'operator-1' } },
    );
    expect(listResponse.status).toBe(200);
    expect(listDeadLetters).toHaveBeenCalledWith({
      sourceType: 'OUTBOX',
      status: 'OPEN',
      pageNum: 0,
      pageSize: 20,
    });

    const replayResponse = await app.request(
      `/api/v1/dead-letters/${fixedId}/replay`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-actor-id': 'operator-1',
          'x-request-id': 'request-replay-1',
        },
        body: JSON.stringify({
          reason: '已修复消费逻辑',
          idempotencyKey: secondId,
        }),
      },
    );
    expect(replayResponse.status).toBe(202);
    expect(replayDeadLetter).toHaveBeenCalledWith(
      fixedId,
      { reason: '已修复消费逻辑', idempotencyKey: secondId },
      'operator-1',
      'request-replay-1',
    );
  });

  it('rejects a command without an auditable reason', async () => {
    const app = createApp({
      mappingRepository: mappingRepository(),
      consoleOrigin: 'http://localhost:4173',
      workerSharedSecret: 'a-worker-secret-longer-than-24-characters',
      createId: () => fixedId,
      taskControlService: {
        commandTask: vi.fn(),
        retryTask: vi.fn(),
      },
    });
    const response = await app.request(
      `/api/v1/outbound-tasks/${taskNo}/commands`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-actor-id': 'operator-1',
        },
        body: JSON.stringify({
          command: 'TERMINATE',
          reason: '',
          idempotencyKey: secondId,
        }),
      },
    );
    expect(response.status).toBe(400);
  });

  it('delegates safe task retry and dead-letter ignore actions', async () => {
    const retryTask = vi.fn<TaskControlService['retryTask']>(
      async (_taskNo, _input, _actorId, _requestId) => ({
        actionId: thirdId,
        taskNo,
        action: 'RETRY',
        status: 'QUEUED',
        executionStatus: 'BAIYING_CREATING',
        providerMode: 'LOCAL_SIMULATION',
        idempotentReplay: false,
        requestedAt: '2026-09-06T10:01:00.000Z',
        message: '任务已安全恢复并重新入队',
      }),
    );
    const ignoreDeadLetter = vi.fn<
      RecoveryOperationsService['ignoreDeadLetter']
    >(async () => ({
      deadLetter: deadLetter('IGNORED'),
      idempotentReplay: false,
      message: '死信已标记为忽略',
    }));
    const app = createApp({
      mappingRepository: mappingRepository(),
      consoleOrigin: 'http://localhost:4173',
      workerSharedSecret: 'a-worker-secret-longer-than-24-characters',
      createId: () => fixedId,
      taskControlService: {
        commandTask: vi.fn(),
        retryTask,
      },
      recoveryOperationsService: {
        listDeadLetters: vi.fn(),
        replayDeadLetter: vi.fn(),
        ignoreDeadLetter,
      },
    });

    const retryResponse = await app.request(
      `/api/v1/outbound-tasks/${taskNo}/retry`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-actor-id': 'operator-2',
          'x-request-id': 'request-retry-1',
        },
        body: JSON.stringify({
          reason: '供应商短时故障已经恢复',
          idempotencyKey: secondId,
        }),
      },
    );
    expect(retryResponse.status).toBe(202);
    expect(retryTask).toHaveBeenCalledWith(
      taskNo,
      {
        reason: '供应商短时故障已经恢复',
        idempotencyKey: secondId,
      },
      'operator-2',
      'request-retry-1',
    );

    const ignoreResponse = await app.request(
      `/api/v1/dead-letters/${fixedId}/ignore`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-actor-id': 'operator-2',
          'x-request-id': 'request-ignore-1',
        },
        body: JSON.stringify({
          reason: '业务确认无需补发',
          idempotencyKey: thirdId,
        }),
      },
    );
    expect(ignoreResponse.status).toBe(200);
    expect(ignoreDeadLetter).toHaveBeenCalledWith(
      fixedId,
      { reason: '业务确认无需补发', idempotencyKey: thirdId },
      'operator-2',
      'request-ignore-1',
    );
  });
});

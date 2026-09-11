import { describe, expect, it, vi } from 'vitest';
import { LocalDataProtector } from '../security/data-protector.js';
import {
  CallbackBusinessConflictError,
  CallbackTaskNotFoundError,
  type BaiyingCallbackProcessor,
} from './processor.js';
import type { CallbackInboxRepository } from './repository.js';
import { inspectBaiyingCallback } from './schema.js';
import { BaiyingCallbackWorker } from './worker.js';

const protector = new LocalDataProtector(
  'callback-worker-test-secret-long-enough',
  'test',
);

describe('BaiyingCallbackWorker', () => {
  it('processes a valid callback and completes its Inbox claim', async () => {
    const rawBody = jobCallback('JOB_INFO_RESULT');
    const complete = vi.fn<CallbackInboxRepository['complete']>();
    const process = vi.fn<BaiyingCallbackProcessor['process']>(async () => ({
      callbackType: 'JOB_INFO_RESULT',
      taskId: '3d34ac58-b5dc-432e-8687-fc60468ad442',
      duplicate: false,
      settled: true,
    }));
    const worker = new BaiyingCallbackWorker(
      repositoryFor(rawBody, { complete }),
      { process },
      protector,
      { workerId: 'worker-1' },
    );

    await expect(worker.runOnce()).resolves.toMatchObject({
      status: 'SUCCEEDED',
      callbackType: 'JOB_INFO_RESULT',
      settled: true,
    });
    expect(process).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledWith({
      inboxId: '06dc2653-59e6-4150-92b7-f710575441cf',
      workerId: 'worker-1',
    });
  });

  it.each([
    ['{', 'INVALID'],
    [jobCallback('FUTURE_CALLBACK'), 'UNKNOWN_TYPE'],
  ] as const)(
    'dead-letters non-processable input as %s',
    async (rawBody, status) => {
      const reject = vi.fn<CallbackInboxRepository['reject']>();
      const process = vi.fn<BaiyingCallbackProcessor['process']>();
      const worker = new BaiyingCallbackWorker(
        repositoryFor(rawBody, { reject }),
        { process },
        protector,
        { workerId: 'worker-2' },
      );
      await expect(worker.runOnce()).resolves.toMatchObject({
        status: 'REJECTED',
        parseStatus: status,
      });
      expect(process).not.toHaveBeenCalled();
      expect(reject).toHaveBeenCalledWith(
        expect.objectContaining({ parseStatus: status }),
      );
    },
  );

  it('schedules a bounded retry when business processing fails', async () => {
    const rawBody = jobCallback('JOB_INFO_RESULT');
    const fail = vi.fn<CallbackInboxRepository['fail']>(async () => ({
      status: 'RETRY_SCHEDULED',
      attempts: 1,
      availableAt: '2026-09-06T12:00:05.000Z',
    }));
    const worker = new BaiyingCallbackWorker(
      repositoryFor(rawBody, { fail }),
      {
        process: vi.fn(async () => {
          throw new Error('unknown task');
        }),
      },
      protector,
      { workerId: 'worker-3', retryDelaysMs: [5_000], maxAttempts: 2 },
    );
    await expect(worker.runOnce()).resolves.toMatchObject({
      status: 'RETRY_SCHEDULED',
      attempts: 1,
    });
    expect(fail).toHaveBeenCalledWith(
      expect.objectContaining({
        retryDelayMs: 5_000,
        maxAttempts: 2,
      }),
    );
  });

  it('briefly retries a callback for an unmanaged Baiying task', async () => {
    const rawBody = jobCallback('JOB_INFO_RESULT');
    const fail = vi.fn<CallbackInboxRepository['fail']>(async () => ({
      status: 'RETRY_SCHEDULED',
      attempts: 1,
      availableAt: '2026-09-06T12:00:10.000Z',
    }));
    const ignoreUnmanagedTask =
      vi.fn<CallbackInboxRepository['ignoreUnmanagedTask']>();
    const worker = new BaiyingCallbackWorker(
      repositoryFor(rawBody, { fail, ignoreUnmanagedTask }),
      {
        process: vi.fn(async () => {
          throw new CallbackTaskNotFoundError('未找到百应任务');
        }),
      },
      protector,
      { workerId: 'worker-unmanaged-retry' },
    );

    await expect(worker.runOnce()).resolves.toMatchObject({
      status: 'RETRY_SCHEDULED',
      attempts: 1,
    });
    expect(fail).toHaveBeenCalledWith(
      expect.objectContaining({
        retryDelayMs: 10_000,
        maxAttempts: 4,
        parseStatus: 'VALID',
      }),
    );
    expect(ignoreUnmanagedTask).not.toHaveBeenCalled();
  });

  it('ignores an unmanaged Baiying task after the five-minute grace period', async () => {
    const rawBody = jobCallback('JOB_INFO_RESULT');
    const ignoreUnmanagedTask = vi.fn<
      CallbackInboxRepository['ignoreUnmanagedTask']
    >(async () => ({ status: 'IGNORED', reason: 'UNMANAGED_TASK' }));
    const claimNext = vi.fn<CallbackInboxRepository['claimNext']>();
    const fail = vi.fn<CallbackInboxRepository['fail']>();
    const repository = repositoryFor(rawBody, {
      claimNext,
      fail,
      ignoreUnmanagedTask,
    });
    claimNext.mockResolvedValueOnce({
      id: '06dc2653-59e6-4150-92b7-f710575441cf',
      callbackType: 'JOB_INFO_RESULT',
      eventKey: 'event-key',
      rawBodyCiphertext: protector.encryptUtf8(rawBody),
      rawBodySha256: inspectBaiyingCallback(rawBody).rawBodySha256,
      processAttempts: 4,
      receivedAt: '2026-09-06T12:00:00.000Z',
    });
    const worker = new BaiyingCallbackWorker(
      repository,
      {
        process: vi.fn(async () => {
          throw new CallbackTaskNotFoundError('未找到百应任务');
        }),
      },
      protector,
      { workerId: 'worker-unmanaged-ignore' },
    );

    await expect(worker.runOnce()).resolves.toEqual({
      status: 'IGNORED',
      inboxId: '06dc2653-59e6-4150-92b7-f710575441cf',
      callbackType: 'JOB_INFO_RESULT',
      reason: 'UNMANAGED_TASK',
    });
    expect(ignoreUnmanagedTask).toHaveBeenCalledWith({
      inboxId: '06dc2653-59e6-4150-92b7-f710575441cf',
      workerId: 'worker-unmanaged-ignore',
    });
    expect(fail).not.toHaveBeenCalled();
  });

  it('dead-letters a deterministic correlation conflict immediately', async () => {
    const rawBody = jobCallback('JOB_INFO_RESULT');
    const fail = vi.fn<CallbackInboxRepository['fail']>(async () => ({
      status: 'DEAD_LETTERED',
      attempts: 1,
      availableAt: null,
    }));
    const worker = new BaiyingCallbackWorker(
      repositoryFor(rawBody, { fail }),
      {
        process: vi.fn(async () => {
          throw new CallbackBusinessConflictError('关联签名无效');
        }),
      },
      protector,
      { workerId: 'worker-4', maxAttempts: 6 },
    );

    await expect(worker.runOnce()).resolves.toMatchObject({
      status: 'DEAD_LETTERED',
      attempts: 1,
    });
    expect(fail).toHaveBeenCalledWith(
      expect.objectContaining({ maxAttempts: 1, parseStatus: 'VALID' }),
    );
  });
});

function repositoryFor(
  rawBody: string,
  overrides: Partial<CallbackInboxRepository>,
): CallbackInboxRepository {
  return {
    save: vi.fn(),
    claimNext: vi.fn(async () => ({
      id: '06dc2653-59e6-4150-92b7-f710575441cf',
      callbackType: 'JOB_INFO_RESULT',
      eventKey: 'event-key',
      rawBodyCiphertext: protector.encryptUtf8(rawBody),
      rawBodySha256: inspectBaiyingCallback(rawBody).rawBodySha256,
      processAttempts: 1,
      receivedAt: '2026-09-06T12:00:00.000Z',
    })),
    complete: vi.fn(),
    ignoreUnmanagedTask: vi.fn(),
    reject: vi.fn(),
    fail: vi.fn(),
    ...overrides,
  };
}

function jobCallback(callbackType: string): string {
  return JSON.stringify({
    data: {
      callbackType,
      data: { companyId: 1, callJobId: 2, callJobStatus: 2 },
    },
  });
}

import { describe, expect, it, vi } from 'vitest';
import type { BaiyingCallJobClient } from '../baiying/call-job-client.js';
import { LocalDataProtector } from '../security/data-protector.js';
import type {
  OrchestrationTask,
  TaskOrchestrationRepository,
} from './repository.js';
import { TaskOrchestrationService } from './service.js';

const baseTask: OrchestrationTask = {
  id: '11111111-1111-4111-8111-111111111111',
  batchId: '22222222-2222-4222-8222-222222222222',
  contractVersion: '2.0',
  taskNo: 'PT-20260909-00001',
  taskName: '批次子任务',
  sourceSystem: 'ERP',
  mcCode: '5903679116',
  phoneCount: 1,
  baiyingCompanyId: '263120',
  baiyingCallJobId: '241491320',
  robotDefId: '4845020',
  userPhoneId: '1788320',
  executionStatus: 'IMPORTED',
  callItems: [],
};

describe('v2 batch start barrier', () => {
  it('leaves an imported child waiting without starting Baiying', async () => {
    const { repository, releaseBatchStartBarrier } = repositoryFor(
      baseTask,
      'WAITING',
    );
    const { client, executeCallJob } = clientMock();
    const service = new TaskOrchestrationService(
      repository,
      client,
      protector(),
    );

    await expect(service.run(baseTask.id)).resolves.toMatchObject({
      executionStatus: 'IMPORTED',
      outcome: 'WAITING_FOR_BATCH',
    });
    expect(releaseBatchStartBarrier).toHaveBeenCalledWith({
      batchId: baseTask.batchId,
      currentTaskId: baseTask.id,
    });
    expect(executeCallJob).not.toHaveBeenCalled();
  });

  it('terminates an imported child when another route failed before release', async () => {
    let task = { ...baseTask };
    const { repository, recordFailure } = repositoryFor(task, 'FAILED');
    repository.getTask = vi.fn(async () => task);
    recordFailure.mockImplementation(async () => {
      task = { ...task, executionStatus: 'START_FAILED' };
    });
    const { client, executeCallJob } = clientMock();
    const service = new TaskOrchestrationService(
      repository,
      client,
      protector(),
    );

    await expect(service.run(task.id)).resolves.toMatchObject({
      executionStatus: 'START_FAILED',
      outcome: 'TERMINAL_OR_ALREADY_STARTED',
    });
    expect(executeCallJob).toHaveBeenCalledTimes(1);
    expect(executeCallJob).toHaveBeenCalledWith({
      callJobId: task.baiyingCallJobId,
      companyId: task.baiyingCompanyId,
      command: 3,
    });
    expect(recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'BATCH_START_BARRIER_ABORTED',
        releaseHold: true,
      }),
    );
  });
});

function repositoryFor(
  task: OrchestrationTask,
  barrier: 'WAITING' | 'RELEASED' | 'FAILED',
): {
  repository: TaskOrchestrationRepository;
  releaseBatchStartBarrier: ReturnType<typeof vi.fn>;
  recordFailure: ReturnType<typeof vi.fn>;
} {
  const releaseBatchStartBarrier = vi.fn(async () => barrier);
  const recordFailure = vi.fn();
  const repository: TaskOrchestrationRepository = {
    getTask: vi.fn(async () => task),
    beginOperation: vi.fn(async () => ({ id: 'operation-1', attemptNo: 1 })),
    finishOperation: vi.fn(),
    markPendingOperationsUnknown: vi.fn(),
    countOperations: vi.fn(async () => 0),
    recordCreated: vi.fn(),
    recordImported: vi.fn(),
    isBatchAborted: vi.fn(async () => false),
    releaseBatchStartBarrier,
    recordCalling: vi.fn(),
    recordFailure,
  };
  return { repository, releaseBatchStartBarrier, recordFailure };
}

function clientMock(): {
  client: BaiyingCallJobClient;
  executeCallJob: ReturnType<typeof vi.fn>;
} {
  const executeCallJob = vi.fn(async () => ({ response: { code: 200 } }));
  const client: BaiyingCallJobClient = {
    createCallJob: vi.fn(),
    findCallJobsByName: vi.fn(),
    getCallJob: vi.fn(),
    importCustomers: vi.fn(),
    executeCallJob,
  };
  return { client, executeCallJob };
}

function protector() {
  return new LocalDataProtector(
    'test-root-secret-with-at-least-24-characters',
    'test',
  );
}

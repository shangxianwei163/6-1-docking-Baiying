import { describe, expect, it, vi } from 'vitest';
import {
  BaiyingProviderError,
  type BaiyingCallJobClient,
} from '../baiying/call-job-client.js';
import { LocalDataProtector } from '../security/data-protector.js';
import type {
  OrchestrationTask,
  TaskOperationFailure,
  TaskOrchestrationRepository,
} from './repository.js';
import { TaskOrchestrationService } from './service.js';

const acceptedTask: OrchestrationTask = {
  id: '11111111-1111-4111-8111-111111111111',
  batchId: '22222222-2222-4222-8222-222222222222',
  contractVersion: '2.0',
  taskNo: 'PT-20260918-00026',
  taskName: '20260918排挡3周SS100026',
  sourceSystem: 'ERP',
  mcCode: '5903679116',
  phoneCount: 1,
  baiyingCompanyId: '263120',
  baiyingCallJobId: null,
  robotDefId: '4845020',
  userPhoneId: '1788320',
  executionStatus: 'ACCEPTED',
  callItems: [],
};

describe('permanent Baiying create failures', () => {
  it('ends the task immediately when Baiying explicitly rejects creation', async () => {
    const harness = repositoryHarness(acceptedTask, null);
    const createCallJob = vi.fn(async () => {
      throw new BaiyingProviderError(
        'PERMANENT',
        'BAIYING_10000401',
        '任务名称不能超过50个字符',
        {
          requestId: 'provider-request-1',
          response: {
            code: 10000401,
            requestId: 'provider-request-1',
            resultMsg: '任务名称不能超过50个字符',
          },
        },
      );
    });
    const client = clientMock({ createCallJob });
    const service = new TaskOrchestrationService(
      harness.repository,
      client,
      protector(),
    );

    await expect(service.run(acceptedTask.id)).resolves.toMatchObject({
      executionStatus: 'CREATE_FAILED',
      outcome: 'TERMINAL_OR_ALREADY_STARTED',
    });

    expect(createCallJob).toHaveBeenCalledOnce();
    expect(harness.recordFailure).toHaveBeenCalledWith({
      taskId: acceptedTask.id,
      executionStatus: 'CREATE_FAILED',
      stage: 'BAIYING_CREATE',
      code: 'BAIYING_10000401',
      message: '任务名称不能超过50个字符',
      retryable: false,
      releaseHold: true,
    });
    expect(harness.finishOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'FAILED',
        errorClass: 'BAIYING_PROVIDER_PERMANENT',
        errorCode: 'BAIYING_10000401',
        providerRequestId: 'provider-request-1',
      }),
    );
  });

  it('never calls Baiying again when recovery finds a persisted permanent failure', async () => {
    const previousFailure: TaskOperationFailure = {
      status: 'FAILED',
      errorClass: 'BAIYING_PROVIDER_ERROR',
      errorCode: 'BAIYING_10000401',
      errorMessage: '任务名称不能超过50个字符',
    };
    const task = {
      ...acceptedTask,
      executionStatus: 'BAIYING_CREATING' as const,
    };
    const harness = repositoryHarness(task, previousFailure);
    const createCallJob = vi.fn(async () => ({
      callJobId: '241491320',
      response: { code: 200 },
    }));
    const findCallJobsByName = vi.fn(async () => ({
      jobs: [],
      response: { code: 200 },
    }));
    const client = clientMock({ createCallJob, findCallJobsByName });
    const service = new TaskOrchestrationService(
      harness.repository,
      client,
      protector(),
    );

    await expect(service.run(task.id)).resolves.toMatchObject({
      executionStatus: 'CREATE_FAILED',
    });

    expect(createCallJob).not.toHaveBeenCalled();
    expect(findCallJobsByName).not.toHaveBeenCalled();
    expect(harness.markPendingOperationsUnknown).not.toHaveBeenCalled();
    expect(harness.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'BAIYING_10000401',
        retryable: false,
        releaseHold: true,
      }),
    );
  });

  it('rejects an overlong name locally without calling Baiying', async () => {
    const task = { ...acceptedTask, taskName: '超'.repeat(51) };
    const harness = repositoryHarness(task, null);
    const createCallJob = vi.fn(async () => ({
      callJobId: '241491320',
      response: { code: 200 },
    }));
    const client = clientMock({ createCallJob });
    const service = new TaskOrchestrationService(
      harness.repository,
      client,
      protector(),
    );

    await expect(service.run(task.id)).resolves.toMatchObject({
      executionStatus: 'CREATE_FAILED',
    });

    expect(createCallJob).not.toHaveBeenCalled();
    expect(harness.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'BAIYING_TASK_NAME_INVALID',
        retryable: false,
        releaseHold: true,
      }),
    );
  });
});

function repositoryHarness(
  initialTask: OrchestrationTask,
  previousFailure: TaskOperationFailure | null,
) {
  let task = { ...initialTask };
  const finishOperation = vi.fn();
  const markPendingOperationsUnknown = vi.fn();
  const recordFailure = vi.fn<
    TaskOrchestrationRepository['recordFailure']
  >(async (input) => {
    task = { ...task, executionStatus: input.executionStatus };
  });
  const repository: TaskOrchestrationRepository = {
    getTask: vi.fn(async () => task),
    beginOperation: vi.fn(async (input) => {
      if (input.nextStatus) {
        task = { ...task, executionStatus: input.nextStatus };
      }
      return { id: 'operation-1', attemptNo: 1 };
    }),
    finishOperation,
    markPendingOperationsUnknown,
    countOperations: vi.fn(async () => 0),
    getLatestOperationFailure: vi.fn(async () => previousFailure),
    recordCreated: vi.fn(),
    recordImported: vi.fn(),
    isBatchAborted: vi.fn(async () => false),
    releaseBatchStartBarrier: vi.fn(
      async (): Promise<'RELEASED'> => 'RELEASED',
    ),
    recordCalling: vi.fn(),
    recordFailure,
  };
  return {
    repository,
    finishOperation,
    markPendingOperationsUnknown,
    recordFailure,
  };
}

function clientMock(
  overrides: Partial<BaiyingCallJobClient> = {},
): BaiyingCallJobClient {
  return {
    createCallJob: vi.fn(async () => ({
      callJobId: '241491320',
      response: { code: 200 },
    })),
    findCallJobsByName: vi.fn(async () => ({
      jobs: [],
      response: { code: 200 },
    })),
    getCallJob: vi.fn(async () => ({
      job: null,
      response: { code: 200 },
    })),
    importCustomers: vi.fn(async () => ({
      total: 1,
      successNum: 1,
      placeFailNum: 0,
      repeatNum: 0,
      response: { code: 200 },
    })),
    executeCallJob: vi.fn(async () => ({ response: { code: 200 } })),
    ...overrides,
  };
}

function protector() {
  return new LocalDataProtector(
    'test-root-secret-with-at-least-24-characters',
    'test',
  );
}

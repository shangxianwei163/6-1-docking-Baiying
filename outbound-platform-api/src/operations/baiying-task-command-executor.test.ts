import { describe, expect, it, vi } from 'vitest';
import type { BaiyingCallJobClient } from '../baiying/call-job-client.js';
import { BaiyingTaskCommandExecutor } from './task-control-service.js';

function client(overrides: Partial<BaiyingCallJobClient> = {}) {
  const executeCallJob = vi.fn<BaiyingCallJobClient['executeCallJob']>(
    async () => ({
      requestId: 'execute-request',
      response: { code: 200, resultMsg: 'successful' },
    }),
  );
  const getCallJob = vi.fn<BaiyingCallJobClient['getCallJob']>(async () => ({
    requestId: 'detail-request',
    response: { code: 200, resultMsg: 'successful' },
    job: {
      callJobId: '241491320',
      callJobName: 'LIVE-TEST',
      state: 'PAUSED' as const,
      importedCustomerCount: 1,
    },
  }));
  const provider: BaiyingCallJobClient = {
    createCallJob: vi.fn(),
    findCallJobsByName: vi.fn(),
    importCustomers: vi.fn(),
    executeCallJob,
    getCallJob,
    ...overrides,
  };
  return { provider, executeCallJob, getCallJob };
}

describe('BaiyingTaskCommandExecutor', () => {
  it('maps PAUSE to command 2 and confirms the real provider state', async () => {
    const { provider, executeCallJob } = client();
    const executor = new BaiyingTaskCommandExecutor(provider);

    await expect(
      executor.execute({
        companyId: '263120',
        callJobId: '241491320',
        command: 'PAUSE',
      }),
    ).resolves.toMatchObject({
      requestId: 'execute-request',
      confirmedState: 'PAUSED',
    });
    expect(executeCallJob).toHaveBeenCalledWith({
      companyId: '263120',
      callJobId: '241491320',
      command: 2,
    });
  });

  it('marks an accepted command unknown when the target state cannot be confirmed', async () => {
    const getCallJob = vi.fn<BaiyingCallJobClient['getCallJob']>(async () => ({
      response: { code: 200 },
      job: {
        callJobId: '241491320',
        callJobName: 'LIVE-TEST',
        state: 'CREATED' as const,
        importedCustomerCount: 1,
      },
    }));
    const { provider } = client({ getCallJob });
    const executor = new BaiyingTaskCommandExecutor(provider, {
      confirmationAttempts: 2,
      confirmationIntervalMs: 0,
      delay: async () => undefined,
    });

    await expect(
      executor.execute({
        companyId: '263120',
        callJobId: '241491320',
        command: 'RESUME',
      }),
    ).rejects.toMatchObject({
      kind: 'UNKNOWN_OUTCOME',
      code: 'BAIYING_COMMAND_CONFIRMATION_TIMEOUT',
    });
    expect(getCallJob).toHaveBeenCalledTimes(2);
  });
});

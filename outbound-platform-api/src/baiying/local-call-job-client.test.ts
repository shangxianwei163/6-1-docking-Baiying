import { describe, expect, it } from 'vitest';
import { BaiyingProviderError } from './call-job-client.js';
import { LocalBaiyingCallJobClient } from './local-call-job-client.js';

const createInput = {
  callJobName: 'PT-20260906-00001-12345678',
  callJobType: 1 as const,
  companyId: 'LOCAL-MOCK',
  robotDefId: 'LOCAL-ROBOT-ERP-001',
  userPhoneIds: ['LOCAL-LINE-001'],
};

const customer = {
  platformItemId: '11111111-1111-4111-8111-111111111111',
  name: '本地客户',
  phone: '13800138000',
  properties: {
    客户称呼: '王女士',
    sx_platform_item_id: '11111111-1111-4111-8111-111111111111',
  },
};

describe('LocalBaiyingCallJobClient', () => {
  it('runs create, import, start and terminate without network calls', async () => {
    const client = new LocalBaiyingCallJobClient();
    const created = await client.createCallJob(createInput);
    const imported = await client.importCustomers({
      callJobId: created.callJobId,
      companyId: createInput.companyId,
      customers: [customer],
      permitRepeatNumber: false,
    });
    expect(imported).toMatchObject({
      total: 1,
      successNum: 1,
      placeFailNum: 0,
      repeatNum: 0,
    });

    await client.executeCallJob({
      callJobId: created.callJobId,
      companyId: createInput.companyId,
      command: 1,
    });
    await expect(
      client.getCallJob({
        callJobId: created.callJobId,
        companyId: createInput.companyId,
      }),
    ).resolves.toMatchObject({
      job: { state: 'CALLING', importedCustomerCount: 1 },
    });

    await client.executeCallJob({
      callJobId: created.callJobId,
      companyId: createInput.companyId,
      command: 3,
    });
    await expect(
      client.getCallJob({
        callJobId: created.callJobId,
        companyId: createInput.companyId,
      }),
    ).resolves.toMatchObject({ job: { state: 'TERMINATED' } });
  });

  it('keeps a committed create visible after an unknown outcome', async () => {
    const client = new LocalBaiyingCallJobClient('CREATE_UNKNOWN_AFTER_COMMIT');
    await expect(client.createCallJob(createInput)).rejects.toMatchObject({
      kind: 'UNKNOWN_OUTCOME',
      code: 'LOCAL_CREATE_TIMEOUT',
    } satisfies Partial<BaiyingProviderError>);
    await expect(
      client.findCallJobsByName({
        companyId: createInput.companyId,
        callJobName: createInput.callJobName,
      }),
    ).resolves.toMatchObject({
      jobs: [{ callJobName: createInput.callJobName, state: 'CREATED' }],
    });
  });

  it('exposes committed import and start state after simulated timeouts', async () => {
    const importClient = new LocalBaiyingCallJobClient(
      'IMPORT_UNKNOWN_AFTER_COMMIT',
    );
    const importedJob = await importClient.createCallJob(createInput);
    await expect(
      importClient.importCustomers({
        callJobId: importedJob.callJobId,
        companyId: createInput.companyId,
        customers: [customer],
        permitRepeatNumber: false,
      }),
    ).rejects.toMatchObject({ kind: 'UNKNOWN_OUTCOME' });
    await expect(
      importClient.getCallJob({
        callJobId: importedJob.callJobId,
        companyId: createInput.companyId,
      }),
    ).resolves.toMatchObject({ job: { importedCustomerCount: 1 } });

    const startClient = new LocalBaiyingCallJobClient(
      'START_UNKNOWN_AFTER_COMMIT',
    );
    const startedJob = await startClient.createCallJob({
      ...createInput,
      callJobName: `${createInput.callJobName}-start`,
    });
    await startClient.importCustomers({
      callJobId: startedJob.callJobId,
      companyId: createInput.companyId,
      customers: [customer],
      permitRepeatNumber: false,
    });
    await expect(
      startClient.executeCallJob({
        callJobId: startedJob.callJobId,
        companyId: createInput.companyId,
        command: 1,
      }),
    ).rejects.toMatchObject({ kind: 'UNKNOWN_OUTCOME' });
    await expect(
      startClient.getCallJob({
        callJobId: startedJob.callJobId,
        companyId: createInput.companyId,
      }),
    ).resolves.toMatchObject({ job: { state: 'CALLING' } });
  });

  it('can return an explicit partial-import summary', async () => {
    const client = new LocalBaiyingCallJobClient('IMPORT_PARTIAL');
    const created = await client.createCallJob(createInput);
    await expect(
      client.importCustomers({
        callJobId: created.callJobId,
        companyId: createInput.companyId,
        customers: [
          customer,
          {
            ...customer,
            platformItemId: '22222222-2222-4222-8222-222222222222',
          },
        ],
        permitRepeatNumber: false,
      }),
    ).resolves.toMatchObject({
      total: 2,
      successNum: 1,
      placeFailNum: 1,
      repeatNum: 0,
    });
  });
});

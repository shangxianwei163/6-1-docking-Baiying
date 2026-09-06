import { createHash } from 'node:crypto';
import {
  BaiyingProviderError,
  type BaiyingCallJobClient,
  type BaiyingCallJobSnapshot,
  type BaiyingProviderMetadata,
  type CreateBaiyingCallJobInput,
  type ExecuteBaiyingCallJobInput,
  type ImportBaiyingCustomersInput,
} from './call-job-client.js';

export type LocalBaiyingScenario =
  | 'SUCCESS'
  | 'CREATE_UNKNOWN_AFTER_COMMIT'
  | 'IMPORT_UNKNOWN_AFTER_COMMIT'
  | 'IMPORT_PARTIAL'
  | 'START_UNKNOWN_AFTER_COMMIT'
  | 'START_PERMANENT_FAILURE';

type LocalJob = BaiyingCallJobSnapshot & {
  companyId: string;
  robotDefId: string;
  userPhoneIds: string[];
  importedPlatformItemIds: Set<string>;
};

/**
 * 只供本地开发和测试使用。它不会发送任何网络请求，更不会拨打真实电话。
 */
export class LocalBaiyingCallJobClient implements BaiyingCallJobClient {
  private readonly jobs = new Map<string, LocalJob>();
  private createUnknownInjected = false;
  private importUnknownInjected = false;
  private startUnknownInjected = false;
  private requestSequence = 0;

  constructor(private readonly scenario: LocalBaiyingScenario = 'SUCCESS') {}

  async createCallJob(input: CreateBaiyingCallJobInput) {
    const callJobId = localJobId(input.companyId, input.callJobName);
    const job: LocalJob = {
      callJobId,
      callJobName: input.callJobName,
      companyId: input.companyId,
      robotDefId: input.robotDefId,
      userPhoneIds: [...input.userPhoneIds],
      state: 'CREATED',
      importedCustomerCount: 0,
      importedPlatformItemIds: new Set(),
    };
    this.jobs.set(callJobId, job);
    const metadata = this.metadata('create', {
      code: 200,
      resultMsg: 'successful',
      data: { callJobId },
    });

    if (
      this.scenario === 'CREATE_UNKNOWN_AFTER_COMMIT' &&
      !this.createUnknownInjected
    ) {
      this.createUnknownInjected = true;
      throw new BaiyingProviderError(
        'UNKNOWN_OUTCOME',
        'LOCAL_CREATE_TIMEOUT',
        '本地模拟：百应已创建任务，但响应在返回前超时',
        metadata,
      );
    }
    return { ...metadata, callJobId };
  }

  async findCallJobsByName(input: { companyId: string; callJobName: string }) {
    const jobs = Array.from(this.jobs.values())
      .filter(
        (job) =>
          job.companyId === input.companyId &&
          job.callJobName === input.callJobName,
      )
      .map(toSnapshot);
    return {
      ...this.metadata('find-by-name', {
        code: 200,
        resultMsg: 'successful',
        data: { total: jobs.length },
      }),
      jobs,
    };
  }

  async getCallJob(input: { companyId: string; callJobId: string }) {
    const job = this.jobs.get(input.callJobId);
    const visible = job?.companyId === input.companyId ? job : undefined;
    return {
      ...this.metadata('get', {
        code: 200,
        resultMsg: 'successful',
        data: visible
          ? {
              callJobId: visible.callJobId,
              state: visible.state,
              importedCustomerCount: visible.importedCustomerCount,
            }
          : null,
      }),
      job: visible ? toSnapshot(visible) : null,
    };
  }

  async importCustomers(input: ImportBaiyingCustomersInput) {
    const job = this.requireJob(input.companyId, input.callJobId);
    if (job.state !== 'CREATED') {
      throw new BaiyingProviderError(
        'PERMANENT',
        'LOCAL_JOB_NOT_IMPORTABLE',
        `本地模拟任务状态 ${job.state} 不允许导入`,
      );
    }

    if (this.scenario === 'IMPORT_PARTIAL') {
      const successNum = Math.max(0, input.customers.length - 1);
      for (const customer of input.customers.slice(0, successNum)) {
        job.importedPlatformItemIds.add(customer.platformItemId);
      }
      job.importedCustomerCount = successNum;
      return {
        ...this.metadata('import', {
          code: 200,
          resultMsg: 'successful',
          data: {
            total: input.customers.length,
            successNum,
            placeFailNum: input.customers.length - successNum,
            repeatNum: 0,
          },
        }),
        total: input.customers.length,
        successNum,
        placeFailNum: input.customers.length - successNum,
        repeatNum: 0,
      };
    }

    for (const customer of input.customers) {
      job.importedPlatformItemIds.add(customer.platformItemId);
    }
    job.importedCustomerCount = job.importedPlatformItemIds.size;
    const result = {
      ...this.metadata('import', {
        code: 200,
        resultMsg: 'successful',
        data: {
          total: input.customers.length,
          successNum: input.customers.length,
          placeFailNum: 0,
          repeatNum: 0,
        },
      }),
      total: input.customers.length,
      successNum: input.customers.length,
      placeFailNum: 0,
      repeatNum: 0,
    };
    if (
      this.scenario === 'IMPORT_UNKNOWN_AFTER_COMMIT' &&
      !this.importUnknownInjected
    ) {
      this.importUnknownInjected = true;
      throw new BaiyingProviderError(
        'UNKNOWN_OUTCOME',
        'LOCAL_IMPORT_TIMEOUT',
        '本地模拟：百应已导入全部客户，但响应在返回前超时',
        result,
      );
    }
    return result;
  }

  async executeCallJob(input: ExecuteBaiyingCallJobInput) {
    const job = this.requireJob(input.companyId, input.callJobId);
    if (input.command === 3) {
      job.state = 'TERMINATED';
      return this.metadata('execute', {
        code: 200,
        resultMsg: 'successful',
        data: { command: input.command },
      });
    }
    if (input.command === 2) {
      job.state = 'PAUSED';
      return this.metadata('execute', {
        code: 200,
        resultMsg: 'successful',
        data: { command: input.command },
      });
    }
    if (this.scenario === 'START_PERMANENT_FAILURE') {
      throw new BaiyingProviderError(
        'PERMANENT',
        'LOCAL_START_REJECTED',
        '本地模拟：百应拒绝启动任务',
        this.metadata('execute', {
          code: 400,
          resultMsg: 'job cannot start',
        }),
      );
    }
    if (job.importedCustomerCount === 0) {
      throw new BaiyingProviderError(
        'PERMANENT',
        'LOCAL_JOB_EMPTY',
        '本地模拟：没有已导入客户，不能启动任务',
      );
    }
    job.state = 'CALLING';
    const metadata = this.metadata('execute', {
      code: 200,
      resultMsg: 'successful',
      data: { command: input.command },
    });
    if (
      this.scenario === 'START_UNKNOWN_AFTER_COMMIT' &&
      !this.startUnknownInjected
    ) {
      this.startUnknownInjected = true;
      throw new BaiyingProviderError(
        'UNKNOWN_OUTCOME',
        'LOCAL_START_TIMEOUT',
        '本地模拟：百应已启动任务，但响应在返回前超时',
        metadata,
      );
    }
    return metadata;
  }

  private requireJob(companyId: string, callJobId: string): LocalJob {
    const job = this.jobs.get(callJobId);
    if (!job || job.companyId !== companyId) {
      throw new BaiyingProviderError(
        'PERMANENT',
        'LOCAL_JOB_NOT_FOUND',
        '本地模拟百应任务不存在',
      );
    }
    return job;
  }

  private metadata(
    operation: string,
    response: Record<string, unknown>,
  ): BaiyingProviderMetadata {
    this.requestSequence += 1;
    return {
      requestId: `local-${operation}-${this.requestSequence}`,
      response,
    };
  }
}

function localJobId(companyId: string, callJobName: string): string {
  return `LOCAL-${createHash('sha256')
    .update(`${companyId}:${callJobName}`, 'utf8')
    .digest('hex')
    .slice(0, 20)}`;
}

function toSnapshot(job: LocalJob): BaiyingCallJobSnapshot {
  return {
    callJobId: job.callJobId,
    callJobName: job.callJobName,
    state: job.state,
    importedCustomerCount: job.importedCustomerCount,
  };
}

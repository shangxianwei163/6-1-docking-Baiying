import type { TaskExecutionStatus } from '@outbound/contracts';
import {
  BaiyingProviderError,
  type BaiyingCallJobClient,
  type BaiyingImportSummary,
  type BaiyingProviderMetadata,
} from '../baiying/call-job-client.js';
import type { DataProtector } from '../security/data-protector.js';
import { buildCallItemCorrelationToken } from '../security/correlation-token.js';
import {
  TaskNotFoundError,
  type OperationHandle,
  type OrchestrationTask,
  type TaskOrchestrationRepository,
} from './repository.js';

const TERMINAL_OR_POST_START_STATUSES = new Set<TaskExecutionStatus>([
  'CALLING',
  'PAUSED',
  'CALL_COMPLETED',
  'RECONCILING',
  'COMPLETED',
  'CREATE_FAILED',
  'IMPORT_FAILED',
  'START_FAILED',
  'CANCELLED',
  'TERMINATED',
]);

export type TaskOrchestrationResult = {
  taskId: string;
  taskNo: string;
  executionStatus: TaskExecutionStatus;
  outcome: 'CALLING' | 'WAITING_FOR_BATCH' | 'TERMINAL_OR_ALREADY_STARTED';
};

export class TaskOrchestrationRetryError extends Error {
  constructor(
    message: string,
    public readonly code = 'ORCHESTRATION_RETRY_REQUIRED',
  ) {
    super(message);
    this.name = 'TaskOrchestrationRetryError';
  }
}

export class TaskOrchestrationService {
  constructor(
    private readonly repository: TaskOrchestrationRepository,
    private readonly client: BaiyingCallJobClient,
    private readonly protector: DataProtector,
  ) {}

  async run(taskId: string): Promise<TaskOrchestrationResult> {
    for (let transition = 0; transition < 12; transition += 1) {
      const task = await this.requireTask(taskId);
      if (
        task.contractVersion === '2.0' &&
        task.batchId &&
        ['ACCEPTED', 'BAIYING_CREATED'].includes(task.executionStatus) &&
        (await this.repository.isBatchAborted(task.batchId))
      ) {
        if (task.executionStatus === 'ACCEPTED') {
          await this.repository.recordFailure({
            taskId: task.id,
            executionStatus: 'CREATE_FAILED',
            stage: 'BAIYING_CREATE',
            code: 'BATCH_PREPARATION_ABORTED',
            message:
              '同一平台批次的其他子任务准备失败，本子任务未创建百应任务并已释放冻结金额',
            retryable: false,
            releaseHold: true,
          });
        } else {
          const cleanup = await this.terminateForCleanup(task, [
            'BAIYING_CREATED',
          ]);
          await this.repository.recordFailure({
            taskId: task.id,
            executionStatus: 'IMPORT_FAILED',
            stage: 'BAIYING_IMPORT',
            code: 'BATCH_PREPARATION_ABORTED',
            message: appendCleanup(
              '同一平台批次的其他子任务准备失败，本子任务已执行整批补偿终止',
              cleanup,
            ),
            retryable: false,
            releaseHold: cleanup !== 'FAILED',
          });
        }
        continue;
      }
      if (
        task.contractVersion === '2.0' &&
        task.batchId &&
        ['IMPORTED', 'STARTING', 'CALLING', 'PAUSED'].includes(
          task.executionStatus,
        )
      ) {
        const barrier = await this.repository.releaseBatchStartBarrier({
          batchId: task.batchId,
          currentTaskId: task.id,
        });
        if (barrier === 'WAITING') {
          return {
            taskId: task.id,
            taskNo: task.taskNo,
            executionStatus: task.executionStatus,
            outcome: 'WAITING_FOR_BATCH',
          };
        }
        if (barrier === 'FAILED') {
          const cleanup = await this.terminateForCleanup(task, [
            task.executionStatus,
          ]);
          await this.repository.recordFailure({
            taskId: task.id,
            executionStatus: 'START_FAILED',
            stage: 'BAIYING_START',
            code: 'BATCH_START_BARRIER_ABORTED',
            message: appendCleanup(
              '同一平台批次的其他百应任务未能完成启动前准备，当前子任务已执行整批补偿终止',
              cleanup,
            ),
            retryable: false,
            releaseHold: cleanup !== 'FAILED',
          });
          continue;
        }
      }
      if (TERMINAL_OR_POST_START_STATUSES.has(task.executionStatus)) {
        return {
          taskId: task.id,
          taskNo: task.taskNo,
          executionStatus: task.executionStatus,
          outcome:
            task.executionStatus === 'CALLING'
              ? 'CALLING'
              : 'TERMINAL_OR_ALREADY_STARTED',
        };
      }

      if (task.executionStatus === 'ACCEPTED') {
        await this.createCallJob(task, false);
        continue;
      }
      if (task.executionStatus === 'BAIYING_CREATING') {
        await this.recoverCreate(task);
        continue;
      }
      if (task.executionStatus === 'BAIYING_CREATED') {
        await this.importCustomers(task, false);
        continue;
      }
      if (task.executionStatus === 'IMPORTING') {
        await this.recoverImport(task);
        continue;
      }
      if (task.executionStatus === 'IMPORTED') {
        await this.startCallJob(task, false);
        continue;
      }
      if (task.executionStatus === 'STARTING') {
        await this.recoverStart(task);
        continue;
      }
      throw new Error(
        `任务 ${task.taskNo} 处于编排器无法处理的状态 ${task.executionStatus}`,
      );
    }
    throw new TaskOrchestrationRetryError(
      `任务 ${taskId} 单次执行的状态迁移次数超过安全上限`,
      'ORCHESTRATION_TRANSITION_LIMIT',
    );
  }

  async handleRetriesExhausted(taskId: string, lastError: string) {
    const task = await this.requireTask(taskId);
    const message = `任务编排自动重试已耗尽：${lastError}`;
    if (
      task.executionStatus === 'ACCEPTED' ||
      task.executionStatus === 'BAIYING_CREATING'
    ) {
      await this.repository.recordFailure({
        taskId,
        executionStatus: 'CREATE_FAILED',
        stage: 'BAIYING_CREATE',
        code: 'BAIYING_CREATE_RETRIES_EXHAUSTED',
        message,
        retryable: true,
        releaseHold: true,
      });
      return;
    }
    if (
      task.executionStatus === 'BAIYING_CREATED' ||
      task.executionStatus === 'IMPORTING'
    ) {
      const cleanup = await this.terminateForCleanup(task, [
        'BAIYING_CREATED',
        'IMPORTING',
      ]);
      await this.repository.recordFailure({
        taskId,
        executionStatus: 'IMPORT_FAILED',
        stage: 'BAIYING_IMPORT',
        code: 'BAIYING_IMPORT_RETRIES_EXHAUSTED',
        message: appendCleanup(message, cleanup),
        retryable: true,
        releaseHold: true,
      });
      return;
    }
    if (
      task.executionStatus === 'IMPORTED' ||
      task.executionStatus === 'STARTING'
    ) {
      const startOutcomeUnknown = task.executionStatus === 'STARTING';
      const cleanup = startOutcomeUnknown
        ? undefined
        : await this.terminateForCleanup(task, ['IMPORTED']);
      await this.repository.recordFailure({
        taskId,
        executionStatus: 'START_FAILED',
        stage: 'BAIYING_START',
        code: 'BAIYING_START_RETRIES_EXHAUSTED',
        message: appendCleanup(
          startOutcomeUnknown
            ? `${message}；启动结果可能已生效，冻结金额暂不释放，需人工核查百应任务`
            : message,
          cleanup,
        ),
        retryable: true,
        releaseHold: !startOutcomeUnknown,
      });
    }
  }

  private async createCallJob(task: OrchestrationTask, retry: boolean) {
    const callJobName = buildCallJobName(task.taskName);
    const request = {
      callJobName,
      // 使用手动任务；定时任务（1）必须额外传 startDate，不适合平台异步编排。
      callJobType: 2 as const,
      companyId: task.baiyingCompanyId,
      robotDefId: task.robotDefId,
      userPhoneIds: [task.userPhoneId],
    };
    const operation = await this.repository.beginOperation({
      taskId: task.id,
      operationType: 'CREATE',
      expectedStatuses: retry ? ['BAIYING_CREATING'] : ['ACCEPTED'],
      nextStatus: retry ? undefined : 'BAIYING_CREATING',
      requestPayloadRedacted: request,
    });

    let result: Awaited<ReturnType<BaiyingCallJobClient['createCallJob']>>;
    try {
      result = await this.client.createCallJob(request);
    } catch (error) {
      const failure = providerFailure(error, 'BAIYING_CREATE_FAILED');
      await this.finishProviderFailure(operation, failure);
      if (failure.kind === 'PERMANENT') {
        await this.repository.recordFailure({
          taskId: task.id,
          executionStatus: 'CREATE_FAILED',
          stage: 'BAIYING_CREATE',
          code: failure.code,
          message: failure.message,
          retryable: false,
          releaseHold: true,
        });
        return;
      }
      throw new TaskOrchestrationRetryError(failure.message, failure.code);
    }
    await this.repository.finishOperation({
      operationId: operation.id,
      status: 'SUCCEEDED',
      responsePayloadRedacted: redactProviderPayload(result.response),
      providerRequestId: result.requestId,
    });
    await this.repository.recordCreated(task.id, result.callJobId);
  }

  private async recoverCreate(task: OrchestrationTask) {
    await this.repository.markPendingOperationsUnknown({
      taskId: task.id,
      operationType: 'CREATE',
      message: 'Worker 在保存创建结果前中断，改用确定性任务名查询恢复',
    });
    const callJobName = buildCallJobName(task.taskName);
    const operation = await this.repository.beginOperation({
      taskId: task.id,
      operationType: 'QUERY',
      expectedStatuses: ['BAIYING_CREATING'],
      requestPayloadRedacted: {
        purpose: 'CREATE_RECOVERY',
        companyId: task.baiyingCompanyId,
        callJobName,
      },
    });
    let result: Awaited<ReturnType<BaiyingCallJobClient['findCallJobsByName']>>;
    try {
      result = await this.client.findCallJobsByName({
        companyId: task.baiyingCompanyId,
        callJobName,
      });
    } catch (error) {
      const failure = providerFailure(error, 'BAIYING_CREATE_QUERY_FAILED');
      await this.finishProviderFailure(operation, failure);
      throw new TaskOrchestrationRetryError(failure.message, failure.code);
    }
    await this.repository.finishOperation({
      operationId: operation.id,
      status: 'SUCCEEDED',
      responsePayloadRedacted: {
        ...redactProviderPayload(result.response),
        matchCount: result.jobs.length,
        callJobIds: result.jobs.map((job) => job.callJobId),
      },
      providerRequestId: result.requestId,
    });

    if (result.jobs.length === 1) {
      await this.repository.recordCreated(task.id, result.jobs[0]!.callJobId);
      return;
    }
    if (result.jobs.length > 1) {
      await this.repository.recordFailure({
        taskId: task.id,
        executionStatus: 'CREATE_FAILED',
        stage: 'BAIYING_CREATE',
        code: 'BAIYING_DUPLICATE_JOB_NAME',
        message: `确定性任务名 ${callJobName} 匹配到多个百应任务，已停止自动处理`,
        retryable: false,
        releaseHold: true,
      });
      return;
    }

    const confirmations = await this.repository.countOperations(
      task.id,
      'QUERY',
    );
    if (confirmations % 3 !== 0) {
      throw new TaskOrchestrationRetryError(
        `尚未查询到百应任务，等待第 ${confirmations + 1} 次确认`,
        'BAIYING_CREATE_NOT_YET_VISIBLE',
      );
    }
    await this.createCallJob(task, true);
  }

  private async importCustomers(task: OrchestrationTask, retry: boolean) {
    if (!task.baiyingCallJobId) {
      await this.repository.recordFailure({
        taskId: task.id,
        executionStatus: 'IMPORT_FAILED',
        stage: 'BAIYING_IMPORT',
        code: 'BAIYING_JOB_ID_MISSING',
        message: '平台任务缺少百应任务 ID，无法导入客户',
        retryable: false,
        releaseHold: true,
      });
      return;
    }
    const operation = await this.repository.beginOperation({
      taskId: task.id,
      operationType: 'IMPORT',
      expectedStatuses: retry ? ['IMPORTING'] : ['BAIYING_CREATED'],
      nextStatus: retry ? undefined : 'IMPORTING',
      requestPayloadRedacted: {
        callJobId: task.baiyingCallJobId,
        companyId: task.baiyingCompanyId,
        customerCount: task.callItems.length,
        permitrepeatnum: false,
      },
    });
    let customers;
    try {
      customers = materializeCustomers(task, this.protector);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '客户密文解析失败';
      await this.repository.finishOperation({
        operationId: operation.id,
        status: 'FAILED',
        errorClass: 'TASK_DATA_ERROR',
        errorCode: 'TASK_CUSTOMER_DATA_INVALID',
        errorMessage: message,
      });
      const cleanup = await this.terminateForCleanup(task, ['IMPORTING']);
      await this.repository.recordFailure({
        taskId: task.id,
        executionStatus: 'IMPORT_FAILED',
        stage: 'BAIYING_IMPORT',
        code: 'TASK_CUSTOMER_DATA_INVALID',
        message: appendCleanup(message, cleanup),
        retryable: false,
        releaseHold: true,
      });
      return;
    }

    let result: Awaited<ReturnType<BaiyingCallJobClient['importCustomers']>>;
    try {
      result = await this.client.importCustomers({
        callJobId: task.baiyingCallJobId,
        companyId: task.baiyingCompanyId,
        customers,
        permitRepeatNumber: false,
      });
    } catch (error) {
      const failure = providerFailure(error, 'BAIYING_IMPORT_FAILED');
      await this.finishProviderFailure(operation, failure);
      if (failure.kind !== 'PERMANENT') {
        throw new TaskOrchestrationRetryError(failure.message, failure.code);
      }
      const cleanup = await this.terminateForCleanup(task, ['IMPORTING']);
      await this.repository.recordFailure({
        taskId: task.id,
        executionStatus: 'IMPORT_FAILED',
        stage: 'BAIYING_IMPORT',
        code: failure.code,
        message: appendCleanup(failure.message, cleanup),
        retryable: false,
        releaseHold: true,
      });
      return;
    }

    const summary = importSummary(result);
    if (!isStrictImportSuccess(summary, task.phoneCount)) {
      await this.repository.finishOperation({
        operationId: operation.id,
        status: 'FAILED',
        responsePayloadRedacted: redactProviderPayload(result.response),
        providerRequestId: result.requestId,
        errorClass: 'STRICT_IMPORT_CHECK',
        errorCode: 'BAIYING_IMPORT_NOT_COMPLETE',
        errorMessage: strictImportMessage(task.phoneCount, summary),
      });
      const cleanup = await this.terminateForCleanup(task, ['IMPORTING']);
      await this.repository.recordFailure({
        taskId: task.id,
        executionStatus: 'IMPORT_FAILED',
        stage: 'BAIYING_IMPORT',
        code: 'BAIYING_IMPORT_NOT_COMPLETE',
        message: appendCleanup(
          strictImportMessage(task.phoneCount, summary),
          cleanup,
        ),
        retryable: false,
        releaseHold: true,
        importSummary: summary,
      });
      return;
    }
    await this.repository.finishOperation({
      operationId: operation.id,
      status: 'SUCCEEDED',
      responsePayloadRedacted: redactProviderPayload(result.response),
      providerRequestId: result.requestId,
    });
    await this.repository.recordImported(task.id, summary);
  }

  private async recoverImport(task: OrchestrationTask) {
    if (!task.baiyingCallJobId) {
      await this.repository.recordFailure({
        taskId: task.id,
        executionStatus: 'IMPORT_FAILED',
        stage: 'BAIYING_IMPORT',
        code: 'BAIYING_JOB_ID_MISSING',
        message: '导入恢复时缺少百应任务 ID',
        retryable: false,
        releaseHold: true,
      });
      return;
    }
    await this.repository.markPendingOperationsUnknown({
      taskId: task.id,
      operationType: 'IMPORT',
      message: 'Worker 在保存导入结果前中断，先查询百应任务再决定是否重试',
    });
    const job = await this.queryJob(task, 'IMPORT_RECOVERY');
    if (!job) {
      throw new TaskOrchestrationRetryError(
        '查询不到待恢复的百应任务，稍后再次确认',
        'BAIYING_JOB_NOT_VISIBLE',
      );
    }
    if (job.importedCustomerCount === task.phoneCount) {
      if (job.state === 'TERMINATED') {
        await this.repository.recordFailure({
          taskId: task.id,
          executionStatus: 'IMPORT_FAILED',
          stage: 'BAIYING_IMPORT',
          code: 'BAIYING_JOB_TERMINATED',
          message: '百应任务已终止，不能继续启动',
          retryable: false,
          releaseHold: true,
        });
        return;
      }
      await this.repository.recordImported(task.id, successfulSummary(task));
      if (
        job.state === 'CALLING' ||
        job.state === 'PAUSED' ||
        job.state === 'COMPLETED'
      ) {
        await this.repository.recordCalling(task.id);
      }
      return;
    }
    if (job.importedCustomerCount === 0 && job.state === 'CREATED') {
      await this.importCustomers(task, true);
      return;
    }
    if (job.importedCustomerCount === null || job.state === 'UNKNOWN') {
      throw new TaskOrchestrationRetryError(
        '百应暂未返回可信的导入数量，禁止盲目重复导入',
        'BAIYING_IMPORT_OUTCOME_UNKNOWN',
      );
    }
    const observed: BaiyingImportSummary = {
      total: task.phoneCount,
      successNum: Math.max(0, job.importedCustomerCount),
      placeFailNum: Math.max(0, task.phoneCount - job.importedCustomerCount),
      repeatNum: 0,
    };
    const cleanup = await this.terminateForCleanup(task, ['IMPORTING']);
    await this.repository.recordFailure({
      taskId: task.id,
      executionStatus: 'IMPORT_FAILED',
      stage: 'BAIYING_IMPORT',
      code: 'BAIYING_IMPORT_PARTIAL_AFTER_RECOVERY',
      message: appendCleanup(
        strictImportMessage(task.phoneCount, observed),
        cleanup,
      ),
      retryable: false,
      releaseHold: true,
      importSummary: observed,
    });
  }

  private async startCallJob(task: OrchestrationTask, retry: boolean) {
    if (!task.baiyingCallJobId) {
      await this.repository.recordFailure({
        taskId: task.id,
        executionStatus: 'START_FAILED',
        stage: 'BAIYING_START',
        code: 'BAIYING_JOB_ID_MISSING',
        message: '平台任务缺少百应任务 ID，无法启动',
        retryable: false,
        releaseHold: true,
      });
      return;
    }
    const request = {
      callJobId: task.baiyingCallJobId,
      companyId: task.baiyingCompanyId,
      command: 1 as const,
    };
    const operation = await this.repository.beginOperation({
      taskId: task.id,
      operationType: 'START',
      expectedStatuses: retry ? ['STARTING'] : ['IMPORTED'],
      nextStatus: retry ? undefined : 'STARTING',
      requestPayloadRedacted: request,
    });
    let result: BaiyingProviderMetadata;
    try {
      result = await this.client.executeCallJob(request);
    } catch (error) {
      const failure = providerFailure(error, 'BAIYING_START_FAILED');
      await this.finishProviderFailure(operation, failure);
      if (failure.kind !== 'PERMANENT') {
        throw new TaskOrchestrationRetryError(failure.message, failure.code);
      }
      const cleanup = await this.terminateForCleanup(task, ['STARTING']);
      await this.repository.recordFailure({
        taskId: task.id,
        executionStatus: 'START_FAILED',
        stage: 'BAIYING_START',
        code: failure.code,
        message: appendCleanup(failure.message, cleanup),
        retryable: false,
        releaseHold: true,
      });
      return;
    }
    await this.repository.finishOperation({
      operationId: operation.id,
      status: 'SUCCEEDED',
      responsePayloadRedacted: redactProviderPayload(result.response),
      providerRequestId: result.requestId,
    });
    await this.repository.recordCalling(task.id);
  }

  private async recoverStart(task: OrchestrationTask) {
    if (!task.baiyingCallJobId) {
      await this.repository.recordFailure({
        taskId: task.id,
        executionStatus: 'START_FAILED',
        stage: 'BAIYING_START',
        code: 'BAIYING_JOB_ID_MISSING',
        message: '启动恢复时缺少百应任务 ID',
        retryable: false,
        releaseHold: true,
      });
      return;
    }
    await this.repository.markPendingOperationsUnknown({
      taskId: task.id,
      operationType: 'START',
      message: 'Worker 在保存启动结果前中断，先查询百应状态再决定是否重试',
    });
    const job = await this.queryJob(task, 'START_RECOVERY');
    if (!job || job.state === 'UNKNOWN') {
      throw new TaskOrchestrationRetryError(
        '百应启动状态暂不可确认，禁止盲目重复启动',
        'BAIYING_START_OUTCOME_UNKNOWN',
      );
    }
    if (
      job.state === 'CALLING' ||
      job.state === 'PAUSED' ||
      job.state === 'COMPLETED'
    ) {
      await this.repository.recordCalling(task.id);
      return;
    }
    if (
      job.state === 'CREATED' &&
      job.importedCustomerCount === task.phoneCount
    ) {
      await this.startCallJob(task, true);
      return;
    }
    if (job.state === 'TERMINATED') {
      await this.repository.recordFailure({
        taskId: task.id,
        executionStatus: 'START_FAILED',
        stage: 'BAIYING_START',
        code: 'BAIYING_JOB_TERMINATED',
        message: '百应任务已终止，启动未生效',
        retryable: false,
        releaseHold: true,
      });
      return;
    }
    throw new TaskOrchestrationRetryError(
      '百应任务尚不满足安全重试启动的条件',
      'BAIYING_START_NOT_READY',
    );
  }

  private async queryJob(task: OrchestrationTask, purpose: string) {
    const operation = await this.repository.beginOperation({
      taskId: task.id,
      operationType: 'QUERY',
      expectedStatuses: [task.executionStatus],
      requestPayloadRedacted: {
        purpose,
        companyId: task.baiyingCompanyId,
        callJobId: task.baiyingCallJobId,
      },
    });
    let result: Awaited<ReturnType<BaiyingCallJobClient['getCallJob']>>;
    try {
      result = await this.client.getCallJob({
        companyId: task.baiyingCompanyId,
        callJobId: task.baiyingCallJobId!,
      });
    } catch (error) {
      const failure = providerFailure(error, 'BAIYING_JOB_QUERY_FAILED');
      await this.finishProviderFailure(operation, failure);
      throw new TaskOrchestrationRetryError(failure.message, failure.code);
    }
    await this.repository.finishOperation({
      operationId: operation.id,
      status: 'SUCCEEDED',
      responsePayloadRedacted: redactProviderPayload(result.response),
      providerRequestId: result.requestId,
    });
    return result.job;
  }

  private async terminateForCleanup(
    task: OrchestrationTask,
    expectedStatuses: TaskExecutionStatus[],
  ): Promise<'SUCCEEDED' | 'FAILED' | 'SKIPPED'> {
    if (!task.baiyingCallJobId) return 'SKIPPED';
    const request = {
      callJobId: task.baiyingCallJobId,
      companyId: task.baiyingCompanyId,
      command: 3 as const,
    };
    const operation = await this.repository.beginOperation({
      taskId: task.id,
      operationType: 'TERMINATE',
      expectedStatuses,
      requestPayloadRedacted: {
        ...request,
        reason: 'STARTUP_FAILURE_CLEANUP',
      },
    });
    try {
      const result = await this.client.executeCallJob(request);
      await this.repository.finishOperation({
        operationId: operation.id,
        status: 'SUCCEEDED',
        responsePayloadRedacted: redactProviderPayload(result.response),
        providerRequestId: result.requestId,
      });
      return 'SUCCEEDED';
    } catch (error) {
      const failure = providerFailure(error, 'BAIYING_TERMINATE_FAILED');
      await this.finishProviderFailure(operation, failure);
      return 'FAILED';
    }
  }

  private async finishProviderFailure(
    operation: OperationHandle,
    failure: ReturnType<typeof providerFailure>,
  ) {
    await this.repository.finishOperation({
      operationId: operation.id,
      status: failure.kind === 'UNKNOWN_OUTCOME' ? 'UNKNOWN' : 'FAILED',
      responsePayloadRedacted: failure.metadata.response
        ? redactProviderPayload(failure.metadata.response)
        : undefined,
      providerRequestId: failure.metadata.requestId,
      errorClass: 'BAIYING_PROVIDER_ERROR',
      errorCode: failure.code,
      errorMessage: failure.message,
    });
  }

  private async requireTask(taskId: string) {
    const task = await this.repository.getTask(taskId);
    if (!task) throw new TaskNotFoundError(`任务 ${taskId} 不存在`);
    return task;
  }
}

export function buildCallJobName(taskName: string): string {
  if (!taskName.trim() || taskName.length > 200) {
    throw new Error('平台任务名称必须为 1～200 个字符');
  }
  return taskName;
}

export function isStrictImportSuccess(
  summary: BaiyingImportSummary,
  expectedCount: number,
): boolean {
  return (
    summary.total === expectedCount &&
    summary.successNum === expectedCount &&
    summary.placeFailNum === 0 &&
    summary.repeatNum === 0
  );
}

export function redactProviderPayload(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return redactObject(value, 0) as Record<string, unknown>;
}

function redactObject(value: unknown, depth: number): unknown {
  if (depth > 6) return '[TRUNCATED]';
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => redactObject(item, depth + 1));
  }
  if (!value || typeof value !== 'object') return value;
  const redacted: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (
      /(access.?token|app.?secret|phone|telephone|customer.?name|properties|customer.?info)/i.test(
        key,
      )
    ) {
      redacted[key] = '[REDACTED]';
    } else {
      redacted[key] = redactObject(child, depth + 1);
    }
  }
  return redacted;
}

function materializeCustomers(
  task: OrchestrationTask,
  protector: DataProtector,
) {
  if (task.callItems.length !== task.phoneCount) {
    throw new Error(
      `客户明细数量 ${task.callItems.length} 与任务数量 ${task.phoneCount} 不一致`,
    );
  }
  return task.callItems.map((item) => {
    const properties = parseMappedProperties(
      protector.decryptUtf8(item.mappedPropertiesCiphertext),
    );
    const correlationProperties: Record<string, string> =
      task.contractVersion === '2.0'
        ? {
            sx_correlation_token: buildCallItemCorrelationToken(
              protector,
              task.id,
              item.id,
              item.phoneHmac,
            ),
          }
        : {};
    return {
      platformItemId: item.id,
      name: item.customerNameCiphertext
        ? protector.decryptUtf8(item.customerNameCiphertext)
        : `客户${item.ordinal}`,
      phone: protector.decryptUtf8(item.phoneCiphertext),
      properties: {
        ...properties,
        sx_platform_item_id: item.id,
        ...correlationProperties,
      },
    };
  });
}

function parseMappedProperties(value: string): Record<string, string> {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('映射变量快照不是 JSON 对象');
  }
  const result: Record<string, string> = {};
  for (const [key, child] of Object.entries(parsed)) {
    if (typeof child !== 'string') {
      throw new Error(`映射变量 ${key} 不是字符串`);
    }
    result[key] = child;
  }
  return result;
}

function providerFailure(error: unknown, fallbackCode: string) {
  if (error instanceof BaiyingProviderError) {
    return {
      kind: error.kind,
      code: error.code,
      message: error.message,
      metadata: error.metadata,
    };
  }
  return {
    kind: 'UNKNOWN_OUTCOME' as const,
    code: fallbackCode,
    message: error instanceof Error ? error.message : '百应接口返回了未知异常',
    metadata: {} as Partial<BaiyingProviderMetadata>,
  };
}

function importSummary(input: BaiyingImportSummary): BaiyingImportSummary {
  return {
    total: input.total,
    successNum: input.successNum,
    placeFailNum: input.placeFailNum,
    repeatNum: input.repeatNum,
  };
}

function successfulSummary(task: OrchestrationTask): BaiyingImportSummary {
  return {
    total: task.phoneCount,
    successNum: task.phoneCount,
    placeFailNum: 0,
    repeatNum: 0,
  };
}

function strictImportMessage(expected: number, summary: BaiyingImportSummary) {
  return `百应未全量导入：期望 ${expected}，total=${summary.total}，successNum=${summary.successNum}，placeFailNum=${summary.placeFailNum}，repeatNum=${summary.repeatNum}`;
}

function appendCleanup(
  message: string,
  cleanup: 'SUCCEEDED' | 'FAILED' | 'SKIPPED' | undefined,
) {
  if (!cleanup || cleanup === 'SKIPPED') return message;
  return `${message}；百应清理终止${cleanup === 'SUCCEEDED' ? '成功' : '失败，需人工处理'}`;
}

import type {
  BaiyingCallJobClient,
  BaiyingCallJobState,
  BaiyingCompletedCall,
  BaiyingCompletedCallClient,
} from '../baiying/call-job-client.js';
import { stableJson } from '../openapi/request-hash.js';

export type ReconciliationStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'STABLE_ONCE'
  | 'RECONCILED'
  | 'MANUAL_REVIEW'
  | 'FAILED';

export type ClaimedReconciliation = {
  taskId: string;
  taskNo: string;
  companyId: string;
  callJobId: string;
  expectedCallCount: number;
  providerCallCount: number | null;
  platformCallCount: number;
  stableRounds: number;
  mismatchSince: Date | null;
  failureAttempts: number;
};

export type ReconciliationCycleUpdate = {
  taskId: string;
  workerId: string;
  status: Exclude<ReconciliationStatus, 'RUNNING' | 'FAILED'>;
  providerState: BaiyingCallJobState;
  providerCallCount: number;
  platformCallCount: number;
  pendingInboxCount: number;
  stableRounds: number;
  mismatchSince: Date | null;
  lastProviderRequestId: string | null;
  nextCheckAt: Date | null;
  checkedAt: Date;
};

export interface ReconciliationRepository {
  claimNext(input: {
    workerId: string;
    lockTimeoutSeconds: number;
  }): Promise<ClaimedReconciliation | null>;
  countPlatformCalls(taskId: string): Promise<number>;
  countPendingInbox(input: {
    companyId: string;
    callJobId: string;
  }): Promise<number>;
  finishCycle(input: ReconciliationCycleUpdate): Promise<void>;
  failCycle(input: {
    taskId: string;
    workerId: string;
    error: string;
    nextCheckAt: Date;
    failedAt: Date;
  }): Promise<void>;
}

type ReconciliationClient = BaiyingCompletedCallClient &
  Pick<BaiyingCallJobClient, 'getCallJob'>;

type CallbackIngress = {
  ingest(input: {
    rawBody: string;
    headers: Headers;
  }): Promise<{ replayed: boolean }>;
};

export type ReconciliationWorkerResult =
  | { status: 'IDLE' }
  | {
      status: 'WAITING_PROVIDER';
      taskId: string;
      providerState: BaiyingCallJobState;
    }
  | {
      status: 'SYNCED';
      taskId: string;
      providerCallCount: number;
      platformCallCount: number;
      pendingInboxCount: number;
      insertedInboxCount: number;
      stableRounds: number;
      reconciliationStatus: Exclude<ReconciliationStatus, 'RUNNING' | 'FAILED'>;
    }
  | { status: 'FAILED'; taskId: string; error: string };

export class BaiyingReconciliationService {
  private readonly pageSize: number;
  private readonly lockTimeoutSeconds: number;
  private readonly providerPollIntervalMs: number;
  private readonly inboxDrainIntervalMs: number;
  private readonly manualReviewAfterMs: number;
  private readonly stableRoundsRequired: number;

  constructor(
    private readonly repository: ReconciliationRepository,
    private readonly client: ReconciliationClient,
    private readonly callbackIngress: CallbackIngress,
    private readonly options: {
      workerId: string;
      pageSize?: number;
      lockTimeoutSeconds?: number;
      providerPollIntervalMs?: number;
      inboxDrainIntervalMs?: number;
      manualReviewAfterMs?: number;
      stableRoundsRequired?: number;
      clock?: () => Date;
    },
  ) {
    this.pageSize = options.pageSize ?? 500;
    this.lockTimeoutSeconds = options.lockTimeoutSeconds ?? 1_800;
    this.providerPollIntervalMs = options.providerPollIntervalMs ?? 300_000;
    this.inboxDrainIntervalMs = options.inboxDrainIntervalMs ?? 5_000;
    this.manualReviewAfterMs = options.manualReviewAfterMs ?? 900_000;
    this.stableRoundsRequired = options.stableRoundsRequired ?? 2;
    if (!options.workerId || options.workerId.length > 128) {
      throw new TypeError('Reconciliation workerId 长度必须为 1～128 字符');
    }
    if (
      !Number.isInteger(this.pageSize) ||
      this.pageSize < 1 ||
      this.pageSize > 500
    ) {
      throw new TypeError('Reconciliation pageSize 必须在 1～500 之间');
    }
  }

  async runOnce(): Promise<ReconciliationWorkerResult> {
    const claimed = await this.repository.claimNext({
      workerId: this.options.workerId,
      lockTimeoutSeconds: this.lockTimeoutSeconds,
    });
    if (!claimed) return { status: 'IDLE' };

    try {
      return await this.reconcile(claimed);
    } catch (error) {
      const now = this.clock();
      const message = errorMessage(error);
      await this.repository.failCycle({
        taskId: claimed.taskId,
        workerId: this.options.workerId,
        error: message,
        nextCheckAt: new Date(
          now.getTime() + retryDelayMs(claimed.failureAttempts + 1),
        ),
        failedAt: now,
      });
      return { status: 'FAILED', taskId: claimed.taskId, error: message };
    }
  }

  private async reconcile(
    claimed: ClaimedReconciliation,
  ): Promise<ReconciliationWorkerResult> {
    const jobResult = await this.client.getCallJob({
      companyId: claimed.companyId,
      callJobId: claimed.callJobId,
    });
    const job = jobResult.job;
    if (!job) throw new Error(`百应任务 ${claimed.callJobId} 不存在`);
    const now = this.clock();
    if (job.state !== 'COMPLETED') {
      await this.repository.finishCycle({
        taskId: claimed.taskId,
        workerId: this.options.workerId,
        status: 'PENDING',
        providerState: job.state,
        providerCallCount: claimed.providerCallCount ?? 0,
        platformCallCount: await this.repository.countPlatformCalls(
          claimed.taskId,
        ),
        pendingInboxCount: await this.repository.countPendingInbox({
          companyId: claimed.companyId,
          callJobId: claimed.callJobId,
        }),
        stableRounds: 0,
        mismatchSince: null,
        lastProviderRequestId: jobResult.requestId ?? null,
        nextCheckAt: new Date(now.getTime() + this.providerPollIntervalMs),
        checkedAt: now,
      });
      return {
        status: 'WAITING_PROVIDER',
        taskId: claimed.taskId,
        providerState: job.state,
      };
    }

    let insertedInboxCount = 0;
    const jobIngress = await this.callbackIngress.ingest({
      rawBody: stableJson(jobCompletedCallback(claimed)),
      headers: reconciliationHeaders(jobResult.requestId),
    });
    if (!jobIngress.replayed) insertedInboxCount += 1;

    const providerCalls: BaiyingCompletedCall[] = [];
    const providerIds = new Set<string>();
    const requestIds: string[] = [];
    let pageNum = 1;
    let providerTotal = 0;
    let providerPages = 1;
    do {
      const page = await this.client.listCompletedCalls({
        companyId: claimed.companyId,
        callJobId: claimed.callJobId,
        pageNum,
        pageSize: this.pageSize,
      });
      if (page.pageNum !== pageNum) {
        throw new Error(
          `百应完成通话页码漂移：请求 ${pageNum}，返回 ${page.pageNum}`,
        );
      }
      if (page.pages > 100) {
        throw new Error(`百应完成通话分页异常：${page.pages} 页超过安全上限`);
      }
      if (pageNum === 1) {
        providerTotal = page.total;
        providerPages = Math.max(page.pages, 1);
      } else if (page.total !== providerTotal || page.pages !== providerPages) {
        throw new Error('百应完成通话分页过程中总数发生变化，等待下一轮重试');
      }
      if (page.requestId) requestIds.push(page.requestId);
      for (const call of page.calls) {
        if (call.callJobId !== claimed.callJobId) {
          throw new Error(
            `百应完成通话 ${call.callInstanceId} 属于其他任务 ${call.callJobId}`,
          );
        }
        if (providerIds.has(call.callInstanceId)) {
          throw new Error(`百应完成通话分页包含重复 ID ${call.callInstanceId}`);
        }
        providerIds.add(call.callInstanceId);
        providerCalls.push(call);
      }
      pageNum += 1;
    } while (pageNum <= providerPages);

    for (const call of providerCalls) {
      const ingested = await this.callbackIngress.ingest({
        rawBody: stableJson(callCompletedCallback(claimed, call)),
        headers: reconciliationHeaders(requestIds.at(-1)),
      });
      if (!ingested.replayed) insertedInboxCount += 1;
    }

    const [platformCallCount, pendingInboxCount] = await Promise.all([
      this.repository.countPlatformCalls(claimed.taskId),
      this.repository.countPendingInbox({
        companyId: claimed.companyId,
        callJobId: claimed.callJobId,
      }),
    ]);
    const consistent =
      providerCalls.length === providerTotal &&
      providerTotal === claimed.expectedCallCount &&
      platformCallCount === providerTotal &&
      pendingInboxCount === 0;
    const countsUnchanged =
      claimed.providerCallCount === providerTotal &&
      claimed.platformCallCount === platformCallCount;
    const stableRounds = consistent
      ? countsUnchanged
        ? claimed.stableRounds + 1
        : 1
      : 0;
    const mismatchSince = consistent ? null : (claimed.mismatchSince ?? now);
    const manualReview =
      mismatchSince !== null &&
      now.getTime() - mismatchSince.getTime() >= this.manualReviewAfterMs;
    const status = manualReview
      ? 'MANUAL_REVIEW'
      : stableRounds >= this.stableRoundsRequired
        ? 'RECONCILED'
        : stableRounds === 1
          ? 'STABLE_ONCE'
          : 'PENDING';
    const nextCheckAt =
      status === 'RECONCILED' || status === 'MANUAL_REVIEW'
        ? null
        : new Date(
            now.getTime() +
              (pendingInboxCount > 0
                ? this.inboxDrainIntervalMs
                : this.providerPollIntervalMs),
          );
    await this.repository.finishCycle({
      taskId: claimed.taskId,
      workerId: this.options.workerId,
      status,
      providerState: job.state,
      providerCallCount: providerTotal,
      platformCallCount,
      pendingInboxCount,
      stableRounds,
      mismatchSince,
      lastProviderRequestId: requestIds.at(-1) ?? jobResult.requestId ?? null,
      nextCheckAt,
      checkedAt: now,
    });
    return {
      status: 'SYNCED',
      taskId: claimed.taskId,
      providerCallCount: providerTotal,
      platformCallCount,
      pendingInboxCount,
      insertedInboxCount,
      stableRounds,
      reconciliationStatus: status,
    };
  }

  private clock(): Date {
    return this.options.clock?.() ?? new Date();
  }
}

function jobCompletedCallback(task: ClaimedReconciliation) {
  return {
    code: 200,
    data: {
      callbackType: 'JOB_INFO_RESULT',
      data: {
        companyId: task.companyId,
        callJobId: task.callJobId,
        callJobStatus: 2,
      },
    },
    resultMsg: 'successful',
  };
}

function callCompletedCallback(
  task: ClaimedReconciliation,
  call: BaiyingCompletedCall,
) {
  return {
    code: 200,
    data: {
      callbackType: 'CALL_INSTANCE_RESULT',
      data: {
        callInstance: compact({
          companyId: task.companyId,
          callJobId: task.callJobId,
          callInstanceId: call.callInstanceId,
          callInstanceStatus: call.callInstanceStatus,
          finishStatus: call.finishStatus,
          calledTimes: call.calledTimes,
          customerTelephone: call.customerTelephone,
          customerName: call.customerName,
          duration: call.durationSeconds,
          startTime: call.startTime,
          endTime: call.endTime,
          luyinOssUrl: call.fullRecordingUrl,
          userLuyinOssUrl: call.userRecordingUrl,
          properties: call.properties,
          collectProperties: call.userProperties,
          resultComplete: false,
        }),
        taskResult: call.resultList,
      },
    },
    resultMsg: 'successful',
  };
}

function compact<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, item]) => item !== null && item !== undefined,
    ),
  );
}

function reconciliationHeaders(requestId: string | undefined): Headers {
  const headers = new Headers({
    'content-type': 'application/json',
    'user-agent': 'outbound-platform-reconciliation/1.0',
  });
  if (requestId) headers.set('x-request-id', requestId.slice(0, 128));
  return headers;
}

function retryDelayMs(attempt: number): number {
  const delays = [5_000, 30_000, 120_000, 600_000, 1_800_000];
  return delays[Math.min(Math.max(attempt - 1, 0), delays.length - 1)]!;
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? `${error.name}: ${error.message}`.slice(0, 4_000)
    : String(error).slice(0, 4_000);
}

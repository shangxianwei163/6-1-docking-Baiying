import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { readBaiyingConfig } from '../config.js';
import {
  BaiyingProviderError,
  type BaiyingCallJobState,
} from './call-job-client.js';
import { HttpBaiyingVariableClient } from './client.js';
import { HttpBaiyingCallJobClient } from './http-call-job-client.js';
import {
  OAuthBaiyingTokenProvider,
  type BaiyingTokenProvider,
} from './token-provider.js';

const liveOptionsSchema = z.object({
  scope: z.enum(['transport', 'lifecycle', 'all']).default('transport'),
  confirmation: z.string().optional(),
  phone: z
    .string()
    .regex(/^(?:\+?86)?1[3-9]\d{9}$/)
    .optional(),
  robotDefId: z.string().regex(/^\d+$/).optional(),
  userPhoneId: z.string().regex(/^\d+$/).optional(),
  completedCallJobId: z.string().regex(/^\d+$/).optional(),
  rateLimitRequests: z.coerce.number().int().min(0).max(25).default(0),
});

const config = readBaiyingConfig();
const options = liveOptionsSchema.parse({
  scope: process.env.BAIYING_LIVE_TEST_SCOPE,
  confirmation: process.env.BAIYING_LIVE_TEST_CONFIRM,
  phone: process.env.BAIYING_LIVE_TEST_PHONE,
  robotDefId: process.env.BAIYING_LIVE_TEST_ROBOT_ID,
  userPhoneId: process.env.BAIYING_LIVE_TEST_LINE_ID,
  completedCallJobId: process.env.BAIYING_LIVE_COMPLETED_CALL_JOB_ID,
  rateLimitRequests: process.env.BAIYING_LIVE_RATE_LIMIT_REQUESTS,
});
const tokenProvider = new OAuthBaiyingTokenProvider({
  tokenUrl: config.BAIYING_TOKEN_URL,
  appKey: config.BAIYING_APP_KEY,
  appSecret: config.BAIYING_APP_SECRET,
  companyId: config.BAIYING_COMPANY_ID,
});
const callJobs = new HttpBaiyingCallJobClient({
  baseUrl: config.BAIYING_BASE_URL,
  tokenProvider,
});

async function verifyTransport() {
  const baselineName = `CODEX-PROBE-${Date.now()}`;
  const baseline = await callJobs.findCallJobsByName({
    companyId: config.BAIYING_COMPANY_ID,
    callJobName: baselineName,
  });

  const invalidProvider = new InvalidTokenProvider();
  const invalidClient = new HttpBaiyingCallJobClient({
    baseUrl: config.BAIYING_BASE_URL,
    tokenProvider: invalidProvider,
  });
  let invalidToken: Record<string, unknown>;
  try {
    await invalidClient.findCallJobsByName({
      companyId: config.BAIYING_COMPANY_ID,
      callJobName: baselineName,
    });
    throw new Error('失效 Token 未被百应拒绝');
  } catch (error) {
    if (
      !(error instanceof BaiyingProviderError) ||
      error.code !== 'BAIYING_40000010'
    ) {
      throw error;
    }
    invalidToken = {
      status: 'PASSED',
      providerCode: error.code,
      refreshAttemptedOnce:
        invalidProvider.invalidations === 1 && invalidProvider.requests === 2,
    };
  }

  const timeoutClient = new HttpBaiyingCallJobClient({
    baseUrl: config.BAIYING_BASE_URL,
    tokenProvider,
    timeoutMs: 1,
  });
  let timeout: Record<string, unknown>;
  try {
    await timeoutClient.findCallJobsByName({
      companyId: config.BAIYING_COMPANY_ID,
      callJobName: baselineName,
    });
    throw new Error('1ms 超时探针未触发，请重新运行确认网络时延');
  } catch (error) {
    if (
      !(error instanceof BaiyingProviderError) ||
      error.code !== 'BAIYING_TIMEOUT'
    ) {
      throw error;
    }
    timeout = { status: 'PASSED', kind: error.kind, code: error.code };
  }

  const rateLimit =
    options.rateLimitRequests === 0
      ? {
          status: 'NOT_RUN',
          reason:
            '未显式设置 BAIYING_LIVE_RATE_LIMIT_REQUESTS；不会为触发 429 主动冲击真实账号',
        }
      : await probeRateLimit(baselineName, options.rateLimitRequests);

  const completedCalls = options.completedCallJobId
    ? await probeCompletedCalls(options.completedCallJobId)
    : {
        status: 'NOT_RUN',
        reason:
          '未设置 BAIYING_LIVE_COMPLETED_CALL_JOB_ID；不猜测需要读取的真实任务',
      };

  return {
    authorizedRequest: {
      status: 'PASSED',
      providerRequestIdPresent: Boolean(baseline.requestId),
    },
    invalidToken,
    timeout,
    rateLimit,
    completedCalls,
  };
}

async function probeCompletedCalls(callJobId: string) {
  const page = await callJobs.listCompletedCalls({
    companyId: config.BAIYING_COMPANY_ID,
    callJobId,
    pageNum: 1,
    pageSize: 500,
  });
  return {
    status: 'PASSED',
    callJobId,
    requestedPageSize: 500,
    pageNum: page.pageNum,
    pages: page.pages,
    total: page.total,
    returnedCount: page.calls.length,
    providerRequestIdPresent: Boolean(page.requestId),
    sensitiveCallFieldsPrinted: false,
  };
}

async function probeRateLimit(callJobName: string, requests: number) {
  const results = await Promise.allSettled(
    Array.from({ length: requests }, () =>
      callJobs.findCallJobsByName({
        companyId: config.BAIYING_COMPANY_ID,
        callJobName,
      }),
    ),
  );
  const limited = results.filter(
    (result) =>
      result.status === 'rejected' &&
      result.reason instanceof BaiyingProviderError &&
      result.reason.code === 'BAIYING_RATE_LIMITED',
  ).length;
  return {
    status: limited > 0 ? 'PASSED' : 'NOT_OBSERVED',
    requests,
    limited,
    warning: limited === 0 ? '本次受控请求量未达到百应账号限流阈值' : undefined,
  };
}

async function verifyLifecycle() {
  if (options.confirmation !== 'CALL_REAL_TEST_NUMBER' || !options.phone) {
    throw new Error(
      '生命周期验收会真实拨号；必须设置 BAIYING_LIVE_TEST_PHONE 和 BAIYING_LIVE_TEST_CONFIRM=CALL_REAL_TEST_NUMBER',
    );
  }
  const resources = new HttpBaiyingVariableClient({
    baseUrl: config.BAIYING_BASE_URL,
    tokenProvider,
  });
  const [robots, lines] = await Promise.all([
    resources.listRobots(config.BAIYING_COMPANY_ID, 2),
    resources.listPhones(config.BAIYING_COMPANY_ID),
  ]);
  const robot = options.robotDefId
    ? robots.find((candidate) => candidate.robotDefId === options.robotDefId)
    : (robots.find((candidate) => candidate.robotName.includes('【测试】')) ??
      robots[0]);
  const line = options.userPhoneId
    ? lines.find((candidate) => candidate.userPhoneId === options.userPhoneId)
    : lines[0];
  if (!robot) throw new Error('未找到可用百应话术');
  if (!line) throw new Error('未找到可用百应线路');

  const variables = await resources.querySceneVariables({
    companyId: config.BAIYING_COMPANY_ID,
    robotDefId: robot.robotDefId,
  });
  const callJobName = `CODEX-LIVE-${formatTimestamp(new Date())}-${randomUUID().slice(0, 8)}`;
  let callJobId: string | undefined;
  let terminated = false;
  const steps: Array<Record<string, unknown>> = [];
  try {
    const created = await callJobs.createCallJob({
      callJobName,
      callJobType: 2,
      companyId: config.BAIYING_COMPANY_ID,
      robotDefId: robot.robotDefId,
      userPhoneIds: [line.userPhoneId],
    });
    callJobId = created.callJobId;
    steps.push(step('CREATE', created.requestId));

    const imported = await callJobs.importCustomers({
      callJobId,
      companyId: config.BAIYING_COMPANY_ID,
      customers: [
        {
          platformItemId: randomUUID(),
          name: '接口自动化测试',
          phone: normalizePhone(options.phone),
          properties: Object.fromEntries(
            variables.map((variable) => [variable, '接口自动化测试']),
          ),
        },
      ],
      permitRepeatNumber: false,
    });
    if (
      imported.total !== 1 ||
      imported.successNum !== 1 ||
      imported.placeFailNum !== 0 ||
      imported.repeatNum !== 0
    ) {
      throw new Error(
        `百应号码导入未全量成功（total=${imported.total}, success=${imported.successNum}, failed=${imported.placeFailNum}, repeat=${imported.repeatNum}）`,
      );
    }
    steps.push(
      step('IMPORT', imported.requestId, { successNum: imported.successNum }),
    );

    const started = await callJobs.executeCallJob({
      callJobId,
      companyId: config.BAIYING_COMPANY_ID,
      command: 1,
    });
    steps.push(step('START', started.requestId));
    await delay(500);

    const paused = await callJobs.executeCallJob({
      callJobId,
      companyId: config.BAIYING_COMPANY_ID,
      command: 2,
    });
    const pausedSnapshot = await waitForState(callJobId, 'PAUSED');
    steps.push(step('PAUSE', paused.requestId, { state: pausedSnapshot }));

    const resumed = await callJobs.executeCallJob({
      callJobId,
      companyId: config.BAIYING_COMPANY_ID,
      command: 1,
    });
    steps.push(step('RESUME', resumed.requestId));
    await delay(500);

    const stopped = await callJobs.executeCallJob({
      callJobId,
      companyId: config.BAIYING_COMPANY_ID,
      command: 3,
    });
    const finalState = await waitForState(callJobId, 'TERMINATED');
    terminated = true;
    steps.push(step('TERMINATE', stopped.requestId, { state: finalState }));

    return {
      status: 'PASSED',
      callJobId,
      callJobName,
      robot: { robotDefId: robot.robotDefId, robotName: robot.robotName },
      line: { userPhoneId: line.userPhoneId },
      phoneMasked: maskPhone(options.phone),
      variables,
      steps,
    };
  } finally {
    if (callJobId && !terminated) {
      try {
        await callJobs.executeCallJob({
          callJobId,
          companyId: config.BAIYING_COMPANY_ID,
          command: 3,
        });
        steps.push({ operation: 'EMERGENCY_TERMINATE', status: 'REQUESTED' });
      } catch (error) {
        steps.push({
          operation: 'EMERGENCY_TERMINATE',
          status: 'FAILED',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

async function waitForState(callJobId: string, target: BaiyingCallJobState) {
  let lastState: BaiyingCallJobState | undefined;
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const result = await callJobs.getCallJob({
      companyId: config.BAIYING_COMPANY_ID,
      callJobId,
    });
    lastState = result.job?.state;
    if (lastState === target) return lastState;
    await delay(1_000);
  }
  throw new Error(
    `百应任务状态未在确认窗口内变为 ${target}，最后状态为 ${lastState}`,
  );
}

class InvalidTokenProvider implements BaiyingTokenProvider {
  requests = 0;
  invalidations = 0;

  async getAccessToken() {
    this.requests += 1;
    return `invalid-live-probe-${randomUUID()}`;
  }

  invalidate() {
    this.invalidations += 1;
  }
}

function step(
  operation: string,
  requestId?: string,
  details: Record<string, unknown> = {},
) {
  return {
    operation,
    status: 'PASSED',
    providerRequestIdPresent: Boolean(requestId),
    ...details,
  };
}

function normalizePhone(phone: string): string {
  return phone.replace(/^\+?86/, '');
}

function maskPhone(phone: string): string {
  const normalized = normalizePhone(phone);
  return `${normalized.slice(0, 3)}****${normalized.slice(-4)}`;
}

function formatTimestamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 14);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function main() {
  const report: Record<string, unknown> = {
    environment: 'BAIYING_LIVE',
    companyId: config.BAIYING_COMPANY_ID,
    scope: options.scope,
    startedAt: new Date().toISOString(),
  };
  if (options.scope === 'transport' || options.scope === 'all') {
    report.transport = await verifyTransport();
  }
  if (options.scope === 'lifecycle' || options.scope === 'all') {
    report.lifecycle = await verifyLifecycle();
  }
  report.finishedAt = new Date().toISOString();
  console.info(JSON.stringify(report, null, 2));
}

await main();

import { z } from 'zod';
import {
  BaiyingProviderError,
  type BaiyingCallJobClient,
  type BaiyingCompletedCallClient,
  type BaiyingCallJobSnapshot,
  type BaiyingCallJobState,
  type CreateBaiyingCallJobInput,
  type ExecuteBaiyingCallJobInput,
  type ImportBaiyingCustomersInput,
} from './call-job-client.js';
import type { BaiyingTokenProvider } from './token-provider.js';

const identifierSchema = z.union([z.string(), z.number()]).transform(String);
const envelopeSchema = z.object({
  code: z.number(),
  requestId: z.string().optional(),
  resultMsg: z.string().optional(),
  data: z.unknown().optional(),
});
const createResponseSchema = envelopeSchema.extend({
  data: z.object({ callJobId: identifierSchema }),
});
const importResponseSchema = envelopeSchema.extend({
  data: z.object({
    total: z.coerce.number().int().nonnegative(),
    successNum: z.coerce.number().int().nonnegative(),
    placeFailNum: z.coerce.number().int().nonnegative(),
    repeatNum: z.coerce.number().int().nonnegative(),
  }),
});
const jobSchema = z.object({
  callJobId: identifierSchema,
  jobName: z.string().optional(),
  callJobName: z.string().optional(),
  callJobStatus: z.coerce.number().int(),
  totalCount: z.coerce.number().int().nonnegative().optional(),
});
const listResponseSchema = envelopeSchema.extend({
  data: z.object({
    total: z.coerce.number().int().nonnegative(),
    pages: z.coerce.number().int().nonnegative(),
    pageNum: z.coerce.number().int().nonnegative(),
    list: z.array(jobSchema),
  }),
});
const detailResponseSchema = envelopeSchema.extend({
  data: jobSchema.nullable(),
});
const completedCallSchema = z
  .object({
    callInstanceId: identifierSchema,
    callJobId: identifierSchema,
    callInstanceStatus: z.coerce.number().int().nonnegative().optional(),
    finishStatus: z.coerce.number().int().nonnegative(),
    calledTimes: z.coerce.number().int().nonnegative().optional(),
    customerTelephone: z.string().trim().min(1).max(64).optional(),
    customerName: z.string().trim().max(500).optional(),
    duration: z.coerce.number().int().min(0).max(604_800).default(0),
    startTime: z.union([z.string(), z.number()]).optional(),
    endTime: z.union([z.string(), z.number()]).optional(),
    luyinOssUrl: z.string().trim().max(8_192).optional(),
    userLuyinOssUrl: z.string().trim().max(8_192).optional(),
    properties: z.unknown().optional(),
    userProperties: z.unknown().optional(),
    resultList: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .loose();
const completedCallPageResponseSchema = envelopeSchema.extend({
  data: z.object({
    total: z.coerce.number().int().nonnegative(),
    pages: z.coerce.number().int().nonnegative(),
    pageNum: z.coerce.number().int().nonnegative(),
    list: z.array(completedCallSchema),
  }),
});

const TOKEN_INVALID_CODE = 40000010;

type HttpBaiyingCallJobClientOptions = {
  baseUrl: string;
  tokenProvider: BaiyingTokenProvider;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
};

type RequestKind = 'QUERY' | 'MUTATION';

/**
 * 百应 AI 外呼简单任务 HTTP 客户端。
 *
 * 写请求发生网络异常、超时或无法解析响应时一律标记 UNKNOWN_OUTCOME，
 * 上层必须先查询供应商状态，不能直接重放。
 */
export class HttpBaiyingCallJobClient
  implements BaiyingCallJobClient, BaiyingCompletedCallClient
{
  private readonly fetch: typeof globalThis.fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: HttpBaiyingCallJobClientOptions) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async createCallJob(input: CreateBaiyingCallJobInput) {
    const body = await this.postForm(
      '/api/oauth/byai.openapi.calljob/1.0.0/create',
      {
        callJobName: input.callJobName,
        callJobType: String(input.callJobType),
        companyId: input.companyId,
        robotDefId: input.robotDefId,
        userPhoneIds: JSON.stringify(input.userPhoneIds.map(Number)),
      },
      'MUTATION',
    );
    const parsed = createResponseSchema.safeParse(body);
    if (!parsed.success || parsed.data.code !== 200) {
      throw responseFailure(
        body,
        'MUTATION',
        'BAIYING_CREATE_INVALID_RESPONSE',
      );
    }
    return {
      callJobId: parsed.data.data.callJobId,
      requestId: parsed.data.requestId,
      response: responseRecord(body),
    };
  }

  async findCallJobsByName(input: { companyId: string; callJobName: string }) {
    const body = await this.postForm(
      '/api/oauth/byai.openapi.calljob/1.0.0/list',
      {
        companyId: input.companyId,
        jobName: input.callJobName,
        pageNum: '1',
        pageSize: '200',
      },
      'QUERY',
    );
    const parsed = listResponseSchema.safeParse(body);
    if (!parsed.success || parsed.data.code !== 200) {
      throw responseFailure(body, 'QUERY', 'BAIYING_LIST_INVALID_RESPONSE');
    }
    return {
      jobs: parsed.data.data.list
        .filter((job) => jobName(job) === input.callJobName)
        .map(toSnapshot),
      requestId: parsed.data.requestId,
      response: responseRecord(body),
    };
  }

  async getCallJob(input: { companyId: string; callJobId: string }) {
    const body = await this.postForm(
      '/api/oauth/byai.openapi.calljob.detail/1.0.0/get',
      { companyId: input.companyId, callJobId: input.callJobId },
      'QUERY',
    );
    const parsed = detailResponseSchema.safeParse(body);
    if (!parsed.success || parsed.data.code !== 200) {
      throw responseFailure(body, 'QUERY', 'BAIYING_DETAIL_INVALID_RESPONSE');
    }
    return {
      job: parsed.data.data ? toSnapshot(parsed.data.data) : null,
      requestId: parsed.data.requestId,
      response: responseRecord(body),
    };
  }

  async importCustomers(input: ImportBaiyingCustomersInput) {
    const customerInfoVOList = input.customers.map((customer) => ({
      name: customer.name,
      phone: customer.phone,
      properties: {
        ...customer.properties,
        sx_platform_item_id: customer.platformItemId,
      },
    }));
    const body = await this.postForm(
      '/api/oauth/byai.openapi.calljob.customer/1.0.0/import',
      {
        callJobId: input.callJobId,
        companyId: input.companyId,
        customerInfoVOList: JSON.stringify(customerInfoVOList),
        permitrepeatnum: String(input.permitRepeatNumber),
      },
      'MUTATION',
    );
    const parsed = importResponseSchema.safeParse(body);
    if (!parsed.success || parsed.data.code !== 200) {
      throw responseFailure(
        body,
        'MUTATION',
        'BAIYING_IMPORT_INVALID_RESPONSE',
      );
    }
    return {
      ...parsed.data.data,
      requestId: parsed.data.requestId,
      response: responseRecord(body),
    };
  }

  async executeCallJob(input: ExecuteBaiyingCallJobInput) {
    const body = await this.postForm(
      '/api/oauth/byai.openapi.calljob/1.0.0/execute',
      {
        callJobId: input.callJobId,
        command: String(input.command),
        companyId: input.companyId,
      },
      'MUTATION',
    );
    const parsed = envelopeSchema.safeParse(body);
    if (!parsed.success || parsed.data.code !== 200) {
      throw responseFailure(
        body,
        'MUTATION',
        'BAIYING_EXECUTE_INVALID_RESPONSE',
      );
    }
    return {
      requestId: parsed.data.requestId,
      response: responseRecord(body),
    };
  }

  async listCompletedCalls(input: {
    callJobId: string;
    companyId: string;
    pageNum: number;
    pageSize: number;
  }) {
    if (!Number.isInteger(input.pageNum) || input.pageNum < 1) {
      throw new TypeError('百应完成通话页码必须是正整数');
    }
    if (
      !Number.isInteger(input.pageSize) ||
      input.pageSize < 1 ||
      input.pageSize > 500
    ) {
      throw new TypeError('百应完成通话每页数量必须在 1～500 之间');
    }
    const body = await this.postForm(
      '/api/oauth/byai.openapi.calljob.calldone/1.0.0/list',
      {
        callJobId: input.callJobId,
        companyId: input.companyId,
        pageNum: String(input.pageNum),
        pageSize: String(input.pageSize),
      },
      'QUERY',
    );
    const parsed = completedCallPageResponseSchema.safeParse(body);
    if (!parsed.success || parsed.data.code !== 200) {
      throw responseFailure(
        body,
        'QUERY',
        'BAIYING_COMPLETED_CALLS_INVALID_RESPONSE',
      );
    }
    const page = parsed.data.data;
    const emptyPageSentinel =
      page.total === 0 &&
      page.pages === 0 &&
      page.pageNum === 0 &&
      page.list.length === 0;
    if (page.pageNum === 0 && !emptyPageSentinel) {
      throw responseFailure(
        body,
        'QUERY',
        'BAIYING_COMPLETED_CALLS_INVALID_RESPONSE',
      );
    }
    const normalizedPageNum = emptyPageSentinel ? input.pageNum : page.pageNum;
    return {
      total: page.total,
      pages: page.pages,
      pageNum: normalizedPageNum,
      calls: page.list.map((call) => ({
        callInstanceId: call.callInstanceId,
        callJobId: call.callJobId,
        callInstanceStatus: call.callInstanceStatus ?? null,
        finishStatus: call.finishStatus,
        calledTimes: call.calledTimes ?? null,
        customerTelephone: call.customerTelephone ?? null,
        customerName: call.customerName ?? null,
        durationSeconds: call.duration,
        startTime: call.startTime ?? null,
        endTime: call.endTime ?? null,
        fullRecordingUrl: nonEmpty(call.luyinOssUrl),
        userRecordingUrl: nonEmpty(call.userLuyinOssUrl),
        properties: parseRecord(call.properties),
        userProperties: parseRecord(call.userProperties),
        resultList: call.resultList ?? [],
      })),
      requestId: parsed.data.requestId,
      response: {
        code: parsed.data.code,
        resultMsg: parsed.data.resultMsg,
        data: {
          total: page.total,
          pages: page.pages,
          pageNum: normalizedPageNum,
          returnedCount: page.list.length,
        },
      },
    };
  }

  private async postForm(
    path: string,
    parameters: Record<string, string>,
    kind: RequestKind,
    allowTokenRetry = true,
  ): Promise<unknown> {
    const accessToken = await this.options.tokenProvider.getAccessToken();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetch(new URL(path, this.options.baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ accessToken, ...parameters }),
        signal: controller.signal,
      });
    } catch (error) {
      const timedOut = controller.signal.aborted;
      throw transportFailure(
        kind,
        timedOut ? 'BAIYING_TIMEOUT' : 'BAIYING_NETWORK_ERROR',
        timedOut
          ? `百应接口请求超过 ${this.timeoutMs}ms`
          : '百应接口网络请求失败',
        error,
      );
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 429) {
      throw new BaiyingProviderError(
        'RETRYABLE',
        'BAIYING_RATE_LIMITED',
        '百应接口触发限流（HTTP 429）',
        { response: { httpStatus: response.status } },
      );
    }
    if (response.status >= 500) {
      throw new BaiyingProviderError(
        kind === 'MUTATION' ? 'UNKNOWN_OUTCOME' : 'RETRYABLE',
        `BAIYING_HTTP_${response.status}`,
        `百应接口请求失败（HTTP ${response.status}）`,
        { response: { httpStatus: response.status } },
      );
    }
    if (!response.ok) {
      throw new BaiyingProviderError(
        'PERMANENT',
        `BAIYING_HTTP_${response.status}`,
        `百应接口请求失败（HTTP ${response.status}）`,
        { response: { httpStatus: response.status } },
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw transportFailure(
        kind,
        'BAIYING_INVALID_JSON',
        '百应接口响应不是有效 JSON',
        error,
      );
    }
    const envelope = envelopeSchema.safeParse(body);
    if (
      allowTokenRetry &&
      envelope.success &&
      envelope.data.code === TOKEN_INVALID_CODE
    ) {
      this.options.tokenProvider.invalidate();
      return this.postForm(path, parameters, kind, false);
    }
    return body;
  }
}

function responseFailure(
  body: unknown,
  kind: RequestKind,
  fallbackCode: string,
): BaiyingProviderError {
  const envelope = envelopeSchema.safeParse(body);
  const providerCode = envelope.success ? envelope.data.code : undefined;
  const message =
    (envelope.success && envelope.data.resultMsg) ||
    '百应接口返回结构不符合约定';
  const code =
    providerCode === undefined ? fallbackCode : `BAIYING_${providerCode}`;
  return new BaiyingProviderError(
    providerCode === 429
      ? 'RETRYABLE'
      : kind === 'MUTATION' && providerCode === 200
        ? 'UNKNOWN_OUTCOME'
        : 'PERMANENT',
    code,
    message,
    {
      requestId: envelope.success ? envelope.data.requestId : undefined,
      response: responseRecord(body),
    },
  );
}

function transportFailure(
  kind: RequestKind,
  code: string,
  message: string,
  cause: unknown,
): BaiyingProviderError {
  return new BaiyingProviderError(
    kind === 'MUTATION' ? 'UNKNOWN_OUTCOME' : 'RETRYABLE',
    code,
    cause instanceof Error ? `${message}：${cause.message}` : message,
  );
}

function responseRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : { bodyType: typeof body };
}

function parseRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function nonEmpty(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function jobName(job: z.infer<typeof jobSchema>): string {
  return job.jobName ?? job.callJobName ?? '';
}

function toSnapshot(job: z.infer<typeof jobSchema>): BaiyingCallJobSnapshot {
  return {
    callJobId: job.callJobId,
    callJobName: jobName(job),
    state: toState(job.callJobStatus),
    importedCustomerCount: job.totalCount ?? null,
  };
}

function toState(status: number): BaiyingCallJobState {
  if (status === 0) return 'CREATED';
  if (status === 1 || status === 3 || status === 7) return 'CALLING';
  if (status === 2) return 'COMPLETED';
  if (status === 4 || status === 5) return 'PAUSED';
  if (status === 6) return 'TERMINATED';
  return 'UNKNOWN';
}

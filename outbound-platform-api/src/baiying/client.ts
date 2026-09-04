import { z } from 'zod';
import type { BaiyingTokenProvider } from './token-provider.js';

const robotIdSchema = z.union([z.string(), z.number()]).transform(String);
const responseEnvelopeSchema = z.object({
  code: z.number(),
  requestId: z.string().optional(),
  resultMsg: z.string().optional(),
});
const sceneVariablesResponseSchema = responseEnvelopeSchema.extend({
  data: z.object({
    variables: z.array(z.union([z.string(), z.array(z.string())])),
  }).nullable(),
});
const robotListResponseSchema = responseEnvelopeSchema.extend({
  data: z.array(z.object({
    robotDefId: robotIdSchema,
    robotName: z.string(),
    robotStatus: z.number().int().min(0).max(5),
    industryOneName: z.string().nullish().transform((value) => value ?? ''),
    industryTwoName: z.string().nullish().transform((value) => value ?? ''),
    deployTime: z.string().nullish().transform((value) => value ?? ''),
  })).nullable(),
});
const companyListResponseSchema = responseEnvelopeSchema.extend({
  data: z.array(z.object({
    companyId: robotIdSchema,
    companyName: z.string(),
  })).nullable(),
});
const lineNumberSchema = z.union([z.number(), z.string()]).transform(Number).nullish().transform((value) => value ?? 0);
const lineListResponseSchema = responseEnvelopeSchema.extend({
  data: z.array(z.object({
    userPhoneId: robotIdSchema,
    phone: z.string().nullish().transform((value) => value ?? ''),
    phoneName: z.string().nullish().transform((value) => value ?? ''),
    phoneType: lineNumberSchema,
    sceneType: lineNumberSchema,
    rateType: lineNumberSchema,
    localSellingRate: lineNumberSchema,
    nonlocalSellingRate: lineNumberSchema,
    lineAmount: lineNumberSchema,
    billPeriod: lineNumberSchema,
  })).nullable(),
});
const workflowIdSchema = z.union([z.string(), z.number()]).transform(String);
const workflowStatusSchema = z.enum(['DRAFT', 'UNSTART', 'START', 'FINISH', 'PAUSE']);
const workflowListResponseSchema = responseEnvelopeSchema.extend({
  data: z.object({
    total: z.number().int().nonnegative(),
    pages: z.number().int().nonnegative(),
    pageNum: z.number().int().nonnegative(),
    pageSize: z.number().int().positive(),
    list: z.array(z.object({
      id: workflowIdSchema,
      name: z.string(),
      workflowExecuteStatus: workflowStatusSchema,
      workflowType: z.string(),
      startTime: z.string(),
      endTime: z.string(),
    })),
  }).nullable(),
});

export type QuerySceneVariablesInput = {
  companyId: string;
  robotDefId: string;
};

export type BaiyingCompany = {
  companyId: string;
  companyName: string;
};

export type BaiyingRobot = {
  robotDefId: string;
  robotName: string;
  robotStatus: number;
  industryOneName: string;
  industryTwoName: string;
  deployTime: string;
};

export type BaiyingLine = {
  userPhoneId: string;
  phone: string;
  phoneName: string;
  phoneType: number;
  sceneType: number;
  rateType: number;
  localSellingRate: number;
  nonlocalSellingRate: number;
  lineAmount: number;
  billPeriod: number;
};

export type BaiyingWorkflow = {
  id: string;
  name: string;
  workflowExecuteStatus: 'DRAFT' | 'UNSTART' | 'START' | 'FINISH' | 'PAUSE';
  workflowType: string;
  startTime: string;
  endTime: string;
};

export type ListWorkflowsInput = {
  groupId?: string;
  groupName?: string;
  name?: string;
  pageNum?: number;
  pageSize?: number;
  workflowExecuteStatus?: 'ALL' | BaiyingWorkflow['workflowExecuteStatus'];
  workflowId?: string;
};

export type BaiyingWorkflowPage = {
  total: number;
  pages: number;
  pageNum: number;
  pageSize: number;
  workflows: BaiyingWorkflow[];
};

export interface BaiyingVariableClient {
  querySceneVariables(input: QuerySceneVariablesInput): Promise<string[]>;
}

export interface BaiyingWorkflowClient {
  listWorkflows(input?: ListWorkflowsInput): Promise<BaiyingWorkflowPage>;
}

export interface BaiyingRobotClient {
  listRobots(companyId: string, robotStatus?: 0 | 1 | 2): Promise<BaiyingRobot[]>;
}

export interface BaiyingLineClient {
  listPhones(companyId: string, userPhoneId?: string): Promise<BaiyingLine[]>;
}

type HttpClientOptions = {
  baseUrl: string;
  tokenProvider: BaiyingTokenProvider;
  fetch?: typeof globalThis.fetch;
};

/** 百应 OAuth OpenAPI 客户端；accessToken 依官方要求放在表单 Body 中。 */
export class HttpBaiyingVariableClient implements BaiyingVariableClient {
  private readonly fetch: typeof globalThis.fetch;

  constructor(private readonly options: HttpClientOptions) {
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async listCompanies(): Promise<BaiyingCompany[]> {
    const body = await this.postForm('/api/oauth/byai.openapi.company/1.0.0/list', {});
    const parsed = companyListResponseSchema.safeParse(body);
    if (!parsed.success || parsed.data.code !== 200 || !parsed.data.data) {
      throw responseError(body, '百应公司列表返回结构不符合约定');
    }
    return parsed.data.data;
  }

  async listRobots(companyId: string, robotStatus: 0 | 1 | 2 = 0): Promise<BaiyingRobot[]> {
    const body = await this.postForm('/api/oauth/byai.openapi.robot/1.0.0/list', {
      companyId,
      robotStatus: String(robotStatus),
    });
    const parsed = robotListResponseSchema.safeParse(body);
    if (!parsed.success || parsed.data.code !== 200 || !parsed.data.data) {
      throw responseError(body, '百应话术列表返回结构不符合约定');
    }
    return parsed.data.data;
  }

  async listPhones(companyId: string, userPhoneId?: string): Promise<BaiyingLine[]> {
    const parameters: Record<string, string> = { companyId };
    if (userPhoneId) parameters.userPhoneId = userPhoneId;
    const body = await this.postForm('/api/oauth/byai.openapi.phone/1.0.0/list', parameters);
    const parsed = lineListResponseSchema.safeParse(body);
    if (!parsed.success || parsed.data.code !== 200 || !parsed.data.data) {
      throw responseError(body, '百应外呼线路列表返回结构不符合约定');
    }
    return parsed.data.data;
  }

  async querySceneVariables(input: QuerySceneVariablesInput): Promise<string[]> {
    const body = await this.postForm('/api/oauth/byai.openapi.company.scenevariables/1.0.0/get', {
      companyId: input.companyId,
      hideDefaultVar: 'true',
      robotDefId: input.robotDefId,
    });
    const parsed = sceneVariablesResponseSchema.safeParse(body);
    if (!parsed.success || parsed.data.code !== 200 || !parsed.data.data) {
      throw responseError(body, '百应话术变量返回结构不符合约定');
    }
    return parsed.data.data.variables.flatMap((value) => typeof value === 'string' ? [value] : value);
  }

  async listWorkflows(input: ListWorkflowsInput = {}): Promise<BaiyingWorkflowPage> {
    const parameters: Record<string, string> = {
      pageNum: String(input.pageNum ?? 0),
      pageSize: String(input.pageSize ?? 20),
      workflowExecuteStatus: input.workflowExecuteStatus ?? 'ALL',
    };
    if (input.groupId) parameters.groupId = input.groupId;
    if (input.groupName) parameters.groupName = input.groupName;
    if (input.name) parameters.name = input.name;
    if (input.workflowId) parameters.workflowId = input.workflowId;

    const body = await this.postForm('/api/oauth/byai.sop.workflow.list.page/1.0.0/search', parameters);
    const parsed = workflowListResponseSchema.safeParse(body);
    if (!parsed.success || parsed.data.code !== 200 || !parsed.data.data) {
      throw responseError(body, '百应复杂任务列表返回结构不符合约定');
    }
    return {
      total: parsed.data.data.total,
      pages: parsed.data.data.pages,
      pageNum: parsed.data.data.pageNum,
      pageSize: parsed.data.data.pageSize,
      workflows: parsed.data.data.list,
    };
  }

  private async postForm(path: string, parameters: Record<string, string>, allowTokenRetry = true): Promise<unknown> {
    const accessToken = await this.options.tokenProvider.getAccessToken();
    const form = new URLSearchParams({ accessToken, ...parameters });
    const response = await this.fetch(new URL(path, this.options.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
    });
    if (!response.ok) {
      throw new BaiyingRequestError(`百应接口请求失败（HTTP ${response.status}）`, undefined, response.status);
    }

    const body: unknown = await response.json();
    const envelope = responseEnvelopeSchema.safeParse(body);
    if (allowTokenRetry && envelope.success && envelope.data.code === 40000010) {
      this.options.tokenProvider.invalidate();
      return this.postForm(path, parameters, false);
    }
    return body;
  }
}

function responseError(body: unknown, fallback: string): BaiyingRequestError {
  const envelope = responseEnvelopeSchema.safeParse(body);
  if (!envelope.success) return new BaiyingRequestError(fallback);
  return new BaiyingRequestError(envelope.data.resultMsg || fallback, envelope.data.code);
}

export class BaiyingRequestError extends Error {
  constructor(message: string, readonly code?: number, readonly status?: number) {
    super(message);
  }
}

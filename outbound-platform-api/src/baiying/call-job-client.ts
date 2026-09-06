export type BaiyingCallJobState =
  | 'CREATED'
  | 'CALLING'
  | 'PAUSED'
  | 'COMPLETED'
  | 'TERMINATED'
  | 'UNKNOWN';

export type BaiyingProviderMetadata = {
  requestId?: string;
  response: Record<string, unknown>;
};

export type CreateBaiyingCallJobInput = {
  callJobName: string;
  callJobType: 1;
  companyId: string;
  robotDefId: string;
  userPhoneIds: string[];
};

export type BaiyingCallJobSnapshot = {
  callJobId: string;
  callJobName: string;
  state: BaiyingCallJobState;
  importedCustomerCount: number | null;
};

export type BaiyingCustomer = {
  platformItemId: string;
  name: string;
  phone: string;
  properties: Record<string, string>;
};

export type ImportBaiyingCustomersInput = {
  callJobId: string;
  companyId: string;
  customers: BaiyingCustomer[];
  permitRepeatNumber: false;
};

export type BaiyingImportSummary = {
  total: number;
  successNum: number;
  placeFailNum: number;
  repeatNum: number;
};

export type ExecuteBaiyingCallJobInput = {
  callJobId: string;
  companyId: string;
  command: 1 | 2 | 3;
};

/**
 * 百应任务写接口的稳定边界。真实 OAuth 客户端和本地模拟器都实现该接口，
 * 编排状态机不依赖 HTTP、Token 或某一个供应商 SDK。
 */
export interface BaiyingCallJobClient {
  createCallJob(
    input: CreateBaiyingCallJobInput,
  ): Promise<BaiyingProviderMetadata & { callJobId: string }>;
  findCallJobsByName(input: {
    companyId: string;
    callJobName: string;
  }): Promise<BaiyingProviderMetadata & { jobs: BaiyingCallJobSnapshot[] }>;
  getCallJob(input: {
    companyId: string;
    callJobId: string;
  }): Promise<BaiyingProviderMetadata & { job: BaiyingCallJobSnapshot | null }>;
  importCustomers(
    input: ImportBaiyingCustomersInput,
  ): Promise<BaiyingProviderMetadata & BaiyingImportSummary>;
  executeCallJob(
    input: ExecuteBaiyingCallJobInput,
  ): Promise<BaiyingProviderMetadata>;
}

export type BaiyingProviderErrorKind =
  | 'PERMANENT'
  | 'RETRYABLE'
  | 'UNKNOWN_OUTCOME';

/**
 * UNKNOWN_OUTCOME 表示请求可能已在百应生效，调用方必须先查询，不能直接重放。
 */
export class BaiyingProviderError extends Error {
  constructor(
    public readonly kind: BaiyingProviderErrorKind,
    public readonly code: string,
    message: string,
    public readonly metadata: Partial<BaiyingProviderMetadata> = {},
  ) {
    super(message);
    this.name = 'BaiyingProviderError';
  }
}

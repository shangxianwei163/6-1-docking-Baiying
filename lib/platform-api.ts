import type {
  AccountAdjustmentKind,
  AccountAdjustmentStatus,
  ConsoleTaskPage,
  ConsoleTaskRecord,
  ConsoleTaskStatusFilter,
  CreateAccountAdjustmentInput,
  CreateOperatorStudioInput,
  CreateTopUpInput,
  DecideAccountAdjustmentInput,
  LedgerEntryType,
  MappingDraftInput,
  MappingRule,
  MappingVersion,
  OutboundCallPage,
  OperatorAccountAdjustment,
  OperatorAccountAdjustmentPage,
  OperatorAccountStatus,
  OperatorAuditCategory,
  OperatorAuditPage,
  OperatorLedgerPage,
  OperatorStudio,
  OperatorStudioPage,
  OperatorStudioStatus,
  OperatorTopUpResult,
  PricingOverview,
  PricingPreview,
  PricingPublishResult,
  PublishPricingInput,
  PublishMappingInput,
  RemoveMappingDraftInput,
  SceneReadiness,
  SourceSystem,
  VariableSyncRequested,
  UpdateOperatorStudioInput,
} from '@outbound/contracts';
import {
  consoleTaskPageSchema,
  consoleTaskRecordSchema,
  operatorAccountAdjustmentPageSchema,
  operatorAccountAdjustmentSchema,
  operatorAuditPageSchema,
  operatorLedgerPageSchema,
  operatorStudioPageSchema,
  operatorStudioSchema,
  operatorTopUpResultSchema,
  outboundCallPageSchema,
  pricingOverviewSchema,
  pricingPreviewSchema,
  pricingPublishResultSchema,
} from '@outbound/contracts';

export type MappingDraftRecord = {
  baiyingVariableName: string;
  erpField: string | null;
  crmField: string | null;
  transformConfig: MappingDraftInput['transformConfig'] | null;
  emptyPolicy: MappingDraftInput['emptyPolicy'] | null;
  defaultValue: string | null;
  changeType: 'UPSERT' | 'REMOVE';
  removalReason: string | null;
  updatedBy: string;
  updatedAt: string;
};

export type PlannedTaskStatus =
  | 'DRAFT'
  | 'UNSTART'
  | 'START'
  | 'FINISH'
  | 'PAUSE';

export type PlannedTaskCategoryBinding = {
  workflowId: string;
  sourceSystem: SourceSystem;
  sourceCategoryId: string;
  categoryPath: string;
  updatedBy: string;
  updatedAt: string;
};

export type PlannedTask = {
  id: string;
  name: string;
  workflowExecuteStatus: PlannedTaskStatus;
  workflowType: string;
  startTime: string;
  endTime: string;
  categoryBinding: PlannedTaskCategoryBinding | null;
};

export type SourceDataCategory = {
  sourceSystem: SourceSystem;
  externalId: string;
  name: string;
  categoryPath: string;
  level: number | null;
  parentId: string | null;
  active: boolean;
  fields: Record<string, string | number | boolean | null>;
  syncedAt: string;
};

export type DataCategoryScript = {
  robotDefId: string;
  robotName: string;
};

export type DataCategory = {
  externalId: string;
  name: string;
  categoryPath: string;
  level: number | null;
  parentId: string | null;
  active: boolean;
  fields: Record<string, string | number | boolean | null>;
  boundScripts: DataCategoryScript[];
};

export type DataCategoryResult = {
  sourceSystem: SourceSystem;
  studioId: string | null;
  configured: boolean;
  syncedAt: string | null;
  categories: DataCategory[];
};

export type PlannedTaskPage = {
  total: number;
  pages: number;
  pageNum: number;
  pageSize: number;
  tasks: PlannedTask[];
};

export type BaiyingScriptStatus = 0 | 1 | 2 | 3 | 4 | 5;

export type ScriptBinding = {
  robotDefId: string;
  sourceSystem: SourceSystem;
  categories: Array<{ sourceCategoryId: string; categoryPath: string }>;
  studioId: string;
  studioName: string;
  lineId: string;
  lineName: string;
  updatedBy: string;
  updatedAt: string;
};

export type BaiyingScript = {
  robotDefId: string;
  robotName: string;
  robotStatus: BaiyingScriptStatus;
  industryOneName: string;
  industryTwoName: string;
  deployTime: string;
  binding: ScriptBinding | null;
};

export type LineStudioBinding = {
  userPhoneId: string;
  studioId: string;
  studioName: string;
  updatedBy: string;
  updatedAt: string;
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
  studios: LineStudioBinding[];
};

export type BaiyingApiSection<T> =
  | { status: 'success'; data: T }
  | { status: 'error'; message: string };

export type BaiyingAccountOverview = {
  communicationBalance: BaiyingApiSection<{ amount: number }>;
  aiBalance: BaiyingApiSection<{ amount: number; price: string; num: number }>;
  seatOverview: BaiyingApiSection<{
    companyUsingCallSeat: number;
    companyCallSeatDetail: Record<string, unknown>;
    companyAllCallSeat: number;
    callSeatList: unknown[];
  }>;
};

export type ScriptPage = {
  total: number;
  pages: number;
  pageNum: number;
  pageSize: number;
  scripts: BaiyingScript[];
};

type ApiEnvelope<T> = { requestId: string; data: T };
type ApiErrorEnvelope = {
  error?: { code?: string; message?: string; requestId?: string };
};

const apiBaseUrl = (
  import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8788'
).replace(/\/$/, '');
export const platformActorId = 'platform-admin';

export class PlatformApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly requestId?: string,
  ) {
    super(message);
  }
}

export async function loadMappingCenter() {
  const [rules, drafts, versions, scenes] = await Promise.all([
    request<{ rules: MappingRule[] }>('/api/v1/mappings'),
    request<{ drafts: MappingDraftRecord[] }>('/api/v1/mappings/drafts'),
    request<{ versions: MappingVersion[] }>('/api/v1/mapping-versions'),
    request<{ scenes: SceneReadiness[] }>('/api/v1/scenes/readiness'),
  ]);
  return {
    rules: rules.rules,
    drafts: drafts.drafts,
    versions: versions.versions,
    scenes: scenes.scenes,
  };
}

export function saveMappingDraft(input: MappingDraftInput) {
  return request<{ draft: MappingDraftRecord }>('/api/v1/mappings/drafts', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function removeMappingDraft(input: RemoveMappingDraftInput) {
  return request<{ draft: MappingDraftRecord }>(
    '/api/v1/mappings/drafts/remove',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}

export function publishMappings(input: PublishMappingInput) {
  return request<{ version: MappingVersion; rules: MappingRule[] }>(
    '/api/v1/mappings/publish',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}

export function requestVariableSync() {
  return request<VariableSyncRequested>('/api/v1/variable-sync-jobs', {
    method: 'POST',
  });
}

export function loadPlannedTasks(
  input: {
    name?: string;
    status?: PlannedTaskStatus | 'ALL';
    pageNum?: number;
    pageSize?: number;
  } = {},
) {
  const search = new URLSearchParams({
    status: input.status ?? 'ALL',
    pageNum: String(input.pageNum ?? 0),
    pageSize: String(input.pageSize ?? 20),
  });
  if (input.name?.trim()) search.set('name', input.name.trim());
  return request<PlannedTaskPage>(`/api/v1/planned-tasks?${search}`);
}

export function loadSourceCategories(sourceSystem: SourceSystem) {
  return request<{ categories: SourceDataCategory[] }>(
    `/api/v1/source-categories?sourceSystem=${sourceSystem}`,
  );
}

export function loadDataCategories(sourceSystem: SourceSystem) {
  const search = new URLSearchParams({ sourceSystem });
  return request<DataCategoryResult>(`/api/v1/data-categories?${search}`);
}

export function syncDataCategories(sourceSystem: SourceSystem) {
  return request<{ sourceSystem: 'ERP'; count: number; syncedAt: string }>(
    '/api/v1/data-categories/sync',
    {
      method: 'POST',
      body: JSON.stringify({ sourceSystem }),
    },
  );
}

export function savePlannedTaskCategoryBinding(input: {
  workflowId: string;
  sourceSystem: SourceSystem;
  sourceCategoryId: string;
  categoryPath: string;
}) {
  return request<{ binding: PlannedTaskCategoryBinding }>(
    '/api/v1/planned-task-category-bindings',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}

export function loadScripts(
  input: {
    query?: string;
    robotStatus?: 0 | 1 | 2;
    pageNum?: number;
    pageSize?: number;
  } = {},
) {
  const search = new URLSearchParams({
    robotStatus: String(input.robotStatus ?? 0),
    pageNum: String(input.pageNum ?? 0),
    pageSize: String(input.pageSize ?? 20),
  });
  if (input.query?.trim()) search.set('query', input.query.trim());
  return request<ScriptPage>(`/api/v1/scripts?${search}`);
}

export function saveScriptBinding(input: {
  robotDefId: string;
  sourceSystem: SourceSystem;
  categories: Array<{ sourceCategoryId: string; categoryPath: string }>;
  studioId: string;
  studioName: string;
  lineId: string;
  lineName: string;
}) {
  return request<{ binding: ScriptBinding }>('/api/v1/script-bindings', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function loadLines(query = '') {
  const search = new URLSearchParams();
  if (query.trim()) search.set('query', query.trim());
  const suffix = search.size ? `?${search}` : '';
  return request<{ lines: BaiyingLine[] }>(`/api/v1/lines${suffix}`);
}

export function loadManagedLines() {
  return request<{ lines: BaiyingLine[] }>('/api/v1/managed-lines');
}

export function loadBaiyingAccountOverview() {
  return request<BaiyingAccountOverview>('/api/v1/baiying/account-overview');
}

export function saveLineStudioBindings(input: {
  userPhoneId: string;
  studios: Array<{ studioId: string; studioName: string }>;
}) {
  return request<{ bindings: LineStudioBinding[] }>(
    '/api/v1/line-studio-bindings',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}

export async function loadOutboundTasks(
  input: {
    keyword?: string;
    status?: ConsoleTaskStatusFilter;
    createdFrom?: string;
    createdBefore?: string;
    pageNum?: number;
    pageSize?: number;
  } = {},
) {
  const search = new URLSearchParams({
    status: input.status ?? 'ALL',
    pageNum: String(input.pageNum ?? 0),
    pageSize: String(input.pageSize ?? 20),
  });
  if (input.keyword?.trim()) search.set('keyword', input.keyword.trim());
  if (input.createdFrom) search.set('createdFrom', input.createdFrom);
  if (input.createdBefore) search.set('createdBefore', input.createdBefore);
  return consoleTaskPageSchema.parse(
    await request<unknown>(`/api/v1/outbound-tasks?${search}`),
  ) as ConsoleTaskPage;
}

export async function loadOutboundTask(taskNo: string) {
  const result = await request<{ task: unknown }>(
    `/api/v1/outbound-tasks/${encodeURIComponent(taskNo)}`,
  );
  return consoleTaskRecordSchema.parse(result.task) as ConsoleTaskRecord;
}

export async function loadOutboundTaskCalls(
  taskNo: string,
  input: { cursor?: string; limit?: number } = {},
) {
  const search = new URLSearchParams({ limit: String(input.limit ?? 100) });
  if (input.cursor) search.set('cursor', input.cursor);
  return outboundCallPageSchema.parse(
    await request<unknown>(
      `/api/v1/outbound-tasks/${encodeURIComponent(taskNo)}/calls?${search}`,
    ),
  ) as OutboundCallPage;
}

export async function loadOperatorStudios(
  input: {
    keyword?: string;
    studioStatus?: OperatorStudioStatus;
    accountStatus?: OperatorAccountStatus;
    pageNum?: number;
    pageSize?: number;
  } = {},
) {
  const search = new URLSearchParams({
    pageNum: String(input.pageNum ?? 0),
    pageSize: String(input.pageSize ?? 20),
  });
  if (input.keyword?.trim()) search.set('keyword', input.keyword.trim());
  if (input.studioStatus) search.set('studioStatus', input.studioStatus);
  if (input.accountStatus) search.set('accountStatus', input.accountStatus);
  return operatorStudioPageSchema.parse(
    await request<unknown>(`/api/v1/studios?${search}`),
  ) as OperatorStudioPage;
}

export async function createOperatorStudio(input: CreateOperatorStudioInput) {
  const result = await request<{ studio: unknown }>('/api/v1/studios', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return operatorStudioSchema.parse(result.studio) as OperatorStudio;
}

export async function updateOperatorStudio(
  studioId: string,
  input: UpdateOperatorStudioInput,
) {
  const result = await request<{ studio: unknown }>(
    `/api/v1/studios/${encodeURIComponent(studioId)}`,
    { method: 'PATCH', body: JSON.stringify(input) },
  );
  return operatorStudioSchema.parse(result.studio) as OperatorStudio;
}

export async function changeOperatorStudioStatus(
  studioId: string,
  input: { status: OperatorStudioStatus; reason: string },
) {
  const result = await request<{ studio: unknown }>(
    `/api/v1/studios/${encodeURIComponent(studioId)}/status`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return operatorStudioSchema.parse(result.studio) as OperatorStudio;
}

export async function loadOperatorLedger(
  input: {
    keyword?: string;
    studioId?: string;
    entryType?: LedgerEntryType;
    pageNum?: number;
    pageSize?: number;
  } = {},
) {
  const search = new URLSearchParams({
    pageNum: String(input.pageNum ?? 0),
    pageSize: String(input.pageSize ?? 20),
  });
  if (input.keyword?.trim()) search.set('keyword', input.keyword.trim());
  if (input.studioId) search.set('studioId', input.studioId);
  if (input.entryType) search.set('entryType', input.entryType);
  return operatorLedgerPageSchema.parse(
    await request<unknown>(`/api/v1/account-ledger?${search}`),
  ) as OperatorLedgerPage;
}

export async function postOperatorTopUp(input: CreateTopUpInput) {
  return operatorTopUpResultSchema.parse(
    await request<unknown>('/api/v1/account-ledger/top-ups', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  ) as OperatorTopUpResult;
}

export async function loadAccountAdjustments(
  input: {
    keyword?: string;
    studioId?: string;
    kind?: AccountAdjustmentKind;
    status?: AccountAdjustmentStatus;
    pageNum?: number;
    pageSize?: number;
  } = {},
) {
  const search = new URLSearchParams({
    pageNum: String(input.pageNum ?? 0),
    pageSize: String(input.pageSize ?? 20),
  });
  if (input.keyword?.trim()) search.set('keyword', input.keyword.trim());
  if (input.studioId) search.set('studioId', input.studioId);
  if (input.kind) search.set('kind', input.kind);
  if (input.status) search.set('status', input.status);
  return operatorAccountAdjustmentPageSchema.parse(
    await request<unknown>(`/api/v1/account-adjustments?${search}`),
  ) as OperatorAccountAdjustmentPage;
}

export async function createAccountAdjustment(
  input: CreateAccountAdjustmentInput,
) {
  return operatorAccountAdjustmentSchema.parse(
    await request<unknown>('/api/v1/account-adjustments', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  ) as OperatorAccountAdjustment;
}

export async function decideAccountAdjustment(
  adjustmentId: string,
  input: DecideAccountAdjustmentInput,
) {
  return operatorAccountAdjustmentSchema.parse(
    await request<unknown>(
      `/api/v1/account-adjustments/${encodeURIComponent(adjustmentId)}/decisions`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
  ) as OperatorAccountAdjustment;
}

export async function loadOperatorAuditLogs(
  input: {
    keyword?: string;
    category?: OperatorAuditCategory;
    pageNum?: number;
    pageSize?: number;
  } = {},
) {
  const search = new URLSearchParams({
    pageNum: String(input.pageNum ?? 0),
    pageSize: String(input.pageSize ?? 20),
  });
  if (input.keyword?.trim()) search.set('keyword', input.keyword.trim());
  if (input.category) search.set('category', input.category);
  return operatorAuditPageSchema.parse(
    await request<unknown>(`/api/v1/audit-logs?${search}`),
  ) as OperatorAuditPage;
}

export async function loadPricingOverview() {
  return pricingOverviewSchema.parse(
    await request<unknown>('/api/v1/pricing'),
  ) as PricingOverview;
}

export async function previewPricing(input: PublishPricingInput) {
  return pricingPreviewSchema.parse(
    await request<unknown>('/api/v1/pricing/preview', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  ) as PricingPreview;
}

export async function publishPricing(input: PublishPricingInput) {
  return pricingPublishResultSchema.parse(
    await request<unknown>('/api/v1/pricing/publish', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  ) as PricingPublishResult;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    const headers = new Headers(init.headers);
    headers.set('content-type', 'application/json');
    headers.set('x-actor-id', platformActorId);
    response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      credentials: 'include',
      headers,
    });
  } catch {
    throw new PlatformApiError(
      '无法连接平台 API，请确认本地后端已启动',
      'NETWORK_ERROR',
    );
  }

  const payload = (await response.json()) as ApiEnvelope<T> | ApiErrorEnvelope;
  if (!response.ok || !('data' in payload)) {
    const error = 'error' in payload ? payload.error : undefined;
    throw new PlatformApiError(
      error?.message || '平台 API 请求失败',
      error?.code || 'API_ERROR',
      error?.requestId,
    );
  }
  return payload.data;
}

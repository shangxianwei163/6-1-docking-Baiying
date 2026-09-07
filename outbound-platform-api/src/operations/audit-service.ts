import {
  and,
  desc,
  gte,
  ilike,
  inArray,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import {
  operatorAuditPageSchema,
  type OperatorAuditCategory,
  type OperatorAuditEvent,
  type OperatorAuditPage,
} from '@outbound/contracts';
import type { Database } from '../db/client.js';
import { auditLogs } from '../db/schema.js';
import { sanitizeOperatorDetail } from './redaction.js';

const financialActions = [
  'ACCOUNT_TOP_UP_POSTED',
  'ACCOUNT_ADJUSTMENT_REQUESTED',
  'ACCOUNT_ADJUSTMENT_APPROVED',
  'ACCOUNT_ADJUSTMENT_REJECTED',
  'SUPPLIER_MONTHLY_SETTLEMENT_FINALIZED',
] as const;
const pricingActions = [
  'STUDIO_PRICING_PUBLISHED',
  'SUPPLIER_PRICING_PUBLISHED',
] as const;
const studioActions = [
  'STUDIO_CREATED',
  'STUDIO_UPDATED',
  'STUDIO_ENABLED',
  'STUDIO_DISABLED',
] as const;
const configurationActions = [
  'MAPPING_DRAFT_SAVED',
  'MAPPING_REMOVAL_STAGED',
  'MAPPING_VERSION_PUBLISHED',
  'BAIYING_LINE_STUDIOS_BOUND',
  'BAIYING_SCRIPT_BINDING_SAVED',
  'PLANNED_TASK_CATEGORY_BOUND',
] as const;
const classifiedActions = [
  ...financialActions,
  ...pricingActions,
  ...studioActions,
  ...configurationActions,
] as const;

const actionLabels: Record<string, string> = {
  ACCOUNT_TOP_UP_POSTED: '确认充值到账',
  ACCOUNT_ADJUSTMENT_REQUESTED: '发起退款或调整',
  ACCOUNT_ADJUSTMENT_APPROVED: '批准退款或调整',
  ACCOUNT_ADJUSTMENT_REJECTED: '拒绝退款或调整',
  SUPPLIER_MONTHLY_SETTLEMENT_FINALIZED: '完成供应商月度封账',
  STUDIO_CREATED: '新增影楼',
  STUDIO_UPDATED: '修改影楼资料',
  STUDIO_ENABLED: '启用影楼',
  STUDIO_DISABLED: '停用影楼',
  STUDIO_PRICING_PUBLISHED: '发布影楼价格',
  SUPPLIER_PRICING_PUBLISHED: '发布海南人像供应价格',
  MAPPING_DRAFT_SAVED: '保存字段映射草稿',
  MAPPING_REMOVAL_STAGED: '提交字段映射移除',
  MAPPING_VERSION_PUBLISHED: '发布字段映射版本',
  BAIYING_LINE_STUDIOS_BOUND: '更新线路影楼绑定',
  BAIYING_SCRIPT_BINDING_SAVED: '保存话术绑定',
  PLANNED_TASK_CATEGORY_BOUND: '更新计划任务分类',
  PHASE1_STATIC_CONFIG_IMPORTED: '导入阶段一静态配置',
  TASK_COMMAND_REQUESTED: '提交任务控制命令',
  TASK_COMMAND_SUCCEEDED: '任务控制命令成功',
  TASK_COMMAND_FAILED: '任务控制命令失败',
  TASK_COMMAND_UNKNOWN: '任务控制命令结果未知',
  TASK_RETRY_REQUESTED: '提交任务安全重试',
  DEAD_LETTER_REPLAY_REQUESTED: '重放异常事件',
  DEAD_LETTER_IGNORED: '忽略异常事件',
  RECORDING_DOWNLOAD_URL_ISSUED: '签发录音下载地址',
  RECORDING_DOWNLOAD_OPENED: '访问归档录音',
};

export type AuditListInput = {
  keyword?: string;
  category?: OperatorAuditCategory;
  pageNum: number;
  pageSize: number;
};

export interface OperatorAuditService {
  listAuditEvents(input: AuditListInput): Promise<OperatorAuditPage>;
}

export class PostgresOperatorAuditService implements OperatorAuditService {
  constructor(
    private readonly db: Database,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async listAuditEvents(input: AuditListInput): Promise<OperatorAuditPage> {
    const keyword = input.keyword?.trim();
    const keywordCondition = keyword
      ? or(
          ilike(auditLogs.actorId, containsPattern(keyword)),
          ilike(auditLogs.requestId, containsPattern(keyword)),
          ilike(auditLogs.action, containsPattern(keyword)),
          ilike(auditLogs.objectType, containsPattern(keyword)),
          ilike(auditLogs.objectId, containsPattern(keyword)),
          sql`${auditLogs.detail}::text ilike ${containsPattern(keyword)}`,
        )
      : undefined;
    const filteredWhere = and(
      keywordCondition,
      input.category ? categoryCondition(input.category) : undefined,
    );
    const todayStart = shanghaiStartOfDay(this.clock());
    const [totalRow, summaryRow, rows] = await Promise.all([
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(auditLogs)
        .where(filteredWhere)
        .then((result) => result[0]),
      this.db
        .select({
          all: sql<number>`count(*)::int`,
          today: sql<number>`count(*) filter (where ${gte(auditLogs.occurredAt, todayStart)})::int`,
          actors: sql<number>`count(distinct ${auditLogs.actorId})::int`,
          financial: sql<number>`count(*) filter (where ${auditLogs.action} in (${sql.join(
            financialActions.map((action) => sql`${action}`),
            sql`, `,
          )}))::int`,
          studio: sql<number>`count(*) filter (where ${auditLogs.action} in (${sql.join(
            studioActions.map((action) => sql`${action}`),
            sql`, `,
          )}))::int`,
          pricing: sql<number>`count(*) filter (where ${auditLogs.action} in (${sql.join(
            pricingActions.map((action) => sql`${action}`),
            sql`, `,
          )}))::int`,
          configuration: sql<number>`count(*) filter (where ${auditLogs.action} in (${sql.join(
            configurationActions.map((action) => sql`${action}`),
            sql`, `,
          )}))::int`,
          system: sql<number>`count(*) filter (where ${auditLogs.action} not in (${sql.join(
            classifiedActions.map((action) => sql`${action}`),
            sql`, `,
          )}))::int`,
        })
        .from(auditLogs)
        .where(keywordCondition)
        .then((result) => result[0]),
      this.db
        .select()
        .from(auditLogs)
        .where(filteredWhere)
        .orderBy(desc(auditLogs.occurredAt), desc(auditLogs.id))
        .limit(input.pageSize)
        .offset(input.pageNum * input.pageSize),
    ]);
    const total = totalRow?.total ?? 0;
    return operatorAuditPageSchema.parse({
      total,
      pages: Math.ceil(total / input.pageSize),
      pageNum: input.pageNum,
      pageSize: input.pageSize,
      summary: {
        all: summaryRow?.all ?? 0,
        today: summaryRow?.today ?? 0,
        actors: summaryRow?.actors ?? 0,
        financial: summaryRow?.financial ?? 0,
        studio: summaryRow?.studio ?? 0,
        pricing: summaryRow?.pricing ?? 0,
        configuration: summaryRow?.configuration ?? 0,
        system: summaryRow?.system ?? 0,
      },
      items: rows.map(toOperatorAuditEvent),
    });
  }
}

function toOperatorAuditEvent(
  row: typeof auditLogs.$inferSelect,
): OperatorAuditEvent {
  return {
    id: row.id,
    requestId: row.requestId,
    actorId: row.actorId,
    action: row.action,
    actionLabel: actionLabels[row.action] ?? humanizeAction(row.action),
    category: categoryForAction(row.action),
    objectType: row.objectType,
    objectId: row.objectId,
    objectLabel: objectLabel(row.objectType, row.objectId, row.detail),
    detail: sanitizeOperatorDetail(row.detail),
    occurredAt: row.occurredAt.toISOString(),
  };
}

function categoryCondition(category: OperatorAuditCategory) {
  switch (category) {
    case 'FINANCIAL':
      return inArray(auditLogs.action, [...financialActions]);
    case 'STUDIO':
      return inArray(auditLogs.action, [...studioActions]);
    case 'PRICING':
      return inArray(auditLogs.action, [...pricingActions]);
    case 'CONFIGURATION':
      return inArray(auditLogs.action, [...configurationActions]);
    case 'SYSTEM':
      return notInArray(auditLogs.action, [...classifiedActions]);
  }
}

function categoryForAction(action: string): OperatorAuditCategory {
  if ((financialActions as readonly string[]).includes(action))
    return 'FINANCIAL';
  if ((pricingActions as readonly string[]).includes(action)) return 'PRICING';
  if ((studioActions as readonly string[]).includes(action)) return 'STUDIO';
  if ((configurationActions as readonly string[]).includes(action)) {
    return 'CONFIGURATION';
  }
  return 'SYSTEM';
}

function objectLabel(
  objectType: string,
  objectId: string,
  detail: Record<string, unknown>,
) {
  const preferred = [
    detail.requestNo,
    detail.studioBusinessCode,
    detail.businessCode,
    detail.taskNo,
  ].find(
    (value): value is string =>
      typeof value === 'string' && Boolean(value.trim()),
  );
  return `${humanizeAction(objectType)} · ${preferred ?? objectId}`;
}

function humanizeAction(value: string) {
  return value
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function shanghaiStartOfDay(value: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)!.value;
  return new Date(
    `${part('year')}-${part('month')}-${part('day')}T00:00:00+08:00`,
  );
}

function containsPattern(value: string) {
  return `%${value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
}

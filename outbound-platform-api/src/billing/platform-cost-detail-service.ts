import { sql, type SQL } from 'drizzle-orm';
import {
  platformCostDetailPageSchema,
  type PlatformCostDetailItem,
  type PlatformCostDetailPage,
  type PlatformCostDetailStatus,
} from '@outbound/contracts';
import type { Database } from '../db/client.js';
import { OperationsConsoleFailure } from '../operations/service.js';
import { normalizeMoney } from './money.js';

export type PlatformCostDetailListInput = {
  keyword?: string;
  studioId?: string;
  costStatus?: PlatformCostDetailStatus;
  occurredFrom?: Date;
  occurredBefore?: Date;
  pageNum: number;
  pageSize: number;
};

export type PlatformCostDetailExportInput = Omit<
  PlatformCostDetailListInput,
  'pageNum' | 'pageSize'
>;

export type PlatformCostDetailExport = {
  fileName: string;
  csv: string;
  rowCount: number;
};

export interface PlatformCostDetailService {
  listDetails(
    input: PlatformCostDetailListInput,
  ): Promise<PlatformCostDetailPage>;
  exportDetails(
    input: PlatformCostDetailExportInput,
  ): Promise<PlatformCostDetailExport>;
}

type DetailDbRow = {
  taskId: string;
  taskNo: string;
  studioId: string;
  studioBusinessCode: string;
  studioName: string;
  sourceSystem: 'ERP' | 'CRM';
  taskName: string;
  baiyingCallJobId: string | null;
  occurredAt: Date | string;
  settlementMonth: string;
  phoneCount: number | string;
  billingMinutes: number | string;
  monthlyBillingMinutes: bigint | number | string;
  customerRate: string;
  customerCharge: string;
  platformRate: string | null;
  platformCost: string | null;
  profit: string | null;
  costStatus: PlatformCostDetailStatus;
  tierCode: string | null;
  tierName: string | null;
  relatedSettlementId: string | null;
  finalizedAt: Date | string | null;
};

type SummaryDbRow = {
  total: number | string;
  totalBillingMinutes: bigint | number | string;
  totalCustomerCharge: string;
  totalPlatformCost: string;
  totalProfit: string;
  unpricedBillingMinutes: bigint | number | string;
  summaryAll: number | string;
  summaryProvisional: number | string;
  summaryFinal: number | string;
  summaryAdjustmentPending: number | string;
  summaryUnavailable: number | string;
};

const MAX_EXPORT_ROWS = 50_000;

export class PostgresPlatformCostDetailService
  implements PlatformCostDetailService
{
  constructor(private readonly db: Database) {}

  async listDetails(
    input: PlatformCostDetailListInput,
  ): Promise<PlatformCostDetailPage> {
    const [summary, rows] = await Promise.all([
      this.readSummary(input),
      this.readRows(input, input.pageSize, input.pageNum * input.pageSize),
    ]);
    const total = toNumber(summary.total);
    return platformCostDetailPageSchema.parse({
      total,
      pages: Math.ceil(total / input.pageSize),
      pageNum: input.pageNum,
      pageSize: input.pageSize,
      summary: {
        taskCount: total,
        totalBillingMinutes: String(summary.totalBillingMinutes),
        totalCustomerCharge: normalizeMoney(summary.totalCustomerCharge),
        totalPlatformCost: normalizeMoney(summary.totalPlatformCost),
        totalProfit: normalizeMoney(summary.totalProfit),
        unpricedBillingMinutes: String(summary.unpricedBillingMinutes),
        statusCounts: {
          all: toNumber(summary.summaryAll),
          provisional: toNumber(summary.summaryProvisional),
          final: toNumber(summary.summaryFinal),
          adjustmentPending: toNumber(summary.summaryAdjustmentPending),
          unavailable: toNumber(summary.summaryUnavailable),
        },
      },
      items: rows.map(toDetailItem),
    });
  }

  async exportDetails(
    input: PlatformCostDetailExportInput,
  ): Promise<PlatformCostDetailExport> {
    const listInput = { ...input, pageNum: 0, pageSize: 100 };
    const summary = await this.readSummary(listInput);
    const total = toNumber(summary.total);
    if (total > MAX_EXPORT_ROWS) {
      throw new OperationsConsoleFailure(
        'PLATFORM_DETAIL_EXPORT_TOO_LARGE',
        `当前条件命中 ${total} 条明细，单次最多导出 ${MAX_EXPORT_ROWS} 条，请缩小日期范围`,
        409,
        { total, maximum: MAX_EXPORT_ROWS },
      );
    }
    const rows = await this.readRows(listInput, MAX_EXPORT_ROWS + 1, 0);
    const items = rows.map(toDetailItem);
    return {
      fileName: platformCostExportFileName(input),
      rowCount: items.length,
      csv: toPlatformCostCsv(items),
    };
  }

  private async readSummary(
    input: PlatformCostDetailListInput,
  ): Promise<SummaryDbRow> {
    const rows = await this.db.execute<SummaryDbRow>(sql`
      ${platformCostDetailCtes(input)}
      select
        (select count(*)::int from filtered) as total,
        (select coalesce(sum(billing_minutes), 0)::bigint from filtered) as "totalBillingMinutes",
        (select coalesce(sum(customer_charge), 0)::numeric(18, 6)::text from filtered) as "totalCustomerCharge",
        (select coalesce(sum(platform_cost), 0)::numeric(18, 6)::text from filtered) as "totalPlatformCost",
        (select coalesce(sum(profit), 0)::numeric(18, 6)::text from filtered) as "totalProfit",
        (select coalesce(sum(billing_minutes) filter (where platform_cost is null), 0)::bigint from filtered) as "unpricedBillingMinutes",
        (select count(*)::int from base_filtered) as "summaryAll",
        (select count(*) filter (where cost_status = 'PROVISIONAL')::int from base_filtered) as "summaryProvisional",
        (select count(*) filter (where cost_status = 'FINAL')::int from base_filtered) as "summaryFinal",
        (select count(*) filter (where cost_status = 'ADJUSTMENT_PENDING')::int from base_filtered) as "summaryAdjustmentPending",
        (select count(*) filter (where cost_status = 'UNAVAILABLE')::int from base_filtered) as "summaryUnavailable"
    `);
    return rows[0] ?? emptySummaryRow();
  }

  private async readRows(
    input: PlatformCostDetailListInput,
    limit: number,
    offset: number,
  ): Promise<DetailDbRow[]> {
    return this.db.execute<DetailDbRow>(sql`
      ${platformCostDetailCtes(input)}
      select
        task_id as "taskId",
        task_no as "taskNo",
        studio_id as "studioId",
        studio_business_code as "studioBusinessCode",
        studio_name as "studioName",
        source_system as "sourceSystem",
        task_name as "taskName",
        baiying_call_job_id as "baiyingCallJobId",
        occurred_at as "occurredAt",
        settlement_month as "settlementMonth",
        phone_count as "phoneCount",
        billing_minutes as "billingMinutes",
        monthly_billing_minutes as "monthlyBillingMinutes",
        customer_rate::numeric(18, 6)::text as "customerRate",
        customer_charge::numeric(18, 6)::text as "customerCharge",
        platform_rate::numeric(18, 6)::text as "platformRate",
        platform_cost::numeric(18, 6)::text as "platformCost",
        profit::numeric(18, 6)::text as profit,
        cost_status as "costStatus",
        tier_code as "tierCode",
        tier_name as "tierName",
        related_settlement_id as "relatedSettlementId",
        finalized_at as "finalizedAt"
      from filtered
      order by occurred_at desc, task_id desc
      limit ${limit}
      offset ${offset}
    `);
  }
}

function platformCostDetailCtes(input: PlatformCostDetailListInput): SQL {
  const keywordPattern = input.keyword?.trim()
    ? `%${escapeLike(input.keyword.trim())}%`
    : null;
  const studioId = input.studioId ?? null;
  const occurredFrom = input.occurredFrom?.toISOString() ?? null;
  const occurredBefore = input.occurredBefore?.toISOString() ?? null;
  const costStatus = input.costStatus ?? null;
  return sql`
    with settled_tasks as (
      select
        task.id as task_id,
        task.task_no,
        task.studio_id,
        studio.business_code as studio_business_code,
        task.studio_name_snapshot as studio_name,
        task.mc_code_snapshot,
        task.source_system::text as source_system,
        task.task_name,
        task.baiying_call_job_id,
        task.phone_count,
        task.billing_minutes,
        task.customer_rate,
        task.customer_charge,
        coalesce(
          task.provider_completed_at,
          task.closed_at,
          task.reconciled_at,
          task.updated_at
        ) as occurred_at,
        to_char(
          coalesce(task.provider_completed_at, task.closed_at, task.reconciled_at, task.updated_at)
            at time zone 'Asia/Shanghai',
          'YYYY-MM'
        ) as settlement_month,
        date_trunc(
          'month',
          coalesce(task.provider_completed_at, task.closed_at, task.reconciled_at, task.updated_at)
            at time zone 'Asia/Shanghai'
        )::date as settlement_month_date
      from platform_task task
      join studio on studio.id = task.studio_id
      where task.billing_status = 'SETTLED'
    ), monthly_totals as (
      select
        settlement_month,
        settlement_month_date,
        sum(billing_minutes)::bigint as monthly_billing_minutes
      from settled_tasks
      group by settlement_month, settlement_month_date
    ), tier_candidates as (
      select
        monthly.settlement_month,
        monthly.monthly_billing_minutes,
        tier.id,
        tier.tier_code,
        tier.name as tier_name,
        tier.voice_rate,
        count(*) over (partition by monthly.settlement_month) as candidate_count,
        row_number() over (
          partition by monthly.settlement_month
          order by tier.min_monthly_minutes desc, tier.tier_code
        ) as candidate_rank
      from monthly_totals monthly
      join supplier_pricing_tier tier
        on tier.effective_from <= (
          monthly.settlement_month_date::timestamp at time zone 'Asia/Shanghai'
        )
        and (
          tier.effective_to is null
          or tier.effective_to >= (
            (monthly.settlement_month_date + interval '1 month')::timestamp
              at time zone 'Asia/Shanghai'
          )
        )
        and monthly.monthly_billing_minutes >= tier.min_monthly_minutes
        and (
          tier.max_monthly_minutes is null
          or monthly.monthly_billing_minutes < tier.max_monthly_minutes
        )
    ), monthly_rates as (
      select *
      from tier_candidates
      where candidate_count = 1 and candidate_rank = 1
    ), costed as (
      select
        task.*,
        monthly.monthly_billing_minutes,
        case
          when final_item.task_id is not null then 'FINAL'
          when month_settlement.id is not null then 'ADJUSTMENT_PENDING'
          when rate.id is not null then 'PROVISIONAL'
          else 'UNAVAILABLE'
        end::text as cost_status,
        case
          when final_item.task_id is not null then final_item.billing_minutes
          else task.billing_minutes
        end as effective_billing_minutes,
        case
          when final_item.task_id is not null then final_item.customer_charge
          else task.customer_charge
        end as effective_customer_charge,
        coalesce(final_item.platform_rate, rate.voice_rate) as effective_platform_rate,
        case
          when final_item.task_id is not null then final_item.platform_cost
          when rate.voice_rate is not null then
            (task.billing_minutes * rate.voice_rate)::numeric(18, 6)
          else null
        end as effective_platform_cost,
        case
          when final_item.task_id is not null then final_item.profit
          when rate.voice_rate is not null then
            (task.customer_charge - task.billing_minutes * rate.voice_rate)::numeric(18, 6)
          else null
        end as effective_profit,
        coalesce(final_settlement.tier_code_snapshot, rate.tier_code) as effective_tier_code,
        coalesce(final_settlement.tier_name_snapshot, rate.tier_name) as effective_tier_name,
        coalesce(final_item.settlement_id, month_settlement.id) as related_settlement_id,
        coalesce(final_settlement.finalized_at, month_settlement.finalized_at) as finalized_at
      from settled_tasks task
      join monthly_totals monthly
        on monthly.settlement_month = task.settlement_month
      left join supplier_settlement_task_item final_item
        on final_item.task_id = task.task_id
      left join supplier_monthly_settlement final_settlement
        on final_settlement.id = final_item.settlement_id
      left join supplier_monthly_settlement month_settlement
        on month_settlement.settlement_month = task.settlement_month_date
      left join monthly_rates rate
        on rate.settlement_month = task.settlement_month
    ), normalized as (
      select
        task_id,
        task_no,
        studio_id,
        studio_business_code,
        studio_name,
        mc_code_snapshot,
        source_system,
        task_name,
        baiying_call_job_id,
        occurred_at,
        settlement_month,
        phone_count,
        effective_billing_minutes as billing_minutes,
        monthly_billing_minutes,
        customer_rate,
        effective_customer_charge as customer_charge,
        effective_platform_rate as platform_rate,
        effective_platform_cost as platform_cost,
        effective_profit as profit,
        cost_status,
        effective_tier_code as tier_code,
        effective_tier_name as tier_name,
        related_settlement_id,
        finalized_at
      from costed
    ), base_filtered as (
      select *
      from normalized
      where (${keywordPattern}::text is null or concat_ws(
        ' ', task_no, task_name, studio_name, studio_business_code,
        mc_code_snapshot, baiying_call_job_id
      ) ilike ${keywordPattern} escape '\\')
        and (${studioId}::uuid is null or studio_id = ${studioId}::uuid)
        and (${occurredFrom}::text is null or occurred_at >= ${occurredFrom}::timestamptz)
        and (${occurredBefore}::text is null or occurred_at < ${occurredBefore}::timestamptz)
    ), filtered as (
      select *
      from base_filtered
      where (${costStatus}::text is null or cost_status = ${costStatus})
    )
  `;
}

function toDetailItem(row: DetailDbRow): PlatformCostDetailItem {
  return {
    taskId: row.taskId,
    taskNo: row.taskNo,
    studioId: row.studioId,
    studioBusinessCode: row.studioBusinessCode,
    studioName: row.studioName,
    sourceSystem: row.sourceSystem,
    taskName: row.taskName,
    baiyingCallJobId: row.baiyingCallJobId,
    occurredAt: toIsoString(row.occurredAt),
    settlementMonth: row.settlementMonth,
    phoneCount: toNumber(row.phoneCount),
    billingMinutes: toNumber(row.billingMinutes),
    monthlyBillingMinutes: String(row.monthlyBillingMinutes),
    customerRate: normalizeMoney(row.customerRate),
    customerCharge: normalizeMoney(row.customerCharge),
    platformRate: nullableMoney(row.platformRate),
    platformCost: nullableMoney(row.platformCost),
    profit: nullableMoney(row.profit),
    costStatus: row.costStatus,
    tierCode: row.tierCode,
    tierName: row.tierName,
    relatedSettlementId: row.relatedSettlementId,
    finalizedAt: row.finalizedAt ? toIsoString(row.finalizedAt) : null,
  };
}

export function toPlatformCostCsv(items: PlatformCostDetailItem[]): string {
  const columns = [
    '费用发生时间',
    '归属月份',
    '任务编号',
    '百应任务ID',
    '影楼编号',
    '影楼名称',
    '来源',
    '任务名称',
    '号码数',
    '计费分钟',
    '当月平台总分钟',
    '客户单价',
    '客户话费收入',
    '百应阶梯',
    '百应单价',
    '百应供应成本',
    '平台毛利',
    '成本口径',
    '关联结算凭证',
    '封账时间',
  ];
  const records = items.map((item) => [
    formatShanghaiDateTime(item.occurredAt),
    item.settlementMonth,
    item.taskNo,
    item.baiyingCallJobId ?? '',
    item.studioBusinessCode,
    item.studioName,
    item.sourceSystem,
    item.taskName,
    item.phoneCount,
    item.billingMinutes,
    item.monthlyBillingMinutes,
    item.customerRate,
    item.customerCharge,
    item.tierName ?? '',
    item.platformRate ?? '',
    item.platformCost ?? '',
    item.profit ?? '',
    costStatusLabel(item.costStatus),
    item.relatedSettlementId ?? '',
    item.finalizedAt ? formatShanghaiDateTime(item.finalizedAt) : '',
  ]);
  return `\uFEFF${[columns, ...records]
    .map((record) => record.map(escapeCsvCell).join(','))
    .join('\r\n')}`;
}

function platformCostExportFileName(
  input: PlatformCostDetailExportInput,
): string {
  const from = input.occurredFrom
    ? shanghaiDateKey(input.occurredFrom)
    : '全部';
  const before = input.occurredBefore
    ? shanghaiDateKey(new Date(input.occurredBefore.getTime() - 1))
    : '至今';
  return `平台明细_${from}_${before}.csv`;
}

function emptySummaryRow(): SummaryDbRow {
  return {
    total: 0,
    totalBillingMinutes: '0',
    totalCustomerCharge: '0',
    totalPlatformCost: '0',
    totalProfit: '0',
    unpricedBillingMinutes: '0',
    summaryAll: 0,
    summaryProvisional: 0,
    summaryFinal: 0,
    summaryAdjustmentPending: 0,
    summaryUnavailable: 0,
  };
}

function nullableMoney(value: string | null): string | null {
  return value === null ? null : normalizeMoney(value);
}

function toIsoString(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError('平台费用明细时间无效');
  }
  return date.toISOString();
}

function toNumber(value: number | string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new TypeError('平台费用明细计数超出安全范围');
  }
  return parsed;
}

function escapeLike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

function escapeCsvCell(value: string | number): string {
  const raw = String(value);
  const protectedValue =
    /^[=+@\t\r]/.test(raw) ||
    (raw.startsWith('-') && !/^-\d+(?:\.\d+)?$/.test(raw))
      ? `'${raw}`
      : raw;
  return `"${protectedValue.replaceAll('"', '""')}"`;
}

function costStatusLabel(status: PlatformCostDetailStatus): string {
  return {
    PROVISIONAL: '动态暂估',
    FINAL: '月度已封账',
    ADJUSTMENT_PENDING: '封账后调整待处理',
    UNAVAILABLE: '供应阶梯不可用',
  }[status];
}

function formatShanghaiDateTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function shanghaiDateKey(value: Date): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

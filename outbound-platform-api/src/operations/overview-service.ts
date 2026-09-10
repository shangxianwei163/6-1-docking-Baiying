import { sql } from 'drizzle-orm';
import {
  operatorOperationsOverviewSchema,
  type OperatorOperationsOverview,
  type OperatorOverviewAttentionItem,
} from '@outbound/contracts';
import type { Database } from '../db/client.js';
import { redactOperatorText } from './redaction.js';

type MetricRow = {
  taskAll: number;
  taskToday: number;
  taskTodayErp: number;
  taskTodayCrm: number;
  taskRunning: number;
  runningPhoneCount: number;
  completedToday: number;
  taskFailed: number;
  totalBalance: string;
  totalActiveHold: string;
  totalAvailable: string;
  lowBalanceStudios: number;
  overdueStudios: number;
  callbackPending: number;
  callbackStale: number;
  outboxPending: number;
  outboxStale: number;
  deliveryFailed: number;
  openDeadLetters: number;
  pendingApprovals: number;
  primaryCorrelationTotal: number;
  primaryCorrelationMatched: number;
  allCorrelationMatched: number;
  phoneFallbackMatched: number;
  correlationConflicts: number;
  categoryAmbiguities: number;
  callbackUnique: number;
  callbackDuplicates: number;
  resultDeliveryFailures: number;
  recordingDeliveryFailures: number;
};

type TrendRow = { hour: number; total: number; answered: number };
type RecentTaskRow = {
  id: string;
  taskNo: string;
  taskName: string;
  studioName: string;
  sourceSystem: 'ERP' | 'CRM';
  executionStatus: OperatorOperationsOverview['recentTasks'][number]['executionStatus'];
  phoneCount: number;
  callInstanceCount: number;
  customerCharge: string;
  createdAt: Date;
  updatedAt: Date;
};
type AttentionRow = {
  id: string;
  kind: OperatorOverviewAttentionItem['kind'];
  priority: OperatorOverviewAttentionItem['priority'];
  title: string;
  description: string;
  objectId: string;
  destination: OperatorOverviewAttentionItem['destination'];
  actionLabel: string;
  occurredAt: Date;
};

export interface OperationsOverviewService {
  getOverview(): Promise<OperatorOperationsOverview>;
}

export class PostgresOperationsOverviewService implements OperationsOverviewService {
  constructor(
    private readonly db: Database,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async getOverview(): Promise<OperatorOperationsOverview> {
    const now = this.clock();
    const businessDate = shanghaiBusinessDate(now);
    const dayStart = new Date(`${businessDate}T00:00:00+08:00`);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const callbackStaleBefore = new Date(now.getTime() - 2 * 60 * 1000);
    const outboxStaleBefore = new Date(now.getTime() - 5 * 60 * 1000);
    const qualityWindowHours = 24;
    const qualityWindowStart = new Date(
      now.getTime() - qualityWindowHours * 60 * 60 * 1000,
    );
    const dayStartIso = dayStart.toISOString();
    const dayEndIso = dayEnd.toISOString();
    const callbackStaleBeforeIso = callbackStaleBefore.toISOString();
    const outboxStaleBeforeIso = outboxStaleBefore.toISOString();
    const qualityWindowStartIso = qualityWindowStart.toISOString();

    const [metricRows, trendRows, recentRows, attentionRows] =
      await Promise.all([
        this.db.execute<MetricRow>(sql`
          select
            (select count(*)::int from platform_task) as "taskAll",
            (select count(*)::int from platform_task where created_at >= ${dayStartIso}::timestamptz and created_at < ${dayEndIso}::timestamptz) as "taskToday",
            (select count(*)::int from platform_task where source_system = 'ERP' and created_at >= ${dayStartIso}::timestamptz and created_at < ${dayEndIso}::timestamptz) as "taskTodayErp",
            (select count(*)::int from platform_task where source_system = 'CRM' and created_at >= ${dayStartIso}::timestamptz and created_at < ${dayEndIso}::timestamptz) as "taskTodayCrm",
            (select count(*)::int from platform_task where execution_status in ('ACCEPTED', 'BAIYING_CREATING', 'BAIYING_CREATED', 'IMPORTING', 'IMPORTED', 'STARTING', 'CALLING', 'PAUSED', 'CALL_COMPLETED', 'RECONCILING')) as "taskRunning",
            (select coalesce(sum(phone_count), 0)::int from platform_task where execution_status in ('ACCEPTED', 'BAIYING_CREATING', 'BAIYING_CREATED', 'IMPORTING', 'IMPORTED', 'STARTING', 'CALLING', 'PAUSED', 'CALL_COMPLETED', 'RECONCILING')) as "runningPhoneCount",
            (select count(*)::int from platform_task where execution_status = 'COMPLETED' and coalesce(closed_at, reconciled_at, updated_at) >= ${dayStartIso}::timestamptz and coalesce(closed_at, reconciled_at, updated_at) < ${dayEndIso}::timestamptz) as "completedToday",
            (select count(*)::int from platform_task where execution_status in ('CREATE_FAILED', 'IMPORT_FAILED', 'START_FAILED')) as "taskFailed",
            (select coalesce(sum(balance), 0)::numeric(18, 6)::text from studio_account) as "totalBalance",
            (select coalesce(sum(active_hold_amount), 0)::numeric(18, 6)::text from studio_account) as "totalActiveHold",
            (select coalesce(sum(balance - active_hold_amount), 0)::numeric(18, 6)::text from studio_account) as "totalAvailable",
            (select count(*)::int from studio_account where status = 'LOW_BALANCE') as "lowBalanceStudios",
            (select count(*)::int from studio_account where status = 'OVERDUE') as "overdueStudios",
            (select count(*)::int from callback_inbox where dead_lettered_at is null and process_status in ('PENDING', 'PROCESSING', 'FAILED')) as "callbackPending",
            (select count(*)::int from callback_inbox where dead_lettered_at is null and process_status in ('PENDING', 'PROCESSING', 'FAILED') and received_at < ${callbackStaleBeforeIso}::timestamptz) as "callbackStale",
            (select count(*)::int from queue_outbox where published_at is null and dead_lettered_at is null) as "outboxPending",
            (select count(*)::int from queue_outbox where published_at is null and dead_lettered_at is null and created_at < ${outboxStaleBeforeIso}::timestamptz) as "outboxStale",
            (select count(*)::int from delivery_event where status in ('FAILED', 'DEAD_LETTERED')) as "deliveryFailed",
            (select count(*)::int from dead_letter_event where status in ('OPEN', 'REPLAYING')) as "openDeadLetters",
            (select count(*)::int from account_adjustment_request where status = 'PENDING') as "pendingApprovals",
            (select count(*)::int
              from call_instance instance
              join platform_task task on task.id = instance.task_id
              where task.contract_version = '2.0'
                and instance.match_method is not null
                and coalesce(instance.provider_occurred_at, instance.created_at) >= ${qualityWindowStartIso}::timestamptz
            ) as "primaryCorrelationTotal",
            (select count(*)::int
              from call_instance instance
              join platform_task task on task.id = instance.task_id
              where task.contract_version = '2.0'
                and instance.match_method = 'ITEM_TOKEN'
                and coalesce(instance.provider_occurred_at, instance.created_at) >= ${qualityWindowStartIso}::timestamptz
            ) as "primaryCorrelationMatched",
            (select count(*)::int
              from call_instance
              where match_method is not null
                and coalesce(provider_occurred_at, created_at) >= ${qualityWindowStartIso}::timestamptz
            ) as "allCorrelationMatched",
            (select count(*)::int
              from call_instance
              where match_method = 'PHONE_FALLBACK'
                and coalesce(provider_occurred_at, created_at) >= ${qualityWindowStartIso}::timestamptz
            ) as "phoneFallbackMatched",
            (select count(*)::int
              from dead_letter_event
              where source_type = 'CALLBACK'
                and final_error like 'CallbackBusinessConflictError:%'
                and created_at >= ${qualityWindowStartIso}::timestamptz
            ) as "correlationConflicts",
            (select count(*)::int
              from operational_metric_event
              where metric_code = 'DATA_CATEGORY_AMBIGUOUS'
                and occurred_at >= ${qualityWindowStartIso}::timestamptz
            ) as "categoryAmbiguities",
            (select count(*)::int
              from callback_inbox
              where received_at >= ${qualityWindowStartIso}::timestamptz
            ) as "callbackUnique",
            (select count(*)::int
              from operational_metric_event
              where metric_code = 'CALLBACK_DUPLICATE'
                and occurred_at >= ${qualityWindowStartIso}::timestamptz
            ) as "callbackDuplicates",
            (select count(*)::int
              from delivery_event
              where target = 'RESULT' and status in ('FAILED', 'DEAD_LETTERED')
            ) as "resultDeliveryFailures",
            (select count(*)::int
              from delivery_event
              where target = 'RECORDING' and status in ('FAILED', 'DEAD_LETTERED')
            ) as "recordingDeliveryFailures"
        `),
        this.db.execute<TrendRow>(sql`
          select
            extract(hour from coalesce(provider_occurred_at, created_at) at time zone 'Asia/Shanghai')::int as hour,
            count(*)::int as total,
            count(*) filter (where call_status = 'ANSWERED')::int as answered
          from call_instance
          where coalesce(provider_occurred_at, created_at) >= ${dayStartIso}::timestamptz
            and coalesce(provider_occurred_at, created_at) < ${dayEndIso}::timestamptz
          group by 1
          order by 1
        `),
        this.db.execute<RecentTaskRow>(sql`
          select
            id,
            task_no as "taskNo",
            task_name as "taskName",
            studio_name_snapshot as "studioName",
            source_system as "sourceSystem",
            execution_status as "executionStatus",
            phone_count as "phoneCount",
            call_instance_count as "callInstanceCount",
            customer_charge::text as "customerCharge",
            created_at as "createdAt",
            updated_at as "updatedAt"
          from platform_task
          order by created_at desc, id desc
          limit 8
        `),
        this.db.execute<AttentionRow>(sql`
          select * from (
            select
              'task:' || id::text as id,
              'TASK'::text as kind,
              'P0'::text as priority,
              task_no || ' · ' || task_name as title,
              coalesce(failure_message, failure_code, '任务执行失败，等待人工确认') as description,
              task_no as "objectId",
              'TASKS'::text as destination,
              '查看任务'::text as "actionLabel",
              updated_at as "occurredAt"
            from platform_task
            where execution_status in ('CREATE_FAILED', 'IMPORT_FAILED', 'START_FAILED')
            order by updated_at desc
            limit 5
          ) task_alerts
          union all
          select * from (
            select
              'account:' || account.studio_id::text as id,
              'ACCOUNT'::text as kind,
              case when account.status = 'OVERDUE' then 'P0' else 'P1' end::text as priority,
              studio.name || case when account.status = 'OVERDUE' then ' · 账户欠费' else ' · 余额预警' end as title,
              '可用余额 ¥' || (account.balance - account.active_hold_amount)::numeric(18, 2)::text as description,
              account.studio_id::text as "objectId",
              'STUDIOS'::text as destination,
              '查看账户'::text as "actionLabel",
              account.updated_at as "occurredAt"
            from studio_account account
            join studio on studio.id = account.studio_id
            where account.status in ('LOW_BALANCE', 'OVERDUE')
            order by account.updated_at desc
            limit 5
          ) account_alerts
          union all
          select * from (
            select
              'approval:' || request.id::text as id,
              'APPROVAL'::text as kind,
              'P1'::text as priority,
              request.request_no || ' · 待复核' as title,
              studio.name || ' · ¥' || request.amount::numeric(18, 2)::text as description,
              request.id::text as "objectId",
              'ADJUSTMENTS'::text as destination,
              '前往复核'::text as "actionLabel",
              request.requested_at as "occurredAt"
            from account_adjustment_request request
            join studio on studio.id = request.studio_id
            where request.status = 'PENDING'
            order by request.requested_at desc
            limit 5
          ) approval_alerts
          union all
          select * from (
            select
              'dead-letter:' || id::text as id,
              'DEAD_LETTER'::text as kind,
              'P0'::text as priority,
              source_type::text || ' · 死信待处理' as title,
              final_error as description,
              id::text as "objectId",
              'RECOVERY'::text as destination,
              '前往处置'::text as "actionLabel",
              created_at as "occurredAt"
            from dead_letter_event
            where status in ('OPEN', 'REPLAYING')
            order by created_at desc
            limit 5
          ) dead_letter_alerts
        `),
      ]);

    const metrics = metricRows[0] ?? emptyMetrics();
    const trendByHour = new Map(trendRows.map((row) => [row.hour, row]));
    const points = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      total: trendByHour.get(hour)?.total ?? 0,
      answered: trendByHour.get(hour)?.answered ?? 0,
    }));
    const attentionItems = attentionRows
      .map((row) => ({
        ...row,
        description:
          redactOperatorText(row.description) ?? '等待人工确认处理结果',
        occurredAt: toIso(row.occurredAt),
      }))
      .sort(
        (left, right) =>
          priorityRank(left.priority) - priorityRank(right.priority) ||
          right.occurredAt.localeCompare(left.occurredAt),
      )
      .slice(0, 12);
    const highPriority =
      metrics.taskFailed + metrics.overdueStudios + metrics.openDeadLetters;
    const primaryCorrelation = rateMetric(
      metrics.primaryCorrelationMatched,
      metrics.primaryCorrelationTotal,
      primaryCorrelationStatus,
      '必须达到 100%',
    );
    const phoneFallback = rateMetric(
      metrics.phoneFallbackMatched,
      metrics.allCorrelationMatched,
      (_, count) =>
        count === 0 ? 'HEALTHY' : count <= 5 ? 'WARNING' : 'CRITICAL',
      '目标为 0 次',
    );
    const correlationConflicts = countMetric(
      metrics.correlationConflicts,
      '必须为 0 次',
      true,
    );
    const categoryAmbiguities = countMetric(
      metrics.categoryAmbiguities,
      '必须为 0 次',
      true,
    );
    const callbackTotal = metrics.callbackUnique + metrics.callbackDuplicates;
    const callbackDuplicates = rateMetric(
      metrics.callbackDuplicates,
      callbackTotal,
      duplicateCallbackStatus,
      '低于 5% 且少于 5 次',
    );
    const deliveryFailureTotal =
      metrics.resultDeliveryFailures + metrics.recordingDeliveryFailures;
    const deliveryFailureStatus =
      deliveryFailureTotal === 0 ? 'HEALTHY' : 'CRITICAL';
    const qualityStatuses = [
      primaryCorrelation.status,
      phoneFallback.status,
      correlationConflicts.status,
      categoryAmbiguities.status,
      callbackDuplicates.status,
      deliveryFailureStatus,
    ] as const;
    const qualityStatus = qualityStatuses.reduce(worseQualityStatus, 'HEALTHY');
    const qualityAlertCount = qualityStatuses.filter(
      (status) => status === 'WARNING' || status === 'CRITICAL',
    ).length;

    return operatorOperationsOverviewSchema.parse({
      generatedAt: now.toISOString(),
      businessDate,
      tasks: {
        all: metrics.taskAll,
        today: metrics.taskToday,
        todayErp: metrics.taskTodayErp,
        todayCrm: metrics.taskTodayCrm,
        running: metrics.taskRunning,
        runningPhoneCount: metrics.runningPhoneCount,
        completedToday: metrics.completedToday,
        failed: metrics.taskFailed,
      },
      finance: {
        totalBalance: metrics.totalBalance,
        totalActiveHold: metrics.totalActiveHold,
        totalAvailable: metrics.totalAvailable,
        lowBalanceStudios: metrics.lowBalanceStudios,
        overdueStudios: metrics.overdueStudios,
      },
      pipeline: {
        callbackPending: metrics.callbackPending,
        callbackStale: metrics.callbackStale,
        outboxPending: metrics.outboxPending,
        outboxStale: metrics.outboxStale,
        deliveryFailed: metrics.deliveryFailed,
        openDeadLetters: metrics.openDeadLetters,
        pendingApprovals: metrics.pendingApprovals,
      },
      integrationQuality: {
        windowHours: qualityWindowHours,
        windowStartedAt: qualityWindowStart.toISOString(),
        status: qualityStatus,
        alertCount: qualityAlertCount,
        primaryCorrelation,
        phoneFallback,
        correlationConflicts,
        categoryAmbiguities,
        callbackDuplicates,
        deliveryFailures: {
          result: metrics.resultDeliveryFailures,
          recording: metrics.recordingDeliveryFailures,
          total: deliveryFailureTotal,
          status: deliveryFailureStatus,
          threshold: '当前未恢复必须为 0',
        },
      },
      attention: {
        total:
          metrics.taskFailed +
          metrics.lowBalanceStudios +
          metrics.overdueStudios +
          metrics.openDeadLetters +
          metrics.pendingApprovals,
        highPriority,
        items: attentionItems,
      },
      callTrend: {
        total: points.reduce((sum, point) => sum + point.total, 0),
        answered: points.reduce((sum, point) => sum + point.answered, 0),
        points,
      },
      recentTasks: recentRows.map((row) => ({
        ...row,
        createdAt: toIso(row.createdAt),
        updatedAt: toIso(row.updatedAt),
      })),
    });
  }
}

function emptyMetrics(): MetricRow {
  return {
    taskAll: 0,
    taskToday: 0,
    taskTodayErp: 0,
    taskTodayCrm: 0,
    taskRunning: 0,
    runningPhoneCount: 0,
    completedToday: 0,
    taskFailed: 0,
    totalBalance: '0.000000',
    totalActiveHold: '0.000000',
    totalAvailable: '0.000000',
    lowBalanceStudios: 0,
    overdueStudios: 0,
    callbackPending: 0,
    callbackStale: 0,
    outboxPending: 0,
    outboxStale: 0,
    deliveryFailed: 0,
    openDeadLetters: 0,
    pendingApprovals: 0,
    primaryCorrelationTotal: 0,
    primaryCorrelationMatched: 0,
    allCorrelationMatched: 0,
    phoneFallbackMatched: 0,
    correlationConflicts: 0,
    categoryAmbiguities: 0,
    callbackUnique: 0,
    callbackDuplicates: 0,
    resultDeliveryFailures: 0,
    recordingDeliveryFailures: 0,
  };
}

type QualityStatus = OperatorOperationsOverview['integrationQuality']['status'];

function rateMetric(
  matched: number,
  total: number,
  statusFor: (rate: number, matched: number, total: number) => QualityStatus,
  threshold: string,
) {
  const rate = total === 0 ? null : roundPercent((matched / total) * 100);
  return {
    matched,
    total,
    rate,
    status:
      rate === null ? ('NO_DATA' as const) : statusFor(rate, matched, total),
    threshold,
  };
}

function countMetric(count: number, threshold: string, critical: boolean) {
  return {
    count,
    status:
      count === 0
        ? ('HEALTHY' as const)
        : critical
          ? ('CRITICAL' as const)
          : ('WARNING' as const),
    threshold,
  };
}

function primaryCorrelationStatus(rate: number): QualityStatus {
  if (rate === 100) return 'HEALTHY';
  return rate >= 99 ? 'WARNING' : 'CRITICAL';
}

function duplicateCallbackStatus(rate: number, matched: number): QualityStatus {
  if (matched >= 20 && rate >= 20) return 'CRITICAL';
  if (matched >= 5 && rate >= 5) return 'WARNING';
  return 'HEALTHY';
}

function worseQualityStatus(
  current: QualityStatus,
  candidate: QualityStatus,
): QualityStatus {
  return qualityStatusRank(candidate) > qualityStatusRank(current)
    ? candidate
    : current;
}

function qualityStatusRank(status: QualityStatus) {
  return { NO_DATA: 0, HEALTHY: 1, WARNING: 2, CRITICAL: 3 }[status];
}

function roundPercent(value: number) {
  return Math.round(value * 10) / 10;
}

function shanghaiBusinessDate(value: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

function priorityRank(priority: OperatorOverviewAttentionItem['priority']) {
  return priority === 'P0' ? 0 : priority === 'P1' ? 1 : 2;
}

function toIso(value: Date | string) {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

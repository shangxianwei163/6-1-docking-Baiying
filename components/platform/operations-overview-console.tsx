'use client';

import { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Banknote,
  CheckCircle2,
  DatabaseZap,
  PhoneCall,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import type {
  OperatorOperationsOverview,
  OperatorOverviewAttentionItem,
  OperatorQualityStatus,
} from '@outbound/contracts';
import { loadOperationsOverview, PlatformApiError } from '@/lib/platform-api';
import { Panel, Status } from './shared';

type OverviewDestination =
  | '呼叫任务'
  | '影楼管理'
  | '充值记录'
  | '接口日志'
  | '异常中心';

const destinationMap: Record<
  OperatorOverviewAttentionItem['destination'],
  OverviewDestination
> = {
  TASKS: '呼叫任务',
  STUDIOS: '影楼管理',
  ADJUSTMENTS: '充值记录',
  INTEGRATION_LOGS: '接口日志',
  RECOVERY: '异常中心',
};

const executionMeta: Record<
  OperatorOperationsOverview['recentTasks'][number]['executionStatus'],
  { label: string; tone: 'green' | 'amber' | 'red' | 'blue' | 'gray' }
> = {
  ACCEPTED: { label: '已受理', tone: 'blue' },
  BAIYING_CREATING: { label: '创建中', tone: 'blue' },
  BAIYING_CREATED: { label: '已创建', tone: 'blue' },
  IMPORTING: { label: '导入中', tone: 'blue' },
  IMPORTED: { label: '已导入', tone: 'blue' },
  STARTING: { label: '启动中', tone: 'blue' },
  CALLING: { label: '呼叫中', tone: 'green' },
  PAUSED: { label: '已暂停', tone: 'amber' },
  CALL_COMPLETED: { label: '呼叫完成', tone: 'green' },
  RECONCILING: { label: '对账中', tone: 'blue' },
  COMPLETED: { label: '已闭环', tone: 'green' },
  CREATE_FAILED: { label: '创建失败', tone: 'red' },
  IMPORT_FAILED: { label: '导入失败', tone: 'red' },
  START_FAILED: { label: '启动失败', tone: 'red' },
  CANCELLED: { label: '已取消', tone: 'gray' },
  TERMINATED: { label: '已终止', tone: 'gray' },
};

export function OperationsOverviewConsole({
  onNavigate,
}: {
  onNavigate: (destination: OverviewDestination) => void;
}) {
  const [overview, setOverview] = useState<OperatorOperationsOverview | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setLoading(true);
        setError('');
      }
    });
    void loadOperationsOverview()
      .then((result) => {
        if (!cancelled) setOverview(result);
      })
      .catch((caught) => {
        if (!cancelled) setError(apiErrorMessage(caught));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  const trend = overview?.callTrend.points.slice(8, 22) ?? [];
  const trendMaximum = Math.max(1, ...trend.map((point) => point.total));

  return (
    <div className="monitoring-overview">
      <header className="ops-page-intro monitoring-intro">
        <div>
          <span>LIVE OPERATIONS / POSTGRESQL</span>
          <h2>总览</h2>
          <p>
            任务、资金和消息链路使用同一业务时区聚合；这里只显示系统当前真实状态。
          </p>
        </div>
        <div className="monitoring-intro-actions">
          <span>
            <span
              className={error ? 'monitoring-led is-error' : 'monitoring-led'}
            />
            {error
              ? '读取异常'
              : overview
                ? `更新于 ${formatTime(overview.generatedAt)}`
                : '正在连接'}
          </span>
          <button
            type="button"
            className="ops-icon-button"
            disabled={loading}
            onClick={() => setRefreshToken((current) => current + 1)}
          >
            <RefreshCw
              aria-hidden="true"
              className={loading ? 'is-spinning' : ''}
              size={14}
            />
            刷新实时数据
          </button>
        </div>
      </header>

      {error ? (
        <div className="ops-error-banner" role="alert">
          <AlertTriangle aria-hidden="true" size={15} />
          {error}
        </div>
      ) : null}

      <section className="monitoring-metric-grid" aria-label="实时运营指标">
        <OverviewMetric
          icon={PhoneCall}
          label="今日外呼任务"
          value={formatInteger(overview?.tasks.today)}
          note={`ERP ${overview?.tasks.todayErp ?? 0} · CRM ${overview?.tasks.todayCrm ?? 0}`}
          tone="green"
          loading={loading && !overview}
        />
        <OverviewMetric
          icon={Activity}
          label="正在执行号码"
          value={formatInteger(overview?.tasks.runningPhoneCount)}
          note={`${overview?.tasks.running ?? 0} 个任务仍在执行链路`}
          tone="blue"
          loading={loading && !overview}
        />
        <OverviewMetric
          icon={Banknote}
          label="已冻结话费"
          value={formatMoney(overview?.finance.totalActiveHold)}
          note={`总可用 ${formatMoney(overview?.finance.totalAvailable)}`}
          tone="amber"
          loading={loading && !overview}
        />
        <OverviewMetric
          icon={ShieldAlert}
          label="待人工处理"
          value={formatInteger(overview?.attention.total)}
          note={`${overview?.attention.highPriority ?? 0} 项高优先级`}
          tone="red"
          loading={loading && !overview}
        />
      </section>

      <section className="pipeline-strip" aria-label="系统链路健康度">
        <PipelineMetric
          label="回调待处理"
          value={overview?.pipeline.callbackPending ?? 0}
          alert={(overview?.pipeline.callbackStale ?? 0) > 0}
          note={`${overview?.pipeline.callbackStale ?? 0} 条超 2 分钟`}
        />
        <PipelineMetric
          label="队列待发布"
          value={overview?.pipeline.outboxPending ?? 0}
          alert={(overview?.pipeline.outboxStale ?? 0) > 0}
          note={`${overview?.pipeline.outboxStale ?? 0} 条超 5 分钟`}
        />
        <PipelineMetric
          label="投递失败"
          value={overview?.pipeline.deliveryFailed ?? 0}
          alert={(overview?.pipeline.deliveryFailed ?? 0) > 0}
          note="ERP / CRM 回传"
        />
        <PipelineMetric
          label="开放死信"
          value={overview?.pipeline.openDeadLetters ?? 0}
          alert={(overview?.pipeline.openDeadLetters ?? 0) > 0}
          note="含重放处理中"
        />
        <PipelineMetric
          label="待复核资金单"
          value={overview?.pipeline.pendingApprovals ?? 0}
          alert={(overview?.pipeline.pendingApprovals ?? 0) > 0}
          note="Maker / Checker"
        />
      </section>

      <Panel
        title="接口质量与关联告警"
        meta={
          overview
            ? `近 ${overview.integrationQuality.windowHours} 小时 · ${qualityStatusMeta[overview.integrationQuality.status].label}`
            : '读取中'
        }
        className={`monitoring-panel quality-panel is-${overview?.integrationQuality.status ?? 'NO_DATA'}`}
      >
        <div className="quality-panel-heading">
          <p>
            主关联、后备匹配和回调异常按近 24
            小时统计；结果与录音显示当前仍未恢复的回传事件。
          </p>
          <span>
            {overview?.integrationQuality.alertCount ?? 0} 项达到告警阈值
          </span>
        </div>
        <section className="quality-metric-grid" aria-label="接口质量告警指标">
          <QualityMetric
            label="GUID 主关联成功率"
            value={formatQualityRate(
              overview?.integrationQuality.primaryCorrelation.rate,
            )}
            note={`${overview?.integrationQuality.primaryCorrelation.matched ?? 0} / ${overview?.integrationQuality.primaryCorrelation.total ?? 0} 通`}
            threshold={
              overview?.integrationQuality.primaryCorrelation.threshold ??
              '必须达到 100%'
            }
            status={
              overview?.integrationQuality.primaryCorrelation.status ??
              'NO_DATA'
            }
          />
          <QualityMetric
            label="手机号后备匹配"
            value={`${overview?.integrationQuality.phoneFallback.matched ?? 0} 次`}
            note={`占已关联回调 ${formatQualityRate(overview?.integrationQuality.phoneFallback.rate)}`}
            threshold={
              overview?.integrationQuality.phoneFallback.threshold ??
              '目标为 0 次'
            }
            status={
              overview?.integrationQuality.phoneFallback.status ?? 'NO_DATA'
            }
          />
          <QualityMetric
            label="号码关联冲突"
            value={`${overview?.integrationQuality.correlationConflicts.count ?? 0} 次`}
            note="签名、任务或号码无法唯一对应"
            threshold={
              overview?.integrationQuality.correlationConflicts.threshold ??
              '必须为 0 次'
            }
            status={
              overview?.integrationQuality.correlationConflicts.status ??
              'NO_DATA'
            }
          />
          <QualityMetric
            label="分类匹配歧义"
            value={`${overview?.integrationQuality.categoryAmbiguities.count ?? 0} 次`}
            note="同一三级分类命中多条配置"
            threshold={
              overview?.integrationQuality.categoryAmbiguities.threshold ??
              '必须为 0 次'
            }
            status={
              overview?.integrationQuality.categoryAmbiguities.status ??
              'NO_DATA'
            }
          />
          <QualityMetric
            label="百应重复回调"
            value={`${overview?.integrationQuality.callbackDuplicates.matched ?? 0} 次`}
            note={`占全部入站 ${formatQualityRate(overview?.integrationQuality.callbackDuplicates.rate)}`}
            threshold={
              overview?.integrationQuality.callbackDuplicates.threshold ??
              '低于 5% 且少于 5 次'
            }
            status={
              overview?.integrationQuality.callbackDuplicates.status ??
              'NO_DATA'
            }
          />
          <QualityMetric
            label="ERP / CRM 回传失败"
            value={`${overview?.integrationQuality.deliveryFailures.total ?? 0} 条`}
            note={`结果 ${overview?.integrationQuality.deliveryFailures.result ?? 0} · 录音 ${overview?.integrationQuality.deliveryFailures.recording ?? 0}`}
            threshold={
              overview?.integrationQuality.deliveryFailures.threshold ??
              '当前未恢复必须为 0'
            }
            status={
              overview?.integrationQuality.deliveryFailures.status ?? 'NO_DATA'
            }
          />
        </section>
      </Panel>

      <div className="monitoring-primary-grid">
        <Panel
          title="今日呼叫曲线"
          meta={`${overview?.callTrend.total ?? 0} 通 · ${overview?.callTrend.answered ?? 0} 通接听`}
          className="monitoring-panel"
        >
          <div className="monitoring-chart-heading">
            <div>
              <span>有效接通率</span>
              <b>{formatRate(overview?.callTrend)}</b>
            </div>
            <p>
              <span className="chart-legend is-total" />
              总呼叫
              <span className="chart-legend is-answered" />
              接听
            </p>
          </div>
          <div className="monitoring-chart" aria-label="8 时至 21 时呼叫趋势">
            {trend.map((point) => (
              <div className="monitoring-chart-column" key={point.hour}>
                <span className="monitoring-chart-value">
                  {point.total || ''}
                </span>
                <div className="monitoring-chart-track">
                  <i
                    className="is-total"
                    style={{ height: `${(point.total / trendMaximum) * 100}%` }}
                  />
                  <i
                    className="is-answered"
                    style={{
                      height: `${(point.answered / trendMaximum) * 100}%`,
                    }}
                  />
                </div>
                <small>{String(point.hour).padStart(2, '0')}</small>
              </div>
            ))}
          </div>
        </Panel>

        <Panel
          title="需要处理"
          meta={overview ? `${overview.attention.total} 项` : '读取中'}
          className="monitoring-panel attention-panel"
        >
          <div className="attention-list">
            {overview?.attention.items.length ? (
              overview.attention.items.map((item) => (
                <article className="attention-item" key={item.id}>
                  <span className={`attention-priority is-${item.priority}`}>
                    {item.priority}
                  </span>
                  <div>
                    <b>{item.title}</b>
                    <p>{item.description}</p>
                    <small>{formatDateTime(item.occurredAt)}</small>
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigate(destinationMap[item.destination])}
                  >
                    {item.actionLabel}
                    <ArrowUpRight aria-hidden="true" size={12} />
                  </button>
                </article>
              ))
            ) : (
              <div className="monitoring-empty">
                <CheckCircle2 aria-hidden="true" size={19} />
                <b>{loading ? '正在核对异常项' : '当前没有待人工处理项'}</b>
                <p>任务失败、余额、资金审批与死信均会在此汇总。</p>
              </div>
            )}
          </div>
        </Panel>
      </div>

      <Panel
        title="最近受理任务"
        meta={overview ? `累计 ${overview.tasks.all} 个任务` : '读取中'}
        className="monitoring-panel recent-task-panel"
      >
        <div className="table-wrap">
          <table className="data-table monitoring-task-table">
            <thead>
              <tr>
                <th>平台任务号</th>
                <th>来源</th>
                <th>影楼 / 任务</th>
                <th>号码</th>
                <th>回调实例</th>
                <th>客户话费</th>
                <th>状态</th>
                <th>受理时间</th>
              </tr>
            </thead>
            <tbody>
              {overview?.recentTasks.map((task) => {
                const meta = executionMeta[task.executionStatus];
                return (
                  <tr key={task.id}>
                    <td>
                      <button
                        type="button"
                        className="monitoring-task-link"
                        onClick={() => onNavigate('呼叫任务')}
                      >
                        {task.taskNo}
                      </button>
                    </td>
                    <td>
                      <span
                        className={`source-chip is-${task.sourceSystem.toLowerCase()}`}
                      >
                        {task.sourceSystem}
                      </span>
                    </td>
                    <td>
                      <b className="table-primary">{task.studioName}</b>
                      <small className="table-meta">{task.taskName}</small>
                    </td>
                    <td>{formatInteger(task.phoneCount)}</td>
                    <td>{formatInteger(task.callInstanceCount)}</td>
                    <td>{formatMoney(task.customerCharge)}</td>
                    <td>
                      <Status tone={meta.tone}>{meta.label}</Status>
                    </td>
                    <td>{formatDateTime(task.createdAt)}</td>
                  </tr>
                );
              })}
              {!loading && !overview?.recentTasks.length ? (
                <tr>
                  <td colSpan={8}>
                    <div className="monitoring-table-empty">
                      <DatabaseZap aria-hidden="true" size={18} />
                      数据库中尚无外呼任务
                    </div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function OverviewMetric({
  icon: Icon,
  label,
  value,
  note,
  tone,
  loading,
}: {
  icon: typeof PhoneCall;
  label: string;
  value: string;
  note: string;
  tone: 'green' | 'blue' | 'amber' | 'red';
  loading: boolean;
}) {
  return (
    <article className={`monitoring-metric is-${tone}`}>
      <span className="monitoring-metric-icon">
        <Icon aria-hidden="true" size={16} />
      </span>
      <div>
        <span>{label}</span>
        <b className={loading ? 'is-loading' : ''}>{value}</b>
        <small>{note}</small>
      </div>
    </article>
  );
}

function PipelineMetric({
  label,
  value,
  alert,
  note,
}: {
  label: string;
  value: number;
  alert: boolean;
  note: string;
}) {
  return (
    <article className={alert ? 'is-alert' : ''}>
      <span className="pipeline-state" />
      <div>
        <span>{label}</span>
        <b>{value}</b>
        <small>{note}</small>
      </div>
    </article>
  );
}

const qualityStatusMeta: Record<
  OperatorQualityStatus,
  { label: string; shortLabel: string }
> = {
  NO_DATA: { label: '暂无样本', shortLabel: '无样本' },
  HEALTHY: { label: '全部正常', shortLabel: '正常' },
  WARNING: { label: '存在关注项', shortLabel: '关注' },
  CRITICAL: { label: '存在严重告警', shortLabel: '严重' },
};

function QualityMetric({
  label,
  value,
  note,
  threshold,
  status,
}: {
  label: string;
  value: string;
  note: string;
  threshold: string;
  status: OperatorQualityStatus;
}) {
  return (
    <article className={`quality-metric is-${status}`}>
      <div className="quality-metric-title">
        <span className="quality-state" />
        <span>{label}</span>
        <em>{qualityStatusMeta[status].shortLabel}</em>
      </div>
      <b>{value}</b>
      <p>{note}</p>
      <small>阈值：{threshold}</small>
    </article>
  );
}

function formatInteger(value: number | undefined) {
  return new Intl.NumberFormat('zh-CN').format(value ?? 0);
}

function formatMoney(value: string | undefined) {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 2,
  }).format(Number(value ?? 0));
}

function formatRate(
  trend: OperatorOperationsOverview['callTrend'] | undefined,
) {
  if (!trend?.total) return '—';
  return `${((trend.answered / trend.total) * 100).toFixed(1)}%`;
}

function formatQualityRate(value: number | null | undefined) {
  return value === null || value === undefined ? '—' : `${value.toFixed(1)}%`;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function apiErrorMessage(caught: unknown) {
  if (caught instanceof PlatformApiError) {
    return caught.requestId
      ? `${caught.message}（请求 ${caught.requestId}）`
      : caught.message;
  }
  return caught instanceof Error ? caught.message : '运营总览读取失败';
}

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownToLine,
  Calculator,
  CheckCircle2,
  CircleDollarSign,
  FileClock,
  FileSpreadsheet,
  LoaderCircle,
  RefreshCw,
  Search,
  Sigma,
} from 'lucide-react';
import type {
  OperatorStudio,
  PlatformCostDetailPage,
  PlatformCostDetailStatus,
} from '@outbound/contracts';
import {
  exportPlatformCostDetails,
  loadOperatorStudios,
  loadPlatformCostDetails,
  PlatformApiError,
  type PlatformCostDetailFilters,
} from '@/lib/platform-api';
import { UnifiedDateRangePicker } from '@/components/ui/unified-date-picker';
import { UnifiedSelect } from '@/components/ui/unified-select';
import { Panel, Status } from './shared';

const emptyPage: PlatformCostDetailPage = {
  total: 0,
  pages: 0,
  pageNum: 0,
  pageSize: 20,
  summary: {
    taskCount: 0,
    totalBillingMinutes: '0',
    totalCustomerCharge: '0.000000',
    totalPlatformCost: '0.000000',
    totalProfit: '0.000000',
    unpricedBillingMinutes: '0',
    statusCounts: {
      all: 0,
      provisional: 0,
      final: 0,
      adjustmentPending: 0,
      unavailable: 0,
    },
  },
  items: [],
};

type CostScope = PlatformCostDetailStatus | 'ALL';

const costScopes: Array<{
  value: CostScope;
  label: string;
  countKey: keyof PlatformCostDetailPage['summary']['statusCounts'];
}> = [
  { value: 'ALL', label: '全部', countKey: 'all' },
  { value: 'PROVISIONAL', label: '动态暂估', countKey: 'provisional' },
  { value: 'FINAL', label: '已封账', countKey: 'final' },
  {
    value: 'ADJUSTMENT_PENDING',
    label: '调整待处理',
    countKey: 'adjustmentPending',
  },
  { value: 'UNAVAILABLE', label: '阶梯异常', countKey: 'unavailable' },
];

const statusMeta: Record<
  PlatformCostDetailStatus,
  { label: string; tone: 'green' | 'blue' | 'amber' | 'red'; note: string }
> = {
  PROVISIONAL: {
    label: '动态暂估',
    tone: 'blue',
    note: '随当月总分钟实时变化',
  },
  FINAL: {
    label: '已封账',
    tone: 'green',
    note: '月度成本快照已锁定',
  },
  ADJUSTMENT_PENDING: {
    label: '调整待处理',
    tone: 'amber',
    note: '原月结单保持不变',
  },
  UNAVAILABLE: {
    label: '阶梯异常',
    tone: 'red',
    note: '尚无唯一可用供应阶梯',
  },
};

export function PlatformCostDetailConsole() {
  const initialRange = useMemo(() => currentShanghaiMonthRange(), []);
  const [keywordDraft, setKeywordDraft] = useState('');
  const [keyword, setKeyword] = useState('');
  const [studioId, setStudioId] = useState('ALL');
  const [costScope, setCostScope] = useState<CostScope>('ALL');
  const [startDate, setStartDate] = useState(initialRange.start);
  const [endDate, setEndDate] = useState(initialRange.end);
  const [pageNum, setPageNum] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(emptyPage);
  const [studios, setStudios] = useState<OperatorStudio[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setKeyword(keywordDraft.trim());
      setPageNum(0);
    }, 260);
    return () => window.clearTimeout(timer);
  }, [keywordDraft]);

  useEffect(() => {
    let cancelled = false;
    void loadOperatorStudios({ pageNum: 0, pageSize: 100 })
      .then((result) => {
        if (!cancelled) setStudios(result.studios);
      })
      .catch(() => {
        if (!cancelled) setStudios([]);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  const filters = useMemo<PlatformCostDetailFilters>(
    () => ({
      keyword: keyword || undefined,
      studioId: studioId === 'ALL' ? undefined : studioId,
      costStatus: costScope === 'ALL' ? undefined : costScope,
      occurredFrom: startDate ? shanghaiDayStart(startDate) : undefined,
      occurredBefore: endDate ? shanghaiNextDayStart(endDate) : undefined,
    }),
    [costScope, endDate, keyword, startDate, studioId],
  );

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setLoading(true);
        setError('');
      }
    });
    void loadPlatformCostDetails({ ...filters, pageNum, pageSize })
      .then((result) => {
        if (cancelled) return;
        setPage(result);
        if (result.pages > 0 && pageNum >= result.pages) {
          setPageNum(result.pages - 1);
        }
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
  }, [filters, pageNum, pageSize, refreshToken]);

  const refresh = useCallback(
    () => setRefreshToken((current) => current + 1),
    [],
  );

  const chooseRange = (range: { start: string; end: string }) => {
    setStartDate(range.start);
    setEndDate(range.end);
    setPageNum(0);
  };

  const exportDetails = async () => {
    if (exporting || loading || page.total === 0) return;
    setExporting(true);
    setError('');
    setFeedback('');
    try {
      const exported = await exportPlatformCostDetails(filters);
      const url = URL.createObjectURL(exported.blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = exported.fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setFeedback(`已按当前筛选条件导出 ${exported.rowCount} 条平台明细。`);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setExporting(false);
    }
  };

  const selectedStudio = studios.find((studio) => studio.id === studioId);
  const ranges = quickRanges();

  return (
    <div className="platform-detail-console">
      <header className="ops-page-intro platform-detail-intro">
        <div>
          <span>SUPPLIER COST LEDGER / LIVE</span>
          <h2>平台明细</h2>
          <p>
            查看平台与百应之间的逐任务供应成本；未封账月份动态暂估，月结后读取不可变成本快照。
          </p>
        </div>
        <button
          type="button"
          className="primary-button platform-detail-export"
          disabled={exporting || loading || page.total === 0}
          onClick={() => void exportDetails()}
        >
          {exporting ? (
            <LoaderCircle aria-hidden="true" className="is-spinning" size={15} />
          ) : (
            <FileSpreadsheet aria-hidden="true" size={15} />
          )}
          {exporting ? '正在生成…' : '导出当前筛选'}
        </button>
      </header>

      {feedback ? (
        <output className="ops-feedback is-success">
          <CheckCircle2 aria-hidden="true" size={16} />
          <span>{feedback}</span>
          <button type="button" onClick={() => setFeedback('')}>
            关闭
          </button>
        </output>
      ) : null}

      <section className="platform-detail-metrics" aria-label="平台成本汇总">
        <DetailMetric
          icon={FileClock}
          label="筛选任务"
          value={`${page.summary.taskCount.toLocaleString('zh-CN')} 个`}
          note={`${formatInteger(page.summary.totalBillingMinutes)} 计费分钟`}
        />
        <DetailMetric
          icon={CircleDollarSign}
          label="客户话费收入"
          value={formatMoney(page.summary.totalCustomerCharge)}
          note={selectedStudio?.name ?? '当前筛选全部影楼'}
        />
        <DetailMetric
          icon={Calculator}
          label="百应供应成本"
          value={formatMoney(page.summary.totalPlatformCost)}
          note={
            Number(page.summary.unpricedBillingMinutes) > 0
              ? `${formatInteger(page.summary.unpricedBillingMinutes)} 分钟待定价`
              : '已按海南人像阶梯核算'
          }
          tone={Number(page.summary.unpricedBillingMinutes) > 0 ? 'warning' : 'cost'}
        />
        <DetailMetric
          icon={Sigma}
          label="平台毛利"
          value={formatMoney(page.summary.totalProfit)}
          note="客户话费收入 − 百应供应成本"
          tone={Number(page.summary.totalProfit) < 0 ? 'warning' : 'profit'}
        />
      </section>

      <aside className="platform-detail-rule" aria-label="成本口径说明">
        <ArrowDownToLine aria-hidden="true" size={16} />
        <div>
          <b>导出与页面使用同一筛选口径</b>
          <p>
            日期按 Asia/Shanghai 的费用发生时间计算；导出包含全部命中记录，不局限于当前页。
          </p>
        </div>
        <span>单次最多 366 天 / 50,000 条</span>
      </aside>

      <Panel
        title="平台与百应费用明细"
        meta={loading ? '正在实时核算…' : `筛选结果 ${page.total} 条`}
        className="ops-panel platform-detail-panel"
      >
        <div className="platform-detail-scope-tabs" aria-label="成本口径筛选">
          {costScopes.map((scope) => (
            <button
              type="button"
              key={scope.value}
              className={costScope === scope.value ? 'is-active' : ''}
              onClick={() => {
                setCostScope(scope.value);
                setPageNum(0);
              }}
            >
              {scope.label}
              <small>{page.summary.statusCounts[scope.countKey]}</small>
            </button>
          ))}
        </div>

        <div className="platform-detail-toolbar">
          <label className="search-box platform-detail-search">
            <Search aria-hidden="true" size={15} />
            <input
              value={keywordDraft}
              onChange={(event) => setKeywordDraft(event.target.value)}
              placeholder="搜索任务号、名称、影楼、MC 编号或百应任务 ID"
            />
          </label>
          <div className="platform-detail-date-field">
            <span>费用日期</span>
            <UnifiedDateRangePicker
              ariaLabel="平台明细费用日期范围"
              value={{ start: startDate, end: endDate }}
              clearable
              popupLabel="选择费用日期范围"
              onValueChange={(range) => {
                setStartDate(range.start);
                setEndDate(range.end);
                setPageNum(0);
              }}
            />
          </div>
          <UnifiedSelect
            ariaLabel="平台明细影楼"
            value={studioId}
            className="filter-button platform-detail-select"
            popupLabel="按影楼筛选"
            options={[
              { value: 'ALL', label: '全部影楼' },
              ...studios.map((studio) => ({
                value: studio.id,
                label: `${studio.businessCode} · ${studio.name}`,
              })),
            ]}
            onValueChange={(value) => {
              setStudioId(value);
              setPageNum(0);
            }}
          />
          <UnifiedSelect
            ariaLabel="平台明细每页数量"
            value={String(pageSize)}
            className="filter-button platform-detail-page-size"
            popupLabel="每页展示数量"
            options={[
              { value: '20', label: '20 条 / 页' },
              { value: '50', label: '50 条 / 页' },
              { value: '100', label: '100 条 / 页' },
            ]}
            onValueChange={(value) => {
              setPageSize(Number(value));
              setPageNum(0);
            }}
          />
          <button
            type="button"
            className="ops-icon-button"
            disabled={loading}
            onClick={refresh}
          >
            <RefreshCw
              aria-hidden="true"
              className={loading ? 'is-spinning' : ''}
              size={14}
            />
            刷新
          </button>
        </div>

        <div className="platform-detail-quick-ranges" aria-label="快捷日期范围">
          <span>快捷范围</span>
          {ranges.map((range) => (
            <button
              type="button"
              key={range.label}
              className={
                startDate === range.start && endDate === range.end
                  ? 'is-active'
                  : ''
              }
              onClick={() => chooseRange(range)}
            >
              {range.label}
            </button>
          ))}
        </div>

        {error ? (
          <div className="ops-feedback is-error" role="alert">
            <AlertTriangle aria-hidden="true" size={16} />
            <div>
              <b>平台明细读取失败</b>
              <span>{error}</span>
            </div>
            <button type="button" onClick={refresh}>
              重试
            </button>
          </div>
        ) : null}

        <div className="table-wrap platform-detail-table-wrap" aria-busy={loading}>
          <table className="data-table platform-detail-table">
            <caption className="sr-only">平台与百应逐任务费用明细</caption>
            <thead>
              <tr>
                <th>费用时间 / 月份</th>
                <th>任务 / 百应</th>
                <th>影楼 / 来源</th>
                <th>任务名称</th>
                <th>计费</th>
                <th>客户收入</th>
                <th>百应阶梯</th>
                <th>供应成本</th>
                <th>平台毛利 / 口径</th>
              </tr>
            </thead>
            <tbody>
              {loading && !page.items.length
                ? Array.from({ length: 5 }, (_, index) => (
                    <PlatformDetailSkeleton key={index} />
                  ))
                : page.items.map((item) => {
                    const meta = statusMeta[item.costStatus];
                    return (
                      <tr key={item.taskId}>
                        <td>
                          <b>{formatDateTime(item.occurredAt)}</b>
                          <span className="table-meta">归属 {item.settlementMonth}</span>
                        </td>
                        <td>
                          <code>{item.taskNo}</code>
                          <span
                            className="table-meta platform-detail-job-id"
                            title={item.baiyingCallJobId ?? ''}
                          >
                            百应 {item.baiyingCallJobId ?? '尚无任务 ID'}
                          </span>
                        </td>
                        <td>
                          <b>{item.studioName}</b>
                          <span className="table-meta">
                            {item.studioBusinessCode} · {item.sourceSystem}
                          </span>
                        </td>
                        <td>
                          <b className="platform-detail-task-name" title={item.taskName}>
                            {item.taskName}
                          </b>
                          <span className="table-meta">{item.phoneCount} 个号码</span>
                        </td>
                        <td>
                          <b>{item.billingMinutes.toLocaleString('zh-CN')} 分钟</b>
                          <span className="table-meta">
                            当月累计 {formatInteger(item.monthlyBillingMinutes)} 分钟
                          </span>
                        </td>
                        <td>
                          <b>{formatMoney(item.customerCharge)}</b>
                          <span className="table-meta">
                            {formatRate(item.customerRate)} / 分
                          </span>
                        </td>
                        <td>
                          <b>{item.tierName ?? '未匹配阶梯'}</b>
                          <span className="table-meta">
                            {item.platformRate
                              ? `${formatRate(item.platformRate)} / 分`
                              : '单价待确认'}
                          </span>
                        </td>
                        <td>
                          <b className="platform-detail-cost">
                            {item.platformCost
                              ? formatMoney(item.platformCost)
                              : '—'}
                          </b>
                          <span className="table-meta">
                            {item.relatedSettlementId
                              ? `凭证 ${item.relatedSettlementId.slice(0, 8)}…`
                              : '尚未生成月结凭证'}
                          </span>
                        </td>
                        <td>
                          <b
                            className={
                              Number(item.profit ?? 0) < 0
                                ? 'platform-detail-negative'
                                : 'platform-detail-profit'
                            }
                          >
                            {item.profit ? formatMoney(item.profit) : '—'}
                          </b>
                          <Status tone={meta.tone}>{meta.label}</Status>
                          <span className="table-meta">{meta.note}</span>
                        </td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
          {!loading && !error && !page.items.length ? (
            <div className="ops-empty platform-detail-empty">
              <FileSpreadsheet aria-hidden="true" size={25} />
              <b>没有符合条件的平台明细</b>
              <p>调整日期、影楼或成本口径后重试。</p>
            </div>
          ) : null}
        </div>

        <footer className="ops-pagination platform-detail-pagination">
          <span>
            第 {page.total ? page.pageNum + 1 : 0} / {page.pages} 页 · 当前{' '}
            {page.items.length} 条
          </span>
          <div>
            <button
              type="button"
              disabled={loading || pageNum === 0}
              onClick={() => setPageNum((current) => Math.max(0, current - 1))}
            >
              上一页
            </button>
            <button
              type="button"
              disabled={loading || pageNum + 1 >= page.pages}
              onClick={() => setPageNum((current) => current + 1)}
            >
              下一页
            </button>
          </div>
        </footer>
      </Panel>
    </div>
  );
}

function DetailMetric({
  icon: Icon,
  label,
  value,
  note,
  tone = 'default',
}: {
  icon: typeof FileClock;
  label: string;
  value: string;
  note: string;
  tone?: 'default' | 'cost' | 'profit' | 'warning';
}) {
  return (
    <article className={`platform-detail-metric is-${tone}`}>
      <span>
        <Icon aria-hidden="true" size={17} />
      </span>
      <div>
        <small>{label}</small>
        <b>{value}</b>
        <em>{note}</em>
      </div>
    </article>
  );
}

function PlatformDetailSkeleton() {
  return (
    <tr className="platform-detail-skeleton" aria-hidden="true">
      {Array.from({ length: 9 }, (_, index) => (
        <td key={index}>
          <i className="sr-only">正在加载平台明细</i>
          <span />
          <small />
        </td>
      ))}
    </tr>
  );
}

function quickRanges() {
  const current = currentShanghaiMonthRange();
  const currentStart = parseDateKey(current.start);
  const previousEnd = new Date(currentStart);
  previousEnd.setDate(previousEnd.getDate() - 1);
  const previousStart = new Date(
    previousEnd.getFullYear(),
    previousEnd.getMonth(),
    1,
    12,
  );
  const ninetyStart = parseDateKey(current.end);
  ninetyStart.setDate(ninetyStart.getDate() - 89);
  return [
    { label: '本月', ...current },
    {
      label: '上月',
      start: toDateKey(previousStart),
      end: toDateKey(previousEnd),
    },
    { label: '近 90 天', start: toDateKey(ninetyStart), end: current.end },
  ];
}

function currentShanghaiMonthRange() {
  const today = shanghaiTodayKey();
  return { start: `${today.slice(0, 7)}-01`, end: today };
}

function shanghaiTodayKey() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function parseDateKey(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year!, month! - 1, day!, 12);
}

function toDateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function shanghaiDayStart(value: string) {
  return new Date(`${value}T00:00:00+08:00`).toISOString();
}

function shanghaiNextDayStart(value: string) {
  const start = new Date(`${value}T00:00:00+08:00`);
  start.setUTCDate(start.getUTCDate() + 1);
  return start.toISOString();
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function formatMoney(value: string) {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(Number(value));
}

function formatRate(value: string) {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(Number(value));
}

function formatInteger(value: string) {
  return new Intl.NumberFormat('zh-CN').format(Number(value));
}

function apiErrorMessage(error: unknown) {
  if (error instanceof PlatformApiError) {
    return `${error.message}${error.requestId ? `（请求 ${error.requestId}）` : ''}`;
  }
  return error instanceof Error ? error.message : '平台 API 请求失败';
}

'use client';

import { useEffect, useState } from 'react';
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  Clock3,
  Copy,
  Eye,
  FileJson2,
  Fingerprint,
  RefreshCw,
  Search,
  TriangleAlert,
} from 'lucide-react';
import type {
  IntegrationLogDirection,
  IntegrationLogStatus,
  IntegrationLogSystem,
  OperatorIntegrationLog,
  OperatorIntegrationLogDetail,
  OperatorIntegrationLogPage,
} from '@outbound/contracts';
import {
  loadIntegrationLogDetail,
  loadIntegrationLogs,
  PlatformApiError,
} from '@/lib/platform-api';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { UnifiedSelect } from '@/components/ui/unified-select';
import { Panel, Status } from './shared';

const emptyPage: OperatorIntegrationLogPage = {
  total: 0,
  pages: 0,
  pageNum: 0,
  pageSize: 20,
  summary: {
    all: 0,
    succeeded: 0,
    failed: 0,
    pending: 0,
    unknown: 0,
    inbound: 0,
    outbound: 0,
    averageDurationMs: null,
  },
  items: [],
};

const statusMeta: Record<
  IntegrationLogStatus,
  { label: string; tone: 'green' | 'amber' | 'red' | 'gray' }
> = {
  SUCCEEDED: { label: '成功', tone: 'green' },
  PENDING: { label: '处理中', tone: 'amber' },
  FAILED: { label: '失败', tone: 'red' },
  UNKNOWN: { label: '结果未知', tone: 'gray' },
};

const categoryLabels: Record<OperatorIntegrationLog['category'], string> = {
  TASK_INTAKE: '任务受理',
  PROVIDER_OPERATION: '百应编排',
  CALLBACK: '百应回调',
  DELIVERY: '结果投递',
};

export function IntegrationLogConsole() {
  const [keywordDraft, setKeywordDraft] = useState('');
  const [keyword, setKeyword] = useState('');
  const [sourceSystem, setSourceSystem] = useState<
    IntegrationLogSystem | 'ALL'
  >('ALL');
  const [direction, setDirection] = useState<IntegrationLogDirection | 'ALL'>(
    'ALL',
  );
  const [status, setStatus] = useState<IntegrationLogStatus | 'ALL'>('ALL');
  const [pageNum, setPageNum] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(emptyPage);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);
  const [detail, setDetail] = useState<OperatorIntegrationLog | null>(null);
  const [detailPayload, setDetailPayload] =
    useState<OperatorIntegrationLogDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  const openDetail = (item: OperatorIntegrationLog) => {
    setDetail(item);
    setDetailPayload(null);
    setDetailError('');
    setDetailLoading(true);
    void loadIntegrationLogDetail(item.id)
      .then(setDetailPayload)
      .catch((caught) => setDetailError(apiErrorMessage(caught)))
      .finally(() => setDetailLoading(false));
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setKeyword(keywordDraft.trim());
      setPageNum(0);
    }, 260);
    return () => window.clearTimeout(timer);
  }, [keywordDraft]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setLoading(true);
        setError('');
      }
    });
    void loadIntegrationLogs({
      keyword: keyword || undefined,
      sourceSystem: sourceSystem === 'ALL' ? undefined : sourceSystem,
      direction: direction === 'ALL' ? undefined : direction,
      status: status === 'ALL' ? undefined : status,
      pageNum,
      pageSize,
    })
      .then((result) => {
        if (cancelled) return;
        setPage(result);
        if (result.pages && pageNum >= result.pages) {
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
  }, [
    direction,
    keyword,
    pageNum,
    pageSize,
    refreshToken,
    sourceSystem,
    status,
  ]);

  return (
    <div className="integration-console">
      <header className="ops-page-intro integration-intro">
        <div>
          <span>END-TO-END TRACE / FULL CONTEXT</span>
          <h2>接口日志</h2>
          <p>
            统一追踪任务受理、百应编排、供应商回调和 ERP/CRM
            投递；登录管理员可按需查看完整故障上下文。
          </p>
        </div>
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
          刷新链路
        </button>
      </header>

      <section className="integration-summary" aria-label="接口链路汇总">
        <SummaryMetric
          icon={Activity}
          label="全部调用"
          value={`${page.summary.all} 条`}
          note={`${page.summary.succeeded} 成功 · ${page.summary.failed} 失败`}
        />
        <SummaryMetric
          icon={ArrowDownToLine}
          label="流入平台"
          value={`${page.summary.inbound} 条`}
          note="ERP / CRM 任务 · 百应回调"
        />
        <SummaryMetric
          icon={ArrowUpFromLine}
          label="流出平台"
          value={`${page.summary.outbound} 条`}
          note="百应编排 · ERP / CRM 投递"
        />
        <SummaryMetric
          icon={Clock3}
          label="平均耗时"
          value={formatDuration(page.summary.averageDurationMs)}
          note="仅统计已记录耗时的调用"
        />
      </section>

      <Panel
        title="数据库接口调用记录"
        meta={loading ? '正在查询…' : `筛选结果 ${page.total} 条`}
        className="ops-panel integration-panel"
      >
        <div className="integration-redaction-seal">
          <FileJson2 aria-hidden="true" size={14} />
          <span>
            列表保持轻量；点击“详情”后再单独读取完整请求与处理结果，便于定位字段、状态码和回传异常。
          </span>
        </div>
        <div className="ops-toolbar integration-toolbar">
          <label className="search-box ops-search">
            <Search aria-hidden="true" size={15} />
            <input
              value={keywordDraft}
              onChange={(event) => setKeywordDraft(event.target.value)}
              placeholder="搜索请求 ID、任务号、操作或端点"
            />
          </label>
          <UnifiedSelect
            ariaLabel="来源系统"
            value={sourceSystem}
            className="filter-button"
            popupLabel="按来源系统筛选"
            options={[
              { value: 'ALL', label: '全部系统' },
              { value: 'ERP', label: 'ERP' },
              { value: 'CRM', label: 'CRM' },
              { value: 'BAIYING', label: '百应' },
            ]}
            onValueChange={(value) => {
              setSourceSystem(value as IntegrationLogSystem | 'ALL');
              setPageNum(0);
            }}
          />
          <UnifiedSelect
            ariaLabel="调用方向"
            value={direction}
            className="filter-button"
            popupLabel="按调用方向筛选"
            options={[
              { value: 'ALL', label: '全部方向' },
              { value: 'INBOUND', label: '流入平台' },
              { value: 'OUTBOUND', label: '流出平台' },
            ]}
            onValueChange={(value) => {
              setDirection(value as IntegrationLogDirection | 'ALL');
              setPageNum(0);
            }}
          />
          <UnifiedSelect
            ariaLabel="调用状态"
            value={status}
            className="filter-button"
            popupLabel="按调用状态筛选"
            options={[
              { value: 'ALL', label: '全部状态' },
              { value: 'SUCCEEDED', label: '成功' },
              { value: 'PENDING', label: '处理中' },
              { value: 'FAILED', label: '失败' },
              { value: 'UNKNOWN', label: '结果未知' },
            ]}
            onValueChange={(value) => {
              setStatus(value as IntegrationLogStatus | 'ALL');
              setPageNum(0);
            }}
          />
        </div>

        {error ? (
          <div className="ops-error-banner" role="alert">
            <TriangleAlert aria-hidden="true" size={14} />
            {error}
          </div>
        ) : null}

        <div className="table-wrap">
          <table className="data-table integration-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>方向 / 系统</th>
                <th>链路节点</th>
                <th>请求 ID</th>
                <th>任务号</th>
                <th>响应</th>
                <th>耗时</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((item) => (
                <tr key={item.id}>
                  <td>{formatDateTime(item.occurredAt)}</td>
                  <td>
                    <span
                      className={`integration-direction is-${item.direction.toLowerCase()}`}
                    >
                      {item.direction === 'INBOUND' ? '→' : '←'} 平台
                    </span>
                    <small className="table-meta">{item.sourceSystem}</small>
                  </td>
                  <td>
                    <b className="table-primary">{item.operationLabel}</b>
                    <small className="table-meta">
                      {categoryLabels[item.category]}
                      {item.category === 'CALLBACK' ? '接收' : ''} ·{' '}
                      {item.endpointLabel}
                    </small>
                  </td>
                  <td>
                    <code className="integration-request-id">
                      {item.requestId}
                    </code>
                  </td>
                  <td>{item.taskNo ?? '—'}</td>
                  <td>
                    {item.responseStatus ?? '—'}
                    {item.attemptNo ? (
                      <small className="table-meta">
                        第 {item.attemptNo} 次
                      </small>
                    ) : null}
                  </td>
                  <td>{formatDuration(item.durationMs)}</td>
                  <td>
                    <Status tone={statusMeta[item.status].tone}>
                      {statusMeta[item.status].label}
                    </Status>
                    {item.errorCode ? (
                      <small className="integration-error-code">
                        {item.errorCode}
                      </small>
                    ) : null}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="table-action"
                      onClick={() => openDetail(item)}
                    >
                      <Eye aria-hidden="true" size={12} />
                      详情
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && !page.items.length ? (
                <tr>
                  <td colSpan={9}>
                    <div className="monitoring-table-empty">
                      <Fingerprint aria-hidden="true" size={18} />
                      当前筛选条件下没有接口日志
                    </div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <footer className="task-pagination">
          <span>
            第 {page.pages ? pageNum + 1 : 0} / {page.pages} 页 · 共{' '}
            {page.total} 条
          </span>
          <span>
            <UnifiedSelect
              ariaLabel="接口日志每页数量"
              value={String(pageSize)}
              className="filter-button"
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
              className="filter-button"
              disabled={pageNum === 0 || loading}
              onClick={() => setPageNum((current) => current - 1)}
            >
              上一页
            </button>
            <button
              type="button"
              className="filter-button"
              disabled={pageNum + 1 >= page.pages || loading}
              onClick={() => setPageNum((current) => current + 1)}
            >
              下一页
            </button>
          </span>
        </footer>
      </Panel>

      <Dialog
        open={Boolean(detail)}
        onOpenChange={(open) => {
          if (!open) {
            setDetail(null);
            setDetailPayload(null);
            setDetailError('');
          }
        }}
      >
        <DialogContent className="ops-dialog integration-detail-dialog">
          <DialogHeader>
            <DialogTitle>接口调用详情</DialogTitle>
            <DialogDescription>
              完整呈现已保存的请求字段、响应正文与平台处理状态。
            </DialogDescription>
          </DialogHeader>
          {detail ? (
            <IntegrationDetail
              item={detail}
              payload={detailPayload}
              loading={detailLoading}
              error={detailError}
            />
          ) : null}
          <DialogFooter>
            <button
              type="button"
              className="primary-button"
              onClick={() => setDetail(null)}
            >
              关闭
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryMetric({
  icon: Icon,
  label,
  value,
  note,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  note: string;
}) {
  return (
    <article>
      <span>
        <Icon aria-hidden="true" size={15} />
      </span>
      <div>
        <small>{label}</small>
        <b>{value}</b>
        <em>{note}</em>
      </div>
    </article>
  );
}

function IntegrationDetail({
  item,
  payload,
  loading,
  error,
}: {
  item: OperatorIntegrationLog;
  payload: OperatorIntegrationLogDetail | null;
  loading: boolean;
  error: string;
}) {
  const [activePayload, setActivePayload] = useState<'request' | 'response'>(
    'request',
  );
  const fallback = detailFallback(item);
  const selectedValue = payload?.[activePayload] ?? fallback[activePayload];
  return (
    <div className="integration-detail">
      <dl>
        <div>
          <dt>调用时间</dt>
          <dd>{formatDateTime(item.occurredAt, true)}</dd>
        </div>
        <div>
          <dt>状态</dt>
          <dd>{statusMeta[item.status].label}</dd>
        </div>
        <div>
          <dt>来源 / 方向</dt>
          <dd>
            {item.sourceSystem} ·{' '}
            {item.direction === 'INBOUND' ? '流入平台' : '流出平台'}
          </dd>
        </div>
        <div>
          <dt>链路节点</dt>
          <dd>
            {item.operationLabel} · {item.endpointLabel}
          </dd>
        </div>
        <div>
          <dt>请求 ID</dt>
          <dd className="is-code">{item.requestId}</dd>
        </div>
        <div>
          <dt>任务 / 尝试</dt>
          <dd>
            {item.taskNo ?? '未关联任务'} · 第 {item.attemptNo ?? '—'} 次
          </dd>
        </div>
      </dl>
      {item.errorMessage ? (
        <div className="integration-error-detail">
          <TriangleAlert aria-hidden="true" size={14} />
          <div>
            <b>{item.errorCode ?? '调用失败'}</b>
            <p>{item.errorMessage}</p>
          </div>
        </div>
      ) : null}
      <section>
        <header className="integration-payload-heading">
          <span>
            <FileJson2 aria-hidden="true" size={14} />
            请求 / 响应完整字段
          </span>
          {payload ? (
            <em
              className={
                payload.detailLevel === 'FULL' ? 'is-complete' : 'is-snapshot'
              }
            >
              {payload.detailLevel === 'FULL' ? '完整记录' : '历史快照'}
            </em>
          ) : null}
        </header>
        <div className="integration-payload-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activePayload === 'request'}
            className={activePayload === 'request' ? 'is-active' : ''}
            onClick={() => setActivePayload('request')}
          >
            REQUEST 请求字段
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activePayload === 'response'}
            className={activePayload === 'response' ? 'is-active' : ''}
            onClick={() => setActivePayload('response')}
          >
            RESPONSE 响应与处理结果
          </button>
        </div>
        {loading ? (
          <div className="integration-payload-state">正在读取完整字段…</div>
        ) : error ? (
          <div className="integration-payload-state is-error">{error}</div>
        ) : (
          <PayloadDocument
            key={`${item.id}:${activePayload}`}
            label={activePayload === 'request' ? '请求字段' : '响应与处理结果'}
            value={selectedValue}
          />
        )}
        {payload?.note ? (
          <p className="integration-payload-note">{payload.note}</p>
        ) : null}
      </section>
    </div>
  );
}

function PayloadDocument({ label, value }: { label: string; value: unknown }) {
  const [copied, setCopied] = useState(false);
  const text = prettyDetail(value);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  return (
    <article className="integration-payload-document">
      <div>
        <span>{label}</span>
        <button type="button" onClick={copy}>
          {copied ? (
            <Check aria-hidden="true" size={13} />
          ) : (
            <Copy aria-hidden="true" size={13} />
          )}
          {copied ? '已复制' : '复制 JSON'}
        </button>
      </div>
      <pre>{text}</pre>
    </article>
  );
}

function detailFallback(item: OperatorIntegrationLog) {
  return {
    request: normalizeNestedJson(item.detail.request ?? null),
    response: normalizeNestedJson(item.detail.response ?? null),
  };
}

function prettyDetail(value: unknown) {
  const normalized = normalizeNestedJson(value);
  if (normalized === null) return 'null';
  if (typeof normalized === 'string') return normalized;
  if (typeof normalized === 'number' || typeof normalized === 'boolean') {
    return String(normalized);
  }
  if (typeof normalized === 'undefined') return 'undefined';
  return JSON.stringify(normalized, null, 2) ?? '[无法序列化该字段]';
}

function normalizeNestedJson(value: unknown, depth = 0): unknown {
  if (depth > 12) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) {
      return value;
    }
    try {
      return normalizeNestedJson(JSON.parse(trimmed), depth + 1);
    } catch {
      return value;
    }
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeNestedJson(item, depth + 1));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        normalizeNestedJson(child, depth + 1),
      ]),
    );
  }
  return value;
}

function formatDuration(value: number | null) {
  if (value === null) return '—';
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}

function formatDateTime(value: string, includeSeconds = false) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: includeSeconds ? '2-digit' : undefined,
    hour12: false,
  }).format(new Date(value));
}

function apiErrorMessage(caught: unknown) {
  if (caught instanceof PlatformApiError) {
    return caught.requestId
      ? `${caught.message}（请求 ${caught.requestId}）`
      : caught.message;
  }
  return caught instanceof Error ? caught.message : '接口日志读取失败';
}

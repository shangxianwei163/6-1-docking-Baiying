'use client';

import { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Clock3,
  Eye,
  FileClock,
  Fingerprint,
  RefreshCw,
  Search,
  ShieldCheck,
  UsersRound,
} from 'lucide-react';
import type {
  OperatorAuditCategory,
  OperatorAuditEvent,
  OperatorAuditPage,
} from '@outbound/contracts';
import {
  loadOperatorAuditLogs,
  platformActorId,
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

const emptyPage: OperatorAuditPage = {
  total: 0,
  pages: 0,
  pageNum: 0,
  pageSize: 20,
  summary: {
    all: 0,
    today: 0,
    actors: 0,
    financial: 0,
    studio: 0,
    pricing: 0,
    configuration: 0,
    system: 0,
  },
  items: [],
};

const categoryMeta: Record<
  OperatorAuditCategory,
  { label: string; tone: 'green' | 'amber' | 'blue' | 'gray' | 'red' }
> = {
  FINANCIAL: { label: '资金审批', tone: 'amber' },
  STUDIO: { label: '影楼资料', tone: 'green' },
  PRICING: { label: '价格版本', tone: 'blue' },
  CONFIGURATION: { label: '业务配置', tone: 'green' },
  SYSTEM: { label: '系统维护', tone: 'gray' },
};

export function AuditOperationsConsole() {
  const [keywordDraft, setKeywordDraft] = useState('');
  const [keyword, setKeyword] = useState('');
  const [category, setCategory] = useState<OperatorAuditCategory | 'ALL'>(
    'ALL',
  );
  const [pageNum, setPageNum] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(emptyPage);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);
  const [detail, setDetail] = useState<OperatorAuditEvent | null>(null);

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
    void loadOperatorAuditLogs({
      keyword: keyword || undefined,
      category: category === 'ALL' ? undefined : category,
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
  }, [category, keyword, pageNum, pageSize, refreshToken]);

  const refresh = () => setRefreshToken((current) => current + 1);

  return (
    <>
      <header className="ops-page-intro ops-audit-intro">
        <div>
          <span>IMMUTABLE AUDIT / DATABASE</span>
          <h2>操作日志</h2>
          <p>
            管理员变更、资金申请与复核直接读取 PostgreSQL
            审计记录；详情字段经过服务端敏感键脱敏。
          </p>
        </div>
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
          刷新真实日志
        </button>
      </header>

      <section className="ops-metric-grid" aria-label="审计日志汇总">
        <AuditMetric
          icon={Clock3}
          label="今日操作"
          value={`${page.summary.today} 条`}
          note="Asia / Shanghai"
        />
        <AuditMetric
          icon={UsersRound}
          label="可追溯操作人"
          value={`${page.summary.actors} 位`}
          note={`当前 ${platformActorId}`}
        />
        <AuditMetric
          icon={Fingerprint}
          label="资金审计"
          value={`${page.summary.financial} 条`}
          note="充值、申请、批准、拒绝"
        />
        <AuditMetric
          icon={Activity}
          label="配置与价格"
          value={`${page.summary.configuration + page.summary.pricing} 条`}
          note="版本化业务变更"
        />
      </section>

      <Panel
        title="真实审计事件"
        meta={loading ? '正在读取数据库…' : `共 ${page.total} 条`}
        className="ops-panel ops-audit-panel"
      >
        <div className="ops-audit-seal">
          <ShieldCheck aria-hidden="true" size={14} />
          <span>
            审计记录只追加；页面不会从业务表反推或生成模拟操作。敏感键在 API
            层统一替换为“已脱敏”。
          </span>
        </div>
        <div className="ops-toolbar">
          <label className="search-box ops-search">
            <Search aria-hidden="true" size={15} />
            <input
              value={keywordDraft}
              onChange={(event) => setKeywordDraft(event.target.value)}
              placeholder="搜索操作人、动作、对象、请求 ID 或详情"
            />
          </label>
          <UnifiedSelect
            ariaLabel="审计日志分类"
            value={category}
            className="filter-button"
            popupLabel="按审计分类筛选"
            options={[
              { value: 'ALL', label: '全部审计分类' },
              ...Object.entries(categoryMeta).map(([value, meta]) => ({
                value,
                label: meta.label,
              })),
            ]}
            onValueChange={(value) => {
              setCategory(value as OperatorAuditCategory | 'ALL');
              setPageNum(0);
            }}
          />
          <UnifiedSelect
            ariaLabel="审计日志每页数量"
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
        </div>

        {error ? (
          <div className="ops-feedback is-error" role="alert">
            <AlertTriangle aria-hidden="true" size={15} />
            <div>
              <b>操作日志读取失败</b>
              <span>{error}</span>
            </div>
            <button type="button" onClick={refresh}>
              重试
            </button>
          </div>
        ) : null}

        <div className="table-wrap ops-table-wrap" aria-busy={loading}>
          <table className="data-table ops-audit-table">
            <caption className="sr-only">真实操作审计日志</caption>
            <thead>
              <tr>
                <th>发生时间</th>
                <th>操作人</th>
                <th>操作</th>
                <th>业务对象</th>
                <th>请求 ID</th>
                <th>详情摘要</th>
                <th>结果</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {loading && !page.items.length
                ? Array.from({ length: 5 }, (_, index) => (
                    <SkeletonRow key={index} />
                  ))
                : page.items.map((item) => {
                    const meta = categoryMeta[item.category];
                    return (
                      <tr key={item.id}>
                        <td>
                          <b>{formatTime(item.occurredAt)}</b>
                          <span className="table-meta">
                            {formatDate(item.occurredAt)}
                          </span>
                        </td>
                        <td>
                          <b>{item.actorId}</b>
                          <span className="table-meta">可审计身份</span>
                        </td>
                        <td>
                          <Status tone={meta.tone}>{meta.label}</Status>
                          <b className="table-meta ops-audit-action">
                            {item.actionLabel}
                          </b>
                        </td>
                        <td>
                          <b>{item.objectLabel}</b>
                          <code className="table-meta">{item.objectType}</code>
                        </td>
                        <td>
                          <code
                            className="ops-request-id"
                            title={item.requestId}
                          >
                            {shortId(item.requestId)}
                          </code>
                        </td>
                        <td>
                          <span className="ops-audit-summary">
                            {detailSummary(item.detail)}
                          </span>
                        </td>
                        <td>
                          <Status tone="green">已落库</Status>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="ops-table-action"
                            aria-label={`查看 ${item.actionLabel} 审计详情`}
                            onClick={() => setDetail(item)}
                          >
                            <Eye aria-hidden="true" size={11} />
                            详情
                          </button>
                        </td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
          {!loading && !error && !page.items.length ? (
            <div className="ops-empty">
              <FileClock aria-hidden="true" size={24} />
              <b>没有符合条件的审计事件</b>
              <p>调整分类或关键词；成功写入的运营变更会自动出现在这里。</p>
            </div>
          ) : null}
        </div>
        <footer className="ops-pagination">
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

      <AuditDetailDialog event={detail} onClose={() => setDetail(null)} />
    </>
  );
}

function AuditDetailDialog({
  event,
  onClose,
}: {
  event: OperatorAuditEvent | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={Boolean(event)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="ops-dialog ops-audit-dialog">
        <DialogHeader>
          <span className="ops-dialog-kicker">AUDIT EVIDENCE</span>
          <DialogTitle>{event?.actionLabel ?? '审计事件详情'}</DialogTitle>
          <DialogDescription>
            {event
              ? `${event.actorId} · ${formatDateTime(event.occurredAt)} · 已持久化`
              : '正在读取'}
          </DialogDescription>
        </DialogHeader>
        {event ? (
          <div className="ops-audit-detail">
            <dl>
              <AuditPair label="事件 ID" value={event.id} code />
              <AuditPair label="请求 ID" value={event.requestId} code />
              <AuditPair label="动作代码" value={event.action} code />
              <AuditPair label="对象类型" value={event.objectType} code />
              <AuditPair label="对象标识" value={event.objectId} code />
              <AuditPair
                label="审计分类"
                value={categoryMeta[event.category].label}
              />
            </dl>
            <section>
              <header>
                <ShieldCheck aria-hidden="true" size={14} />
                <b>服务端脱敏详情</b>
              </header>
              <div>
                {Object.entries(event.detail).length ? (
                  Object.entries(event.detail).map(([key, value]) => (
                    <p key={key}>
                      <code>{key}</code>
                      <span>{String(value ?? 'null')}</span>
                    </p>
                  ))
                ) : (
                  <p className="ops-audit-detail-empty">该事件没有附加字段</p>
                )}
              </div>
            </section>
          </div>
        ) : null}
        <DialogFooter>
          <button type="button" className="primary-button" onClick={onClose}>
            关闭详情
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AuditMetric({
  icon: Icon,
  label,
  value,
  note,
}: {
  icon: typeof Clock3;
  label: string;
  value: string;
  note: string;
}) {
  return (
    <article className="ops-metric-card">
      <span>
        <Icon aria-hidden="true" size={16} />
      </span>
      <div>
        <small>{label}</small>
        <b>{value}</b>
        <em>{note}</em>
      </div>
    </article>
  );
}

function AuditPair({
  label,
  value,
  code = false,
}: {
  label: string;
  value: string;
  code?: boolean;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={code ? 'is-code' : undefined}>{value}</dd>
    </div>
  );
}

function SkeletonRow() {
  return (
    <tr className="ops-skeleton">
      {Array.from({ length: 8 }, (_, index) => (
        <td aria-label="正在加载" key={index}>
          <i />
        </td>
      ))}
    </tr>
  );
}

function detailSummary(detail: OperatorAuditEvent['detail']) {
  const entries = Object.entries(detail).slice(0, 2);
  if (!entries.length) return '无附加字段';
  return entries
    .map(([key, value]) => `${key}: ${String(value ?? 'null')}`)
    .join(' · ');
}

function shortId(value: string) {
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
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
  return `${formatDate(value)} ${formatTime(value)}`;
}

function apiErrorMessage(error: unknown) {
  if (error instanceof PlatformApiError) {
    return `${error.message}${error.requestId ? `（请求 ${error.requestId}）` : ''}`;
  }
  return error instanceof Error ? error.message : '平台 API 请求失败';
}

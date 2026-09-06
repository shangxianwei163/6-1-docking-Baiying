'use client';

import { useEffect, useState } from 'react';
import {
  ArchiveX,
  CircleCheck,
  Eye,
  Inbox,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  TriangleAlert,
} from 'lucide-react';
import type {
  OperatorDeadLetter,
  OperatorDeadLetterPage,
  OperatorDeadLetterSourceType,
  OperatorDeadLetterStatus,
} from '@outbound/contracts';
import {
  ignoreDeadLetter,
  loadDeadLetters,
  PlatformApiError,
  replayDeadLetter,
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

const emptyPage: OperatorDeadLetterPage = {
  total: 0,
  pages: 0,
  pageNum: 0,
  pageSize: 20,
  summary: {
    all: 0,
    open: 0,
    replaying: 0,
    resolved: 0,
    ignored: 0,
    outbox: 0,
    callback: 0,
    recording: 0,
    delivery: 0,
  },
  items: [],
};

const statusMeta: Record<
  OperatorDeadLetterStatus,
  { label: string; tone: 'red' | 'amber' | 'green' | 'gray' }
> = {
  OPEN: { label: '待处理', tone: 'red' },
  REPLAYING: { label: '重放中', tone: 'amber' },
  RESOLVED: { label: '已解决', tone: 'green' },
  IGNORED: { label: '已忽略', tone: 'gray' },
};

export function RecoveryOperationsConsole() {
  const [keywordDraft, setKeywordDraft] = useState('');
  const [keyword, setKeyword] = useState('');
  const [sourceType, setSourceType] = useState<
    OperatorDeadLetterSourceType | 'ALL'
  >('ALL');
  const [status, setStatus] = useState<OperatorDeadLetterStatus | 'ALL'>('ALL');
  const [pageNum, setPageNum] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(emptyPage);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);
  const [detail, setDetail] = useState<OperatorDeadLetter | null>(null);

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
    void loadDeadLetters({
      keyword: keyword || undefined,
      sourceType: sourceType === 'ALL' ? undefined : sourceType,
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
        setDetail((current) =>
          current
            ? (result.items.find((item) => item.id === current.id) ?? current)
            : current,
        );
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
  }, [keyword, pageNum, pageSize, refreshToken, sourceType, status]);

  return (
    <div className="recovery-console">
      <header className="ops-page-intro recovery-intro">
        <div>
          <span>RECOVERY CONTROL / AUDITED</span>
          <h2>异常中心</h2>
          <p>
            查看处理耗尽的队列、回调、录音与回传事件；人工重放和忽略均要求填写原因并写入审计。
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
          刷新异常
        </button>
      </header>

      <section className="recovery-summary" aria-label="死信处理汇总">
        <RecoveryMetric
          icon={ShieldAlert}
          label="待人工处理"
          value={page.summary.open}
          note={`${page.summary.replaying} 条正在重放`}
          tone="red"
        />
        <RecoveryMetric
          icon={Inbox}
          label="队列 / 回调"
          value={page.summary.outbox + page.summary.callback}
          note={`${page.summary.outbox} 队列 · ${page.summary.callback} 回调`}
          tone="amber"
        />
        <RecoveryMetric
          icon={ArchiveX}
          label="录音 / 回传"
          value={page.summary.recording + page.summary.delivery}
          note={`${page.summary.recording} 录音 · ${page.summary.delivery} 回传`}
          tone="blue"
        />
        <RecoveryMetric
          icon={CircleCheck}
          label="已归档处理"
          value={page.summary.resolved + page.summary.ignored}
          note={`${page.summary.resolved} 解决 · ${page.summary.ignored} 忽略`}
          tone="green"
        />
      </section>

      <Panel
        title="死信事件"
        meta={loading ? '正在读取…' : `筛选结果 ${page.total} 条`}
        className="ops-panel recovery-panel"
      >
        <div className="recovery-guardrail">
          <ShieldAlert aria-hidden="true" size={14} />
          <span>
            重放会恢复原事件，不会复制业务记录；Callback
            原始正文仍保持加密，页面只显示脱敏摘要。
          </span>
        </div>
        <div className="ops-toolbar recovery-toolbar">
          <label className="search-box ops-search">
            <Search aria-hidden="true" size={15} />
            <input
              value={keywordDraft}
              onChange={(event) => setKeywordDraft(event.target.value)}
              placeholder="搜索任务号、事件类型、错误或处理建议"
            />
          </label>
          <UnifiedSelect
            ariaLabel="死信来源"
            value={sourceType}
            className="filter-button"
            popupLabel="按死信来源筛选"
            options={[
              { value: 'ALL', label: '全部来源' },
              { value: 'OUTBOX', label: '队列事件' },
              { value: 'CALLBACK', label: '百应回调' },
              { value: 'RECORDING', label: '录音归档' },
              { value: 'DELIVERY', label: 'ERP/CRM 回传' },
            ]}
            onValueChange={(value) => {
              setSourceType(value as OperatorDeadLetterSourceType | 'ALL');
              setPageNum(0);
            }}
          />
          <UnifiedSelect
            ariaLabel="死信状态"
            value={status}
            className="filter-button"
            popupLabel="按死信状态筛选"
            options={[
              { value: 'ALL', label: '全部状态' },
              { value: 'OPEN', label: '待处理' },
              { value: 'REPLAYING', label: '重放中' },
              { value: 'RESOLVED', label: '已解决' },
              { value: 'IGNORED', label: '已忽略' },
            ]}
            onValueChange={(value) => {
              setStatus(value as OperatorDeadLetterStatus | 'ALL');
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
          <table className="data-table recovery-table">
            <thead>
              <tr>
                <th>发现时间</th>
                <th>来源</th>
                <th>事件 / 任务</th>
                <th>最终错误</th>
                <th>原记录状态</th>
                <th>重放次数</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((item) => (
                <tr key={item.id}>
                  <td>{formatDateTime(item.createdAt)}</td>
                  <td>
                    <b className="table-primary">{item.sourceLabel}</b>
                    <small className="table-meta">{item.sourceType}</small>
                  </td>
                  <td>
                    <code className="recovery-event-type">
                      {item.eventType ?? '未识别事件'}
                    </code>
                    <small className="table-meta">
                      {item.taskNo ?? item.sourceId}
                    </small>
                  </td>
                  <td>
                    <span className="recovery-error-copy">
                      {item.finalError}
                    </span>
                  </td>
                  <td>{item.sourceStatus ?? '记录缺失'}</td>
                  <td>{item.replayCount}</td>
                  <td>
                    <Status tone={statusMeta[item.status].tone}>
                      {statusMeta[item.status].label}
                    </Status>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="table-action"
                      onClick={() => setDetail(item)}
                    >
                      <Eye aria-hidden="true" size={12} />
                      处置
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && !page.items.length ? (
                <tr>
                  <td colSpan={8}>
                    <div className="monitoring-table-empty">
                      <CircleCheck aria-hidden="true" size={18} />
                      当前筛选条件下没有死信事件
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
              ariaLabel="死信每页数量"
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

      <RecoveryDialog
        key={detail?.id ?? 'closed'}
        item={detail}
        onClose={() => setDetail(null)}
        onChanged={(updated) => {
          setDetail(updated);
          setRefreshToken((current) => current + 1);
        }}
      />
    </div>
  );
}

function RecoveryMetric({
  icon: Icon,
  label,
  value,
  note,
  tone,
}: {
  icon: typeof ShieldAlert;
  label: string;
  value: number;
  note: string;
  tone: 'red' | 'amber' | 'blue' | 'green';
}) {
  return (
    <article className={`recovery-metric is-${tone}`}>
      <span>
        <Icon aria-hidden="true" size={16} />
      </span>
      <div>
        <small>{label}</small>
        <b>{value.toLocaleString('zh-CN')}</b>
        <em>{note}</em>
      </div>
    </article>
  );
}

function RecoveryDialog({
  item,
  onClose,
  onChanged,
}: {
  item: OperatorDeadLetter | null;
  onClose: () => void;
  onChanged: (item: OperatorDeadLetter) => void;
}) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState<'REPLAY' | 'IGNORE' | null>(
    null,
  );
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const act = async (action: 'REPLAY' | 'IGNORE') => {
    if (!item || reason.trim().length < 2) {
      setError('请填写至少 2 个字的处置原因');
      return;
    }
    setSubmitting(action);
    setError('');
    setMessage('');
    try {
      const input = {
        reason: reason.trim(),
        idempotencyKey: window.crypto.randomUUID(),
      };
      const result =
        action === 'REPLAY'
          ? await replayDeadLetter(item.id, input)
          : await ignoreDeadLetter(item.id, input);
      setMessage(result.message);
      onChanged(result.deadLetter);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <Dialog open={Boolean(item)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="ops-dialog recovery-detail-dialog">
        <DialogHeader>
          <DialogTitle>异常处置</DialogTitle>
          <DialogDescription>
            恢复的是原记录，不会生成一份无法追踪的副本。
          </DialogDescription>
        </DialogHeader>
        {item ? (
          <div className="recovery-detail">
            <div className="recovery-detail-heading">
              <div>
                <span>{item.sourceLabel}</span>
                <b>{item.eventType ?? item.sourceId}</b>
                <small>{item.taskNo ?? item.sourceId}</small>
              </div>
              <Status tone={statusMeta[item.status].tone}>
                {statusMeta[item.status].label}
              </Status>
            </div>
            <section className="recovery-error-card">
              <TriangleAlert aria-hidden="true" size={15} />
              <div>
                <b>最终错误</b>
                <p>{item.finalError}</p>
                <small>
                  {item.suggestedAction ?? '请确认根因已消除后再重放'}
                </small>
              </div>
            </section>
            <dl className="recovery-detail-facts">
              <div>
                <dt>原记录状态</dt>
                <dd>{item.sourceStatus ?? '记录缺失'}</dd>
              </div>
              <div>
                <dt>重放次数</dt>
                <dd>{item.replayCount}</dd>
              </div>
              <div>
                <dt>发现时间</dt>
                <dd>{formatDateTime(item.createdAt, true)}</dd>
              </div>
              <div>
                <dt>解决信息</dt>
                <dd>{item.resolutionNote ?? '尚未解决'}</dd>
              </div>
            </dl>
            <section className="recovery-summary-detail">
              <header>脱敏原事件摘要</header>
              <div>
                {Object.entries(item.originalSummary).map(([key, value]) => (
                  <p key={key}>
                    <span>{key}</span>
                    <code>{pretty(value)}</code>
                  </p>
                ))}
              </div>
            </section>
            {item.status === 'OPEN' ? (
              <label className="ops-field recovery-reason">
                <span>处置原因</span>
                <textarea
                  value={reason}
                  maxLength={500}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="例如：已修复回调字段兼容问题，批准重放原事件"
                />
              </label>
            ) : null}
            {error ? (
              <div className="ops-error-banner" role="alert">
                <TriangleAlert aria-hidden="true" size={13} />
                {error}
              </div>
            ) : null}
            {message ? (
              <output className="recovery-success-banner">
                <CircleCheck aria-hidden="true" size={13} />
                {message}
              </output>
            ) : null}
          </div>
        ) : null}
        <DialogFooter className="recovery-dialog-actions">
          {item?.status === 'OPEN' ? (
            <>
              <button
                type="button"
                className="secondary-button is-danger"
                disabled={Boolean(submitting)}
                onClick={() => void act('IGNORE')}
              >
                <ArchiveX aria-hidden="true" size={13} />
                {submitting === 'IGNORE' ? '正在归档…' : '标记忽略'}
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={Boolean(submitting) || !item.replayable}
                title={item.replayBlockedReason ?? undefined}
                onClick={() => void act('REPLAY')}
              >
                <RotateCcw aria-hidden="true" size={13} />
                {submitting === 'REPLAY' ? '正在恢复…' : '重放原事件'}
              </button>
            </>
          ) : (
            <button type="button" className="primary-button" onClick={onClose}>
              关闭
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function pretty(value: string | number | boolean | null) {
  if (typeof value !== 'string') return String(value);
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function formatDateTime(value: string, seconds = false) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: seconds ? '2-digit' : undefined,
    hour12: false,
  }).format(new Date(value));
}

function apiErrorMessage(caught: unknown) {
  if (caught instanceof PlatformApiError) {
    return caught.requestId
      ? `${caught.message}（请求 ${caught.requestId}）`
      : caught.message;
  }
  return caught instanceof Error ? caught.message : '异常中心请求失败';
}

'use client';

import { useEffect, useState, type KeyboardEvent } from 'react';
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
  TaskReconciliation,
  TaskReconciliationPage,
  TaskReconciliationStatus,
} from '@outbound/contracts';
import {
  ignoreDeadLetter,
  loadDeadLetters,
  loadTaskReconciliations,
  PlatformApiError,
  repairTaskReconciliation,
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

const emptyReconciliationPage: TaskReconciliationPage = {
  total: 0,
  pages: 0,
  pageNum: 0,
  pageSize: 20,
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

const reconciliationStatusMeta: Record<
  TaskReconciliationStatus,
  { label: string; tone: 'red' | 'amber' | 'green' | 'gray' }
> = {
  PENDING: { label: '待核对', tone: 'gray' },
  RUNNING: { label: '核对中', tone: 'amber' },
  STABLE_ONCE: { label: '一次稳定', tone: 'amber' },
  RECONCILED: { label: '已一致', tone: 'green' },
  MANUAL_REVIEW: { label: '人工复核', tone: 'red' },
  FAILED: { label: '核对失败', tone: 'red' },
};

type RecoveryScope = 'RECONCILIATION' | 'DEAD_LETTERS';

export function RecoveryOperationsConsole() {
  const [scope, setScope] = useState<RecoveryScope>('RECONCILIATION');
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
  const [reconciliationPage, setReconciliationPage] = useState(
    emptyReconciliationPage,
  );
  const [reconciliationStatus, setReconciliationStatus] = useState<
    TaskReconciliationStatus | 'ALL'
  >('ALL');
  const [reconciliationLoading, setReconciliationLoading] = useState(true);
  const [reconciliationError, setReconciliationError] = useState('');
  const [reconciliationDetail, setReconciliationDetail] =
    useState<TaskReconciliation | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setReconciliationLoading(true);
        setReconciliationError('');
      }
    });
    void loadTaskReconciliations({
      status: reconciliationStatus === 'ALL' ? undefined : reconciliationStatus,
      pageSize: 20,
    })
      .then((result) => {
        if (cancelled) return;
        setReconciliationPage(result);
        setReconciliationDetail((current) =>
          current
            ? (result.items.find((item) => item.taskId === current.taskId) ??
              current)
            : current,
        );
      })
      .catch((caught) => {
        if (!cancelled) setReconciliationError(apiErrorMessage(caught));
      })
      .finally(() => {
        if (!cancelled) setReconciliationLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reconciliationStatus, refreshToken]);

  const activeLoading =
    scope === 'RECONCILIATION' ? reconciliationLoading : loading;
  const handleScopeKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    let nextScope: RecoveryScope | null = null;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      nextScope =
        scope === 'RECONCILIATION' ? 'DEAD_LETTERS' : 'RECONCILIATION';
    } else if (event.key === 'Home') {
      nextScope = 'RECONCILIATION';
    } else if (event.key === 'End') {
      nextScope = 'DEAD_LETTERS';
    }
    if (!nextScope) return;
    event.preventDefault();
    setScope(nextScope);
    window.requestAnimationFrame(() => {
      document
        .getElementById(
          nextScope === 'RECONCILIATION'
            ? 'recovery-tab-reconciliation'
            : 'recovery-tab-dead-letters',
        )
        ?.focus();
    });
  };

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
          disabled={activeLoading}
          onClick={() => setRefreshToken((current) => current + 1)}
        >
          <RefreshCw
            aria-hidden="true"
            className={activeLoading ? 'is-spinning' : ''}
            size={14}
          />
          刷新异常
        </button>
      </header>

      <div
        className="recovery-scope-tabs"
        role="tablist"
        aria-label="异常中心功能分类"
      >
        <button
          id="recovery-tab-reconciliation"
          type="button"
          role="tab"
          aria-selected={scope === 'RECONCILIATION'}
          aria-controls="recovery-panel-reconciliation"
          tabIndex={scope === 'RECONCILIATION' ? 0 : -1}
          className={scope === 'RECONCILIATION' ? 'is-active' : ''}
          onClick={() => setScope('RECONCILIATION')}
          onKeyDown={handleScopeKeyDown}
        >
          <span>
            <RefreshCw aria-hidden="true" size={17} />
          </span>
          <span>
            <b>通话记录核对</b>
            <small>平台记录 · 百应完成记录 · Inbox 三方核验</small>
          </span>
          <em>{reconciliationPage.total} 个任务</em>
        </button>
        <button
          id="recovery-tab-dead-letters"
          type="button"
          role="tab"
          aria-selected={scope === 'DEAD_LETTERS'}
          aria-controls="recovery-panel-dead-letters"
          tabIndex={scope === 'DEAD_LETTERS' ? 0 : -1}
          className={scope === 'DEAD_LETTERS' ? 'is-active' : ''}
          onClick={() => setScope('DEAD_LETTERS')}
          onKeyDown={handleScopeKeyDown}
        >
          <span>
            <ShieldAlert aria-hidden="true" size={17} />
          </span>
          <span>
            <b>死信事件</b>
            <small>异常重放 · 人工忽略 · 全程审计</small>
          </span>
          <em>{page.total} 条事件</em>
        </button>
      </div>

      {scope === 'RECONCILIATION' ? (
        <section
          id="recovery-panel-reconciliation"
          className="recovery-tab-panel"
          role="tabpanel"
          aria-labelledby="recovery-tab-reconciliation"
          tabIndex={0}
        >
          <Panel
            title="通话记录核对"
            meta={
              reconciliationLoading
                ? '正在读取…'
                : `${reconciliationPage.total} 个任务`
            }
            className="ops-panel recovery-panel reconciliation-panel"
          >
            <div className="recovery-guardrail reconciliation-guardrail">
              <RefreshCw aria-hidden="true" size={14} />
              <span>
                系统按百应完成通话接口逐页补偿，每页最多 500
                条；连续两轮数量一致且 Inbox 已排空才会标记完成。持续不一致 15
                分钟后进入人工复核。
              </span>
            </div>
            <div className="ops-toolbar recovery-toolbar reconciliation-toolbar">
              <div className="reconciliation-toolbar-copy">
                <b>漏回调核对队列</b>
                <small>平台记录 / 百应记录 / 待处理 Inbox 三方比对</small>
              </div>
              <UnifiedSelect
                ariaLabel="核对状态"
                value={reconciliationStatus}
                className="filter-button"
                popupLabel="按核对状态筛选"
                options={[
                  { value: 'ALL', label: '全部核对状态' },
                  { value: 'MANUAL_REVIEW', label: '人工复核' },
                  { value: 'FAILED', label: '核对失败' },
                  { value: 'RUNNING', label: '核对中' },
                  { value: 'STABLE_ONCE', label: '一次稳定' },
                  { value: 'RECONCILED', label: '已一致' },
                  { value: 'PENDING', label: '待核对' },
                ]}
                onValueChange={(value) =>
                  setReconciliationStatus(
                    value as TaskReconciliationStatus | 'ALL',
                  )
                }
              />
            </div>

            {reconciliationError ? (
              <div className="ops-error-banner" role="alert">
                <TriangleAlert aria-hidden="true" size={14} />
                {reconciliationError}
              </div>
            ) : null}

            <div className="table-wrap">
              <table className="data-table recovery-table reconciliation-table">
                <thead>
                  <tr>
                    <th>任务</th>
                    <th>核对状态</th>
                    <th>计划号码</th>
                    <th>百应完成</th>
                    <th>平台记录</th>
                    <th>待处理 Inbox</th>
                    <th>稳定轮次</th>
                    <th>最后核对</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {reconciliationPage.items.map((item) => (
                    <tr key={item.taskId}>
                      <td>
                        <b className="table-primary">{item.taskName}</b>
                        <small className="table-meta">{item.taskNo}</small>
                      </td>
                      <td>
                        <Status
                          tone={reconciliationStatusMeta[item.status].tone}
                        >
                          {reconciliationStatusMeta[item.status].label}
                        </Status>
                      </td>
                      <td>{item.expectedCallCount}</td>
                      <td>{item.providerCallCount ?? '—'}</td>
                      <td>{item.platformCallCount}</td>
                      <td>{item.pendingInboxCount}</td>
                      <td>{item.stableRounds} / 2</td>
                      <td>
                        {item.lastCheckedAt
                          ? formatDateTime(item.lastCheckedAt)
                          : '尚未核对'}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="table-action"
                          onClick={() => setReconciliationDetail(item)}
                        >
                          <Eye aria-hidden="true" size={12} />
                          查看 / 修复
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!reconciliationLoading &&
                  !reconciliationPage.items.length ? (
                    <tr>
                      <td colSpan={9}>
                        <div className="monitoring-table-empty">
                          <CircleCheck aria-hidden="true" size={18} />
                          当前筛选条件下没有待核对任务
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Panel>
        </section>
      ) : null}

      {scope === 'DEAD_LETTERS' ? (
        <section
          id="recovery-panel-dead-letters"
          className="recovery-tab-panel"
          role="tabpanel"
          aria-labelledby="recovery-tab-dead-letters"
          tabIndex={0}
        >
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
        </section>
      ) : null}

      <RecoveryDialog
        key={detail?.id ?? 'closed'}
        item={detail}
        onClose={() => setDetail(null)}
        onChanged={(updated) => {
          setDetail(updated);
          setRefreshToken((current) => current + 1);
        }}
      />
      <ReconciliationDialog
        key={reconciliationDetail?.taskId ?? 'reconciliation-closed'}
        item={reconciliationDetail}
        onClose={() => setReconciliationDetail(null)}
        onChanged={(updated) => {
          setReconciliationDetail(updated);
          setRefreshToken((current) => current + 1);
        }}
      />
    </div>
  );
}

function ReconciliationDialog({
  item,
  onClose,
  onChanged,
}: {
  item: TaskReconciliation | null;
  onClose: () => void;
  onChanged: (item: TaskReconciliation) => void;
}) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const repairable =
    item?.status === 'MANUAL_REVIEW' || item?.status === 'FAILED';

  const repair = async () => {
    if (!item || reason.trim().length < 8) {
      setError('请填写至少 8 个字的核对结论或修复原因');
      return;
    }
    setSubmitting(true);
    setError('');
    setMessage('');
    try {
      const result = await repairTaskReconciliation(item.taskNo, {
        reason: reason.trim(),
        idempotencyKey: window.crypto.randomUUID(),
      });
      setMessage(
        `${result.message}；恢复 ${result.replayedInboxCount} 条 Inbox`,
      );
      onChanged(result.reconciliation);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={Boolean(item)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="ops-dialog recovery-detail-dialog">
        <DialogHeader>
          <DialogTitle>通话记录核对</DialogTitle>
          <DialogDescription>
            查看百应与平台记录差异；人工修复会恢复失败 Inbox
            并安排立即重新分页核对。
          </DialogDescription>
        </DialogHeader>
        {item ? (
          <div className="recovery-detail reconciliation-detail">
            <div className="recovery-detail-heading">
              <div>
                <span>CALL RECORD RECONCILIATION</span>
                <b>{item.taskName}</b>
                <small>{item.taskNo}</small>
              </div>
              <Status tone={reconciliationStatusMeta[item.status].tone}>
                {reconciliationStatusMeta[item.status].label}
              </Status>
            </div>
            {item.lastError ? (
              <section className="recovery-error-card">
                <TriangleAlert aria-hidden="true" size={15} />
                <div>
                  <b>核对问题</b>
                  <p>{item.lastError}</p>
                  <small>
                    {item.mismatchSince
                      ? `差异始于 ${formatDateTime(item.mismatchSince, true)}`
                      : '系统会按退避策略自动重试'}
                  </small>
                </div>
              </section>
            ) : null}
            <dl className="recovery-detail-facts reconciliation-facts">
              <div>
                <dt>计划号码</dt>
                <dd>{item.expectedCallCount}</dd>
              </div>
              <div>
                <dt>百应完成</dt>
                <dd>{item.providerCallCount ?? '尚未返回'}</dd>
              </div>
              <div>
                <dt>平台记录</dt>
                <dd>{item.platformCallCount}</dd>
              </div>
              <div>
                <dt>待处理 Inbox</dt>
                <dd>{item.pendingInboxCount}</dd>
              </div>
              <div>
                <dt>稳定轮次</dt>
                <dd>{item.stableRounds} / 2</dd>
              </div>
              <div>
                <dt>失败次数</dt>
                <dd>{item.failureAttempts}</dd>
              </div>
              <div>
                <dt>修复次数</dt>
                <dd>{item.repairCount}</dd>
              </div>
              <div>
                <dt>最后核对</dt>
                <dd>
                  {item.lastCheckedAt
                    ? formatDateTime(item.lastCheckedAt, true)
                    : '尚未核对'}
                </dd>
              </div>
            </dl>
            {repairable ? (
              <label className="ops-field recovery-reason">
                <span>人工核对结论 / 修复原因</span>
                <textarea
                  value={reason}
                  maxLength={500}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="例如：已确认百应任务结束，批准恢复失败回调并重新分页补偿"
                />
              </label>
            ) : (
              <div className="reconciliation-passive-note">
                当前状态由 Worker 自动推进，无需人工操作。
              </div>
            )}
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
          <button type="button" className="secondary-button" onClick={onClose}>
            关闭
          </button>
          {repairable ? (
            <button
              type="button"
              className="primary-button"
              disabled={submitting}
              onClick={() => void repair()}
            >
              <RotateCcw aria-hidden="true" size={13} />
              {submitting ? '正在安排修复…' : '恢复并立即复查'}
            </button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

'use client';

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  ClipboardCheck,
  FilePenLine,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import type {
  AccountAdjustmentKind,
  AccountAdjustmentStatus,
  OperatorAccountAdjustment,
  OperatorAccountAdjustmentPage,
  OperatorStudio,
} from '@outbound/contracts';
import {
  createAccountAdjustment,
  decideAccountAdjustment,
  loadAccountAdjustments,
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

const emptyPage: OperatorAccountAdjustmentPage = {
  total: 0,
  pages: 0,
  pageNum: 0,
  pageSize: 20,
  summary: {
    all: 0,
    pending: 0,
    approved: 0,
    rejected: 0,
    pendingCreditAmount: '0.000000',
    pendingDebitAmount: '0.000000',
  },
  items: [],
};

const kindMeta: Record<
  AccountAdjustmentKind,
  {
    label: string;
    shortLabel: string;
    direction: 'CREDIT' | 'DEBIT';
    tone: 'green' | 'red' | 'amber';
  }
> = {
  REFUND: {
    label: '客户退款（扣减余额）',
    shortLabel: '客户退款',
    direction: 'DEBIT',
    tone: 'red',
  },
  ADJUSTMENT_CREDIT: {
    label: '人工补账（增加余额）',
    shortLabel: '人工补账',
    direction: 'CREDIT',
    tone: 'green',
  },
  ADJUSTMENT_DEBIT: {
    label: '人工冲减（扣减余额）',
    shortLabel: '人工冲减',
    direction: 'DEBIT',
    tone: 'amber',
  },
};

const statusMeta: Record<
  AccountAdjustmentStatus,
  { label: string; tone: 'amber' | 'green' | 'red' }
> = {
  PENDING: { label: '待他人复核', tone: 'amber' },
  APPROVED: { label: '已批准入账', tone: 'green' },
  REJECTED: { label: '已拒绝', tone: 'red' },
};

export function AccountAdjustmentConsole({
  studios,
  onLedgerChanged,
}: {
  studios: OperatorStudio[];
  onLedgerChanged: () => void;
}) {
  const [keywordDraft, setKeywordDraft] = useState('');
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<AccountAdjustmentStatus | 'ALL'>(
    'PENDING',
  );
  const [kind, setKind] = useState<AccountAdjustmentKind | 'ALL'>('ALL');
  const [pageNum, setPageNum] = useState(0);
  const [page, setPage] = useState(emptyPage);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [reviewTarget, setReviewTarget] =
    useState<OperatorAccountAdjustment | null>(null);

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
    void loadAccountAdjustments({
      keyword: keyword || undefined,
      status: status === 'ALL' ? undefined : status,
      kind: kind === 'ALL' ? undefined : kind,
      pageNum,
      pageSize: 20,
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
  }, [keyword, kind, pageNum, refreshToken, status]);

  const refresh = () => setRefreshToken((current) => current + 1);

  return (
    <>
      {feedback ? (
        <output className="ops-feedback is-success">
          <CheckCircle2 aria-hidden="true" size={16} />
          <span>{feedback}</span>
          <button type="button" onClick={() => setFeedback('')}>
            关闭
          </button>
        </output>
      ) : null}

      <Panel
        title="退款与人工调整审批"
        meta={`${page.summary.pending} 笔待复核 · 当前操作人 ${platformActorId}`}
        className="ops-panel ops-approval-panel"
      >
        <div className="ops-approval-guardrail">
          <div>
            <ShieldCheck aria-hidden="true" size={17} />
            <span>
              <b>双人分离，批准后才记账</b>
              <small>
                申请人不能复核自己的申请；复核时会重新校验可用余额。
              </small>
            </span>
          </div>
          <button
            type="button"
            className="primary-button"
            onClick={() => setCreateOpen(true)}
          >
            <Plus aria-hidden="true" size={13} />
            发起退款 / 调整
          </button>
        </div>

        <div className="ops-approval-summary" aria-label="退款与调整汇总">
          <ApprovalMetric
            icon={ClipboardCheck}
            label="待复核"
            value={`${page.summary.pending} 笔`}
            note="必须由另一管理员处理"
          />
          <ApprovalMetric
            icon={ArrowUpRight}
            label="待补账"
            value={formatMoney(page.summary.pendingCreditAmount)}
            note="批准后增加余额"
          />
          <ApprovalMetric
            icon={ArrowDownRight}
            label="待扣减"
            value={formatMoney(page.summary.pendingDebitAmount)}
            note="退款与人工冲减"
          />
          <ApprovalMetric
            icon={ShieldAlert}
            label="历史决策"
            value={`${page.summary.approved + page.summary.rejected} 笔`}
            note={`${page.summary.approved} 批准 · ${page.summary.rejected} 拒绝`}
          />
        </div>

        <div className="ops-account-tabs ops-approval-tabs">
          {(
            [
              ['ALL', '全部申请', 'all'],
              ['PENDING', '待复核', 'pending'],
              ['APPROVED', '已批准', 'approved'],
              ['REJECTED', '已拒绝', 'rejected'],
            ] as const
          ).map(([value, label, count]) => (
            <button
              type="button"
              key={value}
              className={status === value ? 'is-active' : ''}
              onClick={() => {
                setStatus(value);
                setPageNum(0);
              }}
            >
              {label}
              <small>{page.summary[count]}</small>
            </button>
          ))}
        </div>

        <div className="ops-toolbar">
          <label className="search-box ops-search">
            <Search aria-hidden="true" size={15} />
            <input
              value={keywordDraft}
              onChange={(event) => setKeywordDraft(event.target.value)}
              placeholder="搜索申请号、影楼、申请人、复核人或原因"
            />
          </label>
          <UnifiedSelect
            ariaLabel="退款调整类型"
            value={kind}
            className="filter-button"
            popupLabel="按资金类型筛选"
            options={[
              { value: 'ALL', label: '全部资金类型' },
              ...Object.entries(kindMeta).map(([value, meta]) => ({
                value,
                label: meta.label,
              })),
            ]}
            onValueChange={(value) => {
              setKind(value as AccountAdjustmentKind | 'ALL');
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
              size={13}
            />
            刷新审批
          </button>
        </div>

        {error ? (
          <div className="ops-feedback is-error" role="alert">
            <AlertTriangle aria-hidden="true" size={15} />
            <div>
              <b>审批列表读取失败</b>
              <span>{error}</span>
            </div>
            <button type="button" onClick={refresh}>
              重试
            </button>
          </div>
        ) : null}

        <div className="table-wrap ops-table-wrap" aria-busy={loading}>
          <table className="data-table ops-adjustment-table">
            <caption className="sr-only">退款与人工调整申请</caption>
            <thead>
              <tr>
                <th>申请 / 时间</th>
                <th>影楼</th>
                <th>类型 / 金额</th>
                <th>申请时余额</th>
                <th>当前可用余额</th>
                <th>原因 / 依据</th>
                <th>申请与复核</th>
                <th>状态 / 操作</th>
              </tr>
            </thead>
            <tbody>
              {loading && !page.items.length
                ? Array.from({ length: 3 }, (_, index) => (
                    <SkeletonRow key={index} />
                  ))
                : page.items.map((item) => {
                    const meta = kindMeta[item.kind];
                    const state = statusMeta[item.status];
                    return (
                      <tr key={item.id}>
                        <td>
                          <code className="ops-ledger-id">
                            {item.requestNo}
                          </code>
                          <span className="table-meta">
                            {formatDateTime(item.requestedAt)}
                          </span>
                        </td>
                        <td>
                          <b>{item.studioName}</b>
                          <span className="table-meta">
                            {item.studioBusinessCode}
                          </span>
                        </td>
                        <td>
                          <Status tone={meta.tone}>{meta.shortLabel}</Status>
                          <b
                            className={
                              meta.direction === 'CREDIT'
                                ? 'ops-amount-positive table-meta'
                                : 'ops-amount-negative table-meta'
                            }
                          >
                            {meta.direction === 'CREDIT' ? '+' : '−'}
                            {formatMoney(item.amount)}
                          </b>
                        </td>
                        <td>
                          <b>{formatMoney(item.balanceSnapshot)}</b>
                          <span className="table-meta">
                            可用 {formatMoney(item.availableBalanceSnapshot)}
                          </span>
                        </td>
                        <td>
                          <b>{formatMoney(item.currentAvailableBalance)}</b>
                          <span className="table-meta">
                            账面 {formatMoney(item.currentBalance)}
                          </span>
                        </td>
                        <td>
                          <b
                            className="ops-adjustment-reason"
                            title={item.reason}
                          >
                            {item.reason}
                          </b>
                          <span className="table-meta">
                            {item.supportingReference ?? '未填写依据编号'}
                          </span>
                        </td>
                        <td>
                          <b>{item.requestedBy}</b>
                          <span className="table-meta">
                            {item.reviewedBy
                              ? `复核 ${item.reviewedBy}`
                              : item.canReview
                                ? '可由你复核'
                                : '等待其他管理员'}
                          </span>
                        </td>
                        <td>
                          <Status tone={state.tone}>{state.label}</Status>
                          <button
                            type="button"
                            className="ops-table-action ops-review-action"
                            onClick={() => setReviewTarget(item)}
                          >
                            {item.status === 'PENDING' && item.canReview
                              ? '复核'
                              : '查看'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
          {!loading && !error && !page.items.length ? (
            <div className="ops-empty is-compact">
              <ClipboardCheck aria-hidden="true" size={23} />
              <b>
                {status === 'PENDING'
                  ? '当前没有待复核申请'
                  : '没有符合条件的申请'}
              </b>
              <p>新申请只会在另一名管理员批准后写入账户账本。</p>
            </div>
          ) : null}
        </div>
        <footer className="ops-pagination">
          <span>
            第 {page.total ? page.pageNum + 1 : 0} / {page.pages} 页 · 当前{' '}
            {page.items.length} 笔
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

      <CreateAdjustmentDialog
        open={createOpen}
        studios={studios}
        onClose={() => setCreateOpen(false)}
        onCompleted={(created) => {
          setCreateOpen(false);
          setStatus('PENDING');
          setFeedback(
            `${created.requestNo} 已提交；必须由非 ${created.requestedBy} 的管理员复核。`,
          );
          refresh();
        }}
      />
      <ReviewAdjustmentDialog
        adjustment={reviewTarget}
        onClose={() => setReviewTarget(null)}
        onCompleted={(reviewed) => {
          setReviewTarget(null);
          setFeedback(
            reviewed.status === 'APPROVED'
              ? `${reviewed.requestNo} 已批准并生成唯一账本流水。`
              : `${reviewed.requestNo} 已拒绝，账户余额未改变。`,
          );
          if (reviewed.status === 'APPROVED') onLedgerChanged();
          refresh();
        }}
      />
    </>
  );
}

function CreateAdjustmentDialog({
  open,
  studios,
  onClose,
  onCompleted,
}: {
  open: boolean;
  studios: OperatorStudio[];
  onClose: () => void;
  onCompleted: (adjustment: OperatorAccountAdjustment) => void;
}) {
  const [studioId, setStudioId] = useState('');
  const [kind, setKind] = useState<AccountAdjustmentKind>('REFUND');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [supportingReference, setSupportingReference] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      setStudioId('');
      setKind('REFUND');
      setAmount('');
      setReason('');
      setSupportingReference('');
      setIdempotencyKey(crypto.randomUUID());
      setError('');
    });
  }, [open]);

  const selectedStudio = studios.find((studio) => studio.id === studioId);
  const valid = Boolean(
    studioId &&
    Number(amount) > 0 &&
    reason.trim().length >= 2 &&
    idempotencyKey,
  );

  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setError('');
    try {
      onCompleted(
        await createAccountAdjustment({
          studioId,
          kind,
          amount,
          reason: reason.trim(),
          supportingReference: supportingReference.trim() || null,
          idempotencyKey,
        }),
      );
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !saving) onClose();
      }}
    >
      <DialogContent className="ops-dialog ops-editor-dialog">
        <DialogHeader>
          <span className="ops-dialog-kicker">MAKER / CHECKER REQUEST</span>
          <DialogTitle>发起退款或人工调整</DialogTitle>
          <DialogDescription>
            当前操作人 {platformActorId} 仅负责申请，不能批准自己的申请。
          </DialogDescription>
        </DialogHeader>
        <div className="ops-form-grid">
          <div className="ops-field ops-field-wide">
            <span>
              影楼账户 <i>*</i>
            </span>
            <UnifiedSelect
              ariaLabel="退款调整影楼账户"
              value={studioId}
              placeholder="选择影楼"
              popupLabel="选择资金调整影楼"
              options={studios.map((studio) => ({
                value: studio.id,
                label: `${studio.businessCode} · ${studio.name}`,
                description: `当前可用 ${formatMoney(studio.account.availableBalance)}`,
              }))}
              onValueChange={setStudioId}
            />
          </div>
          <div className="ops-field">
            <span>
              资金类型 <i>*</i>
            </span>
            <UnifiedSelect
              ariaLabel="退款调整资金类型"
              value={kind}
              popupLabel="选择资金变更方向"
              options={Object.entries(kindMeta).map(([value, meta]) => ({
                value,
                label: meta.label,
              }))}
              onValueChange={(value) => setKind(value as AccountAdjustmentKind)}
            />
          </div>
          <label className="ops-field">
            <span>
              申请金额（元） <i>*</i>
            </span>
            <input
              aria-label="退款调整申请金额"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="例如 500.00"
            />
          </label>
          <label className="ops-field ops-field-wide">
            <span>
              申请原因 <i>*</i>
            </span>
            <textarea
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="说明业务背景、金额依据和预期处理"
            />
          </label>
          <label className="ops-field ops-field-wide">
            <span>依据编号</span>
            <input
              value={supportingReference}
              maxLength={256}
              onChange={(event) => setSupportingReference(event.target.value)}
              placeholder="退款单号、工单号或内部审批编号"
            />
          </label>
          <div className="ops-form-note ops-field-wide">
            <ShieldAlert aria-hidden="true" size={14} />
            <span>
              {selectedStudio && kindMeta[kind].direction === 'DEBIT'
                ? `当前可用 ${formatMoney(selectedStudio.account.availableBalance)}；提交和复核时都会校验余额。`
                : '批准前不会改变余额，也不会写入退款或调整账本。'}
            </span>
          </div>
        </div>
        {error ? (
          <div className="ops-inline-error" role="alert">
            <AlertTriangle aria-hidden="true" size={14} />
            {error}
          </div>
        ) : null}
        <DialogFooter>
          <button
            type="button"
            className="filter-button"
            disabled={saving}
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={saving || !valid}
            onClick={() => void submit()}
          >
            {saving ? (
              <>
                <LoaderCircle
                  aria-hidden="true"
                  className="is-spinning"
                  size={13}
                />
                正在提交…
              </>
            ) : (
              '提交给他人复核'
            )}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReviewAdjustmentDialog({
  adjustment,
  onClose,
  onCompleted,
}: {
  adjustment: OperatorAccountAdjustment | null;
  onClose: () => void;
  onCompleted: (adjustment: OperatorAccountAdjustment) => void;
}) {
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!adjustment) return;
    queueMicrotask(() => {
      setNote('');
      setError('');
    });
  }, [adjustment]);

  const decide = async (decision: 'APPROVE' | 'REJECT') => {
    if (
      !adjustment ||
      !adjustment.canReview ||
      note.trim().length < 2 ||
      saving
    )
      return;
    setSaving(true);
    setError('');
    try {
      onCompleted(
        await decideAccountAdjustment(adjustment.id, {
          decision,
          note: note.trim(),
        }),
      );
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  const meta = adjustment ? kindMeta[adjustment.kind] : null;
  const isPending = adjustment?.status === 'PENDING';
  return (
    <Dialog
      open={Boolean(adjustment)}
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent className="ops-dialog ops-review-dialog">
        <DialogHeader>
          <span className="ops-dialog-kicker">INDEPENDENT REVIEW</span>
          <DialogTitle>
            {isPending ? '复核资金申请' : '资金申请详情'}
          </DialogTitle>
          <DialogDescription>
            {adjustment
              ? `${adjustment.requestNo} · 申请人 ${adjustment.requestedBy} · 当前操作人 ${platformActorId}`
              : '正在读取'}
          </DialogDescription>
        </DialogHeader>
        {adjustment && meta ? (
          <div className="ops-review-body">
            <div className="ops-review-amount">
              <span>{meta.label}</span>
              <b
                className={
                  meta.direction === 'CREDIT' ? 'is-credit' : 'is-debit'
                }
              >
                {meta.direction === 'CREDIT' ? '+' : '−'}
                {formatMoney(adjustment.amount)}
              </b>
              <small>{adjustment.studioName}</small>
            </div>
            <dl className="ops-review-grid">
              <ReviewPair
                label="申请时账面"
                value={formatMoney(adjustment.balanceSnapshot)}
              />
              <ReviewPair
                label="申请时可用"
                value={formatMoney(adjustment.availableBalanceSnapshot)}
              />
              <ReviewPair
                label="当前账面"
                value={formatMoney(adjustment.currentBalance)}
              />
              <ReviewPair
                label="当前可用"
                value={formatMoney(adjustment.currentAvailableBalance)}
              />
              <ReviewPair label="申请原因" value={adjustment.reason} />
              <ReviewPair
                label="依据编号"
                value={adjustment.supportingReference ?? '未填写'}
              />
            </dl>
            {!adjustment.canReview && isPending ? (
              <div className="ops-review-blocked">
                <ShieldAlert aria-hidden="true" size={16} />
                <div>
                  <b>当前操作人不能复核这笔申请</b>
                  <p>申请人与复核人必须不同，请由另一管理员登录后处理。</p>
                </div>
              </div>
            ) : null}
            {adjustment.canReview ? (
              <label className="ops-field ops-review-note">
                <span>
                  复核意见 <i>*</i>
                </span>
                <textarea
                  rows={3}
                  maxLength={500}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="说明批准或拒绝依据"
                />
              </label>
            ) : null}
            {!isPending ? (
              <div className="ops-review-decision">
                {adjustment.status === 'APPROVED' ? (
                  <CheckCircle2 aria-hidden="true" size={16} />
                ) : (
                  <XCircle aria-hidden="true" size={16} />
                )}
                <div>
                  <b>{statusMeta[adjustment.status].label}</b>
                  <p>
                    {adjustment.reviewedBy} · {adjustment.reviewNote} ·{' '}
                    {adjustment.reviewedAt
                      ? formatDateTime(adjustment.reviewedAt)
                      : '—'}
                  </p>
                  {adjustment.ledger ? (
                    <code>账本 {adjustment.ledger.ledgerId}</code>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        {error ? (
          <div className="ops-inline-error" role="alert">
            <AlertTriangle aria-hidden="true" size={14} />
            {error}
          </div>
        ) : null}
        <DialogFooter>
          <button
            type="button"
            className="filter-button"
            disabled={saving}
            onClick={onClose}
          >
            关闭
          </button>
          {adjustment?.canReview ? (
            <>
              <button
                type="button"
                className="ops-danger-button"
                disabled={saving || note.trim().length < 2}
                onClick={() => void decide('REJECT')}
              >
                <XCircle aria-hidden="true" size={13} />
                拒绝申请
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={saving || note.trim().length < 2}
                onClick={() => void decide('APPROVE')}
              >
                {saving ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="is-spinning"
                    size={13}
                  />
                ) : (
                  <FilePenLine aria-hidden="true" size={13} />
                )}
                批准并记账
              </button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ApprovalMetric({
  icon: Icon,
  label,
  value,
  note,
}: {
  icon: typeof ClipboardCheck;
  label: string;
  value: string;
  note: string;
}) {
  return (
    <article>
      <span>
        <Icon aria-hidden="true" size={14} />
      </span>
      <div>
        <small>{label}</small>
        <b>{value}</b>
        <em>{note}</em>
      </div>
    </article>
  );
}

function ReviewPair({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
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

function formatMoney(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? `¥${amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '—';
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(date);
}

function apiErrorMessage(error: unknown) {
  if (error instanceof PlatformApiError) {
    return `${error.message}${error.requestId ? `（请求 ${error.requestId}）` : ''}`;
  }
  return error instanceof Error ? error.message : '平台 API 请求失败';
}

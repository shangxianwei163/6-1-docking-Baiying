'use client';

import { type KeyboardEvent, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  ClipboardCheck,
  CircleDollarSign,
  FileCheck2,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  WalletCards,
} from 'lucide-react';
import type {
  AccountEvidenceChannel,
  LedgerEntryType,
  OperatorLedgerPage,
  OperatorStudio,
} from '@outbound/contracts';
import {
  loadOperatorLedger,
  loadOperatorStudios,
  PlatformApiError,
  postOperatorTopUp,
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
import { AccountAdjustmentConsole } from './account-adjustment-console';
import { Panel, Status } from './shared';

const emptyLedger: OperatorLedgerPage = {
  total: 0,
  pages: 0,
  pageNum: 0,
  pageSize: 20,
  totalTopUp: '0.000000',
  totalCharge: '0.000000',
  items: [],
};

const ledgerMeta: Record<
  LedgerEntryType,
  { label: string; tone: 'green' | 'amber' | 'red' | 'blue' | 'gray' }
> = {
  TOP_UP: { label: '充值入账', tone: 'green' },
  TASK_HOLD: { label: '任务冻结', tone: 'blue' },
  TASK_HOLD_RELEASE: { label: '冻结释放', tone: 'gray' },
  CALL_CHARGE: { label: '通话扣费', tone: 'amber' },
  OVERAGE_DEBIT: { label: '超额扣费', tone: 'red' },
  REFUND: { label: '退款', tone: 'red' },
  ADJUSTMENT: { label: '人工调整', tone: 'gray' },
};

const channelOptions: Array<{
  value: AccountEvidenceChannel;
  label: string;
}> = [
  { value: 'CORPORATE_TRANSFER', label: '对公转账' },
  { value: 'BANK_RECEIPT', label: '银行回单' },
  { value: 'WECHAT', label: '微信收款' },
  { value: 'ALIPAY', label: '支付宝' },
  { value: 'OTHER', label: '其他渠道' },
];

type FinanceScope = 'LEDGER' | 'ADJUSTMENTS';

export function RechargeLedgerConsole() {
  const [scope, setScope] = useState<FinanceScope>('LEDGER');
  const [studios, setStudios] = useState<OperatorStudio[]>([]);
  const [keywordDraft, setKeywordDraft] = useState('');
  const [keyword, setKeyword] = useState('');
  const [studioId, setStudioId] = useState('ALL');
  const [entryType, setEntryType] = useState<LedgerEntryType | 'ALL'>('ALL');
  const [pageNum, setPageNum] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(emptyLedger);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [feedback, setFeedback] = useState('');

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

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setLoading(true);
        setError('');
      }
    });
    void loadOperatorLedger({
      keyword: keyword || undefined,
      studioId: studioId === 'ALL' ? undefined : studioId,
      entryType: entryType === 'ALL' ? undefined : entryType,
      pageNum,
      pageSize,
    })
      .then((result) => {
        if (cancelled) return;
        setPage(result);
        if (result.pages && pageNum >= result.pages)
          setPageNum(result.pages - 1);
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
  }, [entryType, keyword, pageNum, pageSize, refreshToken, studioId]);

  const refresh = () => setRefreshToken((current) => current + 1);
  const selectedStudio = studios.find((studio) => studio.id === studioId);
  const handleScopeKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    let nextScope: FinanceScope | null = null;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      nextScope = scope === 'LEDGER' ? 'ADJUSTMENTS' : 'LEDGER';
    } else if (event.key === 'Home') {
      nextScope = 'LEDGER';
    } else if (event.key === 'End') {
      nextScope = 'ADJUSTMENTS';
    }
    if (!nextScope) return;
    event.preventDefault();
    setScope(nextScope);
    window.requestAnimationFrame(() => {
      document
        .getElementById(
          nextScope === 'LEDGER'
            ? 'finance-tab-ledger'
            : 'finance-tab-adjustments',
        )
        ?.focus();
    });
  };

  return (
    <div className="finance-console">
      <header className="ops-page-intro">
        <div>
          <span>ACCOUNT LEDGER / IMMUTABLE</span>
          <h2>充值记录</h2>
          <p>
            每笔余额变更来自不可变账本；线下充值携带渠道、凭证编号与文件名元数据，并支持幂等重放。
          </p>
        </div>
        {scope === 'LEDGER' ? (
          <button
            type="button"
            className="primary-button"
            onClick={() => setDialogOpen(true)}
          >
            <Plus aria-hidden="true" size={14} />
            登记线下充值
          </button>
        ) : null}
      </header>

      <div
        className="finance-scope-tabs"
        role="tablist"
        aria-label="充值与资金审批分类"
      >
        <button
          id="finance-tab-ledger"
          type="button"
          role="tab"
          aria-selected={scope === 'LEDGER'}
          aria-controls="finance-panel-ledger"
          tabIndex={scope === 'LEDGER' ? 0 : -1}
          className={scope === 'LEDGER' ? 'is-active' : ''}
          onClick={() => setScope('LEDGER')}
          onKeyDown={handleScopeKeyDown}
        >
          <span>
            <WalletCards aria-hidden="true" size={17} />
          </span>
          <span>
            <b>真实账户流水</b>
            <small>不可变账户账本 · 充值与扣费</small>
          </span>
          <em>{page.total} 笔流水</em>
        </button>
        <button
          id="finance-tab-adjustments"
          type="button"
          role="tab"
          aria-selected={scope === 'ADJUSTMENTS'}
          aria-controls="finance-panel-adjustments"
          tabIndex={scope === 'ADJUSTMENTS' ? 0 : -1}
          className={scope === 'ADJUSTMENTS' ? 'is-active' : ''}
          onClick={() => setScope('ADJUSTMENTS')}
          onKeyDown={handleScopeKeyDown}
        >
          <span>
            <ClipboardCheck aria-hidden="true" size={17} />
          </span>
          <span>
            <b>退款与人工调整审批</b>
            <small>双人复核 · 批准后写入账本</small>
          </span>
          <em>申请与复核</em>
        </button>
      </div>

      {scope === 'LEDGER' ? (
        <section
          id="finance-panel-ledger"
          className="finance-tab-panel"
          role="tabpanel"
          aria-labelledby="finance-tab-ledger"
          tabIndex={0}
        >
          {feedback ? (
            <output className="ops-feedback is-success">
              <CheckCircle2 aria-hidden="true" size={16} />
              <span>{feedback}</span>
              <button type="button" onClick={() => setFeedback('')}>
                关闭
              </button>
            </output>
          ) : null}

          <section className="ops-metric-grid" aria-label="账务汇总">
            <MetricCard
              icon={ArrowUpRight}
              label="当前筛选充值"
              value={formatMoney(page.totalTopUp)}
              note="TOP_UP 账本正向金额"
            />
            <MetricCard
              icon={ArrowDownRight}
              label="当前筛选通话扣费"
              value={formatMoney(page.totalCharge)}
              note="CALL_CHARGE + OVERAGE"
            />
            <MetricCard
              icon={WalletCards}
              label="账本流水"
              value={`${page.total} 笔`}
              note={selectedStudio ? selectedStudio.name : '全部影楼'}
            />
            <MetricCard
              icon={ShieldCheck}
              label="凭证规则"
              value="元数据留痕"
              note="文件内容待 OSS 阶段归档"
            />
          </section>

          <aside className="finance-policy-principle" aria-label="到账原则">
            <FileCheck2 aria-hidden="true" size={16} />
            <div>
              <b>到账原则：先核验，后入账</b>
              <p>账户行锁内一次完成余额更新、账本写入和审计留痕。</p>
            </div>
          </aside>

          <Panel
            title="真实账户流水"
            meta={loading ? '正在读取账本…' : `共 ${page.total} 笔`}
            className="ops-panel finance-ledger-panel"
          >
            <div className="ops-toolbar">
              <label className="search-box ops-search">
                <Search aria-hidden="true" size={15} />
                <input
                  value={keywordDraft}
                  onChange={(event) => setKeywordDraft(event.target.value)}
                  placeholder="搜索影楼、业务键、任务编号、操作人或备注"
                />
              </label>
              <UnifiedSelect
                ariaLabel="账本影楼"
                value={studioId}
                className="filter-button"
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
                ariaLabel="账本流水类型"
                value={entryType}
                className="filter-button"
                popupLabel="按流水类型筛选"
                options={[
                  { value: 'ALL', label: '全部流水类型' },
                  ...Object.entries(ledgerMeta).map(([value, meta]) => ({
                    value,
                    label: meta.label,
                  })),
                ]}
                onValueChange={(value) => {
                  setEntryType(value as LedgerEntryType | 'ALL');
                  setPageNum(0);
                }}
              />
              <UnifiedSelect
                ariaLabel="账本每页数量"
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

            {error ? (
              <div className="ops-feedback is-error" role="alert">
                <AlertTriangle aria-hidden="true" size={16} />
                <div>
                  <b>账户账本读取失败</b>
                  <span>{error}</span>
                </div>
                <button type="button" onClick={refresh}>
                  重试
                </button>
              </div>
            ) : null}

            <div className="table-wrap ops-table-wrap" aria-busy={loading}>
              <table className="data-table ops-ledger-table">
                <caption className="sr-only">真实账户账本流水</caption>
                <thead>
                  <tr>
                    <th>流水 / 时间</th>
                    <th>影楼</th>
                    <th>类型</th>
                    <th>发生金额</th>
                    <th>变更后余额</th>
                    <th>任务 / 业务键</th>
                    <th>渠道 / 凭证</th>
                    <th>操作与备注</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && !page.items.length
                    ? Array.from({ length: 4 }, (_, index) => (
                        <SkeletonRow key={index} />
                      ))
                    : page.items.map((entry) => {
                        const meta = ledgerMeta[entry.type];
                        const positive = Number(entry.amount) >= 0;
                        return (
                          <tr key={entry.ledgerId}>
                            <td>
                              <code className="ops-ledger-id">
                                {entry.ledgerId.slice(0, 8)}
                              </code>
                              <span className="table-meta">
                                {formatDateTime(entry.occurredAt)}
                              </span>
                            </td>
                            <td>
                              <b>{entry.studioName}</b>
                              <span className="table-meta">
                                {entry.studioBusinessCode}
                              </span>
                            </td>
                            <td>
                              <Status tone={meta.tone}>{meta.label}</Status>
                            </td>
                            <td>
                              <b
                                className={
                                  positive
                                    ? 'ops-amount-positive'
                                    : 'ops-amount-negative'
                                }
                              >
                                {positive ? '+' : ''}
                                {formatMoney(entry.amount)}
                              </b>
                            </td>
                            <td>
                              <b>{formatMoney(entry.balanceAfter)}</b>
                              <span className="table-meta">
                                可用 {formatMoney(entry.availableBalanceAfter)}
                              </span>
                            </td>
                            <td>
                              <code>{entry.taskNo ?? '非任务流水'}</code>
                              <span
                                className="table-meta ops-business-key"
                                title={entry.businessKey}
                              >
                                {entry.businessKey}
                              </span>
                            </td>
                            <td>
                              {entry.evidence ? (
                                <>
                                  <b>{channelLabel(entry.evidence.channel)}</b>
                                  <span className="table-meta">
                                    {entry.evidence.receiptReference}
                                  </span>
                                  <span className="table-meta">
                                    {entry.evidence.receiptFileName ??
                                      '无文件名'}
                                  </span>
                                </>
                              ) : (
                                <span className="ops-muted">系统业务流水</span>
                              )}
                            </td>
                            <td>
                              <b>{entry.operatorId ?? '系统 Worker'}</b>
                              <span
                                className="table-meta ops-reason"
                                title={entry.reason ?? ''}
                              >
                                {entry.reason ?? '—'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                </tbody>
              </table>
              {!loading && !error && !page.items.length ? (
                <div className="ops-empty">
                  <CircleDollarSign aria-hidden="true" size={24} />
                  <b>没有符合条件的账本流水</b>
                  <p>登记首笔充值或调整筛选条件。</p>
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
                  onClick={() =>
                    setPageNum((current) => Math.max(0, current - 1))
                  }
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
        </section>
      ) : (
        <section
          id="finance-panel-adjustments"
          className="finance-tab-panel"
          role="tabpanel"
          aria-labelledby="finance-tab-adjustments"
          tabIndex={0}
        >
          <aside className="finance-policy-principle" aria-label="退款与调整">
            <ShieldCheck aria-hidden="true" size={16} />
            <div>
              <b>退款与调整：申请与复核严格分离</b>
              <p>退款、补账和冲减仅在另一管理员批准后生成唯一账本流水。</p>
            </div>
          </aside>
          <AccountAdjustmentConsole
            studios={studios}
            onLedgerChanged={refresh}
          />
        </section>
      )}

      <TopUpDialog
        open={dialogOpen}
        studios={studios}
        onClose={() => setDialogOpen(false)}
        onCompleted={(message) => {
          setDialogOpen(false);
          setFeedback(message);
          refresh();
        }}
      />
    </div>
  );
}

function TopUpDialog({
  open,
  studios,
  onClose,
  onCompleted,
}: {
  open: boolean;
  studios: OperatorStudio[];
  onClose: () => void;
  onCompleted: (message: string) => void;
}) {
  const [studioId, setStudioId] = useState('');
  const [amount, setAmount] = useState('');
  const [channel, setChannel] =
    useState<AccountEvidenceChannel>('CORPORATE_TRANSFER');
  const [receiptReference, setReceiptReference] = useState('');
  const [receiptFileName, setReceiptFileName] = useState('');
  const [reason, setReason] = useState('线下款项已核验到账');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      setStudioId('');
      setAmount('');
      setChannel('CORPORATE_TRANSFER');
      setReceiptReference('');
      setReceiptFileName('');
      setReason('线下款项已核验到账');
      setIdempotencyKey(crypto.randomUUID());
      setError('');
    });
  }, [open]);

  const submit = async () => {
    if (saving || !studioId || !idempotencyKey) return;
    setSaving(true);
    setError('');
    try {
      const result = await postOperatorTopUp({
        studioId,
        amount,
        idempotencyKey,
        channel,
        receiptReference,
        receiptFileName: receiptFileName || null,
        reason,
      });
      onCompleted(
        `${result.studio.name} 已入账 ${formatMoney(result.entry.amount)}，当前可用余额 ${formatMoney(result.studio.account.availableBalance)}。`,
      );
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  const valid = Boolean(
    studioId &&
    Number(amount) > 0 &&
    receiptReference.trim() &&
    reason.trim().length >= 2,
  );
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !saving) onClose();
      }}
    >
      <DialogContent className="ops-dialog ops-editor-dialog ops-fixed-form-dialog top-up-dialog">
        <DialogHeader>
          <span className="ops-dialog-kicker">IDEMPOTENT TOP-UP</span>
          <DialogTitle>登记线下充值</DialogTitle>
          <DialogDescription>
            确认到账后直接写入真实账户。重复提交同一幂等键不会重复增加余额。
          </DialogDescription>
        </DialogHeader>
        <div className="ops-form-grid">
          <div className="ops-field ops-field-wide">
            <span>
              影楼账户 <i>*</i>
            </span>
            <UnifiedSelect
              ariaLabel="充值影楼账户"
              value={studioId}
              placeholder="选择影楼"
              popupLabel="选择充值影楼"
              options={studios.map((studio) => ({
                value: studio.id,
                label: `${studio.businessCode} · ${studio.name}`,
                description: `可用 ${formatMoney(studio.account.availableBalance)}`,
              }))}
              onValueChange={setStudioId}
            />
          </div>
          <label className="ops-field">
            <span>
              到账金额（元） <i>*</i>
            </span>
            <input
              aria-label="到账金额"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="例如 10000.00"
            />
          </label>
          <div className="ops-field">
            <span>
              收款渠道 <i>*</i>
            </span>
            <UnifiedSelect
              ariaLabel="收款渠道"
              value={channel}
              popupLabel="选择收款渠道"
              options={channelOptions}
              onValueChange={(value) =>
                setChannel(value as AccountEvidenceChannel)
              }
            />
          </div>
          <label className="ops-field">
            <span>
              凭证编号 <i>*</i>
            </span>
            <input
              value={receiptReference}
              onChange={(event) => setReceiptReference(event.target.value)}
              placeholder="银行流水号或内部凭证号"
            />
          </label>
          <label className="ops-field">
            <span>凭证文件名</span>
            <input
              value={receiptFileName}
              onChange={(event) => setReceiptFileName(event.target.value)}
              placeholder="例如 receipt-001.pdf"
            />
          </label>
          <label className="ops-field ops-field-wide">
            <span>
              入账说明 <i>*</i>
            </span>
            <textarea
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <div className="ops-form-note ops-field-wide">
            <FileCheck2 aria-hidden="true" size={14} />
            <span>
              当前只保存凭证编号和文件名元数据；凭证文件将在阿里云 OSS
              接入阶段上传、哈希并归档。
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
                正在入账…
              </>
            ) : (
              '确认到账并入账'
            )}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  note,
}: {
  icon: typeof CircleDollarSign;
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
function channelLabel(value: AccountEvidenceChannel) {
  return channelOptions.find((item) => item.value === value)?.label ?? value;
}
function formatMoney(value: string) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  const absolute = Math.abs(amount).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${amount < 0 ? '-' : ''}¥${absolute}`;
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
        second: '2-digit',
        hour12: false,
      }).format(date);
}
function apiErrorMessage(error: unknown) {
  if (error instanceof PlatformApiError)
    return `${error.message}${error.requestId ? `（请求 ${error.requestId}）` : ''}`;
  return error instanceof Error ? error.message : '平台 API 请求失败';
}

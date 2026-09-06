'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  CircleDollarSign,
  KeyRound,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  WalletCards,
} from 'lucide-react';
import type {
  OperatorAccountStatus,
  OperatorStudio,
  OperatorStudioPage,
  OperatorStudioStatus,
} from '@outbound/contracts';
import {
  changeOperatorStudioStatus,
  createOperatorStudio,
  loadOperatorStudios,
  PlatformApiError,
  updateOperatorStudio,
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

const emptyPage: OperatorStudioPage = {
  total: 0,
  pages: 0,
  pageNum: 0,
  pageSize: 20,
  summary: {
    all: 0,
    active: 0,
    disabled: 0,
    accountActive: 0,
    lowBalance: 0,
    overdue: 0,
    accountDisabled: 0,
    totalBalance: '0.000000',
    totalActiveHold: '0.000000',
    totalAvailable: '0.000000',
  },
  studios: [],
};

type StudioForm = {
  name: string;
  mcCode: string;
  contactName: string;
  contactPhone: string;
};

type EditorState =
  | { kind: 'create'; studio: null }
  | { kind: 'edit'; studio: OperatorStudio }
  | { kind: 'status'; studio: OperatorStudio }
  | null;

const emptyForm: StudioForm = {
  name: '',
  mcCode: '',
  contactName: '',
  contactPhone: '',
};

const accountFilters: Array<{
  value: OperatorAccountStatus | 'ALL';
  label: string;
  count: keyof OperatorStudioPage['summary'];
}> = [
  { value: 'ALL', label: '全部账户', count: 'all' },
  { value: 'ACTIVE', label: '余额充足', count: 'accountActive' },
  { value: 'LOW_BALANCE', label: '余额不足', count: 'lowBalance' },
  { value: 'OVERDUE', label: '欠费', count: 'overdue' },
  { value: 'DISABLED', label: '已停用', count: 'accountDisabled' },
];

export function StudioOperationsConsole() {
  const [keywordDraft, setKeywordDraft] = useState('');
  const [keyword, setKeyword] = useState('');
  const [studioStatus, setStudioStatus] = useState<
    OperatorStudioStatus | 'ALL'
  >('ALL');
  const [accountStatus, setAccountStatus] = useState<
    OperatorAccountStatus | 'ALL'
  >('ALL');
  const [pageNum, setPageNum] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(emptyPage);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>(null);
  const [form, setForm] = useState<StudioForm>(emptyForm);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

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
    void loadOperatorStudios({
      keyword: keyword || undefined,
      studioStatus: studioStatus === 'ALL' ? undefined : studioStatus,
      accountStatus: accountStatus === 'ALL' ? undefined : accountStatus,
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
  }, [accountStatus, keyword, pageNum, pageSize, refreshToken, studioStatus]);

  const detailStudio = useMemo(
    () => page.studios.find((studio) => studio.id === detailId) ?? null,
    [detailId, page.studios],
  );

  const refresh = () => setRefreshToken((current) => current + 1);

  const openCreate = () => {
    setForm(emptyForm);
    setSaveError('');
    setEditor({ kind: 'create', studio: null });
  };

  const openEdit = (studio: OperatorStudio) => {
    setForm({
      name: studio.name,
      mcCode: studio.mcCode,
      contactName: studio.contactName ?? '',
      contactPhone: '',
    });
    setSaveError('');
    setEditor({ kind: 'edit', studio });
  };

  const openStatus = (studio: OperatorStudio) => {
    setReason(
      studio.status === 'ACTIVE'
        ? '暂停该影楼的新任务受理'
        : '恢复影楼任务受理',
    );
    setSaveError('');
    setEditor({ kind: 'status', studio });
  };

  const saveStudio = async () => {
    if (!editor || editor.kind === 'status' || saving) return;
    setSaving(true);
    setSaveError('');
    try {
      if (editor.kind === 'create') {
        const created = await createOperatorStudio({
          name: form.name,
          mcCode: form.mcCode,
          contactName: form.contactName || null,
          contactPhone: form.contactPhone || null,
        });
        setFeedback(
          `影楼 ${created.businessCode} 已创建；充值和发布价格后才能受理任务。`,
        );
      } else {
        const updated = await updateOperatorStudio(editor.studio.id, {
          name: form.name,
          mcCode: form.mcCode,
          contactName: form.contactName || null,
          ...(form.contactPhone ? { contactPhone: form.contactPhone } : {}),
        });
        setFeedback(`${updated.name} 的资料已保存并写入审计日志。`);
      }
      setEditor(null);
      refresh();
    } catch (caught) {
      setSaveError(apiErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  const saveStatus = async () => {
    if (!editor || editor.kind !== 'status' || saving) return;
    setSaving(true);
    setSaveError('');
    try {
      const nextStatus =
        editor.studio.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
      const updated = await changeOperatorStudioStatus(editor.studio.id, {
        status: nextStatus,
        reason,
      });
      setFeedback(
        `${updated.name} 已${nextStatus === 'ACTIVE' ? '启用' : '停用'}，账户状态已同步。`,
      );
      setEditor(null);
      refresh();
    } catch (caught) {
      setSaveError(apiErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <header className="ops-page-intro">
        <div>
          <span>STUDIO CONTROL / LIVE</span>
          <h2>影楼管理</h2>
          <p>
            影楼身份、账户、价格和回传端点均直接读取
            PostgreSQL；停用会同步阻断新任务。
          </p>
        </div>
        <button type="button" className="primary-button" onClick={openCreate}>
          <Plus aria-hidden="true" size={14} />
          新增影楼
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

      <section className="ops-metric-grid" aria-label="影楼账户汇总">
        <MetricCard
          icon={Building2}
          label="影楼总数"
          value={`${page.summary.all} 家`}
          note={`${page.summary.active} 启用 · ${page.summary.disabled} 停用`}
        />
        <MetricCard
          icon={WalletCards}
          label="账面余额"
          value={formatMoney(page.summary.totalBalance)}
          note={`冻结 ${formatMoney(page.summary.totalActiveHold)}`}
        />
        <MetricCard
          icon={CircleDollarSign}
          label="可用余额"
          value={formatMoney(page.summary.totalAvailable)}
          note={`${page.summary.lowBalance} 家余额不足`}
        />
        <MetricCard
          icon={ShieldCheck}
          label="欠费 / 停用账户"
          value={`${page.summary.overdue + page.summary.accountDisabled} 家`}
          note="新任务受理将被阻断"
        />
      </section>

      <Panel
        title="真实影楼账户"
        meta={loading ? '正在读取数据库…' : `共 ${page.total} 家`}
        className="ops-panel"
      >
        <div className="ops-account-tabs" aria-label="账户状态筛选">
          {accountFilters.map((filter) => (
            <button
              type="button"
              key={filter.value}
              className={accountStatus === filter.value ? 'is-active' : ''}
              onClick={() => {
                setAccountStatus(filter.value);
                setPageNum(0);
              }}
            >
              {filter.label}
              <small>{page.summary[filter.count]}</small>
            </button>
          ))}
          <span>
            <ShieldCheck aria-hidden="true" size={12} /> PostgreSQL 实时数据
          </span>
        </div>
        <div className="ops-toolbar">
          <label className="search-box ops-search">
            <Search aria-hidden="true" size={15} />
            <input
              value={keywordDraft}
              onChange={(event) => setKeywordDraft(event.target.value)}
              placeholder="搜索影楼编号、名称、MC code 或联系人"
            />
          </label>
          <UnifiedSelect
            ariaLabel="影楼启停状态"
            value={studioStatus}
            className="filter-button"
            popupLabel="筛选影楼状态"
            options={[
              { value: 'ALL', label: '全部启停状态' },
              { value: 'ACTIVE', label: '影楼已启用' },
              { value: 'DISABLED', label: '影楼已停用' },
            ]}
            onValueChange={(value) => {
              setStudioStatus(value as OperatorStudioStatus | 'ALL');
              setPageNum(0);
            }}
          />
          <UnifiedSelect
            ariaLabel="影楼每页数量"
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
          <ErrorNotice
            title="影楼数据读取失败"
            message={error}
            onRetry={refresh}
          />
        ) : null}

        <div className="table-wrap ops-table-wrap" aria-busy={loading}>
          <table className="data-table ops-studio-table">
            <caption className="sr-only">真实影楼与账户列表</caption>
            <thead>
              <tr>
                <th>影楼身份</th>
                <th>联系人</th>
                <th>账户</th>
                <th>当前价格</th>
                <th>任务用量</th>
                <th>回传端点</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {loading && !page.studios.length
                ? Array.from({ length: 4 }, (_, index) => (
                    <SkeletonRow key={index} cells={8} />
                  ))
                : page.studios.map((studio) => (
                    <StudioRow
                      key={studio.id}
                      studio={studio}
                      onDetail={() => setDetailId(studio.id)}
                      onEdit={() => openEdit(studio)}
                      onStatus={() => openStatus(studio)}
                    />
                  ))}
            </tbody>
          </table>
          {!loading && !error && !page.studios.length ? (
            <div className="ops-empty">
              <Building2 aria-hidden="true" size={24} />
              <b>没有符合条件的影楼</b>
              <p>调整筛选条件，或创建首个真实影楼账户。</p>
            </div>
          ) : null}
        </div>
        <footer className="ops-pagination">
          <span>
            第 {page.total ? page.pageNum + 1 : 0} / {page.pages} 页 · 当前{' '}
            {page.studios.length} 家
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

      <StudioDetail studio={detailStudio} onClose={() => setDetailId(null)} />
      <StudioEditor
        editor={editor}
        form={form}
        reason={reason}
        saving={saving}
        error={saveError}
        onFormChange={setForm}
        onReasonChange={setReason}
        onClose={() => setEditor(null)}
        onSave={() =>
          void (editor?.kind === 'status' ? saveStatus() : saveStudio())
        }
      />
    </>
  );
}

function StudioRow({
  studio,
  onDetail,
  onEdit,
  onStatus,
}: {
  studio: OperatorStudio;
  onDetail: () => void;
  onEdit: () => void;
  onStatus: () => void;
}) {
  const account = accountMeta(studio.account.status);
  const endpointReady = studio.endpoints.filter(
    (endpoint) => endpoint.status === 'ACTIVE' && endpoint.secretConfigured,
  ).length;
  return (
    <tr>
      <td>
        <button type="button" className="ops-code-link" onClick={onDetail}>
          {studio.businessCode}
        </button>
        <b className="ops-primary-cell">{studio.name}</b>
        <span className="table-meta">MC · {studio.mcCode}</span>
      </td>
      <td>
        <b>{studio.contactName ?? '未配置'}</b>
        <span className="table-meta">
          {studio.contactPhoneMasked ?? '未配置手机号'}
        </span>
      </td>
      <td>
        <b className="ops-money">
          {formatMoney(studio.account.availableBalance)}
        </b>
        <span className="table-meta">
          账面 {formatMoney(studio.account.balance)} · 冻结{' '}
          {formatMoney(studio.account.activeHoldAmount)}
        </span>
        <Status tone={account.tone}>{account.label}</Status>
      </td>
      <td>
        {studio.currentPricing ? (
          <>
            <b>{formatRate(studio.currentPricing.voiceRate)} / 分钟</b>
            <span className="table-meta">
              v{studio.currentPricing.version} · 冻结{' '}
              {studio.currentPricing.frozenMinutes} 分钟
            </span>
          </>
        ) : (
          <span className="ops-warning-copy">未发布价格</span>
        )}
        {studio.scheduledPricing ? (
          <span className="ops-scheduled">
            已预约 v{studio.scheduledPricing.version}
          </span>
        ) : null}
      </td>
      <td>
        <b>{studio.taskCount.toLocaleString('zh-CN')} 个任务</b>
        <span className="table-meta">
          {studio.billedMinutes.toLocaleString('zh-CN')} 计费分钟
        </span>
      </td>
      <td>
        <b>{studio.endpoints.length} 个版本</b>
        <span className="table-meta">{endpointReady} 个已启用且有密钥</span>
      </td>
      <td>
        <Status tone={studio.status === 'ACTIVE' ? 'green' : 'gray'}>
          {studio.status === 'ACTIVE' ? '已启用' : '已停用'}
        </Status>
        <span className="table-meta">
          更新于 {formatDateTime(studio.updatedAt)}
        </span>
      </td>
      <td>
        <div className="ops-row-actions">
          <button
            type="button"
            aria-label={`查看 ${studio.name} 详情`}
            onClick={onDetail}
          >
            详情
          </button>
          <button
            type="button"
            aria-label={`编辑 ${studio.name}`}
            onClick={onEdit}
          >
            <Pencil aria-hidden="true" size={11} />
            编辑
          </button>
          <button
            type="button"
            aria-label={`${studio.status === 'ACTIVE' ? '停用' : '启用'} ${studio.name}`}
            className={studio.status === 'ACTIVE' ? 'is-danger' : ''}
            onClick={onStatus}
          >
            {studio.status === 'ACTIVE' ? '停用' : '启用'}
          </button>
        </div>
      </td>
    </tr>
  );
}

function StudioDetail({
  studio,
  onClose,
}: {
  studio: OperatorStudio | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={Boolean(studio)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="ops-dialog ops-studio-detail-dialog">
        <DialogHeader>
          <span className="ops-dialog-kicker">DATABASE RECORD</span>
          <DialogTitle>{studio?.name ?? '影楼详情'}</DialogTitle>
          <DialogDescription>
            {studio ? `${studio.businessCode} · ${studio.mcCode}` : '正在读取'}
          </DialogDescription>
        </DialogHeader>
        {studio ? (
          <div className="ops-detail-body">
            <div className="ops-detail-grid">
              <DetailCard title="账户状态" icon={WalletCards}>
                <DetailPair
                  label="账面余额"
                  value={formatMoney(studio.account.balance)}
                />
                <DetailPair
                  label="冻结金额"
                  value={formatMoney(studio.account.activeHoldAmount)}
                />
                <DetailPair
                  label="可用余额"
                  value={formatMoney(studio.account.availableBalance)}
                />
                <DetailPair
                  label="锁版本"
                  value={String(studio.account.lockVersion)}
                />
              </DetailCard>
              <DetailCard title="业务配置" icon={Building2}>
                <DetailPair
                  label="联系人"
                  value={studio.contactName ?? '未配置'}
                />
                <DetailPair
                  label="联系电话"
                  value={studio.contactPhoneMasked ?? '未配置'}
                />
                <DetailPair label="任务数量" value={`${studio.taskCount} 个`} />
                <DetailPair label="创建人" value={studio.createdBy} />
              </DetailCard>
            </div>
            <section className="ops-endpoint-section">
              <header>
                <div>
                  <span>INTEGRATION ENDPOINTS</span>
                  <b>ERP / CRM 回传端点</b>
                </div>
                <small>真实密钥启用留待外部联调</small>
              </header>
              {studio.endpoints.length ? (
                studio.endpoints.map((endpoint) => (
                  <article key={endpoint.id}>
                    <div>
                      <Status
                        tone={
                          endpoint.status === 'ACTIVE'
                            ? 'green'
                            : endpoint.status === 'DRAFT'
                              ? 'amber'
                              : 'gray'
                        }
                      >
                        {endpoint.sourceSystem} · {endpoint.status}
                      </Status>
                      <b>端点版本 v{endpoint.version}</b>
                    </div>
                    <dl>
                      <DetailPair
                        label="结果地址"
                        value={endpoint.resultUrl}
                        code
                      />
                      <DetailPair
                        label="录音地址"
                        value={endpoint.recordingUrl}
                        code
                      />
                      <DetailPair
                        label="HMAC 密钥"
                        value={
                          endpoint.secretConfigured
                            ? '已配置密钥引用'
                            : '尚未配置'
                        }
                      />
                      <DetailPair
                        label="生效时间"
                        value={formatDateTime(endpoint.effectiveAt)}
                      />
                    </dl>
                  </article>
                ))
              ) : (
                <div className="ops-empty is-compact">
                  <KeyRound aria-hidden="true" size={20} />
                  <b>尚无回传端点</b>
                  <p>取得真实 ERP/CRM 地址与 KMS 密钥后再创建并启用版本。</p>
                </div>
              )}
            </section>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function StudioEditor({
  editor,
  form,
  reason,
  saving,
  error,
  onFormChange,
  onReasonChange,
  onClose,
  onSave,
}: {
  editor: EditorState;
  form: StudioForm;
  reason: string;
  saving: boolean;
  error: string;
  onFormChange: (form: StudioForm) => void;
  onReasonChange: (reason: string) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const isStatus = editor?.kind === 'status';
  const nextStatus =
    isStatus && editor.studio.status === 'ACTIVE' ? '停用' : '启用';
  return (
    <Dialog
      open={Boolean(editor)}
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent className="ops-dialog ops-editor-dialog">
        <DialogHeader>
          <span className="ops-dialog-kicker">AUDITED CHANGE</span>
          <DialogTitle>
            {isStatus
              ? `${nextStatus}影楼`
              : editor?.kind === 'edit'
                ? '编辑影楼资料'
                : '新增影楼'}
          </DialogTitle>
          <DialogDescription>
            {isStatus
              ? '状态会与账户同步，并立即影响新任务受理。'
              : '联系人手机号只写入加密字段，列表仅返回脱敏值。'}
          </DialogDescription>
        </DialogHeader>
        {isStatus ? (
          <label className="ops-field">
            <span>
              操作原因 <i>*</i>
            </span>
            <textarea
              value={reason}
              onChange={(event) => onReasonChange(event.target.value)}
              maxLength={500}
              rows={4}
            />
          </label>
        ) : (
          <div className="ops-form-grid">
            <label className="ops-field">
              <span>
                影楼名称 <i>*</i>
              </span>
              <input
                value={form.name}
                onChange={(event) =>
                  onFormChange({ ...form, name: event.target.value })
                }
              />
            </label>
            <label className="ops-field">
              <span>
                MC code <i>*</i>
              </span>
              <input
                value={form.mcCode}
                onChange={(event) =>
                  onFormChange({ ...form, mcCode: event.target.value })
                }
              />
            </label>
            <label className="ops-field">
              <span>联系人</span>
              <input
                value={form.contactName}
                onChange={(event) =>
                  onFormChange({ ...form, contactName: event.target.value })
                }
              />
            </label>
            <label className="ops-field">
              <span>联系人手机号</span>
              <input
                type="tel"
                value={form.contactPhone}
                onChange={(event) =>
                  onFormChange({ ...form, contactPhone: event.target.value })
                }
                placeholder={
                  editor?.kind === 'edit' ? '留空表示不修改' : '可选'
                }
              />
            </label>
            {editor?.kind === 'create' ? (
              <div className="ops-form-note">
                <ShieldCheck aria-hidden="true" size={14} />
                <span>
                  影楼编号自动生成；初始余额为
                  0，账户状态为欠费，且不会自动生成回调端点。
                </span>
              </div>
            ) : null}
          </div>
        )}
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
            className={
              isStatus && editor?.studio.status === 'ACTIVE'
                ? 'ops-danger-button'
                : 'primary-button'
            }
            disabled={
              saving ||
              (isStatus
                ? reason.trim().length < 2
                : form.name.trim().length < 2 || form.mcCode.trim().length < 2)
            }
            onClick={onSave}
          >
            {saving ? (
              <>
                <LoaderCircle
                  aria-hidden="true"
                  className="is-spinning"
                  size={13}
                />
                正在保存…
              </>
            ) : isStatus ? (
              `确认${nextStatus}`
            ) : (
              '保存并写入审计'
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
  icon: typeof Building2;
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
function DetailCard({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Building2;
  children: React.ReactNode;
}) {
  return (
    <section className="ops-detail-card">
      <header>
        <Icon aria-hidden="true" size={14} />
        <b>{title}</b>
      </header>
      <dl>{children}</dl>
    </section>
  );
}
function DetailPair({
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
function ErrorNotice({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="ops-feedback is-error" role="alert">
      <AlertTriangle aria-hidden="true" size={16} />
      <div>
        <b>{title}</b>
        <span>{message}</span>
      </div>
      <button type="button" onClick={onRetry}>
        重试
      </button>
    </div>
  );
}
function SkeletonRow({ cells }: { cells: number }) {
  return (
    <tr className="ops-skeleton">
      {Array.from({ length: cells }, (_, index) => (
        <td aria-label="正在加载" key={index}>
          <i />
        </td>
      ))}
    </tr>
  );
}

function accountMeta(value: OperatorAccountStatus): {
  label: string;
  tone: 'green' | 'amber' | 'red' | 'gray';
} {
  return (
    {
      ACTIVE: { label: '余额充足', tone: 'green' },
      LOW_BALANCE: { label: '余额不足', tone: 'amber' },
      OVERDUE: { label: '欠费', tone: 'red' },
      DISABLED: { label: '账户停用', tone: 'gray' },
    } as const
  )[value];
}
function formatMoney(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? `¥${amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '—';
}
function formatRate(value: string) {
  const rate = Number(value);
  return Number.isFinite(rate) ? `¥${rate.toFixed(2)}` : '—';
}
function formatDateTime(value: string | null) {
  if (!value) return '—';
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
  if (error instanceof PlatformApiError)
    return `${error.message}${error.requestId ? `（请求 ${error.requestId}）` : ''}`;
  return error instanceof Error ? error.message : '平台 API 请求失败';
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  Layers3,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Store,
} from 'lucide-react';
import type {
  PricingOverview,
  PricingPreview,
  PublishPricingInput,
} from '@outbound/contracts';
import {
  loadPricingOverview,
  PlatformApiError,
  previewPricing,
  publishPricing,
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

const emptyOverview: PricingOverview = { studios: [], supplierTiers: [] };
type PriceMode = 'UNIFORM' | 'PER_STUDIO';
type EffectiveChoice = 'NOW' | 'TOMORROW';

export function PricingOperationsConsole() {
  const [overview, setOverview] = useState(emptyOverview);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);
  const [mode, setMode] = useState<PriceMode>('UNIFORM');
  const [studioId, setStudioId] = useState('');
  const [voiceRate, setVoiceRate] = useState('0.48');
  const [smsRate, setSmsRate] = useState('0.08');
  const [frozenMinutes, setFrozenMinutes] = useState('2');
  const [effectiveChoice, setEffectiveChoice] =
    useState<EffectiveChoice>('NOW');
  const [reason, setReason] = useState('运营后台价格版本发布');
  const [preview, setPreview] = useState<PricingPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setLoading(true);
        setError('');
      }
    });
    void loadPricingOverview()
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

  const currentCount = overview.studios.filter(
    (studio) => studio.currentPricing,
  ).length;
  const scheduledCount = overview.studios.filter(
    (studio) => studio.scheduledPricing,
  ).length;
  const selectedStudio = overview.studios.find(
    (studio) => studio.studioId === studioId,
  );
  const input = useMemo(
    () =>
      buildPublishInput({
        mode,
        studioId,
        voiceRate,
        smsRate,
        frozenMinutes,
        effectiveChoice,
        reason,
      }),
    [
      effectiveChoice,
      frozenMinutes,
      mode,
      reason,
      smsRate,
      studioId,
      voiceRate,
    ],
  );

  const requestPreview = async () => {
    if (!input || previewing) return;
    setPreviewing(true);
    setActionError('');
    try {
      setPreview(await previewPricing(input));
    } catch (caught) {
      setActionError(apiErrorMessage(caught));
    } finally {
      setPreviewing(false);
    }
  };

  const confirmPublish = async () => {
    if (!input || publishing) return;
    setPublishing(true);
    setActionError('');
    try {
      const result = await publishPricing(input);
      setFeedback(
        `价格版本已发布：${result.published.length} 家影楼，${formatDateTime(result.effectiveFrom)} 生效。`,
      );
      setPreview(null);
      setRefreshToken((current) => current + 1);
    } catch (caught) {
      setActionError(apiErrorMessage(caught));
    } finally {
      setPublishing(false);
    }
  };

  const configureStudio = (targetId: string) => {
    const target = overview.studios.find(
      (studio) => studio.studioId === targetId,
    );
    setMode('PER_STUDIO');
    setStudioId(targetId);
    if (target?.currentPricing) {
      setVoiceRate(trimMoney(target.currentPricing.voiceRate));
      setSmsRate(trimMoney(target.currentPricing.smsRate));
      setFrozenMinutes(String(target.currentPricing.frozenMinutes));
    }
    setActionError('');
    document
      .querySelector('.ops-pricing-composer')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <>
      <header className="ops-page-intro">
        <div>
          <span>VERSIONED PRICING / NEW TASKS ONLY</span>
          <h2>话费设置</h2>
          <p>
            客户价格发布为不可变数据库版本；旧任务继续使用创建时快照，预约版本到期后由任务受理自动解析。
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
          刷新真实价格
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

      <section className="ops-metric-grid" aria-label="价格版本汇总">
        <MetricCard
          icon={Store}
          label="定价影楼"
          value={`${overview.studios.length} 家`}
          note={`${currentCount} 家有当前价格`}
        />
        <MetricCard
          icon={Layers3}
          label="预约版本"
          value={`${scheduledCount} 个`}
          note="按生效时间解析"
        />
        <MetricCard
          icon={CircleDollarSign}
          label="供应商阶梯"
          value={`${overview.supplierTiers.length} 档`}
          note="海南人像月度成本"
        />
        <MetricCard
          icon={ShieldCheck}
          label="任务计价原则"
          value="快照锁定"
          note="发布只影响新任务"
        />
      </section>

      <Panel
        title="发布客户价格版本"
        meta="先预览，再确认发布"
        className="ops-panel ops-pricing-composer"
      >
        <div
          className="ops-price-mode"
          role="tablist"
          aria-label="价格发布范围"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'UNIFORM'}
            className={mode === 'UNIFORM' ? 'is-active' : ''}
            onClick={() => {
              setMode('UNIFORM');
              setPreview(null);
            }}
          >
            统一价格<small>覆盖全部影楼</small>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'PER_STUDIO'}
            className={mode === 'PER_STUDIO' ? 'is-active' : ''}
            onClick={() => {
              setMode('PER_STUDIO');
              setPreview(null);
            }}
          >
            单影楼价格<small>只发布所选影楼</small>
          </button>
        </div>
        <div className="ops-price-form">
          {mode === 'PER_STUDIO' ? (
            <div className="ops-field ops-field-wide">
              <span>
                目标影楼 <i>*</i>
              </span>
              <UnifiedSelect
                ariaLabel="单影楼价格目标"
                value={studioId}
                placeholder="选择影楼"
                popupLabel="选择价格目标影楼"
                options={overview.studios.map((studio) => ({
                  value: studio.studioId,
                  label: `${studio.businessCode} · ${studio.name}`,
                  description: studio.currentPricing
                    ? `当前 ${formatRate(studio.currentPricing.voiceRate)} / 分钟`
                    : '当前未配置价格',
                }))}
                onValueChange={(value) => {
                  setStudioId(value);
                  const target = overview.studios.find(
                    (studio) => studio.studioId === value,
                  );
                  if (target?.currentPricing) {
                    setVoiceRate(trimMoney(target.currentPricing.voiceRate));
                    setSmsRate(trimMoney(target.currentPricing.smsRate));
                    setFrozenMinutes(
                      String(target.currentPricing.frozenMinutes),
                    );
                  }
                }}
              />
            </div>
          ) : (
            <div className="ops-price-impact ops-field-wide">
              <Sparkles aria-hidden="true" size={16} />
              <div>
                <b>
                  统一发布将为 {overview.studios.length}{' '}
                  家影楼各生成一个独立版本
                </b>
                <p>
                  包含已停用影楼，确保其未来启用时已有明确价格；发布前会显示完整影响清单。
                </p>
              </div>
            </div>
          )}
          <label className="ops-field">
            <span>
              话费单价（元 / 分钟） <i>*</i>
            </span>
            <input
              aria-label="客户话费单价"
              inputMode="decimal"
              value={voiceRate}
              onChange={(event) => setVoiceRate(event.target.value)}
            />
          </label>
          <label className="ops-field">
            <span>
              短信单价（元 / 条） <i>*</i>
            </span>
            <input
              aria-label="客户短信单价"
              inputMode="decimal"
              value={smsRate}
              onChange={(event) => setSmsRate(event.target.value)}
            />
          </label>
          <label className="ops-field">
            <span>
              每号码冻结分钟 <i>*</i>
            </span>
            <input
              aria-label="每号码冻结分钟"
              inputMode="numeric"
              value={frozenMinutes}
              onChange={(event) => setFrozenMinutes(event.target.value)}
            />
          </label>
          <div className="ops-field">
            <span>
              生效时间 <i>*</i>
            </span>
            <UnifiedSelect
              ariaLabel="价格生效时间"
              value={effectiveChoice}
              popupLabel="选择价格生效时间"
              options={[
                { value: 'NOW', label: '立即对新任务生效' },
                { value: 'TOMORROW', label: '明日 00:00（上海）' },
              ]}
              onValueChange={(value) =>
                setEffectiveChoice(value as EffectiveChoice)
              }
            />
          </div>
          <label className="ops-field ops-field-wide">
            <span>
              发布原因 <i>*</i>
            </span>
            <textarea
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
        </div>
        {actionError ? (
          <div className="ops-inline-error" role="alert">
            <AlertTriangle aria-hidden="true" size={14} />
            {actionError}
          </div>
        ) : null}
        <div className="ops-price-submit">
          <span>
            <ShieldCheck aria-hidden="true" size={13} />
            发布动作与每家影楼生成的版本均写入审计日志
          </span>
          <button
            type="button"
            className="primary-button"
            disabled={!input || previewing}
            onClick={() => void requestPreview()}
          >
            {previewing ? (
              <>
                <LoaderCircle
                  aria-hidden="true"
                  className="is-spinning"
                  size={13}
                />
                正在计算影响…
              </>
            ) : (
              '预览发布影响'
            )}
          </button>
        </div>
      </Panel>

      {error ? (
        <div className="ops-feedback is-error" role="alert">
          <AlertTriangle aria-hidden="true" size={16} />
          <div>
            <b>价格数据读取失败</b>
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => setRefreshToken((current) => current + 1)}
          >
            重试
          </button>
        </div>
      ) : null}

      <Panel
        title="影楼价格版本"
        meta={
          loading
            ? '正在读取数据库…'
            : `${currentCount} / ${overview.studios.length} 家已配置`
        }
        className="ops-panel"
      >
        <div className="table-wrap ops-table-wrap" aria-busy={loading}>
          <table className="data-table ops-pricing-table">
            <caption className="sr-only">真实影楼价格版本</caption>
            <thead>
              <tr>
                <th>影楼</th>
                <th>当前话费</th>
                <th>短信费</th>
                <th>冻结规则</th>
                <th>当前版本</th>
                <th>预约版本</th>
                <th>发布人与时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {loading && !overview.studios.length
                ? Array.from({ length: 4 }, (_, index) => (
                    <SkeletonRow key={index} />
                  ))
                : overview.studios.map((studio) => {
                    const current = studio.currentPricing;
                    const scheduled = studio.scheduledPricing;
                    return (
                      <tr key={studio.studioId}>
                        <td>
                          <b>{studio.name}</b>
                          <span className="table-meta">
                            {studio.businessCode}
                          </span>
                        </td>
                        <td>
                          {current ? (
                            <b className="ops-money">
                              {formatRate(current.voiceRate)} / 分钟
                            </b>
                          ) : (
                            <span className="ops-warning-copy">未配置</span>
                          )}
                        </td>
                        <td>
                          {current
                            ? `${formatRate(current.smsRate)} / 条`
                            : '—'}
                        </td>
                        <td>
                          {current
                            ? `${current.frozenMinutes} 分钟 / 号码`
                            : '—'}
                        </td>
                        <td>
                          {current ? (
                            <>
                              <Status tone="green">
                                v{current.version} ·{' '}
                                {current.sourceMode === 'UNIFORM'
                                  ? '统一'
                                  : '单影楼'}
                              </Status>
                              <span className="table-meta">
                                {formatDateTime(current.effectiveFrom)} 起
                              </span>
                            </>
                          ) : (
                            '—'
                          )}
                          <span className="table-meta">
                            历史 {studio.versions.length} 个版本
                          </span>
                        </td>
                        <td>
                          {scheduled ? (
                            <>
                              <Status tone="blue">
                                v{scheduled.version} 待生效
                              </Status>
                              <span className="table-meta">
                                {formatDateTime(scheduled.effectiveFrom)}
                              </span>
                              <b className="table-meta">
                                {formatRate(scheduled.voiceRate)} / 分钟
                              </b>
                            </>
                          ) : (
                            <span className="ops-muted">无预约版本</span>
                          )}
                        </td>
                        <td>
                          {current ? (
                            <>
                              <b>{current.publishedBy}</b>
                              <span className="table-meta">
                                {formatDateTime(current.publishedAt)}
                              </span>
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="ops-table-action"
                            onClick={() => configureStudio(studio.studioId)}
                          >
                            单独调价
                          </button>
                        </td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        title="海南人像供应成本阶梯"
        meta="数据库只读 · 月结成本口径"
        className="ops-panel ops-supplier-panel"
      >
        <div className="ops-supplier-intro">
          <CalendarClock aria-hidden="true" size={17} />
          <div>
            <b>供应价格与客户售价独立</b>
            <p>
              以下阶梯用于平台成本暂估与月末结算，本轮只移除浏览器
              localStorage，编辑审批将在后续账务子阶段开放。
            </p>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table ops-tier-table">
            <thead>
              <tr>
                <th>阶梯</th>
                <th>月度分钟范围</th>
                <th>话费成本</th>
                <th>短信成本</th>
                <th>生效时间</th>
                <th>发布人</th>
              </tr>
            </thead>
            <tbody>
              {overview.supplierTiers.map((tier) => (
                <tr key={tier.id}>
                  <td>
                    <b>{tier.name}</b>
                    <span className="table-meta">{tier.tierCode}</span>
                  </td>
                  <td>
                    {formatTierRange(
                      tier.minMonthlyMinutes,
                      tier.maxMonthlyMinutes,
                    )}
                  </td>
                  <td>
                    <b>{formatRate(tier.voiceRate)} / 分钟</b>
                  </td>
                  <td>{formatRate(tier.smsRate)} / 条</td>
                  <td>{formatDateTime(tier.effectiveFrom)}</td>
                  <td>{tier.publishedBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <PricingPreviewDialog
        preview={preview}
        selectedStudio={selectedStudio?.name ?? null}
        publishing={publishing}
        error={actionError}
        onClose={() => {
          if (!publishing) setPreview(null);
        }}
        onPublish={() => void confirmPublish()}
      />
    </>
  );
}

function PricingPreviewDialog({
  preview,
  selectedStudio,
  publishing,
  error,
  onClose,
  onPublish,
}: {
  preview: PricingPreview | null;
  selectedStudio: string | null;
  publishing: boolean;
  error: string;
  onClose: () => void;
  onPublish: () => void;
}) {
  return (
    <Dialog
      open={Boolean(preview)}
      onOpenChange={(open) => {
        if (!open && !publishing) onClose();
      }}
    >
      <DialogContent className="ops-dialog ops-price-preview-dialog">
        <DialogHeader>
          <span className="ops-dialog-kicker">PUBLISH PREVIEW</span>
          <DialogTitle>确认价格版本影响</DialogTitle>
          <DialogDescription>
            {preview
              ? `${preview.mode === 'UNIFORM' ? '统一价格' : (selectedStudio ?? '单影楼价格')} · ${preview.affectedStudioCount} 家影楼 · ${formatDateTime(preview.effectiveFrom)} 生效`
              : '正在计算'}
          </DialogDescription>
        </DialogHeader>
        {preview ? (
          <div className="ops-preview-body">
            <div className="ops-preview-seal">
              <ShieldCheck aria-hidden="true" size={16} />
              <div>
                <b>发布后价格字段不可修改</b>
                <p>需要变更时再次发布新版本；已创建任务继续使用原价格快照。</p>
              </div>
            </div>
            <div className="table-wrap">
              <table className="data-table ops-preview-table">
                <thead>
                  <tr>
                    <th>影楼</th>
                    <th>当前话费</th>
                    <th>新话费</th>
                    <th>短信费</th>
                    <th>冻结分钟</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.items.map((item) => (
                    <tr key={item.studioId}>
                      <td>
                        <b>{item.studioName}</b>
                        <span className="table-meta">{item.businessCode}</span>
                      </td>
                      <td>
                        {item.currentVoiceRate
                          ? formatRate(item.currentVoiceRate)
                          : '未配置'}
                      </td>
                      <td>
                        <b className="ops-amount-positive">
                          {formatRate(item.nextVoiceRate)}
                        </b>
                      </td>
                      <td>{formatRate(item.nextSmsRate)}</td>
                      <td>{item.nextFrozenMinutes} 分钟</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
            disabled={publishing}
            onClick={onClose}
          >
            返回修改
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={publishing}
            onClick={onPublish}
          >
            {publishing ? (
              <>
                <LoaderCircle
                  aria-hidden="true"
                  className="is-spinning"
                  size={13}
                />
                正在发布…
              </>
            ) : (
              '确认发布版本'
            )}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function buildPublishInput({
  mode,
  studioId,
  voiceRate,
  smsRate,
  frozenMinutes,
  effectiveChoice,
  reason,
}: {
  mode: PriceMode;
  studioId: string;
  voiceRate: string;
  smsRate: string;
  frozenMinutes: string;
  effectiveChoice: EffectiveChoice;
  reason: string;
}): PublishPricingInput | null {
  const minutes = Number(frozenMinutes);
  if (
    !(Number(voiceRate) > 0) ||
    Number(smsRate) < 0 ||
    !Number.isInteger(minutes) ||
    minutes <= 0 ||
    minutes > 120 ||
    reason.trim().length < 2
  )
    return null;
  const rate = { voiceRate, smsRate, frozenMinutes: minutes };
  const effectiveFrom =
    effectiveChoice === 'NOW'
      ? new Date().toISOString()
      : tomorrowShanghaiStart();
  if (mode === 'UNIFORM')
    return { mode, rate, effectiveFrom, reason: reason.trim() };
  if (!studioId) return null;
  return {
    mode,
    entries: [{ studioId, rate }],
    effectiveFrom,
    reason: reason.trim(),
  };
}

function tomorrowShanghaiStart() {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const dateKey = (value: Date) => {
    const parts = formatter.formatToParts(value);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((item) => item.type === type)!.value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  };
  const noon = new Date(`${dateKey(new Date())}T12:00:00+08:00`);
  noon.setUTCDate(noon.getUTCDate() + 1);
  return `${dateKey(noon)}T00:00:00+08:00`;
}
function MetricCard({
  icon: Icon,
  label,
  value,
  note,
}: {
  icon: typeof Store;
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
function formatRate(value: string) {
  const rate = Number(value);
  return Number.isFinite(rate) ? `¥${rate.toFixed(2)}` : '—';
}
function trimMoney(value: string) {
  return String(Number(value));
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
function formatTierRange(minimum: string, maximum: string | null) {
  const min = Number(minimum).toLocaleString('zh-CN');
  return maximum
    ? `${min}（含）— ${Number(maximum).toLocaleString('zh-CN')}（不含）分钟`
    : `≥ ${min} 分钟`;
}
function apiErrorMessage(error: unknown) {
  if (error instanceof PlatformApiError)
    return `${error.message}${error.requestId ? `（请求 ${error.requestId}）` : ''}`;
  return error instanceof Error ? error.message : '平台 API 请求失败';
}

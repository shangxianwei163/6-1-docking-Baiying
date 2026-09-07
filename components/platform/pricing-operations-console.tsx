'use client';

import { type KeyboardEvent, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookCheck,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  FileCheck2,
  Fingerprint,
  Layers3,
  LockKeyhole,
  LoaderCircle,
  RefreshCw,
  Scale,
  ShieldCheck,
  Sparkles,
  Store,
} from 'lucide-react';
import type {
  OperatorSupplierPricingTier,
  PricingOverview,
  PricingPreview,
  PublishPricingInput,
  SupplierSettlementIssue,
  SupplierSettlementSummary,
} from '@outbound/contracts';
import {
  finalizeSupplierSettlement,
  loadPricingOverview,
  loadSupplierSettlementPreview,
  PlatformApiError,
  previewPricing,
  publishPricing,
} from '@/lib/platform-api';
import { formatTenThousandMinuteRange } from '@/lib/pricing-units';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { UnifiedSelect } from '@/components/ui/unified-select';
import { SupplierPricingEditor } from './supplier-pricing-editor';
import { Panel, Status } from './shared';

const emptyOverview: PricingOverview = {
  studios: [],
  supplierTiers: [],
  scheduledSupplierTiers: [],
  supplierTierVersionCount: 0,
};
type PriceMode = 'UNIFORM' | 'PER_STUDIO';
type EffectiveChoice = 'NOW' | 'TOMORROW';
type PricingScope = 'STUDIO' | 'HAINAN';

export function PricingOperationsConsole() {
  const [overview, setOverview] = useState(emptyOverview);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [supplierFeedback, setSupplierFeedback] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);
  const [scope, setScope] = useState<PricingScope>('STUDIO');
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

  const handleScopeKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    let nextScope: PricingScope | null = null;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      nextScope = scope === 'STUDIO' ? 'HAINAN' : 'STUDIO';
    } else if (event.key === 'Home') {
      nextScope = 'STUDIO';
    } else if (event.key === 'End') {
      nextScope = 'HAINAN';
    }
    if (!nextScope) return;

    event.preventDefault();
    setScope(nextScope);
    window.requestAnimationFrame(() => {
      document
        .getElementById(
          nextScope === 'STUDIO' ? 'pricing-tab-studio' : 'pricing-tab-hainan',
        )
        ?.focus();
    });
  };

  const supplierTierRows = mergeSupplierTierVersions(
    overview.supplierTiers,
    overview.scheduledSupplierTiers,
  );

  return (
    <section className="pricing-operations-page">
      <header className="ops-page-intro">
        <div>
          <span>VERSIONED PRICING / NEW TASKS ONLY</span>
          <h2>话费设置</h2>
          <p>
            影楼客户售价与海南人像供应成本分账管理；价格版本保持不可变，旧任务继续使用创建时快照。
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
          {scope === 'STUDIO' ? '刷新影楼价格' : '刷新海南人像价格'}
        </button>
      </header>

      <div
        className="pricing-scope-tabs"
        role="tablist"
        aria-label="话费设置分类"
        aria-orientation="horizontal"
      >
        <button
          id="pricing-tab-studio"
          type="button"
          role="tab"
          aria-selected={scope === 'STUDIO'}
          aria-controls="pricing-panel-studio"
          tabIndex={scope === 'STUDIO' ? 0 : -1}
          className={scope === 'STUDIO' ? 'is-active' : ''}
          onClick={() => setScope('STUDIO')}
          onKeyDown={handleScopeKeyDown}
        >
          <span className="pricing-scope-icon">
            <Store aria-hidden="true" size={17} />
          </span>
          <span className="pricing-scope-copy">
            <b>影楼话费</b>
            <small>客户售价发布 · 影楼价格版本</small>
          </span>
          <em>
            {currentCount}/{overview.studios.length} 家已定价
          </em>
        </button>
        <button
          id="pricing-tab-hainan"
          type="button"
          role="tab"
          aria-selected={scope === 'HAINAN'}
          aria-controls="pricing-panel-hainan"
          tabIndex={scope === 'HAINAN' ? 0 : -1}
          className={scope === 'HAINAN' ? 'is-active' : ''}
          onClick={() => setScope('HAINAN')}
          onKeyDown={handleScopeKeyDown}
        >
          <span className="pricing-scope-icon">
            <CircleDollarSign aria-hidden="true" size={17} />
          </span>
          <span className="pricing-scope-copy">
            <b>海南人像话费</b>
            <small>供应商成本阶梯 · 月度结算</small>
          </span>
          <em>
            {overview.supplierTiers.length} 启用 ·{' '}
            {overview.scheduledSupplierTiers.length} 待启用
          </em>
        </button>
      </div>

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

      <section
        id="pricing-panel-studio"
        className="pricing-tab-panel"
        role="tabpanel"
        aria-labelledby="pricing-tab-studio"
        tabIndex={0}
        hidden={scope !== 'STUDIO'}
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

        <section
          className="ops-metric-grid pricing-metric-grid"
          aria-label="影楼话费汇总"
        >
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
      </section>

      <section
        id="pricing-panel-hainan"
        className="pricing-tab-panel"
        role="tabpanel"
        aria-labelledby="pricing-tab-hainan"
        tabIndex={0}
        hidden={scope !== 'HAINAN'}
      >
        <section
          className="ops-metric-grid pricing-metric-grid"
          aria-label="海南人像话费汇总"
        >
          <MetricCard
            icon={CircleDollarSign}
            label="供应商阶梯"
            value={`${supplierTierRows.length} 档`}
            note={`${overview.supplierTiers.length} 启用中 · ${overview.scheduledSupplierTiers.length} 待启用`}
          />
          <MetricCard
            icon={CalendarClock}
            label="结算周期"
            value="自然月"
            note="Asia/Shanghai 口径"
          />
          <MetricCard
            icon={LockKeyhole}
            label="封账控制"
            value="核对锁定"
            note="存在差异时阻断提交"
          />
        </section>

        {supplierFeedback ? (
          <output className="ops-feedback is-success">
            <CheckCircle2 aria-hidden="true" size={16} />
            <span>{supplierFeedback}</span>
            <button type="button" onClick={() => setSupplierFeedback('')}>
              关闭
            </button>
          </output>
        ) : null}

        <SupplierSettlementConsole />

        <Panel
          title="海南人像供应成本阶梯"
          meta="运营人工维护 · 月结成本口径"
          className="ops-panel ops-supplier-panel"
        >
          <div className="ops-supplier-intro supplier-pricing-maintenance">
            <CalendarClock aria-hidden="true" size={17} />
            <div>
              <b>无外部价格接口，由运营确认后发布</b>
              <p>
                每次维护完整阶梯并按自然月版本化生效；历史月份继续使用原价格，所有发布动作写入审计日志。
              </p>
            </div>
            <SupplierPricingEditor
              currentTiers={overview.supplierTiers}
              scheduledTiers={overview.scheduledSupplierTiers}
              onPublished={(result) => {
                setSupplierFeedback(
                  `海南人像供应价格已发布：${result.published.length} 档，${formatDateTime(result.effectiveFrom)} 生效。`,
                );
                setRefreshToken((current) => current + 1);
              }}
            />
          </div>
          {overview.scheduledSupplierTiers.length ? (
            <output className="supplier-pricing-scheduled">
              <CalendarClock aria-hidden="true" size={14} />
              <div>
                <b>
                  已预约 {overview.scheduledSupplierTiers.length} 档供应价格
                </b>
                <span>
                  新版本已列入下方列表，将于{' '}
                  {formatDateTime(
                    overview.scheduledSupplierTiers[0]!.effectiveFrom,
                  )}{' '}
                  启用；再次发布将替换这组预约。
                </span>
              </div>
            </output>
          ) : null}
          <div className="table-wrap">
            <table className="data-table ops-tier-table">
              <thead>
                <tr>
                  <th>阶梯</th>
                  <th>状态</th>
                  <th>月度用量范围（万分钟）</th>
                  <th>话费成本</th>
                  <th>短信成本</th>
                  <th>生效时间</th>
                  <th>发布人</th>
                </tr>
              </thead>
              <tbody>
                {supplierTierRows.length ? (
                  supplierTierRows.map(({ tierCode, current, scheduled }) => {
                    const tier = scheduled ?? current!;
                    return (
                      <tr
                        key={tierCode}
                        className={
                          scheduled
                            ? current
                              ? 'has-scheduled'
                              : 'is-scheduled'
                            : ''
                        }
                      >
                        <td>
                          <b>{tier.name}</b>
                          <span className="table-meta">{tierCode}</span>
                        </td>
                        <td>
                          <span className="supplier-status-stack">
                            {current ? (
                              <Status tone="green">启用中</Status>
                            ) : null}
                            {scheduled ? (
                              <Status tone="blue">待启用</Status>
                            ) : null}
                          </span>
                        </td>
                        <td>
                          <SupplierTierComparisonValue
                            currentValue={
                              current
                                ? formatTierRange(
                                    current.minMonthlyMinutes,
                                    current.maxMonthlyMinutes,
                                  )
                                : null
                            }
                            scheduledValue={
                              scheduled
                                ? formatTierRange(
                                    scheduled.minMonthlyMinutes,
                                    scheduled.maxMonthlyMinutes,
                                  )
                                : null
                            }
                          />
                        </td>
                        <td>
                          <SupplierTierComparisonValue
                            currentValue={
                              current
                                ? `${formatRate(current.voiceRate)} / 分钟`
                                : null
                            }
                            scheduledValue={
                              scheduled
                                ? `${formatRate(scheduled.voiceRate)} / 分钟`
                                : null
                            }
                            emphasized
                          />
                        </td>
                        <td>
                          <SupplierTierComparisonValue
                            currentValue={
                              current
                                ? `${formatRate(current.smsRate)} / 条`
                                : null
                            }
                            scheduledValue={
                              scheduled
                                ? `${formatRate(scheduled.smsRate)} / 条`
                                : null
                            }
                          />
                        </td>
                        <td>
                          <SupplierVersionStack
                            current={
                              current
                                ? formatDateTime(current.effectiveFrom)
                                : null
                            }
                            scheduled={
                              scheduled
                                ? formatDateTime(scheduled.effectiveFrom)
                                : null
                            }
                          />
                        </td>
                        <td>
                          <SupplierPublisherStack
                            current={current?.publishedBy ?? null}
                            scheduled={scheduled?.publishedBy ?? null}
                          />
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={7} className="table-empty-cell">
                      尚未配置供应价格，请点击“维护供应价格”创建首个完整阶梯版本。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </section>

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
    </section>
  );
}

function SupplierSettlementConsole() {
  const [month, setMonth] = useState(previousShanghaiMonth);
  const [summary, setSummary] = useState<SupplierSettlementSummary | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [finalizing, setFinalizing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [reason, setReason] = useState('月度账务核对无误，执行供应商成本封账');
  const [refreshToken, setRefreshToken] = useState(0);
  const [observedAt, setObservedAt] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setLoading(true);
        setError('');
      }
    });
    void loadSupplierSettlementPreview(month)
      .then((result) => {
        if (!cancelled) {
          setSummary(result);
          setObservedAt(Date.now());
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          setSummary(null);
          setError(apiErrorMessage(caught));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [month, refreshToken]);

  const monthClosed = summary
    ? new Date(summary.periodEnd).getTime() <= observedAt
    : false;
  const emptyMonth = Boolean(
    summary &&
    summary.taskCount === 0 &&
    summary.reconciliation.status === 'BALANCED',
  );
  const canFinalize = Boolean(
    summary &&
    summary.taskCount > 0 &&
    summary.status === 'OPEN' &&
    summary.reconciliation.status === 'BALANCED' &&
    summary.tier &&
    monthClosed,
  );

  const confirmFinalize = async () => {
    if (!summary || !canFinalize || finalizing || reason.trim().length < 2)
      return;
    setFinalizing(true);
    setError('');
    try {
      const result = await finalizeSupplierSettlement(month, {
        expectedSourceHash: summary.sourceHash,
        reason: reason.trim(),
        idempotencyKey: crypto.randomUUID(),
      });
      setSummary(result);
      setFeedback(
        result.idempotentReplay
          ? `${month} 已完成封账，本次返回原结算结果。`
          : `${month} 供应商成本已封账，${result.taskCount} 个任务已锁定最终成本与利润。`,
      );
      setConfirmOpen(false);
    } catch (caught) {
      setError(apiErrorMessage(caught));
      if (
        caught instanceof PlatformApiError &&
        caught.code === 'SETTLEMENT_PREVIEW_STALE'
      ) {
        setConfirmOpen(false);
      }
    } finally {
      setFinalizing(false);
    }
  };

  return (
    <>
      <Panel
        title="供应商月度结算"
        meta="Asia/Shanghai · 先核对后封账"
        className="ops-panel ops-settlement-panel"
      >
        <div className="ops-settlement-command">
          <div>
            <span>MONTH-END CONTROL</span>
            <b>把客户账、通话明细与供应成本锁在同一月度凭证中</b>
            <p>
              封账前实时重算；有结算任务的月份若账务不平、供应阶梯缺失或月份尚未结束，系统都会阻断。
            </p>
          </div>
          <div className="ops-settlement-controls">
            <label className="ops-field">
              <span>结算月份</span>
              <input
                aria-label="供应商结算月份"
                type="month"
                max={currentShanghaiMonth()}
                value={month}
                onChange={(event) => {
                  setMonth(event.target.value);
                  setSummary(null);
                  setFeedback('');
                  setError('');
                }}
              />
            </label>
            <button
              type="button"
              className="ops-icon-button"
              disabled={loading || !month}
              onClick={() => setRefreshToken((current) => current + 1)}
            >
              {loading ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="is-spinning"
                  size={14}
                />
              ) : (
                <RefreshCw aria-hidden="true" size={14} />
              )}
              {loading ? '正在核对…' : '重新核对'}
            </button>
          </div>
        </div>

        {feedback ? (
          <output className="ops-settlement-feedback">
            <CheckCircle2 aria-hidden="true" size={15} />
            <span>{feedback}</span>
            <button type="button" onClick={() => setFeedback('')}>
              关闭
            </button>
          </output>
        ) : null}

        {error ? (
          <div className="ops-inline-error ops-settlement-error" role="alert">
            <AlertTriangle aria-hidden="true" size={14} />
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setRefreshToken((current) => current + 1)}
            >
              重新预览
            </button>
          </div>
        ) : null}

        {loading && !summary ? (
          <div className="ops-settlement-empty" aria-live="polite">
            <LoaderCircle
              aria-hidden="true"
              className="is-spinning"
              size={20}
            />
            <b>正在生成 {month} 对账快照</b>
            <p>汇总任务、通话、资金流水和供应商阶梯。</p>
          </div>
        ) : summary ? (
          <div className="ops-settlement-body">
            <div className="ops-settlement-status-row">
              <div>
                <Status
                  tone={
                    summary.status === 'FINALIZED'
                      ? 'green'
                      : emptyMonth
                        ? 'gray'
                        : 'blue'
                  }
                >
                  {summary.status === 'FINALIZED'
                    ? '已封账'
                    : emptyMonth
                      ? monthClosed
                        ? '无需封账'
                        : '动态预估'
                      : '待封账'}
                </Status>
                {emptyMonth ? (
                  <Status tone="gray">0 个任务</Status>
                ) : (
                  <Status
                    tone={
                      summary.reconciliation.status === 'BALANCED'
                        ? 'green'
                        : 'red'
                    }
                  >
                    {summary.reconciliation.status === 'BALANCED'
                      ? '账务平衡'
                      : `${summary.reconciliation.discrepancyCount} 项差异`}
                  </Status>
                )}
                {!monthClosed && summary.status === 'OPEN' ? (
                  <Status tone="amber">月份进行中</Status>
                ) : null}
              </div>
              <span>
                数据指纹
                <code title={summary.sourceHash}>
                  {summary.sourceHash.slice(0, 12)}…
                </code>
              </span>
            </div>

            <div className="ops-settlement-ledger">
              <SettlementFact
                icon={BookCheck}
                label="纳入任务"
                value={`${summary.taskCount.toLocaleString('zh-CN')} 个`}
                note={`${formatInteger(summary.totalBillingMinutes)} 计费分钟`}
              />
              <SettlementFact
                icon={CircleDollarSign}
                label="客户话费收入"
                value={formatMoney(summary.totalCustomerCharge)}
                note="已结算任务收入"
              />
              <SettlementFact
                icon={Scale}
                label="供应商成本"
                value={
                  emptyMonth
                    ? formatMoney(summary.totalPlatformCost)
                    : summary.tier
                      ? formatMoney(summary.totalPlatformCost)
                      : '—'
                }
                note={
                  emptyMonth
                    ? '无任务，不产生供应商成本'
                    : summary.tier
                      ? `${summary.tier.name} · ${formatRate(summary.tier.voiceRate)}/分`
                      : '未匹配完整月阶梯'
                }
                tone={emptyMonth || summary.tier ? 'default' : 'warning'}
              />
              <SettlementFact
                icon={FileCheck2}
                label="平台毛利"
                value={
                  emptyMonth
                    ? formatMoney(summary.totalProfit)
                    : summary.tier
                      ? formatMoney(summary.totalProfit)
                      : '—'
                }
                note={
                  emptyMonth
                    ? '无任务，无需计算毛利'
                    : summary.tier
                      ? '客户收入 − 供应成本'
                      : '供应成本确定后计算'
                }
                tone={
                  emptyMonth ||
                  (summary.tier && Number(summary.totalProfit) >= 0)
                    ? 'profit'
                    : 'warning'
                }
              />
            </div>

            <div
              className={`ops-settlement-reconciliation ${emptyMonth ? 'is-empty' : summary.reconciliation.status === 'BALANCED' ? 'is-balanced' : 'is-blocked'}`}
            >
              {emptyMonth || summary.reconciliation.status === 'BALANCED' ? (
                <CheckCircle2 aria-hidden="true" size={17} />
              ) : (
                <AlertTriangle aria-hidden="true" size={17} />
              )}
              <div>
                <b>
                  {emptyMonth
                    ? monthClosed
                      ? '本月无结算任务'
                      : '当前暂无结算任务'
                    : summary.reconciliation.status === 'BALANCED'
                      ? '四方账务核对一致'
                      : '存在封账阻断项'}
                </b>
                <p>
                  {emptyMonth
                    ? monthClosed
                      ? '该月份没有已结算任务，无需配置供应阶梯，也无需生成供应商月结单。'
                      : '该月份仍在进行中，目前没有已结算任务；后续有任务时将自动参与动态核对。'
                    : summary.reconciliation.status === 'BALANCED'
                      ? '任务汇总、通话明细、账户流水和冻结资金守恒，可进入人工确认。'
                      : `${summary.reconciliation.blockingTaskCount} 个任务受影响；修复差异并重新预览后才能封账。`}
                </p>
                {summary.reconciliation.issues.length ? (
                  <ul>
                    {summary.reconciliation.issues
                      .slice(0, 5)
                      .map((issue, index) => (
                        <li
                          key={`${issue.code}-${issue.taskNo ?? 'month'}-${index}`}
                        >
                          <span>{settlementIssueLabel(issue)}</span>
                          <p>{issue.message}</p>
                        </li>
                      ))}
                  </ul>
                ) : null}
                {summary.reconciliation.issuesTruncated ||
                summary.reconciliation.issues.length > 5 ? (
                  <small>
                    仅展示前 5 项，请通过接口或日志查看完整差异清单。
                  </small>
                ) : null}
              </div>
            </div>

            <div className="ops-settlement-submit">
              <div>
                <LockKeyhole aria-hidden="true" size={14} />
                <span>
                  {summary.status === 'FINALIZED'
                    ? `${summary.finalizedBy ?? '未知操作员'} 于 ${summary.finalizedAt ? formatDateTime(summary.finalizedAt) : '未知时间'} 完成封账`
                    : settlementReadinessCopy(summary, monthClosed)}
                </span>
              </div>
              {summary.status === 'FINALIZED' ? (
                <span className="ops-settlement-id">
                  结算凭证 {summary.settlementId}
                </span>
              ) : emptyMonth ? (
                <span className="ops-settlement-id">
                  {monthClosed ? '无需生成结算凭证' : '暂无可封账任务'}
                </span>
              ) : (
                <button
                  type="button"
                  className="primary-button"
                  disabled={!canFinalize}
                  onClick={() => setConfirmOpen(true)}
                >
                  <Fingerprint aria-hidden="true" size={13} />
                  核对并封账
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="ops-settlement-empty">
            <AlertTriangle aria-hidden="true" size={20} />
            <b>暂无可展示的月度快照</b>
            <p>选择月份后重新预览。</p>
          </div>
        )}
      </Panel>

      <Dialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!finalizing) setConfirmOpen(open);
        }}
      >
        <DialogContent className="ops-dialog ops-settlement-dialog">
          <DialogHeader>
            <span className="ops-dialog-kicker">IRREVERSIBLE CLOSE</span>
            <DialogTitle>确认封账 {month}</DialogTitle>
            <DialogDescription>
              将当前数据指纹对应的任务成本与利润固化为月度凭证。
            </DialogDescription>
          </DialogHeader>
          {summary ? (
            <div className="ops-settlement-confirm">
              <div className="ops-settlement-warning">
                <LockKeyhole aria-hidden="true" size={17} />
                <div>
                  <b>封账结果不可编辑或覆盖</b>
                  <p>
                    如果预览后源数据发生变化，服务端会拒绝本次请求并要求重新核对。
                  </p>
                </div>
              </div>
              <dl>
                <div>
                  <dt>客户收入</dt>
                  <dd>{formatMoney(summary.totalCustomerCharge)}</dd>
                </div>
                <div>
                  <dt>供应商成本</dt>
                  <dd>{formatMoney(summary.totalPlatformCost)}</dd>
                </div>
                <div>
                  <dt>平台毛利</dt>
                  <dd>{formatMoney(summary.totalProfit)}</dd>
                </div>
                <div>
                  <dt>供应阶梯</dt>
                  <dd>{summary.tier?.name ?? '未匹配'}</dd>
                </div>
                <div className="is-wide">
                  <dt>数据指纹</dt>
                  <dd className="is-code">{summary.sourceHash}</dd>
                </div>
              </dl>
              <label className="ops-field">
                <span>
                  封账原因 <i>*</i>
                </span>
                <textarea
                  rows={3}
                  maxLength={500}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              {error ? (
                <div className="ops-inline-error" role="alert">
                  <AlertTriangle aria-hidden="true" size={14} />
                  {error}
                </div>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <button
              type="button"
              className="filter-button"
              disabled={finalizing}
              onClick={() => setConfirmOpen(false)}
            >
              返回核对
            </button>
            <button
              type="button"
              className="ops-danger-button"
              disabled={finalizing || reason.trim().length < 2}
              onClick={() => void confirmFinalize()}
            >
              {finalizing ? (
                <>
                  <LoaderCircle
                    aria-hidden="true"
                    className="is-spinning"
                    size={13}
                  />
                  正在封账…
                </>
              ) : (
                <>
                  <LockKeyhole aria-hidden="true" size={13} />
                  确认不可逆封账
                </>
              )}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SettlementFact({
  icon: Icon,
  label,
  value,
  note,
  tone = 'default',
}: {
  icon: typeof Store;
  label: string;
  value: string;
  note: string;
  tone?: 'default' | 'profit' | 'warning';
}) {
  return (
    <article className={`ops-settlement-fact is-${tone}`}>
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

function settlementIssueLabel(issue: SupplierSettlementIssue) {
  return (
    {
      TASK_NOT_SETTLED: '任务未结算',
      TASK_CALL_MINUTES_MISMATCH: '分钟数不一致',
      TASK_CUSTOMER_CHARGE_MISMATCH: '客户话费不一致',
      TASK_LEDGER_CHARGE_MISMATCH: '账户流水不一致',
      TASK_HOLD_CONSERVATION_MISMATCH: '冻结资金不守恒',
      TASK_HOLD_NOT_CLOSED: '冻结资金未关闭',
      SUPPLIER_TIER_NOT_FOUND: '供应阶梯缺失',
      SUPPLIER_TIER_OVERLAP: '供应阶梯重叠',
      FINALIZED_SOURCE_DRIFT: '封账后数据漂移',
    } satisfies Record<SupplierSettlementIssue['code'], string>
  )[issue.code];
}

function settlementReadinessCopy(
  summary: SupplierSettlementSummary,
  monthClosed: boolean,
) {
  if (summary.taskCount === 0) {
    return monthClosed
      ? '本月无结算任务，无需封账'
      : '当前月份暂无结算任务，后续将随任务完成动态更新';
  }
  if (!monthClosed) return '当前月份尚未结束，只能查看动态预估，不能封账';
  if (!summary.tier) return '该月份没有可覆盖完整自然月的供应商阶梯';
  if (summary.reconciliation.status === 'BLOCKED')
    return '账务差异尚未清零，封账操作已被阻断';
  return '预览结果已平衡；最终提交时服务端会再次加锁核对';
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
function formatMoney(value: string) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  const absolute = Math.abs(amount).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${amount < 0 ? '-' : ''}¥${absolute}`;
}
function formatInteger(value: string) {
  try {
    return BigInt(value).toLocaleString('zh-CN');
  } catch {
    return value;
  }
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
  return formatTenThousandMinuteRange(minimum, maximum);
}
function mergeSupplierTierVersions(
  currentTiers: OperatorSupplierPricingTier[],
  scheduledTiers: OperatorSupplierPricingTier[],
) {
  const rows = new Map<
    string,
    {
      tierCode: string;
      current: OperatorSupplierPricingTier | null;
      scheduled: OperatorSupplierPricingTier | null;
    }
  >();
  currentTiers.forEach((tier) => {
    rows.set(tier.tierCode, {
      tierCode: tier.tierCode,
      current: tier,
      scheduled: null,
    });
  });
  scheduledTiers.forEach((tier) => {
    const existing = rows.get(tier.tierCode);
    rows.set(tier.tierCode, {
      tierCode: tier.tierCode,
      current: existing?.current ?? null,
      scheduled: tier,
    });
  });
  return [...rows.values()];
}
function SupplierTierComparisonValue({
  currentValue,
  scheduledValue,
  emphasized = false,
}: {
  currentValue: string | null;
  scheduledValue: string | null;
  emphasized?: boolean;
}) {
  if (currentValue && scheduledValue && currentValue !== scheduledValue) {
    return (
      <span className="supplier-comparison-value is-changed">
        <span>
          <small>当前</small>
          <b className={emphasized ? 'is-emphasized' : ''}>{currentValue}</b>
        </span>
        <i aria-hidden="true">→</i>
        <span>
          <small>待启用</small>
          <b className={emphasized ? 'is-emphasized' : ''}>{scheduledValue}</b>
        </span>
      </span>
    );
  }

  const value = scheduledValue ?? currentValue ?? '—';
  return (
    <span className="supplier-comparison-value">
      <b className={emphasized ? 'is-emphasized' : ''}>{value}</b>
      <small>
        {currentValue && scheduledValue
          ? '预约沿用'
          : scheduledValue
            ? '新增'
            : '当前版本'}
      </small>
    </span>
  );
}
function SupplierVersionStack({
  current,
  scheduled,
}: {
  current: string | null;
  scheduled: string | null;
}) {
  return (
    <span className="supplier-version-stack">
      {current ? (
        <span>
          <small>启用</small>
          {current}
        </span>
      ) : null}
      {scheduled ? (
        <span>
          <small>待启用</small>
          {scheduled}
        </span>
      ) : null}
    </span>
  );
}
function SupplierPublisherStack({
  current,
  scheduled,
}: {
  current: string | null;
  scheduled: string | null;
}) {
  return (
    <span className="supplier-publisher">
      {current ? <SupplierPublisher value={current} status="启用" /> : null}
      {scheduled ? (
        <SupplierPublisher value={scheduled} status="待启用" />
      ) : null}
    </span>
  );
}
function SupplierPublisher({
  value,
  status,
}: {
  value: string;
  status: string;
}) {
  const publisher = supplierPublisher(value);
  return (
    <span>
      <small>{status}</small>
      <b>{publisher.label}</b>
      <em>{publisher.detail}</em>
    </span>
  );
}
function supplierPublisher(value: string) {
  if (value === 'phase1-static-import') {
    return { label: '系统初始化导入', detail: '历史配置迁移' };
  }
  if (value === 'platform-admin') {
    return { label: '平台管理员', detail: '运营后台发布' };
  }
  return { label: value, detail: '操作账号' };
}
function currentShanghaiMonth() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)!.value;
  return `${value('year')}-${value('month')}`;
}
function previousShanghaiMonth() {
  const [year, month] = currentShanghaiMonth().split('-').map(Number);
  const previous = new Date(Date.UTC(year!, month! - 2, 1));
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}`;
}
function apiErrorMessage(error: unknown) {
  if (error instanceof PlatformApiError)
    return `${error.message}${error.requestId ? `（请求 ${error.requestId}）` : ''}`;
  return error instanceof Error ? error.message : '平台 API 请求失败';
}

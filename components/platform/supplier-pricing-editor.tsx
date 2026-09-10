'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  LoaderCircle,
  PencilLine,
  Plus,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import {
  publishSupplierPricingInputSchema,
  type OperatorSupplierPricingTier,
  type PublishSupplierPricingInput,
  type SupplierPricingPreview,
  type SupplierPricingPublishResult,
} from '@outbound/contracts';
import {
  PlatformApiError,
  previewSupplierPricing,
  publishSupplierPricing,
} from '@/lib/platform-api';
import {
  formatTenThousandMinuteRange,
  minutesToTenThousands,
  tenThousandsToMinutes,
} from '@/lib/pricing-units';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { UnifiedDatePicker } from '@/components/ui/unified-date-picker';

type EditableTier = {
  tierCode: string;
  name: string;
  minMonthlyMinutes: string;
  maxMonthlyMinutes: string;
  voiceRate: string;
  smsRate: string;
};

type SupplierPricingField = keyof EditableTier | 'effectiveMonth' | 'reason';

type ValidationFeedback = {
  title: string;
  detail: string;
  tierIndex?: number;
  field?: SupplierPricingField;
};

export function SupplierPricingEditor({
  currentTiers,
  scheduledTiers,
  onPublished,
}: {
  currentTiers: OperatorSupplierPricingTier[];
  scheduledTiers: OperatorSupplierPricingTier[];
  onPublished: (result: SupplierPricingPublishResult) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tiers, setTiers] = useState<EditableTier[]>([]);
  const [effectiveMonth, setEffectiveMonth] = useState(currentShanghaiMonth);
  const [reason, setReason] = useState('根据海南人像最新供应报价调整月度成本');
  const [preview, setPreview] = useState<SupplierPricingPreview | null>(null);
  const [preparedInput, setPreparedInput] =
    useState<PublishSupplierPricingInput | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');

  const candidate = useMemo(
    () => ({
      effectiveFrom: effectiveMonth
        ? new Date(`${effectiveMonth}-01T00:00:00+08:00`).toISOString()
        : '',
      reason,
      tiers: tiers.map((tier) => ({
        tierCode: tier.tierCode,
        name: tier.name,
        minMonthlyMinutes: tenThousandsToMinutes(tier.minMonthlyMinutes),
        maxMonthlyMinutes: tier.maxMonthlyMinutes.trim()
          ? tenThousandsToMinutes(tier.maxMonthlyMinutes)
          : null,
        voiceRate: tier.voiceRate,
        smsRate: tier.smsRate,
      })),
    }),
    [effectiveMonth, reason, tiers],
  );
  const validation = useMemo(
    () => publishSupplierPricingInputSchema.safeParse(candidate),
    [candidate],
  );
  const validationFeedback = useMemo(
    () =>
      validation.success
        ? null
        : supplierPricingValidationFeedback(validation.error.issues[0]),
    [validation],
  );

  const validationProps = (field: SupplierPricingField, tierIndex?: number) =>
    validationFeedback?.field === field &&
    validationFeedback.tierIndex === tierIndex
      ? {
          'aria-describedby': 'supplier-pricing-validation',
          'aria-invalid': true as const,
        }
      : {};

  const beginEditing = () => {
    const baseline = supplierPricingEditingBaseline(
      currentTiers,
      scheduledTiers,
    );
    setTiers(baseline.map(toEditableTier));
    setEffectiveMonth(
      scheduledTiers[0]
        ? shanghaiMonth(scheduledTiers[0].effectiveFrom)
        : currentShanghaiMonth(),
    );
    setPreview(null);
    setPreparedInput(null);
    setError('');
    setOpen(true);
  };

  const updateTier = (
    index: number,
    field: keyof EditableTier,
    value: string,
  ) => {
    setTiers((current) =>
      current.map((tier, tierIndex) =>
        tierIndex === index ? { ...tier, [field]: value } : tier,
      ),
    );
    setPreview(null);
    setPreparedInput(null);
    setError('');
  };

  const addTier = () => {
    setTiers((current) => {
      const last = current.at(-1);
      return [
        ...current,
        {
          tierCode: nextTierCode(current),
          name: '新阶梯',
          minMonthlyMinutes: '',
          maxMonthlyMinutes: '',
          voiceRate: last?.voiceRate ?? '0.00',
          smsRate: last?.smsRate ?? '0.00',
        },
      ];
    });
    setPreview(null);
    setPreparedInput(null);
  };

  const removeTier = (index: number) => {
    setTiers((current) =>
      current.filter((_, tierIndex) => tierIndex !== index),
    );
    setPreview(null);
    setPreparedInput(null);
    setError('');
  };

  const requestPreview = async () => {
    if (!validation.success) {
      setError('');
      requestAnimationFrame(() => {
        const invalidField = document.querySelector<HTMLInputElement>(
          '.supplier-pricing-dialog input[aria-invalid="true"]',
        );
        invalidField?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        invalidField?.focus({ preventScroll: true });
      });
      return;
    }
    setPreviewing(true);
    setError('');
    try {
      const result = await previewSupplierPricing(validation.data);
      setPreparedInput(validation.data);
      setPreview(result);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPreviewing(false);
    }
  };

  const confirmPublish = async () => {
    if (!preparedInput) return;
    setPublishing(true);
    setError('');
    try {
      const result = await publishSupplierPricing(preparedInput);
      onPublished(result);
      setOpen(false);
      setPreview(null);
      setPreparedInput(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPublishing(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="primary-button supplier-maintain-button"
        onClick={beginEditing}
      >
        <PencilLine aria-hidden="true" size={13} />
        {scheduledTiers.length ? '修改预约价格' : '维护供应价格'}
      </button>

      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!publishing) setOpen(nextOpen);
        }}
      >
        <DialogContent className="ops-dialog supplier-pricing-dialog">
          <DialogHeader>
            <span className="ops-dialog-kicker">MANUAL SUPPLIER PRICING</span>
            <DialogTitle>
              {preview ? '确认供应价格版本' : '维护海南人像供应价格'}
            </DialogTitle>
            <DialogDescription>
              无外部价格接口；运营人员根据已确认的供应报价维护完整阶梯，新版本仅从所选自然月开始生效。
            </DialogDescription>
          </DialogHeader>

          {preview ? (
            <SupplierPricingPreviewView preview={preview} />
          ) : (
            <div className="supplier-pricing-editor-body">
              <div className="supplier-pricing-guardrail">
                <ShieldCheck aria-hidden="true" size={16} />
                <div>
                  <b>完整版本发布</b>
                  <p>
                    第一档必须从 0
                    开始，各档首尾相接且只有最后一档无上限；历史月结价格不会被改写。
                  </p>
                </div>
              </div>

              <div className="supplier-pricing-meta-fields">
                <div className="supplier-pricing-date-field">
                  <span>生效月份</span>
                  <UnifiedDatePicker
                    ariaLabel="供应价格生效月份"
                    mode="month"
                    min={currentShanghaiMonth()}
                    value={effectiveMonth}
                    popupLabel="选择供应价格生效月份"
                    ariaInvalid={
                      validationFeedback?.field === 'effectiveMonth' &&
                      validationFeedback.tierIndex === undefined
                    }
                    ariaDescribedBy={
                      validationFeedback?.field === 'effectiveMonth'
                        ? 'supplier-pricing-validation'
                        : undefined
                    }
                    onValueChange={(value) => {
                      setEffectiveMonth(value);
                      setPreview(null);
                      setPreparedInput(null);
                    }}
                  />
                </div>
                <label>
                  <span>发布原因</span>
                  <input
                    aria-label="供应价格发布原因"
                    {...validationProps('reason')}
                    maxLength={500}
                    value={reason}
                    onChange={(event) => {
                      setReason(event.target.value);
                      setPreview(null);
                      setPreparedInput(null);
                    }}
                  />
                </label>
              </div>

              <section
                className="supplier-tier-editor"
                aria-label="供应价格阶梯编辑器"
              >
                <header>
                  <div>
                    <b>价格阶梯</b>
                    <span>
                      {tiers.length} 档 · 用量单位为万分钟，范围采用左闭右开
                    </span>
                  </div>
                  <button type="button" onClick={addTier}>
                    <Plus aria-hidden="true" size={12} />
                    新增阶梯
                  </button>
                </header>
                <div className="supplier-tier-editor-list">
                  {tiers.map((tier, index) => (
                    <article key={index}>
                      <span className="supplier-tier-index">{index + 1}</span>
                      <label>
                        <span>阶梯名称</span>
                        <input
                          aria-label={`第 ${index + 1} 档名称`}
                          {...validationProps('name', index)}
                          value={tier.name}
                          onChange={(event) =>
                            updateTier(index, 'name', event.target.value)
                          }
                        />
                      </label>
                      <label>
                        <span>阶梯编码</span>
                        <input
                          aria-label={`第 ${index + 1} 档编码`}
                          {...validationProps('tierCode', index)}
                          value={tier.tierCode}
                          onChange={(event) =>
                            updateTier(index, 'tierCode', event.target.value)
                          }
                        />
                      </label>
                      <label>
                        <span>用量下限（含）</span>
                        <div className="supplier-minute-input">
                          <input
                            aria-label={`第 ${index + 1} 档用量下限（万分钟）`}
                            {...validationProps('minMonthlyMinutes', index)}
                            inputMode="decimal"
                            placeholder="例如 1"
                            value={tier.minMonthlyMinutes}
                            onChange={(event) =>
                              updateTier(
                                index,
                                'minMonthlyMinutes',
                                event.target.value,
                              )
                            }
                          />
                          <em>万分钟</em>
                        </div>
                      </label>
                      <label>
                        <span>用量上限（不含）</span>
                        <div className="supplier-minute-input">
                          <input
                            aria-label={`第 ${index + 1} 档用量上限（万分钟）`}
                            {...validationProps('maxMonthlyMinutes', index)}
                            inputMode="decimal"
                            placeholder={
                              index === tiers.length - 1 ? '不设上限' : '例如 5'
                            }
                            value={tier.maxMonthlyMinutes}
                            onChange={(event) =>
                              updateTier(
                                index,
                                'maxMonthlyMinutes',
                                event.target.value,
                              )
                            }
                          />
                          <em>万分钟</em>
                        </div>
                      </label>
                      <label>
                        <span>话费（元/分钟）</span>
                        <input
                          aria-label={`第 ${index + 1} 档话费`}
                          {...validationProps('voiceRate', index)}
                          inputMode="decimal"
                          value={tier.voiceRate}
                          onChange={(event) =>
                            updateTier(index, 'voiceRate', event.target.value)
                          }
                        />
                      </label>
                      <label>
                        <span>短信（元/条）</span>
                        <input
                          aria-label={`第 ${index + 1} 档短信费`}
                          {...validationProps('smsRate', index)}
                          inputMode="decimal"
                          value={tier.smsRate}
                          onChange={(event) =>
                            updateTier(index, 'smsRate', event.target.value)
                          }
                        />
                      </label>
                      <button
                        type="button"
                        className="supplier-tier-remove"
                        aria-label={`删除第 ${index + 1} 档`}
                        disabled={tiers.length === 1}
                        onClick={() => removeTier(index)}
                      >
                        <Trash2 aria-hidden="true" size={13} />
                      </button>
                    </article>
                  ))}
                </div>
              </section>
              {validationFeedback ? (
                <output
                  id="supplier-pricing-validation"
                  className="supplier-pricing-validation"
                  aria-live="polite"
                >
                  <span className="supplier-pricing-validation-icon">
                    <AlertTriangle aria-hidden="true" size={14} />
                  </span>
                  <span>
                    <b>{validationFeedback.title}</b>
                    <small>{validationFeedback.detail}</small>
                  </span>
                </output>
              ) : null}
            </div>
          )}

          {error ? (
            <div
              className="ops-inline-error supplier-pricing-error"
              role="alert"
            >
              <AlertTriangle aria-hidden="true" size={14} />
              {error}
            </div>
          ) : null}

          <DialogFooter>
            <button
              type="button"
              className="ops-icon-button"
              disabled={publishing}
              onClick={() => {
                if (preview) {
                  setPreview(null);
                  setPreparedInput(null);
                  setError('');
                } else {
                  setOpen(false);
                }
              }}
            >
              {preview ? '返回修改' : '取消'}
            </button>
            {preview ? (
              <button
                type="button"
                className="primary-button"
                disabled={publishing}
                onClick={() => void confirmPublish()}
              >
                {publishing ? (
                  <>
                    <LoaderCircle className="is-spinning" size={13} />
                    正在发布…
                  </>
                ) : (
                  <>
                    <CheckCircle2 aria-hidden="true" size={13} />
                    确认发布新版本
                  </>
                )}
              </button>
            ) : (
              <button
                type="button"
                className="primary-button"
                disabled={previewing}
                onClick={() => void requestPreview()}
              >
                {previewing ? (
                  <>
                    <LoaderCircle className="is-spinning" size={13} />
                    正在校验…
                  </>
                ) : (
                  '预览发布影响'
                )}
              </button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SupplierPricingPreviewView({
  preview,
}: {
  preview: SupplierPricingPreview;
}) {
  return (
    <div className="supplier-pricing-preview">
      <div className="supplier-pricing-preview-seal">
        <CalendarClock aria-hidden="true" size={17} />
        <div>
          <b>{shanghaiMonthLabel(preview.effectiveFrom)}起生效</b>
          <p>
            共 {preview.tierCount} 档；
            {preview.replacesScheduledEffectiveFrom
              ? `将替换 ${shanghaiMonthLabel(preview.replacesScheduledEffectiveFrom)}的未生效预约。`
              : '当前生效版本会保留到新月份开始。'}
          </p>
        </div>
      </div>
      <div className="table-wrap supplier-pricing-preview-table">
        <table className="data-table">
          <thead>
            <tr>
              <th>阶梯</th>
              <th>月度用量范围（万分钟）</th>
              <th>话费成本</th>
              <th>短信成本</th>
            </tr>
          </thead>
          <tbody>
            {preview.tiers.map((tier) => (
              <tr key={tier.tierCode}>
                <td>
                  <b>{tier.name}</b>
                  <span className="table-meta">{tier.tierCode}</span>
                </td>
                <td>
                  {formatTenThousandMinuteRange(
                    tier.minMonthlyMinutes,
                    tier.maxMonthlyMinutes,
                  )}
                </td>
                <td>¥{trimRate(tier.voiceRate)} / 分钟</td>
                <td>¥{trimRate(tier.smsRate)} / 条</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function toEditableTier(tier: OperatorSupplierPricingTier): EditableTier {
  return {
    tierCode: tier.tierCode,
    name: tier.name,
    minMonthlyMinutes: minutesToTenThousands(tier.minMonthlyMinutes),
    maxMonthlyMinutes: tier.maxMonthlyMinutes
      ? minutesToTenThousands(tier.maxMonthlyMinutes)
      : '',
    voiceRate: trimRate(tier.voiceRate),
    smsRate: trimRate(tier.smsRate),
  };
}

function supplierPricingEditingBaseline(
  currentTiers: OperatorSupplierPricingTier[],
  scheduledTiers: OperatorSupplierPricingTier[],
) {
  if (!scheduledTiers.length) return currentTiers;
  const effectiveFrom = scheduledTiers[0]!.effectiveFrom;
  const scheduledCodes = new Set(scheduledTiers.map((tier) => tier.tierCode));
  return [
    ...currentTiers.filter(
      (tier) =>
        !scheduledCodes.has(tier.tierCode) &&
        (!tier.effectiveTo || tier.effectiveTo > effectiveFrom),
    ),
    ...scheduledTiers,
  ].sort((left, right) =>
    BigInt(left.minMonthlyMinutes) < BigInt(right.minMonthlyMinutes) ? -1 : 1,
  );
}

function supplierPricingValidationFeedback(
  issue: { path: readonly PropertyKey[]; message: string } | undefined,
): ValidationFeedback {
  if (!issue) {
    return {
      title: '价格配置尚未完成',
      detail: '请检查所有必填项后再预览发布影响。',
    };
  }

  const [section, tierIndex, rawField] = issue.path;
  const field = typeof rawField === 'string' ? rawField : undefined;
  if (section === 'tiers' && typeof tierIndex === 'number' && field) {
    const fieldNames: Partial<Record<SupplierPricingField, string>> = {
      tierCode: '阶梯编码',
      name: '阶梯名称',
      minMonthlyMinutes: '用量下限',
      maxMonthlyMinutes: '用量上限',
      voiceRate: '话费',
      smsRate: '短信费',
    };
    const details: Partial<Record<SupplierPricingField, string>> = {
      tierCode: issue.message,
      name: issue.message,
      minMonthlyMinutes:
        '请输入 0 或正数，最多 4 位小数，例如 5（表示 5 万分钟）。',
      maxMonthlyMinutes:
        '请输入 0 或正数，最多 4 位小数；如果这是最后一档，请留空。',
      voiceRate: '请输入大于 0 的金额，例如 0.16。',
      smsRate: '请输入 0 或正数金额，例如 0.06。',
    };
    const typedField = field as SupplierPricingField;
    return {
      title: `第 ${tierIndex + 1} 档「${fieldNames[typedField] ?? field}」填写不正确`,
      detail: details[typedField] ?? issue.message,
      tierIndex,
      field: typedField,
    };
  }

  if (section === 'effectiveFrom') {
    return {
      title: '请选择生效月份',
      detail: '供应价格新版本可从当前自然月或未来自然月开始生效。',
      field: 'effectiveMonth',
    };
  }
  if (section === 'reason') {
    return {
      title: '发布原因填写不完整',
      detail: issue.message,
      field: 'reason',
    };
  }

  return {
    title: '价格阶梯配置不完整',
    detail: issue.message,
  };
}

function nextTierCode(tiers: EditableTier[]): string {
  const codes = new Set(tiers.map((tier) => tier.tierCode));
  let sequence = tiers.length + 1;
  while (codes.has(`tier-${sequence}`)) sequence += 1;
  return `tier-${sequence}`;
}

function currentShanghaiMonth(): string {
  const shanghai = new Date(Date.now() + 8 * 60 * 60 * 1_000);
  const year = shanghai.getUTCFullYear();
  const month = shanghai.getUTCMonth() + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

function shanghaiMonth(value: string): string {
  return new Date(new Date(value).getTime() + 8 * 60 * 60 * 1_000)
    .toISOString()
    .slice(0, 7);
}

function shanghaiMonthLabel(value: string): string {
  const [year, month] = shanghaiMonth(value).split('-');
  return `${year} 年 ${Number(month)} 月`;
}

function trimRate(value: string): string {
  return value.includes('.')
    ? value.replace(/0+$/, '').replace(/\.$/, '')
    : value;
}

function errorMessage(error: unknown): string {
  if (error instanceof PlatformApiError) {
    return error.requestId
      ? `${error.message}（请求 ${error.requestId}）`
      : error.message;
  }
  return error instanceof Error ? error.message : '供应价格操作失败';
}

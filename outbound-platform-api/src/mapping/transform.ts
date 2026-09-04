import type { EmptyPolicy, MappingRule, SourceSystem, TransformConfig } from '@outbound/contracts';

export class MappingValueError extends Error {
  constructor(
    public readonly variableName: string,
    public readonly reason: string,
    public readonly sourceValue: unknown,
  ) {
    super(`${variableName}: ${reason}`);
  }
}

export function resolveSourceField(rule: MappingRule, sourceSystem: SourceSystem): string | null {
  return sourceSystem === 'ERP' ? rule.erpField : rule.crmField;
}

export function transformMappedValue(input: {
  rule: MappingRule;
  sourceSystem: SourceSystem;
  sourceRecord: Record<string, unknown>;
}): string {
  const field = resolveSourceField(input.rule, input.sourceSystem);
  const rawValue = field ? input.sourceRecord[field] : undefined;
  const sourceValue = toSourceString(rawValue);
  const empty = sourceValue === null || sourceValue.trim() === '';

  if (empty) return handleEmpty(input.rule.baiyingVariableName, input.rule.emptyPolicy, input.rule.defaultValue, rawValue, field);

  try {
    return applyTransform(sourceValue, input.rule.transformConfig);
  } catch (error) {
    if (input.rule.emptyPolicy === 'DEFAULT' && input.rule.defaultValue !== null) return input.rule.defaultValue;
    throw new MappingValueError(input.rule.baiyingVariableName, error instanceof Error ? error.message : '转换失败', rawValue);
  }
}

function toSourceString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return value.toString();
  throw new Error('来源字段必须是字符串、数字或布尔值');
}

function handleEmpty(variableName: string, policy: EmptyPolicy, defaultValue: string | null, rawValue: unknown, field: string | null): string {
  if (policy === 'DEFAULT' && defaultValue !== null) return defaultValue;
  throw new MappingValueError(variableName, field ? `来源字段 ${field} 为空` : '当前来源系统未配置取值字段', rawValue);
}

function applyTransform(value: string, config: TransformConfig): string {
  if (config.type === 'TEXT') {
    if (config.mode === 'TRIM') return value.trim();
    if (config.mode === 'UPPERCASE') return value.toUpperCase();
    if (config.mode === 'LOWERCASE') return value.toLowerCase();
    return value;
  }
  if (config.type === 'DATE') {
    const date = parseDate(value);
    const year = date.getUTCFullYear().toString().padStart(4, '0');
    const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
    const day = date.getUTCDate().toString().padStart(2, '0');
    if (config.outputFormat === 'YYYY年MM月DD日') return `${year}年${month}月${day}日`;
    if (config.outputFormat === 'MM/DD/YYYY') return `${month}/${day}/${year}`;
    return `${year}-${month}-${day}`;
  }
  if (config.type === 'MONEY') {
    const numeric = Number(value.replace(/[^\d.-]/g, ''));
    if (!Number.isFinite(numeric)) throw new Error('金额格式无效');
    const amount = config.inputUnit === 'CENT' ? numeric / 100 : numeric;
    return amount.toFixed(config.decimalPlaces);
  }
  if (config.type === 'ENUM') {
    const mapped = config.values[value.trim()];
    if (mapped === undefined) throw new Error('未命中枚举映射');
    return mapped;
  }
  return config.template.replaceAll('{{value}}', value);
}

function parseDate(value: string): Date {
  const normalized = value.trim().replace(/[./]/g, '-');
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(normalized);
  if (!match) throw new Error('日期格式无效');
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() !== Number(match[2]) - 1 || date.getUTCDate() !== Number(match[3])) {
    throw new Error('日期值无效');
  }
  return date;
}

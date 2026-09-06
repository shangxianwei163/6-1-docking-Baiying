const REDACTED = '[已脱敏]';
type OperatorDetailValue = string | number | boolean | null;
const sensitiveKeyPattern =
  /(secret|password|token|authorization|cookie|cipher|phone|mobile|signature|signing)/i;

export function sanitizeOperatorDetail(
  detail: Record<string, unknown>,
): Record<string, OperatorDetailValue> {
  return Object.fromEntries(
    Object.entries(detail).map(([key, value]) => [
      key,
      sensitiveKeyPattern.test(key)
        ? REDACTED
        : displayValue(sanitizeNested(value)),
    ]),
  );
}

export function redactOperatorText(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`)
    .replace(
      /((?:secret|password|token|authorization|cookie|signature|signing[_-]?key)\s*[:=]\s*)[^\s,;]+/gi,
      `$1${REDACTED}`,
    )
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, '1**********')
    .slice(0, 2000);
}

function sanitizeNested(value: unknown): unknown {
  if (typeof value === 'string') return redactOperatorText(value);
  if (Array.isArray(value)) return value.map(sanitizeNested);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      sensitiveKeyPattern.test(key) ? REDACTED : sanitizeNested(nestedValue),
    ]),
  );
}

function displayValue(value: unknown): OperatorDetailValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  const serialized = JSON.stringify(value) ?? '[无法显示]';
  return serialized.length > 2000
    ? `${serialized.slice(0, 1997)}…`
    : serialized;
}

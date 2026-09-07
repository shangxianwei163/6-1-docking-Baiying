const MINUTES_PER_TEN_THOUSAND = BigInt(10_000);
const ZERO_MINUTES = BigInt(0);

export function minutesToTenThousands(value: string): string {
  try {
    const minutes = BigInt(value);
    if (minutes < ZERO_MINUTES) return value;
    const whole = minutes / MINUTES_PER_TEN_THOUSAND;
    const remainder = minutes % MINUTES_PER_TEN_THOUSAND;
    if (remainder === ZERO_MINUTES) return whole.toString();

    const decimal = remainder.toString().padStart(4, '0').replace(/0+$/, '');
    return `${whole}.${decimal}`;
  } catch {
    return value;
  }
}

export function tenThousandsToMinutes(value: string): string {
  const normalized = value.trim();
  const match = /^(\d+)(?:\.(\d{1,4}))?$/.exec(normalized);
  if (!match) return `invalid:${normalized}`;

  const whole = BigInt(match[1]!);
  const decimal = BigInt((match[2] ?? '').padEnd(4, '0') || '0');
  return (whole * MINUTES_PER_TEN_THOUSAND + decimal).toString();
}

export function formatTenThousandMinuteRange(
  minimum: string,
  maximum: string | null,
): string {
  const min = minutesToTenThousands(minimum);
  return maximum
    ? `${min}（含）— ${minutesToTenThousands(maximum)}（不含）`
    : `≥ ${min}`;
}

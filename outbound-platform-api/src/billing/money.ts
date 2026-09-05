const moneyPattern = /^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/;

export function moneyToMicros(value: string): bigint {
  if (!moneyPattern.test(value)) {
    throw new TypeError('金额必须是 numeric(18,6) 范围内的十进制字符串');
  }
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [integerPart, fractionPart = ''] = unsigned.split('.');
  const micros =
    BigInt(integerPart) * 1_000_000n + BigInt(fractionPart.padEnd(6, '0'));
  return negative ? -micros : micros;
}

export function microsToMoney(value: bigint): string {
  const negative = value < 0n;
  const unsigned = negative ? -value : value;
  const integerPart = unsigned / 1_000_000n;
  const fractionPart = String(unsigned % 1_000_000n).padStart(6, '0');
  return `${negative ? '-' : ''}${integerPart}.${fractionPart}`;
}

export function normalizeMoney(value: string): string {
  return microsToMoney(moneyToMicros(value));
}

export function requirePositiveMoney(value: string): string {
  const micros = moneyToMicros(value);
  if (micros <= 0n) throw new TypeError('金额必须大于 0');
  return microsToMoney(micros);
}

export function addMoney(left: string, right: string): string {
  return microsToMoney(moneyToMicros(left) + moneyToMicros(right));
}

export function subtractMoney(left: string, right: string): string {
  return microsToMoney(moneyToMicros(left) - moneyToMicros(right));
}

export function negateMoney(value: string): string {
  return microsToMoney(-moneyToMicros(value));
}

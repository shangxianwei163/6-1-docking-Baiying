import { describe, expect, it } from 'vitest';
import {
  addMoney,
  microsToMoney,
  moneyToMicros,
  multiplyMoneyByInteger,
  negateMoney,
  normalizeMoney,
  requirePositiveMoney,
  subtractMoney,
} from './money.js';

describe('money helpers', () => {
  it('normalizes numeric(18,6) values without floating point arithmetic', () => {
    expect(normalizeMoney('0.1')).toBe('0.100000');
    expect(addMoney('0.100000', '0.200000')).toBe('0.300000');
    expect(subtractMoney('100.000001', '0.000002')).toBe('99.999999');
    expect(negateMoney('-12.34')).toBe('12.340000');
  });

  it('multiplies money by an integer without floating point arithmetic', () => {
    expect(multiplyMoneyByInteger('0.240000', 6)).toBe('1.440000');
    expect(() => multiplyMoneyByInteger('1.000000', -1)).toThrow(
      '非负安全整数',
    );
  });

  it('round-trips the numeric(18,6) boundaries represented as micro-units', () => {
    const maximum = '999999999999.999999';
    const minimum = '-999999999999.999999';
    expect(microsToMoney(moneyToMicros(maximum))).toBe(maximum);
    expect(microsToMoney(moneyToMicros(minimum))).toBe(minimum);
  });

  it.each(['1e3', 'NaN', '0.0000001', '01.00', '1000000000000.00', ''])(
    'rejects invalid numeric input %j',
    (value) => {
      expect(() => moneyToMicros(value)).toThrow(TypeError);
    },
  );

  it.each(['0', '0.000000', '-0.01'])(
    'requires a strictly positive amount for %j',
    (value) => {
      expect(() => requirePositiveMoney(value)).toThrow(TypeError);
    },
  );
});

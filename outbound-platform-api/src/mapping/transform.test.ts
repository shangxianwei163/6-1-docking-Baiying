import { describe, expect, it } from 'vitest';
import type { MappingRule } from '@outbound/contracts';
import { MappingValueError, transformMappedValue } from './transform.js';

const rule: MappingRule = {
  id: 'a48dd050-41f6-4f99-8dc3-0b3c63f20e30',
  baiyingVariableName: '婚期',
  erpField: 'wedding_date',
  crmField: 'marriage_date',
  transformConfig: { type: 'DATE', outputFormat: 'YYYY-MM-DD' },
  emptyPolicy: 'BLOCK',
  defaultValue: null,
  status: 'PUBLISHED',
  version: 12,
};

describe('transformMappedValue', () => {
  it('reads only the ERP field for ERP input', () => {
    expect(
      transformMappedValue({
        rule,
        sourceSystem: 'ERP',
        sourceRecord: {
          wedding_date: '2026/10/18',
          marriage_date: '2027/01/01',
        },
      }),
    ).toBe('2026-10-18');
  });

  it('reads only the CRM field for CRM input', () => {
    expect(
      transformMappedValue({
        rule,
        sourceSystem: 'CRM',
        sourceRecord: {
          wedding_date: '2026/10/18',
          marriage_date: '2027/01/01',
        },
      }),
    ).toBe('2027-01-01');
  });

  it('records a mapping failure when the selected source field is empty', () => {
    expect(() =>
      transformMappedValue({
        rule,
        sourceSystem: 'ERP',
        sourceRecord: { marriage_date: '2027/01/01' },
      }),
    ).toThrow(MappingValueError);
  });

  it('uses the configured default value when conversion fails', () => {
    expect(
      transformMappedValue({
        rule: { ...rule, emptyPolicy: 'DEFAULT', defaultValue: '待确认' },
        sourceSystem: 'CRM',
        sourceRecord: { marriage_date: 'not-a-date' },
      }),
    ).toBe('待确认');
  });

  it('omits a null source value when the rule uses OMIT', () => {
    expect(
      transformMappedValue({
        rule: { ...rule, emptyPolicy: 'OMIT' },
        sourceSystem: 'ERP',
        sourceRecord: { wedding_date: null },
      }),
    ).toBeUndefined();
  });
});

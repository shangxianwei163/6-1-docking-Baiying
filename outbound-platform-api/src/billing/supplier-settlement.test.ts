import { describe, expect, it } from 'vitest';
import {
  buildSupplierSettlementProjection,
  settlementMonthWindow,
  shanghaiSettlementMonth,
  type SupplierSettlementTierSource,
} from './supplier-settlement.js';

const septemberTiers: SupplierSettlementTierSource[] = [
  {
    id: '1842e74b-f55b-4280-837a-e7a45c22279a',
    tierCode: 'basic',
    name: '基础阶梯',
    minMonthlyMinutes: 0n,
    maxMonthlyMinutes: 10_000n,
    voiceRate: '0.200000',
    effectiveFrom: new Date('2026-08-31T16:00:00.000Z'),
    effectiveTo: null,
  },
  {
    id: '43901d22-85b4-4e7a-b91c-f9ac288af7ba',
    tierCode: 'growth',
    name: '成长阶梯',
    minMonthlyMinutes: 10_000n,
    maxMonthlyMinutes: 50_000n,
    voiceRate: '0.180000',
    effectiveFrom: new Date('2026-08-31T16:00:00.000Z'),
    effectiveTo: null,
  },
];

describe('supplier monthly settlement projection', () => {
  it('uses Shanghai calendar month boundaries', () => {
    const window = settlementMonthWindow('2026-09');
    expect(window.start.toISOString()).toBe('2026-08-31T16:00:00.000Z');
    expect(window.end.toISOString()).toBe('2026-09-30T16:00:00.000Z');
    expect(shanghaiSettlementMonth(new Date('2026-08-31T16:00:00.000Z'))).toBe(
      '2026-09',
    );
    expect(shanghaiSettlementMonth(new Date('2026-09-30T15:59:59.999Z'))).toBe(
      '2026-09',
    );
    expect(shanghaiSettlementMonth(new Date('2026-09-30T16:00:00.000Z'))).toBe(
      '2026-10',
    );
  });

  it('selects the upper tier at an inclusive lower boundary', () => {
    const result = buildSupplierSettlementProjection({
      month: '2026-09',
      tiers: septemberTiers,
      tasks: [
        {
          id: 'task-1',
          taskNo: 'PT-20260901-00001',
          billingMinutes: 6_000,
          customerCharge: '2880.000000',
        },
        {
          id: 'task-2',
          taskNo: 'PT-20260902-00002',
          billingMinutes: 4_000,
          customerCharge: '1920.000000',
        },
      ],
    });

    expect(result.tier?.tierCode).toBe('growth');
    expect(result.totalBillingMinutes).toBe(10_000n);
    expect(result.totalCustomerCharge).toBe('4800.000000');
    expect(result.totalPlatformCost).toBe('1800.000000');
    expect(result.totalProfit).toBe('3000.000000');
    expect(result.allocations.map((item) => item.platformCost)).toEqual([
      '1080.000000',
      '720.000000',
    ]);
    expect(result.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.issues).toEqual([]);
  });

  it('requires exactly one tier that covers the entire month', () => {
    const unavailable = buildSupplierSettlementProjection({
      month: '2026-09',
      tasks: [
        {
          id: 'task-without-tier',
          taskNo: 'PT-20260901-00001',
          billingMinutes: 1,
          customerCharge: '0.480000',
        },
      ],
      tiers: septemberTiers.map((tier) => ({
        ...tier,
        effectiveFrom: new Date('2026-09-01T00:00:00.000Z'),
      })),
    });
    expect(unavailable.tier).toBeNull();
    expect(unavailable.taskCount).toBe(1);
    expect(unavailable.issues[0]?.code).toBe('SUPPLIER_TIER_NOT_FOUND');

    const overlapping = buildSupplierSettlementProjection({
      month: '2026-09',
      tasks: [
        {
          id: 'task-with-overlapping-tier',
          taskNo: 'PT-20260901-00002',
          billingMinutes: 1,
          customerCharge: '0.480000',
        },
      ],
      tiers: [
        septemberTiers[0]!,
        { ...septemberTiers[0]!, id: 'duplicate-tier', tierCode: 'duplicate' },
      ],
    });
    expect(overlapping.tier).toBeNull();
    expect(overlapping.issues[0]?.code).toBe('SUPPLIER_TIER_OVERLAP');
  });

  it('does not require a supplier tier when the month has no tasks', () => {
    const result = buildSupplierSettlementProjection({
      month: '2026-08',
      tasks: [],
      tiers: [],
    });

    expect(result.taskCount).toBe(0);
    expect(result.totalBillingMinutes).toBe(0n);
    expect(result.tier).toBeNull();
    expect(result.allocations).toEqual([]);
    expect(result.totalPlatformCost).toBe('0.000000');
    expect(result.issues).toEqual([]);
  });

  it('hashes normalized money and sorted task inputs deterministically', () => {
    const taskA = {
      id: 'task-a',
      taskNo: 'PT-20260902-00002',
      billingMinutes: 1,
      customerCharge: '0.48',
    };
    const taskB = {
      id: 'task-b',
      taskNo: 'PT-20260901-00001',
      billingMinutes: 2,
      customerCharge: '0.960000',
    };
    const first = buildSupplierSettlementProjection({
      month: '2026-09',
      tasks: [taskA, taskB],
      tiers: septemberTiers,
    });
    const second = buildSupplierSettlementProjection({
      month: '2026-09',
      tasks: [{ ...taskB, customerCharge: '0.96' }, taskA],
      tiers: [...septemberTiers].reverse(),
    });
    expect(first.sourceHash).toBe(second.sourceHash);
  });
});

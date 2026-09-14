import { describe, expect, it, vi } from 'vitest';
import type { SupplierSettlementSummary } from '@outbound/contracts';
import { deriveSupplierSettlementStatus } from './monthly-settlement-service.js';
import { createSupplierSettlementScheduler, resolveSupplierSettlementScheduleActions } from './monthly-settlement-scheduler.js';

describe('supplier settlement schedule', () => {
  it('starts preclose at 23:30 on the last Shanghai calendar day', () => {
    expect(
      resolveSupplierSettlementScheduleActions(
        new Date('2026-09-30T15:29:59.999Z'),
      ).precloseMonth,
    ).toBeNull();
    expect(
      resolveSupplierSettlementScheduleActions(
        new Date('2026-09-30T15:30:00.000Z'),
      ).precloseMonth,
    ).toBe('2026-09');
  });

  it('waits until 00:10 on the first Shanghai day before finalizing', () => {
    expect(
      resolveSupplierSettlementScheduleActions(
        new Date('2026-09-30T16:09:59.999Z'),
      ).finalizeMonth,
    ).toBeNull();
    expect(
      resolveSupplierSettlementScheduleActions(
        new Date('2026-09-30T16:10:00.000Z'),
      ).finalizeMonth,
    ).toBe('2026-09');
  });

  it('catches up the previous month after a restart', () => {
    expect(
      resolveSupplierSettlementScheduleActions(
        new Date('2026-10-14T06:00:00.000Z'),
      ).finalizeMonth,
    ).toBe('2026-09');
  });

  it('derives preclose, reconciliation and blocked states from live data', () => {
    const base = {
      finalized: false,
      discrepancyCount: 0,
      periodEnd: new Date('2026-09-30T16:00:00.000Z'),
      precloseAt: new Date('2026-09-30T15:30:00.000Z'),
    };
    expect(
      deriveSupplierSettlementStatus({
        ...base,
        now: new Date('2026-09-30T15:30:00.000Z'),
      }),
    ).toBe('PRE_CLOSING');
    expect(
      deriveSupplierSettlementStatus({
        ...base,
        now: new Date('2026-09-30T16:00:00.000Z'),
      }),
    ).toBe('RECONCILING');
    expect(
      deriveSupplierSettlementStatus({
        ...base,
        discrepancyCount: 1,
        now: new Date('2026-09-30T15:30:00.000Z'),
      }),
    ).toBe('BLOCKED');
    expect(
      deriveSupplierSettlementStatus({
        ...base,
        finalized: true,
        discrepancyCount: 1,
        now: new Date('2026-10-01T00:00:00.000Z'),
      }),
    ).toBe('FINALIZED');
  });
});

describe('supplier settlement scheduler', () => {
  it('precloses, finalizes and audits adjustments with retry throttling', async () => {
    let now = new Date('2026-09-30T15:30:00.000Z');
    const summary = { status: 'PRE_CLOSING' } as SupplierSettlementSummary;
    const service = {
      preclose: vi.fn(async () => summary),
      finalizeAutomatically: vi.fn(async () => summary),
      capturePostCloseAdjustment: vi.fn(async () => false),
    };
    const scheduler = createSupplierSettlementScheduler({
      intervalMs: 60_000,
      retryIntervalMs: 300_000,
      autoFinalizeDelayMinutes: 10,
      service,
      clock: () => now,
    });

    await scheduler.run('schedule');
    await scheduler.run('schedule');
    expect(service.preclose).toHaveBeenCalledTimes(1);

    now = new Date('2026-09-30T16:10:00.000Z');
    await scheduler.run('schedule');
    expect(service.finalizeAutomatically).toHaveBeenCalledWith('2026-09');
    expect(service.capturePostCloseAdjustment).toHaveBeenCalledWith('2026-09');
  });
});

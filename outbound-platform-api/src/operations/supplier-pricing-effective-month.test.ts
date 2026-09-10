import { describe, expect, it } from 'vitest';
import { PostgresOperationsConsoleService } from './service.js';

const tiers = [
  {
    tierCode: 'tier-basic',
    name: '基础阶梯',
    minMonthlyMinutes: '0',
    maxMonthlyMinutes: null,
    voiceRate: '0.20',
    smsRate: '0.08',
  },
];

function serviceAt(now: string) {
  const db = {
    select: () => ({
      from: () => ({
        orderBy: async () => [],
      }),
    }),
  };
  return new PostgresOperationsConsoleService(
    db as unknown as ConstructorParameters<
      typeof PostgresOperationsConsoleService
    >[0],
    undefined,
    () => new Date(now),
  );
}

describe('supplier pricing effective month', () => {
  it('allows publishing for the current Shanghai calendar month', async () => {
    const service = serviceAt('2026-09-08T06:00:00.000Z');

    await expect(
      service.previewSupplierPricing({
        effectiveFrom: '2026-08-31T16:00:00.000Z',
        reason: '发布当月供应报价',
        tiers,
      }),
    ).resolves.toMatchObject({
      effectiveFrom: '2026-08-31T16:00:00.000Z',
      tierCount: 1,
    });
  });

  it('rejects a month before the current Shanghai calendar month', async () => {
    const service = serviceAt('2026-09-08T06:00:00.000Z');

    await expect(
      service.previewSupplierPricing({
        effectiveFrom: '2026-07-31T16:00:00.000Z',
        reason: '尝试发布历史月份',
        tiers,
      }),
    ).rejects.toMatchObject({
      code: 'SUPPLIER_PRICING_EFFECTIVE_TIME_CONFLICT',
      message: '供应成本生效月份不得早于当前自然月',
    });
  });
});

import { createHash } from 'node:crypto';
import type { SupplierSettlementIssue } from '@outbound/contracts';
import { microsToMoney, moneyToMicros, normalizeMoney } from './money.js';

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1_000;
const SETTLEMENT_MONTH_PATTERN = /^(20\d{2})-(0[1-9]|1[0-2])$/;

export type SupplierSettlementTaskSource = {
  id: string;
  taskNo: string;
  billingMinutes: number;
  customerCharge: string;
};

export type SupplierSettlementTierSource = {
  id: string;
  tierCode: string;
  name: string;
  minMonthlyMinutes: bigint;
  maxMonthlyMinutes: bigint | null;
  voiceRate: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
};

export type SupplierSettlementAllocation = SupplierSettlementTaskSource & {
  platformRate: string;
  platformCost: string;
  profit: string;
};

export type SupplierSettlementProjection = {
  settlementMonth: string;
  periodStart: Date;
  periodEnd: Date;
  taskCount: number;
  totalBillingMinutes: bigint;
  totalCustomerCharge: string;
  totalPlatformCost: string;
  totalProfit: string;
  tier: SupplierSettlementTierSource | null;
  allocations: SupplierSettlementAllocation[];
  sourceHash: string;
  issues: SupplierSettlementIssue[];
};

export function settlementMonthWindow(month: string): {
  month: string;
  start: Date;
  end: Date;
} {
  const match = SETTLEMENT_MONTH_PATTERN.exec(month);
  if (!match)
    throw new TypeError('结算月份必须为 YYYY-MM，年份范围为 2000～2099');
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const start = new Date(Date.UTC(year, monthIndex, 1) - SHANGHAI_OFFSET_MS);
  const end = new Date(Date.UTC(year, monthIndex + 1, 1) - SHANGHAI_OFFSET_MS);
  return { month, start, end };
}

export function shanghaiSettlementMonth(instant: Date): string {
  if (Number.isNaN(instant.getTime())) throw new TypeError('结算时间无效');
  return new Date(instant.getTime() + SHANGHAI_OFFSET_MS)
    .toISOString()
    .slice(0, 7);
}

export function buildSupplierSettlementProjection(input: {
  month: string;
  tasks: SupplierSettlementTaskSource[];
  tiers: SupplierSettlementTierSource[];
}): SupplierSettlementProjection {
  const window = settlementMonthWindow(input.month);
  const tasks = [...input.tasks]
    .map((task) => ({
      ...task,
      customerCharge: normalizeMoney(task.customerCharge),
    }))
    .sort((left, right) =>
      left.taskNo.localeCompare(right.taskNo, 'en', { numeric: true }),
    );
  const applicableTiers = input.tiers
    .filter(
      (tier) =>
        tier.effectiveFrom <= window.start &&
        (!tier.effectiveTo || tier.effectiveTo >= window.end),
    )
    .sort(
      (left, right) =>
        compareBigInt(left.minMonthlyMinutes, right.minMonthlyMinutes) ||
        left.tierCode.localeCompare(right.tierCode),
    );
  const totalBillingMinutes = tasks.reduce(
    (total, task) => total + BigInt(task.billingMinutes),
    0n,
  );
  const matchingTiers = tasks.length
    ? applicableTiers.filter(
        (tier) =>
          totalBillingMinutes >= tier.minMonthlyMinutes &&
          (tier.maxMonthlyMinutes === null ||
            totalBillingMinutes < tier.maxMonthlyMinutes),
      )
    : [];
  const issues: SupplierSettlementIssue[] = [];
  if (tasks.length > 0 && matchingTiers.length === 0) {
    issues.push({
      code: 'SUPPLIER_TIER_NOT_FOUND',
      taskNo: null,
      message: `月份 ${input.month} 的 ${totalBillingMinutes} 分钟没有可覆盖整月的供应商价格阶梯`,
    });
  } else if (tasks.length > 0 && matchingTiers.length > 1) {
    issues.push({
      code: 'SUPPLIER_TIER_OVERLAP',
      taskNo: null,
      message: `月份 ${input.month} 的 ${totalBillingMinutes} 分钟同时命中多个供应商价格阶梯`,
    });
  }
  const tier = matchingTiers.length === 1 ? matchingTiers[0]! : null;
  const allocations = tier
    ? tasks.map((task) => {
        const platformCost = microsToMoney(
          moneyToMicros(tier.voiceRate) * BigInt(task.billingMinutes),
        );
        return {
          ...task,
          platformRate: normalizeMoney(tier.voiceRate),
          platformCost,
          profit: microsToMoney(
            moneyToMicros(task.customerCharge) - moneyToMicros(platformCost),
          ),
        };
      })
    : [];
  const totalCustomerCharge = microsToMoney(
    tasks.reduce(
      (total, task) => total + moneyToMicros(task.customerCharge),
      0n,
    ),
  );
  const totalPlatformCost = microsToMoney(
    allocations.reduce(
      (total, task) => total + moneyToMicros(task.platformCost),
      0n,
    ),
  );
  const totalProfit = microsToMoney(
    moneyToMicros(totalCustomerCharge) - moneyToMicros(totalPlatformCost),
  );
  const sourceHash = createHash('sha256')
    .update(
      JSON.stringify({
        settlementMonth: input.month,
        timezone: 'Asia/Shanghai',
        tasks: tasks.map((task) => ({
          id: task.id,
          taskNo: task.taskNo,
          billingMinutes: task.billingMinutes,
          customerCharge: task.customerCharge,
        })),
        tiers: applicableTiers.map((candidate) => ({
          id: candidate.id,
          tierCode: candidate.tierCode,
          minMonthlyMinutes: candidate.minMonthlyMinutes.toString(),
          maxMonthlyMinutes: candidate.maxMonthlyMinutes?.toString() ?? null,
          voiceRate: normalizeMoney(candidate.voiceRate),
          effectiveFrom: candidate.effectiveFrom.toISOString(),
          effectiveTo: candidate.effectiveTo?.toISOString() ?? null,
        })),
      }),
    )
    .digest('hex');

  return {
    settlementMonth: input.month,
    periodStart: window.start,
    periodEnd: window.end,
    taskCount: tasks.length,
    totalBillingMinutes,
    totalCustomerCharge,
    totalPlatformCost,
    totalProfit,
    tier,
    allocations,
    sourceHash,
    issues,
  };
}

function compareBigInt(left: bigint, right: bigint): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

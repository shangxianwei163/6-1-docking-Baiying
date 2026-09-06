import { randomUUID } from 'node:crypto';
import { and, eq, inArray, lte, or, sql } from 'drizzle-orm';
import {
  supplierSettlementSummarySchema,
  type FinalizeSupplierSettlementInput,
  type SupplierSettlementIssue,
  type SupplierSettlementSummary,
} from '@outbound/contracts';
import type { Database } from '../db/client.js';
import {
  accountLedger,
  auditLogs,
  callInstances,
  fundHolds,
  platformTasks,
  supplierMonthlySettlements,
  supplierPricingTiers,
  supplierSettlementTaskItems,
} from '../db/schema.js';
import { OperationsConsoleFailure } from '../operations/service.js';
import { addMoney, moneyToMicros, normalizeMoney } from './money.js';
import {
  buildSupplierSettlementProjection,
  settlementMonthWindow,
  type SupplierSettlementProjection,
  type SupplierSettlementTaskSource,
  type SupplierSettlementTierSource,
} from './supplier-settlement.js';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type SettlementRow = typeof supplierMonthlySettlements.$inferSelect;
type MonthlyTaskRow = SupplierSettlementTaskSource & {
  billingStatus: 'RESERVED' | 'SETTLING' | 'SETTLED' | 'FAILED';
  executionStatus: string;
  supplierSettlementId: string | null;
};
type CallAggregateRow = {
  taskId: string;
  billingMinutes: string;
  customerCharge: string;
};
type LedgerAggregateRow = {
  taskId: string;
  held: string;
  released: string;
  captured: string;
  overage: string;
};
type HoldRow = {
  taskId: string;
  status: 'ACTIVE' | 'CAPTURED' | 'RELEASED';
  remainingAmount: string;
};
type CurrentSettlementState = {
  projection: SupplierSettlementProjection;
  issues: SupplierSettlementIssue[];
  issueCount: number;
  blockingTaskCount: number;
  lateTaskCount: number;
};

const MAX_REPORTED_ISSUES = 100;

export interface SupplierMonthlySettlementService {
  preview(month: string): Promise<SupplierSettlementSummary>;
  finalize(
    month: string,
    input: FinalizeSupplierSettlementInput,
    actorId: string,
    requestId: string,
  ): Promise<SupplierSettlementSummary>;
}

export class PostgresSupplierMonthlySettlementService implements SupplierMonthlySettlementService {
  constructor(
    private readonly db: Database,
    private readonly clock: () => Date = () => new Date(),
    private readonly createId: () => string = randomUUID,
  ) {}

  async preview(month: string): Promise<SupplierSettlementSummary> {
    return this.db.transaction(async (tx) => {
      const existing = await findSettlement(tx, month);
      const state = await loadCurrentState(tx, month, existing, false);
      return toSummary(month, state, existing, false);
    });
  }

  async finalize(
    month: string,
    input: FinalizeSupplierSettlementInput,
    actorId: string,
    requestId: string,
  ): Promise<SupplierSettlementSummary> {
    const now = this.clock();
    const window = settlementMonthWindow(month);
    if (window.end > now) {
      throw new OperationsConsoleFailure(
        'SETTLEMENT_MONTH_OPEN',
        '当前结算月份尚未结束，不能封账',
        409,
        { settlementMonth: month, periodEnd: window.end.toISOString() },
      );
    }

    return this.db.transaction(async (tx) => {
      await advisoryLock(tx, `supplier-settlement:${month}`);
      await advisoryLock(
        tx,
        `supplier-settlement-idempotency:${input.idempotencyKey}`,
      );
      const idempotencyOwner = await findSettlementByIdempotencyKey(
        tx,
        input.idempotencyKey,
      );
      if (
        idempotencyOwner &&
        idempotencyOwner.settlementMonth !== `${month}-01`
      ) {
        throw new OperationsConsoleFailure(
          'IDEMPOTENCY_CONFLICT',
          '同一幂等键已用于其他供应商结算月份',
          409,
        );
      }

      const existing = await findSettlement(tx, month);
      const state = await loadCurrentState(tx, month, existing, true);
      if (existing) {
        if (input.expectedSourceHash !== existing.sourceHash) {
          throw new OperationsConsoleFailure(
            'SETTLEMENT_ALREADY_FINALIZED',
            '该月份已经封账，不能使用其他预览结果再次结算',
            409,
            {
              settlementId: existing.id,
              finalizedSourceHash: existing.sourceHash,
            },
          );
        }
        return toSummary(month, state, existing, true);
      }
      if (input.expectedSourceHash !== state.projection.sourceHash) {
        throw new OperationsConsoleFailure(
          'SETTLEMENT_PREVIEW_STALE',
          '预览后账务数据已变化，请重新预览并核对',
          409,
          { currentSourceHash: state.projection.sourceHash },
        );
      }
      const projection = state.projection;
      const tier = projection.tier;
      if (state.issueCount > 0 || !tier) {
        throw new OperationsConsoleFailure(
          'SETTLEMENT_RECONCILIATION_BLOCKED',
          '账务核对存在差异，修复前不能封账',
          409,
          {
            discrepancyCount: state.issueCount,
            blockingTaskCount: state.blockingTaskCount,
            issues: state.issues,
          },
        );
      }
      const settlementId = this.createId();
      const [created] = await tx
        .insert(supplierMonthlySettlements)
        .values({
          id: settlementId,
          settlementMonth: `${month}-01`,
          supplierPricingTierId: tier.id,
          tierCodeSnapshot: tier.tierCode,
          tierNameSnapshot: tier.name,
          minMonthlyMinutesSnapshot: tier.minMonthlyMinutes,
          maxMonthlyMinutesSnapshot: tier.maxMonthlyMinutes,
          voiceRate: normalizeMoney(tier.voiceRate),
          taskCount: projection.taskCount,
          totalBillingMinutes: projection.totalBillingMinutes,
          totalCustomerCharge: projection.totalCustomerCharge,
          totalPlatformCost: projection.totalPlatformCost,
          totalProfit: projection.totalProfit,
          sourceHash: projection.sourceHash,
          finalizationIdempotencyKey: input.idempotencyKey,
          finalizationReason: input.reason,
          finalizedBy: actorId,
          finalizedAt: now,
          createdAt: now,
        })
        .returning();
      if (!created) throw new Error('供应商月结记录写入失败');

      for (
        let offset = 0;
        offset < projection.allocations.length;
        offset += 500
      ) {
        const batch = projection.allocations.slice(offset, offset + 500);
        await tx.insert(supplierSettlementTaskItems).values(
          batch.map((allocation) => ({
            settlementId,
            taskId: allocation.id,
            taskNo: allocation.taskNo,
            billingMinutes: allocation.billingMinutes,
            customerCharge: allocation.customerCharge,
            platformRate: allocation.platformRate,
            platformCost: allocation.platformCost,
            profit: allocation.profit,
            createdAt: now,
          })),
        );
      }
      if (projection.allocations.length > 0) {
        await tx
          .update(platformTasks)
          .set({
            platformRate: normalizeMoney(tier.voiceRate),
            platformCost: sql`${platformTasks.billingMinutes} * ${normalizeMoney(tier.voiceRate)}::numeric`,
            profit: sql`${platformTasks.customerCharge} - (${platformTasks.billingMinutes} * ${normalizeMoney(tier.voiceRate)}::numeric)`,
            supplierSettlementId: settlementId,
            updatedAt: now,
            lockVersion: sql`${platformTasks.lockVersion} + 1`,
          })
          .where(
            inArray(
              platformTasks.id,
              projection.allocations.map((allocation) => allocation.id),
            ),
          );
      }
      await tx.insert(auditLogs).values({
        id: this.createId(),
        requestId,
        actorId,
        action: 'SUPPLIER_MONTHLY_SETTLEMENT_FINALIZED',
        objectType: 'SUPPLIER_MONTHLY_SETTLEMENT',
        objectId: settlementId,
        detail: {
          settlementMonth: month,
          timezone: 'Asia/Shanghai',
          taskCount: projection.taskCount,
          totalBillingMinutes: projection.totalBillingMinutes.toString(),
          tierCode: tier.tierCode,
          voiceRate: normalizeMoney(tier.voiceRate),
          totalCustomerCharge: projection.totalCustomerCharge,
          totalPlatformCost: projection.totalPlatformCost,
          totalProfit: projection.totalProfit,
          sourceHash: projection.sourceHash,
          reason: input.reason,
        },
        occurredAt: now,
      });
      return toSummary(month, state, created, false);
    });
  }
}

async function loadCurrentState(
  tx: Transaction,
  month: string,
  existing: SettlementRow | undefined,
  lockTasks: boolean,
): Promise<CurrentSettlementState> {
  const window = settlementMonthWindow(month);
  const taskRows = lockTasks
    ? await tx.execute<MonthlyTaskRow>(sql`
        SELECT
          ${platformTasks.id} AS "id",
          ${platformTasks.taskNo} AS "taskNo",
          ${platformTasks.billingMinutes} AS "billingMinutes",
          ${platformTasks.customerCharge}::text AS "customerCharge",
          ${platformTasks.billingStatus} AS "billingStatus",
          ${platformTasks.executionStatus}::text AS "executionStatus",
          ${platformTasks.supplierSettlementId} AS "supplierSettlementId"
        FROM ${platformTasks}
        WHERE COALESCE(${platformTasks.providerCompletedAt}, ${platformTasks.closedAt}) >= ${window.start.toISOString()}::timestamptz
          AND COALESCE(${platformTasks.providerCompletedAt}, ${platformTasks.closedAt}) < ${window.end.toISOString()}::timestamptz
        ORDER BY ${platformTasks.taskNo}
        FOR UPDATE
      `)
    : await tx.execute<MonthlyTaskRow>(sql`
        SELECT
          ${platformTasks.id} AS "id",
          ${platformTasks.taskNo} AS "taskNo",
          ${platformTasks.billingMinutes} AS "billingMinutes",
          ${platformTasks.customerCharge}::text AS "customerCharge",
          ${platformTasks.billingStatus} AS "billingStatus",
          ${platformTasks.executionStatus}::text AS "executionStatus",
          ${platformTasks.supplierSettlementId} AS "supplierSettlementId"
        FROM ${platformTasks}
        WHERE COALESCE(${platformTasks.providerCompletedAt}, ${platformTasks.closedAt}) >= ${window.start.toISOString()}::timestamptz
          AND COALESCE(${platformTasks.providerCompletedAt}, ${platformTasks.closedAt}) < ${window.end.toISOString()}::timestamptz
        ORDER BY ${platformTasks.taskNo}
      `);
  const tiers = await tx
    .select()
    .from(supplierPricingTiers)
    .where(
      and(
        lte(supplierPricingTiers.effectiveFrom, window.start),
        or(
          sql`${supplierPricingTiers.effectiveTo} IS NULL`,
          sql`${supplierPricingTiers.effectiveTo} >= ${window.end.toISOString()}::timestamptz`,
        ),
      ),
    );
  const tierSources: SupplierSettlementTierSource[] = tiers.map((tier) => ({
    id: tier.id,
    tierCode: tier.tierCode,
    name: tier.name,
    minMonthlyMinutes: tier.minMonthlyMinutes,
    maxMonthlyMinutes: tier.maxMonthlyMinutes,
    voiceRate: normalizeMoney(tier.voiceRate),
    effectiveFrom: tier.effectiveFrom,
    effectiveTo: tier.effectiveTo,
  }));
  const settledTasks = taskRows.filter(
    (task) => task.billingStatus === 'SETTLED',
  );
  const projection = buildSupplierSettlementProjection({
    month,
    tasks: settledTasks.map((task) => ({
      id: task.id,
      taskNo: task.taskNo,
      billingMinutes: task.billingMinutes,
      customerCharge: task.customerCharge,
    })),
    tiers: tierSources,
  });
  const aggregates = await loadTaskAggregates(
    tx,
    settledTasks.map((task) => task.id),
  );
  const issues: SupplierSettlementIssue[] = [];
  const blockingTaskNos = new Set<string>();
  let issueCount = 0;
  const reportIssue = (issue: SupplierSettlementIssue) => {
    issueCount += 1;
    if (issue.taskNo) blockingTaskNos.add(issue.taskNo);
    if (issues.length < MAX_REPORTED_ISSUES) issues.push(issue);
  };
  for (const issue of projection.issues) reportIssue(issue);

  const blockingTasks = taskRows.filter(
    (task) => task.billingStatus !== 'SETTLED',
  );
  for (const task of blockingTasks) {
    reportIssue({
      code: 'TASK_NOT_SETTLED',
      taskNo: task.taskNo,
      message: `任务仍处于 ${task.executionStatus}/${task.billingStatus}，尚未完成客户账务结算`,
    });
  }
  for (const task of settledTasks) {
    const call = aggregates.calls.get(task.id) ?? {
      billingMinutes: '0',
      customerCharge: '0.000000',
    };
    const ledger = aggregates.ledgers.get(task.id) ?? {
      held: '0.000000',
      released: '0.000000',
      captured: '0.000000',
      overage: '0.000000',
    };
    const hold = aggregates.holds.get(task.id);
    if (BigInt(call.billingMinutes) !== BigInt(task.billingMinutes)) {
      reportIssue({
        code: 'TASK_CALL_MINUTES_MISMATCH',
        taskNo: task.taskNo,
        message: `任务计费分钟 ${task.billingMinutes} 与通话明细 ${call.billingMinutes} 不一致`,
      });
    }
    if (
      moneyToMicros(call.customerCharge) !== moneyToMicros(task.customerCharge)
    ) {
      reportIssue({
        code: 'TASK_CUSTOMER_CHARGE_MISMATCH',
        taskNo: task.taskNo,
        message: `任务客户话费 ${normalizeMoney(task.customerCharge)} 与通话明细 ${normalizeMoney(call.customerCharge)} 不一致`,
      });
    }
    const ledgerCharge = addMoney(ledger.captured, ledger.overage);
    if (moneyToMicros(ledgerCharge) !== moneyToMicros(task.customerCharge)) {
      reportIssue({
        code: 'TASK_LEDGER_CHARGE_MISMATCH',
        taskNo: task.taskNo,
        message: `任务客户话费 ${normalizeMoney(task.customerCharge)} 与账本实扣 ${ledgerCharge} 不一致`,
      });
    }
    if (
      moneyToMicros(ledger.held) !==
      moneyToMicros(addMoney(ledger.released, ledger.captured))
    ) {
      reportIssue({
        code: 'TASK_HOLD_CONSERVATION_MISMATCH',
        taskNo: task.taskNo,
        message: `冻结 ${normalizeMoney(ledger.held)} 不等于释放 ${normalizeMoney(ledger.released)} 与冻结捕获 ${normalizeMoney(ledger.captured)} 之和`,
      });
    }
    if (
      !hold ||
      hold.status === 'ACTIVE' ||
      moneyToMicros(hold.remainingAmount) !== 0n
    ) {
      reportIssue({
        code: 'TASK_HOLD_NOT_CLOSED',
        taskNo: task.taskNo,
        message: hold
          ? `资金冻结仍为 ${hold.status}/${normalizeMoney(hold.remainingAmount)}`
          : '任务缺少资金冻结记录',
      });
    }
  }

  let lateTaskCount = 0;
  if (existing) {
    lateTaskCount = settledTasks.filter(
      (task) => task.supplierSettlementId !== existing.id,
    ).length;
    if (projection.sourceHash !== existing.sourceHash || lateTaskCount > 0) {
      reportIssue({
        code: 'FINALIZED_SOURCE_DRIFT',
        taskNo: null,
        message: `已封账月份的来源数据发生变化，检测到 ${lateTaskCount} 个未归入原结算批次的任务`,
      });
    }
  }

  return {
    projection,
    issues,
    issueCount,
    blockingTaskCount: blockingTaskNos.size,
    lateTaskCount,
  };
}

async function loadTaskAggregates(tx: Transaction, taskIds: string[]) {
  const calls = new Map<
    string,
    Pick<CallAggregateRow, 'billingMinutes' | 'customerCharge'>
  >();
  const ledgers = new Map<
    string,
    Pick<LedgerAggregateRow, 'held' | 'released' | 'captured' | 'overage'>
  >();
  const holds = new Map<string, Pick<HoldRow, 'status' | 'remainingAmount'>>();
  if (taskIds.length === 0) return { calls, ledgers, holds };

  const [callRows, ledgerRows, holdRows] = await Promise.all([
    tx
      .select({
        taskId: callInstances.taskId,
        billingMinutes: sql<string>`coalesce(sum(${callInstances.billingMinutes}), 0)::bigint::text`,
        customerCharge: sql<string>`coalesce(sum(${callInstances.customerCharge}), 0)::numeric(18, 6)::text`,
      })
      .from(callInstances)
      .where(inArray(callInstances.taskId, taskIds))
      .groupBy(callInstances.taskId),
    tx
      .select({
        taskId: accountLedger.taskId,
        held: sql<string>`coalesce(sum(case when ${accountLedger.entryType} = 'TASK_HOLD' then -${accountLedger.amount} else 0 end), 0)::numeric(18, 6)::text`,
        released: sql<string>`coalesce(sum(case when ${accountLedger.entryType} = 'TASK_HOLD_RELEASE' then ${accountLedger.amount} else 0 end), 0)::numeric(18, 6)::text`,
        captured: sql<string>`coalesce(sum(case when ${accountLedger.entryType} = 'CALL_CHARGE' then -${accountLedger.amount} else 0 end), 0)::numeric(18, 6)::text`,
        overage: sql<string>`coalesce(sum(case when ${accountLedger.entryType} = 'OVERAGE_DEBIT' then -${accountLedger.amount} else 0 end), 0)::numeric(18, 6)::text`,
      })
      .from(accountLedger)
      .where(inArray(accountLedger.taskId, taskIds))
      .groupBy(accountLedger.taskId),
    tx
      .select({
        taskId: fundHolds.taskId,
        status: fundHolds.status,
        remainingAmount: fundHolds.remainingAmount,
      })
      .from(fundHolds)
      .where(inArray(fundHolds.taskId, taskIds)),
  ]);
  for (const row of callRows) calls.set(row.taskId, row);
  for (const row of ledgerRows) {
    if (row.taskId) ledgers.set(row.taskId, row as LedgerAggregateRow);
  }
  for (const row of holdRows) holds.set(row.taskId, row);
  return { calls, ledgers, holds };
}

async function findSettlement(
  tx: Transaction,
  month: string,
): Promise<SettlementRow | undefined> {
  const [row] = await tx
    .select()
    .from(supplierMonthlySettlements)
    .where(eq(supplierMonthlySettlements.settlementMonth, `${month}-01`))
    .limit(1);
  return row;
}

async function findSettlementByIdempotencyKey(
  tx: Transaction,
  idempotencyKey: string,
): Promise<SettlementRow | undefined> {
  const [row] = await tx
    .select()
    .from(supplierMonthlySettlements)
    .where(
      eq(supplierMonthlySettlements.finalizationIdempotencyKey, idempotencyKey),
    )
    .limit(1);
  return row;
}

function toSummary(
  month: string,
  state: CurrentSettlementState,
  settlement: SettlementRow | undefined,
  idempotentReplay: boolean,
): SupplierSettlementSummary {
  const projection = state.projection;
  const tier = settlement
    ? {
        id: settlement.supplierPricingTierId,
        tierCode: settlement.tierCodeSnapshot,
        name: settlement.tierNameSnapshot,
        minMonthlyMinutes: settlement.minMonthlyMinutesSnapshot.toString(),
        maxMonthlyMinutes:
          settlement.maxMonthlyMinutesSnapshot?.toString() ?? null,
        voiceRate: normalizeMoney(settlement.voiceRate),
      }
    : projection.tier
      ? {
          id: projection.tier.id,
          tierCode: projection.tier.tierCode,
          name: projection.tier.name,
          minMonthlyMinutes: projection.tier.minMonthlyMinutes.toString(),
          maxMonthlyMinutes:
            projection.tier.maxMonthlyMinutes?.toString() ?? null,
          voiceRate: normalizeMoney(projection.tier.voiceRate),
        }
      : null;
  return supplierSettlementSummarySchema.parse({
    settlementId: settlement?.id ?? null,
    settlementMonth: month,
    timezone: 'Asia/Shanghai',
    periodStart: projection.periodStart.toISOString(),
    periodEnd: projection.periodEnd.toISOString(),
    status: settlement ? 'FINALIZED' : 'OPEN',
    taskCount: settlement?.taskCount ?? projection.taskCount,
    totalBillingMinutes:
      settlement?.totalBillingMinutes.toString() ??
      projection.totalBillingMinutes.toString(),
    tier,
    totalCustomerCharge: normalizeMoney(
      settlement?.totalCustomerCharge ?? projection.totalCustomerCharge,
    ),
    totalPlatformCost: normalizeMoney(
      settlement?.totalPlatformCost ?? projection.totalPlatformCost,
    ),
    totalProfit: normalizeMoney(
      settlement?.totalProfit ?? projection.totalProfit,
    ),
    sourceHash: settlement?.sourceHash ?? projection.sourceHash,
    reconciliation: {
      status: state.issueCount === 0 ? 'BALANCED' : 'BLOCKED',
      discrepancyCount: state.issueCount,
      blockingTaskCount: state.blockingTaskCount,
      lateTaskCount: state.lateTaskCount,
      issues: state.issues,
      issuesTruncated: state.issueCount > state.issues.length,
    },
    finalizedBy: settlement?.finalizedBy ?? null,
    finalizedAt: settlement?.finalizedAt.toISOString() ?? null,
    idempotentReplay,
  });
}

async function advisoryLock(tx: Transaction, key: string): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
  );
}

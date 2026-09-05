import { desc, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  accountLedger,
  fundHolds,
  platformTasks,
  studioAccounts,
} from '../db/schema.js';
import {
  AccountNotFoundError,
  AccountUnavailableError,
  FundHoldConflictError,
  InsufficientBalanceError,
  LedgerIdempotencyConflictError,
  type AccountLedgerEntry,
  type AccountRepository,
  type FundHold,
  type ReservationResult,
  type StudioAccountState,
} from './repository.js';
import {
  addMoney,
  moneyToMicros,
  negateMoney,
  normalizeMoney,
  requirePositiveMoney,
  subtractMoney,
} from './money.js';

type LockedAccount = {
  studioId: string;
  currency: string;
  balance: string;
  activeHoldAmount: string;
  status: StudioAccountState['status'];
  lockVersion: number;
  updatedAt: Date;
};

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export class PostgresAccountRepository implements AccountRepository {
  private readonly lowBalanceThreshold: string;

  constructor(
    private readonly db: Database,
    lowBalanceThreshold = '500.000000',
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.lowBalanceThreshold = requirePositiveMoney(lowBalanceThreshold);
  }

  async getAccount(studioId: string): Promise<StudioAccountState | null> {
    const [row] = await this.db
      .select()
      .from(studioAccounts)
      .where(eq(studioAccounts.studioId, studioId))
      .limit(1);
    return row ? toAccount(row) : null;
  }

  async listLedger(
    studioId: string,
    limit = 100,
  ): Promise<AccountLedgerEntry[]> {
    const pageSize = Math.max(1, Math.min(limit, 500));
    const rows = await this.db
      .select()
      .from(accountLedger)
      .where(eq(accountLedger.studioId, studioId))
      .orderBy(desc(accountLedger.occurredAt), desc(accountLedger.id))
      .limit(pageSize);
    return rows.map(toLedger);
  }

  async topUp(input: {
    studioId: string;
    amount: string;
    businessKey: string;
    operatorId: string;
    reason: string;
  }): Promise<{ account: StudioAccountState; ledger: AccountLedgerEntry }> {
    const amount = requirePositiveMoney(input.amount);
    assertBusinessKey(input.businessKey);

    return this.db.transaction(async (tx) => {
      await acquireBusinessLock(tx, `ledger:${input.businessKey}`);
      const [existing] = await tx
        .select()
        .from(accountLedger)
        .where(eq(accountLedger.businessKey, input.businessKey))
        .limit(1);
      if (existing) {
        if (
          existing.studioId !== input.studioId ||
          existing.entryType !== 'TOP_UP' ||
          normalizeMoney(existing.amount) !== amount
        ) {
          throw new LedgerIdempotencyConflictError(
            '同一账本业务键对应了不同的充值请求',
          );
        }
        const account = await this.lockAccount(tx, input.studioId);
        return { account: toAccount(account), ledger: toLedger(existing) };
      }

      const account = await this.lockAccount(tx, input.studioId);
      const balanceAfter = addMoney(account.balance, amount);
      const availableBalanceAfter = subtractMoney(
        balanceAfter,
        account.activeHoldAmount,
      );
      const status = this.statusForBalances(
        balanceAfter,
        availableBalanceAfter,
        account.status,
      );
      const now = this.clock();
      const [updated] = await tx
        .update(studioAccounts)
        .set({
          balance: balanceAfter,
          status,
          lockVersion: sql`${studioAccounts.lockVersion} + 1`,
          updatedAt: now,
        })
        .where(eq(studioAccounts.studioId, input.studioId))
        .returning();
      const [ledger] = await tx
        .insert(accountLedger)
        .values({
          studioId: input.studioId,
          entryType: 'TOP_UP',
          amount,
          balanceAfter,
          availableBalanceAfter,
          businessKey: input.businessKey,
          operatorId: input.operatorId,
          reason: input.reason,
          occurredAt: now,
        })
        .returning();
      return { account: toAccount(updated), ledger: toLedger(ledger) };
    });
  }

  async reserveFunds(input: {
    studioId: string;
    taskId: string;
    amount: string;
    operatorId: string;
  }): Promise<ReservationResult> {
    const amount = requirePositiveMoney(input.amount);

    return this.db.transaction(async (tx) => {
      await acquireBusinessLock(tx, `fund-hold:${input.taskId}`);
      const [task] = await tx
        .select({
          studioId: platformTasks.studioId,
          reservedAmount: platformTasks.reservedAmount,
        })
        .from(platformTasks)
        .where(eq(platformTasks.id, input.taskId))
        .limit(1);
      if (!task || task.studioId !== input.studioId) {
        throw new FundHoldConflictError('资金冻结对应的平台任务或影楼不匹配');
      }
      if (normalizeMoney(task.reservedAmount) !== amount) {
        throw new FundHoldConflictError('冻结金额与任务价格快照不一致');
      }

      const [existing] = await tx
        .select()
        .from(fundHolds)
        .where(eq(fundHolds.taskId, input.taskId))
        .limit(1);
      if (existing) {
        if (
          existing.studioId !== input.studioId ||
          normalizeMoney(existing.originalAmount) !== amount
        ) {
          throw new FundHoldConflictError('任务已存在不同金额的冻结记录');
        }
        const account = await this.lockAccount(tx, input.studioId);
        const [ledger] = await tx
          .select()
          .from(accountLedger)
          .where(eq(accountLedger.businessKey, `TASK_HOLD:${input.taskId}`))
          .limit(1);
        if (!ledger)
          throw new FundHoldConflictError('冻结记录缺少对应账本流水');
        return {
          account: toAccount(account),
          hold: toHold(existing),
          ledger: toLedger(ledger),
        };
      }

      const account = await this.lockAccount(tx, input.studioId);
      if (account.status === 'DISABLED' || account.status === 'OVERDUE') {
        throw new AccountUnavailableError(
          `账户状态 ${account.status} 不允许新冻结`,
        );
      }
      const available = subtractMoney(
        account.balance,
        account.activeHoldAmount,
      );
      if (moneyToMicros(available) < moneyToMicros(amount)) {
        throw new InsufficientBalanceError('影楼可用余额不足');
      }

      const now = this.clock();
      const activeHoldAmount = addMoney(account.activeHoldAmount, amount);
      const [updated] = await tx
        .update(studioAccounts)
        .set({
          activeHoldAmount,
          status: this.statusForBalances(
            account.balance,
            subtractMoney(account.balance, activeHoldAmount),
            account.status,
          ),
          lockVersion: sql`${studioAccounts.lockVersion} + 1`,
          updatedAt: now,
        })
        .where(eq(studioAccounts.studioId, input.studioId))
        .returning();
      const [hold] = await tx
        .insert(fundHolds)
        .values({
          studioId: input.studioId,
          taskId: input.taskId,
          originalAmount: amount,
          remainingAmount: amount,
          createdAt: now,
        })
        .returning();
      const [ledger] = await tx
        .insert(accountLedger)
        .values({
          studioId: input.studioId,
          taskId: input.taskId,
          entryType: 'TASK_HOLD',
          amount: negateMoney(amount),
          balanceAfter: account.balance,
          availableBalanceAfter: subtractMoney(
            account.balance,
            activeHoldAmount,
          ),
          businessKey: `TASK_HOLD:${input.taskId}`,
          operatorId: input.operatorId,
          reason: '创建外呼任务冻结余额',
          occurredAt: now,
        })
        .returning();
      return {
        account: toAccount(updated),
        hold: toHold(hold),
        ledger: toLedger(ledger),
      };
    });
  }

  async releaseHold(input: {
    taskId: string;
    operatorId: string;
    reason: string;
  }): Promise<ReservationResult> {
    return this.db.transaction(async (tx) => {
      await acquireBusinessLock(tx, `fund-hold:${input.taskId}`);
      const holds = await tx.execute<{
        id: string;
        studioId: string;
        taskId: string;
        originalAmount: string;
        remainingAmount: string;
        status: FundHold['status'];
        createdAt: Date;
        releasedAt: Date | null;
      }>(sql`
        SELECT
          ${fundHolds.id} AS "id",
          ${fundHolds.studioId} AS "studioId",
          ${fundHolds.taskId} AS "taskId",
          ${fundHolds.originalAmount} AS "originalAmount",
          ${fundHolds.remainingAmount} AS "remainingAmount",
          ${fundHolds.status} AS "status",
          ${fundHolds.createdAt} AS "createdAt",
          ${fundHolds.releasedAt} AS "releasedAt"
        FROM ${fundHolds}
        WHERE ${fundHolds.taskId} = ${input.taskId}
        FOR UPDATE
      `);
      const hold = holds[0];
      if (!hold) throw new FundHoldConflictError('任务不存在资金冻结记录');
      if (hold.status === 'CAPTURED') {
        throw new FundHoldConflictError('已结算的冻结记录不能释放');
      }

      const account = await this.lockAccount(tx, hold.studioId);
      const businessKey = `TASK_HOLD_RELEASE:${input.taskId}`;
      const [existingLedger] = await tx
        .select()
        .from(accountLedger)
        .where(eq(accountLedger.businessKey, businessKey))
        .limit(1);
      if (hold.status === 'RELEASED') {
        if (!existingLedger) {
          throw new FundHoldConflictError('已释放记录缺少对应账本流水');
        }
        return {
          account: toAccount(account),
          hold: toHold(hold),
          ledger: toLedger(existingLedger),
        };
      }

      const remainingAmount = normalizeMoney(hold.remainingAmount);
      const activeHoldAmount = subtractMoney(
        account.activeHoldAmount,
        remainingAmount,
      );
      if (moneyToMicros(activeHoldAmount) < 0n) {
        throw new FundHoldConflictError('账户冻结汇总小于待释放金额');
      }
      const now = this.clock();
      const [updatedAccount] = await tx
        .update(studioAccounts)
        .set({
          activeHoldAmount,
          status: this.statusForBalances(
            account.balance,
            subtractMoney(account.balance, activeHoldAmount),
            account.status,
          ),
          lockVersion: sql`${studioAccounts.lockVersion} + 1`,
          updatedAt: now,
        })
        .where(eq(studioAccounts.studioId, hold.studioId))
        .returning();
      const [updatedHold] = await tx
        .update(fundHolds)
        .set({
          remainingAmount: '0.000000',
          status: 'RELEASED',
          releasedAt: now,
        })
        .where(eq(fundHolds.id, hold.id))
        .returning();
      const [ledger] = await tx
        .insert(accountLedger)
        .values({
          studioId: hold.studioId,
          taskId: input.taskId,
          entryType: 'TASK_HOLD_RELEASE',
          amount: remainingAmount,
          balanceAfter: account.balance,
          availableBalanceAfter: subtractMoney(
            account.balance,
            activeHoldAmount,
          ),
          businessKey,
          operatorId: input.operatorId,
          reason: input.reason,
          occurredAt: now,
        })
        .returning();
      return {
        account: toAccount(updatedAccount),
        hold: toHold(updatedHold),
        ledger: toLedger(ledger),
      };
    });
  }

  private async lockAccount(
    tx: Transaction,
    studioId: string,
  ): Promise<LockedAccount> {
    const rows = await tx.execute<LockedAccount>(sql`
      SELECT
        ${studioAccounts.studioId} AS "studioId",
        ${studioAccounts.currency} AS "currency",
        ${studioAccounts.balance} AS "balance",
        ${studioAccounts.activeHoldAmount} AS "activeHoldAmount",
        ${studioAccounts.status} AS "status",
        ${studioAccounts.lockVersion} AS "lockVersion",
        ${studioAccounts.updatedAt} AS "updatedAt"
      FROM ${studioAccounts}
      WHERE ${studioAccounts.studioId} = ${studioId}
      FOR UPDATE
    `);
    const account = rows[0];
    if (!account) throw new AccountNotFoundError('影楼账户不存在');
    return account;
  }

  private statusForBalances(
    balance: string,
    availableBalance: string,
    currentStatus: StudioAccountState['status'],
  ): StudioAccountState['status'] {
    if (currentStatus === 'DISABLED') return 'DISABLED';
    if (moneyToMicros(balance) <= 0n) return 'OVERDUE';
    if (
      moneyToMicros(availableBalance) < moneyToMicros(this.lowBalanceThreshold)
    ) {
      return 'LOW_BALANCE';
    }
    return 'ACTIVE';
  }
}

async function acquireBusinessLock(
  tx: Transaction,
  key: string,
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
  );
}

function assertBusinessKey(value: string): void {
  if (!value || value.length > 256) {
    throw new TypeError('账本业务键长度必须为 1～256 字符');
  }
}

function toAccount(
  row: LockedAccount | typeof studioAccounts.$inferSelect,
): StudioAccountState {
  const balance = normalizeMoney(row.balance);
  const activeHoldAmount = normalizeMoney(row.activeHoldAmount);
  return {
    studioId: row.studioId,
    currency: 'CNY',
    balance,
    activeHoldAmount,
    availableBalance: subtractMoney(balance, activeHoldAmount),
    status: row.status,
    lockVersion: row.lockVersion,
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

function toHold(row: typeof fundHolds.$inferSelect): FundHold {
  return {
    id: row.id,
    studioId: row.studioId,
    taskId: row.taskId,
    originalAmount: normalizeMoney(row.originalAmount),
    remainingAmount: normalizeMoney(row.remainingAmount),
    status: row.status,
    createdAt: new Date(row.createdAt).toISOString(),
    releasedAt: row.releasedAt ? new Date(row.releasedAt).toISOString() : null,
  };
}

function toLedger(row: typeof accountLedger.$inferSelect): AccountLedgerEntry {
  return {
    id: row.id,
    studioId: row.studioId,
    taskId: row.taskId,
    callInstanceId: row.callInstanceId,
    entryType: row.entryType,
    amount: normalizeMoney(row.amount),
    balanceAfter: normalizeMoney(row.balanceAfter),
    availableBalanceAfter: normalizeMoney(row.availableBalanceAfter),
    businessKey: row.businessKey,
    operatorId: row.operatorId,
    reason: row.reason,
    occurredAt: new Date(row.occurredAt).toISOString(),
  };
}

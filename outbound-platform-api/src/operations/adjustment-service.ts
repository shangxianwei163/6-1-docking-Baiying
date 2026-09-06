import { randomUUID } from 'node:crypto';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import {
  operatorAccountAdjustmentPageSchema,
  operatorAccountAdjustmentSchema,
  type AccountAdjustmentKind,
  type AccountAdjustmentStatus,
  type CreateAccountAdjustmentInput,
  type DecideAccountAdjustmentInput,
  type OperatorAccountAdjustment,
  type OperatorAccountAdjustmentPage,
} from '@outbound/contracts';
import {
  addMoney,
  moneyToMicros,
  negateMoney,
  normalizeMoney,
  requirePositiveMoney,
  subtractMoney,
} from '../billing/money.js';
import type { Database } from '../db/client.js';
import {
  accountAdjustmentRequests,
  accountLedger,
  auditLogs,
  studioAccounts,
  studios,
} from '../db/schema.js';
import { OperationsConsoleFailure } from './service.js';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type AdjustmentRow = typeof accountAdjustmentRequests.$inferSelect;
type AccountStatus = typeof studioAccounts.$inferSelect.status;

export type AdjustmentListInput = {
  keyword?: string;
  studioId?: string;
  kind?: AccountAdjustmentKind;
  status?: AccountAdjustmentStatus;
  pageNum: number;
  pageSize: number;
};

export interface AccountAdjustmentService {
  listAdjustments(
    input: AdjustmentListInput,
    actorId: string,
  ): Promise<OperatorAccountAdjustmentPage>;
  createAdjustment(
    input: CreateAccountAdjustmentInput,
    actorId: string,
    requestId: string,
  ): Promise<OperatorAccountAdjustment>;
  decideAdjustment(
    adjustmentId: string,
    input: DecideAccountAdjustmentInput,
    actorId: string,
    requestId: string,
  ): Promise<OperatorAccountAdjustment>;
}

export class PostgresAccountAdjustmentService implements AccountAdjustmentService {
  constructor(
    private readonly db: Database,
    private readonly clock: () => Date = () => new Date(),
    private readonly createId: () => string = randomUUID,
  ) {}

  async listAdjustments(
    input: AdjustmentListInput,
    actorId: string,
  ): Promise<OperatorAccountAdjustmentPage> {
    const keyword = input.keyword?.trim();
    const keywordCondition = keyword
      ? or(
          ilike(accountAdjustmentRequests.requestNo, containsPattern(keyword)),
          ilike(studios.businessCode, containsPattern(keyword)),
          ilike(studios.name, containsPattern(keyword)),
          ilike(
            accountAdjustmentRequests.requestedBy,
            containsPattern(keyword),
          ),
          ilike(accountAdjustmentRequests.reviewedBy, containsPattern(keyword)),
          ilike(accountAdjustmentRequests.reason, containsPattern(keyword)),
          ilike(
            accountAdjustmentRequests.supportingReference,
            containsPattern(keyword),
          ),
        )
      : undefined;
    const baseWhere = and(
      keywordCondition,
      input.studioId
        ? eq(accountAdjustmentRequests.studioId, input.studioId)
        : undefined,
    );
    const filteredWhere = and(
      baseWhere,
      input.kind ? eq(accountAdjustmentRequests.kind, input.kind) : undefined,
      input.status
        ? eq(accountAdjustmentRequests.status, input.status)
        : undefined,
    );
    const [totalRow, summaryRow, rows] = await Promise.all([
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(accountAdjustmentRequests)
        .innerJoin(studios, eq(studios.id, accountAdjustmentRequests.studioId))
        .where(filteredWhere)
        .then((result) => result[0]),
      this.db
        .select({
          all: sql<number>`count(*)::int`,
          pending: sql<number>`count(*) filter (where ${accountAdjustmentRequests.status} = 'PENDING')::int`,
          approved: sql<number>`count(*) filter (where ${accountAdjustmentRequests.status} = 'APPROVED')::int`,
          rejected: sql<number>`count(*) filter (where ${accountAdjustmentRequests.status} = 'REJECTED')::int`,
          pendingCreditAmount: sql<string>`coalesce(sum(case when ${accountAdjustmentRequests.status} = 'PENDING' and ${accountAdjustmentRequests.kind} = 'ADJUSTMENT_CREDIT' then ${accountAdjustmentRequests.amount} else 0 end), 0)::text`,
          pendingDebitAmount: sql<string>`coalesce(sum(case when ${accountAdjustmentRequests.status} = 'PENDING' and ${accountAdjustmentRequests.kind} in ('REFUND', 'ADJUSTMENT_DEBIT') then ${accountAdjustmentRequests.amount} else 0 end), 0)::text`,
        })
        .from(accountAdjustmentRequests)
        .innerJoin(studios, eq(studios.id, accountAdjustmentRequests.studioId))
        .where(baseWhere)
        .then((result) => result[0]),
      this.db
        .select({
          adjustment: accountAdjustmentRequests,
          studioBusinessCode: studios.businessCode,
          studioName: studios.name,
          accountBalance: studioAccounts.balance,
          accountActiveHoldAmount: studioAccounts.activeHoldAmount,
          accountStatus: studioAccounts.status,
          ledgerAmount: accountLedger.amount,
          ledgerBalanceAfter: accountLedger.balanceAfter,
          ledgerAvailableBalanceAfter: accountLedger.availableBalanceAfter,
          ledgerOccurredAt: accountLedger.occurredAt,
        })
        .from(accountAdjustmentRequests)
        .innerJoin(studios, eq(studios.id, accountAdjustmentRequests.studioId))
        .innerJoin(
          studioAccounts,
          eq(studioAccounts.studioId, accountAdjustmentRequests.studioId),
        )
        .leftJoin(
          accountLedger,
          eq(accountLedger.id, accountAdjustmentRequests.ledgerId),
        )
        .where(filteredWhere)
        .orderBy(
          desc(accountAdjustmentRequests.requestedAt),
          desc(accountAdjustmentRequests.id),
        )
        .limit(input.pageSize)
        .offset(input.pageNum * input.pageSize),
    ]);
    const total = totalRow?.total ?? 0;
    return operatorAccountAdjustmentPageSchema.parse({
      total,
      pages: Math.ceil(total / input.pageSize),
      pageNum: input.pageNum,
      pageSize: input.pageSize,
      summary: {
        all: summaryRow?.all ?? 0,
        pending: summaryRow?.pending ?? 0,
        approved: summaryRow?.approved ?? 0,
        rejected: summaryRow?.rejected ?? 0,
        pendingCreditAmount: normalizeMoney(
          summaryRow?.pendingCreditAmount ?? '0',
        ),
        pendingDebitAmount: normalizeMoney(
          summaryRow?.pendingDebitAmount ?? '0',
        ),
      },
      items: rows.map((row) => toOperatorAdjustment(row, actorId)),
    });
  }

  async createAdjustment(
    input: CreateAccountAdjustmentInput,
    actorId: string,
    requestId: string,
  ): Promise<OperatorAccountAdjustment> {
    const amount = requirePositiveMoney(input.amount);
    const now = this.clock();
    const adjustmentId = await this.db.transaction(async (tx) => {
      await advisoryLock(tx, `operator:adjustment:${input.idempotencyKey}`);
      const [existing] = await tx
        .select()
        .from(accountAdjustmentRequests)
        .where(
          eq(accountAdjustmentRequests.idempotencyKey, input.idempotencyKey),
        )
        .limit(1);
      if (existing) {
        if (!sameCreateRequest(existing, input, amount, actorId)) {
          throw new OperationsConsoleFailure(
            'IDEMPOTENCY_CONFLICT',
            '同一幂等键已用于不同的退款或调整申请',
            409,
          );
        }
        return existing.id;
      }

      const studio = await requireStudio(tx, input.studioId);
      const account = await lockAccount(tx, input.studioId);
      const availableBalance = subtractMoney(
        account.balance,
        account.activeHoldAmount,
      );
      if (
        isDebit(input.kind) &&
        moneyToMicros(amount) > moneyToMicros(availableBalance)
      ) {
        throw new OperationsConsoleFailure(
          'INSUFFICIENT_AVAILABLE_BALANCE',
          '当前可用余额不足，不能发起该笔退款或冲减',
          409,
          { availableBalance },
        );
      }
      const requestNo = await nextRequestNo(tx, now);
      const [created] = await tx
        .insert(accountAdjustmentRequests)
        .values({
          id: this.createId(),
          requestNo,
          idempotencyKey: input.idempotencyKey,
          studioId: input.studioId,
          kind: input.kind,
          amount,
          balanceSnapshot: normalizeMoney(account.balance),
          availableBalanceSnapshot: availableBalance,
          reason: input.reason,
          supportingReference: input.supportingReference ?? null,
          requestedBy: actorId,
          requestedAt: now,
        })
        .returning();
      await tx.insert(auditLogs).values({
        id: this.createId(),
        requestId,
        actorId,
        action: 'ACCOUNT_ADJUSTMENT_REQUESTED',
        objectType: 'ACCOUNT_ADJUSTMENT_REQUEST',
        objectId: created.id,
        detail: {
          requestNo,
          studioId: studio.id,
          studioBusinessCode: studio.businessCode,
          kind: input.kind,
          amount,
          balanceSnapshot: normalizeMoney(account.balance),
          availableBalanceSnapshot: availableBalance,
          supportingReference: input.supportingReference ?? null,
          reason: input.reason,
        },
        occurredAt: now,
      });
      return created.id;
    });
    return this.requireAdjustment(adjustmentId, actorId);
  }

  async decideAdjustment(
    adjustmentId: string,
    input: DecideAccountAdjustmentInput,
    actorId: string,
    requestId: string,
  ): Promise<OperatorAccountAdjustment> {
    const now = this.clock();
    await this.db.transaction(async (tx) => {
      const adjustment = await lockAdjustment(tx, adjustmentId);
      const targetStatus =
        input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      if (adjustment.status !== 'PENDING') {
        if (
          adjustment.status === targetStatus &&
          adjustment.reviewedBy === actorId &&
          adjustment.reviewNote === input.note
        ) {
          return;
        }
        throw new OperationsConsoleFailure(
          'ADJUSTMENT_ALREADY_REVIEWED',
          `申请 ${adjustment.requestNo} 已完成复核，不能重复处理`,
          409,
        );
      }
      if (adjustment.requestedBy === actorId) {
        throw new OperationsConsoleFailure(
          'SELF_REVIEW_NOT_ALLOWED',
          '申请人与复核人必须是不同管理员',
          409,
        );
      }

      if (input.decision === 'REJECT') {
        await tx
          .update(accountAdjustmentRequests)
          .set({
            status: 'REJECTED',
            reviewedBy: actorId,
            reviewNote: input.note,
            reviewedAt: now,
            lockVersion: sql`${accountAdjustmentRequests.lockVersion} + 1`,
          })
          .where(eq(accountAdjustmentRequests.id, adjustment.id));
        await writeDecisionAudit(tx, {
          id: this.createId(),
          requestId,
          actorId,
          action: 'ACCOUNT_ADJUSTMENT_REJECTED',
          adjustment,
          reviewNote: input.note,
          occurredAt: now,
        });
        return;
      }

      const studio = await requireStudio(tx, adjustment.studioId);
      const account = await lockAccount(tx, adjustment.studioId);
      const amount = normalizeMoney(adjustment.amount);
      const availableBefore = subtractMoney(
        account.balance,
        account.activeHoldAmount,
      );
      if (
        isDebit(adjustment.kind) &&
        moneyToMicros(amount) > moneyToMicros(availableBefore)
      ) {
        throw new OperationsConsoleFailure(
          'INSUFFICIENT_AVAILABLE_BALANCE',
          '复核时可用余额不足，申请暂不能批准',
          409,
          { availableBalance: availableBefore },
        );
      }
      const signedAmount = balanceChange(adjustment.kind, amount);
      const balanceAfter = addMoney(account.balance, signedAmount);
      const availableAfter = subtractMoney(
        balanceAfter,
        account.activeHoldAmount,
      );
      const accountStatus =
        studio.status === 'DISABLED' || account.status === 'DISABLED'
          ? 'DISABLED'
          : accountStatusAfter(balanceAfter, availableAfter);
      await tx
        .update(studioAccounts)
        .set({
          balance: balanceAfter,
          status: accountStatus,
          lockVersion: sql`${studioAccounts.lockVersion} + 1`,
          updatedAt: now,
        })
        .where(eq(studioAccounts.studioId, adjustment.studioId));
      const [ledger] = await tx
        .insert(accountLedger)
        .values({
          id: this.createId(),
          studioId: adjustment.studioId,
          entryType: adjustment.kind === 'REFUND' ? 'REFUND' : 'ADJUSTMENT',
          amount: signedAmount,
          balanceAfter,
          availableBalanceAfter: availableAfter,
          businessKey: `ACCOUNT_ADJUSTMENT:${adjustment.id}`,
          operatorId: actorId,
          reason: `审批 ${adjustment.requestNo}：${adjustment.reason}`,
          occurredAt: now,
        })
        .returning();
      await tx
        .update(accountAdjustmentRequests)
        .set({
          status: 'APPROVED',
          reviewedBy: actorId,
          reviewNote: input.note,
          reviewedAt: now,
          ledgerId: ledger.id,
          lockVersion: sql`${accountAdjustmentRequests.lockVersion} + 1`,
        })
        .where(eq(accountAdjustmentRequests.id, adjustment.id));
      await writeDecisionAudit(tx, {
        id: this.createId(),
        requestId,
        actorId,
        action: 'ACCOUNT_ADJUSTMENT_APPROVED',
        adjustment,
        reviewNote: input.note,
        occurredAt: now,
        signedAmount,
        balanceBefore: normalizeMoney(account.balance),
        balanceAfter,
        ledgerId: ledger.id,
      });
    });
    return this.requireAdjustment(adjustmentId, actorId);
  }

  private async requireAdjustment(
    adjustmentId: string,
    actorId: string,
  ): Promise<OperatorAccountAdjustment> {
    const [row] = await this.db
      .select({
        adjustment: accountAdjustmentRequests,
        studioBusinessCode: studios.businessCode,
        studioName: studios.name,
        accountBalance: studioAccounts.balance,
        accountActiveHoldAmount: studioAccounts.activeHoldAmount,
        accountStatus: studioAccounts.status,
        ledgerAmount: accountLedger.amount,
        ledgerBalanceAfter: accountLedger.balanceAfter,
        ledgerAvailableBalanceAfter: accountLedger.availableBalanceAfter,
        ledgerOccurredAt: accountLedger.occurredAt,
      })
      .from(accountAdjustmentRequests)
      .innerJoin(studios, eq(studios.id, accountAdjustmentRequests.studioId))
      .innerJoin(
        studioAccounts,
        eq(studioAccounts.studioId, accountAdjustmentRequests.studioId),
      )
      .leftJoin(
        accountLedger,
        eq(accountLedger.id, accountAdjustmentRequests.ledgerId),
      )
      .where(eq(accountAdjustmentRequests.id, adjustmentId))
      .limit(1);
    if (!row) {
      throw new OperationsConsoleFailure(
        'ADJUSTMENT_NOT_FOUND',
        '退款或调整申请不存在',
        404,
      );
    }
    return operatorAccountAdjustmentSchema.parse(
      toOperatorAdjustment(row, actorId),
    );
  }
}

function toOperatorAdjustment(
  row: {
    adjustment: AdjustmentRow;
    studioBusinessCode: string;
    studioName: string;
    accountBalance: string;
    accountActiveHoldAmount: string;
    accountStatus: AccountStatus;
    ledgerAmount: string | null;
    ledgerBalanceAfter: string | null;
    ledgerAvailableBalanceAfter: string | null;
    ledgerOccurredAt: Date | null;
  },
  actorId: string,
): OperatorAccountAdjustment {
  const adjustment = row.adjustment;
  return {
    id: adjustment.id,
    requestNo: adjustment.requestNo,
    studioId: adjustment.studioId,
    studioBusinessCode: row.studioBusinessCode,
    studioName: row.studioName,
    kind: adjustment.kind,
    amount: normalizeMoney(adjustment.amount),
    balanceChange: balanceChange(adjustment.kind, adjustment.amount),
    balanceSnapshot: normalizeMoney(adjustment.balanceSnapshot),
    availableBalanceSnapshot: normalizeMoney(
      adjustment.availableBalanceSnapshot,
    ),
    currentBalance: normalizeMoney(row.accountBalance),
    currentAvailableBalance: subtractMoney(
      row.accountBalance,
      row.accountActiveHoldAmount,
    ),
    currentAccountStatus: row.accountStatus,
    reason: adjustment.reason,
    supportingReference: adjustment.supportingReference,
    status: adjustment.status,
    requestedBy: adjustment.requestedBy,
    requestedAt: adjustment.requestedAt.toISOString(),
    reviewedBy: adjustment.reviewedBy,
    reviewNote: adjustment.reviewNote,
    reviewedAt: adjustment.reviewedAt?.toISOString() ?? null,
    ledger:
      adjustment.ledgerId &&
      row.ledgerAmount !== null &&
      row.ledgerBalanceAfter !== null &&
      row.ledgerAvailableBalanceAfter !== null &&
      row.ledgerOccurredAt
        ? {
            ledgerId: adjustment.ledgerId,
            amount: normalizeMoney(row.ledgerAmount),
            balanceAfter: normalizeMoney(row.ledgerBalanceAfter),
            availableBalanceAfter: normalizeMoney(
              row.ledgerAvailableBalanceAfter,
            ),
            occurredAt: row.ledgerOccurredAt.toISOString(),
          }
        : null,
    canReview:
      adjustment.status === 'PENDING' && adjustment.requestedBy !== actorId,
    lockVersion: adjustment.lockVersion,
  };
}

function sameCreateRequest(
  existing: AdjustmentRow,
  input: CreateAccountAdjustmentInput,
  amount: string,
  actorId: string,
) {
  return (
    existing.studioId === input.studioId &&
    existing.kind === input.kind &&
    normalizeMoney(existing.amount) === amount &&
    existing.reason === input.reason &&
    existing.supportingReference === (input.supportingReference ?? null) &&
    existing.requestedBy === actorId
  );
}

function balanceChange(kind: AccountAdjustmentKind, amount: string) {
  return kind === 'ADJUSTMENT_CREDIT'
    ? normalizeMoney(amount)
    : negateMoney(amount);
}

function isDebit(kind: AccountAdjustmentKind) {
  return kind === 'REFUND' || kind === 'ADJUSTMENT_DEBIT';
}

async function requireStudio(db: Database | Transaction, studioId: string) {
  const [studio] = await db
    .select({
      id: studios.id,
      businessCode: studios.businessCode,
      status: studios.status,
    })
    .from(studios)
    .where(eq(studios.id, studioId))
    .limit(1);
  if (!studio) {
    throw new OperationsConsoleFailure('STUDIO_NOT_FOUND', '影楼不存在', 404);
  }
  return studio;
}

async function lockAdjustment(tx: Transaction, adjustmentId: string) {
  const rows = await tx.execute<AdjustmentRow>(sql`
    select
      ${accountAdjustmentRequests.id} as "id",
      ${accountAdjustmentRequests.requestNo} as "requestNo",
      ${accountAdjustmentRequests.idempotencyKey} as "idempotencyKey",
      ${accountAdjustmentRequests.studioId} as "studioId",
      ${accountAdjustmentRequests.kind} as "kind",
      ${accountAdjustmentRequests.amount} as "amount",
      ${accountAdjustmentRequests.balanceSnapshot} as "balanceSnapshot",
      ${accountAdjustmentRequests.availableBalanceSnapshot} as "availableBalanceSnapshot",
      ${accountAdjustmentRequests.reason} as "reason",
      ${accountAdjustmentRequests.supportingReference} as "supportingReference",
      ${accountAdjustmentRequests.status} as "status",
      ${accountAdjustmentRequests.requestedBy} as "requestedBy",
      ${accountAdjustmentRequests.requestedAt} as "requestedAt",
      ${accountAdjustmentRequests.reviewedBy} as "reviewedBy",
      ${accountAdjustmentRequests.reviewNote} as "reviewNote",
      ${accountAdjustmentRequests.reviewedAt} as "reviewedAt",
      ${accountAdjustmentRequests.ledgerId} as "ledgerId",
      ${accountAdjustmentRequests.lockVersion} as "lockVersion"
    from ${accountAdjustmentRequests}
    where ${accountAdjustmentRequests.id} = ${adjustmentId}
    for update
  `);
  const adjustment = rows[0];
  if (!adjustment) {
    throw new OperationsConsoleFailure(
      'ADJUSTMENT_NOT_FOUND',
      '退款或调整申请不存在',
      404,
    );
  }
  return adjustment;
}

async function lockAccount(tx: Transaction, studioId: string) {
  const rows = await tx.execute<typeof studioAccounts.$inferSelect>(sql`
    select
      ${studioAccounts.studioId} as "studioId",
      ${studioAccounts.currency} as "currency",
      ${studioAccounts.balance} as "balance",
      ${studioAccounts.activeHoldAmount} as "activeHoldAmount",
      ${studioAccounts.status} as "status",
      ${studioAccounts.lockVersion} as "lockVersion",
      ${studioAccounts.updatedAt} as "updatedAt"
    from ${studioAccounts}
    where ${studioAccounts.studioId} = ${studioId}
    for update
  `);
  const account = rows[0];
  if (!account) {
    throw new OperationsConsoleFailure(
      'ACCOUNT_NOT_FOUND',
      '影楼账户不存在',
      404,
    );
  }
  return account;
}

async function nextRequestNo(tx: Transaction, now: Date) {
  const date = shanghaiDate(now);
  const sequenceName = `account-adjustment:${date}`;
  const rows = await tx.execute<{ value: bigint | string }>(sql`
    insert into external_sequence (name, value)
    values (${sequenceName}, 1)
    on conflict (name) do update
    set value = external_sequence.value + 1
    returning value
  `);
  return `AR-${date}-${String(rows[0]!.value).padStart(5, '0')}`;
}

async function advisoryLock(tx: Transaction, key: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
  );
}

async function writeDecisionAudit(
  tx: Transaction,
  input: {
    id: string;
    requestId: string;
    actorId: string;
    action: 'ACCOUNT_ADJUSTMENT_APPROVED' | 'ACCOUNT_ADJUSTMENT_REJECTED';
    adjustment: AdjustmentRow;
    reviewNote: string;
    occurredAt: Date;
    signedAmount?: string;
    balanceBefore?: string;
    balanceAfter?: string;
    ledgerId?: string;
  },
) {
  await tx.insert(auditLogs).values({
    id: input.id,
    requestId: input.requestId,
    actorId: input.actorId,
    action: input.action,
    objectType: 'ACCOUNT_ADJUSTMENT_REQUEST',
    objectId: input.adjustment.id,
    detail: {
      requestNo: input.adjustment.requestNo,
      studioId: input.adjustment.studioId,
      kind: input.adjustment.kind,
      amount: normalizeMoney(input.adjustment.amount),
      requestedBy: input.adjustment.requestedBy,
      reviewNote: input.reviewNote,
      ...(input.signedAmount ? { signedAmount: input.signedAmount } : {}),
      ...(input.balanceBefore ? { balanceBefore: input.balanceBefore } : {}),
      ...(input.balanceAfter ? { balanceAfter: input.balanceAfter } : {}),
      ...(input.ledgerId ? { ledgerId: input.ledgerId } : {}),
    },
    occurredAt: input.occurredAt,
  });
}

function accountStatusAfter(balance: string, available: string): AccountStatus {
  if (moneyToMicros(balance) <= 0n) return 'OVERDUE';
  if (moneyToMicros(available) < moneyToMicros('500.000000')) {
    return 'LOW_BALANCE';
  }
  return 'ACTIVE';
}

function shanghaiDate(value: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)!.value;
  return `${part('year')}${part('month')}${part('day')}`;
}

function containsPattern(value: string) {
  return `%${value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
}

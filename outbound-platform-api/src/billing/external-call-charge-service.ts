import { and, desc, eq, gte, lt, or, sql } from 'drizzle-orm';
import {
  externalCallChargePageSchema,
  type ExternalCallChargePage,
} from '@outbound/contracts';
import type { Database } from '../db/client.js';
import {
  accountLedger,
  integrationClientStudios,
  platformTasks,
  studioAccounts,
  studios,
} from '../db/schema.js';
import type { ExternalPrincipal } from '../openapi/authenticator.js';
import { ExternalApiFailure } from '../openapi/errors.js';
import { normalizeMoney, subtractMoney } from './money.js';

export type ExternalCallChargeQuery = {
  companyCode: string;
  occurredFrom?: Date;
  occurredBefore?: Date;
  cursor?: string;
  limit: number;
};

type ChargeCursor = { occurredAt: Date; id: string };

type ChargeRow = {
  id: string;
  occurredAt: Date;
  amount: string;
  balanceAfter: string;
  availableBalanceAfter: string;
  callInstanceId: string | null;
  reason: string | null;
  taskNo: string | null;
};

export interface ExternalCallChargeService {
  listCallCharges(
    principal: ExternalPrincipal,
    query: ExternalCallChargeQuery,
  ): Promise<ExternalCallChargePage>;
}

export class PostgresExternalCallChargeService implements ExternalCallChargeService {
  constructor(private readonly db: Database) {}

  async listCallCharges(
    principal: ExternalPrincipal,
    query: ExternalCallChargeQuery,
  ): Promise<ExternalCallChargePage> {
    const [studio] = await this.db
      .select({ id: studios.id, mcCode: studios.mcCode })
      .from(studios)
      .where(eq(studios.mcCode, query.companyCode))
      .limit(1);
    if (!studio) {
      throw new ExternalApiFailure(
        'STUDIO_NOT_FOUND',
        'company_code 未匹配到影楼',
        404,
      );
    }

    const [authorization] = await this.db
      .select({ studioId: integrationClientStudios.studioId })
      .from(integrationClientStudios)
      .where(
        and(
          eq(
            integrationClientStudios.integrationClientId,
            principal.integrationClientId,
          ),
          eq(integrationClientStudios.studioId, studio.id),
        ),
      )
      .limit(1);
    if (!authorization) {
      throw new ExternalApiFailure(
        'AUTHENTICATION_FAILED',
        '请求 Token 无权访问该影楼',
        403,
      );
    }

    const [account] = await this.db
      .select({
        currency: studioAccounts.currency,
        balance: studioAccounts.balance,
        activeHoldAmount: studioAccounts.activeHoldAmount,
      })
      .from(studioAccounts)
      .where(eq(studioAccounts.studioId, studio.id))
      .limit(1);
    if (!account || account.currency !== 'CNY') {
      throw new ExternalApiFailure(
        'SERVICE_TEMPORARILY_UNAVAILABLE',
        '影楼账户暂不可查询，请稍后重试',
        503,
      );
    }

    const cursor = query.cursor ? decodeChargeCursor(query.cursor) : undefined;
    const where = and(
      eq(accountLedger.studioId, studio.id),
      eq(accountLedger.entryType, 'CALL_CHARGE'),
      query.occurredFrom
        ? gte(accountLedger.occurredAt, query.occurredFrom)
        : undefined,
      query.occurredBefore
        ? lt(accountLedger.occurredAt, query.occurredBefore)
        : undefined,
      cursor
        ? or(
            lt(accountLedger.occurredAt, cursor.occurredAt),
            and(
              eq(accountLedger.occurredAt, cursor.occurredAt),
              lt(accountLedger.id, cursor.id),
            ),
          )
        : undefined,
    );
    const summaryWhere = and(
      eq(accountLedger.studioId, studio.id),
      eq(accountLedger.entryType, 'CALL_CHARGE'),
      query.occurredFrom
        ? gte(accountLedger.occurredAt, query.occurredFrom)
        : undefined,
      query.occurredBefore
        ? lt(accountLedger.occurredAt, query.occurredBefore)
        : undefined,
    );

    const [summaryRows, rows] = await Promise.all([
      this.db
        .select({
          totalCount: sql<number>`count(*)::int`,
          totalCharge: sql<string>`coalesce(sum(abs(${accountLedger.amount})), 0)::text`,
        })
        .from(accountLedger)
        .where(summaryWhere)
        .limit(1),
      this.db
        .select({
          id: accountLedger.id,
          occurredAt: accountLedger.occurredAt,
          amount: accountLedger.amount,
          balanceAfter: accountLedger.balanceAfter,
          availableBalanceAfter: accountLedger.availableBalanceAfter,
          callInstanceId: accountLedger.callInstanceId,
          reason: accountLedger.reason,
          taskNo: platformTasks.taskNo,
        })
        .from(accountLedger)
        .leftJoin(platformTasks, eq(platformTasks.id, accountLedger.taskId))
        .where(where)
        .orderBy(desc(accountLedger.occurredAt), desc(accountLedger.id))
        .limit(query.limit + 1),
    ]);

    const hasNextPage = rows.length > query.limit;
    const page = (
      hasNextPage ? rows.slice(0, query.limit) : rows
    ) as ChargeRow[];
    const last = page.at(-1);
    const summary = summaryRows[0];
    return externalCallChargePageSchema.parse({
      company_code: studio.mcCode,
      currency: 'CNY',
      balance: normalizeMoney(account.balance),
      available_balance: subtractMoney(
        account.balance,
        account.activeHoldAmount,
      ),
      total_count: summary?.totalCount ?? 0,
      total_charge: normalizeMoney(summary?.totalCharge ?? '0'),
      items: page.map((row) => ({
        ledger_id: row.id,
        occurred_at: row.occurredAt.toISOString(),
        type: 'CALL_CHARGE' as const,
        amount: normalizeMoney(row.amount),
        balance_after: normalizeMoney(row.balanceAfter),
        available_balance_after: normalizeMoney(row.availableBalanceAfter),
        task_no: row.taskNo,
        platform_call_id: row.callInstanceId,
        remark: row.reason,
      })),
      next_cursor:
        hasNextPage && last
          ? encodeChargeCursor(last.occurredAt, last.id)
          : null,
    });
  }
}

export function encodeChargeCursor(occurredAt: Date, id: string): string {
  return Buffer.from(
    JSON.stringify({ occurredAt: occurredAt.toISOString(), id }),
    'utf8',
  ).toString('base64url');
}

export function decodeChargeCursor(value: string): ChargeCursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    ) as { occurredAt?: unknown; id?: unknown };
    if (
      typeof parsed.occurredAt !== 'string' ||
      typeof parsed.id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        parsed.id,
      )
    ) {
      throw new Error('cursor fields are invalid');
    }
    const occurredAt = new Date(parsed.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) {
      throw new Error('cursor date is invalid');
    }
    return { occurredAt, id: parsed.id };
  } catch {
    throw new ExternalApiFailure(
      'INVALID_REQUEST',
      '扣费明细分页 cursor 无效',
      400,
    );
  }
}

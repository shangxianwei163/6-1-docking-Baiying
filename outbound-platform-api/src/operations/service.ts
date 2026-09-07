import { randomUUID } from 'node:crypto';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import {
  accountLedgerEvidenceSchema,
  operatorLedgerPageSchema,
  operatorPricingVersionSchema,
  operatorStudioPageSchema,
  pricingOverviewSchema,
  pricingPreviewSchema,
  pricingPublishResultSchema,
  supplierPricingPreviewSchema,
  supplierPricingPublishResultSchema,
  type CreateOperatorStudioInput,
  type CreateTopUpInput,
  type LedgerEntryType,
  type OperatorAccountStatus,
  type OperatorLedgerEntry,
  type OperatorLedgerPage,
  type OperatorPricingVersion,
  type OperatorStudio,
  type OperatorStudioPage,
  type OperatorStudioStatus,
  type OperatorSupplierPricingTier,
  type PricingOverview,
  type PricingPreview,
  type PricingPublishResult,
  type PublishSupplierPricingInput,
  type PublishPricingInput,
  type SupplierPricingPreview,
  type SupplierPricingPublishResult,
  type SupplierPricingTierDraft,
  type UpdateOperatorStudioInput,
} from '@outbound/contracts';
import {
  addMoney,
  moneyToMicros,
  normalizeMoney,
  requirePositiveMoney,
  subtractMoney,
} from '../billing/money.js';
import type { Database } from '../db/client.js';
import {
  accountLedger,
  auditLogs,
  integrationEndpoints,
  platformTasks,
  studioAccounts,
  studioPricingVersions,
  studios,
  supplierPricingTiers,
} from '../db/schema.js';
import type { DataProtector } from '../security/data-protector.js';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type StudioListInput = {
  keyword?: string;
  studioStatus?: OperatorStudioStatus;
  accountStatus?: OperatorAccountStatus;
  pageNum: number;
  pageSize: number;
};
type LedgerListInput = {
  keyword?: string;
  studioId?: string;
  entryType?: LedgerEntryType;
  pageNum: number;
  pageSize: number;
};
type StudioAccountRow = typeof studioAccounts.$inferSelect;
type PricingRow = typeof studioPricingVersions.$inferSelect;
type SupplierPricingRow = typeof supplierPricingTiers.$inferSelect;
type StudioRow = typeof studios.$inferSelect;

export class OperationsConsoleFailure extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: 400 | 404 | 409 | 502 | 503,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'OperationsConsoleFailure';
  }
}

export interface OperationsConsoleService {
  listStudios(input: StudioListInput): Promise<OperatorStudioPage>;
  createStudio(
    input: CreateOperatorStudioInput,
    actorId: string,
    requestId: string,
  ): Promise<OperatorStudio>;
  updateStudio(
    studioId: string,
    input: UpdateOperatorStudioInput,
    actorId: string,
    requestId: string,
  ): Promise<OperatorStudio>;
  setStudioStatus(
    studioId: string,
    status: OperatorStudioStatus,
    reason: string,
    actorId: string,
    requestId: string,
  ): Promise<OperatorStudio>;
  listLedger(input: LedgerListInput): Promise<OperatorLedgerPage>;
  topUp(
    input: CreateTopUpInput,
    actorId: string,
    requestId: string,
  ): Promise<{ entry: OperatorLedgerEntry; studio: OperatorStudio }>;
  getPricingOverview(): Promise<PricingOverview>;
  previewPricing(input: PublishPricingInput): Promise<PricingPreview>;
  publishPricing(
    input: PublishPricingInput,
    actorId: string,
    requestId: string,
  ): Promise<PricingPublishResult>;
  previewSupplierPricing(
    input: PublishSupplierPricingInput,
  ): Promise<SupplierPricingPreview>;
  publishSupplierPricing(
    input: PublishSupplierPricingInput,
    actorId: string,
    requestId: string,
  ): Promise<SupplierPricingPublishResult>;
}

export class PostgresOperationsConsoleService implements OperationsConsoleService {
  constructor(
    private readonly db: Database,
    private readonly protector?: DataProtector,
    private readonly clock: () => Date = () => new Date(),
    private readonly createId: () => string = randomUUID,
  ) {}

  async listStudios(input: StudioListInput): Promise<OperatorStudioPage> {
    const keyword = input.keyword?.trim();
    const keywordCondition = keyword
      ? or(
          ilike(studios.businessCode, containsPattern(keyword)),
          ilike(studios.mcCode, containsPattern(keyword)),
          ilike(studios.name, containsPattern(keyword)),
          ilike(studios.contactName, containsPattern(keyword)),
        )
      : undefined;
    const filteredWhere = and(
      keywordCondition,
      input.studioStatus ? eq(studios.status, input.studioStatus) : undefined,
      input.accountStatus
        ? eq(studioAccounts.status, input.accountStatus)
        : undefined,
    );

    const [totalRow, summaryRow, pageRows] = await Promise.all([
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(studios)
        .innerJoin(studioAccounts, eq(studioAccounts.studioId, studios.id))
        .where(filteredWhere)
        .then((rows) => rows[0]),
      this.db
        .select({
          all: sql<number>`count(*)::int`,
          active: sql<number>`count(*) filter (where ${studios.status} = 'ACTIVE')::int`,
          disabled: sql<number>`count(*) filter (where ${studios.status} = 'DISABLED')::int`,
          accountActive: sql<number>`count(*) filter (where ${studioAccounts.status} = 'ACTIVE')::int`,
          lowBalance: sql<number>`count(*) filter (where ${studioAccounts.status} = 'LOW_BALANCE')::int`,
          overdue: sql<number>`count(*) filter (where ${studioAccounts.status} = 'OVERDUE')::int`,
          accountDisabled: sql<number>`count(*) filter (where ${studioAccounts.status} = 'DISABLED')::int`,
          totalBalance: sql<string>`coalesce(sum(${studioAccounts.balance}), 0)::text`,
          totalActiveHold: sql<string>`coalesce(sum(${studioAccounts.activeHoldAmount}), 0)::text`,
          totalAvailable: sql<string>`coalesce(sum(${studioAccounts.balance} - ${studioAccounts.activeHoldAmount}), 0)::text`,
        })
        .from(studios)
        .innerJoin(studioAccounts, eq(studioAccounts.studioId, studios.id))
        .where(keywordCondition)
        .then((rows) => rows[0]),
      this.db
        .select({ studio: studios, account: studioAccounts })
        .from(studios)
        .innerJoin(studioAccounts, eq(studioAccounts.studioId, studios.id))
        .where(filteredWhere)
        .orderBy(desc(studios.createdAt), desc(studios.id))
        .limit(input.pageSize)
        .offset(input.pageNum * input.pageSize),
    ]);
    const pageStudios = await this.hydrateStudios(pageRows);
    const total = totalRow?.total ?? 0;
    return operatorStudioPageSchema.parse({
      total,
      pages: Math.ceil(total / input.pageSize),
      pageNum: input.pageNum,
      pageSize: input.pageSize,
      summary: {
        all: summaryRow?.all ?? 0,
        active: summaryRow?.active ?? 0,
        disabled: summaryRow?.disabled ?? 0,
        accountActive: summaryRow?.accountActive ?? 0,
        lowBalance: summaryRow?.lowBalance ?? 0,
        overdue: summaryRow?.overdue ?? 0,
        accountDisabled: summaryRow?.accountDisabled ?? 0,
        totalBalance: normalizeMoney(summaryRow?.totalBalance ?? '0'),
        totalActiveHold: normalizeMoney(summaryRow?.totalActiveHold ?? '0'),
        totalAvailable: normalizeMoney(summaryRow?.totalAvailable ?? '0'),
      },
      studios: pageStudios,
    });
  }

  async createStudio(
    input: CreateOperatorStudioInput,
    actorId: string,
    requestId: string,
  ): Promise<OperatorStudio> {
    const now = this.clock();
    const phone = contactPhoneValues(input.contactPhone, this.protector);
    const studioId = this.createId();
    await this.db.transaction(async (tx) => {
      await advisoryLock(tx, 'operator:studio:identity');
      await assertMcCodeAvailable(tx, input.mcCode);
      const businessCode = await nextStudioBusinessCode(tx, now);
      await tx.insert(studios).values({
        id: studioId,
        businessCode,
        mcCode: input.mcCode,
        name: input.name,
        contactName: input.contactName || null,
        ...phone,
        status: 'ACTIVE',
        createdBy: actorId,
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(studioAccounts).values({
        studioId,
        balance: '0.000000',
        activeHoldAmount: '0.000000',
        status: 'OVERDUE',
        updatedAt: now,
      });
      await tx.insert(auditLogs).values({
        id: this.createId(),
        requestId,
        actorId,
        action: 'STUDIO_CREATED',
        objectType: 'STUDIO',
        objectId: studioId,
        detail: {
          businessCode,
          mcCode: input.mcCode,
          name: input.name,
          contactPhoneConfigured: Boolean(input.contactPhone),
        },
        occurredAt: now,
      });
    });
    return this.requireStudio(studioId);
  }

  async updateStudio(
    studioId: string,
    input: UpdateOperatorStudioInput,
    actorId: string,
    requestId: string,
  ): Promise<OperatorStudio> {
    const now = this.clock();
    await this.db.transaction(async (tx) => {
      await advisoryLock(tx, `operator:studio:${studioId}`);
      const existing = await requireStudioRow(tx, studioId);
      if (input.mcCode && input.mcCode !== existing.mcCode) {
        await advisoryLock(tx, 'operator:studio:identity');
        await assertMcCodeAvailable(tx, input.mcCode, studioId);
      }
      const phone =
        input.contactPhone === undefined
          ? {}
          : contactPhoneValues(input.contactPhone, this.protector);
      const changedFields = Object.keys(input);
      await tx
        .update(studios)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.mcCode !== undefined ? { mcCode: input.mcCode } : {}),
          ...(input.contactName !== undefined
            ? { contactName: input.contactName || null }
            : {}),
          ...phone,
          updatedAt: now,
        })
        .where(eq(studios.id, studioId));
      await tx.insert(auditLogs).values({
        id: this.createId(),
        requestId,
        actorId,
        action: 'STUDIO_UPDATED',
        objectType: 'STUDIO',
        objectId: studioId,
        detail: {
          changedFields,
          previousMcCode: input.mcCode ? existing.mcCode : undefined,
          nextMcCode: input.mcCode,
          contactPhoneChanged: input.contactPhone !== undefined,
        },
        occurredAt: now,
      });
    });
    return this.requireStudio(studioId);
  }

  async setStudioStatus(
    studioId: string,
    status: OperatorStudioStatus,
    reason: string,
    actorId: string,
    requestId: string,
  ): Promise<OperatorStudio> {
    const now = this.clock();
    await this.db.transaction(async (tx) => {
      await advisoryLock(tx, `operator:studio:${studioId}`);
      const studio = await requireStudioRow(tx, studioId);
      const account = await lockAccount(tx, studioId);
      const accountStatus =
        status === 'DISABLED'
          ? 'DISABLED'
          : accountStatusForBalances(
              account.balance,
              subtractMoney(account.balance, account.activeHoldAmount),
            );
      await tx
        .update(studios)
        .set({ status, updatedAt: now })
        .where(eq(studios.id, studioId));
      await tx
        .update(studioAccounts)
        .set({
          status: accountStatus,
          lockVersion: sql`${studioAccounts.lockVersion} + 1`,
          updatedAt: now,
        })
        .where(eq(studioAccounts.studioId, studioId));
      await tx.insert(auditLogs).values({
        id: this.createId(),
        requestId,
        actorId,
        action: status === 'ACTIVE' ? 'STUDIO_ENABLED' : 'STUDIO_DISABLED',
        objectType: 'STUDIO',
        objectId: studioId,
        detail: { previousStatus: studio.status, nextStatus: status, reason },
        occurredAt: now,
      });
    });
    return this.requireStudio(studioId);
  }

  async listLedger(input: LedgerListInput): Promise<OperatorLedgerPage> {
    const keyword = input.keyword?.trim();
    const keywordCondition = keyword
      ? or(
          ilike(studios.businessCode, containsPattern(keyword)),
          ilike(studios.name, containsPattern(keyword)),
          ilike(accountLedger.businessKey, containsPattern(keyword)),
          ilike(accountLedger.operatorId, containsPattern(keyword)),
          ilike(accountLedger.reason, containsPattern(keyword)),
          ilike(platformTasks.taskNo, containsPattern(keyword)),
        )
      : undefined;
    const baseWhere = and(
      keywordCondition,
      input.studioId ? eq(accountLedger.studioId, input.studioId) : undefined,
    );
    const filteredWhere = and(
      baseWhere,
      input.entryType
        ? eq(accountLedger.entryType, input.entryType)
        : undefined,
    );
    const [totalRow, summaryRow, rows] = await Promise.all([
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(accountLedger)
        .innerJoin(studios, eq(studios.id, accountLedger.studioId))
        .leftJoin(platformTasks, eq(platformTasks.id, accountLedger.taskId))
        .where(filteredWhere)
        .then((result) => result[0]),
      this.db
        .select({
          totalTopUp: sql<string>`coalesce(sum(case when ${accountLedger.entryType} = 'TOP_UP' then abs(${accountLedger.amount}) else 0 end), 0)::text`,
          totalCharge: sql<string>`coalesce(sum(case when ${accountLedger.entryType} in ('CALL_CHARGE', 'OVERAGE_DEBIT') then abs(${accountLedger.amount}) else 0 end), 0)::text`,
        })
        .from(accountLedger)
        .innerJoin(studios, eq(studios.id, accountLedger.studioId))
        .leftJoin(platformTasks, eq(platformTasks.id, accountLedger.taskId))
        .where(baseWhere)
        .then((result) => result[0]),
      this.db
        .select({
          ledger: accountLedger,
          studioBusinessCode: studios.businessCode,
          studioName: studios.name,
          taskNo: platformTasks.taskNo,
        })
        .from(accountLedger)
        .innerJoin(studios, eq(studios.id, accountLedger.studioId))
        .leftJoin(platformTasks, eq(platformTasks.id, accountLedger.taskId))
        .where(filteredWhere)
        .orderBy(desc(accountLedger.occurredAt), desc(accountLedger.id))
        .limit(input.pageSize)
        .offset(input.pageNum * input.pageSize),
    ]);
    const auditByLedger = await this.loadLedgerEvidence(
      rows.map((row) => row.ledger.id),
    );
    const total = totalRow?.total ?? 0;
    return operatorLedgerPageSchema.parse({
      total,
      pages: Math.ceil(total / input.pageSize),
      pageNum: input.pageNum,
      pageSize: input.pageSize,
      totalTopUp: normalizeMoney(summaryRow?.totalTopUp ?? '0'),
      totalCharge: normalizeMoney(summaryRow?.totalCharge ?? '0'),
      items: rows.map((row) =>
        toOperatorLedger(row, auditByLedger.get(row.ledger.id) ?? null),
      ),
    });
  }

  async topUp(
    input: CreateTopUpInput,
    actorId: string,
    requestId: string,
  ): Promise<{ entry: OperatorLedgerEntry; studio: OperatorStudio }> {
    const amount = requirePositiveMoney(input.amount);
    const businessKey = `ADMIN_TOP_UP:${input.idempotencyKey}`;
    const now = this.clock();
    const ledgerId = await this.db.transaction(async (tx) => {
      await advisoryLock(tx, `ledger:${businessKey}`);
      const [existing] = await tx
        .select()
        .from(accountLedger)
        .where(eq(accountLedger.businessKey, businessKey))
        .limit(1);
      if (existing) {
        const [audit] = await tx
          .select({ actorId: auditLogs.actorId, detail: auditLogs.detail })
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.objectType, 'ACCOUNT_LEDGER'),
              eq(auditLogs.objectId, existing.id),
              eq(auditLogs.action, 'ACCOUNT_TOP_UP_POSTED'),
            ),
          )
          .limit(1);
        const evidence = audit ? evidenceFrom(audit.detail) : null;
        if (
          existing.studioId !== input.studioId ||
          existing.entryType !== 'TOP_UP' ||
          normalizeMoney(existing.amount) !== amount ||
          existing.operatorId !== actorId ||
          existing.reason !== input.reason ||
          evidence?.channel !== input.channel ||
          evidence?.receiptReference !== input.receiptReference ||
          evidence?.receiptFileName !== (input.receiptFileName ?? null) ||
          audit?.actorId !== actorId
        ) {
          throw new OperationsConsoleFailure(
            'IDEMPOTENCY_CONFLICT',
            '同一幂等键已用于不同的充值请求',
            409,
          );
        }
        return existing.id;
      }
      const studio = await requireStudioRow(tx, input.studioId);
      const account = await lockAccount(tx, input.studioId);
      const balanceAfter = addMoney(account.balance, amount);
      const availableBalanceAfter = subtractMoney(
        balanceAfter,
        account.activeHoldAmount,
      );
      const accountStatus =
        studio.status === 'DISABLED'
          ? 'DISABLED'
          : accountStatusForBalances(balanceAfter, availableBalanceAfter);
      await tx
        .update(studioAccounts)
        .set({
          balance: balanceAfter,
          status: accountStatus,
          lockVersion: sql`${studioAccounts.lockVersion} + 1`,
          updatedAt: now,
        })
        .where(eq(studioAccounts.studioId, input.studioId));
      const [ledger] = await tx
        .insert(accountLedger)
        .values({
          id: this.createId(),
          studioId: input.studioId,
          entryType: 'TOP_UP',
          amount,
          balanceAfter,
          availableBalanceAfter,
          businessKey,
          operatorId: actorId,
          reason: input.reason,
          occurredAt: now,
        })
        .returning();
      await tx.insert(auditLogs).values({
        id: this.createId(),
        requestId,
        actorId,
        action: 'ACCOUNT_TOP_UP_POSTED',
        objectType: 'ACCOUNT_LEDGER',
        objectId: ledger.id,
        detail: {
          studioId: input.studioId,
          amount,
          businessKey,
          channel: input.channel,
          receiptReference: input.receiptReference,
          receiptFileName: input.receiptFileName ?? null,
        },
        occurredAt: now,
      });
      return ledger.id;
    });
    const entry = await this.requireLedgerEntry(ledgerId);
    return { entry, studio: await this.requireStudio(input.studioId) };
  }

  async getPricingOverview(): Promise<PricingOverview> {
    const [studioRows, pricingRows, tierRows] = await Promise.all([
      this.db.select().from(studios).orderBy(asc(studios.businessCode)),
      this.db
        .select()
        .from(studioPricingVersions)
        .orderBy(
          studioPricingVersions.studioId,
          desc(studioPricingVersions.version),
        ),
      this.db
        .select()
        .from(supplierPricingTiers)
        .orderBy(
          desc(supplierPricingTiers.effectiveFrom),
          asc(supplierPricingTiers.minMonthlyMinutes),
        ),
    ]);
    const now = this.clock();
    const versionsByStudio = groupBy(
      pricingRows.map(toOperatorPricing),
      (item) => item.studioId,
    );
    const currentSupplierTiers = tierRows.filter(
      (tier) =>
        tier.effectiveFrom <= now &&
        (!tier.effectiveTo || tier.effectiveTo > now),
    );
    const scheduledSupplierTiers = tierRows.filter(
      (tier) => tier.effectiveFrom > now,
    );
    return pricingOverviewSchema.parse({
      studios: studioRows.map((studio) => {
        const versions = versionsByStudio.get(studio.id) ?? [];
        return {
          studioId: studio.id,
          businessCode: studio.businessCode,
          name: studio.name,
          studioStatus: studio.status,
          currentPricing: currentPricing(versions, now),
          scheduledPricing: scheduledPricing(versions, now),
          versions,
        };
      }),
      supplierTiers: currentSupplierTiers.map(toOperatorSupplierPricing),
      scheduledSupplierTiers: scheduledSupplierTiers.map(
        toOperatorSupplierPricing,
      ),
      supplierTierVersionCount: new Set(
        tierRows.map((tier) => tier.effectiveFrom.toISOString()),
      ).size,
    });
  }

  async previewSupplierPricing(
    input: PublishSupplierPricingInput,
  ): Promise<SupplierPricingPreview> {
    const now = this.clock();
    const effectiveFrom = validateSupplierPricingEffectiveFrom(
      input.effectiveFrom,
      now,
    );
    const tiers = normalizeSupplierPricingTiers(input.tiers);
    const rows = await this.db
      .select()
      .from(supplierPricingTiers)
      .orderBy(asc(supplierPricingTiers.effectiveFrom));
    const current = rows.find(
      (tier) =>
        tier.effectiveFrom <= now &&
        (!tier.effectiveTo || tier.effectiveTo > now),
    );
    const scheduled = rows.find((tier) => tier.effectiveFrom > now);
    const activeRows = rows.filter(
      (tier) =>
        tier.effectiveFrom <= now &&
        (!tier.effectiveTo || tier.effectiveTo > now),
    );
    const delta = supplierPricingDelta(tiers, activeRows);
    if (
      !scheduled &&
      delta.changed.length === 0 &&
      delta.removed.length === 0
    ) {
      throw new OperationsConsoleFailure(
        'SUPPLIER_PRICING_UNCHANGED',
        '供应价格没有发生变化，无需发布新版本',
        409,
      );
    }
    return supplierPricingPreviewSchema.parse({
      effectiveFrom: effectiveFrom.toISOString(),
      tierCount: tiers.length,
      currentEffectiveFrom: current?.effectiveFrom.toISOString() ?? null,
      replacesScheduledEffectiveFrom:
        scheduled?.effectiveFrom.toISOString() ?? null,
      tiers,
    });
  }

  async publishSupplierPricing(
    input: PublishSupplierPricingInput,
    actorId: string,
    requestId: string,
  ): Promise<SupplierPricingPublishResult> {
    const now = this.clock();
    const effectiveFrom = validateSupplierPricingEffectiveFrom(
      input.effectiveFrom,
      now,
    );
    const tiers = normalizeSupplierPricingTiers(input.tiers);
    const result = await this.db.transaction(async (tx) => {
      await advisoryLock(tx, 'operator:supplier-pricing:publish');
      const scheduledRows = await tx
        .select()
        .from(supplierPricingTiers)
        .where(gt(supplierPricingTiers.effectiveFrom, now));
      const activeRows = await tx
        .select()
        .from(supplierPricingTiers)
        .where(
          and(
            lte(supplierPricingTiers.effectiveFrom, now),
            or(
              sql`${supplierPricingTiers.effectiveTo} IS NULL`,
              gt(supplierPricingTiers.effectiveTo, now),
            ),
          ),
        );

      const delta = supplierPricingDelta(tiers, activeRows);
      if (
        !scheduledRows.length &&
        delta.changed.length === 0 &&
        delta.removed.length === 0
      ) {
        throw new OperationsConsoleFailure(
          'SUPPLIER_PRICING_UNCHANGED',
          '供应价格没有发生变化，无需发布新版本',
          409,
        );
      }

      if (scheduledRows.length) {
        await tx.delete(supplierPricingTiers).where(
          inArray(
            supplierPricingTiers.id,
            scheduledRows.map((tier) => tier.id),
          ),
        );
      }
      if (activeRows.length) {
        await tx
          .update(supplierPricingTiers)
          .set({ effectiveTo: null })
          .where(
            inArray(
              supplierPricingTiers.id,
              activeRows.map((tier) => tier.id),
            ),
          );
      }

      const rowsToClose = activeRows.filter(
        (row) =>
          delta.removed.includes(row.tierCode) ||
          delta.changed.some((tier) => tier.tierCode === row.tierCode),
      );
      if (rowsToClose.length) {
        await tx
          .update(supplierPricingTiers)
          .set({ effectiveTo: effectiveFrom })
          .where(
            inArray(
              supplierPricingTiers.id,
              rowsToClose.map((tier) => tier.id),
            ),
          );
      }

      const published = delta.changed.length
        ? await tx
            .insert(supplierPricingTiers)
            .values(
              delta.changed.map((tier) => ({
                id: this.createId(),
                tierCode: tier.tierCode,
                name: tier.name,
                minMonthlyMinutes: BigInt(tier.minMonthlyMinutes),
                maxMonthlyMinutes:
                  tier.maxMonthlyMinutes === null
                    ? null
                    : BigInt(tier.maxMonthlyMinutes),
                voiceRate: tier.voiceRate,
                smsRate: tier.smsRate,
                effectiveFrom,
                effectiveTo: null,
                publishedBy: actorId,
                publishedAt: now,
              })),
            )
            .returning()
        : [];
      await tx.insert(auditLogs).values({
        id: this.createId(),
        requestId,
        actorId,
        action: 'SUPPLIER_PRICING_PUBLISHED',
        objectType: 'SUPPLIER_PRICING_SET',
        objectId: effectiveFrom.toISOString(),
        detail: {
          effectiveFrom: effectiveFrom.toISOString(),
          tierCount: tiers.length,
          changedTierCount: published.length,
          unchangedTierCount: tiers.length - published.length,
          removedTierCodes: delta.removed,
          replacedScheduledCount: scheduledRows.length,
          reason: input.reason,
          tiers: tiers.map((tier) => ({
            tierCode: tier.tierCode,
            name: tier.name,
            minMonthlyMinutes: tier.minMonthlyMinutes,
            maxMonthlyMinutes: tier.maxMonthlyMinutes,
            voiceRate: tier.voiceRate,
            smsRate: tier.smsRate,
          })),
        },
        occurredAt: now,
      });
      return { published, replacedScheduledCount: scheduledRows.length };
    });
    return supplierPricingPublishResultSchema.parse({
      effectiveFrom: effectiveFrom.toISOString(),
      replacedScheduledCount: result.replacedScheduledCount,
      published: result.published.map(toOperatorSupplierPricing),
    });
  }

  async previewPricing(input: PublishPricingInput): Promise<PricingPreview> {
    const effectiveFrom = validatePricingEffectiveFrom(
      input.effectiveFrom,
      this.clock(),
    );
    const targets = await resolvePricingTargets(this.db, input);
    const currentRows = await this.db
      .select()
      .from(studioPricingVersions)
      .where(
        inArray(
          studioPricingVersions.studioId,
          targets.map((target) => target.studio.id),
        ),
      );
    const now = this.clock();
    const versionsByStudio = groupBy(
      currentRows.map(toOperatorPricing),
      (item) => item.studioId,
    );
    return pricingPreviewSchema.parse({
      mode: input.mode,
      effectiveFrom: effectiveFrom.toISOString(),
      affectedStudioCount: targets.length,
      items: targets.map((target) => ({
        studioId: target.studio.id,
        businessCode: target.studio.businessCode,
        studioName: target.studio.name,
        currentVoiceRate:
          currentPricing(versionsByStudio.get(target.studio.id) ?? [], now)
            ?.voiceRate ?? null,
        nextVoiceRate: normalizeMoney(target.rate.voiceRate),
        nextSmsRate: normalizeMoney(target.rate.smsRate),
        nextFrozenMinutes: target.rate.frozenMinutes,
      })),
    });
  }

  async publishPricing(
    input: PublishPricingInput,
    actorId: string,
    requestId: string,
  ): Promise<PricingPublishResult> {
    const now = this.clock();
    const effectiveFrom = validatePricingEffectiveFrom(
      input.effectiveFrom,
      now,
    );
    const publishedRows = await this.db.transaction(async (tx) => {
      await advisoryLock(tx, 'operator:pricing:publish');
      const targets = await resolvePricingTargets(tx, input);
      const published: PricingRow[] = [];
      for (const target of targets) {
        const versions = await tx
          .select()
          .from(studioPricingVersions)
          .where(eq(studioPricingVersions.studioId, target.studio.id))
          .orderBy(desc(studioPricingVersions.version));
        const liveVersions = versions
          .filter((version) => version.status !== 'RETIRED')
          .map(toOperatorPricing);
        const activeNow = currentPricing(liveVersions, now);
        if (activeNow && effectiveFrom <= new Date(activeNow.effectiveFrom)) {
          throw new OperationsConsoleFailure(
            'PRICING_EFFECTIVE_TIME_CONFLICT',
            `${target.studio.name} 的新价格生效时间必须晚于当前版本`,
            409,
          );
        }

        const dueScheduled = versions
          .filter(
            (version) =>
              version.status === 'SCHEDULED' && version.effectiveFrom <= now,
          )
          .sort(
            (left, right) =>
              right.effectiveFrom.getTime() - left.effectiveFrom.getTime(),
          )[0];
        if (dueScheduled) {
          await tx
            .update(studioPricingVersions)
            .set({ status: 'RETIRED' })
            .where(
              and(
                eq(studioPricingVersions.studioId, target.studio.id),
                eq(studioPricingVersions.status, 'ACTIVE'),
              ),
            );
          await tx
            .update(studioPricingVersions)
            .set({ status: 'ACTIVE' })
            .where(eq(studioPricingVersions.id, dueScheduled.id));
        }
        await tx
          .update(studioPricingVersions)
          .set({ status: 'RETIRED' })
          .where(
            and(
              eq(studioPricingVersions.studioId, target.studio.id),
              eq(studioPricingVersions.status, 'SCHEDULED'),
            ),
          );

        const isImmediate = effectiveFrom <= now;
        const [activeRow] = await tx
          .select()
          .from(studioPricingVersions)
          .where(
            and(
              eq(studioPricingVersions.studioId, target.studio.id),
              eq(studioPricingVersions.status, 'ACTIVE'),
            ),
          )
          .limit(1);
        if (activeRow) {
          await tx
            .update(studioPricingVersions)
            .set({
              ...(isImmediate ? { status: 'RETIRED' as const } : {}),
              effectiveTo: effectiveFrom,
            })
            .where(eq(studioPricingVersions.id, activeRow.id));
        }
        const [inserted] = await tx
          .insert(studioPricingVersions)
          .values({
            id: this.createId(),
            studioId: target.studio.id,
            version: (versions[0]?.version ?? 0) + 1,
            voiceRate: normalizeMoney(target.rate.voiceRate),
            smsRate: normalizeMoney(target.rate.smsRate),
            frozenMinutes: target.rate.frozenMinutes,
            sourceMode: input.mode,
            status: isImmediate ? 'ACTIVE' : 'SCHEDULED',
            effectiveFrom,
            publishedBy: actorId,
            publishedAt: now,
          })
          .returning();
        await tx.insert(auditLogs).values({
          id: this.createId(),
          requestId,
          actorId,
          action: 'STUDIO_PRICING_PUBLISHED',
          objectType: 'STUDIO_PRICING_VERSION',
          objectId: inserted.id,
          detail: {
            studioId: target.studio.id,
            studioBusinessCode: target.studio.businessCode,
            version: inserted.version,
            mode: input.mode,
            voiceRate: normalizeMoney(target.rate.voiceRate),
            smsRate: normalizeMoney(target.rate.smsRate),
            frozenMinutes: target.rate.frozenMinutes,
            effectiveFrom: effectiveFrom.toISOString(),
            reason: input.reason,
          },
          occurredAt: now,
        });
        published.push(inserted);
      }
      return published;
    });
    return pricingPublishResultSchema.parse({
      mode: input.mode,
      effectiveFrom: effectiveFrom.toISOString(),
      published: publishedRows.map(toOperatorPricing),
    });
  }

  private async hydrateStudios(
    rows: Array<{ studio: StudioRow; account: StudioAccountRow }>,
  ): Promise<OperatorStudio[]> {
    if (!rows.length) return [];
    const studioIds = rows.map((row) => row.studio.id);
    const [endpointRows, pricingRows, taskRows] = await Promise.all([
      this.db
        .select()
        .from(integrationEndpoints)
        .where(inArray(integrationEndpoints.studioId, studioIds))
        .orderBy(
          integrationEndpoints.studioId,
          desc(integrationEndpoints.version),
        ),
      this.db
        .select()
        .from(studioPricingVersions)
        .where(inArray(studioPricingVersions.studioId, studioIds))
        .orderBy(
          studioPricingVersions.studioId,
          desc(studioPricingVersions.version),
        ),
      this.db
        .select({
          studioId: platformTasks.studioId,
          taskCount: sql<number>`count(*)::int`,
          billedMinutes: sql<number>`coalesce(sum(${platformTasks.billingMinutes}), 0)::int`,
        })
        .from(platformTasks)
        .where(inArray(platformTasks.studioId, studioIds))
        .groupBy(platformTasks.studioId),
    ]);
    const endpointsByStudio = groupBy(endpointRows, (row) => row.studioId);
    const pricingByStudio = groupBy(
      pricingRows.map(toOperatorPricing),
      (row) => row.studioId,
    );
    const taskByStudio = new Map(taskRows.map((row) => [row.studioId, row]));
    const now = this.clock();
    return rows.map(({ studio, account }) => {
      const versions = pricingByStudio.get(studio.id) ?? [];
      const task = taskByStudio.get(studio.id);
      return {
        id: studio.id,
        businessCode: studio.businessCode,
        mcCode: studio.mcCode,
        name: studio.name,
        contactName: studio.contactName,
        contactPhoneMasked: studio.contactPhoneMasked,
        status: studio.status,
        account: toOperatorAccount(account),
        taskCount: task?.taskCount ?? 0,
        billedMinutes: task?.billedMinutes ?? 0,
        currentPricing: currentPricing(versions, now),
        scheduledPricing: scheduledPricing(versions, now),
        pricingVersionCount: versions.length,
        endpoints: (endpointsByStudio.get(studio.id) ?? []).map((endpoint) => ({
          id: endpoint.id,
          sourceSystem: endpoint.sourceSystem as 'ERP' | 'CRM',
          version: endpoint.version,
          resultUrl: endpoint.resultUrl,
          recordingUrl: endpoint.recordingUrl,
          secretConfigured: Boolean(endpoint.signingSecretRef),
          status: endpoint.status,
          effectiveAt: endpoint.effectiveAt?.toISOString() ?? null,
          createdAt: endpoint.createdAt.toISOString(),
        })),
        createdBy: studio.createdBy,
        createdAt: studio.createdAt.toISOString(),
        updatedAt: studio.updatedAt.toISOString(),
      };
    });
  }

  private async requireStudio(studioId: string): Promise<OperatorStudio> {
    const rows = await this.db
      .select({ studio: studios, account: studioAccounts })
      .from(studios)
      .innerJoin(studioAccounts, eq(studioAccounts.studioId, studios.id))
      .where(eq(studios.id, studioId))
      .limit(1);
    const [studio] = await this.hydrateStudios(rows);
    if (!studio) {
      throw new OperationsConsoleFailure('STUDIO_NOT_FOUND', '影楼不存在', 404);
    }
    return studio;
  }

  private async loadLedgerEvidence(ids: string[]) {
    if (!ids.length) return new Map<string, ReturnType<typeof evidenceFrom>>();
    const rows = await this.db
      .select({ objectId: auditLogs.objectId, detail: auditLogs.detail })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.objectType, 'ACCOUNT_LEDGER'),
          eq(auditLogs.action, 'ACCOUNT_TOP_UP_POSTED'),
          inArray(auditLogs.objectId, ids),
        ),
      );
    return new Map(rows.map((row) => [row.objectId, evidenceFrom(row.detail)]));
  }

  private async requireLedgerEntry(id: string): Promise<OperatorLedgerEntry> {
    const [row] = await this.db
      .select({
        ledger: accountLedger,
        studioBusinessCode: studios.businessCode,
        studioName: studios.name,
        taskNo: platformTasks.taskNo,
      })
      .from(accountLedger)
      .innerJoin(studios, eq(studios.id, accountLedger.studioId))
      .leftJoin(platformTasks, eq(platformTasks.id, accountLedger.taskId))
      .where(eq(accountLedger.id, id))
      .limit(1);
    if (!row) {
      throw new OperationsConsoleFailure(
        'LEDGER_NOT_FOUND',
        '账本流水不存在',
        404,
      );
    }
    const evidence = await this.loadLedgerEvidence([id]);
    return toOperatorLedger(row, evidence.get(id) ?? null);
  }
}

function toOperatorAccount(row: StudioAccountRow) {
  const balance = normalizeMoney(row.balance);
  const activeHoldAmount = normalizeMoney(row.activeHoldAmount);
  return {
    currency: 'CNY' as const,
    balance,
    activeHoldAmount,
    availableBalance: subtractMoney(balance, activeHoldAmount),
    status: row.status,
    lockVersion: row.lockVersion,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toOperatorPricing(row: PricingRow): OperatorPricingVersion {
  return operatorPricingVersionSchema.parse({
    id: row.id,
    studioId: row.studioId,
    version: row.version,
    voiceRate: normalizeMoney(row.voiceRate),
    smsRate: normalizeMoney(row.smsRate),
    frozenMinutes: row.frozenMinutes,
    sourceMode: row.sourceMode,
    status: row.status,
    effectiveFrom: row.effectiveFrom.toISOString(),
    effectiveTo: row.effectiveTo?.toISOString() ?? null,
    publishedBy: row.publishedBy,
    publishedAt: row.publishedAt.toISOString(),
  });
}

function toOperatorSupplierPricing(
  row: SupplierPricingRow,
): OperatorSupplierPricingTier {
  return {
    id: row.id,
    tierCode: row.tierCode,
    name: row.name,
    minMonthlyMinutes: row.minMonthlyMinutes.toString(),
    maxMonthlyMinutes: row.maxMonthlyMinutes?.toString() ?? null,
    voiceRate: normalizeMoney(row.voiceRate),
    smsRate: normalizeMoney(row.smsRate),
    effectiveFrom: row.effectiveFrom.toISOString(),
    effectiveTo: row.effectiveTo?.toISOString() ?? null,
    publishedBy: row.publishedBy,
    publishedAt: row.publishedAt.toISOString(),
  };
}

function currentPricing(
  versions: OperatorPricingVersion[],
  now: Date,
): OperatorPricingVersion | null {
  return (
    versions
      .filter(
        (version) =>
          version.status !== 'RETIRED' &&
          new Date(version.effectiveFrom) <= now &&
          (!version.effectiveTo || new Date(version.effectiveTo) > now),
      )
      .sort(
        (left, right) =>
          new Date(right.effectiveFrom).getTime() -
          new Date(left.effectiveFrom).getTime(),
      )[0] ?? null
  );
}

function scheduledPricing(
  versions: OperatorPricingVersion[],
  now: Date,
): OperatorPricingVersion | null {
  return (
    versions
      .filter(
        (version) =>
          version.status === 'SCHEDULED' &&
          new Date(version.effectiveFrom) > now,
      )
      .sort(
        (left, right) =>
          new Date(left.effectiveFrom).getTime() -
          new Date(right.effectiveFrom).getTime(),
      )[0] ?? null
  );
}

function toOperatorLedger(
  row: {
    ledger: typeof accountLedger.$inferSelect;
    studioBusinessCode: string;
    studioName: string;
    taskNo: string | null;
  },
  evidence: ReturnType<typeof evidenceFrom>,
): OperatorLedgerEntry {
  return {
    ledgerId: row.ledger.id,
    studioId: row.ledger.studioId,
    studioBusinessCode: row.studioBusinessCode,
    studioName: row.studioName,
    taskNo: row.taskNo,
    type: row.ledger.entryType,
    amount: normalizeMoney(row.ledger.amount),
    balanceAfter: normalizeMoney(row.ledger.balanceAfter),
    availableBalanceAfter: normalizeMoney(row.ledger.availableBalanceAfter),
    businessKey: row.ledger.businessKey,
    operatorId: row.ledger.operatorId,
    reason: row.ledger.reason,
    evidence,
    occurredAt: row.ledger.occurredAt.toISOString(),
  };
}

function evidenceFrom(detail: Record<string, unknown>) {
  const parsed = accountLedgerEvidenceSchema.safeParse({
    channel: detail.channel,
    receiptReference: detail.receiptReference,
    receiptFileName: detail.receiptFileName ?? null,
  });
  return parsed.success ? parsed.data : null;
}

function normalizeSupplierPricingTiers(
  tiers: SupplierPricingTierDraft[],
): SupplierPricingTierDraft[] {
  return [...tiers]
    .sort((left, right) => {
      const leftMin = BigInt(left.minMonthlyMinutes);
      const rightMin = BigInt(right.minMonthlyMinutes);
      return leftMin === rightMin ? 0 : leftMin < rightMin ? -1 : 1;
    })
    .map((tier) => ({
      ...tier,
      name: tier.name.trim(),
      tierCode: tier.tierCode.trim(),
      minMonthlyMinutes: BigInt(tier.minMonthlyMinutes).toString(),
      maxMonthlyMinutes:
        tier.maxMonthlyMinutes === null
          ? null
          : BigInt(tier.maxMonthlyMinutes).toString(),
      voiceRate: normalizeMoney(tier.voiceRate),
      smsRate: normalizeMoney(tier.smsRate),
    }));
}

function supplierPricingDelta(
  tiers: SupplierPricingTierDraft[],
  activeRows: SupplierPricingRow[],
) {
  const activeByCode = new Map(
    activeRows.map((row) => [row.tierCode, row] as const),
  );
  const nextCodes = new Set(tiers.map((tier) => tier.tierCode));
  return {
    changed: tiers.filter((tier) => {
      const active = activeByCode.get(tier.tierCode);
      return !active || !sameSupplierPricingTier(active, tier);
    }),
    removed: activeRows
      .filter((row) => !nextCodes.has(row.tierCode))
      .map((row) => row.tierCode),
  };
}

function sameSupplierPricingTier(
  row: SupplierPricingRow,
  tier: SupplierPricingTierDraft,
) {
  return (
    row.name === tier.name &&
    row.minMonthlyMinutes.toString() === tier.minMonthlyMinutes &&
    (row.maxMonthlyMinutes?.toString() ?? null) === tier.maxMonthlyMinutes &&
    normalizeMoney(row.voiceRate) === tier.voiceRate &&
    normalizeMoney(row.smsRate) === tier.smsRate
  );
}

function validateSupplierPricingEffectiveFrom(value: string, now: Date): Date {
  const effectiveFrom = new Date(value);
  const shanghaiTime = new Date(effectiveFrom.getTime() + 8 * 60 * 60 * 1_000);
  const isShanghaiMonthStart =
    shanghaiTime.getUTCDate() === 1 &&
    shanghaiTime.getUTCHours() === 0 &&
    shanghaiTime.getUTCMinutes() === 0 &&
    shanghaiTime.getUTCSeconds() === 0 &&
    shanghaiTime.getUTCMilliseconds() === 0;
  if (!isShanghaiMonthStart) {
    throw new OperationsConsoleFailure(
      'SUPPLIER_PRICING_EFFECTIVE_TIME_INVALID',
      '供应成本只能从上海时区自然月第一天 00:00 开始生效',
      400,
    );
  }
  if (effectiveFrom <= now) {
    throw new OperationsConsoleFailure(
      'SUPPLIER_PRICING_EFFECTIVE_TIME_CONFLICT',
      '供应成本生效月份必须晚于当前时间',
      409,
    );
  }
  return effectiveFrom;
}

async function resolvePricingTargets(
  db: Database | Transaction,
  input: PublishPricingInput,
) {
  const studioRows = await db
    .select()
    .from(studios)
    .where(
      input.mode === 'PER_STUDIO'
        ? inArray(
            studios.id,
            input.entries.map((entry) => entry.studioId),
          )
        : undefined,
    )
    .orderBy(asc(studios.businessCode));
  if (!studioRows.length) {
    throw new OperationsConsoleFailure(
      'PRICING_TARGET_NOT_FOUND',
      '没有可发布价格的影楼',
      404,
    );
  }
  if (
    input.mode === 'PER_STUDIO' &&
    studioRows.length !== input.entries.length
  ) {
    throw new OperationsConsoleFailure(
      'STUDIO_NOT_FOUND',
      '部分价格目标影楼不存在',
      404,
    );
  }
  const rateByStudio =
    input.mode === 'PER_STUDIO'
      ? new Map(input.entries.map((entry) => [entry.studioId, entry.rate]))
      : null;
  return studioRows.map((studio) => ({
    studio,
    rate: input.mode === 'UNIFORM' ? input.rate : rateByStudio!.get(studio.id)!,
  }));
}

function validatePricingEffectiveFrom(value: string, now: Date) {
  const effectiveFrom = new Date(value);
  if (effectiveFrom.getTime() < now.getTime() - 5 * 60_000) {
    throw new OperationsConsoleFailure(
      'INVALID_REQUEST',
      '价格生效时间不能早于当前时间 5 分钟以上',
      400,
    );
  }
  if (effectiveFrom.getTime() > now.getTime() + 366 * 24 * 60 * 60_000) {
    throw new OperationsConsoleFailure(
      'INVALID_REQUEST',
      '价格生效时间不能晚于一年后',
      400,
    );
  }
  return effectiveFrom;
}

async function requireStudioRow(db: Database | Transaction, studioId: string) {
  const [studio] = await db
    .select()
    .from(studios)
    .where(eq(studios.id, studioId))
    .limit(1);
  if (!studio) {
    throw new OperationsConsoleFailure('STUDIO_NOT_FOUND', '影楼不存在', 404);
  }
  return studio;
}

async function assertMcCodeAvailable(
  db: Database | Transaction,
  mcCode: string,
  ignoredStudioId?: string,
) {
  const [existing] = await db
    .select({ id: studios.id })
    .from(studios)
    .where(eq(studios.mcCode, mcCode))
    .limit(1);
  if (existing && existing.id !== ignoredStudioId) {
    throw new OperationsConsoleFailure(
      'MC_CODE_CONFLICT',
      'MC code 已被其他影楼使用',
      409,
    );
  }
}

function contactPhoneValues(
  value: string | null | undefined,
  protector?: DataProtector,
) {
  if (!value) {
    return { contactPhoneCiphertext: null, contactPhoneMasked: null };
  }
  if (!protector) {
    throw new OperationsConsoleFailure(
      'DATA_PROTECTOR_NOT_CONFIGURED',
      '联系人手机号加密服务尚未配置',
      503,
    );
  }
  const normalized = value.startsWith('+86') ? value.slice(3) : value;
  return {
    contactPhoneCiphertext: protector.encryptUtf8(normalized),
    contactPhoneMasked: `${normalized.slice(0, 3)}****${normalized.slice(-4)}`,
  };
}

async function nextStudioBusinessCode(tx: Transaction, now: Date) {
  const month = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    month.find((item) => item.type === type)!.value;
  const prefix = `YL-${part('year')}${part('month')}-`;
  const rows = await tx.execute<{ next: number }>(sql`
    select (coalesce(max(substring(${studios.businessCode} from '([0-9]+)$')::int), 0) + 1)::int as "next"
    from ${studios}
    where ${studios.businessCode} like ${`${prefix}%`}
  `);
  return `${prefix}${String(rows[0]?.next ?? 1).padStart(4, '0')}`;
}

async function lockAccount(tx: Transaction, studioId: string) {
  const rows = await tx.execute<StudioAccountRow>(sql`
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

function accountStatusForBalances(
  balance: string,
  availableBalance: string,
): OperatorAccountStatus {
  if (moneyToMicros(balance) <= 0n) return 'OVERDUE';
  if (moneyToMicros(availableBalance) < moneyToMicros('500.000000')) {
    return 'LOW_BALANCE';
  }
  return 'ACTIVE';
}

async function advisoryLock(tx: Transaction, key: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
  );
}

function containsPattern(value: string) {
  return `%${value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
}

function groupBy<T>(items: T[], key: (item: T) => string) {
  const result = new Map<string, T[]>();
  for (const item of items) {
    const groupKey = key(item);
    result.set(groupKey, [...(result.get(groupKey) ?? []), item]);
  }
  return result;
}

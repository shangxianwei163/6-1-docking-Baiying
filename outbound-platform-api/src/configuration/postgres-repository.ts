import { and, asc, desc, eq, gt, inArray, isNull, lte, or } from 'drizzle-orm';
import type { SourceSystem } from '@outbound/contracts';
import type { Database } from '../db/client.js';
import {
  integrationEndpoints,
  scriptBindings,
  scriptCategoryBindings,
  studioAccounts,
  studioPricingVersions,
  studios,
  supplierPricingTiers,
} from '../db/schema.js';
import { normalizeMoney, subtractMoney } from '../billing/money.js';
import type {
  ConfigurationRepository,
  IntegrationEndpointVersion,
  NormalizedScriptBinding,
  StudioConfiguration,
  StudioPricingVersion,
  SupplierPricingTier,
} from './repository.js';

export class PostgresConfigurationRepository implements ConfigurationRepository {
  constructor(private readonly db: Database) {}

  async listStudioConfigurations(): Promise<StudioConfiguration[]> {
    const studioRows = await this.db
      .select()
      .from(studios)
      .orderBy(studios.businessCode);
    if (!studioRows.length) return [];
    const studioIds = studioRows.map((studio) => studio.id);
    const [accountRows, endpointRows, pricingRows] = await Promise.all([
      this.db
        .select()
        .from(studioAccounts)
        .where(inArray(studioAccounts.studioId, studioIds)),
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
    ]);

    const accountByStudio = new Map(
      accountRows.map((row) => [row.studioId, row]),
    );
    const endpointsByStudio = groupBy(
      endpointRows.map(toEndpoint),
      (row) => row.studioId,
    );
    const pricingByStudio = groupBy(
      pricingRows.map(toPricing),
      (row) => row.studioId,
    );

    return studioRows.map((studio) => {
      const account = accountByStudio.get(studio.id);
      return {
        id: studio.id,
        businessCode: studio.businessCode,
        mcCode: studio.mcCode,
        name: studio.name,
        contactName: studio.contactName,
        contactPhoneMasked: studio.contactPhoneMasked,
        status: studio.status,
        createdBy: studio.createdBy,
        createdAt: studio.createdAt.toISOString(),
        updatedAt: studio.updatedAt.toISOString(),
        account: account
          ? {
              studioId: account.studioId,
              currency: 'CNY',
              balance: normalizeMoney(account.balance),
              activeHoldAmount: normalizeMoney(account.activeHoldAmount),
              availableBalance: subtractMoney(
                account.balance,
                account.activeHoldAmount,
              ),
              status: account.status,
              lockVersion: account.lockVersion,
              updatedAt: account.updatedAt.toISOString(),
            }
          : null,
        endpoints: endpointsByStudio.get(studio.id) ?? [],
        pricingVersions: pricingByStudio.get(studio.id) ?? [],
      };
    });
  }

  async findStudioByMcCode(
    mcCode: string,
  ): Promise<StudioConfiguration | null> {
    const [studio] = await this.db
      .select({ id: studios.id })
      .from(studios)
      .where(eq(studios.mcCode, mcCode))
      .limit(1);
    if (!studio) return null;
    const all = await this.listStudioConfigurations();
    return all.find((candidate) => candidate.id === studio.id) ?? null;
  }

  async findActiveEndpoint(
    studioId: string,
    sourceSystem: SourceSystem,
  ): Promise<IntegrationEndpointVersion | null> {
    const [row] = await this.db
      .select()
      .from(integrationEndpoints)
      .where(
        and(
          eq(integrationEndpoints.studioId, studioId),
          eq(integrationEndpoints.sourceSystem, sourceSystem),
          eq(integrationEndpoints.status, 'ACTIVE'),
        ),
      )
      .limit(1);
    return row ? toEndpoint(row) : null;
  }

  async findCurrentPricing(
    studioId: string,
    at = new Date(),
  ): Promise<StudioPricingVersion | null> {
    const [row] = await this.db
      .select()
      .from(studioPricingVersions)
      .where(
        and(
          eq(studioPricingVersions.studioId, studioId),
          inArray(studioPricingVersions.status, ['ACTIVE', 'SCHEDULED']),
          lte(studioPricingVersions.effectiveFrom, at),
          or(
            isNull(studioPricingVersions.effectiveTo),
            gt(studioPricingVersions.effectiveTo, at),
          ),
        ),
      )
      .orderBy(
        desc(studioPricingVersions.effectiveFrom),
        desc(studioPricingVersions.version),
      )
      .limit(1);
    return row ? toPricing(row) : null;
  }

  async listSupplierPricingTiers(): Promise<SupplierPricingTier[]> {
    const rows = await this.db
      .select()
      .from(supplierPricingTiers)
      .orderBy(asc(supplierPricingTiers.minMonthlyMinutes));
    return rows.map((row) => ({
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
    }));
  }

  async listNormalizedScriptBindings(
    studioId: string,
    sourceSystem: SourceSystem,
    categoryIds: string[] = [],
  ): Promise<NormalizedScriptBinding[]> {
    const conditions = [
      eq(scriptBindings.studioId, studioId),
      eq(scriptBindings.sourceSystem, sourceSystem),
      eq(scriptBindings.status, 'ACTIVE'),
      eq(scriptCategoryBindings.active, true),
    ];
    if (categoryIds.length) {
      conditions.push(
        inArray(scriptCategoryBindings.sourceCategoryId, categoryIds),
      );
    }
    const rows = await this.db
      .select({ binding: scriptBindings, category: scriptCategoryBindings })
      .from(scriptBindings)
      .innerJoin(
        scriptCategoryBindings,
        eq(scriptCategoryBindings.scriptBindingId, scriptBindings.id),
      )
      .where(and(...conditions))
      .orderBy(scriptBindings.robotDefId, scriptCategoryBindings.categoryPath);

    const bindings = new Map<string, NormalizedScriptBinding>();
    for (const row of rows) {
      const current = bindings.get(row.binding.id) ?? {
        id: row.binding.id,
        robotDefId: row.binding.robotDefId,
        studioId: row.binding.studioId,
        sourceSystem: row.binding.sourceSystem as SourceSystem,
        userPhoneId: row.binding.userPhoneId,
        status: row.binding.status,
        version: row.binding.version,
        categories: [],
      };
      current.categories.push({
        sourceCategoryId: row.category.sourceCategoryId,
        categoryPath: row.category.categoryPath,
      });
      bindings.set(current.id, current);
    }
    return [...bindings.values()];
  }
}

function toEndpoint(
  row: typeof integrationEndpoints.$inferSelect,
): IntegrationEndpointVersion {
  return {
    ...row,
    sourceSystem: row.sourceSystem as SourceSystem,
    effectiveAt: row.effectiveAt?.toISOString() ?? null,
    retiredAt: row.retiredAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toPricing(
  row: typeof studioPricingVersions.$inferSelect,
): StudioPricingVersion {
  return {
    ...row,
    voiceRate: normalizeMoney(row.voiceRate),
    smsRate: normalizeMoney(row.smsRate),
    effectiveFrom: row.effectiveFrom.toISOString(),
    effectiveTo: row.effectiveTo?.toISOString() ?? null,
    publishedAt: row.publishedAt.toISOString(),
  };
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const groupKey = key(item);
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), item]);
  }
  return groups;
}

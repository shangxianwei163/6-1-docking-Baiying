import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { eq } from 'drizzle-orm';
import type { SourceSystem } from '@outbound/contracts';
import { readConfig } from '../config.js';
import { createDatabase, type Database } from './client.js';
import {
  auditLogs,
  baiyingPhoneLines,
  baiyingRobotBindings,
  integrationEndpoints,
  scriptBindings,
  scriptCategoryBindings,
  sourceDataCategories,
  studioAccounts,
  studioPricingVersions,
  studios,
  supplierPricingTiers,
} from './schema.js';
import {
  phase1StaticStudios,
  phase1SupplierPricingTiers,
} from './phase1-static-config.js';

export type Phase1ImportReport = {
  studiosInserted: number;
  accountsInserted: number;
  pricingVersionsInserted: number;
  endpointsInserted: number;
  supplierTiersInserted: number;
  legacyBindingsEligible: number;
  legacyBindingsNormalized: number;
  legacyBindingsAlreadyNormalized: number;
  legacyBindingsSkipped: Array<{ robotDefId: string; reason: string }>;
};

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export async function importPhase1StaticConfig(
  db: Database,
): Promise<Phase1ImportReport> {
  return db.transaction(async (tx) => {
    const report: Phase1ImportReport = {
      studiosInserted: 0,
      accountsInserted: 0,
      pricingVersionsInserted: 0,
      endpointsInserted: 0,
      supplierTiersInserted: 0,
      legacyBindingsEligible: 0,
      legacyBindingsNormalized: 0,
      legacyBindingsAlreadyNormalized: 0,
      legacyBindingsSkipped: [],
    };

    for (const fixture of phase1StaticStudios) {
      const insertedStudios = await tx
        .insert(studios)
        .values({
          businessCode: fixture.businessCode,
          mcCode: fixture.mcCode,
          name: fixture.name,
          contactName: fixture.contactName,
          contactPhoneMasked: fixture.contactPhoneMasked,
          status: fixture.status,
          createdBy: fixture.createdBy,
          createdAt: fixture.createdAt,
          updatedAt: fixture.createdAt,
        })
        .onConflictDoNothing({ target: studios.businessCode })
        .returning({ id: studios.id });
      report.studiosInserted += insertedStudios.length;

      const [studio] = await tx
        .select({ id: studios.id })
        .from(studios)
        .where(eq(studios.businessCode, fixture.businessCode))
        .limit(1);
      if (!studio)
        throw new Error(`静态影楼 ${fixture.businessCode} 写入后不可读取`);

      const accounts = await tx
        .insert(studioAccounts)
        .values({
          studioId: studio.id,
          balance: fixture.balance,
          status: fixture.accountStatus,
          updatedAt: fixture.createdAt,
        })
        .onConflictDoNothing({ target: studioAccounts.studioId })
        .returning({ studioId: studioAccounts.studioId });
      report.accountsInserted += accounts.length;

      const pricing = await tx
        .insert(studioPricingVersions)
        .values({
          studioId: studio.id,
          version: 1,
          voiceRate: fixture.rate,
          smsRate: '0.080000',
          frozenMinutes: 2,
          sourceMode: 'UNIFORM',
          status: 'ACTIVE',
          effectiveFrom: fixture.createdAt,
          publishedBy: 'phase1-static-import',
          publishedAt: fixture.createdAt,
        })
        .onConflictDoNothing({
          target: [
            studioPricingVersions.studioId,
            studioPricingVersions.version,
          ],
        })
        .returning({ id: studioPricingVersions.id });
      report.pricingVersionsInserted += pricing.length;

      report.endpointsInserted += await insertEndpoint(
        tx,
        studio.id,
        'ERP',
        fixture.erpResultUrl,
        fixture.erpRecordingUrl,
        fixture.createdBy,
        fixture.createdAt,
      );
      report.endpointsInserted += await insertEndpoint(
        tx,
        studio.id,
        'CRM',
        fixture.crmResultUrl,
        fixture.crmRecordingUrl,
        fixture.createdBy,
        fixture.createdAt,
      );
    }

    for (const tier of phase1SupplierPricingTiers) {
      const inserted = await tx
        .insert(supplierPricingTiers)
        .values({
          ...tier,
          effectiveFrom: new Date('2026-09-01T00:00:00+08:00'),
          publishedBy: 'phase1-static-import',
        })
        .onConflictDoNothing({ target: supplierPricingTiers.tierCode })
        .returning({ id: supplierPricingTiers.id });
      report.supplierTiersInserted += inserted.length;
    }

    await normalizeLegacyBindings(tx, report);
    await tx.insert(auditLogs).values({
      requestId: crypto.randomUUID(),
      actorId: 'phase1-static-import',
      action: 'PHASE1_STATIC_CONFIG_IMPORTED',
      objectType: 'STATIC_CONFIG_MANIFEST',
      objectId: '2026-09-06-v1',
      detail: report,
    });
    return report;
  });
}

async function insertEndpoint(
  tx: Transaction,
  studioId: string,
  sourceSystem: SourceSystem,
  resultUrl: string | null,
  recordingUrl: string | null,
  createdBy: string,
  createdAt: Date,
): Promise<number> {
  if (!resultUrl || !recordingUrl) return 0;
  const rows = await tx
    .insert(integrationEndpoints)
    .values({
      studioId,
      sourceSystem,
      version: 1,
      resultUrl,
      recordingUrl,
      status: 'DRAFT',
      createdBy,
      createdAt,
    })
    .onConflictDoNothing({
      target: [
        integrationEndpoints.studioId,
        integrationEndpoints.sourceSystem,
        integrationEndpoints.version,
      ],
    })
    .returning({ id: integrationEndpoints.id });
  return rows.length;
}

async function normalizeLegacyBindings(
  tx: Transaction,
  report: Phase1ImportReport,
): Promise<void> {
  const [legacyRows, studioRows, lineRows, categoryRows, normalizedRows] =
    await Promise.all([
      tx.select().from(baiyingRobotBindings),
      tx
        .select({ id: studios.id, businessCode: studios.businessCode })
        .from(studios),
      tx
        .select({ userPhoneId: baiyingPhoneLines.userPhoneId })
        .from(baiyingPhoneLines),
      tx
        .select({
          sourceSystem: sourceDataCategories.sourceSystem,
          externalId: sourceDataCategories.externalId,
        })
        .from(sourceDataCategories),
      tx
        .select({
          id: scriptBindings.id,
          robotDefId: scriptBindings.robotDefId,
          studioId: scriptBindings.studioId,
          sourceSystem: scriptBindings.sourceSystem,
        })
        .from(scriptBindings)
        .where(eq(scriptBindings.status, 'ACTIVE')),
    ]);
  const studioByBusinessCode = new Map(
    studioRows.map((row) => [row.businessCode, row.id]),
  );
  const lineIds = new Set(lineRows.map((row) => row.userPhoneId));
  const categoryKeys = new Set(
    categoryRows.map((row) => `${row.sourceSystem}:${row.externalId}`),
  );
  const normalizedKeys = new Set(
    normalizedRows.map(
      (row) => `${row.robotDefId}:${row.studioId}:${row.sourceSystem}`,
    ),
  );
  const occupiedCategories = new Set(
    (
      await tx
        .select({
          studioId: scriptCategoryBindings.studioId,
          sourceSystem: scriptCategoryBindings.sourceSystem,
          sourceCategoryId: scriptCategoryBindings.sourceCategoryId,
        })
        .from(scriptCategoryBindings)
        .where(eq(scriptCategoryBindings.active, true))
    ).map(
      (row) => `${row.studioId}:${row.sourceSystem}:${row.sourceCategoryId}`,
    ),
  );

  for (const legacy of legacyRows) {
    const studioId = studioByBusinessCode.get(legacy.studioId);
    const categories = legacy.categories.length
      ? legacy.categories
      : [
          {
            sourceCategoryId: legacy.sourceCategoryId,
            categoryPath: legacy.categoryPath,
          },
        ];
    const reason = !studioId
      ? `未找到业务编号为 ${legacy.studioId} 的影楼`
      : !lineIds.has(legacy.lineId)
        ? `线路 ${legacy.lineId} 尚未同步`
        : categories.some(
              (category) =>
                !categoryKeys.has(
                  `${legacy.sourceSystem}:${category.sourceCategoryId}`,
                ),
            )
          ? '至少一个来源分类尚未同步'
          : undefined;
    if (reason || !studioId) {
      report.legacyBindingsSkipped.push({
        robotDefId: legacy.robotDefId,
        reason: reason!,
      });
      continue;
    }
    report.legacyBindingsEligible += 1;
    const normalizedKey = `${legacy.robotDefId}:${studioId}:${legacy.sourceSystem}`;
    if (normalizedKeys.has(normalizedKey)) {
      report.legacyBindingsAlreadyNormalized += 1;
      continue;
    }
    const categoryConflict = categories.find((category) =>
      occupiedCategories.has(
        `${studioId}:${legacy.sourceSystem}:${category.sourceCategoryId}`,
      ),
    );
    if (categoryConflict) {
      report.legacyBindingsSkipped.push({
        robotDefId: legacy.robotDefId,
        reason: `分类 ${categoryConflict.sourceCategoryId} 已存在其他生效绑定`,
      });
      continue;
    }

    const [binding] = await tx
      .insert(scriptBindings)
      .values({
        robotDefId: legacy.robotDefId,
        studioId,
        sourceSystem: legacy.sourceSystem,
        userPhoneId: legacy.lineId,
        version: 1,
        createdBy: legacy.updatedBy,
        createdAt: legacy.updatedAt,
      })
      .returning();
    await tx.insert(scriptCategoryBindings).values(
      categories.map((category) => ({
        scriptBindingId: binding.id,
        studioId,
        sourceSystem: legacy.sourceSystem,
        sourceCategoryId: category.sourceCategoryId,
        categoryPath: category.categoryPath,
      })),
    );
    normalizedKeys.add(normalizedKey);
    for (const category of categories) {
      occupiedCategories.add(
        `${studioId}:${legacy.sourceSystem}:${category.sourceCategoryId}`,
      );
    }
    report.legacyBindingsNormalized += 1;
  }
}

async function main(): Promise<void> {
  const config = readConfig();
  if (config.NODE_ENV === 'production') {
    throw new Error('生产环境禁止执行静态演示配置导入');
  }
  const database = createDatabase(config.DATABASE_URL);
  try {
    const report = await importPhase1StaticConfig(database.db);
    console.info(JSON.stringify(report, null, 2));
  } finally {
    await database.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}

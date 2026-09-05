import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from './client.js';
import {
  baiyingLineStudioBindings,
  baiyingPhoneLines,
  baiyingRobotBindings,
  mappingRules,
  mappingVersions,
  scriptBindings,
  scriptCategoryBindings,
  studioAccounts,
  studioPricingVersions,
  studios,
  supplierPricingTiers,
  integrationEndpoints,
} from './schema.js';
import {
  phase1StaticExpectedCounts,
  phase1StaticStudios,
  phase1SupplierPricingTiers,
} from './phase1-static-config.js';

export type Phase1ReconciliationCheck = {
  name: string;
  expected: string | number;
  actual: string | number;
  ok: boolean;
};

export type UnresolvedLegacyBinding = {
  robotDefId: string;
  reason: string;
};

export type Phase1ReconciliationReport = {
  ok: boolean;
  checkedAt: string;
  checks: Phase1ReconciliationCheck[];
  preservedLegacyCounts: {
    robotBindings: number;
    phoneLines: number;
    lineStudioBindings: number;
    mappingVersions: number;
    mappingRules: number;
  };
  unresolvedLegacyBindings: UnresolvedLegacyBinding[];
};

export async function reconcilePhase1(
  db: Database,
): Promise<Phase1ReconciliationReport> {
  const businessCodes = phase1StaticStudios.map(
    (studio) => studio.businessCode,
  );
  const tierCodes = phase1SupplierPricingTiers.map((tier) => tier.tierCode);
  const allStudioRows = await db.select().from(studios);
  const businessCodeSet = new Set<string>(businessCodes);
  const studioRows = allStudioRows.filter((studio) =>
    businessCodeSet.has(studio.businessCode),
  );
  const studioIds = studioRows.map((studio) => studio.id);
  const [accountRows, pricingRows, endpointRows, tierRows, legacyRows] =
    await Promise.all([
      studioIds.length
        ? db
            .select()
            .from(studioAccounts)
            .where(inArray(studioAccounts.studioId, studioIds))
        : Promise.resolve([]),
      studioIds.length
        ? db
            .select()
            .from(studioPricingVersions)
            .where(
              and(
                inArray(studioPricingVersions.studioId, studioIds),
                eq(studioPricingVersions.version, 1),
              ),
            )
        : Promise.resolve([]),
      studioIds.length
        ? db
            .select()
            .from(integrationEndpoints)
            .where(
              and(
                inArray(integrationEndpoints.studioId, studioIds),
                eq(integrationEndpoints.version, 1),
              ),
            )
        : Promise.resolve([]),
      db
        .select()
        .from(supplierPricingTiers)
        .where(inArray(supplierPricingTiers.tierCode, tierCodes)),
      db.select().from(baiyingRobotBindings),
    ]);

  const checks: Phase1ReconciliationCheck[] = [
    countCheck(
      '静态影楼',
      phase1StaticExpectedCounts.studios,
      studioRows.length,
    ),
    countCheck(
      '影楼账户',
      phase1StaticExpectedCounts.accounts,
      accountRows.length,
    ),
    countCheck(
      '影楼价格版本 v1',
      phase1StaticExpectedCounts.pricingVersions,
      pricingRows.length,
    ),
    countCheck(
      '影楼回调端点版本 v1',
      phase1StaticExpectedCounts.endpoints,
      endpointRows.length,
    ),
    countCheck(
      '供应商价格阶梯',
      phase1StaticExpectedCounts.supplierPricingTiers,
      tierRows.length,
    ),
  ];

  const studioByCode = new Map(
    studioRows.map((studio) => [studio.businessCode, studio]),
  );
  const accountByStudio = new Map(
    accountRows.map((account) => [account.studioId, account]),
  );
  const pricingByStudio = new Map(
    pricingRows.map((pricing) => [pricing.studioId, pricing]),
  );
  const endpointByStudioAndSource = new Map(
    endpointRows.map((endpoint) => [
      `${endpoint.studioId}:${endpoint.sourceSystem}`,
      endpoint,
    ]),
  );

  for (const expected of phase1StaticStudios) {
    const actual = studioByCode.get(expected.businessCode);
    checks.push({
      name: `${expected.businessCode} 基础字段`,
      expected: `${expected.name}/${expected.mcCode}/${expected.status}`,
      actual: actual
        ? `${actual.name}/${actual.mcCode}/${actual.status}`
        : 'MISSING',
      ok:
        actual?.name === expected.name &&
        actual.mcCode === expected.mcCode &&
        actual.status === expected.status,
    });
    const account = actual ? accountByStudio.get(actual.id) : undefined;
    checks.push({
      name: `${expected.businessCode} 账户余额`,
      expected: `${expected.balance}/${expected.accountStatus}`,
      actual: account ? `${account.balance}/${account.status}` : 'MISSING',
      ok:
        account?.balance === expected.balance &&
        account.status === expected.accountStatus,
    });
    const pricing = actual ? pricingByStudio.get(actual.id) : undefined;
    checks.push({
      name: `${expected.businessCode} 客户价格`,
      expected: `${expected.rate}/0.080000/2/ACTIVE`,
      actual: pricing
        ? `${pricing.voiceRate}/${pricing.smsRate}/${pricing.frozenMinutes}/${pricing.status}`
        : 'MISSING',
      ok:
        pricing?.voiceRate === expected.rate &&
        pricing.smsRate === '0.080000' &&
        pricing.frozenMinutes === 2 &&
        pricing.status === 'ACTIVE',
    });
    for (const endpoint of [
      {
        sourceSystem: 'ERP',
        resultUrl: expected.erpResultUrl,
        recordingUrl: expected.erpRecordingUrl,
      },
      {
        sourceSystem: 'CRM',
        resultUrl: expected.crmResultUrl,
        recordingUrl: expected.crmRecordingUrl,
      },
    ] as const) {
      if (!endpoint.resultUrl || !endpoint.recordingUrl) continue;
      const actualEndpoint = actual
        ? endpointByStudioAndSource.get(`${actual.id}:${endpoint.sourceSystem}`)
        : undefined;
      checks.push({
        name: `${expected.businessCode} ${endpoint.sourceSystem} 端点`,
        expected: `${endpoint.resultUrl}/${endpoint.recordingUrl}/DRAFT`,
        actual: actualEndpoint
          ? `${actualEndpoint.resultUrl}/${actualEndpoint.recordingUrl}/${actualEndpoint.status}`
          : 'MISSING',
        ok:
          actualEndpoint?.resultUrl === endpoint.resultUrl &&
          actualEndpoint.recordingUrl === endpoint.recordingUrl &&
          actualEndpoint.status === 'DRAFT',
      });
    }
  }

  for (const expected of phase1SupplierPricingTiers) {
    const actual = tierRows.find((tier) => tier.tierCode === expected.tierCode);
    const expectedRange = `${expected.minMonthlyMinutes.toString()}-${expected.maxMonthlyMinutes?.toString() ?? '∞'}`;
    const actualRange = actual
      ? `${actual.minMonthlyMinutes.toString()}-${actual.maxMonthlyMinutes?.toString() ?? '∞'}`
      : 'MISSING';
    checks.push({
      name: `${expected.tierCode} 供应商价格`,
      expected: `${expectedRange}/${expected.voiceRate}/${expected.smsRate}`,
      actual: actual
        ? `${actualRange}/${actual.voiceRate}/${actual.smsRate}`
        : 'MISSING',
      ok:
        actualRange === expectedRange &&
        actual?.voiceRate === expected.voiceRate &&
        actual.smsRate === expected.smsRate,
    });
  }

  const unresolvedLegacyBindings = await findUnresolvedLegacyBindings(
    db,
    legacyRows,
    allStudioRows,
  );
  checks.push(
    countCheck('未对齐的旧话术绑定', 0, unresolvedLegacyBindings.length),
  );

  const [phoneLines, lineStudioBindings, versions, rules] = await Promise.all([
    db.select().from(baiyingPhoneLines),
    db.select().from(baiyingLineStudioBindings),
    db.select().from(mappingVersions),
    db.select().from(mappingRules),
  ]);

  return {
    ok: checks.every((check) => check.ok),
    checkedAt: new Date().toISOString(),
    checks,
    preservedLegacyCounts: {
      robotBindings: legacyRows.length,
      phoneLines: phoneLines.length,
      lineStudioBindings: lineStudioBindings.length,
      mappingVersions: versions.length,
      mappingRules: rules.length,
    },
    unresolvedLegacyBindings,
  };
}

async function findUnresolvedLegacyBindings(
  db: Database,
  legacyRows: Array<typeof baiyingRobotBindings.$inferSelect>,
  studioRows: Array<typeof studios.$inferSelect>,
): Promise<UnresolvedLegacyBinding[]> {
  if (!legacyRows.length) return [];
  const studioByCode = new Map(
    studioRows.map((studio) => [studio.businessCode, studio.id]),
  );
  const normalizedRows = await db
    .select({ binding: scriptBindings, category: scriptCategoryBindings })
    .from(scriptBindings)
    .leftJoin(
      scriptCategoryBindings,
      and(
        eq(scriptCategoryBindings.scriptBindingId, scriptBindings.id),
        eq(scriptCategoryBindings.active, true),
      ),
    )
    .where(eq(scriptBindings.status, 'ACTIVE'));

  return legacyRows.flatMap((legacy) => {
    const studioId = studioByCode.get(legacy.studioId);
    if (!studioId) {
      return [
        {
          robotDefId: legacy.robotDefId,
          reason: `影楼业务编号 ${legacy.studioId} 不在阶段 1 影楼表中`,
        },
      ];
    }
    const expectedCategories = legacy.categories.length
      ? legacy.categories
      : [
          {
            sourceCategoryId: legacy.sourceCategoryId,
            categoryPath: legacy.categoryPath,
          },
        ];
    const candidates = normalizedRows.filter(
      (row) =>
        row.binding.robotDefId === legacy.robotDefId &&
        row.binding.studioId === studioId &&
        row.binding.sourceSystem === legacy.sourceSystem &&
        row.binding.userPhoneId === legacy.lineId,
    );
    const actualIds = new Set(
      candidates
        .map((row) => row.category?.sourceCategoryId)
        .filter((value): value is string => Boolean(value)),
    );
    const missingIds = expectedCategories
      .map((category) => category.sourceCategoryId)
      .filter((id) => !actualIds.has(id));
    if (candidates.length && !missingIds.length) return [];
    return [
      {
        robotDefId: legacy.robotDefId,
        reason: candidates.length
          ? `规范化绑定缺少分类 ${missingIds.join(', ')}`
          : '缺少同影楼、来源和线路的生效规范化绑定',
      },
    ];
  });
}

function countCheck(
  name: string,
  expected: number,
  actual: number,
): Phase1ReconciliationCheck {
  return { name, expected, actual, ok: expected === actual };
}

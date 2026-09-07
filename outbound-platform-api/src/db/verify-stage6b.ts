import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { readConfig } from '../config.js';
import { PostgresConfigurationRepository } from '../configuration/postgres-repository.js';
import { PostgresOperationsConsoleService } from '../operations/service.js';
import { LocalDataProtector } from '../security/data-protector.js';
import { createDatabase, type Database } from './client.js';
import {
  accountLedger,
  auditLogs,
  integrationEndpoints,
  studioAccounts,
  studioPricingVersions,
  studios,
} from './schema.js';

const config = readConfig();
if (config.NODE_ENV === 'production') {
  throw new Error('阶段 6B 本地验收禁止在生产环境运行');
}

const database = createDatabase(config.DATABASE_URL);
const now = new Date('2026-09-06T10:30:00.000Z');
const service = new PostgresOperationsConsoleService(
  database.db,
  new LocalDataProtector(config.WORKER_SHARED_SECRET, config.NODE_ENV),
  () => now,
  randomUUID,
);
const configurationRepository = new PostgresConfigurationRepository(
  database.db,
);
const requestIds: string[] = [];
let studioId: string | undefined;

class SupplierPricingVerificationRollback extends Error {}

try {
  const createRequestId = randomUUID();
  requestIds.push(createRequestId);
  const created = await service.createStudio(
    {
      name: '阶段六账务验收影楼',
      mcCode: `MC-STAGE6B-${Date.now()}`,
      contactName: '验收联系人',
      contactPhone: '13800138000',
      endpoints: [
        {
          sourceSystem: 'ERP',
          resultUrl: 'https://erp.stage6b.example.com/result',
          recordingUrl: 'https://erp.stage6b.example.com/recording',
        },
        {
          sourceSystem: 'CRM',
          resultUrl: 'https://crm.stage6b.example.com/result',
          recordingUrl: 'https://crm.stage6b.example.com/recording',
        },
      ],
    },
    'stage6b-verifier',
    createRequestId,
  );
  studioId = created.id;
  assert.match(created.businessCode, /^YL-\d{6}-\d{4,}$/);
  assert.equal(created.contactPhoneMasked, '138****8000');
  assert.equal(created.account.status, 'OVERDUE');
  assert.equal(created.endpoints.length, 2);
  assert.ok(
    created.endpoints.every(
      (endpoint) =>
        endpoint.version === 1 &&
        endpoint.status === 'DRAFT' &&
        endpoint.secretConfigured === false,
    ),
  );

  const updateRequestId = randomUUID();
  requestIds.push(updateRequestId);
  const updated = await service.updateStudio(
    created.id,
    {
      name: '阶段六账务验收影楼（已更新）',
      contactName: '新联系人',
      endpoints: [
        {
          sourceSystem: 'ERP',
          resultUrl: 'https://erp-v2.stage6b.example.com/result',
          recordingUrl: 'https://erp-v2.stage6b.example.com/recording',
        },
      ],
    },
    'stage6b-verifier',
    updateRequestId,
  );
  assert.equal(updated.name, '阶段六账务验收影楼（已更新）');
  assert.equal(updated.contactName, '新联系人');
  const erpVersions = updated.endpoints.filter(
    (endpoint) => endpoint.sourceSystem === 'ERP',
  );
  assert.equal(erpVersions.length, 2);
  assert.equal(erpVersions[0]?.version, 2);
  assert.equal(erpVersions[0]?.status, 'DRAFT');
  assert.equal(
    erpVersions[0]?.resultUrl,
    'https://erp-v2.stage6b.example.com/result',
  );
  assert.equal(erpVersions[1]?.status, 'RETIRED');

  for (const status of ['DISABLED', 'ACTIVE'] as const) {
    const requestId = randomUUID();
    requestIds.push(requestId);
    const changed = await service.setStudioStatus(
      created.id,
      status,
      `阶段 6B 验收切换为 ${status}`,
      'stage6b-verifier',
      requestId,
    );
    assert.equal(changed.status, status);
  }

  const topUpRequestId = randomUUID();
  requestIds.push(topUpRequestId);
  const topUpInput = {
    studioId: created.id,
    amount: '650.00',
    idempotencyKey: randomUUID(),
    channel: 'CORPORATE_TRANSFER' as const,
    receiptReference: 'STAGE6B-BANK-001',
    receiptFileName: 'stage6b-receipt.pdf',
    reason: '阶段 6B 充值幂等验收',
  };
  const firstTopUp = await service.topUp(
    topUpInput,
    'stage6b-verifier',
    topUpRequestId,
  );
  const replayedTopUp = await service.topUp(
    topUpInput,
    'stage6b-verifier',
    randomUUID(),
  );
  assert.equal(replayedTopUp.entry.ledgerId, firstTopUp.entry.ledgerId);
  assert.equal(replayedTopUp.studio.account.balance, '650.000000');
  assert.equal(replayedTopUp.studio.account.status, 'ACTIVE');
  assert.deepEqual(firstTopUp.entry.evidence, {
    channel: 'CORPORATE_TRANSFER',
    receiptReference: 'STAGE6B-BANK-001',
    receiptFileName: 'stage6b-receipt.pdf',
  });
  await assert.rejects(
    service.topUp(
      { ...topUpInput, receiptReference: 'STAGE6B-BANK-CHANGED' },
      'stage6b-verifier',
      randomUUID(),
    ),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'IDEMPOTENCY_CONFLICT',
  );

  const ledgerPage = await service.listLedger({
    studioId: created.id,
    entryType: 'TOP_UP',
    pageNum: 0,
    pageSize: 20,
  });
  assert.equal(ledgerPage.total, 1);
  assert.equal(ledgerPage.totalTopUp, '650.000000');
  assert.equal(
    ledgerPage.items[0]?.evidence?.receiptReference,
    'STAGE6B-BANK-001',
  );

  const immediatePricing = {
    mode: 'PER_STUDIO' as const,
    entries: [
      {
        studioId: created.id,
        rate: { voiceRate: '0.53', smsRate: '0.09', frozenMinutes: 3 },
      },
    ],
    effectiveFrom: now.toISOString(),
    reason: '阶段 6B 立即价格验收',
  };
  const preview = await service.previewPricing(immediatePricing);
  assert.equal(preview.affectedStudioCount, 1);
  assert.equal(preview.items[0]?.currentVoiceRate, null);

  const pricingRequestId = randomUUID();
  requestIds.push(pricingRequestId);
  const published = await service.publishPricing(
    immediatePricing,
    'stage6b-verifier',
    pricingRequestId,
  );
  assert.equal(published.published[0]?.version, 1);
  assert.equal(published.published[0]?.status, 'ACTIVE');

  const future = new Date(now.getTime() + 24 * 60 * 60_000);
  const scheduledPricing = {
    mode: 'PER_STUDIO' as const,
    entries: [
      {
        studioId: created.id,
        rate: { voiceRate: '0.55', smsRate: '0.10', frozenMinutes: 3 },
      },
    ],
    effectiveFrom: future.toISOString(),
    reason: '阶段 6B 预约价格验收',
  };
  const scheduledRequestId = randomUUID();
  requestIds.push(scheduledRequestId);
  const scheduled = await service.publishPricing(
    scheduledPricing,
    'stage6b-verifier',
    scheduledRequestId,
  );
  assert.equal(scheduled.published[0]?.version, 2);
  assert.equal(scheduled.published[0]?.status, 'SCHEDULED');

  const currentAtNow = await configurationRepository.findCurrentPricing(
    created.id,
    now,
  );
  const currentAfterSchedule = await configurationRepository.findCurrentPricing(
    created.id,
    new Date(future.getTime() + 1000),
  );
  assert.equal(currentAtNow?.voiceRate, '0.530000');
  assert.equal(currentAfterSchedule?.voiceRate, '0.550000');

  const overview = await service.getPricingOverview();
  const pricingStudio = overview.studios.find(
    (candidate) => candidate.studioId === created.id,
  );
  assert.equal(pricingStudio?.currentPricing?.voiceRate, '0.530000');
  assert.equal(pricingStudio?.scheduledPricing?.voiceRate, '0.550000');

  await verifySupplierPricingPublishing();

  const auditRows = await database.db
    .select({ action: auditLogs.action })
    .from(auditLogs)
    .where(inArray(auditLogs.requestId, requestIds));
  assert.deepEqual(
    new Set(auditRows.map((row) => row.action)),
    new Set([
      'STUDIO_CREATED',
      'STUDIO_UPDATED',
      'STUDIO_DISABLED',
      'STUDIO_ENABLED',
      'ACCOUNT_TOP_UP_POSTED',
      'STUDIO_PRICING_PUBLISHED',
    ]),
  );

  console.info(
    JSON.stringify(
      {
        stage: '6B-1',
        status: 'passed',
        checks: {
          studioLifecycle: true,
          endpointDraftVersioning: true,
          encryptedContactAndMaskedRead: true,
          idempotentTopUpWithEvidence: true,
          idempotencyPayloadConflict: true,
          immediateAndScheduledPricing: true,
          manualSupplierPricingVersioning: true,
          auditTrail: true,
        },
      },
      null,
      2,
    ),
  );
} finally {
  if (studioId) {
    await database.db.transaction(async (tx) => {
      await tx
        .delete(accountLedger)
        .where(eq(accountLedger.studioId, studioId!));
      await tx
        .delete(studioPricingVersions)
        .where(eq(studioPricingVersions.studioId, studioId!));
      await tx
        .delete(integrationEndpoints)
        .where(eq(integrationEndpoints.studioId, studioId!));
      if (requestIds.length) {
        await tx
          .delete(auditLogs)
          .where(inArray(auditLogs.requestId, requestIds));
      }
      await tx
        .delete(studioAccounts)
        .where(eq(studioAccounts.studioId, studioId!));
      await tx.delete(studios).where(eq(studios.id, studioId!));
    });
  }
  await database.close();
}

async function verifySupplierPricingPublishing(): Promise<void> {
  let completed = false;
  try {
    await database.db.transaction(async (tx) => {
      const supplierService = new PostgresOperationsConsoleService(
        tx as unknown as Database,
        undefined,
        () => now,
        randomUUID,
      );
      const currentBefore = await supplierService.getPricingOverview();
      assert.ok(currentBefore.supplierTiers.length >= 3);
      const effectiveFrom = '2026-10-31T16:00:00.000Z';
      const currentDrafts = currentBefore.supplierTiers.map((tier) => ({
        tierCode: tier.tierCode,
        name: tier.name,
        minMonthlyMinutes: tier.minMonthlyMinutes,
        maxMonthlyMinutes: tier.maxMonthlyMinutes,
        voiceRate: tier.voiceRate,
        smsRate: tier.smsRate,
      }));
      const firstInput = {
        effectiveFrom,
        reason: '阶段 6B 海南供应价格人工发布验收',
        tiers: currentDrafts.map((tier, index) =>
          index === 0 ? { ...tier, voiceRate: '9.210000' } : tier,
        ),
      };
      const preview = await supplierService.previewSupplierPricing(firstInput);
      assert.equal(preview.tierCount, 3);
      assert.equal(preview.effectiveFrom, effectiveFrom);

      const firstRequestId = randomUUID();
      const firstPublished = await supplierService.publishSupplierPricing(
        firstInput,
        'stage6b-supplier-pricing-verifier',
        firstRequestId,
      );
      assert.equal(firstPublished.published.length, 1);
      assert.ok(
        firstPublished.published.every(
          (tier) => tier.effectiveFrom === effectiveFrom,
        ),
      );

      const secondRequestId = randomUUID();
      const lastIndex = currentDrafts.length - 1;
      const finalTier = currentDrafts[lastIndex]!;
      const secondTiers = currentDrafts.flatMap((tier, index) => {
        if (index === 0) return [{ ...tier, voiceRate: '9.220000' }];
        if (index !== lastIndex) return [tier];
        return [
          { ...tier, maxMonthlyMinutes: '60000' },
          {
            tierCode: 'tier-verifier-new',
            name: '验收新增阶梯',
            minMonthlyMinutes: '60000',
            maxMonthlyMinutes: null,
            voiceRate: finalTier.voiceRate,
            smsRate: finalTier.smsRate,
          },
        ];
      });
      const secondPublished = await supplierService.publishSupplierPricing(
        {
          ...firstInput,
          reason: '阶段 6B 海南供应价格预约替换验收',
          tiers: secondTiers,
        },
        'stage6b-supplier-pricing-verifier',
        secondRequestId,
      );
      assert.equal(secondPublished.replacedScheduledCount, 1);
      assert.equal(secondPublished.published.length, 3);

      const overview = await supplierService.getPricingOverview();
      assert.deepEqual(
        overview.supplierTiers.map((tier) => [tier.id, tier.voiceRate]),
        currentBefore.supplierTiers.map((tier) => [tier.id, tier.voiceRate]),
        '未来供应价格发布不能提前改变当前生效价格',
      );
      assert.equal(overview.scheduledSupplierTiers.length, 3);
      assert.equal(overview.scheduledSupplierTiers[0]?.voiceRate, '9.220000');
      assert.ok(
        !overview.scheduledSupplierTiers.some(
          (tier) => tier.tierCode === currentDrafts[1]!.tierCode,
        ),
        '未变化阶梯不应生成待启用记录',
      );

      const auditRows = await tx
        .select({ action: auditLogs.action, detail: auditLogs.detail })
        .from(auditLogs)
        .where(inArray(auditLogs.requestId, [firstRequestId, secondRequestId]));
      assert.equal(auditRows.length, 2);
      assert.ok(
        auditRows.every(
          (row) =>
            row.action === 'SUPPLIER_PRICING_PUBLISHED' &&
            Array.isArray(row.detail.tiers),
        ),
      );
      assert.deepEqual(
        auditRows
          .map((row) => (row.detail.tiers as unknown[]).length)
          .sort((left, right) => left - right),
        [currentDrafts.length, currentDrafts.length + 1],
      );

      completed = true;
      throw new SupplierPricingVerificationRollback();
    });
  } catch (error) {
    if (!(error instanceof SupplierPricingVerificationRollback)) throw error;
  }
  assert.equal(completed, true, '海南供应价格事务验收没有完整执行');
}

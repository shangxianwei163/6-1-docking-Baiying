import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { readConfig } from '../config.js';
import { PostgresConfigurationRepository } from '../configuration/postgres-repository.js';
import { PostgresOperationsConsoleService } from '../operations/service.js';
import { LocalDataProtector } from '../security/data-protector.js';
import { createDatabase } from './client.js';
import {
  accountLedger,
  auditLogs,
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

try {
  const createRequestId = randomUUID();
  requestIds.push(createRequestId);
  const created = await service.createStudio(
    {
      name: '阶段六账务验收影楼',
      mcCode: `MC-STAGE6B-${Date.now()}`,
      contactName: '验收联系人',
      contactPhone: '13800138000',
    },
    'stage6b-verifier',
    createRequestId,
  );
  studioId = created.id;
  assert.match(created.businessCode, /^YL-\d{6}-\d{4,}$/);
  assert.equal(created.contactPhoneMasked, '138****8000');
  assert.equal(created.account.status, 'OVERDUE');

  const updateRequestId = randomUUID();
  requestIds.push(updateRequestId);
  const updated = await service.updateStudio(
    created.id,
    { name: '阶段六账务验收影楼（已更新）', contactName: '新联系人' },
    'stage6b-verifier',
    updateRequestId,
  );
  assert.equal(updated.name, '阶段六账务验收影楼（已更新）');
  assert.equal(updated.contactName, '新联系人');

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
          encryptedContactAndMaskedRead: true,
          idempotentTopUpWithEvidence: true,
          idempotencyPayloadConflict: true,
          immediateAndScheduledPricing: true,
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

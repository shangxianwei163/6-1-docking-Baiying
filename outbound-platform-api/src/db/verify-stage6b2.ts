import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { readConfig } from '../config.js';
import { PostgresAccountAdjustmentService } from '../operations/adjustment-service.js';
import { PostgresOperatorAuditService } from '../operations/audit-service.js';
import {
  OperationsConsoleFailure,
  PostgresOperationsConsoleService,
} from '../operations/service.js';
import { LocalDataProtector } from '../security/data-protector.js';
import { createDatabase } from './client.js';
import {
  accountAdjustmentRequests,
  accountLedger,
  auditLogs,
  studioAccounts,
  studioPricingVersions,
  studios,
} from './schema.js';

const config = readConfig();
if (config.NODE_ENV === 'production') {
  throw new Error('阶段 6B-2 本地验收禁止在生产环境运行');
}

const database = createDatabase(config.DATABASE_URL);
const now = new Date('2026-09-06T12:30:00.000Z');
const operations = new PostgresOperationsConsoleService(
  database.db,
  new LocalDataProtector(config.WORKER_SHARED_SECRET, config.NODE_ENV),
  () => now,
  randomUUID,
);
const adjustments = new PostgresAccountAdjustmentService(
  database.db,
  () => now,
  randomUUID,
);
const audits = new PostgresOperatorAuditService(database.db, () => now);
const requestIds: string[] = [];
const adjustmentIds: string[] = [];
let studioId: string | undefined;

try {
  const studioRequestId = randomUUID();
  requestIds.push(studioRequestId);
  const studio = await operations.createStudio(
    {
      name: '阶段六双人审批验收影楼',
      mcCode: `MC-STAGE6B2-${Date.now()}`,
      contactName: '财务验收',
      contactPhone: null,
    },
    'stage6b2-maker',
    studioRequestId,
  );
  studioId = studio.id;

  const topUpRequestId = randomUUID();
  requestIds.push(topUpRequestId);
  await operations.topUp(
    {
      studioId,
      amount: '1000.00',
      idempotencyKey: randomUUID(),
      channel: 'CORPORATE_TRANSFER',
      receiptReference: 'STAGE6B2-OPENING-BALANCE',
      receiptFileName: null,
      reason: '阶段 6B-2 验收初始资金',
    },
    'stage6b2-maker',
    topUpRequestId,
  );

  const creditRequestId = randomUUID();
  requestIds.push(creditRequestId);
  const creditInput = {
    studioId,
    kind: 'ADJUSTMENT_CREDIT' as const,
    amount: '125.00',
    reason: '补录历史到账差额',
    supportingReference: 'STAGE6B2-WORKORDER-CREDIT',
    idempotencyKey: randomUUID(),
  };
  const credit = await adjustments.createAdjustment(
    creditInput,
    'stage6b2-maker',
    creditRequestId,
  );
  adjustmentIds.push(credit.id);
  assert.match(credit.requestNo, /^AR-\d{8}-\d{5,}$/);
  assert.equal(credit.status, 'PENDING');
  assert.equal(credit.balanceSnapshot, '1000.000000');
  assert.equal(credit.canReview, false);

  const replayed = await adjustments.createAdjustment(
    creditInput,
    'stage6b2-maker',
    randomUUID(),
  );
  assert.equal(replayed.id, credit.id);
  await assert.rejects(
    adjustments.createAdjustment(
      { ...creditInput, reason: '改变后的申请内容' },
      'stage6b2-maker',
      randomUUID(),
    ),
    hasCode('IDEMPOTENCY_CONFLICT'),
  );
  await assert.rejects(
    adjustments.decideAdjustment(
      credit.id,
      { decision: 'APPROVE', note: '本人尝试批准' },
      'stage6b2-maker',
      randomUUID(),
    ),
    hasCode('SELF_REVIEW_NOT_ALLOWED'),
  );

  const checkerPage = await adjustments.listAdjustments(
    { status: 'PENDING', pageNum: 0, pageSize: 20 },
    'stage6b2-checker',
  );
  assert.equal(
    checkerPage.items.find((item) => item.id === credit.id)?.canReview,
    true,
  );

  const creditDecisionRequestId = randomUUID();
  requestIds.push(creditDecisionRequestId);
  const approvedCredit = await adjustments.decideAdjustment(
    credit.id,
    { decision: 'APPROVE', note: '已核对历史收款工单' },
    'stage6b2-checker',
    creditDecisionRequestId,
  );
  assert.equal(approvedCredit.status, 'APPROVED');
  assert.equal(approvedCredit.ledger?.amount, '125.000000');
  assert.equal(approvedCredit.currentBalance, '1125.000000');
  const approvalReplay = await adjustments.decideAdjustment(
    credit.id,
    { decision: 'APPROVE', note: '已核对历史收款工单' },
    'stage6b2-checker',
    randomUUID(),
  );
  assert.equal(
    approvalReplay.ledger?.ledgerId,
    approvedCredit.ledger?.ledgerId,
  );

  const refundCreateRequestId = randomUUID();
  requestIds.push(refundCreateRequestId);
  const refund = await adjustments.createAdjustment(
    {
      studioId,
      kind: 'REFUND',
      amount: '200.00',
      reason: '客户取消服务退款',
      supportingReference: 'STAGE6B2-REFUND-001',
      idempotencyKey: randomUUID(),
    },
    'stage6b2-maker',
    refundCreateRequestId,
  );
  adjustmentIds.push(refund.id);
  const refundDecisionRequestId = randomUUID();
  requestIds.push(refundDecisionRequestId);
  const approvedRefund = await adjustments.decideAdjustment(
    refund.id,
    { decision: 'APPROVE', note: '退款单与可用余额核验通过' },
    'stage6b2-checker',
    refundDecisionRequestId,
  );
  assert.equal(approvedRefund.ledger?.amount, '-200.000000');
  assert.equal(approvedRefund.currentBalance, '925.000000');

  const rejectedCreateRequestId = randomUUID();
  requestIds.push(rejectedCreateRequestId);
  const rejected = await adjustments.createAdjustment(
    {
      studioId,
      kind: 'ADJUSTMENT_DEBIT',
      amount: '50.00',
      reason: '待确认的账务冲减',
      supportingReference: 'STAGE6B2-DEBIT-REJECT',
      idempotencyKey: randomUUID(),
    },
    'stage6b2-maker',
    rejectedCreateRequestId,
  );
  adjustmentIds.push(rejected.id);
  const rejectDecisionRequestId = randomUUID();
  requestIds.push(rejectDecisionRequestId);
  const rejectedResult = await adjustments.decideAdjustment(
    rejected.id,
    { decision: 'REJECT', note: '依据材料不足，退回申请' },
    'stage6b2-checker',
    rejectDecisionRequestId,
  );
  assert.equal(rejectedResult.status, 'REJECTED');
  assert.equal(rejectedResult.ledger, null);
  assert.equal(rejectedResult.currentBalance, '925.000000');

  await assert.rejects(
    adjustments.createAdjustment(
      {
        studioId,
        kind: 'REFUND',
        amount: '1000.00',
        reason: '超过可用余额的退款',
        supportingReference: null,
        idempotencyKey: randomUUID(),
      },
      'stage6b2-maker',
      randomUUID(),
    ),
    hasCode('INSUFFICIENT_AVAILABLE_BALANCE'),
  );

  const ledgerRows = await database.db
    .select({ type: accountLedger.entryType, amount: accountLedger.amount })
    .from(accountLedger)
    .where(eq(accountLedger.studioId, studioId));
  assert.equal(ledgerRows.length, 3);
  assert.deepEqual(
    ledgerRows
      .filter((row) => row.type !== 'TOP_UP')
      .map((row) => `${row.type}:${row.amount}`)
      .sort(),
    ['ADJUSTMENT:125.000000', 'REFUND:-200.000000'],
  );

  const creditAudits = await audits.listAuditEvents({
    keyword: credit.requestNo,
    category: 'FINANCIAL',
    pageNum: 0,
    pageSize: 20,
  });
  assert.deepEqual(
    new Set(creditAudits.items.map((item) => item.action)),
    new Set(['ACCOUNT_ADJUSTMENT_REQUESTED', 'ACCOUNT_ADJUSTMENT_APPROVED']),
  );

  const sensitiveRequestId = randomUUID();
  requestIds.push(sensitiveRequestId);
  const sensitiveObjectId = `stage6b2-sensitive-${randomUUID()}`;
  await database.db.insert(auditLogs).values({
    id: randomUUID(),
    requestId: sensitiveRequestId,
    actorId: 'stage6b2-verifier',
    action: 'STAGE6B2_SENSITIVE_FIELD_TEST',
    objectType: 'VERIFICATION',
    objectId: sensitiveObjectId,
    detail: {
      token: 'must-not-leak',
      contactPhone: '13800138000',
      nested: { authorization: 'Bearer must-not-leak', visible: 'nested-ok' },
      safeField: 'visible',
    },
    occurredAt: now,
  });
  const sanitized = await audits.listAuditEvents({
    keyword: sensitiveObjectId,
    pageNum: 0,
    pageSize: 20,
  });
  assert.equal(sanitized.items[0]?.detail.token, '[已脱敏]');
  assert.equal(sanitized.items[0]?.detail.contactPhone, '[已脱敏]');
  assert.equal(sanitized.items[0]?.detail.safeField, 'visible');
  assert.deepEqual(JSON.parse(String(sanitized.items[0]?.detail.nested)), {
    authorization: '[已脱敏]',
    visible: 'nested-ok',
  });

  console.info(
    JSON.stringify(
      {
        stage: '6B-2',
        status: 'passed',
        checks: {
          makerCheckerSeparation: true,
          requestIdempotency: true,
          creditApprovalAndSingleLedger: true,
          refundApprovalAndBalanceGuard: true,
          rejectionWithoutLedger: true,
          realAuditAggregationAndRedaction: true,
        },
      },
      null,
      2,
    ),
  );
} finally {
  if (studioId) {
    await database.db.transaction(async (tx) => {
      if (adjustmentIds.length) {
        await tx
          .delete(accountAdjustmentRequests)
          .where(inArray(accountAdjustmentRequests.id, adjustmentIds));
      }
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

function hasCode(code: string) {
  return (error: unknown) =>
    error instanceof OperationsConsoleFailure && error.code === code;
}

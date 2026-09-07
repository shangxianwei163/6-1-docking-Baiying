import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { CreateOutboundTaskRequest } from '@outbound/contracts';
import { LocalBaiyingCallJobClient } from '../baiying/local-call-job-client.js';
import { PostgresSupplierMonthlySettlementService } from '../billing/monthly-settlement-service.js';
import { addMoney } from '../billing/money.js';
import { BaiyingCallbackIngressService } from '../callback/ingress-service.js';
import { PostgresBaiyingCallbackProcessor } from '../callback/processor.js';
import { PostgresCallbackInboxRepository } from '../callback/postgres-repository.js';
import { BaiyingCallbackWorker } from '../callback/worker.js';
import { readConfig } from '../config.js';
import { stableJsonSha256 } from '../openapi/request-hash.js';
import { PostgresTaskOrchestrationRepository } from '../orchestration/postgres-repository.js';
import { TaskOrchestrationService } from '../orchestration/service.js';
import { TaskOrchestrationWorker } from '../orchestration/worker.js';
import { PostgresOutboundTaskService } from '../outbound-task/service.js';
import { PostgresOutboxRepository } from '../outbox/postgres-repository.js';
import { LocalDataProtector } from '../security/data-protector.js';
import { bootstrapStage2Local } from './bootstrap-stage2-local.js';
import { createDatabase, type Database } from './client.js';
import {
  accountLedger,
  auditLogs,
  baiyingLineStudioBindings,
  callbackInbox,
  callInstances,
  deliveryEvents,
  fundHolds,
  idempotencyRecords,
  integrationClients,
  integrationClientStudios,
  integrationEndpoints,
  platformTasks,
  queueOutbox,
  recordingAssets,
  scriptBindings,
  scriptCategoryBindings,
  studioAccounts,
  studioPricingVersions,
  studios,
  supplierMonthlySettlements,
  supplierPricingTiers,
  supplierSettlementTaskItems,
  taskCallItems,
  taskMappingSnapshots,
  taskOperations,
} from './schema.js';

type TaskFixture = {
  taskId: string;
  taskNo: string;
  callJobId: string;
  itemId: string;
  phone: string;
};

const SETTLEMENT_MONTH = '2001-01';
const FIXTURE_NOW = new Date('2001-02-02T02:00:00.000Z');
const TASK_CLOCK = new Date('2001-01-20T02:00:00.000Z');

async function main() {
  const config = readConfig();
  if (config.NODE_ENV === 'production') {
    throw new Error('阶段 7B 本地月结验收禁止在生产环境运行');
  }
  const database = createDatabase(config.DATABASE_URL);
  const protector = new LocalDataProtector(
    config.WORKER_SHARED_SECRET,
    config.NODE_ENV,
  );
  const suffix = randomUUID();
  const orchestrationQueue = `stage7b-orchestration-${suffix}`;
  const deliveryQueue = `stage7b-delivery-${suffix}`;
  const callbackProvider = `STAGE7B_${suffix.slice(0, 8)}`;
  const taskFixtures: TaskFixture[] = [];
  const inboxIds: string[] = [];
  const auditRequestIds: string[] = [];
  let studioId: string | undefined;
  let settlementId: string | undefined;

  try {
    await bootstrapStage2Local(database.db, TASK_CLOCK);
    const fixture = await createIsolatedStudio(database.db, suffix);
    studioId = fixture.studioId;
    const settlement = new PostgresSupplierMonthlySettlementService(
      database.db,
      () => FIXTURE_NOW,
    );
    const emptyPreview = await settlement.preview('2000-12');
    assert.equal(emptyPreview.taskCount, 0);
    assert.equal(emptyPreview.tier, null);
    assert.equal(emptyPreview.reconciliation.status, 'BALANCED');
    assert.deepEqual(emptyPreview.reconciliation.issues, []);
    await assert.rejects(
      settlement.finalize(
        '2000-12',
        {
          expectedSourceHash: emptyPreview.sourceHash,
          reason: '空月份无需生成供应商月结单',
          idempotencyKey: randomUUID(),
        },
        'stage7b-finance',
        randomUUID(),
      ),
      hasCode('SETTLEMENT_NOT_REQUIRED'),
    );

    const intake = new PostgresOutboundTaskService(database.db, protector, {
      baiyingCompanyId: 'LOCAL-MOCK',
      queueName: orchestrationQueue,
      supplierMonthlySettlementService: settlement,
      clock: () => TASK_CLOCK,
    });
    const orchestration = new TaskOrchestrationService(
      new PostgresTaskOrchestrationRepository(database.db, {
        deliveryQueueName: deliveryQueue,
        clock: () => TASK_CLOCK,
      }),
      new LocalBaiyingCallJobClient('SUCCESS'),
      protector,
    );
    const outbox = new PostgresOutboxRepository(database.db);
    const callbackRepository = new PostgresCallbackInboxRepository(
      database.db,
      {
        provider: callbackProvider,
        clock: () => TASK_CLOCK,
      },
    );
    const ingress = new BaiyingCallbackIngressService(
      callbackRepository,
      protector,
    );
    const callbackProcessor = new PostgresBaiyingCallbackProcessor(
      database.db,
      protector,
      { deliveryQueueName: deliveryQueue, clock: () => TASK_CLOCK },
    );

    const completeTask = async (
      label: string,
      phone: string,
      duration: number,
    ) => {
      const request = createRequest(
        fixture.mcCode,
        `${label}-${suffix}`,
        phone,
      );
      const accepted = await intake.accept({
        principal: fixture.principal,
        idempotencyKey: randomUUID(),
        requestId: randomUUID(),
        requestHash: stableJsonSha256(request),
        request,
      });
      const orchestrationWorker = new TaskOrchestrationWorker(
        outbox,
        orchestration,
        {
          queueName: orchestrationQueue,
          workerId: `stage7b-orchestration-${randomUUID().slice(0, 8)}`,
        },
      );
      assert.equal((await orchestrationWorker.runOnce()).status, 'COMPLETED');
      const [task] = await database.db
        .select({
          id: platformTasks.id,
          taskNo: platformTasks.taskNo,
          callJobId: platformTasks.baiyingCallJobId,
        })
        .from(platformTasks)
        .where(eq(platformTasks.id, accepted.body.data.taskId))
        .limit(1);
      assert.ok(task?.callJobId);
      const [item] = await database.db
        .select({ id: taskCallItems.id })
        .from(taskCallItems)
        .where(eq(taskCallItems.taskId, task.id))
        .limit(1);
      assert.ok(item);
      const taskFixture = {
        taskId: task.id,
        taskNo: task.taskNo,
        callJobId: task.callJobId,
        itemId: item.id,
        phone,
      };
      taskFixtures.push(taskFixture);

      const call = await ingress.ingest({
        rawBody: callCallback(taskFixture, duration),
        headers: new Headers({
          'content-type': 'application/json',
          'user-agent': 'stage7b-local-verifier',
        }),
      });
      inboxIds.push(call.id);
      const callWorker = new BaiyingCallbackWorker(
        callbackRepository,
        callbackProcessor,
        protector,
        {
          workerId: `stage7b-callback-${randomUUID().slice(0, 8)}`,
          eventKey: call.eventKey,
        },
      );
      assert.equal((await callWorker.runOnce()).status, 'SUCCEEDED');

      const job = await ingress.ingest({
        rawBody: jobCallback(taskFixture.callJobId),
        headers: new Headers({
          'content-type': 'application/json',
          'user-agent': 'stage7b-local-verifier',
        }),
      });
      inboxIds.push(job.id);
      const jobWorker = new BaiyingCallbackWorker(
        callbackRepository,
        callbackProcessor,
        protector,
        {
          workerId: `stage7b-callback-${randomUUID().slice(0, 8)}`,
          eventKey: job.eventKey,
        },
      );
      const result = await jobWorker.runOnce();
      assert.equal(result.status, 'SUCCEEDED');
      assert.equal(result.settled, true);
      return taskFixture;
    };

    const largeTask = await completeTask(
      'tier-boundary-large',
      '13971000001',
      599_940,
    );
    const smallTask = await completeTask(
      'tier-boundary-small',
      '13971000002',
      1,
    );
    const preview = await settlement.preview(SETTLEMENT_MONTH);
    assert.equal(preview.status, 'OPEN');
    assert.equal(preview.reconciliation.status, 'BALANCED');
    assert.equal(preview.taskCount, 2);
    assert.equal(preview.totalBillingMinutes, '10000');
    assert.match(preview.tier?.tierCode ?? '', /^stage7b-[a-f0-9]{8}-growth$/);
    assert.equal(preview.tier?.voiceRate, '0.180000');
    assert.equal(preview.totalCustomerCharge, '4800.000000');
    assert.equal(preview.totalPlatformCost, '1800.000000');
    assert.equal(preview.totalProfit, '3000.000000');
    const provisionalTask = await intake.getTask(
      fixture.principal,
      largeTask.taskNo,
    );
    assert.equal(provisionalTask.billing.platformRateStatus, 'PROVISIONAL');
    assert.equal(provisionalTask.billing.platformRate, '0.180000');
    assert.equal(provisionalTask.billing.platformCost, '1799.820000');
    assert.equal(provisionalTask.billing.profit, '2999.700000');

    await assert.rejects(
      settlement.finalize(
        '2001-02',
        {
          expectedSourceHash: '0'.repeat(64),
          reason: '当前月份不允许提前封账',
          idempotencyKey: randomUUID(),
        },
        'stage7b-finance',
        randomUUID(),
      ),
      hasCode('SETTLEMENT_MONTH_OPEN'),
    );
    await assert.rejects(
      settlement.finalize(
        SETTLEMENT_MONTH,
        {
          expectedSourceHash: '0'.repeat(64),
          reason: '使用过期预览尝试封账',
          idempotencyKey: randomUUID(),
        },
        'stage7b-finance',
        randomUUID(),
      ),
      hasCode('SETTLEMENT_PREVIEW_STALE'),
    );

    await database.db
      .update(platformTasks)
      .set({ customerCharge: addMoney('4799.520000', '0.010000') })
      .where(eq(platformTasks.id, largeTask.taskId));
    const brokenPreview = await settlement.preview(SETTLEMENT_MONTH);
    assert.equal(brokenPreview.reconciliation.status, 'BLOCKED');
    assert.equal(brokenPreview.reconciliation.blockingTaskCount, 1);
    assert.ok(brokenPreview.reconciliation.discrepancyCount >= 2);
    assert.deepEqual(
      new Set(brokenPreview.reconciliation.issues.map((issue) => issue.code)),
      new Set(['TASK_CUSTOMER_CHARGE_MISMATCH', 'TASK_LEDGER_CHARGE_MISMATCH']),
    );
    await assert.rejects(
      settlement.finalize(
        SETTLEMENT_MONTH,
        {
          expectedSourceHash: brokenPreview.sourceHash,
          reason: '带账务差异的预览不得封账',
          idempotencyKey: randomUUID(),
        },
        'stage7b-finance',
        randomUUID(),
      ),
      hasCode('SETTLEMENT_RECONCILIATION_BLOCKED'),
    );
    await database.db
      .update(platformTasks)
      .set({ customerCharge: '4799.520000' })
      .where(eq(platformTasks.id, largeTask.taskId));

    const finalPreview = await settlement.preview(SETTLEMENT_MONTH);
    assert.equal(finalPreview.sourceHash, preview.sourceHash);
    const finalizationInput = {
      expectedSourceHash: finalPreview.sourceHash,
      reason: '阶段 7B 本地账务核对无差异，批准封账',
      idempotencyKey: randomUUID(),
    };
    const firstRequestId = randomUUID();
    const secondRequestId = randomUUID();
    auditRequestIds.push(firstRequestId, secondRequestId);
    const finalizedResults = await Promise.all([
      settlement.finalize(
        SETTLEMENT_MONTH,
        finalizationInput,
        'stage7b-finance',
        firstRequestId,
      ),
      settlement.finalize(
        SETTLEMENT_MONTH,
        finalizationInput,
        'stage7b-finance',
        secondRequestId,
      ),
    ]);
    assert.deepEqual(
      finalizedResults
        .map((result) => result.idempotentReplay)
        .sort((left, right) => Number(left) - Number(right)),
      [false, true],
    );
    assert.equal(
      new Set(finalizedResults.map((result) => result.settlementId)).size,
      1,
    );
    settlementId = finalizedResults[0]!.settlementId!;

    const settledTasks = await database.db
      .select({
        id: platformTasks.id,
        customerCharge: platformTasks.customerCharge,
        platformRate: platformTasks.platformRate,
        platformCost: platformTasks.platformCost,
        profit: platformTasks.profit,
        settlementId: platformTasks.supplierSettlementId,
      })
      .from(platformTasks)
      .where(inArray(platformTasks.id, [largeTask.taskId, smallTask.taskId]));
    assert.equal(settledTasks.length, 2);
    assert.ok(
      settledTasks.every(
        (task) =>
          task.platformRate === '0.180000' &&
          task.settlementId === settlementId,
      ),
    );
    assert.deepEqual(
      settledTasks
        .map((task) =>
          [task.customerCharge, task.platformCost, task.profit].join('|'),
        )
        .sort(),
      ['0.480000|0.180000|0.300000', '4799.520000|1799.820000|2999.700000'],
    );
    const settlementItems = await database.db
      .select()
      .from(supplierSettlementTaskItems)
      .where(eq(supplierSettlementTaskItems.settlementId, settlementId));
    assert.equal(settlementItems.length, 2);
    const settlementRows = await database.db
      .select()
      .from(supplierMonthlySettlements)
      .where(eq(supplierMonthlySettlements.settlementMonth, '2001-01-01'));
    assert.equal(settlementRows.length, 1);
    assert.equal(settlementRows[0]?.totalCustomerCharge, '4800.000000');
    assert.equal(settlementRows[0]?.totalPlatformCost, '1800.000000');
    assert.equal(settlementRows[0]?.totalProfit, '3000.000000');
    const finalTask = await intake.getTask(fixture.principal, largeTask.taskNo);
    assert.equal(finalTask.billing.platformRateStatus, 'FINAL');
    assert.equal(finalTask.billing.platformCost, '1799.820000');
    const audits = await database.db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.action, 'SUPPLIER_MONTHLY_SETTLEMENT_FINALIZED'),
          eq(auditLogs.objectId, settlementId),
        ),
      );
    assert.equal(audits.length, 1);

    const replay = await settlement.finalize(
      SETTLEMENT_MONTH,
      finalizationInput,
      'stage7b-finance',
      randomUUID(),
    );
    assert.equal(replay.idempotentReplay, true);
    assert.equal(replay.settlementId, settlementId);

    await completeTask('late-zero-charge', '13971000003', 0);
    const drift = await settlement.preview(SETTLEMENT_MONTH);
    assert.equal(drift.status, 'FINALIZED');
    assert.equal(drift.taskCount, 2);
    assert.equal(drift.totalBillingMinutes, '10000');
    assert.equal(drift.reconciliation.status, 'BLOCKED');
    assert.equal(drift.reconciliation.lateTaskCount, 1);
    assert.ok(
      drift.reconciliation.issues.some(
        (issue) => issue.code === 'FINALIZED_SOURCE_DRIFT',
      ),
    );

    console.info(
      JSON.stringify(
        {
          status: 'passed',
          mode: 'LOCAL_POSTGRES_NO_EXTERNAL_NETWORK',
          settlementMonth: SETTLEMENT_MONTH,
          checks: [
            '按 Asia/Shanghai 自然月汇总已完成任务',
            '10,000 分钟边界命中成长阶梯，客户话费保持不变',
            '冻结、释放、实扣、超额与通话明细逐任务守恒核对',
            '账务差异会阻止封账，预览哈希变化会拒绝过期确认',
            '当前月份不能提前封账',
            '无任务月份无需供应阶梯且不会生成空月结单',
            '并发封账只生成一个不可变结算批次和一份审计记录',
            '任务详情封账前显示暂估值，封账后写入并显示最终成本、收益及批次关联',
            '重复封账幂等返回，封账后迟到任务触发来源漂移告警',
          ],
          totals: {
            taskCount: finalPreview.taskCount,
            billingMinutes: finalPreview.totalBillingMinutes,
            customerCharge: finalPreview.totalCustomerCharge,
            platformCost: finalPreview.totalPlatformCost,
            profit: finalPreview.totalProfit,
          },
        },
        null,
        2,
      ),
    );
  } finally {
    try {
      await cleanup(database.db, {
        studioId,
        settlementId,
        taskFixtures,
        inboxIds,
        auditRequestIds,
        orchestrationQueue,
        deliveryQueue,
        callbackProvider,
        supplierTierCodePrefix: `stage7b-${suffix.slice(0, 8)}`,
      });
    } finally {
      await database.close();
    }
  }
}

async function createIsolatedStudio(db: Database, suffix: string) {
  const [client] = await db
    .select({ id: integrationClients.id })
    .from(integrationClients)
    .where(eq(integrationClients.clientId, 'erp-local-01'))
    .limit(1);
  const [sourceBinding] = await db
    .select({ robotDefId: scriptBindings.robotDefId })
    .from(scriptBindings)
    .where(
      and(
        eq(scriptBindings.sourceSystem, 'ERP'),
        eq(scriptBindings.robotDefId, 'LOCAL-ROBOT-ERP-001'),
        eq(scriptBindings.status, 'ACTIVE'),
      ),
    )
    .limit(1);
  assert.ok(client && sourceBinding);
  const compactSuffix = suffix.replaceAll('-', '').slice(0, 12).toUpperCase();
  const businessCode = `S7B-${compactSuffix}`;
  const mcCode = `MC-S7B-${compactSuffix}`;
  const [studio] = await db
    .insert(studios)
    .values({
      businessCode,
      mcCode,
      name: `阶段七月结验收影楼 ${compactSuffix}`,
      status: 'ACTIVE',
      createdBy: 'stage7b-verifier',
      createdAt: TASK_CLOCK,
      updatedAt: TASK_CLOCK,
    })
    .returning({ id: studios.id });
  assert.ok(studio);
  await db.insert(studioAccounts).values({
    studioId: studio.id,
    balance: '10000.000000',
    status: 'ACTIVE',
    updatedAt: TASK_CLOCK,
  });
  await db.insert(studioPricingVersions).values({
    studioId: studio.id,
    version: 1,
    voiceRate: '0.480000',
    smsRate: '0.080000',
    frozenMinutes: 2,
    sourceMode: 'PER_STUDIO',
    status: 'ACTIVE',
    effectiveFrom: new Date('2001-01-01T00:00:00+08:00'),
    publishedBy: 'stage7b-verifier',
    publishedAt: TASK_CLOCK,
  });
  await db.insert(integrationEndpoints).values({
    studioId: studio.id,
    sourceSystem: 'ERP',
    version: 1,
    resultUrl: 'https://erp.stage7b.mock.invalid/outbound/result',
    recordingUrl: 'https://erp.stage7b.mock.invalid/outbound/recording',
    signingSecretRef: 'local-hkdf://callback:stage7b',
    status: 'ACTIVE',
    effectiveAt: new Date('2001-01-01T00:00:00+08:00'),
    createdBy: 'stage7b-verifier',
    createdAt: TASK_CLOCK,
  });
  await db.insert(integrationClientStudios).values({
    integrationClientId: client.id,
    studioId: studio.id,
    createdAt: TASK_CLOCK,
  });
  await db.insert(baiyingLineStudioBindings).values({
    userPhoneId: 'LOCAL-LINE-001',
    studioId: businessCode,
    studioName: `阶段七月结验收影楼 ${compactSuffix}`,
    updatedBy: 'stage7b-verifier',
    updatedAt: TASK_CLOCK,
  });
  const [binding] = await db
    .insert(scriptBindings)
    .values({
      robotDefId: sourceBinding.robotDefId,
      studioId: studio.id,
      sourceSystem: 'ERP',
      userPhoneId: 'LOCAL-LINE-001',
      status: 'ACTIVE',
      version: 1,
      createdBy: 'stage7b-verifier',
      createdAt: TASK_CLOCK,
    })
    .returning({ id: scriptBindings.id });
  assert.ok(binding);
  await db.insert(scriptCategoryBindings).values({
    scriptBindingId: binding.id,
    studioId: studio.id,
    sourceSystem: 'ERP',
    sourceCategoryId: 'LOCAL-ERP-WEDDING',
    categoryPath: '本地联调/ERP/婚礼邀约',
    active: true,
    createdAt: TASK_CLOCK,
  });
  const supplierTierCodePrefix = `stage7b-${suffix.slice(0, 8)}`;
  await db.insert(supplierPricingTiers).values([
    {
      tierCode: `${supplierTierCodePrefix}-basic`,
      name: '阶段 7B 基础阶梯',
      minMonthlyMinutes: 0n,
      maxMonthlyMinutes: 10_000n,
      voiceRate: '0.200000',
      smsRate: '0.080000',
      effectiveFrom: new Date('2001-01-01T00:00:00+08:00'),
      publishedBy: 'stage7b-verifier',
      publishedAt: TASK_CLOCK,
    },
    {
      tierCode: `${supplierTierCodePrefix}-growth`,
      name: '阶段 7B 成长阶梯',
      minMonthlyMinutes: 10_000n,
      maxMonthlyMinutes: 50_000n,
      voiceRate: '0.180000',
      smsRate: '0.070000',
      effectiveFrom: new Date('2001-01-01T00:00:00+08:00'),
      publishedBy: 'stage7b-verifier',
      publishedAt: TASK_CLOCK,
    },
    {
      tierCode: `${supplierTierCodePrefix}-scale`,
      name: '阶段 7B 规模阶梯',
      minMonthlyMinutes: 50_000n,
      maxMonthlyMinutes: null,
      voiceRate: '0.160000',
      smsRate: '0.060000',
      effectiveFrom: new Date('2001-01-01T00:00:00+08:00'),
      publishedBy: 'stage7b-verifier',
      publishedAt: TASK_CLOCK,
    },
  ]);
  return {
    studioId: studio.id,
    businessCode,
    mcCode,
    principal: {
      integrationClientId: client.id,
      clientId: 'erp-local-01',
      sourceSystem: 'ERP' as const,
    },
  };
}

function createRequest(
  mcCode: string,
  externalRequestId: string,
  phone: string,
): CreateOutboundTaskRequest {
  return {
    schemaVersion: '1.0',
    externalRequestId,
    sourceSystem: 'ERP',
    mcCode,
    taskName: `Stage 7B 月结验证 ${externalRequestId}`,
    customers: [
      {
        externalCustomerId: `${externalRequestId}-customer`,
        name: '月结验证客户',
        phone,
        dataCategoryId: 'LOCAL-ERP-WEDDING',
        fields: {
          salutation: '月结客户',
          appointment_date: '2001-01-31',
          consultant_name: '本地财务验证',
        },
      },
    ],
  };
}

function callCallback(task: TaskFixture, duration: number): string {
  return JSON.stringify({
    code: 200,
    data: {
      callbackType: 'CALL_INSTANCE_RESULT',
      data: {
        callInstance: {
          companyId: 'LOCAL-MOCK',
          callJobId: task.callJobId,
          callInstanceId: `CALL-${task.taskId}`,
          callInstanceStatus: 2,
          finishStatus: duration > 0 ? 0 : 8,
          calledTimes: 1,
          customerTelephone: task.phone,
          duration,
          properties: { sx_platform_item_id: task.itemId },
          endTime: '2001-01-31 22:50:00',
        },
        taskResult: [],
      },
    },
    resultMsg: '成功',
  });
}

function jobCallback(callJobId: string): string {
  return JSON.stringify({
    code: 200,
    data: {
      callbackType: 'JOB_INFO_RESULT',
      data: {
        companyId: 'LOCAL-MOCK',
        callJobId,
        callJobStatus: 2,
        updateTime: '2001-01-31 22:55:00',
      },
    },
    resultMsg: '成功',
  });
}

async function cleanup(
  db: Database,
  input: {
    studioId?: string;
    settlementId?: string;
    taskFixtures: TaskFixture[];
    inboxIds: string[];
    auditRequestIds: string[];
    orchestrationQueue: string;
    deliveryQueue: string;
    callbackProvider: string;
    supplierTierCodePrefix: string;
  },
) {
  await db.transaction(async (tx) => {
    const studioTaskIds = input.studioId
      ? (
          await tx
            .select({ id: platformTasks.id })
            .from(platformTasks)
            .where(eq(platformTasks.studioId, input.studioId))
        ).map((task) => task.id)
      : [];
    const taskIds = Array.from(
      new Set([
        ...input.taskFixtures.map((task) => task.taskId),
        ...studioTaskIds,
      ]),
    );
    const settlementIds = (
      await tx
        .select({ id: supplierMonthlySettlements.id })
        .from(supplierMonthlySettlements)
        .where(eq(supplierMonthlySettlements.settlementMonth, '2001-01-01'))
    ).map((settlement) => settlement.id);
    if (settlementIds.length) {
      await tx
        .delete(supplierSettlementTaskItems)
        .where(
          inArray(supplierSettlementTaskItems.settlementId, settlementIds),
        );
    }
    if (taskIds.length) {
      const callIds = (
        await tx
          .select({ id: callInstances.id })
          .from(callInstances)
          .where(inArray(callInstances.taskId, taskIds))
      ).map((call) => call.id);
      const deliveryIds = (
        await tx
          .select({ id: deliveryEvents.id })
          .from(deliveryEvents)
          .where(inArray(deliveryEvents.taskId, taskIds))
      ).map((event) => event.id);
      if (deliveryIds.length) {
        await tx
          .delete(deliveryEvents)
          .where(inArray(deliveryEvents.id, deliveryIds));
      }
      if (callIds.length) {
        await tx
          .delete(recordingAssets)
          .where(inArray(recordingAssets.callInstanceId, callIds));
      }
      await tx
        .delete(accountLedger)
        .where(inArray(accountLedger.taskId, taskIds));
      await tx
        .delete(callInstances)
        .where(inArray(callInstances.taskId, taskIds));
      await tx
        .delete(idempotencyRecords)
        .where(inArray(idempotencyRecords.taskId, taskIds));
      await tx
        .delete(taskOperations)
        .where(inArray(taskOperations.taskId, taskIds));
      await tx.delete(fundHolds).where(inArray(fundHolds.taskId, taskIds));
      await tx
        .delete(taskMappingSnapshots)
        .where(inArray(taskMappingSnapshots.taskId, taskIds));
      await tx
        .delete(taskCallItems)
        .where(inArray(taskCallItems.taskId, taskIds));
      await tx.delete(platformTasks).where(inArray(platformTasks.id, taskIds));
    }
    await tx
      .delete(queueOutbox)
      .where(
        inArray(queueOutbox.queueName, [
          input.orchestrationQueue,
          input.deliveryQueue,
        ]),
      );
    if (input.inboxIds.length) {
      await tx
        .delete(callbackInbox)
        .where(inArray(callbackInbox.id, input.inboxIds));
    }
    await tx
      .delete(callbackInbox)
      .where(eq(callbackInbox.provider, input.callbackProvider));
    if (settlementIds.length) {
      await tx
        .delete(auditLogs)
        .where(inArray(auditLogs.objectId, settlementIds));
      await tx
        .delete(supplierMonthlySettlements)
        .where(inArray(supplierMonthlySettlements.id, settlementIds));
    }
    if (input.auditRequestIds.length) {
      await tx
        .delete(auditLogs)
        .where(inArray(auditLogs.requestId, input.auditRequestIds));
    }
    if (input.studioId) {
      const [studio] = await tx
        .select({ businessCode: studios.businessCode })
        .from(studios)
        .where(eq(studios.id, input.studioId));
      await tx
        .delete(scriptCategoryBindings)
        .where(eq(scriptCategoryBindings.studioId, input.studioId));
      await tx
        .delete(scriptBindings)
        .where(eq(scriptBindings.studioId, input.studioId));
      if (studio) {
        await tx
          .delete(baiyingLineStudioBindings)
          .where(eq(baiyingLineStudioBindings.studioId, studio.businessCode));
      }
      await tx
        .delete(integrationClientStudios)
        .where(eq(integrationClientStudios.studioId, input.studioId));
      await tx
        .delete(integrationEndpoints)
        .where(eq(integrationEndpoints.studioId, input.studioId));
      await tx
        .delete(studioPricingVersions)
        .where(eq(studioPricingVersions.studioId, input.studioId));
      await tx
        .delete(studioAccounts)
        .where(eq(studioAccounts.studioId, input.studioId));
      await tx.delete(studios).where(eq(studios.id, input.studioId));
    }
    await tx
      .delete(supplierPricingTiers)
      .where(
        sql`${supplierPricingTiers.tierCode} LIKE ${`${input.supplierTierCodePrefix}%`}`,
      );
  });
}

function hasCode(code: string) {
  return (error: unknown) =>
    error instanceof Error &&
    'code' in error &&
    (error as Error & { code: string }).code === code;
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

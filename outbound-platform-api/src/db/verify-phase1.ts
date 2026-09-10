import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { PostgresAccountRepository } from '../billing/postgres-repository.js';
import { InsufficientBalanceError } from '../billing/repository.js';
import { PostgresConfigurationRepository } from '../configuration/postgres-repository.js';
import { readConfig } from '../config.js';
import { PostgresOutboxRepository } from '../outbox/postgres-repository.js';
import { PostgresScriptRepository } from '../script/postgres-repository.js';
import { createDatabase, type Database } from './client.js';
import {
  accountLedger,
  auditLogs,
  baiyingLineStudioBindings,
  baiyingPhoneLines,
  baiyingRobotBindings,
  deadLetterEvents,
  fundHolds,
  integrationClients,
  integrationClientStudios,
  integrationEndpoints,
  mappingVersions,
  platformTasks,
  queueOutbox,
  scriptBindings,
  scriptCategoryBindings,
  sourceDataCategories,
  studioAccounts,
  studioPricingVersions,
  studios,
} from './schema.js';

type Fixture = {
  studioId: string;
  integrationClientId: string;
  endpointVersionId: string;
  pricingVersionId: string;
  mappingVersionId: string;
  taskIds: [string, string];
  businessCode: string;
  mcCode: string;
  robotDefId: string;
  userPhoneId: string;
  sourceCategoryId: string;
  requestIds: [string, string];
  outboxId: string;
};

const config = readConfig();
if (config.NODE_ENV === 'production') {
  throw new Error('生产环境禁止执行阶段 1 验证夹具');
}
const database = createDatabase(config.DATABASE_URL);
const fixture = makeFixture();

try {
  await insertFixture(database.db, fixture);
  const accountRepository = new PostgresAccountRepository(database.db);
  const configurationRepository = new PostgresConfigurationRepository(
    database.db,
  );

  const attempts = await Promise.allSettled(
    fixture.taskIds.map((taskId) =>
      accountRepository.reserveFunds({
        studioId: fixture.studioId,
        taskId,
        amount: '80.000000',
        operatorId: 'phase1-verifier',
      }),
    ),
  );
  const successes = attempts.filter(
    (
      attempt,
    ): attempt is PromiseFulfilledResult<
      Awaited<ReturnType<typeof accountRepository.reserveFunds>>
    > => attempt.status === 'fulfilled',
  );
  const failures = attempts.filter(
    (attempt): attempt is PromiseRejectedResult =>
      attempt.status === 'rejected',
  );
  assert.equal(successes.length, 1, '并发冻结必须且只能有一个成功');
  assert.equal(failures.length, 1, '并发冻结必须且只能有一个失败');
  assert.ok(
    failures[0].reason instanceof InsufficientBalanceError,
    '失败请求必须因可用余额不足被拒绝',
  );

  const winningTaskId = successes[0].value.hold.taskId;
  const accountAfterHold = await accountRepository.getAccount(fixture.studioId);
  assert.deepEqual(
    accountAfterHold && {
      balance: accountAfterHold.balance,
      activeHoldAmount: accountAfterHold.activeHoldAmount,
      availableBalance: accountAfterHold.availableBalance,
      status: accountAfterHold.status,
    },
    {
      balance: '100.000000',
      activeHoldAmount: '80.000000',
      availableBalance: '20.000000',
      status: 'LOW_BALANCE',
    },
    '并发冻结后账户金额不正确',
  );

  const repeatedHold = await accountRepository.reserveFunds({
    studioId: fixture.studioId,
    taskId: winningTaskId,
    amount: '80.000000',
    operatorId: 'phase1-verifier',
  });
  assert.equal(
    repeatedHold.hold.id,
    successes[0].value.hold.id,
    '同一任务重试必须返回原冻结记录',
  );

  const firstRelease = await accountRepository.releaseHold({
    taskId: winningTaskId,
    operatorId: 'phase1-verifier',
    reason: '阶段 1 并发验证清理',
  });
  const repeatedRelease = await accountRepository.releaseHold({
    taskId: winningTaskId,
    operatorId: 'phase1-verifier',
    reason: '阶段 1 并发验证清理',
  });
  assert.equal(
    repeatedRelease.ledger.id,
    firstRelease.ledger.id,
    '重复释放必须返回原账本流水',
  );
  assert.equal(repeatedRelease.account.activeHoldAmount, '0.000000');
  assert.equal(repeatedRelease.account.availableBalance, '100.000000');

  const topUps = await Promise.all([
    accountRepository.topUp({
      studioId: fixture.studioId,
      amount: '50.000000',
      businessKey: `PHASE1_VERIFY_TOP_UP:${fixture.studioId}`,
      operatorId: 'phase1-verifier',
      reason: '阶段 1 充值幂等验证',
    }),
    accountRepository.topUp({
      studioId: fixture.studioId,
      amount: '50.000000',
      businessKey: `PHASE1_VERIFY_TOP_UP:${fixture.studioId}`,
      operatorId: 'phase1-verifier',
      reason: '阶段 1 充值幂等验证',
    }),
  ]);
  assert.equal(topUps[0].ledger.id, topUps[1].ledger.id);
  assert.equal(topUps[1].account.balance, '150.000000');

  await verifyConfigurationRead(configurationRepository, fixture);
  await verifyScriptDualWrite(database.db, fixture);
  await verifyOutboxClaimAndDeadLetter(database.db, fixture);

  const ledgers = await accountRepository.listLedger(fixture.studioId);
  assert.equal(ledgers.length, 3, '冻结、释放和充值应各产生一笔账本流水');

  console.info(
    JSON.stringify(
      {
        ok: true,
        checks: {
          concurrentReservations: '1 succeeded, 1 insufficient balance',
          holdIdempotency: 'passed',
          releaseIdempotency: 'passed',
          topUpIdempotency: 'passed',
          exactMoney: {
            balance: topUps[1].account.balance,
            activeHoldAmount: topUps[1].account.activeHoldAmount,
            availableBalance: topUps[1].account.availableBalance,
          },
          configurationRead: 'passed',
          scriptBindingDualWrite: 'passed',
          outboxSkipLockedAndDeadLetter: 'passed',
        },
      },
      null,
      2,
    ),
  );
} finally {
  try {
    await cleanFixture(database.db, fixture);
  } finally {
    await database.close();
  }
}

function makeFixture(): Fixture {
  const suffix = randomUUID().slice(0, 8);
  return {
    studioId: randomUUID(),
    integrationClientId: randomUUID(),
    endpointVersionId: randomUUID(),
    pricingVersionId: randomUUID(),
    mappingVersionId: randomUUID(),
    taskIds: [randomUUID(), randomUUID()],
    businessCode: `VERIFY-${suffix}`,
    mcCode: `MC-VERIFY-${suffix}`,
    robotDefId: `ROBOT-VERIFY-${suffix}`,
    userPhoneId: `LINE-VERIFY-${suffix}`,
    sourceCategoryId: `CATEGORY-VERIFY-${suffix}`,
    requestIds: [randomUUID(), randomUUID()],
    outboxId: randomUUID(),
  };
}

async function insertFixture(db: Database, fixture: Fixture): Promise<void> {
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.insert(studios).values({
      id: fixture.studioId,
      businessCode: fixture.businessCode,
      mcCode: fixture.mcCode,
      name: '阶段 1 验证影楼',
      status: 'ACTIVE',
      createdBy: 'phase1-verifier',
    });
    await tx.insert(studioAccounts).values({
      studioId: fixture.studioId,
      balance: '100.000000',
      status: 'LOW_BALANCE',
    });
    await tx.insert(integrationClients).values({
      id: fixture.integrationClientId,
      clientId: `client-${fixture.businessCode}`,
      sourceSystem: 'ERP',
      displayName: '阶段 1 验证客户端',
      accessToken: `verify-token-${fixture.businessCode}`,
      secretRef: 'kms://phase1-verifier/not-a-secret',
      createdBy: 'phase1-verifier',
    });
    await tx.insert(integrationClientStudios).values({
      integrationClientId: fixture.integrationClientId,
      studioId: fixture.studioId,
    });
    await tx.insert(integrationEndpoints).values({
      id: fixture.endpointVersionId,
      studioId: fixture.studioId,
      sourceSystem: 'ERP',
      version: 1,
      resultUrl: 'https://phase1.invalid/result',
      recordingUrl: 'https://phase1.invalid/recording',
      status: 'DRAFT',
      createdBy: 'phase1-verifier',
    });
    await tx.insert(studioPricingVersions).values({
      id: fixture.pricingVersionId,
      studioId: fixture.studioId,
      version: 1,
      voiceRate: '0.500000',
      smsRate: '0.080000',
      frozenMinutes: 2,
      sourceMode: 'PER_STUDIO',
      status: 'ACTIVE',
      effectiveFrom: new Date(now.getTime() - 60_000),
      publishedBy: 'phase1-verifier',
    });
    await tx.insert(mappingVersions).values({
      id: fixture.mappingVersionId,
      version: randomInt(1_000_000_000, 2_000_000_000),
      publisherId: 'phase1-verifier',
      changeSummary: '阶段 1 数据底座验证夹具',
    });
    await tx.insert(baiyingPhoneLines).values({
      userPhoneId: fixture.userPhoneId,
      phone: '阶段 1 验证线路',
      phoneName: '阶段 1 验证线路',
      phoneType: 9,
      sceneType: 1,
      rateType: 0,
      localSellingRate: 0,
      nonlocalSellingRate: 0,
      lineAmount: 2,
      billPeriod: 60,
    });
    await tx.insert(baiyingLineStudioBindings).values({
      userPhoneId: fixture.userPhoneId,
      studioId: fixture.businessCode,
      studioName: '阶段 1 验证影楼',
      updatedBy: 'phase1-verifier',
    });
    await tx.insert(sourceDataCategories).values({
      sourceSystem: 'ERP',
      externalId: fixture.sourceCategoryId,
      name: '阶段 1 验证分类',
      categoryPath: '验证/阶段 1',
      active: true,
    });
    await tx.insert(platformTasks).values(
      fixture.taskIds.map((taskId, index) => ({
        id: taskId,
        taskNo: `P1V-${fixture.businessCode}-${index + 1}`,
        externalRequestId: `P1V-REQUEST-${index + 1}`,
        sourceSystem: 'ERP',
        integrationClientId: fixture.integrationClientId,
        studioId: fixture.studioId,
        studioNameSnapshot: '阶段 1 验证影楼',
        mcCodeSnapshot: fixture.mcCode,
        taskName: `阶段 1 并发冻结验证 ${index + 1}`,
        phoneCount: 80,
        categorySnapshot: [
          { id: fixture.sourceCategoryId, path: '验证/阶段 1' },
        ],
        robotDefId: fixture.robotDefId,
        robotName: '阶段 1 验证话术',
        userPhoneId: fixture.userPhoneId,
        lineName: '阶段 1 验证线路',
        mappingVersionId: fixture.mappingVersionId,
        pricingVersionId: fixture.pricingVersionId,
        endpointVersionId: fixture.endpointVersionId,
        endpointSnapshot: {
          resultUrl: 'https://phase1.invalid/result',
          recordingUrl: 'https://phase1.invalid/recording',
          signingSecretRef: 'kms://phase1-verifier/not-a-secret',
        },
        customerRate: '0.500000',
        frozenMinutes: 2,
        reservedAmount: '80.000000',
        baiyingCompanyId: 'PHASE1-VERIFY',
      })),
    );
  });
}

async function verifyConfigurationRead(
  repository: PostgresConfigurationRepository,
  fixture: Fixture,
): Promise<void> {
  const studio = await repository.findStudioByMcCode(fixture.mcCode);
  assert.equal(studio?.businessCode, fixture.businessCode);
  assert.equal(studio?.account?.balance, '150.000000');
  assert.equal(studio?.pricingVersions[0]?.voiceRate, '0.500000');
  assert.equal(
    studio?.endpoints[0]?.resultUrl,
    'https://phase1.invalid/result',
  );
  const currentPricing = await repository.findCurrentPricing(fixture.studioId);
  assert.equal(currentPricing?.id, fixture.pricingVersionId);
}

async function verifyScriptDualWrite(
  db: Database,
  fixture: Fixture,
): Promise<void> {
  const repository = new PostgresScriptRepository(db);
  const input = {
    robotDefId: fixture.robotDefId,
    sourceSystem: 'ERP' as const,
    categories: [
      {
        sourceCategoryId: fixture.sourceCategoryId,
        categoryPath: '客户端提交的非权威路径',
      },
    ],
    studioId: fixture.businessCode,
    studioName: '客户端提交的非权威影楼名',
    lineId: fixture.userPhoneId,
    lineName: '客户端提交的非权威线路名',
  };
  await repository.saveBinding(input, 'phase1-verifier', fixture.requestIds[0]);
  const second = await repository.saveBinding(
    input,
    'phase1-verifier',
    fixture.requestIds[1],
  );
  assert.equal(second.studioName, '阶段 1 验证影楼');
  assert.equal(second.lineName, '阶段 1 验证线路');
  assert.equal(second.categories[0].categoryPath, '验证/阶段 1');

  const normalized = await db
    .select()
    .from(scriptBindings)
    .where(eq(scriptBindings.robotDefId, fixture.robotDefId));
  assert.equal(normalized.length, 2, '重复保存应生成两个不可变版本');
  assert.equal(
    normalized.filter((binding) => binding.status === 'ACTIVE').length,
    1,
    '只能存在一个生效话术绑定版本',
  );
  const categories = await db
    .select()
    .from(scriptCategoryBindings)
    .where(eq(scriptCategoryBindings.studioId, fixture.studioId));
  assert.equal(categories.filter((category) => category.active).length, 1);
  assert.equal(categories.filter((category) => !category.active).length, 1);
}

async function verifyOutboxClaimAndDeadLetter(
  db: Database,
  fixture: Fixture,
): Promise<void> {
  await db.insert(queueOutbox).values({
    id: fixture.outboxId,
    eventType: 'PHASE1_VERIFY',
    queueName: 'phase1-verify',
    payload: { fixture: fixture.businessCode },
  });
  const repository = new PostgresOutboxRepository(db);
  const workers = ['phase1-worker-a', 'phase1-worker-b'] as const;
  const claims = await Promise.all(
    workers.map((workerId) =>
      repository.claimNext({
        queueName: 'phase1-verify',
        eventType: 'PHASE1_VERIFY',
        workerId,
      }),
    ),
  );
  const claimedIndex = claims.findIndex((event) => event !== null);
  assert.notEqual(claimedIndex, -1, 'Outbox 事件必须能被 worker 领取');
  assert.equal(
    claims.filter((event) => event !== null).length,
    1,
    '同一 Outbox 事件只能被一个 worker 领取',
  );
  const claimedEvent = claims[claimedIndex];
  const claimedWorkerId = workers[claimedIndex];
  assert.ok(claimedEvent);
  assert.ok(claimedWorkerId);
  assert.equal(claimedEvent.attempts, 1);

  const retry = await repository.fail({
    eventId: fixture.outboxId,
    workerId: claimedWorkerId,
    error: '阶段 1 可重试验证错误',
    retryDelayMs: 0,
    maxAttempts: 2,
  });
  assert.equal(retry.status, 'RETRY_SCHEDULED');

  const secondClaim = await repository.claimNext({
    queueName: 'phase1-verify',
    eventType: 'PHASE1_VERIFY',
    workerId: claimedWorkerId,
  });
  assert.equal(secondClaim?.id, fixture.outboxId);
  assert.equal(secondClaim?.attempts, 2);
  const deadLettered = await repository.fail({
    eventId: fixture.outboxId,
    workerId: claimedWorkerId,
    error: '阶段 1 最终验证错误',
    retryDelayMs: 0,
    maxAttempts: 2,
  });
  assert.equal(deadLettered.status, 'DEAD_LETTERED');
  const [deadLetter] = await db
    .select()
    .from(deadLetterEvents)
    .where(
      and(
        eq(deadLetterEvents.sourceType, 'OUTBOX'),
        eq(deadLetterEvents.sourceId, fixture.outboxId),
      ),
    );
  assert.equal(deadLetter?.status, 'OPEN');
  assert.equal(
    await repository.claimNext({
      queueName: 'phase1-verify',
      eventType: 'PHASE1_VERIFY',
      workerId: 'phase1-worker-after-dead-letter',
    }),
    null,
    '进入死信的事件不能继续被普通 worker 领取',
  );
}

async function cleanFixture(db: Database, fixture: Fixture): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(deadLetterEvents)
      .where(eq(deadLetterEvents.sourceId, fixture.outboxId));
    await tx.delete(queueOutbox).where(eq(queueOutbox.id, fixture.outboxId));
    await tx
      .delete(accountLedger)
      .where(eq(accountLedger.studioId, fixture.studioId));
    await tx.delete(fundHolds).where(eq(fundHolds.studioId, fixture.studioId));
    await tx
      .delete(platformTasks)
      .where(inArray(platformTasks.id, fixture.taskIds));
    await tx
      .delete(scriptCategoryBindings)
      .where(eq(scriptCategoryBindings.studioId, fixture.studioId));
    await tx
      .delete(scriptBindings)
      .where(eq(scriptBindings.studioId, fixture.studioId));
    await tx
      .delete(baiyingRobotBindings)
      .where(eq(baiyingRobotBindings.robotDefId, fixture.robotDefId));
    await tx
      .delete(auditLogs)
      .where(inArray(auditLogs.requestId, fixture.requestIds));
    await tx
      .delete(baiyingLineStudioBindings)
      .where(
        and(
          eq(baiyingLineStudioBindings.userPhoneId, fixture.userPhoneId),
          eq(baiyingLineStudioBindings.studioId, fixture.businessCode),
        ),
      );
    await tx
      .delete(sourceDataCategories)
      .where(
        and(
          eq(sourceDataCategories.sourceSystem, 'ERP'),
          eq(sourceDataCategories.externalId, fixture.sourceCategoryId),
        ),
      );
    await tx
      .delete(baiyingPhoneLines)
      .where(eq(baiyingPhoneLines.userPhoneId, fixture.userPhoneId));
    await tx
      .delete(integrationClientStudios)
      .where(
        eq(
          integrationClientStudios.integrationClientId,
          fixture.integrationClientId,
        ),
      );
    await tx
      .delete(studioAccounts)
      .where(eq(studioAccounts.studioId, fixture.studioId));
    await tx
      .delete(studioPricingVersions)
      .where(eq(studioPricingVersions.studioId, fixture.studioId));
    await tx
      .delete(integrationEndpoints)
      .where(eq(integrationEndpoints.studioId, fixture.studioId));
    await tx
      .delete(integrationClients)
      .where(eq(integrationClients.id, fixture.integrationClientId));
    await tx.delete(studios).where(eq(studios.id, fixture.studioId));
    await tx
      .delete(mappingVersions)
      .where(eq(mappingVersions.id, fixture.mappingVersionId));
  });
}

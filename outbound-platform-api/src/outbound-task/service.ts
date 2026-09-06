import { randomUUID } from 'node:crypto';
import { and, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import {
  taskAcceptedEnvelopeSchema,
  type CreateOutboundTaskRequest,
  type MappingRule,
  type OutboundCallPage,
  type TaskAcceptedEnvelope,
  type TaskDetail,
  type TaskDisplayStatus,
  type TaskExecutionStatus,
} from '@outbound/contracts';
import {
  addMoney,
  moneyToMicros,
  multiplyMoneyByInteger,
  negateMoney,
  normalizeMoney,
  subtractMoney,
} from '../billing/money.js';
import type { Database } from '../db/client.js';
import {
  accountLedger,
  baiyingLineStudioBindings,
  baiyingPhoneLines,
  baiyingSceneCompanies,
  baiyingScenes,
  fundHolds,
  idempotencyRecords,
  integrationClientStudios,
  integrationEndpoints,
  mappingRules,
  mappingVersions,
  platformTasks,
  queueOutbox,
  sceneMappingReadiness,
  scriptBindings,
  scriptCategoryBindings,
  sourceDataCategories,
  studioAccounts,
  studioPricingVersions,
  studios,
  taskCallItems,
  taskMappingSnapshots,
} from '../db/schema.js';
import {
  resolveSourceField,
  transformMappedValue,
} from '../mapping/transform.js';
import type { DataProtector } from '../security/data-protector.js';
import { ExternalApiFailure } from '../openapi/errors.js';
import type { ExternalPrincipal } from '../openapi/authenticator.js';

export type AcceptTaskInput = {
  principal: ExternalPrincipal;
  idempotencyKey: string;
  requestId: string;
  requestHash: string;
  request: CreateOutboundTaskRequest;
};

export type AcceptedTaskResult = {
  status: 202;
  body: TaskAcceptedEnvelope;
  replayed: boolean;
};

export interface OutboundTaskService {
  accept(input: AcceptTaskInput): Promise<AcceptedTaskResult>;
  getTask(principal: ExternalPrincipal, taskNo: string): Promise<TaskDetail>;
  listCalls(
    principal: ExternalPrincipal,
    taskNo: string,
    input: { cursor?: string; limit: number },
  ): Promise<OutboundCallPage>;
}

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type AccountStatus = 'ACTIVE' | 'LOW_BALANCE' | 'OVERDUE' | 'DISABLED';
type LockedAccount = {
  studioId: string;
  currency: string;
  balance: string;
  activeHoldAmount: string;
  status: AccountStatus;
};

export class PostgresOutboundTaskService implements OutboundTaskService {
  constructor(
    private readonly db: Database,
    private readonly protector: DataProtector,
    private readonly options: {
      baiyingCompanyId: string;
      queueName?: string;
      lowBalanceThreshold?: string;
      clock?: () => Date;
      createId?: () => string;
    },
  ) {}

  async accept(input: AcceptTaskInput): Promise<AcceptedTaskResult> {
    if (input.request.sourceSystem !== input.principal.sourceSystem) {
      throw new ExternalApiFailure(
        'AUTHENTICATION_FAILED',
        '请求来源与客户端凭证不一致',
        403,
      );
    }
    const now = this.clock();
    return this.db.transaction(async (tx) => {
      await advisoryLock(
        tx,
        `idempotency:${input.principal.clientId}:${input.idempotencyKey}`,
      );
      const [stored] = await tx
        .select()
        .from(idempotencyRecords)
        .where(
          and(
            eq(idempotencyRecords.sourceSystem, input.principal.sourceSystem),
            eq(idempotencyRecords.clientId, input.principal.clientId),
            eq(idempotencyRecords.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      if (stored && stored.expiresAt > now) {
        if (stored.requestBodySha256 !== input.requestHash) {
          throw new ExternalApiFailure(
            'IDEMPOTENCY_CONFLICT',
            '同一 Idempotency-Key 对应了不同业务报文',
            409,
          );
        }
        const body = taskAcceptedEnvelopeSchema.safeParse(stored.responseBody);
        if (!body.success || stored.responseStatus !== 202) {
          throw new ExternalApiFailure(
            'SERVICE_TEMPORARILY_UNAVAILABLE',
            '历史幂等响应不可用',
            503,
          );
        }
        return { status: 202, body: body.data, replayed: true };
      }
      if (stored) {
        await tx
          .delete(idempotencyRecords)
          .where(
            and(
              eq(idempotencyRecords.sourceSystem, input.principal.sourceSystem),
              eq(idempotencyRecords.clientId, input.principal.clientId),
              eq(idempotencyRecords.idempotencyKey, input.idempotencyKey),
            ),
          );
      }

      await advisoryLock(
        tx,
        `external-request:${input.principal.integrationClientId}:${input.request.externalRequestId}`,
      );
      const [sameExternalRequest] = await tx
        .select({ taskNo: platformTasks.taskNo })
        .from(platformTasks)
        .where(
          and(
            eq(
              platformTasks.integrationClientId,
              input.principal.integrationClientId,
            ),
            eq(
              platformTasks.externalRequestId,
              input.request.externalRequestId,
            ),
          ),
        )
        .limit(1);
      if (sameExternalRequest) {
        throw new ExternalApiFailure(
          'IDEMPOTENCY_CONFLICT',
          'externalRequestId 已对应其他任务，请使用原幂等键重试',
          409,
          { taskNo: sameExternalRequest.taskNo },
        );
      }

      const configuration = await this.precheck(tx, input, now);
      const reservedAmount = multiplyMoneyByInteger(
        configuration.price.voiceRate,
        input.request.customers.length * configuration.price.frozenMinutes,
      );
      if (moneyToMicros(reservedAmount) <= 0n) {
        throw new ExternalApiFailure(
          'PRICING_NOT_CONFIGURED',
          '当前价格计算出的冻结金额无效',
          422,
        );
      }
      const account = await lockAccount(tx, configuration.studio.id);
      if (account.status === 'DISABLED' || account.status === 'OVERDUE') {
        throw new ExternalApiFailure(
          'INSUFFICIENT_BALANCE',
          `影楼账户状态 ${account.status} 不允许创建任务`,
          409,
        );
      }
      const available = subtractMoney(
        account.balance,
        account.activeHoldAmount,
      );
      if (moneyToMicros(available) < moneyToMicros(reservedAmount)) {
        throw new ExternalApiFailure(
          'INSUFFICIENT_BALANCE',
          '影楼可用余额不足',
          409,
          { availableBalance: normalizeMoney(available), reservedAmount },
        );
      }

      const taskId = this.createId();
      const taskNo = await nextTaskNo(tx, now);
      const activeHoldAmount = addMoney(
        account.activeHoldAmount,
        reservedAmount,
      );
      const availableAfter = subtractMoney(account.balance, activeHoldAmount);
      const categorySnapshot = configuration.categories.map((category) => ({
        id: category.externalId,
        path: category.categoryPath,
      }));

      await tx.insert(platformTasks).values({
        id: taskId,
        taskNo,
        externalRequestId: input.request.externalRequestId,
        sourceSystem: input.request.sourceSystem,
        integrationClientId: input.principal.integrationClientId,
        studioId: configuration.studio.id,
        studioNameSnapshot: configuration.studio.name,
        mcCodeSnapshot: configuration.studio.mcCode,
        taskName: input.request.taskName,
        phoneCount: input.request.customers.length,
        categorySnapshot,
        robotDefId: configuration.binding.robotDefId,
        robotName: configuration.scene.sceneName,
        userPhoneId: configuration.binding.userPhoneId,
        lineName: configuration.line.phoneName || configuration.line.phone,
        mappingVersionId: configuration.mappingVersion.id,
        pricingVersionId: configuration.price.id,
        endpointVersionId: configuration.endpoint.id,
        endpointSnapshot: {
          resultUrl: configuration.endpoint.resultUrl,
          recordingUrl: configuration.endpoint.recordingUrl,
          signingSecretRef: configuration.endpoint.signingSecretRef!,
        },
        customerRate: normalizeMoney(configuration.price.voiceRate),
        frozenMinutes: configuration.price.frozenMinutes,
        reservedAmount,
        baiyingCompanyId: configuration.sceneCompanyId,
        importRequestedCount: input.request.customers.length,
        createdAt: now,
        acceptedAt: now,
        updatedAt: now,
      });

      const callItems = input.request.customers.map((customer, index) => {
        const phone = normalizePhone(customer.phone);
        return {
          id: this.createId(),
          taskId,
          ordinal: index + 1,
          externalCustomerId: customer.externalCustomerId,
          dataCategoryId: customer.dataCategoryId,
          categoryPath: configuration.categoryById.get(customer.dataCategoryId)!
            .categoryPath,
          phoneCiphertext: this.protector.encryptUtf8(phone),
          phoneHmac: this.protector.phoneHmac(phone),
          phoneTail4: phone.slice(-4),
          customerNameCiphertext: customer.name
            ? this.protector.encryptUtf8(customer.name)
            : null,
          sourceFieldsCiphertext: this.protector.encryptUtf8(
            JSON.stringify(customer.fields),
          ),
          mappedPropertiesCiphertext: this.protector.encryptUtf8(
            JSON.stringify(configuration.mappedProperties[index]),
          ),
          createdAt: now,
          updatedAt: now,
        };
      });
      for (let offset = 0; offset < callItems.length; offset += 500) {
        await tx
          .insert(taskCallItems)
          .values(callItems.slice(offset, offset + 500));
      }

      await tx.insert(taskMappingSnapshots).values({
        taskId,
        mappingVersionId: configuration.mappingVersion.id,
        variables: configuration.scene.variables,
        mappingRules: configuration.rules,
        createdAt: now,
      });
      await tx.insert(fundHolds).values({
        id: this.createId(),
        studioId: configuration.studio.id,
        taskId,
        originalAmount: reservedAmount,
        remainingAmount: reservedAmount,
        createdAt: now,
      });
      await tx.insert(accountLedger).values({
        id: this.createId(),
        studioId: configuration.studio.id,
        taskId,
        entryType: 'TASK_HOLD',
        amount: negateMoney(reservedAmount),
        balanceAfter: normalizeMoney(account.balance),
        availableBalanceAfter: availableAfter,
        businessKey: `TASK_HOLD:${taskId}`,
        operatorId: input.principal.clientId,
        reason: '创建外呼任务冻结余额',
        occurredAt: now,
      });
      await tx
        .update(studioAccounts)
        .set({
          activeHoldAmount,
          status: accountStatusAfter(
            account.balance,
            availableAfter,
            account.status,
            this.options.lowBalanceThreshold ?? '500.000000',
          ),
          lockVersion: sql`${studioAccounts.lockVersion} + 1`,
          updatedAt: now,
        })
        .where(eq(studioAccounts.studioId, configuration.studio.id));

      await tx.insert(queueOutbox).values({
        id: this.createId(),
        eventType: 'TASK_ACCEPTED',
        queueName: this.options.queueName ?? 'task-orchestration-queue',
        payload: {
          schemaVersion: '1.0',
          taskId,
          taskNo,
          sourceSystem: input.request.sourceSystem,
        },
        availableAt: now,
        createdAt: now,
      });

      const body: TaskAcceptedEnvelope = {
        code: 'TASK_ACCEPTED',
        message: '外呼任务已受理',
        requestId: input.requestId,
        data: {
          taskId,
          taskNo,
          executionStatus: 'ACCEPTED',
          displayStatus: '执行中',
          phoneCount: input.request.customers.length,
          reservedAmount,
          currency: 'CNY',
          statusUrl: `/openapi/v1/outbound/tasks/${taskNo}`,
        },
      };
      taskAcceptedEnvelopeSchema.parse(body);
      await tx.insert(idempotencyRecords).values({
        sourceSystem: input.principal.sourceSystem,
        clientId: input.principal.clientId,
        idempotencyKey: input.idempotencyKey,
        requestId: input.requestId,
        requestBodySha256: input.requestHash,
        taskId,
        processingStatus: 'COMPLETED',
        responseStatus: 202,
        responseBody: body,
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      });
      return { status: 202, body, replayed: false };
    });
  }

  async getTask(
    principal: ExternalPrincipal,
    taskNo: string,
  ): Promise<TaskDetail> {
    const [row] = await this.db
      .select({
        task: platformTasks,
        studioBusinessCode: studios.businessCode,
        mappingVersion: mappingVersions.version,
        accountBalance: studioAccounts.balance,
        accountHold: studioAccounts.activeHoldAmount,
      })
      .from(platformTasks)
      .innerJoin(studios, eq(studios.id, platformTasks.studioId))
      .innerJoin(
        mappingVersions,
        eq(mappingVersions.id, platformTasks.mappingVersionId),
      )
      .innerJoin(
        studioAccounts,
        eq(studioAccounts.studioId, platformTasks.studioId),
      )
      .where(
        and(
          eq(platformTasks.taskNo, taskNo),
          eq(platformTasks.integrationClientId, principal.integrationClientId),
        ),
      )
      .limit(1);
    if (!row) {
      throw new ExternalApiFailure('TASK_NOT_FOUND', '任务不存在', 404);
    }
    const [snapshot] = await this.db
      .select({ variables: taskMappingSnapshots.variables })
      .from(taskMappingSnapshots)
      .where(eq(taskMappingSnapshots.taskId, row.task.id))
      .limit(1);
    const task = row.task;
    const platformRateStatus = task.platformRate
      ? task.billingStatus === 'SETTLED'
        ? 'FINAL'
        : 'PROVISIONAL'
      : 'NOT_AVAILABLE';
    return {
      taskId: task.id,
      taskNo: task.taskNo,
      externalRequestId: task.externalRequestId,
      sourceSystem: principal.sourceSystem,
      mcCode: task.mcCodeSnapshot,
      studioId: row.studioBusinessCode,
      studioName: task.studioNameSnapshot,
      taskName: task.taskName,
      phoneCount: task.phoneCount,
      dataCategories: task.categorySnapshot,
      script: { robotDefId: task.robotDefId, name: task.robotName },
      line: { userPhoneId: task.userPhoneId, name: task.lineName },
      mapping: {
        version: row.mappingVersion,
        variableCount: snapshot?.variables.length ?? 0,
      },
      baiyingCallJobId: task.baiyingCallJobId,
      statuses: {
        execution: task.executionStatus,
        display: displayStatusFor(task.executionStatus),
        resultDelivery: task.resultDeliveryStatus,
        recordingArchive: task.recordingArchiveStatus,
        recordingDelivery: task.recordingDeliveryStatus,
        billing: task.billingStatus,
      },
      importSummary: {
        requested: task.importRequestedCount,
        succeeded: task.importSucceededCount,
        failed: task.importFailedCount,
        repeated: task.importRepeatedCount,
      },
      counts: {
        imported: task.importSucceededCount,
        callInstances: task.callInstanceCount,
        recordingsDiscovered: task.recordingDiscoveredCount,
        recordingsArchived: task.recordingArchivedCount,
        recordingsDelivered: task.recordingDeliveredCount,
      },
      durations: {
        totalSeconds: task.totalDurationSeconds,
        billingMinutes: task.billingMinutes,
      },
      billing: {
        currency: 'CNY',
        customerRate: normalizeMoney(task.customerRate),
        frozenMinutes: task.frozenMinutes,
        reservedAmount: normalizeMoney(task.reservedAmount),
        customerCharge: normalizeMoney(task.customerCharge),
        platformRate: task.platformRate
          ? normalizeMoney(task.platformRate)
          : null,
        platformRateStatus,
        platformCost: task.platformCost
          ? normalizeMoney(task.platformCost)
          : null,
        profit: task.profit ? normalizeMoney(task.profit) : null,
        studioBalance: normalizeMoney(row.accountBalance),
        availableBalance: subtractMoney(row.accountBalance, row.accountHold),
        status: task.billingStatus,
      },
      failure: task.failureCode
        ? {
            stage: failureStage(task.failureStage),
            code: task.failureCode,
            message: task.failureMessage ?? '任务执行失败',
            retryable: task.failureRetryable ?? false,
            occurredAt: (task.lastRetryAt ?? task.updatedAt).toISOString(),
          }
        : null,
      timestamps: {
        createdAt: task.createdAt.toISOString(),
        acceptedAt: task.acceptedAt.toISOString(),
        startedAt: task.startedAt?.toISOString() ?? null,
        providerCompletedAt: task.providerCompletedAt?.toISOString() ?? null,
        reconciledAt: task.reconciledAt?.toISOString() ?? null,
        closedAt: task.closedAt?.toISOString() ?? null,
      },
    };
  }

  async listCalls(
    principal: ExternalPrincipal,
    taskNo: string,
    _input: { cursor?: string; limit: number },
  ): Promise<OutboundCallPage> {
    await this.getTask(principal, taskNo);
    // Stage 2A has no provider call instances yet. Stage 4 replaces this empty
    // page with the call/recording/delivery joins while preserving the contract.
    return { items: [], nextCursor: null };
  }

  private async precheck(tx: Transaction, input: AcceptTaskInput, now: Date) {
    const [studio] = await tx
      .select()
      .from(studios)
      .where(eq(studios.mcCode, input.request.mcCode))
      .limit(1);
    if (!studio) {
      throw new ExternalApiFailure(
        'STUDIO_NOT_FOUND',
        'MC code 未匹配到影楼',
        404,
      );
    }
    if (studio.status !== 'ACTIVE') {
      throw new ExternalApiFailure('STUDIO_DISABLED', '影楼已停用', 422);
    }
    const [authorization] = await tx
      .select({ studioId: integrationClientStudios.studioId })
      .from(integrationClientStudios)
      .where(
        and(
          eq(
            integrationClientStudios.integrationClientId,
            input.principal.integrationClientId,
          ),
          eq(integrationClientStudios.studioId, studio.id),
        ),
      )
      .limit(1);
    if (!authorization) {
      throw new ExternalApiFailure(
        'AUTHENTICATION_FAILED',
        '客户端无权访问该影楼',
        403,
      );
    }

    const [endpoint] = await tx
      .select()
      .from(integrationEndpoints)
      .where(
        and(
          eq(integrationEndpoints.studioId, studio.id),
          eq(integrationEndpoints.sourceSystem, input.request.sourceSystem),
          eq(integrationEndpoints.status, 'ACTIVE'),
          or(
            isNull(integrationEndpoints.effectiveAt),
            lte(integrationEndpoints.effectiveAt, now),
          ),
        ),
      )
      .limit(1);
    if (!endpoint?.signingSecretRef) {
      throw new ExternalApiFailure(
        'CALLBACK_CONFIG_MISSING',
        '结果或录音回调配置尚未启用',
        422,
      );
    }
    const [price] = await tx
      .select()
      .from(studioPricingVersions)
      .where(
        and(
          eq(studioPricingVersions.studioId, studio.id),
          eq(studioPricingVersions.status, 'ACTIVE'),
          lte(studioPricingVersions.effectiveFrom, now),
          or(
            isNull(studioPricingVersions.effectiveTo),
            gt(studioPricingVersions.effectiveTo, now),
          ),
        ),
      )
      .limit(1);
    if (!price) {
      throw new ExternalApiFailure(
        'PRICING_NOT_CONFIGURED',
        '影楼当前没有生效价格',
        422,
      );
    }

    const categoryIds = Array.from(
      new Set(
        input.request.customers.map((customer) => customer.dataCategoryId),
      ),
    );
    const categories = await tx
      .select()
      .from(sourceDataCategories)
      .where(
        and(
          eq(sourceDataCategories.sourceSystem, input.request.sourceSystem),
          eq(sourceDataCategories.active, true),
          inArray(sourceDataCategories.externalId, categoryIds),
        ),
      );
    const categoryById = new Map(
      categories.map((item) => [item.externalId, item]),
    );
    const missingCategories = categoryIds.filter((id) => !categoryById.has(id));
    if (missingCategories.length) {
      throw new ExternalApiFailure(
        'DATA_CATEGORY_NOT_FOUND',
        '至少一个数据分类不存在或已停用',
        422,
        { categoryIds: missingCategories },
      );
    }

    const bindingRows = await tx
      .select({
        binding: scriptBindings,
        categoryId: scriptCategoryBindings.sourceCategoryId,
      })
      .from(scriptBindings)
      .innerJoin(
        scriptCategoryBindings,
        eq(scriptCategoryBindings.scriptBindingId, scriptBindings.id),
      )
      .where(
        and(
          eq(scriptBindings.studioId, studio.id),
          eq(scriptBindings.sourceSystem, input.request.sourceSystem),
          eq(scriptBindings.status, 'ACTIVE'),
          eq(scriptCategoryBindings.active, true),
          inArray(scriptCategoryBindings.sourceCategoryId, categoryIds),
        ),
      );
    const boundCategoryIds = new Set(bindingRows.map((row) => row.categoryId));
    const unbound = categoryIds.filter((id) => !boundCategoryIds.has(id));
    if (unbound.length) {
      throw new ExternalApiFailure(
        'DATA_CATEGORY_SCRIPT_UNBOUND',
        '至少一个数据分类未绑定话术',
        422,
        { categoryIds: unbound },
      );
    }
    const lineIds = new Set(bindingRows.map((row) => row.binding.userPhoneId));
    if (lineIds.size !== 1) {
      throw new ExternalApiFailure(
        'DATA_CATEGORY_LINE_CONFLICT',
        '所选分类绑定了不同线路',
        422,
      );
    }
    const robotIds = new Set(bindingRows.map((row) => row.binding.robotDefId));
    if (robotIds.size !== 1) {
      throw new ExternalApiFailure(
        'DATA_CATEGORY_SCRIPT_CONFLICT',
        '所选分类绑定了不同话术',
        422,
      );
    }
    const binding = bindingRows[0]!.binding;
    const [line] = await tx
      .select()
      .from(baiyingPhoneLines)
      .where(eq(baiyingPhoneLines.userPhoneId, binding.userPhoneId))
      .limit(1);
    const [lineStudio] = await tx
      .select({ lineId: baiyingLineStudioBindings.userPhoneId })
      .from(baiyingLineStudioBindings)
      .where(
        and(
          eq(baiyingLineStudioBindings.userPhoneId, binding.userPhoneId),
          eq(baiyingLineStudioBindings.studioId, studio.businessCode),
        ),
      )
      .limit(1);
    if (!line || !lineStudio) {
      throw new ExternalApiFailure(
        'LINE_NOT_AVAILABLE',
        '话术线路不存在或未绑定当前影楼',
        422,
      );
    }

    const sceneRows = await tx
      .select({
        sceneDefId: baiyingScenes.sceneDefId,
        sceneName: baiyingScenes.sceneName,
        variables: sceneMappingReadiness.variables,
        mappingVersionId: sceneMappingReadiness.publishedMappingVersionId,
        mappingVersion: mappingVersions.version,
      })
      .from(baiyingScenes)
      .innerJoin(
        sceneMappingReadiness,
        eq(sceneMappingReadiness.sceneDefId, baiyingScenes.sceneDefId),
      )
      .innerJoin(
        mappingVersions,
        eq(mappingVersions.id, sceneMappingReadiness.publishedMappingVersionId),
      )
      .where(
        and(
          eq(baiyingScenes.robotDefId, binding.robotDefId),
          eq(baiyingScenes.disabled, false),
          eq(sceneMappingReadiness.status, 'ACTIVE'),
        ),
      )
      .limit(2);
    const scene = sceneRows[0];
    if (sceneRows.length !== 1 || !scene?.mappingVersionId) {
      throw new ExternalApiFailure(
        'MAPPING_NOT_READY',
        '话术变量映射未就绪或存在多个可用场景',
        422,
      );
    }
    const mappingVersionId = scene.mappingVersionId;
    const sceneCompanyId = binding.robotDefId.startsWith('LOCAL-')
      ? 'LOCAL-MOCK'
      : this.options.baiyingCompanyId;
    const [sceneCompany] = await tx
      .select({ companyId: baiyingSceneCompanies.companyId })
      .from(baiyingSceneCompanies)
      .where(
        and(
          eq(baiyingSceneCompanies.sceneDefId, scene.sceneDefId),
          eq(baiyingSceneCompanies.companyId, sceneCompanyId),
          eq(baiyingSceneCompanies.enabled, true),
        ),
      )
      .limit(1);
    if (!sceneCompany) {
      throw new ExternalApiFailure(
        'MAPPING_NOT_READY',
        '话术场景未绑定当前百应公司',
        422,
      );
    }
    const rawRules = await tx
      .select()
      .from(mappingRules)
      .where(
        and(
          eq(mappingRules.mappingVersionId, mappingVersionId),
          eq(mappingRules.status, 'PUBLISHED'),
          inArray(mappingRules.baiyingVariableName, scene.variables),
        ),
      );
    const rules: MappingRule[] = rawRules.map((rule) => ({
      id: rule.id,
      baiyingVariableName: rule.baiyingVariableName,
      erpField: rule.erpField,
      crmField: rule.crmField,
      transformConfig: rule.transformConfig,
      emptyPolicy: rule.emptyPolicy,
      defaultValue: rule.defaultValue,
      status: rule.status,
      version: scene.mappingVersion,
    }));
    const ruleByVariable = new Map(
      rules.map((rule) => [rule.baiyingVariableName, rule]),
    );
    const missingVariables = scene.variables.filter((variable) => {
      const rule = ruleByVariable.get(variable);
      return !rule || !resolveSourceField(rule, input.request.sourceSystem);
    });
    if (missingVariables.length) {
      throw new ExternalApiFailure(
        'MAPPING_NOT_READY',
        '当前来源缺少已发布变量映射',
        422,
        { variables: missingVariables },
      );
    }

    const errors: Array<Record<string, unknown>> = [];
    let errorCount = 0;
    const mappedProperties = input.request.customers.map((customer) => {
      const mapped: Record<string, string> = {};
      for (const variable of scene.variables) {
        const rule = ruleByVariable.get(variable)!;
        try {
          mapped[variable] = transformMappedValue({
            rule,
            sourceSystem: input.request.sourceSystem,
            sourceRecord: customer.fields,
          });
        } catch (error) {
          errorCount += 1;
          if (errors.length < 50) {
            errors.push({
              externalCustomerId: customer.externalCustomerId,
              variable,
              reason: error instanceof Error ? error.message : '变量转换失败',
            });
          }
        }
      }
      return mapped;
    });
    if (errors.length) {
      throw new ExternalApiFailure(
        'MAPPING_VALUE_INVALID',
        '客户字段无法转换为话术变量',
        422,
        { issues: errors, errorCount, truncated: errorCount > errors.length },
      );
    }

    return {
      studio,
      endpoint,
      price,
      categories,
      categoryById,
      binding,
      line,
      scene,
      sceneCompanyId,
      mappingVersion: { id: mappingVersionId, version: scene.mappingVersion },
      rules,
      mappedProperties,
    };
  }

  private clock(): Date {
    return this.options.clock?.() ?? new Date();
  }

  private createId(): string {
    return this.options.createId?.() ?? randomUUID();
  }
}

export function displayStatusFor(
  status: TaskExecutionStatus,
): TaskDisplayStatus {
  if (status === 'COMPLETED') return '执行完成';
  if (status === 'CALLING') return '呼叫中';
  if (status.endsWith('_FAILED')) return '执行失败';
  if (status === 'CANCELLED' || status === 'TERMINATED') return '已终止';
  return '执行中';
}

function failureStage(value: string | null) {
  const supported = [
    'VALIDATION',
    'BAIYING_CREATE',
    'BAIYING_IMPORT',
    'BAIYING_START',
    'RECONCILIATION',
  ] as const;
  return supported.find((item) => item === value) ?? 'RECONCILIATION';
}

function normalizePhone(phone: string): string {
  if (phone.startsWith('+86')) return phone.slice(3);
  if (phone.startsWith('86') && phone.length === 13) return phone.slice(2);
  return phone;
}

async function advisoryLock(tx: Transaction, key: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
  );
}

async function lockAccount(
  tx: Transaction,
  studioId: string,
): Promise<LockedAccount> {
  const rows = await tx.execute<LockedAccount>(sql`
    select
      ${studioAccounts.studioId} as "studioId",
      ${studioAccounts.currency} as "currency",
      ${studioAccounts.balance} as "balance",
      ${studioAccounts.activeHoldAmount} as "activeHoldAmount",
      ${studioAccounts.status} as "status"
    from ${studioAccounts}
    where ${studioAccounts.studioId} = ${studioId}
    for update
  `);
  const account = rows[0];
  if (!account) {
    throw new ExternalApiFailure('INSUFFICIENT_BALANCE', '影楼账户不存在', 409);
  }
  return account;
}

async function nextTaskNo(tx: Transaction, now: Date): Promise<string> {
  const date = shanghaiDate(now);
  const name = `platform-task:${date}`;
  const rows = await tx.execute<{ value: bigint | string }>(sql`
    insert into external_sequence (name, value)
    values (${name}, 1)
    on conflict (name) do update
    set value = external_sequence.value + 1
    returning value
  `);
  return `PT-${date}-${String(rows[0]!.value).padStart(5, '0')}`;
}

export function shanghaiDate(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)!.value;
  return `${part('year')}${part('month')}${part('day')}`;
}

function accountStatusAfter(
  balance: string,
  available: string,
  current: AccountStatus,
  lowBalanceThreshold: string,
): AccountStatus {
  if (current === 'DISABLED') return current;
  if (moneyToMicros(balance) <= 0n) return 'OVERDUE';
  if (moneyToMicros(available) < moneyToMicros(lowBalanceThreshold)) {
    return 'LOW_BALANCE';
  }
  return 'ACTIVE';
}

import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  baiyingWorkflowStatusSchema,
  lineStudioBindingInputSchema,
  mappingDraftInputSchema,
  plannedTaskBindingInputSchema,
  publishMappingInputSchema,
  removeMappingDraftInputSchema,
  scriptBindingInputSchema,
  sourceCategoryObservationSchema,
  sourceSystemSchema,
  syncSceneObservationSchema,
} from '@outbound/contracts';
import {
  MappingConflictError,
  MappingNotFoundError,
  type MappingRepository,
} from '../mapping/repository.js';
import type { BaiyingAccountClient, BaiyingLineClient, BaiyingRobotClient, BaiyingWorkflowClient } from '../baiying/client.js';
import type { LineRepository } from '../line/repository.js';
import type { PlannedTaskRepository } from '../planned-task/repository.js';
import { ScriptBindingConflictError, type ScriptRepository } from '../script/repository.js';
import type { CategorySyncService } from '../source-category/sync-service.js';

type AppVariables = { requestId: string };

const baiyingCallInstanceCallbackSchema = z.object({
  code: z.number(),
  data: z.object({
    data: z.object({
      callInstance: z.object({
        callJobId: z.number().optional(),
        callInstanceId: z.number().optional(),
        callInstanceStatus: z.number().optional(),
        finishStatus: z.number().optional(),
        customerTelephone: z.string().optional(),
        robotDefId: z.number().optional(),
        duration: z.number().nonnegative().optional(),
        luyinOssUrl: z.string().optional(),
        userLuyinOssUrl: z.string().optional(),
      }).loose().optional(),
      phoneLogs: z.array(z.record(z.string(), z.unknown())).optional(),
      taskResult: z.array(z.record(z.string(), z.unknown())).optional(),
      callRepeat: z.array(z.record(z.string(), z.unknown())).optional(),
      jobPhoneInfos: z.array(z.record(z.string(), z.unknown())).optional(),
    }).loose(),
    callbackType: z.literal('CALL_INSTANCE_RESULT'),
  }).loose(),
  resultMsg: z.string(),
}).loose();

export type BaiyingCallInstanceCallback = z.infer<typeof baiyingCallInstanceCallbackSchema>;

export function calculateBillingMinutes(durationSeconds: number) {
  return durationSeconds > 0 ? Math.ceil(durationSeconds / 60) : 0;
}

export type AppDependencies = {
  mappingRepository: MappingRepository;
  consoleOrigin: string;
  workerSharedSecret: string;
  workflowClient?: BaiyingWorkflowClient;
  plannedTaskRepository?: PlannedTaskRepository;
  robotClient?: BaiyingRobotClient;
  scriptRepository?: ScriptRepository;
  lineClient?: BaiyingLineClient;
  accountClient?: BaiyingAccountClient;
  lineRepository?: LineRepository;
  baiyingCompanyId?: string;
  erpCategorySyncService?: CategorySyncService;
  clock?: () => Date;
  createId?: () => string;
  onBaiyingCallInstance?: (payload: BaiyingCallInstanceCallback, requestId: string) => Promise<void> | void;
};

export function createApp(dependencies: AppDependencies) {
  const app = new Hono<{ Variables: AppVariables }>();
  const clock = dependencies.clock ?? (() => new Date());
  const createId = dependencies.createId ?? (() => crypto.randomUUID());

  app.use('*', cors({
    origin: dependencies.consoleOrigin,
    allowHeaders: ['Content-Type', 'X-Request-Id', 'X-Actor-Id'],
    exposeHeaders: ['X-Request-Id'],
    credentials: true,
  }));
  app.use('*', async (context, next) => {
    const requestId = context.req.header('x-request-id')?.trim() || createId();
    context.set('requestId', requestId);
    context.header('X-Request-Id', requestId);
    await next();
  });

  app.get('/health', (context) => context.json({ status: 'ok', service: 'outbound-platform-api', at: clock().toISOString() }));

  app.get('/api/v1/baiying/account-overview', async (context) => {
    if (!dependencies.accountClient || !dependencies.baiyingCompanyId) {
      return context.json({
        error: { code: 'BAIYING_NOT_CONFIGURED', message: '百应账户接口尚未配置', requestId: context.get('requestId') },
      }, 503);
    }
    const companyId = dependencies.baiyingCompanyId;
    const [communicationBalance, aiBalance, seatOverview] = await Promise.all([
      settleSection(dependencies.accountClient.getCommunicationBalance(companyId)),
      settleSection(dependencies.accountClient.getAiBalance(companyId)),
      settleSection(dependencies.accountClient.getSeatOverview(companyId)),
    ]);
    return context.json(success(context.get('requestId'), { communicationBalance, aiBalance, seatOverview }));
  });

  app.post('/api/v1/callbacks/baiying/call-instance', async (context) => {
    const payload = baiyingCallInstanceCallbackSchema.parse(await context.req.json());
    await dependencies.onBaiyingCallInstance?.(payload, context.get('requestId'));
    const callInstance = payload.data.data.callInstance;
    console.info(JSON.stringify({
      level: 'info',
      message: 'Baiying call instance callback accepted',
      requestId: context.get('requestId'),
      callJobId: callInstance?.callJobId,
      callInstanceId: callInstance?.callInstanceId,
      finishStatus: callInstance?.finishStatus,
      durationSeconds: callInstance?.duration,
      billingMinutes: callInstance?.duration === undefined ? undefined : calculateBillingMinutes(callInstance.duration),
    }));
    return context.json({ code: 200 });
  });

  app.get('/api/v1/mappings', async (context) => context.json(success(
    context.get('requestId'),
    { rules: await dependencies.mappingRepository.listPublishedRules() },
  )));

  app.get('/api/v1/mappings/drafts', async (context) => context.json(success(
    context.get('requestId'),
    { drafts: await dependencies.mappingRepository.listDrafts() },
  )));

  app.post('/api/v1/mappings/drafts', async (context) => {
    const input = mappingDraftInputSchema.parse(await context.req.json());
    const actorId = requireActor(context.req.header('x-actor-id'));
    const draft = await dependencies.mappingRepository.saveDraft(input, actorId, context.get('requestId'));
    return context.json(success(context.get('requestId'), { draft }), 201);
  });

  app.post('/api/v1/mappings/drafts/remove', async (context) => {
    const input = removeMappingDraftInputSchema.parse(await context.req.json());
    const actorId = requireActor(context.req.header('x-actor-id'));
    const draft = await dependencies.mappingRepository.stageRemoval(input, actorId, context.get('requestId'));
    return context.json(success(context.get('requestId'), { draft }), 201);
  });

  app.post('/api/v1/mappings/publish', async (context) => {
    const input = publishMappingInputSchema.parse(await context.req.json());
    const actorId = requireActor(context.req.header('x-actor-id'));
    if (actorId !== input.publisherId) throw new MappingConflictError('发布人与当前操作人不一致');
    const published = await dependencies.mappingRepository.publishDrafts(input, context.get('requestId'));
    return context.json(success(context.get('requestId'), published), 201);
  });

  app.get('/api/v1/mapping-versions', async (context) => context.json(success(
    context.get('requestId'),
    { versions: await dependencies.mappingRepository.listVersions() },
  )));

  app.get('/api/v1/scenes/readiness', async (context) => context.json(success(
    context.get('requestId'),
    { scenes: await dependencies.mappingRepository.listSceneReadiness() },
  )));

  app.get('/api/v1/planned-tasks', async (context) => {
    const { workflowClient, repository } = plannedTaskDependencies(dependencies);
    const query = z.object({
      name: z.string().trim().max(200).optional(),
      groupId: z.string().trim().max(128).optional(),
      groupName: z.string().trim().max(200).optional(),
      workflowId: z.string().trim().max(128).optional(),
      status: baiyingWorkflowStatusSchema.default('ALL'),
      pageNum: z.coerce.number().int().min(0).default(0),
      pageSize: z.coerce.number().int().min(1).max(100).default(20),
    }).parse(context.req.query());
    const page = await workflowClient.listWorkflows({
      name: query.name || undefined,
      groupId: query.groupId || undefined,
      groupName: query.groupName || undefined,
      workflowId: query.workflowId || undefined,
      workflowExecuteStatus: query.status,
      pageNum: query.pageNum,
      pageSize: query.pageSize,
    });
    const bindings = await repository.listBindings(page.workflows.map((workflow) => workflow.id));
    const bindingByWorkflow = new Map(bindings.map((binding) => [binding.workflowId, binding]));
    return context.json(success(context.get('requestId'), {
      total: page.total,
      pages: page.pages,
      pageNum: page.pageNum,
      pageSize: page.pageSize,
      tasks: page.workflows.map((workflow) => ({ ...workflow, categoryBinding: bindingByWorkflow.get(workflow.id) ?? null })),
    }));
  });

  app.get('/api/v1/source-categories', async (context) => {
    const { repository } = plannedTaskDependencies(dependencies);
    const query = z.object({ sourceSystem: sourceSystemSchema.optional() }).parse(context.req.query());
    return context.json(success(context.get('requestId'), {
      categories: await repository.listSourceCategories(query.sourceSystem),
    }));
  });

  app.get('/api/v1/data-categories', async (context) => {
    const query = z.object({
      sourceSystem: sourceSystemSchema.default('ERP'),
      studioId: z.string().trim().min(1).max(128).optional(),
    }).parse(context.req.query());
    const categories = await sourceCategoryRepository(dependencies).listSourceCategories(query.sourceSystem);
    const scriptRepository = dependencies.scriptRepository;
    if (!scriptRepository) throw new Error('话术绑定数据尚未配置');
    const bindings = (await scriptRepository.listAllBindings()).filter((binding) => (
      binding.sourceSystem === query.sourceSystem && (!query.studioId || binding.studioId === query.studioId)
    ));
    const robotNames = new Map<string, string>();
    if (dependencies.robotClient && dependencies.baiyingCompanyId) {
      try {
        const robots = await dependencies.robotClient.listRobots(dependencies.baiyingCompanyId, 0);
        for (const robot of robots) robotNames.set(robot.robotDefId, robot.robotName);
      } catch {
        // 分类数据仍可使用；话术名称不可用时回退到话术 ID。
      }
    }
    const boundScripts = (externalId: string, categoryPath: string) => Array.from(new Set(bindings
      .filter((binding) => binding.categories.some((category) => category.sourceCategoryId === externalId || category.categoryPath === categoryPath))
      .map((binding) => binding.robotDefId)))
      .map((robotDefId) => ({ robotDefId, robotName: robotNames.get(robotDefId) || '' }));

    return context.json(success(context.get('requestId'), {
      sourceSystem: query.sourceSystem,
      studioId: query.studioId ?? null,
      configured: query.sourceSystem === 'ERP' ? Boolean(dependencies.erpCategorySyncService || categories.length) : Boolean(categories.length),
      syncedAt: categories[0]?.syncedAt ?? null,
      categories: categories.map((category) => ({ ...category, boundScripts: boundScripts(category.externalId, category.categoryPath) })),
    }));
  });

  app.post('/api/v1/data-categories/sync', async (context) => {
    requireActor(context.req.header('x-actor-id'));
    const input = z.object({ sourceSystem: sourceSystemSchema.default('ERP') }).parse(await context.req.json().catch(() => ({})));
    if (input.sourceSystem !== 'ERP' || !dependencies.erpCategorySyncService) {
      return context.json({
        error: { code: 'CATEGORY_SYNC_UNAVAILABLE', message: `${input.sourceSystem} 分类同步尚未配置`, requestId: context.get('requestId') },
      }, 409);
    }
    return context.json(success(context.get('requestId'), await dependencies.erpCategorySyncService.sync()));
  });

  app.post('/api/v1/planned-task-category-bindings', async (context) => {
    const { repository } = plannedTaskDependencies(dependencies);
    const input = plannedTaskBindingInputSchema.parse(await context.req.json());
    const actorId = requireActor(context.req.header('x-actor-id'));
    const binding = await repository.saveBinding(input, actorId, context.get('requestId'));
    return context.json(success(context.get('requestId'), { binding }), 201);
  });

  app.get('/api/v1/scripts', async (context) => {
    const { robotClient, scriptRepository, companyId } = scriptDependencies(dependencies);
    const query = z.object({
      query: z.string().trim().max(200).optional(),
      robotStatus: z.coerce.number().int().min(0).max(2).default(0),
      pageNum: z.coerce.number().int().min(0).default(0),
      pageSize: z.coerce.number().int().min(1).max(100).default(20),
    }).parse(context.req.query());
    const robots = await robotClient.listRobots(companyId, query.robotStatus as 0 | 1 | 2);
    const needle = query.query?.toLocaleLowerCase('zh-CN');
    const filtered = needle
      ? robots.filter((robot) => `${robot.robotName} ${robot.robotDefId}`.toLocaleLowerCase('zh-CN').includes(needle))
      : robots;
    const start = query.pageNum * query.pageSize;
    const pageRobots = filtered.slice(start, start + query.pageSize);
    const bindings = await scriptRepository.listBindings(pageRobots.map((robot) => robot.robotDefId));
    const bindingByRobot = new Map(bindings.map((binding) => [binding.robotDefId, binding]));
    return context.json(success(context.get('requestId'), {
      total: filtered.length,
      pages: Math.ceil(filtered.length / query.pageSize),
      pageNum: query.pageNum,
      pageSize: query.pageSize,
      scripts: pageRobots.map((robot) => ({ ...robot, binding: bindingByRobot.get(robot.robotDefId) ?? null })),
    }));
  });

  app.post('/api/v1/script-bindings', async (context) => {
    const { scriptRepository } = scriptDependencies(dependencies);
    const input = scriptBindingInputSchema.parse(await context.req.json());
    const actorId = requireActor(context.req.header('x-actor-id'));
    const binding = await scriptRepository.saveBinding(input, actorId, context.get('requestId'));
    return context.json(success(context.get('requestId'), { binding }), 201);
  });

  app.get('/api/v1/lines', async (context) => {
    const { lineClient, lineRepository, companyId } = lineDependencies(dependencies);
    const query = z.object({ query: z.string().trim().max(200).optional() }).parse(context.req.query());
    const lines = await lineClient.listPhones(companyId);
    const managedLines = await lineRepository.replaceManagedLines(lines);
    const needle = query.query?.toLocaleLowerCase('zh-CN');
    const filtered = needle
      ? managedLines.filter((line) => `${line.userPhoneId} ${line.phone} ${line.phoneName}`.toLocaleLowerCase('zh-CN').includes(needle))
      : managedLines;
    const bindings = await lineRepository.listBindings(filtered.map((line) => line.userPhoneId));
    const studiosByLine = new Map<string, typeof bindings>();
    for (const binding of bindings) {
      const current = studiosByLine.get(binding.userPhoneId) ?? [];
      current.push(binding);
      studiosByLine.set(binding.userPhoneId, current);
    }
    return context.json(success(context.get('requestId'), {
      lines: filtered.map((line) => ({ ...line, studios: studiosByLine.get(line.userPhoneId) ?? [] })),
    }));
  });

  app.get('/api/v1/managed-lines', async (context) => {
    const lineRepository = managedLineRepository(dependencies);
    const managedLines = await lineRepository.listManagedLines();
    const bindings = await lineRepository.listBindings(managedLines.map((line) => line.userPhoneId));
    const studiosByLine = new Map<string, typeof bindings>();
    for (const binding of bindings) {
      const current = studiosByLine.get(binding.userPhoneId) ?? [];
      current.push(binding);
      studiosByLine.set(binding.userPhoneId, current);
    }
    return context.json(success(context.get('requestId'), {
      lines: managedLines.map((line) => ({ ...line, studios: studiosByLine.get(line.userPhoneId) ?? [] })),
    }));
  });

  app.post('/api/v1/line-studio-bindings', async (context) => {
    const lineRepository = managedLineRepository(dependencies);
    const input = lineStudioBindingInputSchema.parse(await context.req.json());
    const actorId = requireActor(context.req.header('x-actor-id'));
    const bindings = await lineRepository.saveBindings(input, actorId, context.get('requestId'));
    return context.json(success(context.get('requestId'), { bindings }), 201);
  });

  app.post('/api/v1/variable-sync-jobs', async (context) => {
    const actorId = requireActor(context.req.header('x-actor-id'));
    const requested = { jobId: createId(), status: 'QUEUED' as const, requestedAt: clock().toISOString() };
    await dependencies.mappingRepository.enqueueVariableSync({
      jobId: requested.jobId,
      requestedAt: requested.requestedAt,
      requestedBy: actorId,
    });
    return context.json(success(context.get('requestId'), requested), 202);
  });

  app.post('/api/v1/internal/scene-variable-observations', async (context) => {
    requireWorkerSecret(context.req.header('x-worker-secret'), dependencies.workerSharedSecret);
    const body = z.object({ observations: z.array(syncSceneObservationSchema).min(1).max(500) }).parse(await context.req.json());
    const readiness = [];
    for (const observation of body.observations) {
      readiness.push(await dependencies.mappingRepository.recordSuccessfulObservation(observation));
    }
    return context.json(success(context.get('requestId'), { readiness }), 201);
  });

  app.post('/api/v1/internal/source-categories', async (context) => {
    requireWorkerSecret(context.req.header('x-worker-secret'), dependencies.workerSharedSecret);
    const { repository } = plannedTaskDependencies(dependencies);
    const body = z.object({ observations: z.array(sourceCategoryObservationSchema).min(1).max(2000) }).parse(await context.req.json());
    const categories = await repository.syncSourceCategories(body.observations);
    return context.json(success(context.get('requestId'), { categories }), 201);
  });

  app.notFound((context) => context.json({
    error: { code: 'NOT_FOUND', message: '接口不存在', requestId: context.get('requestId') },
  }, 404));

  app.onError((error, context) => {
    const requestId = context.get('requestId');
    if (error instanceof z.ZodError) {
      return context.json({ error: { code: 'VALIDATION_ERROR', message: '请求参数不合法', requestId, details: { issues: error.issues } } }, 400);
    }
    if (error instanceof MappingNotFoundError) {
      return context.json({ error: { code: 'MAPPING_NOT_FOUND', message: error.message, requestId } }, 404);
    }
    if (error instanceof MappingConflictError) {
      return context.json({ error: { code: 'MAPPING_CONFLICT', message: error.message, requestId } }, 409);
    }
    if (error instanceof ScriptBindingConflictError) {
      return context.json({ error: { code: 'SCRIPT_BINDING_CONFLICT', message: error.message, requestId } }, 409);
    }
    if (error instanceof UnauthorizedError) {
      return context.json({ error: { code: 'UNAUTHORIZED', message: error.message, requestId } }, 401);
    }
    console.error(JSON.stringify({ level: 'error', requestId, message: error.message }));
    return context.json({ error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用', requestId } }, 500);
  });

  return app;
}

function plannedTaskDependencies(dependencies: AppDependencies) {
  if (!dependencies.workflowClient || !dependencies.plannedTaskRepository) {
    throw new Error('计划任务服务尚未配置');
  }
  return { workflowClient: dependencies.workflowClient, repository: dependencies.plannedTaskRepository };
}

function sourceCategoryRepository(dependencies: AppDependencies) {
  if (!dependencies.plannedTaskRepository) throw new Error('数据分类存储尚未配置');
  return dependencies.plannedTaskRepository;
}

function scriptDependencies(dependencies: AppDependencies) {
  if (!dependencies.robotClient || !dependencies.scriptRepository || !dependencies.baiyingCompanyId) {
    throw new Error('话术列表服务尚未配置');
  }
  return {
    robotClient: dependencies.robotClient,
    scriptRepository: dependencies.scriptRepository,
    companyId: dependencies.baiyingCompanyId,
  };
}

function lineDependencies(dependencies: AppDependencies) {
  if (!dependencies.lineClient || !dependencies.lineRepository || !dependencies.baiyingCompanyId) {
    throw new Error('线路管理服务尚未配置');
  }
  return {
    lineClient: dependencies.lineClient,
    lineRepository: dependencies.lineRepository,
    companyId: dependencies.baiyingCompanyId,
  };
}

function managedLineRepository(dependencies: AppDependencies) {
  if (!dependencies.lineRepository) throw new Error('线路管理数据尚未配置');
  return dependencies.lineRepository;
}

function success<T>(requestId: string, data: T) {
  return { requestId, data };
}

async function settleSection<T>(promise: Promise<T>) {
  try {
    return { status: 'success' as const, data: await promise };
  } catch (error) {
    return { status: 'error' as const, message: error instanceof Error ? error.message : '百应接口请求失败' };
  }
}

function requireActor(value: string | undefined): string {
  const actorId = value?.trim();
  if (!actorId) throw new UnauthorizedError('缺少操作人身份');
  return actorId;
}

function requireWorkerSecret(provided: string | undefined, expected: string): void {
  if (!provided) throw new UnauthorizedError('缺少 worker 凭证');
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length || !timingSafeEqual(providedBuffer, expectedBuffer)) {
    throw new UnauthorizedError('worker 凭证无效');
  }
}

class UnauthorizedError extends Error {}

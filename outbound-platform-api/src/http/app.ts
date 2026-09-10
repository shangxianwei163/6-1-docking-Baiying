import { timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import {
  accountAdjustmentKindSchema,
  accountAdjustmentStatusSchema,
  baiyingWorkflowStatusSchema,
  callbackPreviewInputSchema,
  createAccountAdjustmentInputSchema,
  createOperatorStudioInputSchema,
  createTopUpInputSchema,
  consoleTaskStatusFilterSchema,
  createOutboundBatchRequestV2Schema,
  createOutboundTaskRequestSchema,
  decideAccountAdjustmentInputSchema,
  lineStudioBindingInputSchema,
  mappingDraftInputSchema,
  plannedTaskBindingInputSchema,
  publishPricingInputSchema,
  publishSupplierPricingInputSchema,
  publishMappingInputSchema,
  removeMappingDraftInputSchema,
  scriptBindingInputSchema,
  setOperatorStudioStatusInputSchema,
  sourceCategoryObservationSchema,
  sourceSystemSchema,
  supplierSettlementMonthSchema,
  finalizeSupplierSettlementInputSchema,
  syncSceneObservationSchema,
  updateOperatorStudioInputSchema,
  ledgerEntryTypeSchema,
  operatorAccountStatusSchema,
  operatorAuditCategorySchema,
  operatorStudioStatusSchema,
  integrationLogDirectionSchema,
  integrationLogStatusSchema,
  integrationLogSystemSchema,
  ignoreDeadLetterInputSchema,
  operatorDeadLetterSourceTypeSchema,
  operatorDeadLetterStatusSchema,
  operatorTaskCommandInputSchema,
  operatorTaskRetryInputSchema,
  replayDeadLetterInputSchema,
  repairTaskReconciliationInputSchema,
  taskReconciliationStatusSchema,
} from '@outbound/contracts';
import {
  MappingConflictError,
  MappingNotFoundError,
  type MappingRepository,
} from '../mapping/repository.js';
import type {
  BaiyingAccountClient,
  BaiyingLineClient,
  BaiyingRobotClient,
  BaiyingWorkflowClient,
} from '../baiying/client.js';
import {
  LineBindingConflictError,
  LineSyncFailure,
  type LineRepository,
  type LineSyncErrorCode,
  type ManagedLine,
} from '../line/repository.js';
import type { PlannedTaskRepository } from '../planned-task/repository.js';
import {
  ScriptBindingConflictError,
  type ScriptRepository,
} from '../script/repository.js';
import type { CategorySyncService } from '../source-category/sync-service.js';
import type { ExternalRequestAuthenticator } from '../openapi/authenticator.js';
import { ExternalApiFailure } from '../openapi/errors.js';
import { rawBodySha256, stableJsonSha256 } from '../openapi/request-hash.js';
import type { OutboundTaskService } from '../outbound-task/service.js';
import {
  CallbackBodyTooLargeError,
  DEFAULT_CALLBACK_BODY_LIMIT_BYTES,
  type BaiyingCallbackIngress,
} from '../callback/ingress-service.js';
import {
  OperationsConsoleFailure,
  type OperationsConsoleService,
} from '../operations/service.js';
import type { AccountAdjustmentService } from '../operations/adjustment-service.js';
import type { SupplierMonthlySettlementService } from '../billing/monthly-settlement-service.js';
import type { OperatorAuditService } from '../operations/audit-service.js';
import type { OperationsOverviewService } from '../operations/overview-service.js';
import type { IntegrationLogService } from '../operations/integration-log-service.js';
import type { RecoveryOperationsService } from '../operations/recovery-service.js';
import type { TaskControlService } from '../operations/task-control-service.js';
import type { CallbackPreviewService } from '../operations/callback-preview-service.js';
import {
  RecordingAccessFailure,
  type RecordingAccess,
} from '../recording/access-service.js';
import type { RecordingUrlReissue } from '../recording/reissue-service.js';
import type { OperatorSessionService } from '../security/operator-session.js';
import type { ReconciliationOperations } from '../reconciliation/postgres-repository.js';
export { calculateBillingMinutes } from '../callback/schema.js';

type AppVariables = { requestId: string };
const OPERATOR_SESSION_COOKIE = 'outbound_operator_session';

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
  externalRequestAuthenticator?: ExternalRequestAuthenticator;
  outboundTaskService?: OutboundTaskService;
  operationsConsoleService?: OperationsConsoleService;
  accountAdjustmentService?: AccountAdjustmentService;
  supplierMonthlySettlementService?: SupplierMonthlySettlementService;
  operatorAuditService?: OperatorAuditService;
  operationsOverviewService?: OperationsOverviewService;
  integrationLogService?: IntegrationLogService;
  recoveryOperationsService?: RecoveryOperationsService;
  taskControlService?: TaskControlService;
  callbackPreviewService?: CallbackPreviewService;
  recordingAccessService?: RecordingAccess;
  recordingUrlReissueService?: RecordingUrlReissue;
  baiyingCallbackIngress?: BaiyingCallbackIngress;
  reconciliationOperations?: ReconciliationOperations;
  operatorSessionService?: OperatorSessionService;
  operatorSessionCookieSecure?: boolean;
  clock?: () => Date;
  createId?: () => string;
};

export function createApp(dependencies: AppDependencies) {
  const app = new Hono<{ Variables: AppVariables }>();
  const clock = dependencies.clock ?? (() => new Date());
  const createId = dependencies.createId ?? (() => crypto.randomUUID());

  app.use(
    '*',
    cors({
      origin: dependencies.consoleOrigin,
      allowHeaders: [
        'Content-Type',
        'X-Request-Id',
        'X-Actor-Id',
        'X-Access-Token',
        'X-Timestamp',
        'X-Signature',
        'Idempotency-Key',
      ],
      exposeHeaders: [
        'X-Request-Id',
        'Idempotent-Replayed',
        'X-Recording-Sha256',
      ],
      credentials: true,
    }),
  );
  app.use('*', async (context, next) => {
    const candidate = context.req.header('x-request-id')?.trim();
    const requestId =
      candidate && candidate.length <= 128 ? candidate : createId();
    context.set('requestId', requestId);
    context.header('X-Request-Id', requestId);
    await next();
  });

  app.use('/api/v1/*', async (context, next) => {
    const sessionService = dependencies.operatorSessionService;
    if (!sessionService || isPublicOperatorApi(context.req.path)) {
      await next();
      return;
    }

    const identity = sessionService.verify(
      getCookie(context, OPERATOR_SESSION_COOKIE),
    );
    if (!identity) throw new UnauthorizedError('登录已失效，请重新登录');

    const claimedActor = context.req.header('x-actor-id')?.trim();
    if (claimedActor && claimedActor !== identity.username) {
      throw new UnauthorizedError('当前登录账号与操作人身份不一致');
    }
    await next();
  });

  app.post('/api/v1/operator-session', async (context) => {
    const sessionService = operatorSessionDependency(dependencies);
    const input = z
      .object({
        username: z.string().trim().min(1).max(128),
        password: z.string().min(1).max(256),
      })
      .parse(await context.req.json());
    const identity = sessionService.authenticate(
      input.username,
      input.password,
    );
    if (!identity) throw new UnauthorizedError('账号或密码错误');

    setCookie(
      context,
      OPERATOR_SESSION_COOKIE,
      sessionService.issue(identity),
      operatorSessionCookieOptions(
        dependencies.operatorSessionCookieSecure ?? false,
        sessionService.ttlSeconds,
      ),
    );
    return context.json(success(context.get('requestId'), identity));
  });

  app.get('/api/v1/operator-session', (context) => {
    const sessionService = operatorSessionDependency(dependencies);
    const identity = sessionService.verify(
      getCookie(context, OPERATOR_SESSION_COOKIE),
    );
    if (!identity) throw new UnauthorizedError('登录已失效，请重新登录');
    return context.json(success(context.get('requestId'), identity));
  });

  app.delete('/api/v1/operator-session', (context) => {
    deleteCookie(context, OPERATOR_SESSION_COOKIE, {
      path: '/',
      secure: dependencies.operatorSessionCookieSecure ?? false,
      sameSite: dependencies.operatorSessionCookieSecure ? 'None' : 'Lax',
    });
    return context.json(
      success(context.get('requestId'), { loggedOut: true as const }),
    );
  });

  app.get('/health', (context) =>
    context.json({
      status: 'ok',
      service: 'outbound-platform-api',
      at: clock().toISOString(),
    }),
  );

  app.get('/api/v1/baiying/account-overview', async (context) => {
    if (!dependencies.accountClient || !dependencies.baiyingCompanyId) {
      return context.json(
        {
          error: {
            code: 'BAIYING_NOT_CONFIGURED',
            message: '百应账户接口尚未配置',
            requestId: context.get('requestId'),
          },
        },
        503,
      );
    }
    const companyId = dependencies.baiyingCompanyId;
    const [communicationBalance, aiBalance, seatOverview] = await Promise.all([
      settleSection(
        dependencies.accountClient.getCommunicationBalance(companyId),
      ),
      settleSection(dependencies.accountClient.getAiBalance(companyId)),
      settleSection(dependencies.accountClient.getSeatOverview(companyId)),
    ]);
    return context.json(
      success(context.get('requestId'), {
        communicationBalance,
        aiBalance,
        seatOverview,
      }),
    );
  });

  for (const path of [
    '/api/v1/callbacks/baiying',
    '/api/v1/callbacks/baiying/call-instance',
  ]) {
    app.post(path, async (context) => {
      if (!dependencies.baiyingCallbackIngress) {
        throw new Error('百应回调 Inbox 尚未配置');
      }
      const contentType = context.req.header('content-type')?.toLowerCase();
      if (!contentType?.includes('application/json')) {
        return context.json(
          {
            error: {
              code: 'UNSUPPORTED_MEDIA_TYPE',
              message: '百应回调必须使用 application/json',
              requestId: context.get('requestId'),
            },
          },
          415,
        );
      }
      const accepted = await dependencies.baiyingCallbackIngress.ingest({
        rawBody: await readUtf8BodyWithLimit(
          context.req.raw,
          DEFAULT_CALLBACK_BODY_LIMIT_BYTES,
        ),
        headers: context.req.raw.headers,
      });
      if (accepted.replayed) context.header('Idempotent-Replayed', 'true');
      console.info(
        JSON.stringify({
          level: 'info',
          message: 'Baiying callback persisted',
          requestId: context.get('requestId'),
          inboxId: accepted.id,
          callbackType: accepted.callbackType,
          replayed: accepted.replayed,
        }),
      );
      return context.json({ code: 200 });
    });
  }

  app.get('/api/v1/outbound-tasks', async (context) => {
    requireActor(context.req.header('x-actor-id'));
    const query = z
      .object({
        keyword: z.string().trim().max(200).optional(),
        status: consoleTaskStatusFilterSchema.default('ALL'),
        createdFrom: z.iso.datetime({ offset: true }).optional(),
        createdBefore: z.iso.datetime({ offset: true }).optional(),
        pageNum: z.coerce.number().int().min(0).default(0),
        pageSize: z.coerce.number().int().min(1).max(100).default(20),
      })
      .parse(context.req.query());
    const createdFrom = query.createdFrom
      ? new Date(query.createdFrom)
      : undefined;
    const createdBefore = query.createdBefore
      ? new Date(query.createdBefore)
      : undefined;
    if (createdFrom && createdBefore && createdFrom >= createdBefore) {
      throw new ExternalApiFailure(
        'INVALID_REQUEST',
        '任务开始时间必须早于结束时间',
        400,
      );
    }
    const data = await consoleTaskDependency(dependencies).listConsoleTasks({
      keyword: query.keyword || undefined,
      status: query.status,
      createdFrom,
      createdBefore,
      pageNum: query.pageNum,
      pageSize: query.pageSize,
    });
    return context.json(success(context.get('requestId'), data));
  });

  app.get('/api/v1/outbound-tasks/:taskNo', async (context) => {
    requireActor(context.req.header('x-actor-id'));
    const taskNo = z
      .string()
      .regex(/^PT-\d{8}-\d{5,}$/)
      .parse(context.req.param('taskNo'));
    const task =
      await consoleTaskDependency(dependencies).getConsoleTask(taskNo);
    return context.json(success(context.get('requestId'), { task }));
  });

  app.get('/api/v1/outbound-tasks/:taskNo/calls', async (context) => {
    requireActor(context.req.header('x-actor-id'));
    const taskNo = z
      .string()
      .regex(/^PT-\d{8}-\d{5,}$/)
      .parse(context.req.param('taskNo'));
    const query = z
      .object({
        cursor: z.string().trim().min(1).max(512).optional(),
        limit: z.coerce.number().int().min(1).max(500).default(100),
      })
      .parse(context.req.query());
    const data = await consoleTaskDependency(dependencies).listConsoleCalls(
      taskNo,
      query,
    );
    return context.json(success(context.get('requestId'), data));
  });

  app.post('/api/v1/recordings/:recordingId/download-url', async (context) => {
    const actorId = requireActor(context.req.header('x-actor-id'));
    const recordingId = z.uuid().parse(context.req.param('recordingId'));
    const data = await recordingAccessDependency(dependencies).issueOperatorUrl(
      recordingId,
      actorId,
      context.get('requestId'),
    );
    return context.json(success(context.get('requestId'), data));
  });

  app.get('/api/v1/recordings/:recordingId/content', async (context) => {
    const recordingId = z.uuid().parse(context.req.param('recordingId'));
    const query = z
      .object({
        exp: z.coerce.number().int(),
        aud: z.string().regex(/^[a-f0-9]{64}$/),
        sig: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .parse(context.req.query());
    const opened = await recordingAccessDependency(dependencies).openSignedUrl(
      recordingId,
      {
        audience: query.aud,
        expiresAtEpochSeconds: query.exp,
        signature: query.sig,
        requestId: context.get('requestId'),
      },
    );
    const body = Readable.toWeb(Readable.from(opened.body)) as ReadableStream;
    return context.body(body, 200, {
      'Cache-Control': 'private, no-store',
      'Content-Disposition': `inline; filename="recording-${recordingId}.audio"`,
      'Content-Length': opened.sizeBytes.toString(),
      'Content-Type': opened.contentType,
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Recording-Sha256': opened.sha256,
    });
  });

  app.post('/api/v1/outbound-tasks/:taskNo/commands', async (context) => {
    const actorId = requireActor(context.req.header('x-actor-id'));
    const taskNo = z
      .string()
      .regex(/^PT-\d{8}-\d{5,}$/)
      .parse(context.req.param('taskNo'));
    const input = operatorTaskCommandInputSchema.parse(
      await context.req.json(),
    );
    const data = await taskControlDependency(dependencies).commandTask(
      taskNo,
      input,
      actorId,
      context.get('requestId'),
    );
    return context.json(success(context.get('requestId'), data));
  });

  app.post('/api/v1/outbound-tasks/:taskNo/retry', async (context) => {
    const actorId = requireActor(context.req.header('x-actor-id'));
    const taskNo = z
      .string()
      .regex(/^PT-\d{8}-\d{5,}$/)
      .parse(context.req.param('taskNo'));
    const input = operatorTaskRetryInputSchema.parse(await context.req.json());
    const data = await taskControlDependency(dependencies).retryTask(
      taskNo,
      input,
      actorId,
      context.get('requestId'),
    );
    return context.json(success(context.get('requestId'), data), 202);
  });

  app.get('/api/v1/studios', async (context) => {
    requireActor(context.req.header('x-actor-id'));
    const query = z
      .object({
        keyword: z.string().trim().max(200).optional(),
        studioStatus: operatorStudioStatusSchema.optional(),
        accountStatus: operatorAccountStatusSchema.optional(),
        pageNum: z.coerce.number().int().min(0).default(0),
        pageSize: z.coerce.number().int().min(1).max(100).default(20),
      })
      .parse(context.req.query());
    const data = await operationsDependency(dependencies).listStudios({
      ...query,
      keyword: query.keyword || undefined,
    });
    return context.json(success(context.get('requestId'), data));
  });

  app.post('/api/v1/studios', async (context) => {
    const actorId = requireActor(context.req.header('x-actor-id'));
    const input = createOperatorStudioInputSchema.parse(
      await context.req.json(),
    );
    const studio = await operationsDependency(dependencies).createStudio(
      input,
      actorId,
      context.get('requestId'),
    );
    return context.json(success(context.get('requestId'), { studio }), 201);
  });

  app.patch('/api/v1/studios/:studioId', async (context) => {
    const actorId = requireActor(context.req.header('x-actor-id'));
    const studioId = z.uuid().parse(context.req.param('studioId'));
    const input = updateOperatorStudioInputSchema.parse(
      await context.req.json(),
    );
    const studio = await operationsDependency(dependencies).updateStudio(
      studioId,
      input,
      actorId,
      context.get('requestId'),
    );
    return context.json(success(context.get('requestId'), { studio }));
  });

  app.post('/api/v1/studios/:studioId/status', async (context) => {
    const actorId = requireActor(context.req.header('x-actor-id'));
    const studioId = z.uuid().parse(context.req.param('studioId'));
    const input = setOperatorStudioStatusInputSchema.parse(
      await context.req.json(),
    );
    const studio = await operationsDependency(dependencies).setStudioStatus(
      studioId,
      input.status,
      input.reason,
      actorId,
      context.get('requestId'),
    );
    return context.json(success(context.get('requestId'), { studio }));
  });

  app.get('/api/v1/account-ledger', async (context) => {
    requireActor(context.req.header('x-actor-id'));
    const query = z
      .object({
        keyword: z.string().trim().max(200).optional(),
        studioId: z.uuid().optional(),
        entryType: ledgerEntryTypeSchema.optional(),
        pageNum: z.coerce.number().int().min(0).default(0),
        pageSize: z.coerce.number().int().min(1).max(100).default(20),
      })
      .parse(context.req.query());
    const data = await operationsDependency(dependencies).listLedger({
      ...query,
      keyword: query.keyword || undefined,
    });
    return context.json(success(context.get('requestId'), data));
  });

  app.post('/api/v1/account-ledger/top-ups', async (context) => {
    const actorId = requireActor(context.req.header('x-actor-id'));
    const input = createTopUpInputSchema.parse(await context.req.json());
    const data = await operationsDependency(dependencies).topUp(
      input,
      actorId,
      context.get('requestId'),
    );
    return context.json(success(context.get('requestId'), data), 201);
  });

  app.get('/api/v1/account-adjustments', async (context) => {
    const actorId = requireActor(context.req.header('x-actor-id'));
    const query = z
      .object({
        keyword: z.string().trim().max(200).optional(),
        studioId: z.uuid().optional(),
        kind: accountAdjustmentKindSchema.optional(),
        status: accountAdjustmentStatusSchema.optional(),
        pageNum: z.coerce.number().int().min(0).default(0),
        pageSize: z.coerce.number().int().min(1).max(100).default(20),
      })
      .parse(context.req.query());
    const data = await adjustmentDependency(dependencies).listAdjustments(
      { ...query, keyword: query.keyword || undefined },
      actorId,
    );
    return context.json(success(context.get('requestId'), data));
  });

  app.post('/api/v1/account-adjustments', async (context) => {
    const actorId = requireActor(context.req.header('x-actor-id'));
    const input = createAccountAdjustmentInputSchema.parse(
      await context.req.json(),
    );
    const data = await adjustmentDependency(dependencies).createAdjustment(
      input,
      actorId,
      context.get('requestId'),
    );
    return context.json(success(context.get('requestId'), data), 201);
  });

  app.post(
    '/api/v1/account-adjustments/:adjustmentId/decisions',
    async (context) => {
      const actorId = requireActor(context.req.header('x-actor-id'));
      const adjustmentId = z.uuid().parse(context.req.param('adjustmentId'));
      const input = decideAccountAdjustmentInputSchema.parse(
        await context.req.json(),
      );
      const data = await adjustmentDependency(dependencies).decideAdjustment(
        adjustmentId,
        input,
        actorId,
        context.get('requestId'),
      );
      return context.json(success(context.get('requestId'), data));
    },
  );

  app.get('/api/v1/pricing', async (context) => {
    requireActor(context.req.header('x-actor-id'));
    const data = await operationsDependency(dependencies).getPricingOverview();
    return context.json(success(context.get('requestId'), data));
  });

  app.post('/api/v1/pricing/preview', async (context) => {
    requireActor(context.req.header('x-actor-id'));
    const input = publishPricingInputSchema.parse(await context.req.json());
    const data = await operationsDependency(dependencies).previewPricing(input);
    return context.json(success(context.get('requestId'), data));
  });

  app.post('/api/v1/pricing/publish', async (context) => {
    const actorId = requireActor(context.req.header('x-actor-id'));
    const input = publishPricingInputSchema.parse(await context.req.json());
    const data = await operationsDependency(dependencies).publishPricing(
      input,
      actorId,
      context.get('requestId'),
    );
    return context.json(success(context.get('requestId'), data), 201);
  });

  app.post('/api/v1/supplier-pricing/preview', async (context) => {
    requireActor(context.req.header('x-actor-id'));
    const input = publishSupplierPricingInputSchema.parse(
      await context.req.json(),
    );
    const data =
      await operationsDependency(dependencies).previewSupplierPricing(input);
    return context.json(success(context.get('requestId'), data));
  });

  app.post('/api/v1/supplier-pricing/publish', async (context) => {
    const actorId = requireActor(context.req.header('x-actor-id'));
    const input = publishSupplierPricingInputSchema.parse(
      await context.req.json(),
    );
    const data = await operationsDependency(
      dependencies,
    ).publishSupplierPricing(input, actorId, context.get('requestId'));
    return context.json(success(context.get('requestId'), data), 201);
  });

  app.get('/api/v1/supplier-settlements/:month/preview', async (context) => {
    requireActor(context.req.header('x-actor-id'));
    const month = supplierSettlementMonthSchema.parse(
      context.req.param('month'),
    );
    const data =
      await supplierSettlementDependency(dependencies).preview(month);
    return context.json(success(context.get('requestId'), data));
  });

  app.post('/api/v1/supplier-settlements/:month/finalize', async (context) => {
    const actorId = requireActor(context.req.header('x-actor-id'));
    const month = supplierSettlementMonthSchema.parse(
      context.req.param('month'),
    );
    const input = finalizeSupplierSettlementInputSchema.parse(
      await context.req.json(),
    );
    const data = await supplierSettlementDependency(dependencies).finalize(
      month,
      input,
      actorId,
      context.get('requestId'),
    );
    return context.json(
      success(context.get('requestId'), data),
      data.idempotentReplay ? 200 : 201,
    );
  });

  app.get('/api/v1/audit-logs', async (context) => {
    requireActor(context.req.header('x-actor-id'));
    const query = z
      .object({
        keyword: z.string().trim().max(200).optional(),
        category: operatorAuditCategorySchema.optional(),
        pageNum: z.coerce.number().int().min(0).default(0),
        pageSize: z.coerce.number().int().min(1).max(100).default(20),
      })
      .parse(context.req.query());
    const data = await auditDependency(dependencies).listAuditEvents({
      ...query,
      keyword: query.keyword || undefined,
    });
    return context.json(success(context.get('requestId'), data));
  });

  app.get('/api/v1/operations-overview', async (context) => {
    requireActor(context.req.header('x-actor-id'));
    const data = await overviewDependency(dependencies).getOverview();
    return context.json(success(context.get('requestId'), data));
  });

  app.get('/api/v1/integration-logs', async (context) => {
    requireActor(context.req.header('x-actor-id'));
    const query = z
      .object({
        keyword: z.string().trim().max(200).optional(),
        sourceSystem: integrationLogSystemSchema.optional(),
        direction: integrationLogDirectionSchema.optional(),
        status: integrationLogStatusSchema.optional(),
        pageNum: z.coerce.number().int().min(0).default(0),
        pageSize: z.coerce.number().int().min(1).max(100).default(20),
      })
      .parse(context.req.query());
    const data = await integrationLogDependency(dependencies).listLogs({
      ...query,
      keyword: query.keyword || undefined,
    });
    return context.json(success(context.get('requestId'), data));
  });

  app.post('/api/v1/callback-previews', async (context) => {
    requireActor(context.req.header('x-actor-id'));
    const input = callbackPreviewInputSchema.parse(await context.req.json());
    const data = callbackPreviewDependency(dependencies).generate(input);
    return context.json(success(context.get('requestId'), data));
  });

  app.get('/api/v1/dead-letters', async (context) => {
    requireActor(context.req.header('x-actor-id'));
    const query = z
      .object({
        keyword: z.string().trim().max(200).optional(),
        sourceType: operatorDeadLetterSourceTypeSchema.optional(),
        status: operatorDeadLetterStatusSchema.optional(),
        pageNum: z.coerce.number().int().min(0).default(0),
        pageSize: z.coerce.number().int().min(1).max(100).default(20),
      })
      .parse(context.req.query());
    const data = await recoveryDependency(dependencies).listDeadLetters({
      ...query,
      keyword: query.keyword || undefined,
    });
    return context.json(success(context.get('requestId'), data));
  });

  app.post('/api/v1/dead-letters/:deadLetterId/replay', async (context) => {
    const actorId = requireActor(context.req.header('x-actor-id'));
    const deadLetterId = z.uuid().parse(context.req.param('deadLetterId'));
    const input = replayDeadLetterInputSchema.parse(await context.req.json());
    const data = await recoveryDependency(dependencies).replayDeadLetter(
      deadLetterId,
      input,
      actorId,
      context.get('requestId'),
    );
    return context.json(success(context.get('requestId'), data), 202);
  });

  app.post('/api/v1/dead-letters/:deadLetterId/ignore', async (context) => {
    const actorId = requireActor(context.req.header('x-actor-id'));
    const deadLetterId = z.uuid().parse(context.req.param('deadLetterId'));
    const input = ignoreDeadLetterInputSchema.parse(await context.req.json());
    const data = await recoveryDependency(dependencies).ignoreDeadLetter(
      deadLetterId,
      input,
      actorId,
      context.get('requestId'),
    );
    return context.json(success(context.get('requestId'), data));
  });

  app.get('/api/v1/reconciliations', async (context) => {
    requireActor(context.req.header('x-actor-id'));
    const query = z
      .object({
        keyword: z.string().trim().max(200).optional(),
        status: taskReconciliationStatusSchema.optional(),
        pageNum: z.coerce.number().int().min(0).default(0),
        pageSize: z.coerce.number().int().min(1).max(100).default(20),
      })
      .parse(context.req.query());
    const data = await reconciliationDependency(
      dependencies,
    ).listReconciliations({
      ...query,
      keyword: query.keyword || undefined,
    });
    return context.json(success(context.get('requestId'), data));
  });

  app.post(
    '/api/v1/outbound-tasks/:taskNo/reconciliation/repair',
    async (context) => {
      const actorId = requireActor(context.req.header('x-actor-id'));
      const taskNo = z
        .string()
        .trim()
        .min(1)
        .max(64)
        .parse(context.req.param('taskNo'));
      const input = repairTaskReconciliationInputSchema.parse(
        await context.req.json(),
      );
      const data = await reconciliationDependency(dependencies).requestRepair(
        taskNo,
        input,
        actorId,
        context.get('requestId'),
      );
      if (!data.idempotentReplay)
        context.header('Idempotent-Replayed', 'false');
      else context.header('Idempotent-Replayed', 'true');
      return context.json(success(context.get('requestId'), data), 202);
    },
  );

  app.get('/api/v1/mappings', async (context) =>
    context.json(
      success(context.get('requestId'), {
        rules: await dependencies.mappingRepository.listPublishedRules(),
      }),
    ),
  );

  app.get('/api/v1/mappings/drafts', async (context) =>
    context.json(
      success(context.get('requestId'), {
        drafts: await dependencies.mappingRepository.listDrafts(),
      }),
    ),
  );

  app.post('/api/v1/mappings/drafts', async (context) => {
    const input = mappingDraftInputSchema.parse(await context.req.json());
    const actorId = requireActor(context.req.header('x-actor-id'));
    const draft = await dependencies.mappingRepository.saveDraft(
      input,
      actorId,
      context.get('requestId'),
    );
    return context.json(success(context.get('requestId'), { draft }), 201);
  });

  app.post('/api/v1/mappings/drafts/remove', async (context) => {
    const input = removeMappingDraftInputSchema.parse(await context.req.json());
    const actorId = requireActor(context.req.header('x-actor-id'));
    const draft = await dependencies.mappingRepository.stageRemoval(
      input,
      actorId,
      context.get('requestId'),
    );
    return context.json(success(context.get('requestId'), { draft }), 201);
  });

  app.post('/api/v1/mappings/publish', async (context) => {
    const input = publishMappingInputSchema.parse(await context.req.json());
    const actorId = requireActor(context.req.header('x-actor-id'));
    if (actorId !== input.publisherId)
      throw new MappingConflictError('发布人与当前操作人不一致');
    const published = await dependencies.mappingRepository.publishDrafts(
      input,
      context.get('requestId'),
    );
    return context.json(success(context.get('requestId'), published), 201);
  });

  app.get('/api/v1/mapping-versions', async (context) =>
    context.json(
      success(context.get('requestId'), {
        versions: await dependencies.mappingRepository.listVersions(),
      }),
    ),
  );

  app.get('/api/v1/scenes/readiness', async (context) =>
    context.json(
      success(context.get('requestId'), {
        scenes: await dependencies.mappingRepository.listSceneReadiness(),
      }),
    ),
  );

  app.get('/api/v1/planned-tasks', async (context) => {
    const { workflowClient, repository } =
      plannedTaskDependencies(dependencies);
    const query = z
      .object({
        name: z.string().trim().max(200).optional(),
        groupId: z.string().trim().max(128).optional(),
        groupName: z.string().trim().max(200).optional(),
        workflowId: z.string().trim().max(128).optional(),
        status: baiyingWorkflowStatusSchema.default('ALL'),
        pageNum: z.coerce.number().int().min(0).default(0),
        pageSize: z.coerce.number().int().min(1).max(100).default(20),
      })
      .parse(context.req.query());
    const page = await workflowClient.listWorkflows({
      name: query.name || undefined,
      groupId: query.groupId || undefined,
      groupName: query.groupName || undefined,
      workflowId: query.workflowId || undefined,
      workflowExecuteStatus: query.status,
      pageNum: query.pageNum,
      pageSize: query.pageSize,
    });
    const bindings = await repository.listBindings(
      page.workflows.map((workflow) => workflow.id),
    );
    const bindingByWorkflow = new Map(
      bindings.map((binding) => [binding.workflowId, binding]),
    );
    return context.json(
      success(context.get('requestId'), {
        total: page.total,
        pages: page.pages,
        pageNum: page.pageNum,
        pageSize: page.pageSize,
        tasks: page.workflows.map((workflow) => ({
          ...workflow,
          categoryBinding: bindingByWorkflow.get(workflow.id) ?? null,
        })),
      }),
    );
  });

  app.get('/api/v1/source-categories', async (context) => {
    const { repository } = plannedTaskDependencies(dependencies);
    const query = z
      .object({ sourceSystem: sourceSystemSchema.optional() })
      .parse(context.req.query());
    return context.json(
      success(context.get('requestId'), {
        categories: await repository.listSourceCategories(query.sourceSystem),
      }),
    );
  });

  app.get('/api/v1/data-categories', async (context) => {
    const query = z
      .object({
        sourceSystem: sourceSystemSchema.default('ERP'),
        studioId: z.string().trim().min(1).max(128).optional(),
      })
      .parse(context.req.query());
    const categories = await sourceCategoryRepository(
      dependencies,
    ).listSourceCategories(query.sourceSystem);
    const scriptRepository = dependencies.scriptRepository;
    if (!scriptRepository) throw new Error('话术绑定数据尚未配置');
    const bindings = (await scriptRepository.listAllBindings()).filter(
      (binding) =>
        binding.sourceSystem === query.sourceSystem &&
        (!query.studioId || binding.studioId === query.studioId),
    );
    const robotNames = new Map<string, string>();
    if (dependencies.robotClient && dependencies.baiyingCompanyId) {
      try {
        const robots = await dependencies.robotClient.listRobots(
          dependencies.baiyingCompanyId,
          0,
        );
        for (const robot of robots)
          robotNames.set(robot.robotDefId, robot.robotName);
      } catch {
        // 分类数据仍可使用；话术名称不可用时回退到话术 ID。
      }
    }
    const boundScripts = (externalId: string, categoryPath: string) =>
      Array.from(
        new Set(
          bindings
            .filter((binding) =>
              binding.categories.some(
                (category) =>
                  category.sourceCategoryId === externalId ||
                  category.categoryPath === categoryPath,
              ),
            )
            .map((binding) => binding.robotDefId),
        ),
      ).map((robotDefId) => ({
        robotDefId,
        robotName: robotNames.get(robotDefId) || '',
      }));

    return context.json(
      success(context.get('requestId'), {
        sourceSystem: query.sourceSystem,
        studioId: query.studioId ?? null,
        configured:
          query.sourceSystem === 'ERP'
            ? Boolean(dependencies.erpCategorySyncService || categories.length)
            : Boolean(categories.length),
        syncedAt: categories[0]?.syncedAt ?? null,
        categories: categories.map((category) => ({
          ...category,
          boundScripts: boundScripts(
            category.externalId,
            category.categoryPath,
          ),
        })),
      }),
    );
  });

  app.post('/api/v1/data-categories/sync', async (context) => {
    requireActor(context.req.header('x-actor-id'));
    const input = z
      .object({ sourceSystem: sourceSystemSchema.default('ERP') })
      .parse(await context.req.json().catch(() => ({})));
    if (input.sourceSystem !== 'ERP' || !dependencies.erpCategorySyncService) {
      return context.json(
        {
          error: {
            code: 'CATEGORY_SYNC_UNAVAILABLE',
            message: `${input.sourceSystem} 分类同步尚未配置`,
            requestId: context.get('requestId'),
          },
        },
        409,
      );
    }
    return context.json(
      success(
        context.get('requestId'),
        await dependencies.erpCategorySyncService.sync(),
      ),
    );
  });

  app.post('/api/v1/planned-task-category-bindings', async (context) => {
    const { repository } = plannedTaskDependencies(dependencies);
    const input = plannedTaskBindingInputSchema.parse(await context.req.json());
    const actorId = requireActor(context.req.header('x-actor-id'));
    const binding = await repository.saveBinding(
      input,
      actorId,
      context.get('requestId'),
    );
    return context.json(success(context.get('requestId'), { binding }), 201);
  });

  app.get('/api/v1/scripts', async (context) => {
    const { robotClient, scriptRepository, companyId } =
      scriptDependencies(dependencies);
    const query = z
      .object({
        query: z.string().trim().max(200).optional(),
        robotStatus: z.coerce.number().int().min(0).max(2).default(0),
        pageNum: z.coerce.number().int().min(0).default(0),
        pageSize: z.coerce.number().int().min(1).max(100).default(20),
      })
      .parse(context.req.query());
    const robots = await robotClient.listRobots(
      companyId,
      query.robotStatus as 0 | 1 | 2,
    );
    const needle = query.query?.toLocaleLowerCase('zh-CN');
    const filtered = needle
      ? robots.filter((robot) =>
          `${robot.robotName} ${robot.robotDefId}`
            .toLocaleLowerCase('zh-CN')
            .includes(needle),
        )
      : robots;
    const start = query.pageNum * query.pageSize;
    const pageRobots = filtered.slice(start, start + query.pageSize);
    const bindings = await scriptRepository.listBindings(
      pageRobots.map((robot) => robot.robotDefId),
    );
    const bindingByRobot = new Map(
      bindings.map((binding) => [binding.robotDefId, binding]),
    );
    return context.json(
      success(context.get('requestId'), {
        total: filtered.length,
        pages: Math.ceil(filtered.length / query.pageSize),
        pageNum: query.pageNum,
        pageSize: query.pageSize,
        scripts: pageRobots.map((robot) => ({
          ...robot,
          binding: bindingByRobot.get(robot.robotDefId) ?? null,
        })),
      }),
    );
  });

  app.post('/api/v1/script-bindings', async (context) => {
    const { scriptRepository } = scriptDependencies(dependencies);
    const input = scriptBindingInputSchema.parse(await context.req.json());
    const actorId = requireActor(context.req.header('x-actor-id'));
    const binding = await scriptRepository.saveBinding(
      input,
      actorId,
      context.get('requestId'),
    );
    return context.json(success(context.get('requestId'), { binding }), 201);
  });

  app.get('/api/v1/lines', async (context) => {
    const { lineClient, lineRepository, companyId } =
      lineDependencies(dependencies);
    const query = z
      .object({ query: z.string().trim().max(200).optional() })
      .parse(context.req.query());
    const attemptedAt = clock().toISOString();
    let managedLines: ManagedLine[];
    let sync:
      | {
          status: 'LIVE';
          attemptedAt: string;
          lastSuccessfulAt: string;
          errorCode: null;
          message: null;
        }
      | {
          status: 'STALE';
          attemptedAt: string;
          lastSuccessfulAt: string | null;
          errorCode: LineSyncErrorCode;
          message: string;
        };

    try {
      const lines = await lineClient.listPhones(companyId);
      managedLines = await lineRepository.synchronizeManagedLines(lines);
      sync = {
        status: 'LIVE',
        attemptedAt,
        lastSuccessfulAt: attemptedAt,
        errorCode: null,
        message: null,
      };
    } catch (error) {
      const errorCode =
        error instanceof LineSyncFailure ? error.code : 'LINE_SYNC_UNAVAILABLE';
      const cachedLines = await lineRepository.listManagedLines();
      if (!cachedLines.length) {
        throw new LineSyncFailure(
          errorCode,
          '百应线路同步失败，且暂无可用缓存，请稍后重试',
          { cause: error },
        );
      }
      managedLines = cachedLines;
      sync = {
        status: 'STALE',
        attemptedAt,
        lastSuccessfulAt: latestLineSyncAt(cachedLines),
        errorCode,
        message: '实时同步失败，当前展示上次成功缓存',
      };
    }
    const needle = query.query?.toLocaleLowerCase('zh-CN');
    const filtered = needle
      ? managedLines.filter((line) =>
          `${line.userPhoneId} ${line.phone} ${line.phoneName}`
            .toLocaleLowerCase('zh-CN')
            .includes(needle),
        )
      : managedLines;
    const bindings = await lineRepository.listBindings(
      filtered.map((line) => line.userPhoneId),
    );
    const studiosByLine = new Map<string, typeof bindings>();
    for (const binding of bindings) {
      const current = studiosByLine.get(binding.userPhoneId) ?? [];
      current.push(binding);
      studiosByLine.set(binding.userPhoneId, current);
    }
    return context.json(
      success(context.get('requestId'), {
        sync,
        lines: filtered.map((line) => ({
          ...line,
          studios: studiosByLine.get(line.userPhoneId) ?? [],
        })),
      }),
    );
  });

  app.get('/api/v1/managed-lines', async (context) => {
    const lineRepository = managedLineRepository(dependencies);
    const managedLines = await lineRepository.listManagedLines();
    const bindings = await lineRepository.listBindings(
      managedLines.map((line) => line.userPhoneId),
    );
    const studiosByLine = new Map<string, typeof bindings>();
    for (const binding of bindings) {
      const current = studiosByLine.get(binding.userPhoneId) ?? [];
      current.push(binding);
      studiosByLine.set(binding.userPhoneId, current);
    }
    return context.json(
      success(context.get('requestId'), {
        lines: managedLines.map((line) => ({
          ...line,
          studios: studiosByLine.get(line.userPhoneId) ?? [],
        })),
      }),
    );
  });

  app.post('/api/v1/line-studio-bindings', async (context) => {
    const lineRepository = managedLineRepository(dependencies);
    const input = lineStudioBindingInputSchema.parse(await context.req.json());
    const actorId = requireActor(context.req.header('x-actor-id'));
    const bindings = await lineRepository.saveBindings(
      input,
      actorId,
      context.get('requestId'),
    );
    return context.json(success(context.get('requestId'), { bindings }), 201);
  });

  app.post('/api/v1/variable-sync-jobs', async (context) => {
    const actorId = requireActor(context.req.header('x-actor-id'));
    const requested = {
      jobId: createId(),
      status: 'QUEUED' as const,
      requestedAt: clock().toISOString(),
    };
    await dependencies.mappingRepository.enqueueVariableSync({
      jobId: requested.jobId,
      requestedAt: requested.requestedAt,
      requestedBy: actorId,
    });
    return context.json(success(context.get('requestId'), requested), 202);
  });

  app.post('/api/v1/internal/scene-variable-observations', async (context) => {
    requireWorkerSecret(
      context.req.header('x-worker-secret'),
      dependencies.workerSharedSecret,
    );
    const body = z
      .object({
        observations: z.array(syncSceneObservationSchema).min(1).max(500),
      })
      .parse(await context.req.json());
    const readiness = [];
    for (const observation of body.observations) {
      readiness.push(
        await dependencies.mappingRepository.recordSuccessfulObservation(
          observation,
        ),
      );
    }
    return context.json(success(context.get('requestId'), { readiness }), 201);
  });

  app.post('/api/v1/internal/source-categories', async (context) => {
    requireWorkerSecret(
      context.req.header('x-worker-secret'),
      dependencies.workerSharedSecret,
    );
    const { repository } = plannedTaskDependencies(dependencies);
    const body = z
      .object({
        observations: z.array(sourceCategoryObservationSchema).min(1).max(2000),
      })
      .parse(await context.req.json());
    const categories = await repository.syncSourceCategories(body.observations);
    return context.json(success(context.get('requestId'), { categories }), 201);
  });

  app.post('/openapi/v1/outbound/tasks', async (context) => {
    const { authenticator, taskService } =
      externalApiDependencies(dependencies);
    const declaredLength = Number(context.req.header('content-length') ?? '0');
    if (Number.isFinite(declaredLength) && declaredLength > 25 * 1024 * 1024) {
      throw new ExternalApiFailure(
        'INVALID_REQUEST',
        '请求体超过 25 MiB 上限',
        413,
      );
    }
    const rawBody = new Uint8Array(await context.req.arrayBuffer());
    if (rawBody.byteLength > 25 * 1024 * 1024) {
      throw new ExternalApiFailure(
        'INVALID_REQUEST',
        '请求体超过 25 MiB 上限',
        413,
      );
    }
    const principal = await authenticateExternal(authenticator, context.req.raw);
    const idempotencyKey = context.req.header('idempotency-key')?.trim();
    if (
      !idempotencyKey ||
      idempotencyKey.length < 8 ||
      idempotencyKey.length > 128
    ) {
      throw new ExternalApiFailure(
        'INVALID_REQUEST',
        'Idempotency-Key 长度必须为 8～128 个字符',
        400,
      );
    }
    let json: unknown;
    try {
      json = JSON.parse(Buffer.from(rawBody).toString('utf8'));
    } catch {
      throw new ExternalApiFailure(
        'INVALID_REQUEST',
        '请求体不是有效 JSON',
        400,
      );
    }
    const parsedRequest = createOutboundTaskRequestSchema.safeParse(json);
    if (!parsedRequest.success) {
      const phoneIssue = parsedRequest.error.issues.find(
        (issue) => issue.path.at(-1) === 'phone',
      );
      if (phoneIssue) {
        const duplicated = phoneIssue.message.includes('不可重复');
        throw new ExternalApiFailure(
          duplicated ? 'PHONE_DUPLICATED' : 'PHONE_INVALID',
          phoneIssue.message,
          422,
          { issues: parsedRequest.error.issues },
        );
      }
      throw parsedRequest.error;
    }
    const request = parsedRequest.data;
    const result = await taskService.accept({
      principal,
      idempotencyKey,
      requestId: context.get('requestId'),
      requestHash: stableJsonSha256(request),
      request,
    });
    if (result.replayed) context.header('Idempotent-Replayed', 'true');
    return context.json(result.body, result.status);
  });

  app.post('/openapi/v2/outbound/tasks', async (context) => {
    const { authenticator, taskService } =
      externalApiDependencies(dependencies);
    const declaredLength = Number(context.req.header('content-length') ?? '0');
    if (Number.isFinite(declaredLength) && declaredLength > 25 * 1024 * 1024) {
      throw new ExternalApiFailure(
        'INVALID_REQUEST',
        '请求体超过 25 MiB 上限',
        413,
      );
    }
    const rawBody = new Uint8Array(await context.req.arrayBuffer());
    if (rawBody.byteLength > 25 * 1024 * 1024) {
      throw new ExternalApiFailure(
        'INVALID_REQUEST',
        '请求体超过 25 MiB 上限',
        413,
      );
    }
    const principal = await authenticateExternal(authenticator, context.req.raw);
    const idempotencyKey = context.req.header('idempotency-key')?.trim();
    if (
      !idempotencyKey ||
      idempotencyKey.length < 8 ||
      idempotencyKey.length > 128
    ) {
      throw new ExternalApiFailure(
        'INVALID_REQUEST',
        'Idempotency-Key 长度必须为 8～128 个字符',
        400,
      );
    }
    let json: unknown;
    try {
      json = JSON.parse(Buffer.from(rawBody).toString('utf8'));
    } catch {
      throw new ExternalApiFailure(
        'INVALID_REQUEST',
        '请求体不是有效 JSON',
        400,
      );
    }
    const parsedRequest = createOutboundBatchRequestV2Schema.safeParse(json);
    if (!parsedRequest.success) {
      const duplicateGuid = parsedRequest.error.issues.find(
        (issue) =>
          issue.path.at(-1) === 'guid' && issue.message.includes('不可重复'),
      );
      if (duplicateGuid) {
        throw new ExternalApiFailure(
          'GUID_DUPLICATED',
          duplicateGuid.message,
          422,
          { issues: parsedRequest.error.issues },
        );
      }
      const phoneIssue = parsedRequest.error.issues.find(
        (issue) => issue.path.at(-1) === 'phone',
      );
      if (phoneIssue) {
        throw new ExternalApiFailure(
          phoneIssue.message.includes('不可重复')
            ? 'PHONE_DUPLICATED'
            : 'PHONE_INVALID',
          phoneIssue.message,
          422,
          { issues: parsedRequest.error.issues },
        );
      }
      throw parsedRequest.error;
    }
    const request = parsedRequest.data;
    const result = await taskService.acceptV2({
      principal,
      idempotencyKey,
      requestId: context.get('requestId'),
      requestHash: rawBodySha256(rawBody),
      request,
    });
    if (result.replayed) context.header('Idempotent-Replayed', 'true');
    return context.json(result.body, result.status);
  });

  app.get('/openapi/v2/outbound/batches/:batchId', async (context) => {
    const { authenticator, taskService } =
      externalApiDependencies(dependencies);
    const principal = await authenticateExternal(authenticator, context.req.raw);
    const batchId = z.uuid().parse(context.req.param('batchId'));
    return context.json({
      code: 'OK',
      message: 'success',
      request_id: context.get('requestId'),
      data: await taskService.getBatchV2(principal, batchId),
    });
  });

  app.get('/openapi/v1/outbound/tasks/:taskNo', async (context) => {
    const { authenticator, taskService } =
      externalApiDependencies(dependencies);
    const principal = await authenticateExternal(authenticator, context.req.raw);
    const taskNo = z
      .string()
      .regex(/^PT-\d{8}-\d{5,}$/)
      .parse(context.req.param('taskNo'));
    return context.json({
      code: 'OK',
      message: 'success',
      requestId: context.get('requestId'),
      data: await taskService.getTask(principal, taskNo),
    });
  });

  app.get('/openapi/v1/outbound/tasks/:taskNo/calls', async (context) => {
    const { authenticator, taskService } =
      externalApiDependencies(dependencies);
    const principal = await authenticateExternal(authenticator, context.req.raw);
    const taskNo = z
      .string()
      .regex(/^PT-\d{8}-\d{5,}$/)
      .parse(context.req.param('taskNo'));
    const query = z
      .object({
        cursor: z.string().trim().min(1).max(512).optional(),
        limit: z.coerce.number().int().min(1).max(500).default(200),
      })
      .parse(context.req.query());
    return context.json({
      code: 'OK',
      message: 'success',
      requestId: context.get('requestId'),
      data: await taskService.listCalls(principal, taskNo, query),
    });
  });

  app.post(
    '/openapi/v1/outbound/recordings/:recordingId/download-url',
    async (context) => {
      const rawBody = new Uint8Array(await context.req.arrayBuffer());
      if (rawBody.byteLength > 1_024) {
        throw new ExternalApiFailure(
          'INVALID_REQUEST',
          '重新签发请求体超过 1 KiB 上限',
          413,
        );
      }
      const principal = await authenticateExternal(
        externalAuthenticatorDependency(dependencies),
        context.req.raw,
      );
      if (rawBody.byteLength > 0) {
        throw new ExternalApiFailure(
          'INVALID_REQUEST',
          '录音重新签发接口不接受请求体',
          400,
        );
      }
      const idempotencyKey = context.req.header('idempotency-key')?.trim();
      if (
        !idempotencyKey ||
        idempotencyKey.length < 8 ||
        idempotencyKey.length > 128
      ) {
        throw new ExternalApiFailure(
          'INVALID_REQUEST',
          'Idempotency-Key 长度必须为 8～128 个字符',
          400,
        );
      }
      const recordingId = z.uuid().parse(context.req.param('recordingId'));
      const result = await recordingUrlReissueDependency(dependencies).issue({
        recordingId,
        principal,
        idempotencyKey,
        requestId: context.get('requestId'),
      });
      if (result.replayed) {
        context.header('Idempotent-Replayed', 'true');
        context.header('X-Request-Id', result.body.requestId);
      }
      return context.json(result.body, result.status);
    },
  );

  app.notFound((context) =>
    context.req.path.startsWith('/openapi/')
      ? context.json(
          {
            code: 'INVALID_REQUEST',
            message: '接口不存在',
            requestId: context.get('requestId'),
          },
          404,
        )
      : context.json(
          {
            error: {
              code: 'NOT_FOUND',
              message: '接口不存在',
              requestId: context.get('requestId'),
            },
          },
          404,
        ),
  );

  app.onError((error, context) => {
    const requestId = context.get('requestId');
    if (error instanceof OperationsConsoleFailure) {
      return context.json(
        {
          error: {
            code: error.code,
            message: error.message,
            requestId,
            ...(error.details ? { details: error.details } : {}),
          },
        },
        error.status,
      );
    }
    if (error instanceof RecordingAccessFailure) {
      if (context.req.path.startsWith('/openapi/')) {
        const code =
          error.code === 'RECORDING_URL_INVALID'
            ? 'INVALID_REQUEST'
            : error.code;
        return context.json(
          {
            code,
            message: error.message,
            requestId,
          },
          error.status,
        );
      }
      return context.json(
        {
          error: {
            code: error.code,
            message: error.message,
            requestId,
          },
        },
        error.status,
      );
    }
    if (error instanceof ExternalApiFailure) {
      if (!context.req.path.startsWith('/openapi/')) {
        return context.json(
          {
            error: {
              code: error.code,
              message: error.message,
              requestId,
              ...(error.details ? { details: error.details } : {}),
            },
          },
          error.status,
        );
      }
      return context.json(
        {
          code: error.code,
          message: error.message,
          requestId,
          ...(error.details ? { details: error.details } : {}),
        },
        error.status,
      );
    }
    if (error instanceof z.ZodError) {
      if (context.req.path.startsWith('/openapi/')) {
        return context.json(
          {
            code: 'INVALID_REQUEST',
            message: '请求参数不合法',
            requestId,
            details: { issues: error.issues },
          },
          400,
        );
      }
      return context.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: '请求参数不合法',
            requestId,
            details: { issues: error.issues },
          },
        },
        400,
      );
    }
    if (error instanceof MappingNotFoundError) {
      return context.json(
        {
          error: {
            code: 'MAPPING_NOT_FOUND',
            message: error.message,
            requestId,
          },
        },
        404,
      );
    }
    if (error instanceof MappingConflictError) {
      return context.json(
        {
          error: {
            code: 'MAPPING_CONFLICT',
            message: error.message,
            requestId,
          },
        },
        409,
      );
    }
    if (error instanceof ScriptBindingConflictError) {
      return context.json(
        {
          error: {
            code: 'SCRIPT_BINDING_CONFLICT',
            message: error.message,
            requestId,
          },
        },
        409,
      );
    }
    if (error instanceof LineSyncFailure) {
      return context.json(
        {
          error: {
            code: error.code,
            message: error.message,
            requestId,
          },
        },
        503,
      );
    }
    if (error instanceof LineBindingConflictError) {
      return context.json(
        {
          error: {
            code: 'LINE_BINDING_CONFLICT',
            message: error.message,
            requestId,
          },
        },
        409,
      );
    }
    if (error instanceof UnauthorizedError) {
      return context.json(
        { error: { code: 'UNAUTHORIZED', message: error.message, requestId } },
        401,
      );
    }
    if (error instanceof CallbackBodyTooLargeError) {
      return context.json(
        {
          error: {
            code: 'PAYLOAD_TOO_LARGE',
            message: error.message,
            requestId,
          },
        },
        413,
      );
    }
    console.error(
      JSON.stringify({ level: 'error', requestId, message: error.message }),
    );
    if (context.req.path.startsWith('/openapi/')) {
      return context.json(
        {
          code: 'SERVICE_TEMPORARILY_UNAVAILABLE',
          message: '平台暂不可受理请求，请稍后重试',
          requestId,
        },
        503,
      );
    }
    return context.json(
      {
        error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用', requestId },
      },
      500,
    );
  });

  return app;
}

function consoleTaskDependency(dependencies: AppDependencies) {
  if (!dependencies.outboundTaskService) {
    throw new ExternalApiFailure(
      'SERVICE_TEMPORARILY_UNAVAILABLE',
      '运营任务查询服务尚未配置',
      503,
    );
  }
  return dependencies.outboundTaskService;
}

function operatorSessionDependency(dependencies: AppDependencies) {
  if (!dependencies.operatorSessionService) {
    throw new UnauthorizedError('运营后台登录服务尚未配置');
  }
  return dependencies.operatorSessionService;
}

function operationsDependency(dependencies: AppDependencies) {
  if (!dependencies.operationsConsoleService) {
    throw new OperationsConsoleFailure(
      'SERVICE_TEMPORARILY_UNAVAILABLE',
      '运营配置与账务服务尚未配置',
      503,
    );
  }
  return dependencies.operationsConsoleService;
}

function adjustmentDependency(dependencies: AppDependencies) {
  if (!dependencies.accountAdjustmentService) {
    throw new OperationsConsoleFailure(
      'SERVICE_TEMPORARILY_UNAVAILABLE',
      '退款与调整审批服务尚未配置',
      503,
    );
  }
  return dependencies.accountAdjustmentService;
}

function supplierSettlementDependency(dependencies: AppDependencies) {
  if (!dependencies.supplierMonthlySettlementService) {
    throw new OperationsConsoleFailure(
      'SERVICE_TEMPORARILY_UNAVAILABLE',
      '供应商月度结算服务尚未配置',
      503,
    );
  }
  return dependencies.supplierMonthlySettlementService;
}

function auditDependency(dependencies: AppDependencies) {
  if (!dependencies.operatorAuditService) {
    throw new OperationsConsoleFailure(
      'SERVICE_TEMPORARILY_UNAVAILABLE',
      '操作审计查询服务尚未配置',
      503,
    );
  }
  return dependencies.operatorAuditService;
}

function overviewDependency(dependencies: AppDependencies) {
  if (!dependencies.operationsOverviewService) {
    throw new OperationsConsoleFailure(
      'SERVICE_TEMPORARILY_UNAVAILABLE',
      '运营总览服务尚未配置',
      503,
    );
  }
  return dependencies.operationsOverviewService;
}

function integrationLogDependency(dependencies: AppDependencies) {
  if (!dependencies.integrationLogService) {
    throw new OperationsConsoleFailure(
      'SERVICE_TEMPORARILY_UNAVAILABLE',
      '接口日志查询服务尚未配置',
      503,
    );
  }
  return dependencies.integrationLogService;
}

function callbackPreviewDependency(dependencies: AppDependencies) {
  if (!dependencies.callbackPreviewService) {
    throw new OperationsConsoleFailure(
      'CALLBACK_PREVIEW_NOT_CONFIGURED',
      '安全回调预览服务尚未配置',
      503,
    );
  }
  return dependencies.callbackPreviewService;
}

function recordingAccessDependency(dependencies: AppDependencies) {
  if (!dependencies.recordingAccessService) {
    throw new RecordingAccessFailure(
      'RECORDING_OBJECT_UNAVAILABLE',
      '录音访问服务尚未配置',
      503,
    );
  }
  return dependencies.recordingAccessService;
}

function recordingUrlReissueDependency(dependencies: AppDependencies) {
  if (!dependencies.recordingUrlReissueService) {
    throw new ExternalApiFailure(
      'SERVICE_TEMPORARILY_UNAVAILABLE',
      '录音重签服务尚未配置',
      503,
    );
  }
  return dependencies.recordingUrlReissueService;
}

function recoveryDependency(dependencies: AppDependencies) {
  if (!dependencies.recoveryOperationsService) {
    throw new OperationsConsoleFailure(
      'SERVICE_TEMPORARILY_UNAVAILABLE',
      '异常恢复服务尚未配置',
      503,
    );
  }
  return dependencies.recoveryOperationsService;
}

function reconciliationDependency(dependencies: AppDependencies) {
  if (!dependencies.reconciliationOperations) {
    throw new OperationsConsoleFailure(
      'RECONCILIATION_NOT_CONFIGURED',
      '百应通话对账服务尚未配置',
      503,
    );
  }
  return dependencies.reconciliationOperations;
}

function taskControlDependency(dependencies: AppDependencies) {
  if (!dependencies.taskControlService) {
    throw new OperationsConsoleFailure(
      'TASK_CONTROL_NOT_CONFIGURED',
      '任务控制尚未接入百应写接口；生产环境禁止使用本地模拟器',
      503,
    );
  }
  return dependencies.taskControlService;
}

function externalApiDependencies(dependencies: AppDependencies) {
  if (
    !dependencies.externalRequestAuthenticator ||
    !dependencies.outboundTaskService
  ) {
    throw new ExternalApiFailure(
      'SERVICE_TEMPORARILY_UNAVAILABLE',
      '外部任务受理服务尚未配置',
      503,
    );
  }
  return {
    authenticator: dependencies.externalRequestAuthenticator,
    taskService: dependencies.outboundTaskService,
  };
}

function externalAuthenticatorDependency(dependencies: AppDependencies) {
  if (!dependencies.externalRequestAuthenticator) {
    throw new ExternalApiFailure(
      'SERVICE_TEMPORARILY_UNAVAILABLE',
      '外部身份认证服务尚未配置',
      503,
    );
  }
  return dependencies.externalRequestAuthenticator;
}

function authenticateExternal(
  authenticator: ExternalRequestAuthenticator,
  request: Request,
) {
  return authenticator.authenticate({
    accessToken: request.headers.get('x-access-token') ?? undefined,
  });
}

async function readUtf8BodyWithLimit(
  request: Request,
  maxBytes: number,
): Promise<string> {
  const contentLength = request.headers.get('content-length');
  if (contentLength) {
    const declared = Number(contentLength);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new CallbackBodyTooLargeError(
        `百应回调正文超过 ${maxBytes} 字节限制`,
      );
    }
  }
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > maxBytes) {
      await reader.cancel();
      throw new CallbackBodyTooLargeError(
        `百应回调正文超过 ${maxBytes} 字节限制`,
      );
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString(
    'utf8',
  );
}

function plannedTaskDependencies(dependencies: AppDependencies) {
  if (!dependencies.workflowClient || !dependencies.plannedTaskRepository) {
    throw new Error('计划任务服务尚未配置');
  }
  return {
    workflowClient: dependencies.workflowClient,
    repository: dependencies.plannedTaskRepository,
  };
}

function sourceCategoryRepository(dependencies: AppDependencies) {
  if (!dependencies.plannedTaskRepository)
    throw new Error('数据分类存储尚未配置');
  return dependencies.plannedTaskRepository;
}

function scriptDependencies(dependencies: AppDependencies) {
  if (
    !dependencies.robotClient ||
    !dependencies.scriptRepository ||
    !dependencies.baiyingCompanyId
  ) {
    throw new Error('话术列表服务尚未配置');
  }
  return {
    robotClient: dependencies.robotClient,
    scriptRepository: dependencies.scriptRepository,
    companyId: dependencies.baiyingCompanyId,
  };
}

function lineDependencies(dependencies: AppDependencies) {
  if (
    !dependencies.lineClient ||
    !dependencies.lineRepository ||
    !dependencies.baiyingCompanyId
  ) {
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

function latestLineSyncAt(lines: ManagedLine[]): string | null {
  let latest: string | null = null;
  for (const line of lines) {
    if (!latest || line.syncedAt > latest) latest = line.syncedAt;
  }
  return latest;
}

async function settleSection<T>(promise: Promise<T>) {
  try {
    return { status: 'success' as const, data: await promise };
  } catch (error) {
    return {
      status: 'error' as const,
      message: error instanceof Error ? error.message : '百应接口请求失败',
    };
  }
}

function requireActor(value: string | undefined): string {
  const actorId = value?.trim();
  if (!actorId) throw new UnauthorizedError('缺少操作人身份');
  return actorId;
}

function requireWorkerSecret(
  provided: string | undefined,
  expected: string,
): void {
  if (!provided) throw new UnauthorizedError('缺少 worker 凭证');
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    throw new UnauthorizedError('worker 凭证无效');
  }
}

class UnauthorizedError extends Error {}

function isPublicOperatorApi(path: string): boolean {
  return (
    path === '/api/v1/operator-session' ||
    path === '/api/v1/callbacks/baiying' ||
    path === '/api/v1/callbacks/baiying/call-instance' ||
    /^\/api\/v1\/recordings\/[^/]+\/content$/.test(path)
  );
}

function operatorSessionCookieOptions(secure: boolean, maxAge: number) {
  return {
    httpOnly: true,
    maxAge,
    path: '/',
    secure,
    sameSite: secure ? ('None' as const) : ('Lax' as const),
  };
}

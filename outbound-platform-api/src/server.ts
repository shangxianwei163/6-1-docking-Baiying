import 'dotenv/config';
import { resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { readConfig } from './config.js';
import { createDatabase } from './db/client.js';
import { createApp } from './http/app.js';
import { PostgresMappingRepository } from './mapping/postgres-repository.js';
import { HttpBaiyingVariableClient } from './baiying/client.js';
import { OAuthBaiyingTokenProvider } from './baiying/token-provider.js';
import { PostgresPlannedTaskRepository } from './planned-task/postgres-repository.js';
import { PostgresScriptRepository } from './script/postgres-repository.js';
import { PostgresLineRepository } from './line/postgres-repository.js';
import { HttpSxErpCategoryClient } from './source-category/client.js';
import { ErpCategorySyncService } from './source-category/sync-service.js';
import { LocalDevelopmentSecretProvider } from './security/secret-provider.js';
import { LocalDataProtector } from './security/data-protector.js';
import { PostgresExternalRequestAuthenticator } from './openapi/authenticator.js';
import { PostgresOutboundTaskService } from './outbound-task/service.js';
import { PostgresCallbackInboxRepository } from './callback/postgres-repository.js';
import { BaiyingCallbackIngressService } from './callback/ingress-service.js';
import { PostgresOperationsConsoleService } from './operations/service.js';
import { PostgresAccountAdjustmentService } from './operations/adjustment-service.js';
import { PostgresSupplierMonthlySettlementService } from './billing/monthly-settlement-service.js';
import { PostgresOperatorAuditService } from './operations/audit-service.js';
import { PostgresOperationsOverviewService } from './operations/overview-service.js';
import { PostgresIntegrationLogService } from './operations/integration-log-service.js';
import { PostgresRecoveryOperationsService } from './operations/recovery-service.js';
import {
  LocalTaskCommandExecutor,
  PostgresTaskControlService,
} from './operations/task-control-service.js';
import { SafeCallbackPreviewService } from './operations/callback-preview-service.js';
import { RecordingAccessService } from './recording/access-service.js';
import { PostgresRecordingUrlReissueService } from './recording/reissue-service.js';
import { LocalRecordingObjectStore } from './recording/local-object-store.js';
import { PostgresRecordingAccessRepository } from './recording/postgres-access-repository.js';
import { LocalRecordingUrlSigner } from './recording/url-signer.js';

for (const name of [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
]) {
  Reflect.deleteProperty(process.env, name);
}

const config = readConfig();
const database = createDatabase(config.DATABASE_URL);
const repository = new PostgresMappingRepository(
  database.db,
  config.VARIABLE_SYNC_QUEUE_NAME,
);
const plannedTaskRepository = new PostgresPlannedTaskRepository(
  database.db,
  () => new Date(),
  config.NODE_ENV !== 'production',
);
const scriptRepository = new PostgresScriptRepository(database.db);
const lineRepository = new PostgresLineRepository(database.db);
const erpCategoryClient = new HttpSxErpCategoryClient(
  config.SX_ERP_CATEGORY_URL,
);
const erpCategorySyncService = config.SX_ERP_CATEGORY_TOKEN
  ? new ErpCategorySyncService(
      erpCategoryClient,
      config.SX_ERP_CATEGORY_TOKEN,
      plannedTaskRepository,
    )
  : undefined;
const localSecretProvider =
  config.NODE_ENV === 'production'
    ? undefined
    : new LocalDevelopmentSecretProvider(
        config.WORKER_SHARED_SECRET,
        config.NODE_ENV,
      );
const externalRequestAuthenticator = localSecretProvider
  ? new PostgresExternalRequestAuthenticator(database.db, localSecretProvider)
  : undefined;
const localDataProtector =
  config.NODE_ENV === 'production'
    ? undefined
    : new LocalDataProtector(config.WORKER_SHARED_SECRET, config.NODE_ENV);
const supplierMonthlySettlementService =
  new PostgresSupplierMonthlySettlementService(database.db);
const outboundTaskService = localSecretProvider
  ? new PostgresOutboundTaskService(database.db, localDataProtector!, {
      baiyingCompanyId: config.BAIYING_COMPANY_ID ?? 'LOCAL-MOCK',
      queueName: config.TASK_ORCHESTRATION_QUEUE_NAME,
      supplierMonthlySettlementService,
    })
  : undefined;
const baiyingCallbackIngress = localDataProtector
  ? new BaiyingCallbackIngressService(
      new PostgresCallbackInboxRepository(database.db),
      localDataProtector,
    )
  : undefined;
const operationsConsoleService = new PostgresOperationsConsoleService(
  database.db,
  localDataProtector,
);
const accountAdjustmentService = new PostgresAccountAdjustmentService(
  database.db,
);
const operatorAuditService = new PostgresOperatorAuditService(database.db);
const operationsOverviewService = new PostgresOperationsOverviewService(
  database.db,
);
const integrationLogService = new PostgresIntegrationLogService(database.db);
const recoveryOperationsService = new PostgresRecoveryOperationsService(
  database.db,
);
const taskControlService =
  config.NODE_ENV === 'production'
    ? undefined
    : new PostgresTaskControlService(
        database.db,
        new LocalTaskCommandExecutor(),
        { taskQueueName: config.TASK_ORCHESTRATION_QUEUE_NAME },
      );
const callbackPreviewService = new SafeCallbackPreviewService();
const recordingUrlSigner = localDataProtector
  ? new LocalRecordingUrlSigner(config.WORKER_SHARED_SECRET, config.NODE_ENV)
  : undefined;
const recordingAccessService = recordingUrlSigner
  ? new RecordingAccessService(
      new PostgresRecordingAccessRepository(database.db),
      new LocalRecordingObjectStore(resolve(config.RECORDING_LOCAL_ROOT)),
      recordingUrlSigner,
      {
        publicBaseUrl: config.RECORDING_PUBLIC_BASE_URL,
        ttlSeconds: config.RECORDING_DOWNLOAD_TTL_SECONDS,
        environment: config.NODE_ENV,
      },
    )
  : undefined;
const recordingUrlReissueService = recordingUrlSigner
  ? new PostgresRecordingUrlReissueService(database.db, recordingUrlSigner, {
      publicBaseUrl: config.RECORDING_CALLBACK_BASE_URL,
      ttlSeconds: config.RECORDING_DOWNLOAD_TTL_SECONDS,
      environment: config.NODE_ENV,
    })
  : undefined;
const baiyingTokenProvider =
  config.BAIYING_TOKEN_URL &&
  config.BAIYING_APP_KEY &&
  config.BAIYING_APP_SECRET &&
  config.BAIYING_COMPANY_ID
    ? new OAuthBaiyingTokenProvider({
        tokenUrl: config.BAIYING_TOKEN_URL,
        appKey: config.BAIYING_APP_KEY,
        appSecret: config.BAIYING_APP_SECRET,
        companyId: config.BAIYING_COMPANY_ID,
      })
    : undefined;
const workflowClient =
  config.BAIYING_BASE_URL && baiyingTokenProvider
    ? new HttpBaiyingVariableClient({
        baseUrl: config.BAIYING_BASE_URL,
        tokenProvider: baiyingTokenProvider,
      })
    : undefined;
const app = createApp({
  mappingRepository: repository,
  plannedTaskRepository,
  workflowClient,
  robotClient: workflowClient,
  scriptRepository,
  lineClient: workflowClient,
  accountClient: workflowClient,
  lineRepository,
  erpCategorySyncService,
  externalRequestAuthenticator,
  outboundTaskService,
  operationsConsoleService,
  accountAdjustmentService,
  supplierMonthlySettlementService,
  operatorAuditService,
  operationsOverviewService,
  integrationLogService,
  recoveryOperationsService,
  taskControlService,
  callbackPreviewService,
  recordingAccessService,
  recordingUrlReissueService,
  baiyingCallbackIngress,
  baiyingCompanyId: config.BAIYING_COMPANY_ID,
  consoleOrigin: config.CONSOLE_ORIGIN,
  workerSharedSecret: config.WORKER_SHARED_SECRET,
});

const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.info(
    JSON.stringify({ level: 'info', message: 'API started', port: info.port }),
  );
});

let categorySyncTimer: NodeJS.Timeout | undefined;
async function synchronizeErpCategories(trigger: 'startup' | 'schedule') {
  if (!erpCategorySyncService) return;
  try {
    const result = await erpCategorySyncService.sync();
    console.info(
      JSON.stringify({
        level: 'info',
        message: 'ERP categories synchronized',
        trigger,
        ...result,
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        message: 'ERP category synchronization failed; cached data retained',
        trigger,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

if (erpCategorySyncService) {
  void synchronizeErpCategories('startup');
  categorySyncTimer = setInterval(
    () => void synchronizeErpCategories('schedule'),
    config.SX_ERP_CATEGORY_SYNC_INTERVAL_MS,
  );
  categorySyncTimer.unref();
}

async function shutdown(signal: string) {
  console.info(
    JSON.stringify({ level: 'info', message: 'API shutting down', signal }),
  );
  server.close();
  if (categorySyncTimer) clearInterval(categorySyncTimer);
  await database.close();
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

import 'dotenv/config';
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

for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
  Reflect.deleteProperty(process.env, name);
}

const config = readConfig();
const database = createDatabase(config.DATABASE_URL);
const repository = new PostgresMappingRepository(database.db, config.VARIABLE_SYNC_QUEUE_NAME);
const plannedTaskRepository = new PostgresPlannedTaskRepository(database.db);
const scriptRepository = new PostgresScriptRepository(database.db);
const lineRepository = new PostgresLineRepository(database.db);
const erpCategoryClient = new HttpSxErpCategoryClient(config.SX_ERP_CATEGORY_URL);
const erpCategorySyncService = config.SX_ERP_CATEGORY_TOKEN
  ? new ErpCategorySyncService(erpCategoryClient, config.SX_ERP_CATEGORY_TOKEN, plannedTaskRepository)
  : undefined;
const baiyingTokenProvider = config.BAIYING_TOKEN_URL && config.BAIYING_APP_KEY && config.BAIYING_APP_SECRET && config.BAIYING_COMPANY_ID
  ? new OAuthBaiyingTokenProvider({
      tokenUrl: config.BAIYING_TOKEN_URL,
      appKey: config.BAIYING_APP_KEY,
      appSecret: config.BAIYING_APP_SECRET,
      companyId: config.BAIYING_COMPANY_ID,
    })
  : undefined;
const workflowClient = config.BAIYING_BASE_URL && baiyingTokenProvider
  ? new HttpBaiyingVariableClient({ baseUrl: config.BAIYING_BASE_URL, tokenProvider: baiyingTokenProvider })
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
  baiyingCompanyId: config.BAIYING_COMPANY_ID,
  consoleOrigin: config.CONSOLE_ORIGIN,
  workerSharedSecret: config.WORKER_SHARED_SECRET,
});

const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.info(JSON.stringify({ level: 'info', message: 'API started', port: info.port }));
});

let categorySyncTimer: NodeJS.Timeout | undefined;
async function synchronizeErpCategories(trigger: 'startup' | 'schedule') {
  if (!erpCategorySyncService) return;
  try {
    const result = await erpCategorySyncService.sync();
    console.info(JSON.stringify({ level: 'info', message: 'ERP categories synchronized', trigger, ...result }));
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', message: 'ERP category synchronization failed; cached data retained', trigger, error: error instanceof Error ? error.message : String(error) }));
  }
}

if (erpCategorySyncService) {
  void synchronizeErpCategories('startup');
  categorySyncTimer = setInterval(() => void synchronizeErpCategories('schedule'), config.SX_ERP_CATEGORY_SYNC_INTERVAL_MS);
  categorySyncTimer.unref();
}

async function shutdown(signal: string) {
  console.info(JSON.stringify({ level: 'info', message: 'API shutting down', signal }));
  server.close();
  if (categorySyncTimer) clearInterval(categorySyncTimer);
  await database.close();
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

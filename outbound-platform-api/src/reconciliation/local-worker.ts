import 'dotenv/config';
import { hostname } from 'node:os';
import { readBaiyingConfig, readConfig } from '../config.js';
import { createDatabase } from '../db/client.js';
import { HttpBaiyingCallJobClient } from '../baiying/http-call-job-client.js';
import { OAuthBaiyingTokenProvider } from '../baiying/token-provider.js';
import { createRuntimeDataProtector } from '../security/data-protector.js';
import { PostgresCallbackInboxRepository } from '../callback/postgres-repository.js';
import { BaiyingCallbackIngressService } from '../callback/ingress-service.js';
import { PostgresReconciliationRepository } from './postgres-repository.js';
import { BaiyingReconciliationService } from './service.js';

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
const baiying = readBaiyingConfig();
const database = createDatabase(config.DATABASE_URL);
const tokenProvider = new OAuthBaiyingTokenProvider({
  tokenUrl: baiying.BAIYING_TOKEN_URL,
  appKey: baiying.BAIYING_APP_KEY,
  appSecret: baiying.BAIYING_APP_SECRET,
  companyId: baiying.BAIYING_COMPANY_ID,
});
const client = new HttpBaiyingCallJobClient({
  baseUrl: baiying.BAIYING_BASE_URL,
  tokenProvider,
  timeoutMs: config.BAIYING_REQUEST_TIMEOUT_MS,
});
const protector = createRuntimeDataProtector(
  config.WORKER_SHARED_SECRET,
  config.NODE_ENV,
);
const callbackRepository = new PostgresCallbackInboxRepository(database.db);
const callbackIngress = new BaiyingCallbackIngressService(
  callbackRepository,
  protector,
);
const reconciliationRepository = new PostgresReconciliationRepository(
  database.db,
);
const workerId = `reconciliation-${hostname()}-${process.pid}`.slice(0, 128);
const service = new BaiyingReconciliationService(
  reconciliationRepository,
  client,
  callbackIngress,
  {
    workerId,
    manualReviewAfterMs: config.RECONCILIATION_MANUAL_REVIEW_MS,
  },
);

let stopping = false;
let running = false;

async function cycle() {
  if (stopping || running) return;
  running = true;
  try {
    const now = new Date();
    const seeded = await reconciliationRepository.seedCandidates({
      staleBefore: new Date(
        now.getTime() - config.RECONCILIATION_STALE_TASK_MS,
      ),
      now,
    });
    let processed = 0;
    for (; processed < 20; processed += 1) {
      const result = await service.runOnce();
      if (result.status === 'IDLE') break;
      console.info(
        JSON.stringify({
          level: result.status === 'FAILED' ? 'error' : 'info',
          message: 'Baiying reconciliation cycle item',
          ...result,
        }),
      );
    }
    if (seeded || processed) {
      console.info(
        JSON.stringify({
          level: 'info',
          message: 'Baiying reconciliation cycle completed',
          seeded,
          processed,
        }),
      );
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        message: 'Baiying reconciliation cycle failed',
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  } finally {
    running = false;
  }
}

console.info(
  JSON.stringify({
    level: 'info',
    message: 'Baiying reconciliation worker started',
    workerId,
    intervalMs: config.RECONCILIATION_WORKER_INTERVAL_MS,
    staleTaskMs: config.RECONCILIATION_STALE_TASK_MS,
    manualReviewMs: config.RECONCILIATION_MANUAL_REVIEW_MS,
  }),
);
void cycle();
const timer = setInterval(
  () => void cycle(),
  config.RECONCILIATION_WORKER_INTERVAL_MS,
);

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  console.info(
    JSON.stringify({
      level: 'info',
      message: 'Baiying reconciliation worker stopping',
      signal,
    }),
  );
  while (running) await new Promise((resolve) => setTimeout(resolve, 25));
  await database.close();
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

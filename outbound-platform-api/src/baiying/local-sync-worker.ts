import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { readBaiyingConfig, readConfig } from '../config.js';
import { createDatabase } from '../db/client.js';
import { PostgresMappingRepository } from '../mapping/postgres-repository.js';
import { PostgresOutboxRepository } from '../outbox/postgres-repository.js';
import { HttpBaiyingVariableClient } from './client.js';
import { syncBaiyingCompany } from './discovery-sync.js';
import { OAuthBaiyingTokenProvider } from './token-provider.js';

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

const appConfig = readConfig();
const baiyingConfig = readBaiyingConfig();
const database = createDatabase(appConfig.DATABASE_URL);
const repository = new PostgresMappingRepository(
  database.db,
  appConfig.VARIABLE_SYNC_QUEUE_NAME,
);
const outboxRepository = new PostgresOutboxRepository(database.db);
const workerId = `baiying-sync:${process.pid}:${randomUUID().slice(0, 8)}`;
const tokenProvider = new OAuthBaiyingTokenProvider({
  tokenUrl: baiyingConfig.BAIYING_TOKEN_URL,
  appKey: baiyingConfig.BAIYING_APP_KEY,
  appSecret: baiyingConfig.BAIYING_APP_SECRET,
  companyId: baiyingConfig.BAIYING_COMPANY_ID,
});
const client = new HttpBaiyingVariableClient({
  baseUrl: baiyingConfig.BAIYING_BASE_URL,
  tokenProvider,
});
let stopping = false;
process.once('SIGINT', () => {
  stopping = true;
});
process.once('SIGTERM', () => {
  stopping = true;
});

console.info(
  JSON.stringify({
    level: 'info',
    message: 'Baiying OAuth v2 sync worker started',
  }),
);
while (!stopping) {
  const job = await outboxRepository.claimNext({
    eventType: 'BAIYING_VARIABLE_SYNC_REQUESTED',
    queueName: appConfig.VARIABLE_SYNC_QUEUE_NAME,
    workerId,
  });

  if (!job) {
    await delay(2_000);
    continue;
  }

  try {
    const summary = await syncBaiyingCompany({
      client,
      companyId: baiyingConfig.BAIYING_COMPANY_ID,
      db: database.db,
      repository,
    });
    if (summary.failed) throw new Error(`${summary.failed} 个话术同步失败`);
    await outboxRepository.complete(job.id, workerId);
    console.info(
      JSON.stringify({
        level: 'info',
        message: 'Baiying OAuth v2 sync job completed',
        jobId: job.id,
        sceneCount: summary.sceneCount,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : '百应同步失败';
    const failed = await outboxRepository.fail({
      eventId: job.id,
      workerId,
      error: message,
      retryDelayMs: Math.min(300_000, 5_000 * 2 ** (job.attempts - 1)),
      maxAttempts: 8,
    });
    console.error(
      JSON.stringify({
        level: 'error',
        message,
        jobId: job.id,
        outboxStatus: failed.status,
        attempts: failed.attempts,
      }),
    );
  }
}

await database.close();

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

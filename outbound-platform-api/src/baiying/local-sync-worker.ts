import 'dotenv/config';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { readBaiyingConfig, readConfig } from '../config.js';
import { createDatabase } from '../db/client.js';
import { queueOutbox } from '../db/schema.js';
import { PostgresMappingRepository } from '../mapping/postgres-repository.js';
import { HttpBaiyingVariableClient } from './client.js';
import { syncBaiyingCompany } from './discovery-sync.js';
import { OAuthBaiyingTokenProvider } from './token-provider.js';

for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
  Reflect.deleteProperty(process.env, name);
}

const appConfig = readConfig();
const baiyingConfig = readBaiyingConfig();
if (appConfig.NODE_ENV === 'production') throw new Error('本地轮询 worker 不能用于生产环境');

const database = createDatabase(appConfig.DATABASE_URL);
const repository = new PostgresMappingRepository(database.db, appConfig.VARIABLE_SYNC_QUEUE_NAME);
const tokenProvider = new OAuthBaiyingTokenProvider({
  tokenUrl: baiyingConfig.BAIYING_TOKEN_URL,
  appKey: baiyingConfig.BAIYING_APP_KEY,
  appSecret: baiyingConfig.BAIYING_APP_SECRET,
  companyId: baiyingConfig.BAIYING_COMPANY_ID,
});
const client = new HttpBaiyingVariableClient({ baseUrl: baiyingConfig.BAIYING_BASE_URL, tokenProvider });
let stopping = false;
process.once('SIGINT', () => { stopping = true; });
process.once('SIGTERM', () => { stopping = true; });

console.info(JSON.stringify({ level: 'info', message: 'Local Baiying OAuth v2 sync worker started' }));
while (!stopping) {
  const [job] = await database.db.select().from(queueOutbox).where(and(
    eq(queueOutbox.eventType, 'BAIYING_VARIABLE_SYNC_REQUESTED'),
    eq(queueOutbox.queueName, appConfig.VARIABLE_SYNC_QUEUE_NAME),
    isNull(queueOutbox.publishedAt),
  )).orderBy(queueOutbox.createdAt).limit(1);

  if (!job) {
    await delay(2_000);
    continue;
  }

  await database.db.update(queueOutbox).set({ attempts: sql`${queueOutbox.attempts} + 1` }).where(eq(queueOutbox.id, job.id));
  try {
    const summary = await syncBaiyingCompany({ client, companyId: baiyingConfig.BAIYING_COMPANY_ID, db: database.db, repository });
    if (summary.failed) throw new Error(`${summary.failed} 个话术同步失败`);
    await database.db.update(queueOutbox).set({ publishedAt: new Date() }).where(eq(queueOutbox.id, job.id));
    console.info(JSON.stringify({ level: 'info', message: 'Baiying OAuth v2 sync job completed', jobId: job.id, sceneCount: summary.sceneCount }));
  } catch (error) {
    const message = error instanceof Error ? error.message : '百应同步失败';
    console.error(JSON.stringify({ level: 'error', message, jobId: job.id }));
    await delay(5_000);
  }
}

await database.close();

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

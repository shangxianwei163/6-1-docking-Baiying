import 'dotenv/config';
import { readBaiyingConfig, readConfig } from '../config.js';
import { createDatabase } from '../db/client.js';
import { PostgresMappingRepository } from '../mapping/postgres-repository.js';
import { HttpBaiyingVariableClient } from './client.js';
import { syncBaiyingCompany } from './discovery-sync.js';
import { OAuthBaiyingTokenProvider } from './token-provider.js';

for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
  Reflect.deleteProperty(process.env, name);
}

const appConfig = readConfig();
const baiyingConfig = readBaiyingConfig();
if (appConfig.NODE_ENV === 'production') throw new Error('该命令只用于本地/测试环境同步，不允许在生产环境直接执行');

const database = createDatabase(appConfig.DATABASE_URL);
const repository = new PostgresMappingRepository(database.db, appConfig.VARIABLE_SYNC_QUEUE_NAME);
const tokenProvider = new OAuthBaiyingTokenProvider({
  tokenUrl: baiyingConfig.BAIYING_TOKEN_URL,
  appKey: baiyingConfig.BAIYING_APP_KEY,
  appSecret: baiyingConfig.BAIYING_APP_SECRET,
  companyId: baiyingConfig.BAIYING_COMPANY_ID,
});
const client = new HttpBaiyingVariableClient({ baseUrl: baiyingConfig.BAIYING_BASE_URL, tokenProvider });

try {
  const summary = await syncBaiyingCompany({ client, companyId: baiyingConfig.BAIYING_COMPANY_ID, db: database.db, repository });
  console.info(JSON.stringify(summary));
  if (summary.failed) process.exitCode = 1;
} finally {
  await database.close();
}

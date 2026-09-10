import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { HttpBaiyingCallJobClient } from '../baiying/http-call-job-client.js';
import { OAuthBaiyingTokenProvider } from '../baiying/token-provider.js';
import { readConfig } from '../config.js';
import { createDatabase } from '../db/client.js';
import { PostgresOutboxRepository } from '../outbox/postgres-repository.js';
import { LocalDataProtector } from '../security/data-protector.js';
import { PostgresTaskOrchestrationRepository } from './postgres-repository.js';
import { TaskOrchestrationService } from './service.js';
import { TaskOrchestrationWorker } from './worker.js';

const config = readConfig();
if (!config.BAIYING_WRITE_ENABLED) {
  throw new Error(
    '真实百应任务 Worker 未启动：BAIYING_WRITE_ENABLED 必须显式设置为 true',
  );
}
if (
  !config.BAIYING_BASE_URL ||
  !config.BAIYING_TOKEN_URL ||
  !config.BAIYING_APP_KEY ||
  !config.BAIYING_APP_SECRET ||
  !config.BAIYING_COMPANY_ID
) {
  throw new Error('真实百应任务 Worker 未启动：百应 OAuth 配置不完整');
}
if (config.NODE_ENV === 'production') {
  throw new Error(
    '生产环境必须先接入 KMS DataProtector，不能使用本地密钥解密客户号码',
  );
}

const tokenProvider = new OAuthBaiyingTokenProvider({
  tokenUrl: config.BAIYING_TOKEN_URL,
  appKey: config.BAIYING_APP_KEY,
  appSecret: config.BAIYING_APP_SECRET,
  companyId: config.BAIYING_COMPANY_ID,
});
const client = new HttpBaiyingCallJobClient({
  baseUrl: config.BAIYING_BASE_URL,
  tokenProvider,
  timeoutMs: config.BAIYING_REQUEST_TIMEOUT_MS,
});
const database = createDatabase(config.DATABASE_URL);
const repository = new PostgresTaskOrchestrationRepository(database.db, {
  deliveryQueueName: config.CALLBACK_DELIVERY_QUEUE_NAME,
  orchestrationQueueName: config.TASK_ORCHESTRATION_QUEUE_NAME,
});
const orchestration = new TaskOrchestrationService(
  repository,
  client,
  new LocalDataProtector(config.WORKER_SHARED_SECRET, config.NODE_ENV),
);
const worker = new TaskOrchestrationWorker(
  new PostgresOutboxRepository(database.db),
  orchestration,
  {
    queueName: config.TASK_ORCHESTRATION_QUEUE_NAME,
    workerId: `baiying-task-orchestration:${process.pid}:${randomUUID().slice(0, 8)}`,
  },
);

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
    message: 'Real Baiying task orchestration worker started',
    companyId: config.BAIYING_COMPANY_ID,
  }),
);
while (!stopping) {
  const result = await worker.runOnce();
  if (result.status === 'IDLE') {
    await delay(2_000);
    continue;
  }
  const level =
    result.status === 'COMPLETED' || result.status === 'RETRY_SCHEDULED'
      ? 'info'
      : 'error';
  console[level](JSON.stringify({ level, ...result }));
}
await database.close();

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

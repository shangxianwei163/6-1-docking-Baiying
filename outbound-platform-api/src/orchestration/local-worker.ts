import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { LocalBaiyingCallJobClient } from '../baiying/local-call-job-client.js';
import { readConfig } from '../config.js';
import { createDatabase } from '../db/client.js';
import { PostgresOutboxRepository } from '../outbox/postgres-repository.js';
import { LocalDataProtector } from '../security/data-protector.js';
import { PostgresTaskOrchestrationRepository } from './postgres-repository.js';
import { TaskOrchestrationService } from './service.js';
import { TaskOrchestrationWorker } from './worker.js';

const scenarioSchema = z
  .enum([
    'SUCCESS',
    'CREATE_UNKNOWN_AFTER_COMMIT',
    'IMPORT_UNKNOWN_AFTER_COMMIT',
    'IMPORT_PARTIAL',
    'START_UNKNOWN_AFTER_COMMIT',
    'START_PERMANENT_FAILURE',
  ])
  .default('SUCCESS');

const config = readConfig();
if (config.NODE_ENV === 'production') {
  throw new Error('生产环境禁止启动本地模拟百应任务 Worker');
}
const scenario = scenarioSchema.parse(
  process.env.LOCAL_BAIYING_SCENARIO ?? 'SUCCESS',
);
const database = createDatabase(config.DATABASE_URL);
const repository = new PostgresTaskOrchestrationRepository(database.db, {
  deliveryQueueName: config.CALLBACK_DELIVERY_QUEUE_NAME,
});
const orchestration = new TaskOrchestrationService(
  repository,
  new LocalBaiyingCallJobClient(scenario),
  new LocalDataProtector(config.WORKER_SHARED_SECRET, config.NODE_ENV),
);
const worker = new TaskOrchestrationWorker(
  new PostgresOutboxRepository(database.db),
  orchestration,
  {
    queueName: config.TASK_ORCHESTRATION_QUEUE_NAME,
    workerId: `local-task-orchestration:${process.pid}:${randomUUID().slice(0, 8)}`,
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
    message: 'Local mock task orchestration worker started',
    scenario,
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

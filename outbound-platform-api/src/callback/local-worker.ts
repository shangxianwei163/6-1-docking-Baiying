import 'dotenv/config';
import { hostname } from 'node:os';
import { readConfig } from '../config.js';
import { createDatabase } from '../db/client.js';
import { LocalDataProtector } from '../security/data-protector.js';
import { PostgresBaiyingCallbackProcessor } from './processor.js';
import { PostgresCallbackInboxRepository } from './postgres-repository.js';
import { BaiyingCallbackWorker } from './worker.js';

const config = readConfig();
if (config.NODE_ENV === 'production') {
  throw new Error(
    '生产环境禁止运行本地 Callback Worker；部署时必须注入 KMS DataProtector',
  );
}

const database = createDatabase(config.DATABASE_URL);
const protector = new LocalDataProtector(
  config.WORKER_SHARED_SECRET,
  config.NODE_ENV,
);
const repository = new PostgresCallbackInboxRepository(database.db);
const processor = new PostgresBaiyingCallbackProcessor(database.db, protector, {
  deliveryQueueName: config.CALLBACK_DELIVERY_QUEUE_NAME,
});
const worker = new BaiyingCallbackWorker(repository, processor, protector, {
  workerId: `callback-local-${hostname()}-${process.pid}`.slice(0, 128),
});

let stopping = false;

console.info(
  JSON.stringify({
    level: 'info',
    message: 'Local Baiying callback worker started',
  }),
);

process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));

while (!stopping) {
  try {
    const result = await worker.runOnce();
    if (result.status === 'IDLE') {
      await delay(1_000);
    } else {
      console.info(
        JSON.stringify({
          level: 'info',
          message: 'Baiying callback worker cycle completed',
          ...result,
        }),
      );
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        message: 'Baiying callback worker cycle failed',
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    await delay(5_000);
  }
}

await database.close();

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function stop(signal: string): void {
  console.info(
    JSON.stringify({
      level: 'info',
      message: 'Local Baiying callback worker stopping',
      signal,
    }),
  );
  stopping = true;
}

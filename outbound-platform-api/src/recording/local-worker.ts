import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import { readConfig } from '../config.js';
import { createDatabase } from '../db/client.js';
import { LocalDataProtector } from '../security/data-protector.js';
import { RecordingArchiveService } from './archive-service.js';
import { LocalFixtureRecordingSource } from './local-fixture-source.js';
import { LocalRecordingObjectStore } from './local-object-store.js';
import { PostgresRecordingArchiveRepository } from './postgres-repository.js';
import { RecordingArchiveWorker } from './worker.js';

const config = readConfig();
if (config.NODE_ENV === 'production') {
  throw new Error(
    '生产环境禁止运行本地录音 Worker；部署时必须注入阿里云 OSS、KMS 和真实域名允许列表',
  );
}
const database = createDatabase(config.DATABASE_URL);
const repository = new PostgresRecordingArchiveRepository(
  database.db,
  () => new Date(),
  config.CALLBACK_DELIVERY_QUEUE_NAME,
);
const archiveService = new RecordingArchiveService(
  new LocalDataProtector(config.WORKER_SHARED_SECRET, config.NODE_ENV),
  new LocalFixtureRecordingSource(),
  new LocalRecordingObjectStore(resolve(config.RECORDING_LOCAL_ROOT)),
  {
    bucket: config.RECORDING_LOCAL_BUCKET,
    maxBytes: config.RECORDING_MAX_BYTES,
    retentionDays: config.RECORDING_RETENTION_DAYS,
  },
);
const worker = new RecordingArchiveWorker(repository, archiveService, {
  workerId:
    `recording-local-${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`.slice(
      0,
      128,
    ),
  recordingId: process.env.LOCAL_RECORDING_ID || undefined,
});
let stopping = false;

process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));
console.info(
  JSON.stringify({
    level: 'info',
    message: 'Local recording archive worker started',
    mode: 'LOCAL_FIXTURE_NO_NETWORK',
    root: resolve(config.RECORDING_LOCAL_ROOT),
  }),
);

while (!stopping) {
  try {
    const result = await worker.runOnce();
    if (result.status === 'IDLE') {
      await delay(1_000);
    } else {
      console.info(
        JSON.stringify({
          level: result.status === 'DEAD_LETTERED' ? 'error' : 'info',
          message: 'Recording archive worker cycle completed',
          ...result,
        }),
      );
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        message: 'Recording archive worker cycle failed',
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    await delay(5_000);
  }
}
await database.close();

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function stop(signal: string): void {
  console.info(
    JSON.stringify({
      level: 'info',
      message: 'Local recording archive worker stopping',
      signal,
    }),
  );
  stopping = true;
}

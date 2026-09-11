import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { readConfig } from '../config.js';
import { createDatabase } from '../db/client.js';
import { createRuntimeDataProtector } from '../security/data-protector.js';
import { RecordingArchiveService } from './archive-service.js';
import { parseRecordingSourceAllowedHosts } from './allowed-hosts.js';
import { PostgresRecordingArchiveRepository } from './postgres-repository.js';
import { createRuntimeRecordingStorage } from './runtime-object-store.js';
import { SecureHttpRecordingSource } from './safe-http-source.js';
import { RecordingArchiveWorker } from './worker.js';

const config = readConfig();
const recordingStorage = await createRuntimeRecordingStorage(config);
const allowedHosts = parseRecordingSourceAllowedHosts(
  config.RECORDING_SOURCE_ALLOWED_HOSTS,
);
const database = createDatabase(config.DATABASE_URL);
const repository = new PostgresRecordingArchiveRepository(
  database.db,
  () => new Date(),
  config.CALLBACK_DELIVERY_QUEUE_NAME,
);
const archiveService = new RecordingArchiveService(
  createRuntimeDataProtector(config.WORKER_SHARED_SECRET, config.NODE_ENV),
  new SecureHttpRecordingSource(allowedHosts),
  recordingStorage.objectStore,
  {
    bucket: recordingStorage.bucket,
    maxBytes: config.RECORDING_MAX_BYTES,
    retentionDays: config.RECORDING_RETENTION_DAYS,
  },
);
const worker = new RecordingArchiveWorker(repository, archiveService, {
  workerId:
    `recording-network-${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`.slice(
      0,
      128,
    ),
});
let stopping = false;

process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));
console.info(
  JSON.stringify({
    level: 'info',
    message: 'Network recording archive worker started',
    allowedHostCount: allowedHosts.length,
    storageDriver: config.RECORDING_STORAGE_DRIVER,
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
          message: 'Network recording archive worker cycle completed',
          ...result,
        }),
      );
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        message: 'Network recording archive worker cycle failed',
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
      message: 'Network recording archive worker stopping',
      signal,
    }),
  );
  stopping = true;
}

import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { readConfig } from '../config.js';
import { createDatabase } from '../db/client.js';
import { PostgresOutboxRepository } from '../outbox/postgres-repository.js';
import { RecordingAccessService } from '../recording/access-service.js';
import { PostgresRecordingAccessRepository } from '../recording/postgres-access-repository.js';
import { createRuntimeRecordingStorage } from '../recording/runtime-object-store.js';
import { createRuntimeRecordingUrlSigner } from '../recording/url-signer.js';
import { createRuntimeDataProtector } from '../security/data-protector.js';
import { createRuntimeSecretProvider } from '../security/secret-provider.js';
import { DeliveryOutboxProjector } from './outbox-projector.js';
import { PostgresDeliveryRepository } from './postgres-repository.js';
import { PostgresRecordingDeliveryEventBuilder } from './recording-event-builder.js';
import { HttpDeliveryTransport } from './transport.js';
import { CallbackDeliveryWorker } from './worker.js';

const config = readConfig();
const database = createDatabase(config.DATABASE_URL);
const secrets = createRuntimeSecretProvider(
  config.WORKER_SHARED_SECRET,
  config.NODE_ENV,
);
const protector = createRuntimeDataProtector(
  config.WORKER_SHARED_SECRET,
  config.NODE_ENV,
);
const recordingStorage = await createRuntimeRecordingStorage(config);
const access = new RecordingAccessService(
  new PostgresRecordingAccessRepository(database.db),
  recordingStorage.objectStore,
  createRuntimeRecordingUrlSigner(config.WORKER_SHARED_SECRET, config.NODE_ENV),
  {
    publicBaseUrl: config.RECORDING_CALLBACK_BASE_URL,
    ttlSeconds: config.RECORDING_DOWNLOAD_TTL_SECONDS,
    environment: config.NODE_ENV,
  },
);
const deliveryRepository = new PostgresDeliveryRepository(database.db);
const workerSuffix = `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;
const projector = new DeliveryOutboxProjector(
  new PostgresOutboxRepository(database.db),
  deliveryRepository,
  new PostgresRecordingDeliveryEventBuilder(database.db, access, protector),
  {
    queueName: config.CALLBACK_DELIVERY_QUEUE_NAME,
    workerId: `delivery-projector-${workerSuffix}`.slice(0, 128),
  },
);
const deliveryWorker = new CallbackDeliveryWorker(
  deliveryRepository,
  new HttpDeliveryTransport(),
  secrets,
  {
    workerId: `delivery-network-${workerSuffix}`.slice(0, 128),
  },
);
let stopping = false;

process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));
console.info(
  JSON.stringify({
    level: 'info',
    message: 'Network callback delivery worker started',
    storageDriver: config.RECORDING_STORAGE_DRIVER,
  }),
);

while (!stopping) {
  try {
    const projection = await projector.runOnce();
    if (projection.status !== 'IDLE') {
      console.info(
        JSON.stringify({
          level: projection.status === 'DEAD_LETTERED' ? 'error' : 'info',
          message: 'Delivery outbox projection completed',
          ...projection,
        }),
      );
      continue;
    }
    const delivery = await deliveryWorker.runOnce();
    if (delivery.status === 'IDLE') {
      await delay(1_000);
    } else {
      console.info(
        JSON.stringify({
          level: delivery.status === 'DEAD_LETTERED' ? 'error' : 'info',
          message: 'Network callback delivery cycle completed',
          ...delivery,
        }),
      );
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        message: 'Network callback delivery worker cycle failed',
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    await delay(5_000);
  }
}
await database.close();

function stop(signal: string): void {
  console.info(
    JSON.stringify({
      level: 'info',
      message: 'Network callback delivery worker stopping',
      signal,
    }),
  );
  stopping = true;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

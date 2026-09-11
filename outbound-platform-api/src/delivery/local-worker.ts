import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import { z } from 'zod';
import { readConfig } from '../config.js';
import { createDatabase } from '../db/client.js';
import { PostgresOutboxRepository } from '../outbox/postgres-repository.js';
import { RecordingAccessService } from '../recording/access-service.js';
import { LocalRecordingObjectStore } from '../recording/local-object-store.js';
import { PostgresRecordingAccessRepository } from '../recording/postgres-access-repository.js';
import { LocalRecordingUrlSigner } from '../recording/url-signer.js';
import { LocalDataProtector } from '../security/data-protector.js';
import { LocalDevelopmentSecretProvider } from '../security/secret-provider.js';
import { DeliveryOutboxProjector } from './outbox-projector.js';
import { PostgresDeliveryRepository } from './postgres-repository.js';
import { PostgresRecordingDeliveryEventBuilder } from './recording-event-builder.js';
import { LocalNoNetworkDeliveryTransport } from './transport.js';
import { CallbackDeliveryWorker } from './worker.js';

const scenarioSchema = z
  .enum(['SUCCESS', 'RETRY_ONCE', 'PERMANENT_FAILURE'])
  .default('SUCCESS');

const config = readConfig();
if (config.NODE_ENV === 'production') {
  throw new Error('生产环境禁止运行本地零网络回调投递 Worker');
}
const scenario = scenarioSchema.parse(
  process.env.LOCAL_DELIVERY_SCENARIO ?? 'SUCCESS',
);
const database = createDatabase(config.DATABASE_URL);
const secrets = new LocalDevelopmentSecretProvider(
  config.WORKER_SHARED_SECRET,
  config.NODE_ENV,
);
const protector = new LocalDataProtector(
  config.WORKER_SHARED_SECRET,
  config.NODE_ENV,
);
const access = new RecordingAccessService(
  new PostgresRecordingAccessRepository(database.db),
  new LocalRecordingObjectStore(resolve(config.RECORDING_LOCAL_ROOT)),
  new LocalRecordingUrlSigner(config.WORKER_SHARED_SECRET, config.NODE_ENV),
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
const localAttempts = new Map<string, number>();
const receiver = new LocalNoNetworkDeliveryTransport({
  environment: config.NODE_ENV,
  allowedHosts: ['erp.mock.invalid', 'crm.mock.invalid'],
  secretForUrl: async (rawUrl) => {
    const source = new URL(rawUrl).hostname.startsWith('crm.') ? 'crm' : 'erp';
    return secrets.getSecretBytes(`local-hkdf://callback:${source}-local-01`);
  },
  responseForAttempt: (_request, receipt) => {
    const attempt = (localAttempts.get(receipt.eventId) ?? 0) + 1;
    localAttempts.set(receipt.eventId, attempt);
    if (scenario === 'PERMANENT_FAILURE') {
      return { status: 400, body: '{"code":400,"message":"local reject"}' };
    }
    if (scenario === 'RETRY_ONCE' && attempt === 1) {
      return { status: 503, body: '{"code":503,"message":"local retry"}' };
    }
    return { status: 200, body: '{"code":200,"message":"success"}' };
  },
});
const deliveryWorker = new CallbackDeliveryWorker(
  deliveryRepository,
  receiver,
  secrets,
  {
    workerId: `delivery-local-${workerSuffix}`.slice(0, 128),
  },
);
let stopping = false;

process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));
console.info(
  JSON.stringify({
    level: 'info',
    message: 'Local callback delivery worker started',
    mode: 'LOCAL_RECEIVER_NO_NETWORK',
    scenario,
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
          message: 'Local callback delivery cycle completed',
          ...delivery,
        }),
      );
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        message: 'Local callback delivery worker cycle failed',
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
      message: 'Local callback delivery worker stopping',
      signal,
    }),
  );
  stopping = true;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

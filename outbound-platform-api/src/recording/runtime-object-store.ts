import { resolve } from 'node:path';
import type { AppConfig } from '../config.js';
import { LocalRecordingObjectStore } from './local-object-store.js';
import type {
  RecordingObjectReader,
  RecordingObjectStore,
  RecordingObjectDeleter,
} from './object-store.js';
import { createEcsRamRoleOssObjectStore } from './oss-object-store.js';

export type RuntimeRecordingStorage = {
  objectStore: RecordingObjectStore &
    RecordingObjectReader &
    RecordingObjectDeleter;
  bucket: string;
};

export class RoutedRecordingObjectStore
  implements
    RecordingObjectStore,
    RecordingObjectReader,
    RecordingObjectDeleter
{
  constructor(
    private readonly stores: ReadonlyMap<
      string,
      RecordingObjectStore & RecordingObjectReader & RecordingObjectDeleter
    >,
  ) {}

  putObject(input: Parameters<RecordingObjectStore['putObject']>[0]) {
    return this.storeFor(input.bucket).putObject(input);
  }

  openObject(input: Parameters<RecordingObjectReader['openObject']>[0]) {
    return this.storeFor(input.bucket).openObject(input);
  }

  deleteObject(input: Parameters<RecordingObjectDeleter['deleteObject']>[0]) {
    return this.storeFor(input.bucket).deleteObject(input);
  }

  private storeFor(bucket: string) {
    const store = this.stores.get(bucket);
    if (!store) throw new Error(`未配置录音 Bucket: ${bucket}`);
    return store;
  }
}

export async function createRuntimeRecordingStorage(
  config: AppConfig,
): Promise<RuntimeRecordingStorage> {
  if (config.RECORDING_STORAGE_DRIVER === 'local') {
    return {
      objectStore: new LocalRecordingObjectStore(
        resolve(config.RECORDING_LOCAL_ROOT),
      ),
      bucket: config.RECORDING_LOCAL_BUCKET,
    };
  }

  const bucket = required(config.OSS_BUCKET, 'OSS_BUCKET');
  if (bucket === config.RECORDING_LOCAL_BUCKET) {
    throw new Error('OSS_BUCKET 不能与 RECORDING_LOCAL_BUCKET 相同');
  }
  const oss = await createEcsRamRoleOssObjectStore({
    bucket,
    endpoint: required(config.OSS_ENDPOINT, 'OSS_ENDPOINT'),
    region: required(config.OSS_REGION, 'OSS_REGION'),
    roleName: required(config.OSS_ECS_RAM_ROLE_NAME, 'OSS_ECS_RAM_ROLE_NAME'),
  });
  const local = new LocalRecordingObjectStore(
    resolve(config.RECORDING_LOCAL_ROOT),
  );
  return {
    objectStore: new RoutedRecordingObjectStore(
      new Map<
        string,
        RecordingObjectStore & RecordingObjectReader & RecordingObjectDeleter
      >([
        [bucket, oss],
        [config.RECORDING_LOCAL_BUCKET, local],
      ]),
    ),
    bucket,
  };
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`缺少 ${name}`);
  return value;
}

import 'dotenv/config';
import { createHash } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { readConfig } from '../config.js';
import { createDatabase } from '../db/client.js';
import { recordingAssets } from '../db/schema.js';
import { LocalRecordingObjectStore } from './local-object-store.js';
import { createRuntimeRecordingStorage } from './runtime-object-store.js';

const config = readConfig();
if (config.RECORDING_STORAGE_DRIVER !== 'oss') {
  throw new Error('录音迁移要求 RECORDING_STORAGE_DRIVER=oss');
}
if (config.RECORDING_LOCAL_BUCKET === config.OSS_BUCKET) {
  throw new Error('本地 Bucket 与目标 OSS Bucket 不能相同');
}

const database = createDatabase(config.DATABASE_URL);
const local = new LocalRecordingObjectStore(config.RECORDING_LOCAL_ROOT);
const target = await createRuntimeRecordingStorage(config);
let migrated = 0;
let skipped = 0;

try {
  const assets = await database.db
    .select({
      id: recordingAssets.id,
      objectKey: recordingAssets.ossObjectKey,
      sizeBytes: recordingAssets.sizeBytes,
      sha256: recordingAssets.sha256,
    })
    .from(recordingAssets)
    .where(
      and(
        eq(recordingAssets.archiveStatus, 'ARCHIVED'),
        eq(recordingAssets.ossBucket, config.RECORDING_LOCAL_BUCKET),
        isNull(recordingAssets.deletedAt),
      ),
    )
    .orderBy(recordingAssets.archivedAt, recordingAssets.id);

  for (const asset of assets) {
    if (!asset.objectKey || asset.sizeBytes === null || !asset.sha256) {
      throw new Error(`录音 ${asset.id} 缺少完整归档元数据`);
    }
    const source = {
      bucket: config.RECORDING_LOCAL_BUCKET,
      objectKey: asset.objectKey,
    };
    const sourceCheck = await digest(await local.openObject(source));
    assertFingerprint(asset.id, sourceCheck, asset.sizeBytes, asset.sha256);

    const upload = await local.openObject(source);
    await target.objectStore.putObject({
      bucket: target.bucket,
      objectKey: asset.objectKey,
      body: upload.body,
    });

    try {
      const targetCheck = await digest(
        await target.objectStore.openObject({
          bucket: target.bucket,
          objectKey: asset.objectKey,
        }),
      );
      assertFingerprint(asset.id, targetCheck, asset.sizeBytes, asset.sha256);
    } catch (error) {
      await target.objectStore
        .deleteObject({ bucket: target.bucket, objectKey: asset.objectKey })
        .catch(() => undefined);
      throw error;
    }

    const changed = await database.db
      .update(recordingAssets)
      .set({ ossBucket: target.bucket })
      .where(
        and(
          eq(recordingAssets.id, asset.id),
          eq(recordingAssets.archiveStatus, 'ARCHIVED'),
          eq(recordingAssets.ossBucket, config.RECORDING_LOCAL_BUCKET),
          eq(recordingAssets.ossObjectKey, asset.objectKey),
          eq(recordingAssets.sizeBytes, asset.sizeBytes),
          eq(recordingAssets.sha256, asset.sha256),
        ),
      )
      .returning({ id: recordingAssets.id });
    if (changed.length === 1) migrated += 1;
    else skipped += 1;
  }
} finally {
  await database.close();
}

console.info(
  JSON.stringify({
    status: 'ok',
    migrated,
    skipped,
    localCopiesRetained: true,
  }),
);

async function digest(opened: {
  body: AsyncIterable<Uint8Array>;
  sizeBytes: bigint;
}) {
  const hash = createHash('sha256');
  let observed = 0n;
  for await (const chunk of opened.body) {
    hash.update(chunk);
    observed += BigInt(chunk.byteLength);
  }
  if (observed !== opened.sizeBytes) {
    throw new Error('录音流实际长度与对象元数据不一致');
  }
  return { sizeBytes: observed, sha256: hash.digest('hex') };
}

function assertFingerprint(
  recordingId: string,
  actual: { sizeBytes: bigint; sha256: string },
  expectedSize: bigint,
  expectedSha256: string,
) {
  if (actual.sizeBytes !== expectedSize || actual.sha256 !== expectedSha256) {
    throw new Error(`录音 ${recordingId} 的长度或 SHA-256 校验失败`);
  }
}

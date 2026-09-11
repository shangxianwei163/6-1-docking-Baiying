import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { readConfig } from '../config.js';
import { createRuntimeRecordingStorage } from './runtime-object-store.js';

const config = readConfig();
if (config.RECORDING_STORAGE_DRIVER !== 'oss') {
  throw new Error('OSS 权限探针要求 RECORDING_STORAGE_DRIVER=oss');
}

const storage = await createRuntimeRecordingStorage(config);
const objectKey = `healthchecks/permission-${Date.now()}-${randomUUID()}.txt`;
const expected = Buffer.from('scheduling platform OSS permission probe\n');
let uploaded = false;

try {
  await storage.objectStore.putObject({
    bucket: storage.bucket,
    objectKey,
    body: oneChunk(expected),
  });
  uploaded = true;
  const opened = await storage.objectStore.openObject({
    bucket: storage.bucket,
    objectKey,
  });
  const actual = await collect(opened.body);
  if (opened.sizeBytes !== BigInt(expected.byteLength)) {
    throw new Error('OSS 权限探针下载长度不一致');
  }
  if (!actual.equals(expected)) {
    throw new Error('OSS 权限探针下载内容不一致');
  }
} finally {
  if (uploaded) {
    await storage.objectStore.deleteObject({
      bucket: storage.bucket,
      objectKey,
    });
    uploaded = false;
  }
}

if (uploaded) {
  throw new Error('OSS 权限探针无法确认临时对象已删除');
}
console.info(
  JSON.stringify({
    status: 'ok',
    checks: ['temporary_credentials', 'write', 'read', 'delete'],
  }),
);

async function* oneChunk(value: Uint8Array) {
  yield value;
}

async function collect(body: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

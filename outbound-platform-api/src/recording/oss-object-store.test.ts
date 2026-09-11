/// <reference types="node" />

import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  OssRecordingObjectStore,
  type RecordingOssClient,
} from './oss-object-store.js';

describe('OssRecordingObjectStore', () => {
  it('streams uploads and downloads without exposing a public OSS URL', async () => {
    const objects = new Map<string, Buffer>();
    const client: RecordingOssClient = {
      async putStream(key, body) {
        const chunks: Uint8Array[] = [];
        for await (const chunk of body) chunks.push(chunk);
        objects.set(key, Buffer.concat(chunks));
      },
      async getStream(key) {
        const bytes = objects.get(key);
        if (!bytes) throw new Error('NoSuchKey');
        return {
          stream: Readable.from([bytes]),
          headers: { 'content-length': String(bytes.byteLength) },
        };
      },
      async delete(key) {
        objects.delete(key);
      },
    };
    const store = new OssRecordingObjectStore(client, 'scheduling61');
    const input = {
      bucket: 'scheduling61',
      objectKey: 'recordings/studio/task/call/full.mp3',
    };

    await store.putObject({ ...input, body: chunks(['first-', 'second']) });
    const opened = await store.openObject(input);

    expect(opened.sizeBytes).toBe(12n);
    await expect(collect(opened.body)).resolves.toBe('first-second');
    await store.deleteObject(input);
    await expect(store.openObject(input)).rejects.toThrow('NoSuchKey');
  });

  it('rejects a bucket mismatch, unsafe key, or invalid SDK response', async () => {
    const client: RecordingOssClient = {
      async putStream() {},
      async getStream() {
        return { stream: undefined, headers: {} };
      },
      async delete() {},
    };
    const store = new OssRecordingObjectStore(client, 'scheduling61');

    await expect(
      store.putObject({
        bucket: 'another-bucket',
        objectKey: 'recordings/studio/task/call/full.mp3',
        body: chunks(['bad']),
      }),
    ).rejects.toThrow('Bucket');
    await expect(
      store.openObject({ bucket: 'scheduling61', objectKey: '../escape.mp3' }),
    ).rejects.toThrow('不安全');
    await expect(
      store.openObject({
        bucket: 'scheduling61',
        objectKey: 'recordings/studio/task/call/full.mp3',
      }),
    ).rejects.toThrow('响应');
  });
});

async function* chunks(values: string[]) {
  for (const value of values) yield Buffer.from(value);
}

async function collect(body: AsyncIterable<Uint8Array>): Promise<string> {
  const values: Uint8Array[] = [];
  for await (const value of body) values.push(value);
  return Buffer.concat(values).toString('utf8');
}

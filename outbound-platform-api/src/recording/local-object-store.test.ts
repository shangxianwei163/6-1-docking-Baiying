/// <reference types="node" />

import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalRecordingObjectStore } from './local-object-store.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe('LocalRecordingObjectStore', () => {
  it('writes a streamed object atomically inside its private root', async () => {
    const root = await createRoot();
    const store = new LocalRecordingObjectStore(root);
    await store.putObject({
      bucket: 'local-recordings',
      objectKey: 'recordings/studio/task/call/full.mp3',
      body: chunks(['first-', 'second']),
    });
    const path = store.objectPath(
      'local-recordings',
      'recordings/studio/task/call/full.mp3',
    );
    await expect(readFile(path, 'utf8')).resolves.toBe('first-second');
    const opened = await store.openObject({
      bucket: 'local-recordings',
      objectKey: 'recordings/studio/task/call/full.mp3',
    });
    expect(opened.sizeBytes).toBe(12n);
    await expect(collect(opened.body)).resolves.toBe('first-second');
    await expect(
      readdir(join(root, 'local-recordings/recordings/studio/task/call')),
    ).resolves.toEqual(['full.mp3']);
  });

  it('rejects path traversal and removes a partial file on stream failure', async () => {
    const root = await createRoot();
    const store = new LocalRecordingObjectStore(root);
    await expect(
      store.putObject({
        bucket: 'local-recordings',
        objectKey: '../escaped.mp3',
        body: chunks(['bad']),
      }),
    ).rejects.toThrow('不安全');

    const key = 'recordings/studio/task/call/full.mp3';
    await expect(
      store.putObject({
        bucket: 'local-recordings',
        objectKey: key,
        body: failingBody(),
      }),
    ).rejects.toThrow('fixture failed');
    await expect(
      readdir(join(root, 'local-recordings/recordings/studio/task/call')),
    ).resolves.toEqual([]);
  });
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'recording-store-test-'));
  temporaryRoots.push(root);
  return root;
}

async function* chunks(values: string[]) {
  for (const value of values) yield Buffer.from(value);
}

async function* failingBody() {
  yield Buffer.from('partial');
  throw new Error('fixture failed');
}

async function collect(body: AsyncIterable<Uint8Array>): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of body) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

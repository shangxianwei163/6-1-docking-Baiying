import { describe, expect, it } from 'vitest';
import type {
  PutRecordingObjectInput,
  RecordingObjectDeleter,
  RecordingObjectReader,
  RecordingObjectStore,
} from './object-store.js';
import { RoutedRecordingObjectStore } from './runtime-object-store.js';

describe('RoutedRecordingObjectStore', () => {
  it('routes current OSS and legacy local buckets without mixing objects', async () => {
    const oss = new MemoryStore();
    const local = new MemoryStore();
    const routed = new RoutedRecordingObjectStore(
      new Map([
        ['scheduling61', oss],
        ['local-recordings', local],
      ]),
    );

    await routed.putObject({
      bucket: 'scheduling61',
      objectKey: 'recordings/new.mp3',
      body: chunks('new'),
    });
    await local.putObject({
      bucket: 'local-recordings',
      objectKey: 'recordings/old.mp3',
      body: chunks('old'),
    });

    await expect(
      collect(
        (
          await routed.openObject({
            bucket: 'scheduling61',
            objectKey: 'recordings/new.mp3',
          })
        ).body,
      ),
    ).resolves.toBe('new');
    await expect(
      collect(
        (
          await routed.openObject({
            bucket: 'local-recordings',
            objectKey: 'recordings/old.mp3',
          })
        ).body,
      ),
    ).resolves.toBe('old');
    expect(() =>
      routed.openObject({
        bucket: 'unknown',
        objectKey: 'recordings/missing.mp3',
      }),
    ).toThrow('未配置');
  });
});

class MemoryStore
  implements
    RecordingObjectStore,
    RecordingObjectReader,
    RecordingObjectDeleter
{
  private readonly objects = new Map<string, Buffer>();

  async putObject(input: PutRecordingObjectInput) {
    const values: Uint8Array[] = [];
    for await (const value of input.body) values.push(value);
    this.objects.set(input.objectKey, Buffer.concat(values));
  }

  async openObject(input: { objectKey: string }) {
    const value = this.objects.get(input.objectKey);
    if (!value) throw new Error('missing');
    return { body: chunks(value), sizeBytes: BigInt(value.byteLength) };
  }

  async deleteObject(input: { objectKey: string }) {
    this.objects.delete(input.objectKey);
  }
}

async function* chunks(value: string | Uint8Array) {
  yield typeof value === 'string' ? Buffer.from(value) : value;
}

async function collect(body: AsyncIterable<Uint8Array>) {
  const values: Uint8Array[] = [];
  for await (const value of body) values.push(value);
  return Buffer.concat(values).toString('utf8');
}

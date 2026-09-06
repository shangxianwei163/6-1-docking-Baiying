/// <reference types="node" />

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  RecordingValidationError,
  verifyAudioBody,
} from './audio-validation.js';

describe('verifyAudioBody', () => {
  it('streams MP3 bytes while computing trustworthy metadata', async () => {
    const bytes = Buffer.from(
      'ID3\u0004\u0000\u0000\u0000\u0000\u0000\u0005hello',
      'binary',
    );
    const verified = verifyAudioBody(chunks(bytes, 2), {
      declaredContentType: 'audio/mpeg; charset=binary',
      declaredLength: bytes.byteLength,
      maxBytes: 1_024,
    });

    const stored = await collect(verified.body);

    expect(stored).toEqual(bytes);
    expect(verified.metadata()).toEqual({
      contentType: 'audio/mpeg',
      sizeBytes: BigInt(bytes.byteLength),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  });

  it('accepts an octet-stream only when the file header is audio', async () => {
    const bytes = Buffer.from('RIFF\u0004\u0000\u0000\u0000WAVEdata', 'binary');
    const verified = verifyAudioBody(chunks(bytes, 3), {
      declaredContentType: 'application/octet-stream',
      declaredLength: null,
      maxBytes: 1_024,
    });
    await collect(verified.body);
    expect(verified.metadata().contentType).toBe('audio/wav');
  });

  it('rejects MIME spoofing, length mismatch, and an oversized stream', async () => {
    const wav = Buffer.from('RIFF\u0004\u0000\u0000\u0000WAVEdata', 'binary');
    await expect(
      consume(
        verifyAudioBody(chunks(wav, 20), {
          declaredContentType: 'audio/mpeg',
          declaredLength: wav.byteLength,
          maxBytes: 1_024,
        }).body,
      ),
    ).rejects.toThrow(RecordingValidationError);

    const mp3 = Buffer.from('ID3short', 'binary');
    await expect(
      consume(
        verifyAudioBody(chunks(mp3, 2), {
          declaredContentType: 'audio/mpeg',
          declaredLength: mp3.byteLength + 1,
          maxBytes: 1_024,
        }).body,
      ),
    ).rejects.toThrow('Content-Length');
    await expect(
      consume(
        verifyAudioBody(chunks(mp3, 2), {
          declaredContentType: 'audio/mpeg',
          declaredLength: null,
          maxBytes: 4,
        }).body,
      ),
    ).rejects.toThrow('最大文件大小');
  });
});

async function* chunks(bytes: Uint8Array, size: number) {
  for (let offset = 0; offset < bytes.byteLength; offset += size) {
    yield bytes.subarray(offset, Math.min(offset + size, bytes.byteLength));
  }
}

async function collect(body: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const values: Uint8Array[] = [];
  for await (const chunk of body) values.push(chunk);
  return Buffer.concat(values);
}

async function consume(body: AsyncIterable<Uint8Array>): Promise<void> {
  for await (const _chunk of body) {
    // Intentionally consume the whole stream so end-of-stream checks run.
  }
}

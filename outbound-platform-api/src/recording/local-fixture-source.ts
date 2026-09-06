import { createHash } from 'node:crypto';
import type { OpenedRecordingSource, RecordingSource } from './source.js';

export class LocalFixtureRecordingSource implements RecordingSource {
  async open(sourceUrl: string): Promise<OpenedRecordingSource> {
    const url = new URL(sourceUrl);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'recording.mock.invalid' ||
      url.username ||
      url.password ||
      (url.port && url.port !== '443')
    ) {
      throw new Error('本地录音源只接受 recording.mock.invalid 的 HTTPS 地址');
    }
    const fingerprint = createHash('sha256')
      .update(`${url.pathname}${url.search}`, 'utf8')
      .digest('hex');
    const bytes = Buffer.concat([
      Buffer.from('ID3\u0004\u0000\u0000\u0000\u0000\u0000\u0015', 'binary'),
      Buffer.from(`LOCAL_RECORDING_FIXTURE:${fingerprint}`, 'utf8'),
    ]);
    return {
      body: chunks(bytes, 11),
      contentType: 'audio/mpeg',
      contentLength: bytes.byteLength,
    };
  }
}

async function* chunks(bytes: Uint8Array, size: number) {
  for (let offset = 0; offset < bytes.byteLength; offset += size) {
    yield bytes.subarray(offset, Math.min(offset + size, bytes.byteLength));
  }
}

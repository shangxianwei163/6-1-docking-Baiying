import { createHash } from 'node:crypto';

export type VerifiedAudioMetadata = {
  contentType: string;
  sizeBytes: bigint;
  sha256: string;
};

export type VerifiedAudioBody = {
  body: AsyncIterable<Uint8Array>;
  metadata(): VerifiedAudioMetadata;
};

const CONTENT_TYPE_ALIASES: Record<string, string> = {
  'audio/mpeg': 'audio/mpeg',
  'audio/mp3': 'audio/mpeg',
  'audio/wav': 'audio/wav',
  'audio/x-wav': 'audio/wav',
  'audio/wave': 'audio/wav',
  'audio/ogg': 'audio/ogg',
  'application/ogg': 'audio/ogg',
  'audio/flac': 'audio/flac',
  'audio/x-flac': 'audio/flac',
  'audio/mp4': 'audio/mp4',
  'audio/aac': 'audio/aac',
};

export class RecordingValidationError extends Error {}

export function verifyAudioBody(
  source: AsyncIterable<Uint8Array>,
  input: {
    declaredContentType: string;
    declaredLength: number | null;
    maxBytes: number;
  },
): VerifiedAudioBody {
  const declaredContentType = normalizeDeclaredContentType(
    input.declaredContentType,
  );
  if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes < 1) {
    throw new TypeError('录音大小上限必须是正安全整数');
  }
  if (
    input.declaredLength !== null &&
    (!Number.isSafeInteger(input.declaredLength) || input.declaredLength < 0)
  ) {
    throw new RecordingValidationError('录音 Content-Length 无效');
  }
  if (input.declaredLength !== null && input.declaredLength > input.maxBytes) {
    throw new RecordingValidationError('录音超过允许的最大文件大小');
  }

  let completed: VerifiedAudioMetadata | undefined;
  const body = (async function* () {
    const hash = createHash('sha256');
    let size = 0;
    let prefix = Buffer.alloc(0);
    let pending: Uint8Array[] = [];
    let detectedContentType: string | undefined;

    for await (const rawChunk of source) {
      const chunk = toUint8Array(rawChunk);
      if (chunk.byteLength === 0) continue;
      size += chunk.byteLength;
      if (size > input.maxBytes) {
        throw new RecordingValidationError('录音流超过允许的最大文件大小');
      }
      hash.update(chunk);
      if (!detectedContentType) {
        const remaining = Math.max(0, 12 - prefix.byteLength);
        if (remaining > 0) {
          prefix = Buffer.concat([
            prefix,
            Buffer.from(
              chunk.buffer,
              chunk.byteOffset,
              Math.min(chunk.byteLength, remaining),
            ),
          ]);
        }
        pending.push(chunk);
        detectedContentType = detectAudioContentType(prefix);
        if (detectedContentType || prefix.byteLength >= 12) {
          assertDetectedType(detectedContentType, declaredContentType);
          for (const buffered of pending) yield buffered;
          pending = [];
        }
      } else {
        yield chunk;
      }
    }

    if (!detectedContentType) {
      detectedContentType = detectAudioContentType(prefix);
      assertDetectedType(detectedContentType, declaredContentType);
      for (const buffered of pending) yield buffered;
    }
    if (size === 0) {
      throw new RecordingValidationError('录音响应正文为空');
    }
    if (input.declaredLength !== null && size !== input.declaredLength) {
      throw new RecordingValidationError(
        '录音实际字节数与 Content-Length 不一致',
      );
    }
    completed = {
      contentType: detectedContentType,
      sizeBytes: BigInt(size),
      sha256: hash.digest('hex'),
    };
  })();

  return {
    body,
    metadata() {
      if (!completed) {
        throw new Error('录音流尚未完整写入，不能读取校验结果');
      }
      return completed;
    },
  };
}

function normalizeDeclaredContentType(value: string): string | null {
  const normalized = value.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (normalized === 'application/octet-stream') return null;
  const canonical = CONTENT_TYPE_ALIASES[normalized];
  if (!canonical) {
    throw new RecordingValidationError(
      `不支持的录音 Content-Type：${normalized || '缺失'}`,
    );
  }
  return canonical;
}

function assertDetectedType(
  detected: string | undefined,
  declared: string | null,
): asserts detected is string {
  if (!detected) {
    throw new RecordingValidationError('录音文件头不是受支持的音频格式');
  }
  if (declared && detected !== declared) {
    throw new RecordingValidationError(
      `录音文件头类型 ${detected} 与响应类型 ${declared} 不一致`,
    );
  }
}

function detectAudioContentType(bytes: Uint8Array): string | undefined {
  if (bytes.byteLength >= 3 && ascii(bytes, 0, 3) === 'ID3') {
    return 'audio/mpeg';
  }
  if (
    bytes.byteLength >= 2 &&
    bytes[0] === 0xff &&
    (bytes[1]! & 0xf6) === 0xf0
  ) {
    return 'audio/aac';
  }
  if (
    bytes.byteLength >= 2 &&
    bytes[0] === 0xff &&
    (bytes[1]! & 0xe0) === 0xe0
  ) {
    return 'audio/mpeg';
  }
  if (
    bytes.byteLength >= 12 &&
    ascii(bytes, 0, 4) === 'RIFF' &&
    ascii(bytes, 8, 4) === 'WAVE'
  ) {
    return 'audio/wav';
  }
  if (bytes.byteLength >= 4 && ascii(bytes, 0, 4) === 'OggS') {
    return 'audio/ogg';
  }
  if (bytes.byteLength >= 4 && ascii(bytes, 0, 4) === 'fLaC') {
    return 'audio/flac';
  }
  if (bytes.byteLength >= 8 && ascii(bytes, 4, 4) === 'ftyp') {
    return 'audio/mp4';
  }
  return undefined;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset + offset, length).toString(
    'ascii',
  );
}

function toUint8Array(value: Uint8Array): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new RecordingValidationError('录音响应流包含无效数据块');
  }
  return value;
}

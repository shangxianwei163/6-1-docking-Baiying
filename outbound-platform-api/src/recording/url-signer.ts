import { createHmac, timingSafeEqual } from 'node:crypto';

export type RecordingUrlSignatureInput = {
  recordingId: string;
  audience: string;
  expiresAtEpochSeconds: number;
};

export interface RecordingUrlSigner {
  audienceToken(audienceType: 'OPERATOR', audienceId: string): string;
  sign(input: RecordingUrlSignatureInput): string;
  verify(input: RecordingUrlSignatureInput, signature: string): boolean;
}

export class LocalRecordingUrlSigner implements RecordingUrlSigner {
  private readonly audienceKey: Buffer;
  private readonly signatureKey: Buffer;

  constructor(
    rootSecret: string,
    environment: 'development' | 'test' | 'production',
  ) {
    if (environment === 'production') {
      throw new Error('生产环境禁止使用本地录音 URL 签名器');
    }
    if (rootSecret.length < 24) {
      throw new Error('本地录音 URL 根密钥长度至少为 24 个字符');
    }
    this.audienceKey = derive(rootSecret, 'recording-url-audience');
    this.signatureKey = derive(rootSecret, 'recording-url-signature');
  }

  audienceToken(audienceType: 'OPERATOR', audienceId: string): string {
    const normalizedId = audienceId.trim();
    if (!normalizedId || normalizedId.length > 128) {
      throw new TypeError('录音下载调用方标识长度必须为 1～128 字符');
    }
    return createHmac('sha256', this.audienceKey)
      .update(`${audienceType}:${normalizedId}`, 'utf8')
      .digest('hex');
  }

  sign(input: RecordingUrlSignatureInput): string {
    return createHmac('sha256', this.signatureKey)
      .update(canonical(input), 'utf8')
      .digest('hex');
  }

  verify(input: RecordingUrlSignatureInput, signature: string): boolean {
    if (!/^[a-f0-9]{64}$/.test(signature)) return false;
    const actual = Buffer.from(signature, 'hex');
    const expected = Buffer.from(this.sign(input), 'hex');
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  }
}

function canonical(input: RecordingUrlSignatureInput): string {
  if (!Number.isSafeInteger(input.expiresAtEpochSeconds)) {
    throw new TypeError('录音下载 URL 过期时间必须是安全整数');
  }
  return [
    'recording-download-v1',
    input.recordingId,
    input.audience,
    input.expiresAtEpochSeconds.toString(),
  ].join('\n');
}

function derive(rootSecret: string, purpose: string): Buffer {
  return createHmac('sha256', rootSecret)
    .update(`outbound-platform:v1:${purpose}`, 'utf8')
    .digest();
}

import type { DataProtector } from '../security/data-protector.js';
import type {
  CallbackInboxRepository,
  CallbackIngestResult,
} from './repository.js';
import { inspectBaiyingCallback } from './schema.js';

export const DEFAULT_CALLBACK_BODY_LIMIT_BYTES = 5 * 1024 * 1024;

export class CallbackBodyTooLargeError extends Error {}

export interface BaiyingCallbackIngress {
  ingest(input: {
    rawBody: string;
    headers: Headers;
  }): Promise<CallbackIngestResult & { callbackType: string }>;
}

export class BaiyingCallbackIngressService implements BaiyingCallbackIngress {
  constructor(
    private readonly repository: CallbackInboxRepository,
    private readonly protector: DataProtector,
    private readonly maxBodyBytes = DEFAULT_CALLBACK_BODY_LIMIT_BYTES,
  ) {}

  async ingest(input: {
    rawBody: string;
    headers: Headers;
  }): Promise<CallbackIngestResult & { callbackType: string }> {
    const byteLength = Buffer.byteLength(input.rawBody, 'utf8');
    if (byteLength > this.maxBodyBytes) {
      throw new CallbackBodyTooLargeError(
        `百应回调正文超过 ${this.maxBodyBytes} 字节限制`,
      );
    }
    const inspected = inspectBaiyingCallback(input.rawBody);
    const saved = await this.repository.save({
      callbackType: inspected.callbackType,
      eventKey: inspected.eventKey,
      companyId: inspected.companyId,
      callJobId: inspected.callJobId,
      callInstanceId: inspected.callInstanceId,
      rawBodyCiphertext: this.protector.encryptUtf8(input.rawBody),
      rawBodySha256: inspected.rawBodySha256,
      headers: safeHeaderSummary(input.headers),
    });
    return { ...saved, callbackType: inspected.callbackType };
  }
}

function safeHeaderSummary(headers: Headers): Record<string, string> {
  const allowed = [
    'content-type',
    'content-length',
    'user-agent',
    'x-request-id',
    'x-real-ip',
  ];
  return Object.fromEntries(
    allowed.flatMap((name) => {
      const value = headers.get(name)?.trim();
      return value ? [[name, value.slice(0, 1_000)]] : [];
    }),
  );
}

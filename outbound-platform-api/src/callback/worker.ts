import { createHash } from 'node:crypto';
import type { DataProtector } from '../security/data-protector.js';
import type { BaiyingCallbackProcessor } from './processor.js';
import type {
  CallbackFailureResult,
  CallbackInboxRepository,
} from './repository.js';
import {
  BaiyingCallbackParseError,
  parseBaiyingCallback,
  UnsupportedBaiyingCallbackTypeError,
} from './schema.js';

export type CallbackWorkerResult =
  | { status: 'IDLE' }
  | {
      status: 'SUCCEEDED';
      inboxId: string;
      callbackType: string;
      taskId: string;
      duplicate: boolean;
      settled: boolean;
    }
  | {
      status: 'REJECTED';
      inboxId: string;
      parseStatus: 'INVALID' | 'UNKNOWN_TYPE';
    }
  | ({ inboxId: string } & CallbackFailureResult);

export class BaiyingCallbackWorker {
  constructor(
    private readonly repository: CallbackInboxRepository,
    private readonly processor: BaiyingCallbackProcessor,
    private readonly protector: DataProtector,
    private readonly options: {
      workerId: string;
      maxAttempts?: number;
      retryDelaysMs?: number[];
      lockTimeoutSeconds?: number;
      eventKey?: string;
    },
  ) {}

  async runOnce(): Promise<CallbackWorkerResult> {
    const claimed = await this.repository.claimNext({
      workerId: this.options.workerId,
      lockTimeoutSeconds: this.options.lockTimeoutSeconds,
      eventKey: this.options.eventKey,
    });
    if (!claimed) return { status: 'IDLE' };

    let callback;
    try {
      const rawBody = this.protector.decryptUtf8(claimed.rawBodyCiphertext);
      const actualHash = createHash('sha256')
        .update(rawBody, 'utf8')
        .digest('hex');
      if (actualHash !== claimed.rawBodySha256) {
        throw new BaiyingCallbackParseError(
          '回调原始正文解密后的 SHA-256 与入站记录不一致',
        );
      }
      callback = parseBaiyingCallback(rawBody);
    } catch (error) {
      if (
        error instanceof BaiyingCallbackParseError ||
        error instanceof UnsupportedBaiyingCallbackTypeError
      ) {
        const parseStatus =
          error instanceof UnsupportedBaiyingCallbackTypeError
            ? 'UNKNOWN_TYPE'
            : 'INVALID';
        await this.repository.reject({
          inboxId: claimed.id,
          workerId: this.options.workerId,
          parseStatus,
          error: error.message,
        });
        return { status: 'REJECTED', inboxId: claimed.id, parseStatus };
      }
      return this.fail(claimed.id, claimed.processAttempts, error, 'PENDING');
    }

    try {
      const outcome = await this.processor.process(claimed.id, callback);
      await this.repository.complete({
        inboxId: claimed.id,
        workerId: this.options.workerId,
      });
      return {
        status: 'SUCCEEDED',
        inboxId: claimed.id,
        ...outcome,
      };
    } catch (error) {
      return this.fail(claimed.id, claimed.processAttempts, error, 'VALID');
    }
  }

  private async fail(
    inboxId: string,
    attempts: number,
    error: unknown,
    parseStatus: 'PENDING' | 'VALID',
  ): Promise<CallbackWorkerResult> {
    const retryDelays = this.options.retryDelaysMs ?? [
      5_000, 30_000, 120_000, 600_000, 1_800_000,
    ];
    const result = await this.repository.fail({
      inboxId,
      workerId: this.options.workerId,
      error: errorMessage(error),
      retryDelayMs:
        retryDelays[
          Math.min(Math.max(attempts - 1, 0), retryDelays.length - 1)
        ] ?? 1_800_000,
      maxAttempts: this.options.maxAttempts ?? retryDelays.length + 1,
      parseStatus,
    });
    return { inboxId, ...result };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
}

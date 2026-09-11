import { outboundCallbackEventSchema } from '@outbound/contracts';
import { z } from 'zod';
import { redactOperatorText } from '../operations/redaction.js';
import type { SecretProvider } from '../security/secret-provider.js';
import type {
  ClaimedDeliveryEvent,
  DeliveryFailureResult,
  DeliveryRepository,
} from './repository.js';
import { serializeStableJson } from './serializer.js';
import { signCallbackRequest } from './signature.js';
import type { DeliveryHttpResponse, DeliveryTransport } from './transport.js';
import {
  CallbackTargetValidationError,
  parseCallbackTargetUrl,
} from './callback-url.js';

export type DeliveryWorkerResult =
  | { status: 'IDLE' }
  | {
      status: 'SUCCEEDED';
      deliveryEventId: string;
      eventId: string;
      eventType: string;
      attempt: number;
      responseStatus: number;
    }
  | ({
      deliveryEventId: string;
      eventId: string;
      eventType: string;
      error: string;
    } & DeliveryFailureResult);

export class CallbackDeliveryWorker {
  constructor(
    private readonly repository: DeliveryRepository,
    private readonly transport: DeliveryTransport,
    private readonly secrets: SecretProvider,
    private readonly options: {
      workerId: string;
      timeoutMs?: number;
      maxAttempts?: number;
      retryDelaysMs?: number[];
      lockTimeoutSeconds?: number;
      deliveryEventId?: string;
      clock?: () => Date;
    },
  ) {}

  async runOnce(): Promise<DeliveryWorkerResult> {
    const claimed = await this.repository.claimNext({
      workerId: this.options.workerId,
      lockTimeoutSeconds: this.options.lockTimeoutSeconds,
      deliveryEventId: this.options.deliveryEventId,
    });
    if (!claimed) return { status: 'IDLE' };

    const requestedAt = this.clock();
    const started = performance.now();
    try {
      const event = outboundCallbackEventSchema.parse(claimed.payload);
      if (
        event.eventId !== claimed.eventId ||
        event.eventType !== claimed.eventType ||
        (claimed.target === 'RECORDING') !==
          (event.eventType === 'OUTBOUND_RECORDING_AVAILABLE_BATCH')
      ) {
        throw new PermanentDeliveryError(
          'EVENT_IDENTITY_MISMATCH',
          '投递事件的标识、类型或目标与持久化记录不一致',
        );
      }
      const target = validateTarget(claimed.targetUrl);
      const rawBody = serializeStableJson(
        event.eventType === 'OUTBOUND_CALL_RESULT_V2' ? event.result : event,
      );
      const timestamp = requestedAt.getTime().toString();
      const secret = await this.secrets.getSecretBytes(
        claimed.signingSecretRef,
      );
      const signature = signCallbackRequest(
        {
          url: target,
          timestamp,
          eventId: claimed.eventId,
          rawBody,
        },
        secret,
      );
      const response = await this.transport.send({
        url: target.toString(),
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'outbound-platform-callback-dispatcher/1.0',
          'X-Platform-Event-Id': claimed.eventId,
          'X-Timestamp': timestamp,
          'X-Signature': signature,
          'X-Contract-Version': event.schemaVersion,
        },
        body: rawBody,
        timeoutMs: this.options.timeoutMs ?? 10_000,
      });
      const durationMs = elapsed(started);
      const responseSummary = summarizeResponse(response);
      if (isSuccessfulStatus(response.status)) {
        await this.repository.complete({
          deliveryEventId: claimed.id,
          workerId: this.options.workerId,
          responseStatus: response.status,
          responseSummary,
          requestedAt,
          durationMs,
        });
        return {
          status: 'SUCCEEDED',
          deliveryEventId: claimed.id,
          eventId: claimed.eventId,
          eventType: claimed.eventType,
          attempt: claimed.attemptCount,
          responseStatus: response.status,
        };
      }
      const retryable = isRetryableHttpStatus(response.status);
      return this.fail(claimed, {
        retryable,
        responseStatus: response.status,
        responseSummary,
        errorClass: `HTTP_${response.status}`,
        errorMessage: retryable
          ? `接收端返回可重试状态 ${response.status}`
          : `接收端返回永久失败状态 ${response.status}`,
        requestedAt,
        durationMs,
      });
    } catch (error) {
      const durationMs = elapsed(started);
      const permanent =
        error instanceof PermanentDeliveryError || error instanceof z.ZodError;
      const errorClass =
        error instanceof PermanentDeliveryError
          ? error.code
          : error instanceof z.ZodError
            ? 'EVENT_SCHEMA_INVALID'
            : safeErrorClass(error);
      const message =
        error instanceof z.ZodError
          ? '投递事件不符合已发布的回调 Schema'
          : error instanceof Error
            ? error.message
            : '外部回调投递失败';
      return this.fail(claimed, {
        retryable: !permanent,
        responseStatus: null,
        responseSummary: null,
        errorClass,
        errorMessage: message,
        requestedAt,
        durationMs,
      });
    }
  }

  private async fail(
    claimed: ClaimedDeliveryEvent,
    input: {
      retryable: boolean;
      responseStatus: number | null;
      responseSummary: string | null;
      errorClass: string;
      errorMessage: string;
      requestedAt: Date;
      durationMs: number;
    },
  ): Promise<DeliveryWorkerResult> {
    const retryDelays = this.options.retryDelaysMs ?? documentedRetryDelaysMs;
    const failure = await this.repository.fail({
      deliveryEventId: claimed.id,
      workerId: this.options.workerId,
      ...input,
      errorMessage: redactOperatorText(input.errorMessage) ?? '投递失败',
      retryDelayMs:
        retryDelays[
          Math.min(
            Math.max(claimed.retryCycleAttemptCount - 1, 0),
            retryDelays.length - 1,
          )
        ] ?? documentedRetryDelaysMs.at(-1)!,
      maxAttempts: this.options.maxAttempts ?? retryDelays.length + 1,
    });
    return {
      ...failure,
      deliveryEventId: claimed.id,
      eventId: claimed.eventId,
      eventType: claimed.eventType,
      error: redactOperatorText(input.errorMessage) ?? '投递失败',
    };
  }

  private clock(): Date {
    return this.options.clock?.() ?? new Date();
  }
}

export const documentedRetryDelaysMs = [
  60_000, 300_000, 900_000, 1_800_000, 3_600_000, 7_200_000, 14_400_000,
  28_800_000,
] as const;

export function isSuccessfulStatus(status: number): boolean {
  return Number.isInteger(status) && status >= 200 && status < 300;
}

export function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

class PermanentDeliveryError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PermanentDeliveryError';
  }
}

function validateTarget(rawUrl: string): URL {
  try {
    return parseCallbackTargetUrl(rawUrl);
  } catch (error) {
    const message =
      error instanceof CallbackTargetValidationError
        ? error.message
        : '回调目标不是有效 URL';
    throw new PermanentDeliveryError('TARGET_URL_INVALID', message);
  }
}

function summarizeResponse(response: DeliveryHttpResponse): string | null {
  const body = response.body.trim();
  return body || null;
}

function safeErrorClass(error: unknown): string {
  if (!(error instanceof Error)) return 'DELIVERY_ERROR';
  const value = error.name.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 128);
  return value || 'DELIVERY_ERROR';
}

function elapsed(started: number): number {
  return Math.max(
    0,
    Math.min(2_147_483_647, Math.round(performance.now() - started)),
  );
}

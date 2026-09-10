import {
  outboundCallbackEventSchema,
  type OutboundCallbackEvent,
} from '@outbound/contracts';
import { z } from 'zod';
import type { OutboxRepository } from '../outbox/repository.js';
import { recordingArchivedForDeliverySchema } from './internal-event.js';
import type { RecordingDeliveryEventBuilder } from './recording-event-builder.js';
import {
  DeliveryMaterializationError,
  type DeliveryEventStore,
} from './repository.js';

const externalEventTypes = [
  'OUTBOUND_TASK_STARTED',
  'OUTBOUND_TASK_START_FAILED',
  'OUTBOUND_CALL_RESULT_BATCH',
  'OUTBOUND_TASK_COMPLETED',
  'OUTBOUND_CALL_RESULT_V2',
] as const;
const recordingInternalEventType = 'RECORDING_ARCHIVED_FOR_DELIVERY';

export type DeliveryProjectionResult =
  | { status: 'IDLE' }
  | {
      status: 'MATERIALIZED';
      outboxEventId: string;
      deliveryEventId: string;
      eventId: string;
      eventType: string;
      created: boolean;
    }
  | {
      status: 'RETRY_SCHEDULED' | 'DEAD_LETTERED';
      outboxEventId: string;
      attempts: number;
      error: string;
    };

export class DeliveryOutboxProjector {
  constructor(
    private readonly outbox: OutboxRepository,
    private readonly deliveryEvents: DeliveryEventStore,
    private readonly recordingEvents: RecordingDeliveryEventBuilder,
    private readonly options: {
      queueName: string;
      workerId: string;
      maxAttempts?: number;
      retryDelaysMs?: number[];
      lockTimeoutSeconds?: number;
    },
  ) {}

  async runOnce(): Promise<DeliveryProjectionResult> {
    const claimed = await this.claimNext();
    if (!claimed) return { status: 'IDLE' };
    try {
      const event = await this.toExternalEvent(
        claimed.eventType,
        claimed.payload,
      );
      const materialized = await this.deliveryEvents.materialize(event);
      await this.outbox.complete(claimed.id, this.options.workerId);
      return {
        status: 'MATERIALIZED',
        outboxEventId: claimed.id,
        deliveryEventId: materialized.id,
        eventId: materialized.eventId,
        eventType: event.eventType,
        created: materialized.created,
      };
    } catch (error) {
      const message = safeError(error);
      const delays = this.options.retryDelaysMs ?? [
        5_000, 30_000, 120_000, 600_000, 1_800_000,
      ];
      const permanent =
        error instanceof z.ZodError ||
        error instanceof DeliveryMaterializationError;
      const failure = await this.outbox.fail({
        eventId: claimed.id,
        workerId: this.options.workerId,
        error: message,
        retryDelayMs:
          delays[
            Math.min(Math.max(claimed.attempts - 1, 0), delays.length - 1)
          ] ?? 1_800_000,
        maxAttempts: permanent ? 1 : (this.options.maxAttempts ?? 8),
      });
      return {
        status: failure.status,
        outboxEventId: claimed.id,
        attempts: failure.attempts,
        error: message,
      };
    }
  }

  private async claimNext() {
    for (const eventType of [
      ...externalEventTypes,
      recordingInternalEventType,
    ]) {
      const claimed = await this.outbox.claimNext({
        queueName: this.options.queueName,
        eventType,
        workerId: this.options.workerId,
        lockTimeoutSeconds: this.options.lockTimeoutSeconds,
      });
      if (claimed) return claimed;
    }
    return null;
  }

  private async toExternalEvent(
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<OutboundCallbackEvent> {
    if (eventType === recordingInternalEventType) {
      return this.recordingEvents.build(
        recordingArchivedForDeliverySchema.parse(payload),
      );
    }
    const event = outboundCallbackEventSchema.parse(payload);
    if (event.eventType !== eventType) {
      throw new z.ZodError([
        {
          code: 'custom',
          path: ['eventType'],
          message: 'Outbox eventType 与 Payload eventType 不一致',
        },
      ]);
    }
    return event;
  }
}

function safeError(error: unknown): string {
  if (error instanceof z.ZodError) {
    return `待投递事件格式无效：${error.issues.map((issue) => issue.message).join('；')}`.slice(
      0,
      2_000,
    );
  }
  return (
    error instanceof Error ? `${error.name}: ${error.message}` : '事件投影失败'
  ).slice(0, 2_000);
}

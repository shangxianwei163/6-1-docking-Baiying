import { describe, expect, it, vi } from 'vitest';
import type { RecordingAvailableBatchEvent } from '@outbound/contracts';
import type { OutboxRepository } from '../outbox/repository.js';
import {
  DeliveryMaterializationError,
  type DeliveryEventStore,
} from './repository.js';
import type { RecordingDeliveryEventBuilder } from './recording-event-builder.js';
import { DeliveryOutboxProjector } from './outbox-projector.js';

const startedEvent = {
  schemaVersion: '1.0',
  eventId: '11111111-1111-4111-8111-111111111111',
  eventType: 'OUTBOUND_TASK_STARTED',
  occurredAt: '2026-09-06T10:00:00+08:00',
  sourceSystem: 'ERP',
  mcCode: 'MC-ZTY-001',
  taskNo: 'PT-20260906-00025',
  baiyingCallJobId: '241491320',
  executionStatus: 'CALLING',
  startedAt: '2026-09-06T10:00:00+08:00',
};

describe('DeliveryOutboxProjector', () => {
  it('materializes and acknowledges a contract event idempotently', async () => {
    const complete = vi.fn<OutboxRepository['complete']>();
    const materialize = vi.fn<DeliveryEventStore['materialize']>(async () => ({
      id: '29e49dc9-fe93-4971-8fea-bfdc586e81fe',
      eventId: startedEvent.eventId,
      eventKey: 'event-key',
      created: true,
    }));
    const projector = new DeliveryOutboxProjector(
      outboxFor('OUTBOUND_TASK_STARTED', startedEvent, { complete }),
      { materialize },
      { build: vi.fn() },
      { queueName: 'delivery', workerId: 'projector' },
    );

    await expect(projector.runOnce()).resolves.toMatchObject({
      status: 'MATERIALIZED',
      eventId: startedEvent.eventId,
    });
    expect(materialize).toHaveBeenCalledWith(startedEvent);
    expect(complete).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111119',
      'projector',
    );
  });

  it('builds recording payloads only after archive completion', async () => {
    const recordingEvent: RecordingAvailableBatchEvent = {
      schemaVersion: '1.0',
      eventId: '11111111-1111-4111-8111-111111111112',
      eventType: 'OUTBOUND_RECORDING_AVAILABLE_BATCH' as const,
      occurredAt: startedEvent.occurredAt,
      sourceSystem: 'ERP',
      mcCode: startedEvent.mcCode,
      taskNo: startedEvent.taskNo,
      baiyingCallJobId: startedEvent.baiyingCallJobId,
      batchNo: 1,
      isLastBatch: true,
      recordings: [
        {
          recordingId: '22222222-2222-4222-8222-222222222222',
          platformCallId: '33333333-3333-4333-8333-333333333333',
          baiyingCallInstanceId: 'call-1',
          kind: 'FULL' as const,
          contentType: 'audio/mpeg',
          sizeBytes: 42,
          sha256: 'a'.repeat(64),
          downloadUrl: 'https://recordings.mock.invalid/file',
          expiresAt: '2026-09-06T10:15:00+08:00',
        },
      ],
    };
    const descriptor = {
      schemaVersion: '1.0',
      eventId: recordingEvent.eventId,
      eventType: 'RECORDING_ARCHIVED_FOR_DELIVERY',
      occurredAt: '2026-09-06T10:00:00+08:00',
      taskId: '44444444-4444-4444-8444-444444444444',
      recordingId: recordingEvent.recordings[0]!.recordingId,
      batchNo: 1,
      isLastBatch: true,
    };
    const build = vi.fn<RecordingDeliveryEventBuilder['build']>(
      async () => recordingEvent,
    );
    const materialize = vi.fn<DeliveryEventStore['materialize']>(async () => ({
      id: '55555555-5555-4555-8555-555555555555',
      eventId: recordingEvent.eventId,
      eventKey: 'recording-event-key',
      created: true,
    }));
    const projector = new DeliveryOutboxProjector(
      outboxFor('RECORDING_ARCHIVED_FOR_DELIVERY', descriptor),
      { materialize },
      { build },
      { queueName: 'delivery', workerId: 'projector' },
    );

    await expect(projector.runOnce()).resolves.toMatchObject({
      status: 'MATERIALIZED',
      eventType: 'OUTBOUND_RECORDING_AVAILABLE_BATCH',
    });
    expect(build).toHaveBeenCalledWith(descriptor);
    expect(materialize).toHaveBeenCalledWith(recordingEvent);
  });

  it('dead-letters a permanent materialization error without futile retries', async () => {
    const fail = vi.fn<OutboxRepository['fail']>(async () => ({
      status: 'DEAD_LETTERED',
      attempts: 1,
      availableAt: null,
    }));
    const materialize = vi.fn<DeliveryEventStore['materialize']>(async () => {
      throw new DeliveryMaterializationError('任务快照不可用于投递');
    });
    const projector = new DeliveryOutboxProjector(
      outboxFor('OUTBOUND_TASK_STARTED', startedEvent, { fail }),
      { materialize },
      { build: vi.fn() },
      { queueName: 'delivery', workerId: 'projector' },
    );

    await expect(projector.runOnce()).resolves.toMatchObject({
      status: 'DEAD_LETTERED',
    });
    expect(fail).toHaveBeenCalledWith(
      expect.objectContaining({ maxAttempts: 1 }),
    );
  });
});

function outboxFor(
  selectedType: string,
  payload: Record<string, unknown>,
  overrides: Partial<OutboxRepository> = {},
): OutboxRepository {
  return {
    claimNext: vi.fn(async (input) =>
      input.eventType === selectedType
        ? {
            id: '11111111-1111-4111-8111-111111111119',
            eventType: selectedType,
            queueName: 'delivery',
            payload,
            attempts: 1,
            createdAt: '2026-09-06T02:00:00.000Z',
          }
        : null,
    ),
    complete: vi.fn(),
    fail: vi.fn(),
    ...overrides,
  };
}

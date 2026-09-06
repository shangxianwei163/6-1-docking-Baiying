import { describe, expect, it, vi } from 'vitest';
import type { SecretProvider } from '../security/secret-provider.js';
import type { ClaimedDeliveryEvent, DeliveryRepository } from './repository.js';
import { verifyCallbackRequestSignature } from './signature.js';
import type { DeliveryTransport } from './transport.js';
import {
  CallbackDeliveryWorker,
  documentedRetryDelaysMs,
  isRetryableHttpStatus,
} from './worker.js';

const secret = Buffer.from('delivery-worker-secret');
const event = {
  schemaVersion: '1.0',
  eventId: '11111111-1111-4111-8111-111111111113',
  eventType: 'OUTBOUND_TASK_COMPLETED',
  occurredAt: '2026-09-06T10:35:00+08:00',
  sourceSystem: 'ERP',
  mcCode: 'MC-ZTY-001',
  taskNo: 'PT-20260906-00025',
  baiyingCallJobId: '241491320',
  executionStatus: 'COMPLETED',
  summary: {
    phoneCount: 1,
    importedCount: 1,
    callInstanceCount: 1,
    answeredCount: 1,
    totalDurationSeconds: 24,
    billingMinutes: 1,
    customerCharge: '0.480000',
    recordingDiscoveredCount: 0,
    recordingArchivedCount: 0,
  },
  completedAt: '2026-09-06T10:34:58+08:00',
};
const claimed: ClaimedDeliveryEvent = {
  id: '79b24aac-098d-47aa-a1ef-58f296c47a37',
  eventId: event.eventId,
  eventKey: `OUTBOUND_TASK_COMPLETED:task-1`,
  taskId: '48423f32-761c-40ed-bc00-c82c9b65cf7c',
  sourceSystem: 'ERP',
  target: 'RESULT',
  eventType: event.eventType,
  targetUrl: 'https://erp.mock.invalid/callbacks/results',
  payload: event,
  signingSecretRef: 'local-hkdf://callback:erp-local-01',
  attemptCount: 1,
  retryCycleAttemptCount: 1,
  createdAt: '2026-09-06T02:35:00.000Z',
};

describe('CallbackDeliveryWorker', () => {
  it('signs the immutable event body and accepts any 2xx ACK', async () => {
    const complete = vi.fn<DeliveryRepository['complete']>();
    const send = vi.fn<DeliveryTransport['send']>(async (request) => {
      expect(request.headers['X-Platform-Event-Id']).toBe(event.eventId);
      expect(
        verifyCallbackRequestSignature(
          {
            url: request.url,
            timestamp: request.headers['X-Timestamp']!,
            eventId: request.headers['X-Platform-Event-Id']!,
            rawBody: request.body,
          },
          secret,
          request.headers['X-Signature']!,
        ),
      ).toBe(true);
      expect(JSON.parse(Buffer.from(request.body).toString('utf8'))).toEqual(
        event,
      );
      return { status: 204, body: '' };
    });
    const worker = workerWith(repository({ complete }), { send });

    await expect(worker.runOnce()).resolves.toMatchObject({
      status: 'SUCCEEDED',
      responseStatus: 204,
    });
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ responseStatus: 204 }),
    );
  });

  it.each([408, 429, 500, 503])(
    'retries documented retryable HTTP status %i',
    async (status) => {
      const fail = vi.fn<DeliveryRepository['fail']>(async () => ({
        status: 'RETRY_SCHEDULED',
        attempts: 1,
        availableAt: '2026-09-06T10:36:00.000Z',
      }));
      const worker = workerWith(repository({ fail }), {
        send: async () => ({ status, body: 'temporary failure' }),
      });
      await expect(worker.runOnce()).resolves.toMatchObject({
        status: 'RETRY_SCHEDULED',
      });
      expect(fail).toHaveBeenCalledWith(
        expect.objectContaining({
          retryable: true,
          retryDelayMs: 60_000,
          maxAttempts: 9,
        }),
      );
    },
  );

  it('dead-letters a permanent 4xx classification through the repository', async () => {
    const fail = vi.fn<DeliveryRepository['fail']>(async () => ({
      status: 'DEAD_LETTERED',
      attempts: 1,
      availableAt: null,
    }));
    const worker = workerWith(repository({ fail }), {
      send: async () => ({ status: 400, body: 'invalid event' }),
    });
    await expect(worker.runOnce()).resolves.toMatchObject({
      status: 'DEAD_LETTERED',
    });
    expect(fail).toHaveBeenCalledWith(
      expect.objectContaining({ retryable: false, responseStatus: 400 }),
    );
  });

  it('uses the published eight-step retry schedule', () => {
    expect(documentedRetryDelaysMs).toEqual([
      60_000, 300_000, 900_000, 1_800_000, 3_600_000, 7_200_000, 14_400_000,
      28_800_000,
    ]);
    expect(isRetryableHttpStatus(409)).toBe(false);
  });
});

function workerWith(
  deliveryRepository: DeliveryRepository,
  transport: DeliveryTransport,
) {
  const secrets: SecretProvider = {
    getSecretBytes: vi.fn(async () => secret),
  };
  return new CallbackDeliveryWorker(deliveryRepository, transport, secrets, {
    workerId: 'delivery-worker-test',
    clock: () => new Date(1_788_661_800_000),
  });
}

function repository(
  overrides: Partial<DeliveryRepository>,
): DeliveryRepository {
  return {
    materialize: vi.fn(),
    claimNext: vi.fn(async () => claimed),
    complete: vi.fn(),
    fail: vi.fn(),
    ...overrides,
  };
}

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

  it('delivers and signs a legacy HTTP endpoint with its explicit port', async () => {
    const targetUrl = 'http://testmc.6161520.cn:8083/SAi/Sx_AI_CallResult';
    const send = vi.fn<DeliveryTransport['send']>(async (request) => {
      expect(request.url).toBe(targetUrl);
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
      return { status: 200, body: '{"Code":200}' };
    });
    const worker = workerWith(repository({}, { ...claimed, targetUrl }), {
      send,
    });

    await expect(worker.runOnce()).resolves.toMatchObject({
      status: 'SUCCEEDED',
      responseStatus: 200,
    });
  });

  it('persists the complete receiver response for operator diagnostics', async () => {
    const responseBody = JSON.stringify({
      code: 400,
      message: '参数校验失败',
      fields: Array.from({ length: 300 }, (_, index) => ({
        path: `data.items[${index}]`,
        reason: '字段值不符合接收端约束',
      })),
    });
    const complete = vi.fn<DeliveryRepository['complete']>();
    const worker = workerWith(repository({ complete }), {
      send: async () => ({ status: 200, body: responseBody }),
    });

    await expect(worker.runOnce()).resolves.toMatchObject({
      status: 'SUCCEEDED',
    });
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ responseSummary: responseBody }),
    );
  });

  it.each([
    'ftp://erp.example.com/callback',
    'http://erp.example.com/callback?token=secret',
    'https://user:secret@erp.example.com/callback',
  ])(
    'dead-letters an invalid target without sending: %s',
    async (targetUrl) => {
      const send = vi.fn<DeliveryTransport['send']>();
      const fail = vi.fn<DeliveryRepository['fail']>(async () => ({
        status: 'DEAD_LETTERED',
        attempts: 1,
        availableAt: null,
      }));
      const worker = workerWith(
        repository({ fail }, { ...claimed, targetUrl }),
        { send },
      );

      await expect(worker.runOnce()).resolves.toMatchObject({
        status: 'DEAD_LETTERED',
      });
      expect(send).not.toHaveBeenCalled();
      expect(fail).toHaveBeenCalledWith(
        expect.objectContaining({
          retryable: false,
          errorClass: 'TARGET_URL_INVALID',
        }),
      );
    },
  );

  it('delivers the token-wrapped business-first v2.1 customer result body', async () => {
    const result = {
      event_id: '11111111-1111-4111-8111-111111111114',
      event_type: 'OUTBOUND_CALL_RESULT',
      occurred_at: '2026-09-06T10:35:00+08:00',
      company_code: '5903679116',
      batch_id: '33333333-3333-4333-8333-333333333333',
      task_no: 'PT-20260906-00026',
      customer: {
        guid: '11111111-1111-4111-8111-111111111101',
        customer_name: '张女士',
        phone_masked: '135****0001',
      },
      customer_result: {
        result_code: 'HIGH_INTENT',
        result_text: '客户有明确意向，建议尽快跟进',
        contacted: true,
        intention_level: 'A',
        intention_text: '高意向',
        summary: '客户近期有拍摄计划。',
        follow_up_required: true,
        recommended_action: '建议尽快联系客户',
        customer_concerns: ['套餐价格'],
        customer_tags: ['高意向'],
        collected_data: { 预约门店: '湖滨店' },
      },
      call: {
        status: 'ANSWERED',
        status_text: '已接通',
        called_at: '2026-09-06T10:33:00+08:00',
        duration_seconds: 61,
      },
      conversation_logs: [
        { sequence: 1, speaker: 'AI', content: '您好。' },
        { sequence: 2, speaker: 'CUSTOMER', content: '你好。' },
      ],
      billing: {
        billing_minutes: 2,
        customer_charge: '0.960000',
        currency: 'CNY',
      },
    };
    const v2Event = {
      schemaVersion: '2.1',
      eventId: '11111111-1111-4111-8111-111111111114',
      eventType: 'OUTBOUND_CALL_RESULT_V2',
      occurredAt: '2026-09-06T10:35:00+08:00',
      sourceSystem: 'ERP',
      mcCode: '5903679116',
      taskNo: 'PT-20260906-00026',
      result,
    };
    const v2Claimed: ClaimedDeliveryEvent = {
      ...claimed,
      eventId: v2Event.eventId,
      eventKey: `OUTBOUND_CALL_RESULT_V2:${result.customer.guid}`,
      eventType: v2Event.eventType,
      payload: v2Event,
    };
    const send = vi.fn<DeliveryTransport['send']>(async (request) => {
      const rawBody = Buffer.from(request.body).toString('utf8');
      expect(request.headers['X-Contract-Version']).toBe('2.1');
      expect(JSON.parse(rawBody)).toEqual({
        Token: '^******^',
        Data: result,
      });
      expect(rawBody).not.toContain('baiyingCallJobId');
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
      return { status: 200, body: '{"code":200}' };
    });
    const worker = workerWith(repository({}, v2Claimed), { send });

    await expect(worker.runOnce()).resolves.toMatchObject({
      status: 'SUCCEEDED',
      eventType: 'OUTBOUND_CALL_RESULT_V2',
    });
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
  next: ClaimedDeliveryEvent = claimed,
): DeliveryRepository {
  return {
    materialize: vi.fn(),
    claimNext: vi.fn(async () => next),
    complete: vi.fn(),
    fail: vi.fn(),
    ...overrides,
  };
}

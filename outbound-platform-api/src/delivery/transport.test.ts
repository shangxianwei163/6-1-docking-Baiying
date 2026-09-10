import { describe, expect, it, vi } from 'vitest';
import { serializeStableJson } from './serializer.js';
import { signCallbackRequest } from './signature.js';
import {
  HttpDeliveryTransport,
  LocalNoNetworkDeliveryTransport,
} from './transport.js';

const secret = Buffer.from('local-receiver-test-secret');
const event = {
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

describe('LocalNoNetworkDeliveryTransport', () => {
  it('validates signature/schema and ACKs duplicate event IDs', async () => {
    const transport = new LocalNoNetworkDeliveryTransport({
      environment: 'test',
      secretForUrl: async () => secret,
    });
    const request = signedRequest();
    await expect(transport.send(request)).resolves.toMatchObject({
      status: 200,
    });
    await expect(transport.send(request)).resolves.toMatchObject({
      status: 200,
    });
    expect(transport.receipts.map((receipt) => receipt.duplicate)).toEqual([
      false,
      true,
    ]);
  });

  it('accepts the business-first v2.1 result body with identity in headers', async () => {
    const transport = new LocalNoNetworkDeliveryTransport({
      environment: 'test',
      secretForUrl: async () => secret,
    });
    const result = {
      event_id: '22222222-2222-4222-8222-222222222222',
      event_type: 'OUTBOUND_CALL_RESULT',
      occurred_at: '2026-09-10T15:30:25+08:00',
      company_code: '5903679116',
      batch_id: '59fd515e-00f2-4d62-93ec-8883fb3aa090',
      task_no: 'PT-20260910-00001',
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
        collected_data: { appointment: '2026-09-20' },
      },
      call: {
        status: 'ANSWERED',
        status_text: '已接通',
        called_at: '2026-09-10T15:28:30+08:00',
        duration_seconds: 115,
      },
      conversation_logs: [],
      billing: {
        billing_minutes: 2,
        customer_charge: '0.960000',
        currency: 'CNY',
      },
    };
    const eventId = '22222222-2222-4222-8222-222222222222';
    const url = 'https://erp.mock.invalid/callbacks/results';
    const timestamp = '1788661800000';
    const body = serializeStableJson(result);
    const response = await transport.send({
      url,
      headers: {
        'Content-Type': 'application/json',
        'X-Contract-Version': '2.1',
        'X-Platform-Event-Id': eventId,
        'X-Timestamp': timestamp,
        'X-Signature': signCallbackRequest(
          { url, timestamp, eventId, rawBody: body },
          secret,
        ),
      },
      body,
      timeoutMs: 10_000,
    });

    expect(response.status).toBe(200);
    expect(transport.receipts).toEqual([
      expect.objectContaining({
        eventId,
        eventType: 'OUTBOUND_CALL_RESULT_V2',
        duplicate: false,
      }),
    ]);
  });

  it('rejects a non-fixture destination without attempting a network call', async () => {
    const transport = new LocalNoNetworkDeliveryTransport({
      environment: 'test',
      secretForUrl: async () => secret,
    });
    await expect(
      transport.send({ ...signedRequest(), url: 'https://example.com/hook' }),
    ).rejects.toThrow('模拟地址');
    expect(transport.receipts).toHaveLength(0);
  });

  it('cannot be constructed in production', () => {
    expect(
      () =>
        new LocalNoNetworkDeliveryTransport({
          environment: 'production',
          secretForUrl: async () => secret,
        }),
    ).toThrow('生产环境禁止');
  });
});

describe('HttpDeliveryTransport', () => {
  it.each([
    'http://testmc.6161520.cn:8083/SAi/Sx_AI_CallResult',
    'https://erp.example.com/SAi/Sx_AI_CallResult',
  ])('posts to a fixed HTTP or HTTPS endpoint: %s', async (url) => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Promise.resolve(new Response('{"Code":200}', { status: 200 })),
    );
    const transport = new HttpDeliveryTransport({ fetchImpl });

    await expect(transport.send({ ...signedRequest(), url })).resolves.toEqual({
      status: 200,
      body: '{"Code":200}',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL(url),
      expect.objectContaining({
        method: 'POST',
        redirect: 'manual',
        body: expect.any(Buffer),
      }),
    );
  });

  it('does not follow a redirect returned by the receiver', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Promise.resolve(
        new Response('', {
          status: 302,
          headers: { Location: 'http://other.example.com/callback' },
        }),
      ),
    );
    const transport = new HttpDeliveryTransport({ fetchImpl });

    await expect(transport.send(signedRequest())).resolves.toEqual({
      status: 302,
      body: '',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects credentials, query strings, fragments and other protocols', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const transport = new HttpDeliveryTransport({ fetchImpl });

    for (const url of [
      'ftp://erp.example.com/callback',
      'http://user:secret@erp.example.com/callback',
      'http://erp.example.com/callback?token=secret',
      'https://erp.example.com/callback#fragment',
    ]) {
      await expect(transport.send({ ...signedRequest(), url })).rejects.toThrow(
        'HTTP 或 HTTPS',
      );
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

function signedRequest() {
  const url = 'https://erp.mock.invalid/callbacks/results';
  const timestamp = '1788661800000';
  const body = serializeStableJson(event);
  return {
    url,
    headers: {
      'Content-Type': 'application/json',
      'X-Platform-Event-Id': event.eventId,
      'X-Timestamp': timestamp,
      'X-Signature': signCallbackRequest(
        { url, timestamp, eventId: event.eventId, rawBody: body },
        secret,
      ),
    },
    body,
    timeoutMs: 10_000,
  };
}

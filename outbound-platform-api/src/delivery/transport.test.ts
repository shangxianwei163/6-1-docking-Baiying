import { describe, expect, it } from 'vitest';
import { serializeStableJson } from './serializer.js';
import { signCallbackRequest } from './signature.js';
import { LocalNoNetworkDeliveryTransport } from './transport.js';

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

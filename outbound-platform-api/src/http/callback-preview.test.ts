import { describe, expect, it, vi } from 'vitest';
import type { MappingRepository } from '../mapping/repository.js';
import { createApp } from './app.js';

describe('safe callback preview HTTP API', () => {
  it('requires an operator and forwards only the strict preview contract', async () => {
    const generate = vi.fn(() => ({
      mode: 'SAFE_PREVIEW' as const,
      generatedAt: '2026-09-06T02:30:00.000Z',
      receiver: 'ERP' as const,
      eventType: 'OUTBOUND_TASK_COMPLETED' as const,
      safety: {
        syntheticDataOnly: true as const,
        productionDataRead: false as const,
        deliveryAttempted: false as const,
        networkAccess: 'DISABLED' as const,
        destination: null,
        signatureMode: 'PLACEHOLDER_ONLY' as const,
      },
      request: {
        method: 'POST' as const,
        callbackPath: '/callbacks/outbound-preview' as const,
        headers: { 'X-Signature': 'SAFE_PREVIEW_UNSIGNED' },
        body: '{}',
        bodySha256: 'a'.repeat(64),
      },
    }));
    const app = createApp({
      mappingRepository: {} as MappingRepository,
      callbackPreviewService: { generate },
      consoleOrigin: 'http://localhost:4173',
      workerSharedSecret: 'test-worker-secret-at-least-24',
      createId: () => 'request-preview-001',
    });

    const unauthorized = await app.request('/api/v1/callback-previews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        environment: 'SAFE_PREVIEW',
        sourceSystem: 'ERP',
        eventType: 'OUTBOUND_TASK_COMPLETED',
      }),
    });
    expect(unauthorized.status).toBe(401);

    const response = await app.request('/api/v1/callback-previews', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-actor-id': 'platform-admin',
      },
      body: JSON.stringify({
        environment: 'SAFE_PREVIEW',
        sourceSystem: 'ERP',
        eventType: 'OUTBOUND_TASK_COMPLETED',
        itemCount: 1,
      }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      requestId: 'request-preview-001',
      data: {
        mode: 'SAFE_PREVIEW',
        safety: { deliveryAttempted: false, destination: null },
      },
    });
    expect(generate).toHaveBeenCalledWith({
      environment: 'SAFE_PREVIEW',
      sourceSystem: 'ERP',
      eventType: 'OUTBOUND_TASK_COMPLETED',
      itemCount: 1,
    });
  });

  it('rejects destinations, real-environment modes and excessive samples', async () => {
    const generate = vi.fn();
    const app = createApp({
      mappingRepository: {} as MappingRepository,
      callbackPreviewService: { generate },
      consoleOrigin: 'http://localhost:4173',
      workerSharedSecret: 'test-worker-secret-at-least-24',
    });
    const invalidBodies = [
      {
        environment: 'SAFE_PREVIEW',
        sourceSystem: 'ERP',
        eventType: 'OUTBOUND_TASK_COMPLETED',
        destination: 'https://erp.example.com/callback',
      },
      {
        environment: 'BAIYING_TEST',
        sourceSystem: 'ERP',
        eventType: 'OUTBOUND_TASK_COMPLETED',
      },
      {
        environment: 'SAFE_PREVIEW',
        sourceSystem: 'ERP',
        eventType: 'OUTBOUND_CALL_RESULT_BATCH',
        itemCount: 200,
      },
    ];

    for (const body of invalidBodies) {
      const response = await app.request('/api/v1/callback-previews', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-actor-id': 'platform-admin',
        },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
    }
    expect(generate).not.toHaveBeenCalled();
  });
});

import { describe, expect, it } from 'vitest';
import {
  callResultBatchEventSchema,
  recordingAvailableBatchEventSchema,
  taskCompletedEventSchema,
} from '@outbound/contracts';
import { SafeCallbackPreviewService } from './callback-preview-service.js';

const ids = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
  '55555555-5555-4555-8555-555555555555',
];

function service() {
  let index = 0;
  return new SafeCallbackPreviewService(
    () => new Date('2026-09-06T02:30:00.000Z'),
    () => ids[index++]!,
  );
}

describe('safe callback preview service', () => {
  it('builds a schema-valid synthetic call-result event without a destination', () => {
    const preview = service().generate({
      environment: 'SAFE_PREVIEW',
      sourceSystem: 'ERP',
      eventType: 'OUTBOUND_CALL_RESULT_BATCH',
      itemCount: 2,
    });
    const body = callResultBatchEventSchema.parse(
      JSON.parse(preview.request.body),
    );

    expect(body.calls).toHaveLength(2);
    expect(body.calls[0]).toMatchObject({
      externalCustomerId: 'SYNTHETIC-CUSTOMER-001',
      phoneMasked: '138****0000',
    });
    expect(preview.safety).toEqual({
      syntheticDataOnly: true,
      productionDataRead: false,
      deliveryAttempted: false,
      networkAccess: 'DISABLED',
      destination: null,
      signatureMode: 'PLACEHOLDER_ONLY',
    });
    expect(preview.request.headers['X-Signature']).toBe(
      'SAFE_PREVIEW_UNSIGNED',
    );
    expect(preview.request.bodySha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('builds schema-valid completion and recording examples with invalid-domain URLs', () => {
    const completed = service().generate({
      environment: 'SAFE_PREVIEW',
      sourceSystem: 'CRM',
      eventType: 'OUTBOUND_TASK_COMPLETED',
      itemCount: 1,
    });
    expect(() =>
      taskCompletedEventSchema.parse(JSON.parse(completed.request.body)),
    ).not.toThrow();

    const recording = service().generate({
      environment: 'SAFE_PREVIEW',
      sourceSystem: 'ERP',
      eventType: 'OUTBOUND_RECORDING_AVAILABLE_BATCH',
      itemCount: 1,
    });
    const recordingBody = recordingAvailableBatchEventSchema.parse(
      JSON.parse(recording.request.body),
    );
    expect(recordingBody.recordings[0]?.downloadUrl).toContain(
      'example.invalid',
    );
    expect(recording.request.body).not.toMatch(
      /(?:erp|crm|oss)\.[a-z0-9-]+\.(?:com|cn)/i,
    );
  });
});

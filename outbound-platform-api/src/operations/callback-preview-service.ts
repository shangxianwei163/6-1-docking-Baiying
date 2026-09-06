import {
  callResultBatchEventSchema,
  callbackPreviewSchema,
  recordingAvailableBatchEventSchema,
  taskCompletedEventSchema,
  type CallbackPreview,
  type CallbackPreviewInput,
} from '@outbound/contracts';
import { sha256Hex } from '../security/request-signature.js';

export interface CallbackPreviewService {
  generate(input: CallbackPreviewInput): CallbackPreview;
}

/**
 * Generates synthetic callback examples only. This service deliberately has no
 * HTTP client, endpoint repository, delivery queue or signing-secret dependency.
 */
export class SafeCallbackPreviewService implements CallbackPreviewService {
  constructor(
    private readonly clock: () => Date = () => new Date(),
    private readonly createId: () => string = () => crypto.randomUUID(),
  ) {}

  generate(input: CallbackPreviewInput): CallbackPreview {
    const generatedAt = this.clock();
    const eventId = this.createId();
    const common = {
      schemaVersion: '1.0' as const,
      eventId,
      occurredAt: generatedAt.toISOString(),
      sourceSystem: input.sourceSystem,
      mcCode: 'MC-SAFE-PREVIEW',
      taskNo: `PT-${shanghaiDateStamp(generatedAt)}-90001`,
      baiyingCallJobId: 'SAFE-PREVIEW-JOB-001',
    };
    const bodyObject = buildSyntheticEvent(
      input,
      common,
      generatedAt,
      this.createId,
    );
    const body = `${JSON.stringify(bodyObject, null, 2)}\n`;
    const timestamp = String(generatedAt.getTime());

    return callbackPreviewSchema.parse({
      mode: 'SAFE_PREVIEW',
      generatedAt: generatedAt.toISOString(),
      receiver: input.sourceSystem,
      eventType: input.eventType,
      safety: {
        syntheticDataOnly: true,
        productionDataRead: false,
        deliveryAttempted: false,
        networkAccess: 'DISABLED',
        destination: null,
        signatureMode: 'PLACEHOLDER_ONLY',
      },
      request: {
        method: 'POST',
        callbackPath: '/callbacks/outbound-preview',
        headers: {
          'Content-Type': 'application/json',
          'X-Platform-Event-Id': eventId,
          'X-Timestamp': timestamp,
          'X-Signature': 'SAFE_PREVIEW_UNSIGNED',
          'X-Preview-Mode': 'SAFE_PREVIEW',
        },
        body,
        bodySha256: sha256Hex(Buffer.from(body, 'utf8')),
      },
    });
  }
}

type CommonEvent = {
  schemaVersion: '1.0';
  eventId: string;
  occurredAt: string;
  sourceSystem: CallbackPreviewInput['sourceSystem'];
  mcCode: string;
  taskNo: string;
  baiyingCallJobId: string;
};

function buildSyntheticEvent(
  input: CallbackPreviewInput,
  common: CommonEvent,
  generatedAt: Date,
  createId: () => string,
) {
  if (input.eventType === 'OUTBOUND_TASK_COMPLETED') {
    return taskCompletedEventSchema.parse({
      ...common,
      eventType: input.eventType,
      executionStatus: 'COMPLETED',
      summary: {
        phoneCount: input.itemCount,
        importedCount: input.itemCount,
        callInstanceCount: input.itemCount,
        answeredCount: input.itemCount,
        totalDurationSeconds: input.itemCount * 24,
        billingMinutes: input.itemCount,
        customerCharge: (input.itemCount * 0.48).toFixed(6),
        recordingDiscoveredCount: input.itemCount,
        recordingArchivedCount: input.itemCount,
      },
      completedAt: generatedAt.toISOString(),
    });
  }

  if (input.eventType === 'OUTBOUND_RECORDING_AVAILABLE_BATCH') {
    return recordingAvailableBatchEventSchema.parse({
      ...common,
      eventType: input.eventType,
      batchNo: 1,
      isLastBatch: true,
      recordings: Array.from({ length: input.itemCount }, (_, index) => ({
        recordingId: createId(),
        platformCallId: createId(),
        baiyingCallInstanceId: `SAFE-PREVIEW-CALL-${index + 1}`,
        kind: 'FULL' as const,
        contentType: 'audio/mpeg',
        sizeBytes: 384_210 + index,
        sha256: 'a'.repeat(64),
        downloadUrl: `https://recordings.example.invalid/safe-preview/${index + 1}?signature=redacted`,
        expiresAt: new Date(
          generatedAt.getTime() + 15 * 60 * 1_000,
        ).toISOString(),
      })),
    });
  }

  return callResultBatchEventSchema.parse({
    ...common,
    eventType: input.eventType,
    batchNo: 1,
    isLastBatch: true,
    calls: Array.from({ length: input.itemCount }, (_, index) => ({
      externalCustomerId: `SYNTHETIC-CUSTOMER-${String(index + 1).padStart(3, '0')}`,
      platformCallId: createId(),
      baiyingCallInstanceId: `SAFE-PREVIEW-CALL-${index + 1}`,
      phoneMasked: `138****${String(index).padStart(4, '0')}`,
      callStatus: 'ANSWERED' as const,
      finishStatus: 1,
      durationSeconds: 24,
      billingMinutes: 1,
      customerCharge: '0.480000',
      collectProperties: { intent_level: 'SYNTHETIC_A' },
    })),
  });
}

function shanghaiDateStamp(value: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)!.value;
  return `${part('year')}${part('month')}${part('day')}`;
}

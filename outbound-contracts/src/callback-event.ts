import { z } from 'zod';
import { outboundCallbackToken, sourceSystemSchema } from './envelope.js';
import { nonNegativeAmountSchema } from './billing.js';
import {
  outboundRecordingCallbackEnvelopeV2Schema,
  recordingDeliveryItemSchema,
  recordingDeliveryItemV21Schema,
} from './recording.js';
import { taskFailureSchema } from './outbound-task.js';
import {
  outboundCallResultCallbackEnvelopeV2Schema,
  outboundCallResultInternalEventV2Schema,
} from './outbound-task-v2.js';

const callbackEventBaseShape = {
  schemaVersion: z.literal('1.0'),
  eventId: z.uuid(),
  occurredAt: z.iso.datetime({ offset: true }),
  sourceSystem: sourceSystemSchema,
  mcCode: z.string().min(1).max(64),
  taskNo: z.string().regex(/^PT-\d{8}-\d{5,}$/),
  baiyingCallJobId: z.string().min(1).max(64).nullable(),
};

export const taskStartedEventSchema = z.object({
  ...callbackEventBaseShape,
  baiyingCallJobId: z.string().min(1).max(64),
  eventType: z.literal('OUTBOUND_TASK_STARTED'),
  executionStatus: z.literal('CALLING'),
  startedAt: z.iso.datetime({ offset: true }),
});

export const taskStartFailedEventSchema = z.object({
  ...callbackEventBaseShape,
  eventType: z.literal('OUTBOUND_TASK_START_FAILED'),
  executionStatus: z.enum(['CREATE_FAILED', 'IMPORT_FAILED', 'START_FAILED']),
  failure: taskFailureSchema,
});

export const outboundCallResultSchema = z.object({
  externalCustomerId: z.string().min(1).max(128),
  platformCallId: z.uuid(),
  baiyingCallInstanceId: z.string().min(1).max(64),
  phoneMasked: z.string().min(1).max(32),
  callStatus: z.enum([
    'ANSWERED',
    'NO_ANSWER',
    'BUSY',
    'REJECTED',
    'FAILED',
    'UNKNOWN',
  ]),
  finishStatus: z.number().int().nullable(),
  durationSeconds: z.number().int().nonnegative(),
  billingMinutes: z.number().int().nonnegative(),
  customerCharge: nonNegativeAmountSchema,
  collectProperties: z.record(z.string(), z.unknown()),
});

export const callResultBatchEventSchema = z.object({
  ...callbackEventBaseShape,
  baiyingCallJobId: z.string().min(1).max(64),
  eventType: z.literal('OUTBOUND_CALL_RESULT_BATCH'),
  batchNo: z.number().int().positive(),
  isLastBatch: z.boolean(),
  calls: z.array(outboundCallResultSchema).min(1).max(200),
});

export const recordingAvailableBatchLegacyEventSchema = z.object({
  ...callbackEventBaseShape,
  baiyingCallJobId: z.string().min(1).max(64),
  eventType: z.literal('OUTBOUND_RECORDING_AVAILABLE_BATCH'),
  batchNo: z.number().int().positive(),
  isLastBatch: z.boolean(),
  recordings: z.array(recordingDeliveryItemSchema).min(1).max(100),
});

export const recordingAvailableBatchEventV21Schema = z.object({
  ...callbackEventBaseShape,
  schemaVersion: z.literal('2.1'),
  baiyingCallJobId: z.string().min(1).max(64),
  eventType: z.literal('OUTBOUND_RECORDING_AVAILABLE_BATCH'),
  batchNo: z.number().int().positive(),
  isLastBatch: z.boolean(),
  recordings: z.array(recordingDeliveryItemV21Schema).min(1).max(100),
});

export const recordingAvailableBatchEventSchema = z.discriminatedUnion(
  'schemaVersion',
  [
    recordingAvailableBatchLegacyEventSchema,
    recordingAvailableBatchEventV21Schema,
  ],
);

export const outboundExternalCallbackEnvelopeV2Schema = z.union([
  outboundCallResultCallbackEnvelopeV2Schema,
  outboundRecordingCallbackEnvelopeV2Schema,
]);

export function toOutboundRecordingCallbackEnvelopeV2(
  event: RecordingAvailableBatchEventV21,
) {
  return outboundRecordingCallbackEnvelopeV2Schema.parse({
    Token: outboundCallbackToken,
    Data: {
      event_id: event.eventId,
      event_type: 'OUTBOUND_RECORDING_AVAILABLE_BATCH',
      occurred_at: event.occurredAt,
      company_code: event.mcCode,
      task_no: event.taskNo,
      recordings: event.recordings.map((recording) => ({
        guid: recording.guid,
        phone_masked: recording.phoneMasked,
        recording_id: recording.recordingId,
        recording_url: recording.downloadUrl,
        expires_at: recording.expiresAt,
      })),
    },
  });
}

export const taskCompletedEventSchema = z.object({
  ...callbackEventBaseShape,
  baiyingCallJobId: z.string().min(1).max(64),
  eventType: z.literal('OUTBOUND_TASK_COMPLETED'),
  executionStatus: z.literal('COMPLETED'),
  summary: z.object({
    phoneCount: z.number().int().nonnegative(),
    importedCount: z.number().int().nonnegative(),
    callInstanceCount: z.number().int().nonnegative(),
    answeredCount: z.number().int().nonnegative(),
    totalDurationSeconds: z.number().int().nonnegative(),
    billingMinutes: z.number().int().nonnegative(),
    customerCharge: nonNegativeAmountSchema,
    recordingDiscoveredCount: z.number().int().nonnegative(),
    recordingArchivedCount: z.number().int().nonnegative(),
  }),
  completedAt: z.iso.datetime({ offset: true }),
});

export const outboundResultEventSchema = z.discriminatedUnion('eventType', [
  taskStartedEventSchema,
  taskStartFailedEventSchema,
  callResultBatchEventSchema,
  taskCompletedEventSchema,
]);

export const outboundCallbackEventSchema = z.union([
  outboundResultEventSchema,
  recordingAvailableBatchEventSchema,
  outboundCallResultInternalEventV2Schema,
]);

export const callbackAckSchema = z.object({
  code: z.literal(200),
  message: z.literal('success'),
});

export type TaskStartedEvent = z.infer<typeof taskStartedEventSchema>;
export type TaskStartFailedEvent = z.infer<typeof taskStartFailedEventSchema>;
export type OutboundCallResult = z.infer<typeof outboundCallResultSchema>;
export type CallResultBatchEvent = z.infer<typeof callResultBatchEventSchema>;
export type RecordingAvailableBatchEvent = z.infer<
  typeof recordingAvailableBatchEventSchema
>;
export type RecordingAvailableBatchEventV21 = z.infer<
  typeof recordingAvailableBatchEventV21Schema
>;
export type TaskCompletedEvent = z.infer<typeof taskCompletedEventSchema>;
export type OutboundResultEvent = z.infer<typeof outboundResultEventSchema>;
export type OutboundCallbackEvent = z.infer<typeof outboundCallbackEventSchema>;
export type CallbackAck = z.infer<typeof callbackAckSchema>;

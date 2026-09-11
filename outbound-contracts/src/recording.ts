import { z } from 'zod';
import { outboundCallbackToken } from './envelope.js';

export const recordingKindSchema = z.enum(['FULL', 'USER_ONLY']);
export const recordingArchiveStatusSchema = z.enum([
  'PENDING',
  'DOWNLOADING',
  'ARCHIVED',
  'PARTIAL',
  'FAILED',
  'NOT_AVAILABLE',
]);
export const recordingDeliveryStatusSchema = z.enum([
  'PENDING',
  'DELIVERING',
  'SUCCEEDED',
  'FAILED',
  'NOT_APPLICABLE',
]);

export const recordingDeliveryItemSchema = z.object({
  recordingId: z.uuid(),
  platformCallId: z.uuid(),
  baiyingCallInstanceId: z.string().min(1).max(64),
  kind: recordingKindSchema,
  contentType: z.string().min(1).max(128),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  downloadUrl: z.url().startsWith('https://'),
  expiresAt: z.iso.datetime({ offset: true }),
});

export const recordingDeliveryItemV21Schema =
  recordingDeliveryItemSchema.extend({
    guid: z.string().min(1).max(128),
    phoneMasked: z.string().min(1).max(32),
  });

export const outboundRecordingItemV2Schema = z
  .object({
    guid: z.string().min(1).max(128),
    phone_masked: z.string().min(1).max(32),
    recording_id: z.uuid(),
    recording_url: z.url().startsWith('https://'),
    expires_at: z.iso.datetime({ offset: true }),
  })
  .strict();

export const outboundRecordingCallbackDataV2Schema = z
  .object({
    event_id: z.uuid(),
    event_type: z.literal('OUTBOUND_RECORDING_AVAILABLE_BATCH'),
    occurred_at: z.iso.datetime({ offset: true }),
    company_code: z.string().min(1).max(64),
    task_no: z.string().regex(/^PT-\d{8}-\d{5,}$/),
    recordings: z.array(outboundRecordingItemV2Schema).min(1).max(100),
  })
  .strict();

export const outboundRecordingCallbackEnvelopeV2Schema = z
  .object({
    Token: z.literal(outboundCallbackToken),
    Data: outboundRecordingCallbackDataV2Schema,
  })
  .strict();

export const recordingDownloadUrlSchema = recordingDeliveryItemSchema.pick({
  recordingId: true,
  downloadUrl: true,
  expiresAt: true,
  sha256: true,
});

export const recordingDownloadUrlEnvelopeSchema = z.object({
  code: z.literal('OK'),
  message: z.literal('success'),
  requestId: z.string().min(1).max(128),
  data: recordingDownloadUrlSchema,
});

export type RecordingKind = z.infer<typeof recordingKindSchema>;
export type RecordingArchiveStatus = z.infer<
  typeof recordingArchiveStatusSchema
>;
export type RecordingDeliveryStatus = z.infer<
  typeof recordingDeliveryStatusSchema
>;
export type RecordingDeliveryItem = z.infer<typeof recordingDeliveryItemSchema>;
export type RecordingDeliveryItemV21 = z.infer<
  typeof recordingDeliveryItemV21Schema
>;
export type OutboundRecordingItemV2 = z.infer<
  typeof outboundRecordingItemV2Schema
>;
export type OutboundRecordingCallbackDataV2 = z.infer<
  typeof outboundRecordingCallbackDataV2Schema
>;
export type OutboundRecordingCallbackEnvelopeV2 = z.infer<
  typeof outboundRecordingCallbackEnvelopeV2Schema
>;
export type RecordingDownloadUrl = z.infer<typeof recordingDownloadUrlSchema>;
export type RecordingDownloadUrlEnvelope = z.infer<
  typeof recordingDownloadUrlEnvelopeSchema
>;

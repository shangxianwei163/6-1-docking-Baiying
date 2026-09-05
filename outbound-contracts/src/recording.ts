import { z } from 'zod';

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

export const recordingDownloadUrlSchema = recordingDeliveryItemSchema.pick({
  recordingId: true,
  downloadUrl: true,
  expiresAt: true,
  sha256: true,
});

export type RecordingKind = z.infer<typeof recordingKindSchema>;
export type RecordingArchiveStatus = z.infer<
  typeof recordingArchiveStatusSchema
>;
export type RecordingDeliveryStatus = z.infer<
  typeof recordingDeliveryStatusSchema
>;
export type RecordingDeliveryItem = z.infer<typeof recordingDeliveryItemSchema>;
export type RecordingDownloadUrl = z.infer<typeof recordingDownloadUrlSchema>;

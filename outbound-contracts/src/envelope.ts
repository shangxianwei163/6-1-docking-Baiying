import { z } from 'zod';

export const sourceSystemSchema = z.enum(['ERP', 'CRM']);
export type SourceSystem = z.infer<typeof sourceSystemSchema>;

export const requestMetadataSchema = z.object({
  eventId: z.uuid(),
  requestId: z.string().min(1).max(128),
  idempotencyKey: z.string().min(1).max(128),
  occurredAt: z.iso.datetime({ offset: true }),
  schemaVersion: z.literal('1.0'),
});
export type RequestMetadata = z.infer<typeof requestMetadataSchema>;

export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  requestId: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

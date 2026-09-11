import { z } from 'zod';

export const outboundCallbackToken = '^******^' as const;

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

export const externalApiErrorCodeSchema = z.enum([
  'INVALID_REQUEST',
  'AUTHENTICATION_FAILED',
  'REPLAY_DETECTED',
  'IDEMPOTENCY_CONFLICT',
  'STUDIO_NOT_FOUND',
  'STUDIO_DISABLED',
  'CALLBACK_CONFIG_MISSING',
  'PRICING_NOT_CONFIGURED',
  'INSUFFICIENT_BALANCE',
  'PHONE_INVALID',
  'PHONE_DUPLICATED',
  'GUID_DUPLICATED',
  'DATA_CATEGORY_NOT_FOUND',
  'DATA_CATEGORY_AMBIGUOUS',
  'DATA_CATEGORY_SCRIPT_UNBOUND',
  'DATA_CATEGORY_SCRIPT_CONFLICT',
  'DATA_CATEGORY_LINE_CONFLICT',
  'LINE_NOT_AVAILABLE',
  'MAPPING_NOT_READY',
  'MAPPING_VALUE_INVALID',
  'TASK_NOT_FOUND',
  'INTEGRATION_LOG_NOT_FOUND',
  'COMMAND_NOT_ALLOWED',
  'RECORDING_NOT_FOUND',
  'RECORDING_NOT_ARCHIVED',
  'RECORDING_EXPIRED',
  'RECORDING_OBJECT_UNAVAILABLE',
  'SERVICE_TEMPORARILY_UNAVAILABLE',
]);

export const externalApiErrorSchema = z.object({
  code: externalApiErrorCodeSchema,
  message: z.string().min(1).max(1000),
  requestId: z.string().min(1).max(128),
  recharge_qr_code_url: z.url().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export type ExternalApiErrorCode = z.infer<typeof externalApiErrorCodeSchema>;
export type ExternalApiError = z.infer<typeof externalApiErrorSchema>;

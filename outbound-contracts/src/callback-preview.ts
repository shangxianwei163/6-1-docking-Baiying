import { z } from 'zod';
import { sourceSystemSchema } from './envelope.js';

export const callbackPreviewEnvironmentSchema = z.literal('SAFE_PREVIEW');

export const callbackPreviewEventTypeSchema = z.enum([
  'OUTBOUND_CALL_RESULT_BATCH',
  'OUTBOUND_TASK_COMPLETED',
  'OUTBOUND_RECORDING_AVAILABLE_BATCH',
]);

export const callbackPreviewInputSchema = z
  .object({
    environment: callbackPreviewEnvironmentSchema,
    sourceSystem: sourceSystemSchema,
    eventType: callbackPreviewEventTypeSchema,
    itemCount: z.number().int().min(1).max(3).default(1),
  })
  .strict();

export const callbackPreviewSchema = z.object({
  mode: callbackPreviewEnvironmentSchema,
  generatedAt: z.iso.datetime({ offset: true }),
  receiver: sourceSystemSchema,
  eventType: callbackPreviewEventTypeSchema,
  safety: z.object({
    syntheticDataOnly: z.literal(true),
    productionDataRead: z.literal(false),
    deliveryAttempted: z.literal(false),
    networkAccess: z.literal('DISABLED'),
    destination: z.null(),
    signatureMode: z.literal('PLACEHOLDER_ONLY'),
  }),
  request: z.object({
    method: z.literal('POST'),
    callbackPath: z.literal('/callbacks/outbound-preview'),
    headers: z.record(z.string(), z.string()),
    body: z.string().min(2).max(50_000),
    bodySha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
});

export type CallbackPreviewEnvironment = z.infer<
  typeof callbackPreviewEnvironmentSchema
>;
export type CallbackPreviewEventType = z.infer<
  typeof callbackPreviewEventTypeSchema
>;
export type CallbackPreviewInput = z.infer<typeof callbackPreviewInputSchema>;
export type CallbackPreview = z.infer<typeof callbackPreviewSchema>;

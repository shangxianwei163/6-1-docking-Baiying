import { z } from 'zod';

export const recordingArchivedForDeliverySchema = z.object({
  schemaVersion: z.literal('1.0'),
  eventId: z.uuid(),
  eventType: z.literal('RECORDING_ARCHIVED_FOR_DELIVERY'),
  occurredAt: z.iso.datetime({ offset: true }),
  taskId: z.uuid(),
  recordingId: z.uuid(),
  batchNo: z.number().int().positive(),
  isLastBatch: z.boolean(),
});

export type RecordingArchivedForDelivery = z.infer<
  typeof recordingArchivedForDeliverySchema
>;

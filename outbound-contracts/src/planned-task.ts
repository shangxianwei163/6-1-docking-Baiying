import { z } from 'zod';
import { sourceSystemSchema } from './envelope.js';

export const baiyingWorkflowStatusSchema = z.enum(['ALL', 'DRAFT', 'UNSTART', 'START', 'FINISH', 'PAUSE']);
export type BaiyingWorkflowStatus = z.infer<typeof baiyingWorkflowStatusSchema>;

export const plannedTaskBindingInputSchema = z.object({
  workflowId: z.string().min(1).max(128),
  sourceSystem: sourceSystemSchema,
  sourceCategoryId: z.string().min(1).max(256),
  categoryPath: z.string().min(1).max(500),
});
export type PlannedTaskBindingInput = z.infer<typeof plannedTaskBindingInputSchema>;

export const sourceCategoryObservationSchema = z.object({
  sourceSystem: sourceSystemSchema,
  externalId: z.string().min(1).max(256),
  categoryPath: z.string().min(1).max(500),
  active: z.boolean().default(true),
});
export type SourceCategoryObservation = z.infer<typeof sourceCategoryObservationSchema>;

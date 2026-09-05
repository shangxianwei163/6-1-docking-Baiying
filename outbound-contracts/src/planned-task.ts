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
  name: z.string().min(1).max(500).optional(),
  categoryPath: z.string().min(1).max(500),
  level: z.number().int().min(1).nullable().optional(),
  parentId: z.string().max(256).nullable().optional(),
  active: z.boolean().default(true),
  fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
});
export type SourceCategoryObservation = z.infer<typeof sourceCategoryObservationSchema>;

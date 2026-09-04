import { z } from 'zod';
import { sourceSystemSchema } from './envelope.js';

export const scriptBindingInputSchema = z.object({
  robotDefId: z.string().min(1).max(128),
  sourceSystem: sourceSystemSchema,
  sourceCategoryId: z.string().min(1).max(256),
  categoryPath: z.string().min(1).max(500),
  studioId: z.string().min(1).max(128),
  studioName: z.string().min(1).max(200),
  lineId: z.string().min(1).max(128),
  lineName: z.string().min(1).max(200),
});

export type ScriptBindingInput = z.infer<typeof scriptBindingInputSchema>;

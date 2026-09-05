import { z } from 'zod';
import { sourceSystemSchema } from './envelope.js';

export const scriptCategoryBindingSchema = z.object({
  sourceCategoryId: z.string().min(1).max(256),
  categoryPath: z.string().min(1).max(500),
});

export const scriptBindingInputSchema = z.object({
  robotDefId: z.string().min(1).max(128),
  sourceSystem: sourceSystemSchema,
  categories: z.array(scriptCategoryBindingSchema).min(1).max(100),
  studioId: z.string().min(1).max(128),
  studioName: z.string().min(1).max(200),
  lineId: z.string().min(1).max(128),
  lineName: z.string().min(1).max(200),
});

export type ScriptCategoryBinding = z.infer<typeof scriptCategoryBindingSchema>;
export type ScriptBindingInput = z.infer<typeof scriptBindingInputSchema>;

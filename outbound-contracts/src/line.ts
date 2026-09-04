import { z } from 'zod';

export const lineStudioBindingInputSchema = z.object({
  userPhoneId: z.string().min(1).max(128),
  studios: z.array(z.object({
    studioId: z.string().min(1).max(128),
    studioName: z.string().min(1).max(200),
  })).max(100),
});

export type LineStudioBindingInput = z.infer<typeof lineStudioBindingInputSchema>;

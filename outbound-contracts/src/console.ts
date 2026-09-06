import { z } from 'zod';
import { outboundCallPageSchema, taskDetailSchema } from './outbound-task.js';

export const consoleTaskStatusFilterSchema = z.enum([
  'ALL',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'TERMINATED',
]);

export const consoleTaskRecordSchema = taskDetailSchema.extend({
  mapping: taskDetailSchema.shape.mapping.extend({
    variables: z.array(z.string().min(1).max(128)),
  }),
  callbacks: z.object({
    resultUrl: z.url(),
    recordingUrl: z.url(),
  }),
});

export const consoleTaskStatusCountsSchema = z.object({
  all: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  terminated: z.number().int().nonnegative(),
});

export const consoleTaskPageSchema = z.object({
  total: z.number().int().nonnegative(),
  pages: z.number().int().nonnegative(),
  pageNum: z.number().int().nonnegative(),
  pageSize: z.number().int().positive().max(100),
  statusCounts: consoleTaskStatusCountsSchema,
  tasks: z.array(consoleTaskRecordSchema),
});

export const consoleTaskRecordEnvelopeSchema = z.object({
  requestId: z.string().min(1).max(128),
  data: z.object({ task: consoleTaskRecordSchema }),
});

export const consoleTaskPageEnvelopeSchema = z.object({
  requestId: z.string().min(1).max(128),
  data: consoleTaskPageSchema,
});

export const consoleCallPageEnvelopeSchema = z.object({
  requestId: z.string().min(1).max(128),
  data: outboundCallPageSchema,
});

export type ConsoleTaskStatusFilter = z.infer<
  typeof consoleTaskStatusFilterSchema
>;
export type ConsoleTaskRecord = z.infer<typeof consoleTaskRecordSchema>;
export type ConsoleTaskStatusCounts = z.infer<
  typeof consoleTaskStatusCountsSchema
>;
export type ConsoleTaskPage = z.infer<typeof consoleTaskPageSchema>;

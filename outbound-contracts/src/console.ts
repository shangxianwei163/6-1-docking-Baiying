import { z } from 'zod';
import { outboundCallPageSchema, taskDetailSchema } from './outbound-task.js';

export const consoleTaskStatusFilterSchema = z.enum([
  'ALL',
  'RUNNING',
  'CALLING',
  'COMPLETED',
  'FAILED',
]);

export const consoleTaskCommandSchema = z.enum([
  'PAUSE',
  'RESUME',
  'TERMINATE',
]);

export const consoleTaskActionsSchema = z.object({
  commands: z.array(consoleTaskCommandSchema),
  retry: z.object({
    available: z.boolean(),
    blockedReason: z.string().max(500).nullable(),
  }),
});

export const consoleTaskRecordSchema = taskDetailSchema.extend({
  mapping: taskDetailSchema.shape.mapping.extend({
    variables: z.array(z.string().min(1).max(128)),
  }),
  callbacks: z.object({
    resultUrl: z.url(),
    recordingUrl: z.url(),
  }),
  actions: consoleTaskActionsSchema,
});

export const operatorTaskCommandInputSchema = z
  .object({
    command: consoleTaskCommandSchema,
    reason: z.string().trim().min(2).max(500),
    idempotencyKey: z.uuid(),
  })
  .strict();

export const operatorTaskRetryInputSchema = z
  .object({
    reason: z.string().trim().min(2).max(500),
    idempotencyKey: z.uuid(),
  })
  .strict();

export const operatorTaskActionResultSchema = z.object({
  actionId: z.uuid(),
  taskNo: z.string().regex(/^PT-\d{8}-\d{5,}$/),
  action: z.union([consoleTaskCommandSchema, z.literal('RETRY')]),
  status: z.enum(['QUEUED', 'SUCCEEDED', 'FAILED', 'UNKNOWN']),
  executionStatus: taskDetailSchema.shape.statuses.shape.execution,
  providerMode: z.enum(['LOCAL_SIMULATION', 'BAIYING']),
  idempotentReplay: z.boolean(),
  requestedAt: z.iso.datetime({ offset: true }),
  message: z.string().min(1).max(500),
});

export const consoleTaskStatusCountsSchema = z.object({
  all: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
  calling: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
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
export type ConsoleTaskCommand = z.infer<typeof consoleTaskCommandSchema>;
export type ConsoleTaskActions = z.infer<typeof consoleTaskActionsSchema>;
export type OperatorTaskCommandInput = z.infer<
  typeof operatorTaskCommandInputSchema
>;
export type OperatorTaskRetryInput = z.infer<
  typeof operatorTaskRetryInputSchema
>;
export type OperatorTaskActionResult = z.infer<
  typeof operatorTaskActionResultSchema
>;
export type ConsoleTaskStatusCounts = z.infer<
  typeof consoleTaskStatusCountsSchema
>;
export type ConsoleTaskPage = z.infer<typeof consoleTaskPageSchema>;

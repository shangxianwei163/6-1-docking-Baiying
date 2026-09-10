import { z } from 'zod';

export const taskReconciliationStatusSchema = z.enum([
  'PENDING',
  'RUNNING',
  'STABLE_ONCE',
  'RECONCILED',
  'MANUAL_REVIEW',
  'FAILED',
]);

export const taskReconciliationSchema = z.object({
  taskId: z.uuid(),
  taskNo: z.string().min(1),
  taskName: z.string().min(1),
  status: taskReconciliationStatusSchema,
  providerState: z.string().nullable(),
  expectedCallCount: z.number().int().nonnegative(),
  providerCallCount: z.number().int().nonnegative().nullable(),
  platformCallCount: z.number().int().nonnegative(),
  pendingInboxCount: z.number().int().nonnegative(),
  stableRounds: z.number().int().nonnegative(),
  mismatchSince: z.iso.datetime({ offset: true }).nullable(),
  lastCheckedAt: z.iso.datetime({ offset: true }).nullable(),
  nextCheckAt: z.iso.datetime({ offset: true }).nullable(),
  lastSuccessfulAt: z.iso.datetime({ offset: true }).nullable(),
  lastProviderRequestId: z.string().nullable(),
  failureAttempts: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
  manualReviewAt: z.iso.datetime({ offset: true }).nullable(),
  repairCount: z.number().int().nonnegative(),
  lastRepairRequestedAt: z.iso.datetime({ offset: true }).nullable(),
  updatedAt: z.iso.datetime({ offset: true }),
});

export const taskReconciliationPageSchema = z.object({
  total: z.number().int().nonnegative(),
  pages: z.number().int().nonnegative(),
  pageNum: z.number().int().nonnegative(),
  pageSize: z.number().int().positive(),
  items: z.array(taskReconciliationSchema),
});

export const repairTaskReconciliationInputSchema = z.object({
  reason: z.string().trim().min(8).max(500),
  idempotencyKey: z.uuid(),
});

export const repairTaskReconciliationResultSchema = z.object({
  reconciliation: taskReconciliationSchema,
  idempotentReplay: z.boolean(),
  replayedInboxCount: z.number().int().nonnegative(),
  message: z.string().min(1),
});

export type TaskReconciliationStatus = z.infer<
  typeof taskReconciliationStatusSchema
>;
export type TaskReconciliation = z.infer<typeof taskReconciliationSchema>;
export type TaskReconciliationPage = z.infer<
  typeof taskReconciliationPageSchema
>;
export type RepairTaskReconciliationInput = z.infer<
  typeof repairTaskReconciliationInputSchema
>;
export type RepairTaskReconciliationResult = z.infer<
  typeof repairTaskReconciliationResultSchema
>;

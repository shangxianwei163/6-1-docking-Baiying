import type { BatchDetailV2, TaskExecutionStatus } from '@outbound/contracts';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  idempotencyRecords,
  intakeBatches,
  integrationClients,
  platformTasks,
} from '../db/schema.js';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

const failedTaskStatuses = new Set<TaskExecutionStatus>([
  'CREATE_FAILED',
  'IMPORT_FAILED',
  'START_FAILED',
]);
const startedTaskStatuses = new Set<TaskExecutionStatus>([
  'CALLING',
  'PAUSED',
  'CALL_COMPLETED',
  'RECONCILING',
  'COMPLETED',
]);
const terminalTaskStatuses = new Set<TaskExecutionStatus>([
  'COMPLETED',
  'CREATE_FAILED',
  'IMPORT_FAILED',
  'START_FAILED',
  'CANCELLED',
  'TERMINATED',
]);

export type IntakeBatchLifecycleTask = {
  executionStatus: TaskExecutionStatus;
  startedAt?: Date | null;
};

export type IntakeBatchLifecycleDecision = {
  executionStatus: BatchDetailV2['execution_status'];
  allTerminal: boolean;
};

export function deriveIntakeBatchLifecycle(
  tasks: IntakeBatchLifecycleTask[],
): IntakeBatchLifecycleDecision | null {
  if (!tasks.length) return null;

  const statuses = tasks.map(({ executionStatus }) => executionStatus);
  const hasFailure = statuses.some((status) => failedTaskStatuses.has(status));
  const hasStarted = tasks.some(
    ({ executionStatus, startedAt }) =>
      startedAt != null || startedTaskStatuses.has(executionStatus),
  );
  const allTerminal = statuses.every((status) =>
    terminalTaskStatuses.has(status),
  );
  const allCompleted = statuses.every((status) => status === 'COMPLETED');
  const allCancelled = statuses.every(
    (status) => status === 'CANCELLED' || status === 'TERMINATED',
  );

  const executionStatus = hasFailure
    ? hasStarted
      ? ('PARTIAL_FAILED' as const)
      : ('FAILED' as const)
    : allCompleted
      ? ('COMPLETED' as const)
      : allCancelled
        ? ('CANCELLED' as const)
        : allTerminal
          ? ('PARTIAL_FAILED' as const)
          : hasStarted
            ? ('RUNNING' as const)
            : ('PREPARING' as const);

  return { executionStatus, allTerminal };
}

export async function refreshIntakeBatchLifecycle(
  tx: Transaction,
  batchId: string | null,
  now: Date,
) {
  if (!batchId) return null;
  const tasks = await tx
    .select({
      executionStatus: platformTasks.executionStatus,
      startedAt: platformTasks.startedAt,
    })
    .from(platformTasks)
    .where(eq(platformTasks.batchId, batchId));
  const decision = deriveIntakeBatchLifecycle(tasks);
  if (!decision) return null;

  await tx
    .update(intakeBatches)
    .set({
      executionStatus: decision.executionStatus,
      // Failure closes the start barrier immediately. The batch only becomes
      // complete after every child has finished or been compensated.
      completedAt: decision.allTerminal ? now : null,
      updatedAt: now,
    })
    .where(eq(intakeBatches.id, batchId));

  if (decision.allTerminal) {
    const [batch] = await tx
      .select({
        sourceSystem: intakeBatches.sourceSystem,
        idempotencyKey: intakeBatches.idempotencyKey,
        clientId: integrationClients.clientId,
      })
      .from(intakeBatches)
      .innerJoin(
        integrationClients,
        eq(intakeBatches.integrationClientId, integrationClients.id),
      )
      .where(eq(intakeBatches.id, batchId))
      .limit(1);
    if (batch) {
      await tx
        .update(idempotencyRecords)
        .set({ expiresAt: addDays(now, 180), updatedAt: now })
        .where(
          and(
            eq(idempotencyRecords.sourceSystem, batch.sourceSystem),
            eq(idempotencyRecords.clientId, batch.clientId),
            eq(idempotencyRecords.idempotencyKey, batch.idempotencyKey),
          ),
        );
    }
  }
  return decision.executionStatus;
}

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1_000);
}

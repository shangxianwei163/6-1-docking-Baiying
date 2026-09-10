import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { OutboundCallbackEvent } from '@outbound/contracts';
import type { Database } from '../db/client.js';
import {
  deadLetterEvents,
  deliveryAttempts,
  deliveryEvents,
  platformTasks,
} from '../db/schema.js';
import {
  DeliveryClaimLostError,
  DeliveryMaterializationError,
  type ClaimedDeliveryEvent,
  type DeliveryFailureResult,
  type DeliveryRepository,
  type MaterializedDeliveryEvent,
} from './repository.js';
import {
  CallbackTargetValidationError,
  parseCallbackTargetUrl,
} from './callback-url.js';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

type DeliveryTask = {
  id: string;
  sourceSystem: string;
  endpointVersionId: string;
  endpointSnapshot: {
    resultUrl: string;
    recordingUrl: string;
    signingSecretRef: string;
  };
};

type ClaimedRow = Omit<ClaimedDeliveryEvent, 'sourceSystem' | 'createdAt'> & {
  sourceSystem: string;
  createdAt: Date;
};

type LockedDelivery = {
  id: string;
  eventId: string;
  eventKey: string;
  taskId: string;
  target: 'RESULT' | 'RECORDING';
  eventType: string;
  payload: Record<string, unknown>;
  attemptCount: number;
  retryCycleAttemptCount: number;
};

export class PostgresDeliveryRepository implements DeliveryRepository {
  constructor(
    private readonly db: Database,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async materialize(
    event: OutboundCallbackEvent,
  ): Promise<MaterializedDeliveryEvent> {
    return this.db.transaction(async (tx) => {
      const [task] = await tx
        .select({
          id: platformTasks.id,
          sourceSystem: platformTasks.sourceSystem,
          endpointVersionId: platformTasks.endpointVersionId,
          endpointSnapshot: platformTasks.endpointSnapshot,
        })
        .from(platformTasks)
        .where(eq(platformTasks.taskNo, event.taskNo))
        .limit(1);
      if (!task || task.sourceSystem !== event.sourceSystem) {
        throw new DeliveryMaterializationError(
          `投递事件 ${event.eventId} 找不到匹配的来源任务`,
        );
      }
      const typedTask = task as DeliveryTask;
      const target =
        event.eventType === 'OUTBOUND_RECORDING_AVAILABLE_BATCH'
          ? 'RECORDING'
          : 'RESULT';
      const targetUrl =
        target === 'RESULT'
          ? typedTask.endpointSnapshot.resultUrl
          : typedTask.endpointSnapshot.recordingUrl;
      validateCallbackUrl(targetUrl);
      if (!typedTask.endpointSnapshot.signingSecretRef) {
        throw new DeliveryMaterializationError(
          `投递事件 ${event.eventId} 的任务快照缺少回调签名密钥引用`,
        );
      }
      const eventKey = buildEventKey(typedTask.id, event);
      const [inserted] = await tx
        .insert(deliveryEvents)
        .values({
          eventId: event.eventId,
          eventKey,
          taskId: typedTask.id,
          endpointVersionId: typedTask.endpointVersionId,
          sourceSystem: event.sourceSystem,
          target,
          eventType: event.eventType,
          targetUrlSnapshot: targetUrl,
          payload: event,
          createdAt: new Date(event.occurredAt),
        })
        .onConflictDoNothing({ target: deliveryEvents.eventId })
        .returning({ id: deliveryEvents.id });

      if (inserted) {
        await tx
          .update(platformTasks)
          .set({
            ...(target === 'RESULT'
              ? { resultDeliveryStatus: 'PENDING' as const }
              : { recordingDeliveryStatus: 'PENDING' as const }),
            updatedAt: this.clock(),
            lockVersion: sql`${platformTasks.lockVersion} + 1`,
          })
          .where(eq(platformTasks.id, typedTask.id));
        return {
          id: inserted.id,
          eventId: event.eventId,
          eventKey,
          created: true,
        };
      }

      const [existing] = await tx
        .select({
          id: deliveryEvents.id,
          eventKey: deliveryEvents.eventKey,
          taskId: deliveryEvents.taskId,
          eventType: deliveryEvents.eventType,
          target: deliveryEvents.target,
          payload: deliveryEvents.payload,
        })
        .from(deliveryEvents)
        .where(eq(deliveryEvents.eventId, event.eventId))
        .limit(1);
      if (
        !existing ||
        existing.eventKey !== eventKey ||
        existing.taskId !== typedTask.id ||
        existing.eventType !== event.eventType ||
        existing.target !== target ||
        stableJson(existing.payload) !== stableJson(event)
      ) {
        throw new DeliveryMaterializationError(
          `投递事件 ${event.eventId} 与已存在记录冲突`,
        );
      }
      return {
        id: existing.id,
        eventId: event.eventId,
        eventKey,
        created: false,
      };
    });
  }

  async claimNext(input: {
    workerId: string;
    lockTimeoutSeconds?: number;
    deliveryEventId?: string;
  }): Promise<ClaimedDeliveryEvent | null> {
    assertWorkerId(input.workerId);
    const lockTimeoutSeconds = input.lockTimeoutSeconds ?? 1_800;
    if (!Number.isInteger(lockTimeoutSeconds) || lockTimeoutSeconds < 1) {
      throw new TypeError('投递锁超时必须是正整数秒');
    }
    return this.db.transaction(async (tx) => {
      const rows = await tx.execute<ClaimedRow>(sql`
        WITH candidate AS (
          SELECT
            event.id,
            task.endpoint_snapshot_json->>'signingSecretRef' AS signing_secret_ref
          FROM delivery_event AS event
          INNER JOIN platform_task AS task ON task.id = event.task_id
          WHERE (${input.deliveryEventId ?? null}::uuid IS NULL OR event.id = ${input.deliveryEventId ?? null}::uuid)
            AND (
              (
                event.status IN ('PENDING', 'FAILED')
                AND event.available_at <= now()
              )
              OR (
                event.status = 'DELIVERING'
                AND (
                  event.locked_at IS NULL
                  OR event.locked_at < now() - (${lockTimeoutSeconds} * interval '1 second')
                )
              )
            )
          ORDER BY event.available_at, event.created_at, event.id
          FOR UPDATE OF event SKIP LOCKED
          LIMIT 1
        )
        UPDATE delivery_event AS event
        SET
          status = 'DELIVERING',
          attempt_count = event.attempt_count + 1,
          retry_cycle_attempt_count = event.retry_cycle_attempt_count + 1,
          locked_at = now(),
          locked_by = ${input.workerId},
          last_error = NULL
        FROM candidate
        WHERE event.id = candidate.id
        RETURNING
          event.id,
          event.event_id AS "eventId",
          event.event_key AS "eventKey",
          event.task_id AS "taskId",
          event.source_system AS "sourceSystem",
          event.target,
          event.event_type AS "eventType",
          event.target_url_snapshot AS "targetUrl",
          event.payload_json AS payload,
          candidate.signing_secret_ref AS "signingSecretRef",
          event.attempt_count AS "attemptCount",
          event.retry_cycle_attempt_count AS "retryCycleAttemptCount",
          event.created_at AS "createdAt"
      `);
      const row = rows[0];
      if (!row) return null;
      if (!isSourceSystem(row.sourceSystem) || !row.signingSecretRef) {
        throw new DeliveryMaterializationError(
          `投递事件 ${row.eventId} 的任务快照无有效来源或密钥引用`,
        );
      }
      await tx
        .update(platformTasks)
        .set({
          ...(row.target === 'RESULT'
            ? { resultDeliveryStatus: 'DELIVERING' as const }
            : { recordingDeliveryStatus: 'DELIVERING' as const }),
          updatedAt: this.clock(),
          lockVersion: sql`${platformTasks.lockVersion} + 1`,
        })
        .where(eq(platformTasks.id, row.taskId));
      return {
        ...row,
        sourceSystem: row.sourceSystem,
        createdAt: new Date(row.createdAt).toISOString(),
      };
    });
  }

  async complete(input: {
    deliveryEventId: string;
    workerId: string;
    responseStatus: number;
    responseSummary: string | null;
    requestedAt: Date;
    durationMs: number;
  }): Promise<void> {
    assertWorkerId(input.workerId);
    await this.db.transaction(async (tx) => {
      const event = await lockClaimedDelivery(
        tx,
        input.deliveryEventId,
        input.workerId,
      );
      const now = this.clock();
      await tx.insert(deliveryAttempts).values({
        deliveryEventId: event.id,
        attemptNo: event.attemptCount,
        status: 'SUCCEEDED',
        requestedAt: input.requestedAt,
        responseStatus: input.responseStatus,
        responseSummary: truncateNullable(input.responseSummary, 2_000),
        durationMs: safeDuration(input.durationMs),
      });
      const changed = await tx
        .update(deliveryEvents)
        .set({
          status: 'SUCCEEDED',
          lockedAt: null,
          lockedBy: null,
          lastError: null,
          deliveredAt: now,
        })
        .where(
          and(
            eq(deliveryEvents.id, event.id),
            eq(deliveryEvents.lockedBy, input.workerId),
          ),
        )
        .returning({ id: deliveryEvents.id });
      if (!changed.length) throw claimLost(event.id);
      await resolveReplayedDeadLetter(tx, event.id, input.workerId, now);
      await refreshTaskDeliverySummary(tx, event.taskId, event.target, now);
    });
  }

  async fail(input: {
    deliveryEventId: string;
    workerId: string;
    retryable: boolean;
    responseStatus: number | null;
    responseSummary: string | null;
    errorClass: string;
    errorMessage: string;
    requestedAt: Date;
    durationMs: number;
    retryDelayMs: number;
    maxAttempts: number;
  }): Promise<DeliveryFailureResult> {
    assertWorkerId(input.workerId);
    if (!Number.isFinite(input.retryDelayMs) || input.retryDelayMs < 0) {
      throw new TypeError('投递重试延迟不能为负数');
    }
    if (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1) {
      throw new TypeError('投递最大尝试次数必须是正整数');
    }
    return this.db.transaction(async (tx) => {
      const event = await lockClaimedDelivery(
        tx,
        input.deliveryEventId,
        input.workerId,
      );
      const now = this.clock();
      const errorMessage = truncate(input.errorMessage, 4_000);
      await tx.insert(deliveryAttempts).values({
        deliveryEventId: event.id,
        attemptNo: event.attemptCount,
        status: input.retryable ? 'RETRYABLE_FAILURE' : 'PERMANENT_FAILURE',
        requestedAt: input.requestedAt,
        responseStatus: input.responseStatus,
        responseSummary: truncateNullable(input.responseSummary, 2_000),
        errorClass: truncate(input.errorClass, 128),
        errorMessage,
        durationMs: safeDuration(input.durationMs),
      });

      const deadLettered =
        !input.retryable || event.retryCycleAttemptCount >= input.maxAttempts;
      if (deadLettered) {
        await tx
          .update(deliveryEvents)
          .set({
            status: 'DEAD_LETTERED',
            lockedAt: null,
            lockedBy: null,
            lastError: errorMessage,
          })
          .where(eq(deliveryEvents.id, event.id));
        await tx
          .insert(deadLetterEvents)
          .values({
            sourceType: 'DELIVERY',
            sourceId: event.id,
            originalEvent: {
              eventId: event.eventId,
              eventKey: event.eventKey,
              eventType: event.eventType,
              target: event.target,
              attempts: event.attemptCount,
            },
            finalError: errorMessage,
            suggestedAction:
              '确认 ERP/CRM 接收端状态、签名密钥与事件幂等处理后，从异常中心原位重放',
          })
          .onConflictDoUpdate({
            target: [deadLetterEvents.sourceType, deadLetterEvents.sourceId],
            set: {
              originalEvent: {
                eventId: event.eventId,
                eventKey: event.eventKey,
                eventType: event.eventType,
                target: event.target,
                attempts: event.attemptCount,
              },
              finalError: errorMessage,
              suggestedAction:
                '确认 ERP/CRM 接收端状态、签名密钥与事件幂等处理后，从异常中心原位重放',
              status: 'OPEN',
              resolvedBy: null,
              resolvedAt: null,
              resolutionNote: null,
            },
          });
        await refreshTaskDeliverySummary(tx, event.taskId, event.target, now);
        return {
          status: 'DEAD_LETTERED',
          attempts: event.attemptCount,
          availableAt: null,
        };
      }

      const availableAt = new Date(now.getTime() + input.retryDelayMs);
      await tx
        .update(deliveryEvents)
        .set({
          status: 'FAILED',
          availableAt,
          lockedAt: null,
          lockedBy: null,
          lastError: errorMessage,
        })
        .where(eq(deliveryEvents.id, event.id));
      await refreshTaskDeliverySummary(tx, event.taskId, event.target, now);
      return {
        status: 'RETRY_SCHEDULED',
        attempts: event.attemptCount,
        availableAt: availableAt.toISOString(),
      };
    });
  }
}

async function lockClaimedDelivery(
  tx: Transaction,
  deliveryEventId: string,
  workerId: string,
): Promise<LockedDelivery> {
  const rows = await tx.execute<LockedDelivery>(sql`
    SELECT
      id,
      event_id AS "eventId",
      event_key AS "eventKey",
      task_id AS "taskId",
      target,
      event_type AS "eventType",
      payload_json AS payload,
      attempt_count AS "attemptCount",
      retry_cycle_attempt_count AS "retryCycleAttemptCount"
    FROM delivery_event
    WHERE id = ${deliveryEventId}
      AND status = 'DELIVERING'
      AND locked_by = ${workerId}
    FOR UPDATE
  `);
  const event = rows[0];
  if (!event) throw claimLost(deliveryEventId);
  return event;
}

async function resolveReplayedDeadLetter(
  tx: Transaction,
  deliveryEventId: string,
  workerId: string,
  now: Date,
) {
  await tx
    .update(deadLetterEvents)
    .set({
      status: 'RESOLVED',
      resolvedBy: workerId,
      resolvedAt: now,
      resolutionNote: '人工重放后外部事件投递成功',
    })
    .where(
      and(
        eq(deadLetterEvents.sourceType, 'DELIVERY'),
        eq(deadLetterEvents.sourceId, deliveryEventId),
        eq(deadLetterEvents.status, 'REPLAYING'),
      ),
    );
}

export async function refreshTaskDeliverySummary(
  tx: Transaction,
  taskId: string,
  target: 'RESULT' | 'RECORDING',
  now: Date,
) {
  const [counts] = await tx.execute<{
    total: number;
    pending: number;
    delivering: number;
    succeeded: number;
    deadLettered: number;
    executionStatus: string;
    completionSucceeded: number;
    failureSucceeded: number;
    contractVersion: string;
    phoneCount: number;
  }>(sql`
    SELECT
      count(event.id)::int AS total,
      count(event.id) FILTER (WHERE event.status IN ('PENDING', 'FAILED'))::int AS pending,
      count(event.id) FILTER (WHERE event.status = 'DELIVERING')::int AS delivering,
      count(event.id) FILTER (WHERE event.status = 'SUCCEEDED')::int AS succeeded,
      count(event.id) FILTER (WHERE event.status = 'DEAD_LETTERED')::int AS "deadLettered",
      task.execution_status AS "executionStatus",
      task.contract_version AS "contractVersion",
      task.phone_count AS "phoneCount",
      count(event.id) FILTER (
        WHERE event.event_type = 'OUTBOUND_TASK_COMPLETED'
          AND event.status = 'SUCCEEDED'
      )::int AS "completionSucceeded",
      count(event.id) FILTER (
        WHERE event.event_type = 'OUTBOUND_TASK_START_FAILED'
          AND event.status = 'SUCCEEDED'
      )::int AS "failureSucceeded"
    FROM platform_task AS task
    LEFT JOIN delivery_event AS event
      ON event.task_id = task.id
      AND event.target = ${target}::delivery_target
    WHERE task.id = ${taskId}
    GROUP BY task.id
  `);
  const total = Number(counts?.total ?? 0);
  const pending = Number(counts?.pending ?? 0);
  const delivering = Number(counts?.delivering ?? 0);
  const succeeded = Number(counts?.succeeded ?? 0);
  const deadLettered = Number(counts?.deadLettered ?? 0);

  if (target === 'RESULT') {
    const terminalDelivered =
      counts?.contractVersion === '2.0'
        ? [
            'COMPLETED',
            'CREATE_FAILED',
            'IMPORT_FAILED',
            'START_FAILED',
            'CANCELLED',
            'TERMINATED',
          ].includes(counts.executionStatus) &&
          succeeded >= Number(counts.phoneCount)
        : counts?.executionStatus === 'COMPLETED'
          ? Number(counts.completionSucceeded) > 0
          : ['CREATE_FAILED', 'IMPORT_FAILED', 'START_FAILED'].includes(
                counts?.executionStatus ?? '',
              )
            ? Number(counts?.failureSucceeded ?? 0) > 0
            : false;
    const status =
      deadLettered > 0
        ? 'FAILED'
        : delivering > 0
          ? 'DELIVERING'
          : pending > 0 || total === 0
            ? 'PENDING'
            : succeeded === total && terminalDelivered
              ? 'SUCCEEDED'
              : 'PENDING';
    await tx
      .update(platformTasks)
      .set({
        resultDeliveryStatus: status,
        updatedAt: now,
        lockVersion: sql`${platformTasks.lockVersion} + 1`,
      })
      .where(eq(platformTasks.id, taskId));
    return;
  }

  const [recordings] = await tx.execute<{
    discovered: number;
    delivered: number;
  }>(sql`
    SELECT
      task.recording_discovered_count::int AS discovered,
      (
        SELECT count(DISTINCT item->>'recordingId')::int
        FROM delivery_event AS event
        CROSS JOIN LATERAL jsonb_array_elements(event.payload_json->'recordings') AS item
        WHERE event.task_id = task.id
          AND event.target = 'RECORDING'
          AND event.status = 'SUCCEEDED'
      ) AS delivered
    FROM platform_task AS task
    WHERE task.id = ${taskId}
  `);
  const discovered = Number(recordings?.discovered ?? 0);
  const delivered = Number(recordings?.delivered ?? 0);
  const status =
    discovered === 0
      ? 'NOT_APPLICABLE'
      : deadLettered > 0
        ? 'FAILED'
        : delivering > 0
          ? 'DELIVERING'
          : pending > 0 || delivered < discovered
            ? 'PENDING'
            : 'SUCCEEDED';
  await tx
    .update(platformTasks)
    .set({
      recordingDeliveredCount: delivered,
      recordingDeliveryStatus: status,
      updatedAt: now,
      lockVersion: sql`${platformTasks.lockVersion} + 1`,
    })
    .where(eq(platformTasks.id, taskId));
}

function buildEventKey(taskId: string, event: OutboundCallbackEvent): string {
  if (event.eventType === 'OUTBOUND_CALL_RESULT_V2') {
    const guid =
      event.schemaVersion === '2.1'
        ? event.result.customer.guid
        : event.result.guid;
    return `${event.eventType}:${taskId}:${guid}`;
  }
  if (event.eventType === 'OUTBOUND_CALL_RESULT_BATCH') {
    return `${event.eventType}:${taskId}:${identityHash(
      event.calls.map((call) => call.platformCallId),
    )}`;
  }
  if (event.eventType === 'OUTBOUND_RECORDING_AVAILABLE_BATCH') {
    return `${event.eventType}:${taskId}:${identityHash(
      event.recordings.map((recording) => recording.recordingId),
    )}`;
  }
  if (event.eventType === 'OUTBOUND_TASK_COMPLETED') {
    return `${event.eventType}:${taskId}`;
  }
  return `${event.eventType}:${taskId}:${event.eventId}`;
}

function identityHash(values: readonly string[]): string {
  return createHash('sha256')
    .update([...values].sort().join('\n'), 'utf8')
    .digest('hex');
}

export function validateCallbackUrl(rawUrl: string): URL {
  try {
    return parseCallbackTargetUrl(rawUrl);
  } catch (error) {
    throw new DeliveryMaterializationError(
      error instanceof CallbackTargetValidationError
        ? error.message
        : '回调目标不是有效 URL',
    );
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right, 'en'))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(',')}}`;
}

function safeDuration(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(Math.round(value), 2_147_483_647);
}

function assertWorkerId(workerId: string): void {
  if (!workerId || workerId.length > 128) {
    throw new TypeError('投递 workerId 长度必须为 1～128 字符');
  }
}

function isSourceSystem(value: string): value is 'ERP' | 'CRM' {
  return value === 'ERP' || value === 'CRM';
}

function claimLost(deliveryEventId: string): DeliveryClaimLostError {
  return new DeliveryClaimLostError(
    `投递事件 ${deliveryEventId} 的处理锁已丢失`,
  );
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

function truncateNullable(
  value: string | null,
  maxLength: number,
): string | null {
  return value === null ? null : truncate(value, maxLength);
}

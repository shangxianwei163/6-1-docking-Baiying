import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { deadLetterEvents, queueOutbox } from '../db/schema.js';
import {
  OutboxClaimLostError,
  type ClaimedOutboxEvent,
  type OutboxFailureResult,
  type OutboxRepository,
} from './repository.js';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

type ClaimedRow = {
  id: string;
  eventType: string;
  queueName: string;
  payload: Record<string, unknown>;
  attempts: number;
  createdAt: Date;
};

export class PostgresOutboxRepository implements OutboxRepository {
  constructor(
    private readonly db: Database,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async claimNext(input: {
    queueName: string;
    eventType: string;
    workerId: string;
    lockTimeoutSeconds?: number;
  }): Promise<ClaimedOutboxEvent | null> {
    assertWorkerId(input.workerId);
    const lockTimeoutSeconds = input.lockTimeoutSeconds ?? 1_800;
    if (!Number.isInteger(lockTimeoutSeconds) || lockTimeoutSeconds < 1) {
      throw new TypeError('Outbox 锁超时必须是正整数秒');
    }
    const rows = await this.db.execute<ClaimedRow>(sql`
      WITH candidate AS (
        SELECT ${queueOutbox.id}
        FROM ${queueOutbox}
        WHERE ${queueOutbox.queueName} = ${input.queueName}
          AND ${queueOutbox.eventType} = ${input.eventType}
          AND ${queueOutbox.publishedAt} IS NULL
          AND ${queueOutbox.deadLetteredAt} IS NULL
          AND ${queueOutbox.availableAt} <= now()
          AND (
            ${queueOutbox.lockedAt} IS NULL
            OR ${queueOutbox.lockedAt} < now() - (${lockTimeoutSeconds} * interval '1 second')
          )
        ORDER BY ${queueOutbox.createdAt}, ${queueOutbox.id}
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE ${queueOutbox} AS event
      SET
        locked_at = now(),
        locked_by = ${input.workerId},
        attempts = event.attempts + 1
      FROM candidate
      WHERE event.id = candidate.id
      RETURNING
        event.id AS "id",
        event.event_type AS "eventType",
        event.queue_name AS "queueName",
        event.payload_json AS "payload",
        event.attempts AS "attempts",
        event.created_at AS "createdAt"
    `);
    const row = rows[0];
    return row
      ? {
          ...row,
          createdAt: new Date(row.createdAt).toISOString(),
        }
      : null;
  }

  async complete(eventId: string, workerId: string): Promise<void> {
    assertWorkerId(workerId);
    await this.db.transaction(async (tx) => {
      const now = this.clock();
      const rows = await tx
        .update(queueOutbox)
        .set({
          publishedAt: now,
          lockedAt: null,
          lockedBy: null,
          lastError: null,
        })
        .where(
          and(eq(queueOutbox.id, eventId), eq(queueOutbox.lockedBy, workerId)),
        )
        .returning({ id: queueOutbox.id });
      if (!rows.length) {
        throw new OutboxClaimLostError(`Outbox 事件 ${eventId} 的处理锁已丢失`);
      }
      await tx
        .update(deadLetterEvents)
        .set({
          status: 'RESOLVED',
          resolvedBy: workerId,
          resolvedAt: now,
          resolutionNote: '人工重放后由 Outbox Worker 处理成功',
        })
        .where(
          and(
            eq(deadLetterEvents.sourceType, 'OUTBOX'),
            eq(deadLetterEvents.sourceId, eventId),
            eq(deadLetterEvents.status, 'REPLAYING'),
          ),
        );
    });
  }

  async fail(input: {
    eventId: string;
    workerId: string;
    error: string;
    retryDelayMs: number;
    maxAttempts: number;
  }): Promise<OutboxFailureResult> {
    assertWorkerId(input.workerId);
    if (!Number.isFinite(input.retryDelayMs) || input.retryDelayMs < 0) {
      throw new TypeError('Outbox 重试延迟不能为负数');
    }
    if (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1) {
      throw new TypeError('Outbox 最大尝试次数必须是正整数');
    }

    return this.db.transaction(async (tx) => {
      const event = await lockClaimedEvent(tx, input.eventId, input.workerId);
      const now = this.clock();
      if (event.attempts >= input.maxAttempts) {
        await tx
          .update(queueOutbox)
          .set({
            lockedAt: null,
            lockedBy: null,
            lastError: input.error,
            deadLetteredAt: now,
          })
          .where(eq(queueOutbox.id, event.id));
        await tx
          .insert(deadLetterEvents)
          .values({
            sourceType: 'OUTBOX',
            sourceId: event.id,
            originalEvent: {
              eventType: event.eventType,
              queueName: event.queueName,
              payload: event.payload,
              attempts: event.attempts,
              createdAt: new Date(event.createdAt).toISOString(),
            },
            finalError: input.error,
            suggestedAction: '修复失败原因后从死信管理页面重放原 Outbox 事件',
          })
          .onConflictDoUpdate({
            target: [deadLetterEvents.sourceType, deadLetterEvents.sourceId],
            set: {
              finalError: input.error,
              suggestedAction: '修复失败原因后从死信管理页面重放原 Outbox 事件',
              status: 'OPEN',
            },
          });
        return {
          status: 'DEAD_LETTERED',
          attempts: event.attempts,
          availableAt: null,
        };
      }

      const availableAt = new Date(now.getTime() + input.retryDelayMs);
      await tx
        .update(queueOutbox)
        .set({
          availableAt,
          lockedAt: null,
          lockedBy: null,
          lastError: input.error,
        })
        .where(eq(queueOutbox.id, event.id));
      return {
        status: 'RETRY_SCHEDULED',
        attempts: event.attempts,
        availableAt: availableAt.toISOString(),
      };
    });
  }
}

async function lockClaimedEvent(
  tx: Transaction,
  eventId: string,
  workerId: string,
): Promise<ClaimedRow> {
  const rows = await tx.execute<ClaimedRow>(sql`
    SELECT
      ${queueOutbox.id} AS "id",
      ${queueOutbox.eventType} AS "eventType",
      ${queueOutbox.queueName} AS "queueName",
      ${queueOutbox.payload} AS "payload",
      ${queueOutbox.attempts} AS "attempts",
      ${queueOutbox.createdAt} AS "createdAt"
    FROM ${queueOutbox}
    WHERE ${queueOutbox.id} = ${eventId}
      AND ${queueOutbox.lockedBy} = ${workerId}
    FOR UPDATE
  `);
  const event = rows[0];
  if (!event) {
    throw new OutboxClaimLostError(`Outbox 事件 ${eventId} 的处理锁已丢失`);
  }
  return event;
}

function assertWorkerId(workerId: string): void {
  if (!workerId || workerId.length > 128) {
    throw new TypeError('Outbox workerId 长度必须为 1～128 字符');
  }
}

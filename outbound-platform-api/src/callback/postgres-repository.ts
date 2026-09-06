import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { callbackInbox, deadLetterEvents } from '../db/schema.js';
import {
  CallbackClaimLostError,
  type CallbackFailureResult,
  type CallbackInboxRepository,
  type CallbackIngestResult,
  type ClaimedCallback,
} from './repository.js';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

type ClaimedRow = {
  id: string;
  callbackType: string;
  eventKey: string;
  rawBodyCiphertext: string;
  rawBodySha256: string;
  processAttempts: number;
  receivedAt: Date;
};

export class PostgresCallbackInboxRepository implements CallbackInboxRepository {
  private readonly provider: string;
  private readonly clock: () => Date;

  constructor(
    private readonly db: Database,
    options: { provider?: string; clock?: () => Date } = {},
  ) {
    this.provider = options.provider ?? 'BAIYING';
    this.clock = options.clock ?? (() => new Date());
    if (!this.provider || this.provider.length > 64) {
      throw new TypeError('Callback provider 长度必须为 1～64 字符');
    }
  }

  async save(input: {
    callbackType: string;
    eventKey: string;
    rawBodyCiphertext: string;
    rawBodySha256: string;
    headers: Record<string, string>;
  }): Promise<CallbackIngestResult> {
    const now = this.clock();
    const [inserted] = await this.db
      .insert(callbackInbox)
      .values({
        provider: this.provider,
        callbackType: truncate(input.callbackType, 128),
        eventKey: input.eventKey,
        rawBodyCiphertext: input.rawBodyCiphertext,
        rawBodySha256: input.rawBodySha256,
        headers: input.headers,
        receivedAt: now,
        availableAt: now,
      })
      .onConflictDoNothing({ target: callbackInbox.eventKey })
      .returning({ id: callbackInbox.id, eventKey: callbackInbox.eventKey });
    if (inserted) return { ...inserted, replayed: false };

    const [existing] = await this.db
      .select({ id: callbackInbox.id, eventKey: callbackInbox.eventKey })
      .from(callbackInbox)
      .where(
        and(
          eq(callbackInbox.provider, this.provider),
          eq(callbackInbox.eventKey, input.eventKey),
        ),
      )
      .limit(1);
    if (!existing) {
      throw new Error('重复回调冲突后未找到既有 Inbox 记录');
    }
    return { ...existing, replayed: true };
  }

  async claimNext(input: {
    workerId: string;
    lockTimeoutSeconds?: number;
    eventKey?: string;
  }): Promise<ClaimedCallback | null> {
    assertWorkerId(input.workerId);
    const lockTimeoutSeconds = input.lockTimeoutSeconds ?? 1_800;
    if (!Number.isInteger(lockTimeoutSeconds) || lockTimeoutSeconds < 1) {
      throw new TypeError('Callback 锁超时必须是正整数秒');
    }
    const rows = await this.db.execute<ClaimedRow>(sql`
      WITH candidate AS (
        SELECT ${callbackInbox.id}
        FROM ${callbackInbox}
        WHERE ${callbackInbox.provider} = ${this.provider}
          AND (${input.eventKey ?? null}::text IS NULL OR ${callbackInbox.eventKey} = ${input.eventKey ?? null})
          AND ${callbackInbox.deadLetteredAt} IS NULL
          AND ${callbackInbox.availableAt} <= now()
          AND (
            ${callbackInbox.processStatus} IN ('PENDING', 'FAILED')
            OR (
              ${callbackInbox.processStatus} = 'PROCESSING'
              AND ${callbackInbox.lockedAt} < now() - (${lockTimeoutSeconds} * interval '1 second')
            )
          )
        ORDER BY ${callbackInbox.receivedAt}, ${callbackInbox.id}
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE ${callbackInbox} AS inbox
      SET
        process_status = 'PROCESSING',
        process_attempts = inbox.process_attempts + 1,
        locked_at = now(),
        locked_by = ${input.workerId},
        process_error = NULL
      FROM candidate
      WHERE inbox.id = candidate.id
      RETURNING
        inbox.id AS "id",
        inbox.callback_type AS "callbackType",
        inbox.event_key AS "eventKey",
        inbox.raw_body_ciphertext AS "rawBodyCiphertext",
        inbox.raw_body_sha256 AS "rawBodySha256",
        inbox.process_attempts AS "processAttempts",
        inbox.received_at AS "receivedAt"
    `);
    const row = rows[0];
    return row
      ? { ...row, receivedAt: new Date(row.receivedAt).toISOString() }
      : null;
  }

  async complete(input: { inboxId: string; workerId: string }): Promise<void> {
    assertWorkerId(input.workerId);
    const rows = await this.db
      .update(callbackInbox)
      .set({
        parseStatus: 'VALID',
        processStatus: 'SUCCEEDED',
        parseError: null,
        processError: null,
        lockedAt: null,
        lockedBy: null,
        processedAt: this.clock(),
      })
      .where(
        and(
          eq(callbackInbox.id, input.inboxId),
          eq(callbackInbox.processStatus, 'PROCESSING'),
          eq(callbackInbox.lockedBy, input.workerId),
        ),
      )
      .returning({ id: callbackInbox.id });
    if (!rows.length) throw claimLost(input.inboxId);
  }

  async reject(input: {
    inboxId: string;
    workerId: string;
    parseStatus: 'INVALID' | 'UNKNOWN_TYPE';
    error: string;
  }): Promise<void> {
    assertWorkerId(input.workerId);
    await this.db.transaction(async (tx) => {
      const inbox = await lockClaimedCallback(
        tx,
        input.inboxId,
        input.workerId,
      );
      const now = this.clock();
      const error = truncate(input.error, 4_000);
      await tx
        .update(callbackInbox)
        .set({
          parseStatus: input.parseStatus,
          processStatus: 'FAILED',
          parseError: error,
          processError: error,
          lockedAt: null,
          lockedBy: null,
          processedAt: now,
          deadLetteredAt: now,
        })
        .where(eq(callbackInbox.id, inbox.id));
      await upsertDeadLetter(
        tx,
        inbox,
        error,
        parseSuggestion(input.parseStatus),
      );
    });
  }

  async fail(input: {
    inboxId: string;
    workerId: string;
    error: string;
    retryDelayMs: number;
    maxAttempts: number;
    parseStatus?: 'PENDING' | 'VALID';
  }): Promise<CallbackFailureResult> {
    assertWorkerId(input.workerId);
    if (!Number.isFinite(input.retryDelayMs) || input.retryDelayMs < 0) {
      throw new TypeError('Callback 重试延迟不能为负数');
    }
    if (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1) {
      throw new TypeError('Callback 最大尝试次数必须是正整数');
    }
    return this.db.transaction(async (tx) => {
      const inbox = await lockClaimedCallback(
        tx,
        input.inboxId,
        input.workerId,
      );
      const now = this.clock();
      const error = truncate(input.error, 4_000);
      if (inbox.processAttempts >= input.maxAttempts) {
        await tx
          .update(callbackInbox)
          .set({
            parseStatus: input.parseStatus ?? 'VALID',
            processStatus: 'FAILED',
            processError: error,
            lockedAt: null,
            lockedBy: null,
            processedAt: now,
            deadLetteredAt: now,
          })
          .where(eq(callbackInbox.id, inbox.id));
        await upsertDeadLetter(
          tx,
          inbox,
          error,
          '确认百应任务/客户关联和数据约束后，从死信管理页面重放回调',
        );
        return {
          status: 'DEAD_LETTERED',
          attempts: inbox.processAttempts,
          availableAt: null,
        };
      }

      const availableAt = new Date(now.getTime() + input.retryDelayMs);
      await tx
        .update(callbackInbox)
        .set({
          parseStatus: input.parseStatus ?? 'VALID',
          processStatus: 'FAILED',
          processError: error,
          availableAt,
          lockedAt: null,
          lockedBy: null,
          processedAt: null,
        })
        .where(eq(callbackInbox.id, inbox.id));
      return {
        status: 'RETRY_SCHEDULED',
        attempts: inbox.processAttempts,
        availableAt: availableAt.toISOString(),
      };
    });
  }
}

async function lockClaimedCallback(
  tx: Transaction,
  inboxId: string,
  workerId: string,
): Promise<ClaimedRow> {
  const rows = await tx.execute<ClaimedRow>(sql`
    SELECT
      ${callbackInbox.id} AS "id",
      ${callbackInbox.callbackType} AS "callbackType",
      ${callbackInbox.eventKey} AS "eventKey",
      ${callbackInbox.rawBodyCiphertext} AS "rawBodyCiphertext",
      ${callbackInbox.rawBodySha256} AS "rawBodySha256",
      ${callbackInbox.processAttempts} AS "processAttempts",
      ${callbackInbox.receivedAt} AS "receivedAt"
    FROM ${callbackInbox}
    WHERE ${callbackInbox.id} = ${inboxId}
      AND ${callbackInbox.processStatus} = 'PROCESSING'
      AND ${callbackInbox.lockedBy} = ${workerId}
    FOR UPDATE
  `);
  const row = rows[0];
  if (!row) throw claimLost(inboxId);
  return row;
}

async function upsertDeadLetter(
  tx: Transaction,
  inbox: ClaimedRow,
  error: string,
  suggestedAction: string,
): Promise<void> {
  await tx
    .insert(deadLetterEvents)
    .values({
      sourceType: 'CALLBACK',
      sourceId: inbox.id,
      originalEvent: {
        callbackType: inbox.callbackType,
        eventKey: inbox.eventKey,
        rawBodySha256: inbox.rawBodySha256,
        processAttempts: inbox.processAttempts,
        receivedAt: new Date(inbox.receivedAt).toISOString(),
      },
      finalError: error,
      suggestedAction,
    })
    .onConflictDoUpdate({
      target: [deadLetterEvents.sourceType, deadLetterEvents.sourceId],
      set: {
        finalError: error,
        suggestedAction,
        status: 'OPEN',
      },
    });
}

function parseSuggestion(status: 'INVALID' | 'UNKNOWN_TYPE'): string {
  return status === 'INVALID'
    ? '核对供应商原始报文格式；修复兼容 Schema 后从死信管理页面重放'
    : '确认是否需要支持该回调类型；发布处理器后从死信管理页面重放';
}

function claimLost(inboxId: string): CallbackClaimLostError {
  return new CallbackClaimLostError(`Callback Inbox ${inboxId} 的处理锁已丢失`);
}

function assertWorkerId(workerId: string): void {
  if (!workerId || workerId.length > 128) {
    throw new TypeError('Callback workerId 长度必须为 1～128 字符');
  }
}

function truncate(value: string, length: number): string {
  return value.slice(0, length);
}

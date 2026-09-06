import { randomUUID } from 'node:crypto';
import { and, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import {
  operatorDeadLetterActionResultSchema,
  operatorDeadLetterPageSchema,
  operatorDeadLetterSchema,
  type IgnoreDeadLetterInput,
  type OperatorDeadLetter,
  type OperatorDeadLetterActionResult,
  type OperatorDeadLetterPage,
  type OperatorDeadLetterSourceType,
  type OperatorDeadLetterStatus,
  type ReplayDeadLetterInput,
} from '@outbound/contracts';
import type { Database } from '../db/client.js';
import {
  auditLogs,
  callbackInbox,
  callInstances,
  deadLetterEvents,
  deliveryEvents,
  platformTasks,
  queueOutbox,
  recordingAssets,
} from '../db/schema.js';
import { redactOperatorText, sanitizeOperatorDetail } from './redaction.js';
import { OperationsConsoleFailure } from './service.js';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export type DeadLetterListInput = {
  keyword?: string;
  sourceType?: OperatorDeadLetterSourceType;
  status?: OperatorDeadLetterStatus;
  pageNum: number;
  pageSize: number;
};

type DeadLetterRow = typeof deadLetterEvents.$inferSelect & {
  eventType: string | null;
  taskNo: string | null;
  sourceStatus: string | null;
  sourceExists: boolean;
};

export interface RecoveryOperationsService {
  listDeadLetters(input: DeadLetterListInput): Promise<OperatorDeadLetterPage>;
  replayDeadLetter(
    deadLetterId: string,
    input: ReplayDeadLetterInput,
    actorId: string,
    requestId: string,
  ): Promise<OperatorDeadLetterActionResult>;
  ignoreDeadLetter(
    deadLetterId: string,
    input: IgnoreDeadLetterInput,
    actorId: string,
    requestId: string,
  ): Promise<OperatorDeadLetterActionResult>;
}

export class PostgresRecoveryOperationsService implements RecoveryOperationsService {
  constructor(
    private readonly db: Database,
    private readonly clock: () => Date = () => new Date(),
    private readonly createId: () => string = randomUUID,
  ) {}

  async listDeadLetters(
    input: DeadLetterListInput,
  ): Promise<OperatorDeadLetterPage> {
    const keyword = input.keyword?.trim();
    const keywordCondition = keyword
      ? or(
          ilike(deadLetterEvents.finalError, containsPattern(keyword)),
          ilike(deadLetterEvents.suggestedAction, containsPattern(keyword)),
          sql`${deadLetterEvents.originalEvent}::text ilike ${containsPattern(keyword)}`,
          sql`coalesce(${queueOutbox.eventType}, ${callbackInbox.callbackType}, ${deliveryEvents.eventType}, '') ilike ${containsPattern(keyword)}`,
          sql`coalesce(${platformTasks.taskNo}, ${queueOutbox.payload}->>'taskNo', '') ilike ${containsPattern(keyword)}`,
        )
      : undefined;
    const filteredWhere = and(
      keywordCondition,
      input.sourceType
        ? eq(deadLetterEvents.sourceType, input.sourceType)
        : undefined,
      input.status ? eq(deadLetterEvents.status, input.status) : undefined,
    );
    const [totalGroups, summaryRows, rows] = await Promise.all([
      this.deadLetterAggregateQuery(filteredWhere),
      this.deadLetterAggregateQuery(keywordCondition),
      this.deadLetterBaseQuery()
        .where(filteredWhere)
        .orderBy(desc(deadLetterEvents.createdAt), desc(deadLetterEvents.id))
        .limit(input.pageSize)
        .offset(input.pageNum * input.pageSize),
    ]);
    const summary = {
      all: 0,
      open: 0,
      replaying: 0,
      resolved: 0,
      ignored: 0,
      outbox: 0,
      callback: 0,
      recording: 0,
      delivery: 0,
    };
    for (const row of summaryRows) {
      summary.all += row.total;
      summary[row.status.toLowerCase() as 'open'] += row.total;
      summary[row.sourceType.toLowerCase() as 'outbox'] += row.total;
    }
    const total = totalGroups.reduce((sum, row) => sum + row.total, 0);
    return operatorDeadLetterPageSchema.parse({
      total,
      pages: Math.ceil(total / input.pageSize),
      pageNum: input.pageNum,
      pageSize: input.pageSize,
      summary,
      items: rows.map(toOperatorDeadLetter),
    });
  }

  async replayDeadLetter(
    deadLetterId: string,
    input: ReplayDeadLetterInput,
    actorId: string,
    requestId: string,
  ): Promise<OperatorDeadLetterActionResult> {
    const result = await this.db.transaction(async (tx) => {
      await advisoryLock(tx, `recovery-action:${input.idempotencyKey}`);
      const prior = await findRecoveryAudit(
        tx,
        'DEAD_LETTER_REPLAY_REQUESTED',
        input.idempotencyKey,
      );
      if (prior) {
        if (prior.deadLetterId !== deadLetterId) throw idempotencyConflict();
        return { replayed: true } as const;
      }
      await assertNoOtherRecoveryAction(tx, input.idempotencyKey);
      const deadLetter = await lockDeadLetter(tx, deadLetterId);
      if (deadLetter.status !== 'OPEN') {
        throw new OperationsConsoleFailure(
          'DEAD_LETTER_STATE_CONFLICT',
          `死信当前状态 ${deadLetter.status}，不能重复重放`,
          409,
        );
      }
      const now = this.clock();
      await resetDeadLetterSource(
        tx,
        deadLetter.sourceType,
        deadLetter.sourceId,
        now,
      );
      await tx
        .update(deadLetterEvents)
        .set({
          status: 'REPLAYING',
          replayCount: sql`${deadLetterEvents.replayCount} + 1`,
          resolvedBy: null,
          resolvedAt: null,
          resolutionNote: null,
        })
        .where(eq(deadLetterEvents.id, deadLetterId));
      await tx.insert(auditLogs).values({
        id: this.createId(),
        requestId,
        actorId,
        action: 'DEAD_LETTER_REPLAY_REQUESTED',
        objectType: 'DEAD_LETTER',
        objectId: deadLetterId,
        detail: {
          deadLetterId,
          sourceType: deadLetter.sourceType,
          sourceId: deadLetter.sourceId,
          reason: input.reason,
          idempotencyKey: input.idempotencyKey,
        },
        occurredAt: now,
      });
      return { replayed: false } as const;
    });
    const deadLetter = await this.requireDeadLetter(deadLetterId);
    return operatorDeadLetterActionResultSchema.parse({
      deadLetter,
      idempotentReplay: result.replayed,
      message: result.replayed
        ? '该死信重放请求已提交，无需重复操作'
        : '原事件已恢复到待处理队列；处理成功后会自动标记为已解决',
    });
  }

  async ignoreDeadLetter(
    deadLetterId: string,
    input: IgnoreDeadLetterInput,
    actorId: string,
    requestId: string,
  ): Promise<OperatorDeadLetterActionResult> {
    const result = await this.db.transaction(async (tx) => {
      await advisoryLock(tx, `recovery-action:${input.idempotencyKey}`);
      const prior = await findRecoveryAudit(
        tx,
        'DEAD_LETTER_IGNORED',
        input.idempotencyKey,
      );
      if (prior) {
        if (prior.deadLetterId !== deadLetterId) throw idempotencyConflict();
        return { replayed: true } as const;
      }
      await assertNoOtherRecoveryAction(tx, input.idempotencyKey);
      const deadLetter = await lockDeadLetter(tx, deadLetterId);
      if (deadLetter.status !== 'OPEN') {
        throw new OperationsConsoleFailure(
          'DEAD_LETTER_STATE_CONFLICT',
          `死信当前状态 ${deadLetter.status}，不能标记忽略`,
          409,
        );
      }
      const now = this.clock();
      await tx
        .update(deadLetterEvents)
        .set({
          status: 'IGNORED',
          resolvedBy: actorId,
          resolvedAt: now,
          resolutionNote: input.reason,
        })
        .where(eq(deadLetterEvents.id, deadLetterId));
      await tx.insert(auditLogs).values({
        id: this.createId(),
        requestId,
        actorId,
        action: 'DEAD_LETTER_IGNORED',
        objectType: 'DEAD_LETTER',
        objectId: deadLetterId,
        detail: {
          deadLetterId,
          sourceType: deadLetter.sourceType,
          sourceId: deadLetter.sourceId,
          reason: input.reason,
          idempotencyKey: input.idempotencyKey,
        },
        occurredAt: now,
      });
      return { replayed: false } as const;
    });
    const deadLetter = await this.requireDeadLetter(deadLetterId);
    return operatorDeadLetterActionResultSchema.parse({
      deadLetter,
      idempotentReplay: result.replayed,
      message: result.replayed
        ? '该忽略操作已经完成'
        : '死信已标记为忽略，原事件不会被自动重放',
    });
  }

  private deadLetterBaseQuery() {
    const eventType = sql<string | null>`case
      when ${deadLetterEvents.sourceType} = 'OUTBOX' then ${queueOutbox.eventType}
      when ${deadLetterEvents.sourceType} = 'CALLBACK' then ${callbackInbox.callbackType}
      when ${deadLetterEvents.sourceType} = 'DELIVERY' then ${deliveryEvents.eventType}
      when ${deadLetterEvents.sourceType} = 'RECORDING' then 'RECORDING_ARCHIVE'
      else null end`;
    const taskNo = sql<string | null>`coalesce(
      ${platformTasks.taskNo},
      ${queueOutbox.payload}->>'taskNo',
      ${queueOutbox.payload}->'payload'->>'taskNo'
    )`;
    const sourceStatus = sql<string | null>`case
      when ${deadLetterEvents.sourceType} = 'OUTBOX' then
        case when ${queueOutbox.publishedAt} is not null then 'SUCCEEDED'
             when ${queueOutbox.deadLetteredAt} is not null then 'DEAD_LETTERED'
             else 'PENDING' end
      when ${deadLetterEvents.sourceType} = 'CALLBACK' then ${callbackInbox.processStatus}::text
      when ${deadLetterEvents.sourceType} = 'DELIVERY' then ${deliveryEvents.status}::text
      when ${deadLetterEvents.sourceType} = 'RECORDING' then ${recordingAssets.archiveStatus}::text
      else null end`;
    const sourceExists = sql<boolean>`case
      when ${deadLetterEvents.sourceType} = 'OUTBOX' then ${queueOutbox.id} is not null
      when ${deadLetterEvents.sourceType} = 'CALLBACK' then ${callbackInbox.id} is not null
      when ${deadLetterEvents.sourceType} = 'DELIVERY' then ${deliveryEvents.id} is not null
      when ${deadLetterEvents.sourceType} = 'RECORDING' then ${recordingAssets.id} is not null
      else false end`;
    return this.db
      .select({
        id: deadLetterEvents.id,
        sourceType: deadLetterEvents.sourceType,
        sourceId: deadLetterEvents.sourceId,
        originalEvent: deadLetterEvents.originalEvent,
        originalObjectKey: deadLetterEvents.originalObjectKey,
        finalError: deadLetterEvents.finalError,
        suggestedAction: deadLetterEvents.suggestedAction,
        status: deadLetterEvents.status,
        replayCount: deadLetterEvents.replayCount,
        createdAt: deadLetterEvents.createdAt,
        resolvedBy: deadLetterEvents.resolvedBy,
        resolvedAt: deadLetterEvents.resolvedAt,
        resolutionNote: deadLetterEvents.resolutionNote,
        eventType,
        taskNo,
        sourceStatus,
        sourceExists,
      })
      .from(deadLetterEvents)
      .leftJoin(
        queueOutbox,
        and(
          eq(deadLetterEvents.sourceType, 'OUTBOX'),
          eq(queueOutbox.id, deadLetterEvents.sourceId),
        ),
      )
      .leftJoin(
        callbackInbox,
        and(
          eq(deadLetterEvents.sourceType, 'CALLBACK'),
          eq(callbackInbox.id, deadLetterEvents.sourceId),
        ),
      )
      .leftJoin(
        deliveryEvents,
        and(
          eq(deadLetterEvents.sourceType, 'DELIVERY'),
          eq(deliveryEvents.id, deadLetterEvents.sourceId),
        ),
      )
      .leftJoin(
        recordingAssets,
        and(
          eq(deadLetterEvents.sourceType, 'RECORDING'),
          eq(recordingAssets.id, deadLetterEvents.sourceId),
        ),
      )
      .leftJoin(
        callInstances,
        eq(callInstances.id, recordingAssets.callInstanceId),
      )
      .leftJoin(
        platformTasks,
        or(
          eq(platformTasks.id, deliveryEvents.taskId),
          eq(platformTasks.id, callInstances.taskId),
        ),
      );
  }

  private deadLetterAggregateQuery(where: SQL | undefined) {
    return this.db
      .select({
        status: deadLetterEvents.status,
        sourceType: deadLetterEvents.sourceType,
        total: sql<number>`count(*)::int`,
      })
      .from(deadLetterEvents)
      .leftJoin(
        queueOutbox,
        and(
          eq(deadLetterEvents.sourceType, 'OUTBOX'),
          eq(queueOutbox.id, deadLetterEvents.sourceId),
        ),
      )
      .leftJoin(
        callbackInbox,
        and(
          eq(deadLetterEvents.sourceType, 'CALLBACK'),
          eq(callbackInbox.id, deadLetterEvents.sourceId),
        ),
      )
      .leftJoin(
        deliveryEvents,
        and(
          eq(deadLetterEvents.sourceType, 'DELIVERY'),
          eq(deliveryEvents.id, deadLetterEvents.sourceId),
        ),
      )
      .leftJoin(
        recordingAssets,
        and(
          eq(deadLetterEvents.sourceType, 'RECORDING'),
          eq(recordingAssets.id, deadLetterEvents.sourceId),
        ),
      )
      .leftJoin(
        callInstances,
        eq(callInstances.id, recordingAssets.callInstanceId),
      )
      .leftJoin(
        platformTasks,
        or(
          eq(platformTasks.id, deliveryEvents.taskId),
          eq(platformTasks.id, callInstances.taskId),
        ),
      )
      .where(where)
      .groupBy(deadLetterEvents.status, deadLetterEvents.sourceType);
  }

  private async requireDeadLetter(id: string): Promise<OperatorDeadLetter> {
    const [row] = await this.deadLetterBaseQuery()
      .where(eq(deadLetterEvents.id, id))
      .limit(1);
    if (!row) {
      throw new OperationsConsoleFailure(
        'DEAD_LETTER_NOT_FOUND',
        '死信不存在',
        404,
      );
    }
    return toOperatorDeadLetter(row);
  }
}

function toOperatorDeadLetter(row: DeadLetterRow): OperatorDeadLetter {
  const blockedReason = row.sourceExists
    ? row.status === 'OPEN'
      ? null
      : `当前状态 ${row.status} 不允许重放`
    : '原始事件记录已不存在，不能自动重放';
  return operatorDeadLetterSchema.parse({
    id: row.id,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    sourceLabel: sourceLabel(row.sourceType),
    eventType: row.eventType,
    taskNo: row.taskNo,
    status: row.status,
    replayCount: row.replayCount,
    finalError:
      redactOperatorText(row.finalError) ?? '原事件处理失败，等待人工确认',
    suggestedAction: redactOperatorText(row.suggestedAction),
    replayable: row.sourceExists && row.status === 'OPEN',
    replayBlockedReason: blockedReason,
    sourceStatus: row.sourceStatus,
    originalSummary: sanitizeOperatorDetail(
      row.originalEvent ?? {
        originalObjectKey: row.originalObjectKey ?? '未保留摘要',
      },
    ),
    createdAt: row.createdAt.toISOString(),
    resolvedBy: row.resolvedBy,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    resolutionNote: redactOperatorText(row.resolutionNote),
  });
}

async function resetDeadLetterSource(
  tx: Transaction,
  sourceType: OperatorDeadLetterSourceType,
  sourceId: string,
  now: Date,
) {
  let changed: Array<{ id: string }> = [];
  if (sourceType === 'OUTBOX') {
    changed = await tx
      .update(queueOutbox)
      .set({
        publishedAt: null,
        attempts: 0,
        availableAt: now,
        lockedAt: null,
        lockedBy: null,
        lastError: null,
        deadLetteredAt: null,
      })
      .where(eq(queueOutbox.id, sourceId))
      .returning({ id: queueOutbox.id });
  } else if (sourceType === 'CALLBACK') {
    changed = await tx
      .update(callbackInbox)
      .set({
        parseStatus: 'PENDING',
        processStatus: 'PENDING',
        processAttempts: 0,
        availableAt: now,
        lockedAt: null,
        lockedBy: null,
        deadLetteredAt: null,
        parseError: null,
        processError: null,
        processedAt: null,
      })
      .where(eq(callbackInbox.id, sourceId))
      .returning({ id: callbackInbox.id });
  } else if (sourceType === 'RECORDING') {
    changed = await tx
      .update(recordingAssets)
      .set({
        archiveStatus: 'PENDING',
        downloadAttempts: 0,
        lastError: null,
      })
      .where(eq(recordingAssets.id, sourceId))
      .returning({ id: recordingAssets.id });
  } else {
    changed = await tx
      .update(deliveryEvents)
      .set({
        status: 'PENDING',
        attemptCount: 0,
        availableAt: now,
        lockedAt: null,
        lockedBy: null,
        lastError: null,
        deliveredAt: null,
      })
      .where(eq(deliveryEvents.id, sourceId))
      .returning({ id: deliveryEvents.id });
  }
  if (!changed.length) {
    throw new OperationsConsoleFailure(
      'DEAD_LETTER_SOURCE_NOT_FOUND',
      '死信对应的原始事件已不存在，不能自动重放',
      409,
    );
  }
}

async function lockDeadLetter(tx: Transaction, id: string) {
  const rows = await tx.execute<{
    id: string;
    sourceType: OperatorDeadLetterSourceType;
    sourceId: string;
    status: OperatorDeadLetterStatus;
  }>(sql`
    select
      id,
      source_type as "sourceType",
      source_id as "sourceId",
      status
    from dead_letter_event
    where id = ${id}
    for update
  `);
  const row = rows[0];
  if (!row) {
    throw new OperationsConsoleFailure(
      'DEAD_LETTER_NOT_FOUND',
      '死信不存在',
      404,
    );
  }
  return row;
}

async function findRecoveryAudit(
  tx: Transaction,
  action: 'DEAD_LETTER_REPLAY_REQUESTED' | 'DEAD_LETTER_IGNORED',
  idempotencyKey: string,
) {
  const rows = await tx.execute<{ deadLetterId: string }>(sql`
    select detail_json->>'deadLetterId' as "deadLetterId"
    from audit_log
    where action = ${action}
      and detail_json->>'idempotencyKey' = ${idempotencyKey}
    limit 1
  `);
  return rows[0];
}

async function assertNoOtherRecoveryAction(
  tx: Transaction,
  idempotencyKey: string,
) {
  const rows = await tx.execute<{ id: string }>(sql`
    select id
    from audit_log
    where action in ('DEAD_LETTER_REPLAY_REQUESTED', 'DEAD_LETTER_IGNORED')
      and detail_json->>'idempotencyKey' = ${idempotencyKey}
    limit 1
  `);
  if (rows.length) throw idempotencyConflict();
}

function sourceLabel(sourceType: OperatorDeadLetterSourceType) {
  if (sourceType === 'OUTBOX') return '队列事件';
  if (sourceType === 'CALLBACK') return '百应回调';
  if (sourceType === 'RECORDING') return '录音归档';
  return 'ERP/CRM 回传';
}

function containsPattern(value: string) {
  return `%${value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
}

async function advisoryLock(tx: Transaction, key: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
  );
}

function idempotencyConflict() {
  return new OperationsConsoleFailure(
    'IDEMPOTENCY_CONFLICT',
    '同一幂等键已用于不同的死信操作',
    409,
  );
}

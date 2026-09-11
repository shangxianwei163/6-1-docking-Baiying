import 'dotenv/config';
import { eq, sql } from 'drizzle-orm';
import { readConfig } from '../config.js';
import { createDatabase, type Database } from '../db/client.js';
import {
  callbackInbox,
  deadLetterEvents,
  operationalMetricEvents,
} from '../db/schema.js';

type Candidate = {
  deadLetterId: string;
  inboxId: string;
  callbackType: string;
  eventKey: string;
  processAttempts: number;
};

export async function ignoreLegacyUnmanagedCallbacks(
  db: Database,
  input: { apply: boolean; expectedCount?: number; actorId?: string },
): Promise<{ matched: number; ignored: number; dryRun: boolean }> {
  return db.transaction(async (tx) => {
    const candidates = await tx.execute<Candidate>(sql`
      SELECT
        dead_letter.id AS "deadLetterId",
        inbox.id AS "inboxId",
        inbox.callback_type AS "callbackType",
        inbox.event_key AS "eventKey",
        inbox.process_attempts AS "processAttempts"
      FROM dead_letter_event dead_letter
      JOIN callback_inbox inbox
        ON dead_letter.source_type = 'CALLBACK'
       AND dead_letter.source_id = inbox.id
      WHERE dead_letter.status = 'OPEN'
        AND inbox.process_status = 'FAILED'
        AND inbox.parse_status = 'VALID'
        AND dead_letter.final_error LIKE 'Error: 未找到百应任务 companyId=%, callJobId=%'
        AND (
          (
            inbox.company_id IS NOT NULL
            AND inbox.call_job_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1
              FROM platform_task task
              WHERE task.baiying_company_id = inbox.company_id
                AND task.baiying_call_job_id = inbox.call_job_id
            )
          )
          OR (
            inbox.company_id IS NULL
            AND inbox.call_job_id IS NULL
          )
        )
      ORDER BY dead_letter.created_at, dead_letter.id
      FOR UPDATE OF dead_letter, inbox
    `);

    if (
      input.expectedCount !== undefined &&
      candidates.length !== input.expectedCount
    ) {
      throw new Error(
        `待忽略回调数量 ${candidates.length} 与预期 ${input.expectedCount} 不一致，已中止且未修改数据`,
      );
    }
    if (!input.apply) {
      return { matched: candidates.length, ignored: 0, dryRun: true };
    }

    const now = new Date();
    const actorId = input.actorId ?? 'callback-unmanaged-cleanup';
    for (const candidate of candidates) {
      await tx
        .update(callbackInbox)
        .set({
          parseStatus: 'VALID',
          processStatus: 'SUCCEEDED',
          parseError: null,
          processError: null,
          lockedAt: null,
          lockedBy: null,
          processedAt: now,
          deadLetteredAt: null,
        })
        .where(eq(callbackInbox.id, candidate.inboxId));
      await tx
        .update(deadLetterEvents)
        .set({
          status: 'IGNORED',
          resolvedBy: actorId,
          resolvedAt: now,
          resolutionNote: '自动忽略：回调来自非本平台创建的百应任务',
        })
        .where(eq(deadLetterEvents.id, candidate.deadLetterId));
      await tx.insert(operationalMetricEvents).values({
        metricCode: 'CALLBACK_UNMANAGED_TASK_IGNORED',
        sourceSystem: 'BAIYING',
        objectRef: candidate.inboxId,
        detail: {
          callbackType: candidate.callbackType,
          eventKey: candidate.eventKey,
          processAttempts: candidate.processAttempts,
          reason: 'UNMANAGED_TASK',
          historicalCleanup: true,
        },
        occurredAt: now,
      });
    }
    return {
      matched: candidates.length,
      ignored: candidates.length,
      dryRun: false,
    };
  });
}

if (isDirectExecution()) {
  const apply = process.argv.includes('--apply');
  const expectedCount = expectedCountArgument(process.argv.slice(2));
  if (apply && expectedCount === undefined) {
    throw new Error('正式执行必须提供 --expected-count=<数量>');
  }
  const config = readConfig();
  const database = createDatabase(config.DATABASE_URL);
  try {
    const result = await ignoreLegacyUnmanagedCallbacks(database.db, {
      apply,
      expectedCount,
    });
    console.info(JSON.stringify({ status: 'ok', ...result }));
  } finally {
    await database.close();
  }
}

function expectedCountArgument(args: string[]): number | undefined {
  const value = args.find((argument) =>
    argument.startsWith('--expected-count='),
  );
  if (!value) return undefined;
  const count = Number(value.slice('--expected-count='.length));
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error('--expected-count 必须是非负整数');
  }
  return count;
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  return Boolean(entry && import.meta.url === new URL(entry, 'file:').href);
}

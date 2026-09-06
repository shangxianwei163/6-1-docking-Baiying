import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  deadLetterEvents,
  platformTasks,
  recordingAssets,
} from '../db/schema.js';
import {
  RecordingClaimLostError,
  type ArchivedRecordingMetadata,
  type ClaimedRecordingAsset,
  type RecordingArchiveFailureResult,
  type RecordingArchiveRepository,
} from './repository.js';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

type ClaimedRow = {
  id: string;
  callInstanceId: string;
  taskId: string;
  studioId: string;
  kind: 'FULL' | 'USER_ONLY';
  providerUrlCiphertext: string;
  downloadAttempts: number;
  discoveredAt: Date;
};

type LockedRecording = ClaimedRow & { lockedBy: string | null };

export class PostgresRecordingArchiveRepository implements RecordingArchiveRepository {
  constructor(
    private readonly db: Database,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async claimNext(input: {
    workerId: string;
    lockTimeoutSeconds?: number;
    recordingId?: string;
  }): Promise<ClaimedRecordingAsset | null> {
    assertWorkerId(input.workerId);
    const lockTimeoutSeconds = input.lockTimeoutSeconds ?? 1_800;
    if (!Number.isInteger(lockTimeoutSeconds) || lockTimeoutSeconds < 1) {
      throw new TypeError('录音归档锁超时必须是正整数秒');
    }
    const rows = await this.db.execute<ClaimedRow>(sql`
      WITH candidate AS (
        SELECT
          recording.id,
          task.id AS task_id,
          task.studio_id
        FROM recording_asset AS recording
        INNER JOIN call_instance AS call ON call.id = recording.call_instance_id
        INNER JOIN platform_task AS task ON task.id = call.task_id
        WHERE (${input.recordingId ?? null}::uuid IS NULL OR recording.id = ${input.recordingId ?? null}::uuid)
          AND recording.dead_lettered_at IS NULL
          AND recording.deleted_at IS NULL
          AND (
            (
              recording.archive_status IN ('PENDING', 'FAILED')
              AND recording.available_at <= now()
            )
            OR (
              recording.archive_status = 'DOWNLOADING'
              AND (
                recording.locked_at IS NULL
                OR recording.locked_at < now() - (${lockTimeoutSeconds} * interval '1 second')
              )
            )
          )
        ORDER BY recording.discovered_at, recording.id
        FOR UPDATE OF recording SKIP LOCKED
        LIMIT 1
      )
      UPDATE recording_asset AS recording
      SET
        archive_status = 'DOWNLOADING',
        download_attempts = recording.download_attempts + 1,
        locked_at = now(),
        locked_by = ${input.workerId},
        last_error = NULL
      FROM candidate
      WHERE recording.id = candidate.id
      RETURNING
        recording.id,
        recording.call_instance_id AS "callInstanceId",
        candidate.task_id AS "taskId",
        candidate.studio_id AS "studioId",
        recording.kind,
        recording.provider_url_ciphertext AS "providerUrlCiphertext",
        recording.download_attempts AS "downloadAttempts",
        recording.discovered_at AS "discoveredAt"
    `);
    const row = rows[0];
    return row
      ? { ...row, discoveredAt: new Date(row.discoveredAt).toISOString() }
      : null;
  }

  async complete(input: {
    recordingId: string;
    workerId: string;
    metadata: ArchivedRecordingMetadata;
  }): Promise<void> {
    assertWorkerId(input.workerId);
    await this.db.transaction(async (tx) => {
      const recording = await lockClaimedRecording(
        tx,
        input.recordingId,
        input.workerId,
      );
      const changed = await tx
        .update(recordingAssets)
        .set({
          ossBucket: input.metadata.bucket,
          ossObjectKey: input.metadata.objectKey,
          contentType: input.metadata.contentType,
          sizeBytes: input.metadata.sizeBytes,
          sha256: input.metadata.sha256,
          archiveStatus: 'ARCHIVED',
          archivedAt: input.metadata.archivedAt,
          retentionUntil: input.metadata.retentionUntil,
          lockedAt: null,
          lockedBy: null,
          lastError: null,
        })
        .where(
          and(
            eq(recordingAssets.id, recording.id),
            eq(recordingAssets.archiveStatus, 'DOWNLOADING'),
            eq(recordingAssets.lockedBy, input.workerId),
          ),
        )
        .returning({ id: recordingAssets.id });
      if (!changed.length) throw claimLost(input.recordingId);
      await refreshTaskArchiveSummary(tx, recording.taskId, this.clock());
      await tx
        .update(deadLetterEvents)
        .set({
          status: 'RESOLVED',
          resolvedBy: input.workerId,
          resolvedAt: this.clock(),
          resolutionNote: '人工重放后录音归档成功',
        })
        .where(
          and(
            eq(deadLetterEvents.sourceType, 'RECORDING'),
            eq(deadLetterEvents.sourceId, recording.id),
            eq(deadLetterEvents.status, 'REPLAYING'),
          ),
        );
    });
  }

  async fail(input: {
    recordingId: string;
    workerId: string;
    error: string;
    retryDelayMs: number;
    maxAttempts: number;
  }): Promise<RecordingArchiveFailureResult> {
    assertWorkerId(input.workerId);
    if (!Number.isFinite(input.retryDelayMs) || input.retryDelayMs < 0) {
      throw new TypeError('录音归档重试延迟不能为负数');
    }
    if (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1) {
      throw new TypeError('录音归档最大尝试次数必须是正整数');
    }
    return this.db.transaction(async (tx) => {
      const recording = await lockClaimedRecording(
        tx,
        input.recordingId,
        input.workerId,
      );
      const now = this.clock();
      const error = truncate(input.error, 4_000);
      if (recording.downloadAttempts >= input.maxAttempts) {
        await tx
          .update(recordingAssets)
          .set({
            archiveStatus: 'FAILED',
            lockedAt: null,
            lockedBy: null,
            deadLetteredAt: now,
            lastError: error,
          })
          .where(eq(recordingAssets.id, recording.id));
        await tx
          .insert(deadLetterEvents)
          .values({
            sourceType: 'RECORDING',
            sourceId: recording.id,
            originalEvent: {
              recordingId: recording.id,
              callInstanceId: recording.callInstanceId,
              taskId: recording.taskId,
              kind: recording.kind,
              attempts: recording.downloadAttempts,
              discoveredAt: recording.discoveredAt.toISOString(),
            },
            finalError: error,
            suggestedAction:
              '确认百应录音仍可访问及域名允许列表后，从异常中心重放录音归档',
          })
          .onConflictDoUpdate({
            target: [deadLetterEvents.sourceType, deadLetterEvents.sourceId],
            set: {
              originalEvent: {
                recordingId: recording.id,
                callInstanceId: recording.callInstanceId,
                taskId: recording.taskId,
                kind: recording.kind,
                attempts: recording.downloadAttempts,
                discoveredAt: recording.discoveredAt.toISOString(),
              },
              finalError: error,
              suggestedAction:
                '确认百应录音仍可访问及域名允许列表后，从异常中心重放录音归档',
              status: 'OPEN',
              resolvedBy: null,
              resolvedAt: null,
              resolutionNote: null,
            },
          });
        await refreshTaskArchiveSummary(tx, recording.taskId, now);
        return {
          status: 'DEAD_LETTERED',
          attempts: recording.downloadAttempts,
          availableAt: null,
        };
      }

      const availableAt = new Date(now.getTime() + input.retryDelayMs);
      await tx
        .update(recordingAssets)
        .set({
          archiveStatus: 'FAILED',
          availableAt,
          lockedAt: null,
          lockedBy: null,
          lastError: error,
        })
        .where(eq(recordingAssets.id, recording.id));
      await refreshTaskArchiveSummary(tx, recording.taskId, now);
      return {
        status: 'RETRY_SCHEDULED',
        attempts: recording.downloadAttempts,
        availableAt: availableAt.toISOString(),
      };
    });
  }
}

async function lockClaimedRecording(
  tx: Transaction,
  recordingId: string,
  workerId: string,
): Promise<LockedRecording> {
  const rows = await tx.execute<LockedRecording>(sql`
    SELECT
      recording.id,
      recording.call_instance_id AS "callInstanceId",
      call.task_id AS "taskId",
      task.studio_id AS "studioId",
      recording.kind,
      recording.provider_url_ciphertext AS "providerUrlCiphertext",
      recording.download_attempts AS "downloadAttempts",
      recording.discovered_at AS "discoveredAt",
      recording.locked_by AS "lockedBy"
    FROM recording_asset AS recording
    INNER JOIN call_instance AS call ON call.id = recording.call_instance_id
    INNER JOIN platform_task AS task ON task.id = call.task_id
    WHERE recording.id = ${recordingId}
      AND recording.archive_status = 'DOWNLOADING'
      AND recording.locked_by = ${workerId}
    FOR UPDATE OF recording
  `);
  const recording = rows[0];
  if (!recording) throw claimLost(recordingId);
  return { ...recording, discoveredAt: new Date(recording.discoveredAt) };
}

async function refreshTaskArchiveSummary(
  tx: Transaction,
  taskId: string,
  now: Date,
): Promise<void> {
  const [summary] = await tx.execute<{
    total: number;
    archived: number;
    permanentFailures: number;
  }>(sql`
    SELECT
      count(recording.id)::int AS total,
      count(recording.id) FILTER (WHERE recording.archive_status = 'ARCHIVED')::int AS archived,
      count(recording.id) FILTER (WHERE recording.dead_lettered_at IS NOT NULL)::int AS "permanentFailures"
    FROM recording_asset AS recording
    INNER JOIN call_instance AS call ON call.id = recording.call_instance_id
    WHERE call.task_id = ${taskId}
  `);
  const total = Number(summary?.total ?? 0);
  const archived = Number(summary?.archived ?? 0);
  const permanentFailures = Number(summary?.permanentFailures ?? 0);
  const archiveStatus =
    total === 0
      ? 'NOT_AVAILABLE'
      : archived === total
        ? 'ARCHIVED'
        : permanentFailures > 0 && archived > 0
          ? 'PARTIAL'
          : permanentFailures === total
            ? 'FAILED'
            : 'PENDING';
  await tx
    .update(platformTasks)
    .set({
      recordingArchivedCount: archived,
      recordingArchiveStatus: archiveStatus,
      updatedAt: now,
      lockVersion: sql`${platformTasks.lockVersion} + 1`,
    })
    .where(eq(platformTasks.id, taskId));
}

function assertWorkerId(workerId: string): void {
  if (!workerId || workerId.length > 128) {
    throw new TypeError('录音归档 workerId 长度必须为 1～128 字符');
  }
}

function claimLost(recordingId: string): RecordingClaimLostError {
  return new RecordingClaimLostError(`录音 ${recordingId} 的归档处理锁已丢失`);
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

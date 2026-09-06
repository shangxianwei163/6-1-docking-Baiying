import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  auditLogs,
  callInstances,
  platformTasks,
  recordingAssets,
} from '../db/schema.js';
import type {
  RecordingAccessAsset,
  RecordingAccessRepository,
} from './access-repository.js';

export class PostgresRecordingAccessRepository implements RecordingAccessRepository {
  constructor(private readonly db: Database) {}

  async find(recordingId: string): Promise<RecordingAccessAsset | null> {
    const [row] = await this.db
      .select({
        id: recordingAssets.id,
        taskId: callInstances.taskId,
        integrationClientId: platformTasks.integrationClientId,
        sourceSystem: platformTasks.sourceSystem,
        archiveStatus: recordingAssets.archiveStatus,
        bucket: recordingAssets.ossBucket,
        objectKey: recordingAssets.ossObjectKey,
        contentType: recordingAssets.contentType,
        sizeBytes: recordingAssets.sizeBytes,
        sha256: recordingAssets.sha256,
        retentionUntil: recordingAssets.retentionUntil,
        deletedAt: recordingAssets.deletedAt,
      })
      .from(recordingAssets)
      .innerJoin(
        callInstances,
        eq(callInstances.id, recordingAssets.callInstanceId),
      )
      .innerJoin(platformTasks, eq(platformTasks.id, callInstances.taskId))
      .where(eq(recordingAssets.id, recordingId))
      .limit(1);
    if (!row) return null;
    if (row.sourceSystem !== 'ERP' && row.sourceSystem !== 'CRM') {
      throw new Error(`录音 ${recordingId} 的来源系统无效`);
    }
    return { ...row, sourceSystem: row.sourceSystem };
  }

  async recordAudit(
    input: Parameters<RecordingAccessRepository['recordAudit']>[0],
  ): Promise<void> {
    await this.db.insert(auditLogs).values({
      requestId: input.requestId,
      actorId: input.actorId,
      action: input.action,
      objectType: 'RECORDING',
      objectId: input.recordingId,
      detail: input.detail,
      occurredAt: input.occurredAt,
    });
  }
}

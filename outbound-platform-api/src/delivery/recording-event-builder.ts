import { and, eq } from 'drizzle-orm';
import {
  recordingAvailableBatchEventSchema,
  type RecordingAvailableBatchEvent,
} from '@outbound/contracts';
import type { Database } from '../db/client.js';
import { callInstances, platformTasks, recordingAssets } from '../db/schema.js';
import type { RecordingAccess } from '../recording/access-service.js';
import { DeliveryMaterializationError } from './repository.js';
import type { RecordingArchivedForDelivery } from './internal-event.js';

export interface RecordingDeliveryEventBuilder {
  build(
    descriptor: RecordingArchivedForDelivery,
  ): Promise<RecordingAvailableBatchEvent>;
}

export class PostgresRecordingDeliveryEventBuilder implements RecordingDeliveryEventBuilder {
  constructor(
    private readonly db: Database,
    private readonly recordingAccess: RecordingAccess,
  ) {}

  async build(
    descriptor: RecordingArchivedForDelivery,
  ): Promise<RecordingAvailableBatchEvent> {
    const [row] = await this.db
      .select({
        recordingId: recordingAssets.id,
        kind: recordingAssets.kind,
        archiveStatus: recordingAssets.archiveStatus,
        contentType: recordingAssets.contentType,
        sizeBytes: recordingAssets.sizeBytes,
        sha256: recordingAssets.sha256,
        platformCallId: callInstances.id,
        baiyingCallInstanceId: callInstances.callInstanceId,
        taskId: platformTasks.id,
        taskNo: platformTasks.taskNo,
        sourceSystem: platformTasks.sourceSystem,
        integrationClientId: platformTasks.integrationClientId,
        mcCode: platformTasks.mcCodeSnapshot,
        baiyingCallJobId: platformTasks.baiyingCallJobId,
      })
      .from(recordingAssets)
      .innerJoin(
        callInstances,
        eq(callInstances.id, recordingAssets.callInstanceId),
      )
      .innerJoin(platformTasks, eq(platformTasks.id, callInstances.taskId))
      .where(
        and(
          eq(recordingAssets.id, descriptor.recordingId),
          eq(platformTasks.id, descriptor.taskId),
        ),
      )
      .limit(1);
    if (
      !row ||
      row.archiveStatus !== 'ARCHIVED' ||
      !row.contentType ||
      row.sizeBytes === null ||
      !row.sha256 ||
      !row.baiyingCallJobId ||
      (row.sourceSystem !== 'ERP' && row.sourceSystem !== 'CRM')
    ) {
      throw new DeliveryMaterializationError(
        `录音 ${descriptor.recordingId} 尚未具备可交付元数据`,
      );
    }
    const issued = await this.recordingAccess.issueIntegrationUrl(
      row.recordingId,
      {
        integrationClientId: row.integrationClientId,
        sourceSystem: row.sourceSystem,
      },
      `delivery-event:${descriptor.eventId}`,
    );
    return recordingAvailableBatchEventSchema.parse({
      schemaVersion: '1.0',
      eventId: descriptor.eventId,
      eventType: 'OUTBOUND_RECORDING_AVAILABLE_BATCH',
      occurredAt: descriptor.occurredAt,
      sourceSystem: row.sourceSystem,
      mcCode: row.mcCode,
      taskNo: row.taskNo,
      baiyingCallJobId: row.baiyingCallJobId,
      batchNo: descriptor.batchNo,
      isLastBatch: descriptor.isLastBatch,
      recordings: [
        {
          recordingId: row.recordingId,
          platformCallId: row.platformCallId,
          baiyingCallInstanceId: row.baiyingCallInstanceId,
          kind: row.kind,
          contentType: row.contentType,
          sizeBytes: Number(row.sizeBytes),
          sha256: row.sha256,
          downloadUrl: issued.downloadUrl,
          expiresAt: issued.expiresAt,
        },
      ],
    });
  }
}

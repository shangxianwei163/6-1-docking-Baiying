export type RecordingAccessAsset = {
  id: string;
  taskId: string;
  integrationClientId: string;
  sourceSystem: 'ERP' | 'CRM';
  archiveStatus:
    | 'PENDING'
    | 'DOWNLOADING'
    | 'ARCHIVED'
    | 'PARTIAL'
    | 'FAILED'
    | 'NOT_AVAILABLE';
  bucket: string | null;
  objectKey: string | null;
  contentType: string | null;
  sizeBytes: bigint | null;
  sha256: string | null;
  retentionUntil: Date | null;
  deletedAt: Date | null;
};

export interface RecordingAccessRepository {
  find(recordingId: string): Promise<RecordingAccessAsset | null>;
  recordAudit(input: {
    requestId: string;
    actorId: string;
    action: 'RECORDING_DOWNLOAD_URL_ISSUED' | 'RECORDING_DOWNLOAD_OPENED';
    recordingId: string;
    detail: Record<string, unknown>;
    occurredAt: Date;
  }): Promise<void>;
}

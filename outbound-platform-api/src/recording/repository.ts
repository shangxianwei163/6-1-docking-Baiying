export type ClaimedRecordingAsset = {
  id: string;
  callInstanceId: string;
  taskId: string;
  studioId: string;
  kind: 'FULL' | 'USER_ONLY';
  providerUrlCiphertext: string;
  downloadAttempts: number;
  discoveredAt: string;
};

export type RecordingArchiveFailureResult = {
  status: 'RETRY_SCHEDULED' | 'DEAD_LETTERED';
  attempts: number;
  availableAt: string | null;
};

export type ArchivedRecordingMetadata = {
  bucket: string;
  objectKey: string;
  contentType: string;
  sizeBytes: bigint;
  sha256: string;
  archivedAt: Date;
  retentionUntil: Date;
};

export class RecordingClaimLostError extends Error {}

export interface RecordingArchiveRepository {
  claimNext(input: {
    workerId: string;
    lockTimeoutSeconds?: number;
    recordingId?: string;
  }): Promise<ClaimedRecordingAsset | null>;
  complete(input: {
    recordingId: string;
    workerId: string;
    metadata: ArchivedRecordingMetadata;
  }): Promise<void>;
  fail(input: {
    recordingId: string;
    workerId: string;
    error: string;
    retryDelayMs: number;
    maxAttempts: number;
  }): Promise<RecordingArchiveFailureResult>;
}

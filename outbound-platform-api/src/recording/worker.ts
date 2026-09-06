import type { RecordingArchiver } from './archive-service.js';
import type { RecordingArchiveRepository } from './repository.js';

export type RecordingArchiveWorkerResult =
  | { status: 'IDLE' }
  | {
      status: 'ARCHIVED';
      recordingId: string;
      objectKey: string;
      sizeBytes: string;
      sha256: string;
    }
  | {
      status: 'RETRY_SCHEDULED' | 'DEAD_LETTERED';
      recordingId: string;
      attempts: number;
      availableAt: string | null;
      error: string;
    };

export class RecordingArchiveWorker {
  constructor(
    private readonly repository: RecordingArchiveRepository,
    private readonly archiveService: RecordingArchiver,
    private readonly options: {
      workerId: string;
      maxAttempts?: number;
      retryDelaysMs?: number[];
      lockTimeoutSeconds?: number;
      recordingId?: string;
    },
  ) {}

  async runOnce(): Promise<RecordingArchiveWorkerResult> {
    const recording = await this.repository.claimNext({
      workerId: this.options.workerId,
      lockTimeoutSeconds: this.options.lockTimeoutSeconds,
      recordingId: this.options.recordingId,
    });
    if (!recording) return { status: 'IDLE' };

    try {
      const metadata = await this.archiveService.archive(recording);
      await this.repository.complete({
        recordingId: recording.id,
        workerId: this.options.workerId,
        metadata,
      });
      return {
        status: 'ARCHIVED',
        recordingId: recording.id,
        objectKey: metadata.objectKey,
        sizeBytes: metadata.sizeBytes.toString(),
        sha256: metadata.sha256,
      };
    } catch (error) {
      const message = errorMessage(error);
      const retryDelays = this.options.retryDelaysMs ?? [
        5_000, 30_000, 120_000, 600_000, 1_800_000, 7_200_000,
      ];
      const failure = await this.repository.fail({
        recordingId: recording.id,
        workerId: this.options.workerId,
        error: message,
        retryDelayMs:
          retryDelays[
            Math.min(
              Math.max(recording.downloadAttempts - 1, 0),
              retryDelays.length - 1,
            )
          ] ?? 7_200_000,
        maxAttempts: this.options.maxAttempts ?? retryDelays.length + 1,
      });
      return {
        ...failure,
        recordingId: recording.id,
        error: message,
      };
    }
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return '录音归档失败';
}

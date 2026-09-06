import type { DataProtector } from '../security/data-protector.js';
import { verifyAudioBody } from './audio-validation.js';
import type { RecordingObjectStore } from './object-store.js';
import type {
  ArchivedRecordingMetadata,
  ClaimedRecordingAsset,
} from './repository.js';
import type { RecordingSource } from './source.js';

export interface RecordingArchiver {
  archive(recording: ClaimedRecordingAsset): Promise<ArchivedRecordingMetadata>;
}

export class RecordingArchiveService implements RecordingArchiver {
  constructor(
    private readonly protector: DataProtector,
    private readonly source: RecordingSource,
    private readonly objectStore: RecordingObjectStore,
    private readonly options: {
      bucket: string;
      maxBytes: number;
      retentionDays: number;
      clock?: () => Date;
    },
  ) {
    if (!Number.isInteger(options.retentionDays) || options.retentionDays < 1) {
      throw new TypeError('录音保存天数必须是正整数');
    }
  }

  async archive(
    recording: ClaimedRecordingAsset,
  ): Promise<ArchivedRecordingMetadata> {
    const providerUrl = this.protector.decryptUtf8(
      recording.providerUrlCiphertext,
    );
    const opened = await this.source.open(providerUrl);
    const verified = verifyAudioBody(opened.body, {
      declaredContentType: opened.contentType,
      declaredLength: opened.contentLength,
      maxBytes: this.options.maxBytes,
    });
    const objectKey = objectKeyFor(recording, opened.contentType);
    await this.objectStore.putObject({
      bucket: this.options.bucket,
      objectKey,
      body: verified.body,
    });
    const metadata = verified.metadata();
    const archivedAt = this.options.clock?.() ?? new Date();
    return {
      bucket: this.options.bucket,
      objectKey,
      ...metadata,
      archivedAt,
      retentionUntil: addUtcDays(archivedAt, this.options.retentionDays),
    };
  }
}

function objectKeyFor(
  recording: ClaimedRecordingAsset,
  contentType: string,
): string {
  const discovered = new Date(recording.discoveredAt);
  if (Number.isNaN(discovered.getTime())) {
    throw new Error('录音发现时间无效');
  }
  const year = discovered.getUTCFullYear().toString().padStart(4, '0');
  const month = (discovered.getUTCMonth() + 1).toString().padStart(2, '0');
  const name = recording.kind === 'FULL' ? 'full' : 'user';
  return [
    'recordings',
    recording.studioId,
    year,
    month,
    recording.taskId,
    recording.callInstanceId,
    `${name}.${extensionFor(contentType)}`,
  ].join('/');
}

function extensionFor(contentType: string): string {
  const normalized = contentType.split(';', 1)[0]?.trim().toLowerCase();
  if (normalized === 'audio/wav' || normalized === 'audio/x-wav') return 'wav';
  if (normalized === 'audio/ogg' || normalized === 'application/ogg') {
    return 'ogg';
  }
  if (normalized === 'audio/flac' || normalized === 'audio/x-flac') {
    return 'flac';
  }
  if (normalized === 'audio/mp4') return 'm4a';
  if (normalized === 'audio/aac') return 'aac';
  return 'mp3';
}

function addUtcDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 86_400_000);
}

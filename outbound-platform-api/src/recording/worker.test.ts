import { describe, expect, it, vi } from 'vitest';
import type { RecordingArchiver } from './archive-service.js';
import type { RecordingArchiveRepository } from './repository.js';
import { RecordingArchiveWorker } from './worker.js';

const claimed = {
  id: '6bdd828e-f2c7-46f3-b1ef-ae3a2c33dac5',
  callInstanceId: 'd71e25d7-46f5-43f2-b92f-10faeec6ae6b',
  taskId: '42036548-ef63-4b71-aa15-d1d109444a57',
  studioId: '92cf9954-a363-4495-b898-792fd3dd6204',
  kind: 'FULL' as const,
  providerUrlCiphertext: 'encrypted',
  downloadAttempts: 1,
  discoveredAt: '2026-09-06T10:00:00.000Z',
};

const metadata = {
  bucket: 'local-recordings',
  objectKey: 'recordings/studio/2026/09/task/call/full.mp3',
  contentType: 'audio/mpeg',
  sizeBytes: 42n,
  sha256: 'a'.repeat(64),
  archivedAt: new Date('2026-09-06T10:01:00.000Z'),
  retentionUntil: new Date('2027-03-05T10:01:00.000Z'),
};

describe('RecordingArchiveWorker', () => {
  it('archives and completes the claimed asset', async () => {
    const complete = vi.fn<RecordingArchiveRepository['complete']>();
    const archive = vi.fn<RecordingArchiver['archive']>(async () => metadata);
    const worker = new RecordingArchiveWorker(
      repository({ complete }),
      { archive },
      { workerId: 'recording-worker-1' },
    );

    await expect(worker.runOnce()).resolves.toEqual({
      status: 'ARCHIVED',
      recordingId: claimed.id,
      objectKey: metadata.objectKey,
      sizeBytes: '42',
      sha256: metadata.sha256,
    });
    expect(complete).toHaveBeenCalledWith({
      recordingId: claimed.id,
      workerId: 'recording-worker-1',
      metadata,
    });
  });

  it('uses bounded retry and never includes the provider URL in its result', async () => {
    const fail = vi.fn<RecordingArchiveRepository['fail']>(async () => ({
      status: 'RETRY_SCHEDULED',
      attempts: 1,
      availableAt: '2026-09-06T10:00:05.000Z',
    }));
    const worker = new RecordingArchiveWorker(
      repository({ fail }),
      {
        archive: async () => {
          throw new Error('temporary source error');
        },
      },
      {
        workerId: 'recording-worker-2',
        retryDelaysMs: [5_000],
        maxAttempts: 2,
      },
    );

    const result = await worker.runOnce();

    expect(result).toMatchObject({
      status: 'RETRY_SCHEDULED',
      recordingId: claimed.id,
      attempts: 1,
    });
    expect(JSON.stringify(result)).not.toContain('https://');
    expect(fail).toHaveBeenCalledWith(
      expect.objectContaining({ retryDelayMs: 5_000, maxAttempts: 2 }),
    );
  });
});

function repository(
  overrides: Partial<RecordingArchiveRepository>,
): RecordingArchiveRepository {
  return {
    claimNext: vi.fn(async () => claimed),
    complete: vi.fn(),
    fail: vi.fn(),
    ...overrides,
  };
}

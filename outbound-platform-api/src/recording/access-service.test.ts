/// <reference types="node" />

import { describe, expect, it, vi } from 'vitest';
import type { RecordingAccessRepository } from './access-repository.js';
import { RecordingAccessService } from './access-service.js';
import type { RecordingObjectReader } from './object-store.js';
import { LocalRecordingUrlSigner } from './url-signer.js';

const recordingId = '92cbd92c-9caa-4e3c-8b40-1d4ee5504900';
const bytes = Buffer.from('ID3archived-recording', 'binary');
const archivedAsset = {
  id: recordingId,
  taskId: 'e922c7ea-f655-4340-bd59-1c25c05840ed',
  archiveStatus: 'ARCHIVED' as const,
  bucket: 'local-recordings',
  objectKey: 'recordings/studio/2026/09/task/call/full.mp3',
  contentType: 'audio/mpeg',
  sizeBytes: BigInt(bytes.byteLength),
  sha256: 'b'.repeat(64),
  retentionUntil: new Date('2027-03-05T12:00:00.000Z'),
  deletedAt: null,
};

describe('RecordingAccessService', () => {
  it('issues an audience-bound URL and opens the archived object', async () => {
    const recordAudit = vi.fn<RecordingAccessRepository['recordAudit']>();
    const repository = repositoryWith({ recordAudit });
    const service = serviceWith(repository);

    const issued = await service.issueOperatorUrl(
      recordingId,
      'platform-admin',
      'request-issue',
    );
    const url = new URL(issued.downloadUrl);
    const opened = await service.openSignedUrl(recordingId, {
      audience: url.searchParams.get('aud')!,
      expiresAtEpochSeconds: Number(url.searchParams.get('exp')),
      signature: url.searchParams.get('sig')!,
      requestId: 'request-open',
    });

    expect(url.origin).toBe('http://127.0.0.1:8788');
    expect(url.pathname).toBe(`/api/v1/recordings/${recordingId}/content`);
    expect(url.toString()).not.toContain('platform-admin');
    expect(issued.expiresAt).toBe('2026-09-06T12:15:00.000Z');
    expect(opened).toMatchObject({
      contentType: 'audio/mpeg',
      sizeBytes: BigInt(bytes.byteLength),
      sha256: archivedAsset.sha256,
    });
    await expect(collect(opened.body)).resolves.toEqual(bytes);
    expect(recordAudit).toHaveBeenCalledTimes(2);
    expect(recordAudit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        actorId: 'platform-admin',
        action: 'RECORDING_DOWNLOAD_URL_ISSUED',
      }),
    );
    expect(recordAudit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ action: 'RECORDING_DOWNLOAD_OPENED' }),
    );
  });

  it('rejects tampering, expiry, unarchived assets, and object drift', async () => {
    let now = new Date('2026-09-06T12:00:00.000Z');
    const repository = repositoryWith();
    const service = serviceWith(repository, () => now);
    const issued = await service.issueOperatorUrl(
      recordingId,
      'platform-admin',
      'request-issue',
    );
    const url = new URL(issued.downloadUrl);
    const input = {
      audience: url.searchParams.get('aud')!,
      expiresAtEpochSeconds: Number(url.searchParams.get('exp')),
      signature: url.searchParams.get('sig')!,
      requestId: 'request-open',
    };
    const tamperedSignature = `${input.signature[0] === '0' ? '1' : '0'}${input.signature.slice(1)}`;
    await expect(
      service.openSignedUrl(recordingId, {
        ...input,
        signature: tamperedSignature,
      }),
    ).rejects.toMatchObject({ code: 'RECORDING_URL_INVALID' });

    now = new Date('2026-09-06T12:15:01.000Z');
    await expect(
      service.openSignedUrl(recordingId, input),
    ).rejects.toMatchObject({ code: 'RECORDING_URL_INVALID' });

    const pending = serviceWith(
      repositoryWith({
        find: vi.fn(async () => ({
          ...archivedAsset,
          archiveStatus: 'PENDING' as const,
        })),
      }),
    );
    await expect(
      pending.issueOperatorUrl(recordingId, 'platform-admin', 'request'),
    ).rejects.toMatchObject({ code: 'RECORDING_NOT_ARCHIVED' });

    const drift = serviceWith(repositoryWith(), undefined, {
      openObject: vi.fn(async () => ({
        body: chunks(bytes),
        sizeBytes: BigInt(bytes.byteLength + 1),
      })),
    });
    const driftUrl = new URL(
      (await drift.issueOperatorUrl(recordingId, 'platform-admin', 'request'))
        .downloadUrl,
    );
    await expect(
      drift.openSignedUrl(recordingId, {
        audience: driftUrl.searchParams.get('aud')!,
        expiresAtEpochSeconds: Number(driftUrl.searchParams.get('exp')),
        signature: driftUrl.searchParams.get('sig')!,
        requestId: 'request-open',
      }),
    ).rejects.toMatchObject({ code: 'RECORDING_OBJECT_UNAVAILABLE' });
  });

  it('allows loopback HTTP only outside production', () => {
    expect(() => serviceWith(repositoryWith())).not.toThrow();
    expect(
      () =>
        new RecordingAccessService(
          repositoryWith(),
          objectReader(),
          new LocalRecordingUrlSigner(
            'test-secret-long-enough-for-signing',
            'test',
          ),
          {
            publicBaseUrl: 'http://192.168.1.10:8788',
            environment: 'test',
          },
        ),
    ).toThrow('HTTPS');
    expect(
      () =>
        new RecordingAccessService(
          repositoryWith(),
          objectReader(),
          new LocalRecordingUrlSigner(
            'test-secret-long-enough-for-signing',
            'test',
          ),
          {
            publicBaseUrl: 'http://127.0.0.1:8788',
            environment: 'production',
          },
        ),
    ).toThrow('HTTPS');
  });
});

function serviceWith(
  repository: RecordingAccessRepository,
  clock: (() => Date) | undefined = () => new Date('2026-09-06T12:00:00.000Z'),
  reader: RecordingObjectReader = objectReader(),
) {
  return new RecordingAccessService(
    repository,
    reader,
    new LocalRecordingUrlSigner('test-secret-long-enough-for-signing', 'test'),
    {
      publicBaseUrl: 'http://127.0.0.1:8788',
      ttlSeconds: 900,
      environment: 'test',
      clock,
    },
  );
}

function repositoryWith(
  overrides: Partial<RecordingAccessRepository> = {},
): RecordingAccessRepository {
  return {
    find: vi.fn(async () => archivedAsset),
    recordAudit: vi.fn(),
    ...overrides,
  };
}

function objectReader(): RecordingObjectReader {
  return {
    openObject: vi.fn(async () => ({
      body: chunks(bytes),
      sizeBytes: BigInt(bytes.byteLength),
    })),
  };
}

async function* chunks(value: Uint8Array) {
  yield value;
}

async function collect(body: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const values: Uint8Array[] = [];
  for await (const chunk of body) values.push(chunk);
  return Buffer.concat(values);
}

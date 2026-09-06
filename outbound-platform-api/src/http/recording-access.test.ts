/// <reference types="node" />

import { describe, expect, it, vi } from 'vitest';
import type { MappingRepository } from '../mapping/repository.js';
import {
  RecordingAccessFailure,
  type RecordingAccess,
} from '../recording/access-service.js';
import { createApp } from './app.js';

const recordingId = '92cbd92c-9caa-4e3c-8b40-1d4ee5504900';
const audience = 'a'.repeat(64);
const signature = 'b'.repeat(64);
const bytes = Buffer.from('ID3download');

describe('operator recording access HTTP API', () => {
  it('requires an operator to issue a URL and serves only a valid signed URL', async () => {
    const issueOperatorUrl = vi.fn<RecordingAccess['issueOperatorUrl']>(
      async () => ({
        recordingId,
        downloadUrl: `http://127.0.0.1:8788/api/v1/recordings/${recordingId}/content?exp=1788696900&aud=${audience}&sig=${signature}`,
        expiresAt: '2026-09-06T12:15:00.000Z',
        sha256: 'c'.repeat(64),
      }),
    );
    const openSignedUrl = vi.fn<RecordingAccess['openSignedUrl']>(async () => ({
      body: chunks(bytes),
      contentType: 'audio/mpeg',
      sizeBytes: BigInt(bytes.byteLength),
      sha256: 'c'.repeat(64),
    }));
    const app = appWith({ issueOperatorUrl, openSignedUrl });

    const unauthorized = await app.request(
      `/api/v1/recordings/${recordingId}/download-url`,
      { method: 'POST' },
    );
    expect(unauthorized.status).toBe(401);

    const issued = await app.request(
      `/api/v1/recordings/${recordingId}/download-url`,
      { method: 'POST', headers: { 'x-actor-id': 'platform-admin' } },
    );
    expect(issued.status).toBe(200);
    await expect(issued.json()).resolves.toMatchObject({
      data: { recordingId, sha256: 'c'.repeat(64) },
    });
    expect(issueOperatorUrl).toHaveBeenCalledWith(
      recordingId,
      'platform-admin',
      'request-recording-001',
    );

    const content = await app.request(
      `/api/v1/recordings/${recordingId}/content?exp=1788696900&aud=${audience}&sig=${signature}`,
    );
    expect(content.status).toBe(200);
    expect(content.headers.get('content-type')).toBe('audio/mpeg');
    expect(content.headers.get('content-length')).toBe(
      bytes.byteLength.toString(),
    );
    expect(content.headers.get('x-recording-sha256')).toBe('c'.repeat(64));
    await expect(content.arrayBuffer()).resolves.toEqual(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    expect(openSignedUrl).toHaveBeenCalledWith(recordingId, {
      audience,
      expiresAtEpochSeconds: 1_788_696_900,
      signature,
      requestId: 'request-recording-001',
    });
  });

  it('returns a stable operator error for invalid or unavailable recordings', async () => {
    const app = appWith({
      issueOperatorUrl: vi.fn(async () => {
        throw new RecordingAccessFailure(
          'RECORDING_NOT_ARCHIVED',
          '录音尚未完成归档',
          409,
        );
      }),
      openSignedUrl: vi.fn(),
    });
    const response = await app.request(
      `/api/v1/recordings/${recordingId}/download-url`,
      { method: 'POST', headers: { 'x-actor-id': 'platform-admin' } },
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'RECORDING_NOT_ARCHIVED',
        message: '录音尚未完成归档',
        requestId: 'request-recording-001',
      },
    });
  });
});

function appWith(recordingAccessService: RecordingAccess) {
  return createApp({
    mappingRepository: {} as MappingRepository,
    recordingAccessService,
    consoleOrigin: 'http://localhost:4173',
    workerSharedSecret: 'test-worker-secret-at-least-24',
    createId: () => 'request-recording-001',
  });
}

async function* chunks(value: Uint8Array) {
  yield value;
}

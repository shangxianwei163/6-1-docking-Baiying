/// <reference types="node" />

import type { IncomingHttpHeaders } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import {
  assertPublicAddresses,
  RecordingSourceSecurityError,
  SecureHttpRecordingSource,
  type RecordingHttpResponse,
  type RecordingHttpTransport,
} from './safe-http-source.js';

describe('SecureHttpRecordingSource', () => {
  it('pins a public DNS result and exposes the final successful stream', async () => {
    const request = vi.fn<RecordingHttpTransport['request']>(async () =>
      response(200, { 'content-type': 'audio/mpeg', 'content-length': '3' }),
    );
    const resolver = vi.fn(async () => [
      { address: '8.8.8.8', family: 4 as const },
    ]);
    const source = new SecureHttpRecordingSource(['audio.example.com'], {
      resolver,
      transport: { request },
    });

    const opened = await source.open(
      'https://audio.example.com/file.mp3?token=secret',
    );

    expect(opened.contentType).toBe('audio/mpeg');
    expect(opened.contentLength).toBe(3);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: 'audio.example.com' }),
      { address: '8.8.8.8', family: 4 },
      120_000,
    );
  });

  it('revalidates every redirect and rejects an allowed host resolving privately', async () => {
    const discarded = vi.fn();
    const request = vi.fn<RecordingHttpTransport['request']>(async () =>
      response(
        302,
        { location: 'https://cdn.example.com/private.mp3' },
        discarded,
      ),
    );
    const source = new SecureHttpRecordingSource(
      ['audio.example.com', 'cdn.example.com'],
      {
        resolver: async (hostname) => [
          {
            address: hostname === 'cdn.example.com' ? '127.0.0.1' : '8.8.8.8',
            family: 4,
          },
        ],
        transport: { request },
      },
    );

    await expect(
      source.open('https://audio.example.com/file.mp3'),
    ).rejects.toThrow('禁止访问的网络地址');
    expect(discarded).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledOnce();
  });

  it.each([
    'http://audio.example.com/file.mp3',
    'https://user:pass@audio.example.com/file.mp3',
    'https://audio.example.com:8443/file.mp3',
    'https://127.0.0.1/file.mp3',
    'https://not-allowed.example.com/file.mp3',
  ])('rejects unsafe URL %s before making a request', async (url) => {
    const request = vi.fn<RecordingHttpTransport['request']>();
    const source = new SecureHttpRecordingSource(['audio.example.com'], {
      resolver: async () => [{ address: '8.8.8.8', family: 4 }],
      transport: { request },
    });
    await expect(source.open(url)).rejects.toBeInstanceOf(
      RecordingSourceSecurityError,
    );
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects private, link-local, metadata, mapped IPv4, and multicast IPs', () => {
    for (const address of [
      { address: '10.0.0.1', family: 4 as const },
      { address: '169.254.169.254', family: 4 as const },
      { address: '224.0.0.1', family: 4 as const },
      { address: '::1', family: 6 as const },
      { address: '::ffff:127.0.0.1', family: 6 as const },
      { address: 'fe80::1', family: 6 as const },
    ]) {
      expect(() => assertPublicAddresses([address])).toThrow(
        RecordingSourceSecurityError,
      );
    }
    expect(() =>
      assertPublicAddresses([{ address: '2606:4700:4700::1111', family: 6 }]),
    ).not.toThrow();
  });
});

function response(
  status: number,
  headers: IncomingHttpHeaders,
  discard = vi.fn(),
): RecordingHttpResponse {
  return {
    status,
    headers,
    body: (async function* () {
      yield Buffer.from('ID3');
    })(),
    discard,
  };
}

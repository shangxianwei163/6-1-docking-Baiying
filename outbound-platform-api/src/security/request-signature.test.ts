import { describe, expect, it } from 'vitest';
import {
  canonicalRequest,
  canonicalTarget,
  signRequest,
  verifyRequestSignature,
} from './request-signature.js';

const secret = new TextEncoder().encode('01234567890123456789012345678901');
const base = {
  method: 'post',
  timestamp: '1788624000000',
  nonce: 'nonce-1234567890',
  rawBody: new TextEncoder().encode('{"hello":"world"}'),
};

describe('external request signatures', () => {
  it('sorts duplicate query pairs with RFC 3986 encoding', () => {
    expect(canonicalTarget('https://example.test/a?z=2&a=空 格&z=1')).toBe(
      '/a?a=%E7%A9%BA%20%E6%A0%BC&z=1&z=2',
    );
  });

  it('builds and verifies the canonical HMAC request', () => {
    const input = {
      ...base,
      url: 'https://example.test/openapi/v1/tasks?b=2&a=1',
    };
    expect(canonicalRequest(input).split('\n')).toHaveLength(5);
    const signature = signRequest(input, secret);
    expect(verifyRequestSignature(input, secret, signature)).toBe(true);
    expect(
      verifyRequestSignature(
        { ...input, rawBody: new TextEncoder().encode('{"hello":"changed"}') },
        secret,
        signature,
      ),
    ).toBe(false);
    expect(verifyRequestSignature(input, secret, 'not-base64')).toBe(false);
  });
});

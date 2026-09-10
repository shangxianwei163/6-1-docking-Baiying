import { createHmac, timingSafeEqual } from 'node:crypto';
import { sha256Hex } from '../security/sha256.js';

export type CallbackSignatureInput = {
  url: string | URL;
  timestamp: string;
  eventId: string;
  rawBody: Uint8Array;
};

export function callbackPath(value: string | URL): string {
  const url = value instanceof URL ? value : new URL(value);
  return url.pathname || '/';
}

export function canonicalCallbackRequest(
  input: CallbackSignatureInput,
): string {
  return [
    'POST',
    callbackPath(input.url),
    input.timestamp,
    input.eventId,
    sha256Hex(input.rawBody),
  ].join('\n');
}

export function signCallbackRequest(
  input: CallbackSignatureInput,
  secret: Uint8Array,
): string {
  return createHmac('sha256', secret)
    .update(canonicalCallbackRequest(input), 'utf8')
    .digest('base64');
}

export function verifyCallbackRequestSignature(
  input: CallbackSignatureInput,
  secret: Uint8Array,
  provided: string,
): boolean {
  const actual = decodeCanonicalBase64(provided);
  if (!actual) return false;
  const expected = Buffer.from(signCallbackRequest(input, secret), 'base64');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function decodeCanonicalBase64(value: string): Buffer | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    return null;
  }
  const decoded = Buffer.from(value, 'base64');
  return decoded.toString('base64') === value ? decoded : null;
}

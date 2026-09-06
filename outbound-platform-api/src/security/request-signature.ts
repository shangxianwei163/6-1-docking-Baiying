import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export type SignatureInput = {
  method: string;
  url: string | URL;
  timestamp: string;
  nonce: string;
  rawBody: Uint8Array;
};

export function sha256Hex(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function canonicalTarget(value: string | URL): string {
  const url = value instanceof URL ? value : new URL(value);
  const pairs = Array.from(url.searchParams.entries()).map(
    ([key, item]) => [rfc3986Encode(key), rfc3986Encode(item)] as const,
  );
  pairs.sort(
    ([leftKey, leftValue], [rightKey, rightValue]) =>
      compareCodeUnits(leftKey, rightKey) ||
      compareCodeUnits(leftValue, rightValue),
  );
  const query = pairs.map(([key, item]) => `${key}=${item}`).join('&');
  return `${url.pathname || '/'}${query ? `?${query}` : ''}`;
}

export function canonicalRequest(input: SignatureInput): string {
  return [
    input.method.toUpperCase(),
    canonicalTarget(input.url),
    input.timestamp,
    input.nonce,
    sha256Hex(input.rawBody),
  ].join('\n');
}

export function signRequest(input: SignatureInput, secret: Uint8Array): string {
  return createHmac('sha256', secret)
    .update(canonicalRequest(input), 'utf8')
    .digest('base64');
}

export function verifyRequestSignature(
  input: SignatureInput,
  secret: Uint8Array,
  provided: string,
): boolean {
  const expected = Buffer.from(signRequest(input, secret), 'base64');
  const actual = decodeCanonicalBase64(provided);
  return (
    actual !== null &&
    actual.length === expected.length &&
    timingSafeEqual(actual, expected)
  );
}

function decodeCanonicalBase64(value: string): Buffer | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    return null;
  }
  const decoded = Buffer.from(value, 'base64');
  return decoded.toString('base64') === value ? decoded : null;
}

function rfc3986Encode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function compareCodeUnits(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

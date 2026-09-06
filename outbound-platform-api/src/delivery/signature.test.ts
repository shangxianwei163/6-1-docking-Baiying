import { describe, expect, it } from 'vitest';
import {
  canonicalCallbackRequest,
  signCallbackRequest,
  verifyCallbackRequestSignature,
} from './signature.js';

const input = {
  url: 'https://erp.example.com/hooks/outbound?unsigned=query',
  timestamp: '1788661800000',
  eventId: '11111111-1111-4111-8111-111111111113',
  rawBody: Buffer.from('{"eventId":"11111111-1111-4111-8111-111111111113"}'),
};
const secret = Buffer.from('stage5b-callback-secret');

describe('outbound callback signature', () => {
  it('matches the documented POST/path/timestamp/event/body-hash canonical form', () => {
    expect(canonicalCallbackRequest(input)).toBe(
      [
        'POST',
        '/hooks/outbound',
        '1788661800000',
        '11111111-1111-4111-8111-111111111113',
        '8f41997ba5f5ea47981f08fbcfe0c83adf69a2a5d2b14c15b881dbd697490adb',
      ].join('\n'),
    );
  });

  it('verifies only an exact canonical Base64 HMAC', () => {
    const signature = signCallbackRequest(input, secret);
    expect(verifyCallbackRequestSignature(input, secret, signature)).toBe(true);
    expect(
      verifyCallbackRequestSignature(
        { ...input, eventId: '22222222-2222-4222-8222-222222222222' },
        secret,
        signature,
      ),
    ).toBe(false);
    expect(verifyCallbackRequestSignature(input, secret, 'not-base64')).toBe(
      false,
    );
  });
});

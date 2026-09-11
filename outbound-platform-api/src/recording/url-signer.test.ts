import { describe, expect, it } from 'vitest';
import {
  LocalRecordingUrlSigner,
  createRuntimeRecordingUrlSigner,
} from './url-signer.js';

describe('recording URL signer runtime compatibility', () => {
  it('keeps production audiences and signatures compatible with existing URLs', () => {
    const secret = 'test-root-secret-with-at-least-24-characters';
    const legacy = new LocalRecordingUrlSigner(secret, 'test');
    const production = createRuntimeRecordingUrlSigner(secret, 'production');
    const input = {
      recordingId: '7c7d97ad-613f-4ea8-b364-9d35357a0663',
      audience: legacy.audienceToken('INTEGRATION_CLIENT', 'erp-client'),
      expiresAtEpochSeconds: 1_800_000_000,
    };

    expect(production.audienceToken('INTEGRATION_CLIENT', 'erp-client')).toBe(
      input.audience,
    );
    expect(production.sign(input)).toBe(legacy.sign(input));
    expect(production.verify(input, legacy.sign(input))).toBe(true);
    expect(legacy.verify(input, production.sign(input))).toBe(true);
  });
});

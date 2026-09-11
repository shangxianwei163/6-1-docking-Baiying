import { describe, expect, it } from 'vitest';
import {
  LocalDataProtector,
  createRuntimeDataProtector,
} from './data-protector.js';

describe('local data protector', () => {
  const protector = new LocalDataProtector(
    'test-root-secret-with-at-least-24-characters',
    'test',
  );

  it('encrypts authenticated data and round-trips plaintext', () => {
    const first = protector.encryptUtf8('13800138000');
    const second = protector.encryptUtf8('13800138000');
    expect(first).not.toBe(second);
    expect(protector.decryptUtf8(first)).toBe('13800138000');
    expect(() => protector.decryptUtf8(`${first}x`)).toThrow();
  });

  it('creates deterministic, purpose-separated phone hashes', () => {
    expect(protector.phoneHmac('13800138000')).toBe(
      protector.phoneHmac('13800138000'),
    );
    expect(protector.phoneHmac('13800138000')).not.toBe(
      protector.phoneHmac('13800138001'),
    );
  });

  it('creates deterministic correlation signatures with a separate key', () => {
    expect(protector.correlationHmac('task\0item\0phone-hmac')).toBe(
      protector.correlationHmac('task\0item\0phone-hmac'),
    );
    expect(protector.correlationHmac('task\0item\0phone-hmac')).not.toBe(
      protector.correlationHmac('task\0other-item\0phone-hmac'),
    );
    expect(protector.correlationHmac('13800138000')).not.toBe(
      protector.phoneHmac('13800138000'),
    );
  });

  it('keeps production ciphertext and hashes compatible with existing data', () => {
    const production = createRuntimeDataProtector(
      'test-root-secret-with-at-least-24-characters',
      'production',
    );
    const legacyCiphertext = protector.encryptUtf8('13800138000');
    const productionCiphertext = production.encryptUtf8('13900139000');

    expect(production.decryptUtf8(legacyCiphertext)).toBe('13800138000');
    expect(protector.decryptUtf8(productionCiphertext)).toBe('13900139000');
    expect(production.phoneHmac('13800138000')).toBe(
      protector.phoneHmac('13800138000'),
    );
    expect(production.correlationHmac('task\0item\0phone-hmac')).toBe(
      protector.correlationHmac('task\0item\0phone-hmac'),
    );
  });
});

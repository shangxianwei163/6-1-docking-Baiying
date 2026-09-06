import { describe, expect, it } from 'vitest';
import { LocalDataProtector } from './data-protector.js';

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
});

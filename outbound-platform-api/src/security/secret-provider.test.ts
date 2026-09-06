import { describe, expect, it } from 'vitest';
import { LocalDevelopmentSecretProvider } from './secret-provider.js';

describe('local development secret provider', () => {
  it('derives stable, purpose-separated 256-bit keys', async () => {
    const provider = new LocalDevelopmentSecretProvider(
      'test-root-secret-with-at-least-24-characters',
      'test',
    );
    const first = await provider.getSecretBytes('local-hkdf://erp-local-01');
    const repeated = await provider.getSecretBytes('local-hkdf://erp-local-01');
    const other = await provider.getSecretBytes('local-hkdf://crm-local-01');
    expect(first).toHaveLength(32);
    expect(first.equals(repeated)).toBe(true);
    expect(first.equals(other)).toBe(false);
    await expect(provider.getSecretBytes('kms://production')).rejects.toThrow(
      '不受支持',
    );
  });

  it('cannot be constructed in production', () => {
    expect(
      () =>
        new LocalDevelopmentSecretProvider(
          'test-root-secret-with-at-least-24-characters',
          'production',
        ),
    ).toThrow('生产环境禁止');
  });
});

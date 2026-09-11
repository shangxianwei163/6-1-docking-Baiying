import { describe, expect, it } from 'vitest';
import { readConfig } from './config.js';

const base = {
  DATABASE_URL: 'postgres://example.invalid/database',
  WORKER_SHARED_SECRET: 'test-root-secret-with-at-least-24-characters',
};

describe('recording storage configuration', () => {
  it('keeps local storage as the development default', () => {
    expect(readConfig(base).RECORDING_STORAGE_DRIVER).toBe('local');
  });

  it('requires the complete ECS RAM Role OSS configuration', () => {
    expect(() =>
      readConfig({ ...base, RECORDING_STORAGE_DRIVER: 'oss' }),
    ).toThrow();

    const config = readConfig({
      ...base,
      NODE_ENV: 'production',
      RECORDING_STORAGE_DRIVER: 'oss',
      OSS_BUCKET: 'scheduling61',
      OSS_ENDPOINT: 'oss-cn-wulanchabu-internal.aliyuncs.com',
      OSS_REGION: 'oss-cn-wulanchabu',
      OSS_ECS_RAM_ROLE_NAME: 'SchedulingPaiyideOssRole',
    });
    expect(config.OSS_BUCKET).toBe('scheduling61');
    expect(config.OSS_ECS_RAM_ROLE_NAME).toBe('SchedulingPaiyideOssRole');
  });
});

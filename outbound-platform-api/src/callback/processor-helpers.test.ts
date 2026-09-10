import { describe, expect, it } from 'vitest';
import { buildCallItemCorrelationToken } from '../security/correlation-token.js';
import { LocalDataProtector } from '../security/data-protector.js';
import {
  legacyV1CollectProperties,
  maskPhoneForCallback,
  verifyCallItemCorrelationToken,
} from './processor.js';

describe('v2 callback correlation helpers', () => {
  const protector = new LocalDataProtector(
    'test-root-secret-with-at-least-24-characters',
    'test',
  );
  const taskId = '11111111-1111-4111-8111-111111111111';
  const itemId = '22222222-2222-4222-8222-222222222222';
  const phoneHmac = protector.phoneHmac('13500000001');

  it('keeps the legacy v1 merged result shape', () => {
    expect(
      legacyV1CollectProperties({
        importedProperties: { 导入变量: '原值' },
        collectProperties: { 预约门店: '湖滨店' },
        taskResults: [{ key: '意向等级', value: 'A' }],
      }),
    ).toEqual({
      导入变量: '原值',
      预约门店: '湖滨店',
      taskResult: [{ key: '意向等级', value: 'A' }],
    });
  });

  it('accepts only a signature bound to the exact task, item and phone', () => {
    const token = buildCallItemCorrelationToken(
      protector,
      taskId,
      itemId,
      phoneHmac,
    );
    expect(
      verifyCallItemCorrelationToken(
        protector,
        taskId,
        itemId,
        phoneHmac,
        token,
      ),
    ).toBe(true);
    expect(
      verifyCallItemCorrelationToken(
        protector,
        taskId,
        '33333333-3333-4333-8333-333333333333',
        phoneHmac,
        token,
      ),
    ).toBe(false);
    expect(
      verifyCallItemCorrelationToken(
        protector,
        taskId,
        itemId,
        protector.phoneHmac('19900000002'),
        token,
      ),
    ).toBe(false);
  });

  it('masks the middle of a normalized phone number', () => {
    expect(maskPhoneForCallback('+8613500000001')).toBe('135****0001');
  });
});

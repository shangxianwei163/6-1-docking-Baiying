import { describe, expect, it } from 'vitest';
import {
  buildCallJobName,
  isStrictImportSuccess,
  redactProviderPayload,
} from './service.js';
import { userFacingTaskFailureMessage } from './postgres-repository.js';
import { retryDelayForAttempt } from './worker.js';
import { LocalDataProtector } from '../security/data-protector.js';
import { buildCallItemCorrelationToken } from '../security/correlation-token.js';

describe('task orchestration helpers', () => {
  it('builds a stable provider name without duplicating the PT prefix', () => {
    const first = buildCallJobName(
      'PT-20260906-00025',
      '11111111-1111-4111-8111-111111111111',
    );
    const second = buildCallJobName(
      'PT-20260906-00025',
      '11111111-1111-4111-8111-111111111111',
    );
    expect(first).toMatch(/^PT-20260906-00025-[a-f0-9]{8}$/);
    expect(second).toBe(first);
  });

  it('binds a callback token to task, item and normalized phone hash', () => {
    const protector = new LocalDataProtector(
      'test-root-secret-with-at-least-24-characters',
      'test',
    );
    const token = buildCallItemCorrelationToken(
      protector,
      'task-1',
      'item-1',
      protector.phoneHmac('13800138000'),
    );
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(token).not.toBe(
      buildCallItemCorrelationToken(
        protector,
        'task-1',
        'item-2',
        protector.phoneHmac('13800138000'),
      ),
    );
  });

  it('accepts only an exact all-success import summary', () => {
    expect(
      isStrictImportSuccess(
        { total: 2, successNum: 2, placeFailNum: 0, repeatNum: 0 },
        2,
      ),
    ).toBe(true);
    expect(
      isStrictImportSuccess(
        { total: 2, successNum: 1, placeFailNum: 1, repeatNum: 0 },
        2,
      ),
    ).toBe(false);
    expect(
      isStrictImportSuccess(
        { total: 2, successNum: 2, placeFailNum: 0, repeatNum: 1 },
        2,
      ),
    ).toBe(false);
  });

  it('redacts secrets and customer data before operation persistence', () => {
    expect(
      redactProviderPayload({
        code: 200,
        accessToken: 'secret-token',
        data: {
          customerTelephone: '13800138000',
          customerName: '王女士',
          properties: { 顾问: '陈顾问' },
          callJobId: '123',
        },
      }),
    ).toEqual({
      code: 200,
      accessToken: '[REDACTED]',
      data: {
        customerTelephone: '[REDACTED]',
        customerName: '[REDACTED]',
        properties: '[REDACTED]',
        callJobId: '123',
      },
    });
  });

  it('uses the documented bounded retry schedule', () => {
    expect([1, 2, 3, 4, 5, 8].map(retryDelayForAttempt)).toEqual([
      5_000, 30_000, 120_000, 600_000, 1_800_000, 1_800_000,
    ]);
  });

  it('returns readable terminal guidance for every provider failure stage', () => {
    expect(
      userFacingTaskFailureMessage('BAIYING_CREATE', '接口返回 500'),
    ).toContain('外呼任务创建失败，任务流程已结束');
    expect(
      userFacingTaskFailureMessage('BAIYING_IMPORT', '号码格式不正确'),
    ).toContain('号码导入百应 AI 外呼任务失败，任务流程已结束');
    expect(
      userFacingTaskFailureMessage('BAIYING_START', '线路不可用'),
    ).toContain('外呼任务启动失败，任务流程已结束');
  });
});

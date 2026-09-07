import { describe, expect, it } from 'vitest';
import {
  buildPlatformTaskName,
  describeBaiyingJobStatus,
  displayStatusFor,
  shanghaiDate,
} from './service.js';

describe('outbound task helpers', () => {
  it('maps execution states to the stable external display states', () => {
    expect(displayStatusFor('ACCEPTED')).toBe('执行中');
    expect(displayStatusFor('CALLING')).toBe('呼叫中');
    expect(displayStatusFor('PAUSED')).toBe('呼叫中');
    expect(displayStatusFor('TERMINATED')).toBe('呼叫中');
    expect(displayStatusFor('CALL_COMPLETED')).toBe('执行中');
    expect(displayStatusFor('RECONCILING')).toBe('执行中');
    expect(displayStatusFor('COMPLETED')).toBe('执行中');
    expect(displayStatusFor('COMPLETED', 'SUCCEEDED', 'SUCCEEDED')).toBe(
      '执行完成',
    );
    expect(displayStatusFor('COMPLETED', 'SUCCEEDED', 'NOT_APPLICABLE')).toBe(
      '执行完成',
    );
    expect(displayStatusFor('IMPORT_FAILED')).toBe('执行失败');
  });

  it('describes the original Baiying job status without hiding new values', () => {
    expect(describeBaiyingJobStatus(null)).toBeNull();
    expect(describeBaiyingJobStatus(2)).toBe('已完成');
    expect(describeBaiyingJobStatus(9)).toBe('线路欠费');
    expect(describeBaiyingJobStatus(99)).toBe('未知状态（99）');
  });

  it('generates task dates in Asia/Shanghai', () => {
    expect(shanghaiDate(new Date('2026-09-05T16:30:00.000Z'))).toBe('20260906');
  });

  it('builds the task name from its real data category paths', () => {
    expect(buildPlatformTaskName('PT-20260907-00023', ['排挡-百天-SS1'])).toBe(
      '20260907排挡百天SS1-00023',
    );
    expect(
      buildPlatformTaskName('PT-20260907-00024', [
        '排挡/百天/SS1',
        '邀约-周岁-SS2',
        '排挡/百天/SS1',
      ]),
    ).toBe('20260907排挡百天SS1+邀约周岁SS2-00024');
  });
});

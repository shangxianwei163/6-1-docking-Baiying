import { describe, expect, it } from 'vitest';
import { displayStatusFor, shanghaiDate } from './service.js';

describe('outbound task helpers', () => {
  it('maps execution states to the stable external display states', () => {
    expect(displayStatusFor('ACCEPTED')).toBe('执行中');
    expect(displayStatusFor('CALLING')).toBe('呼叫中');
    expect(displayStatusFor('COMPLETED')).toBe('执行完成');
    expect(displayStatusFor('IMPORT_FAILED')).toBe('执行失败');
    expect(displayStatusFor('TERMINATED')).toBe('已终止');
  });

  it('generates task dates in Asia/Shanghai', () => {
    expect(shanghaiDate(new Date('2026-09-05T16:30:00.000Z'))).toBe('20260906');
  });
});

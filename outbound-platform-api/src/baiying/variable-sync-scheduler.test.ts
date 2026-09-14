import { describe, expect, it, vi } from 'vitest';
import { createVariableSyncScheduler } from './variable-sync-scheduler.js';

describe('createVariableSyncScheduler', () => {
  it('queues a system-owned synchronization with a stable timestamp', async () => {
    const enqueueIfDue = vi.fn(async () => true);
    const onQueued = vi.fn();
    const scheduler = createVariableSyncScheduler({
      intervalMs: 21_600_000,
      enqueueIfDue,
      clock: () => new Date('2026-09-14T06:00:00.000Z'),
      createId: () => '11111111-1111-4111-8111-111111111111',
      onQueued,
    });

    await expect(scheduler.enqueue('schedule')).resolves.toBe(true);
    expect(enqueueIfDue).toHaveBeenCalledWith({
      jobId: '11111111-1111-4111-8111-111111111111',
      requestedAt: '2026-09-14T06:00:00.000Z',
      requestedBy: 'system:variable-sync-scheduler',
      minimumIntervalMs: 21_600_000,
    });
    expect(onQueued).toHaveBeenCalledWith({
      trigger: 'schedule',
      jobId: '11111111-1111-4111-8111-111111111111',
    });
  });

  it('does not overlap two enqueue operations', async () => {
    let release: (() => void) | undefined;
    const enqueueIfDue = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          release = () => resolve(true);
        }),
    );
    const scheduler = createVariableSyncScheduler({
      intervalMs: 21_600_000,
      enqueueIfDue,
    });

    const first = scheduler.enqueue('startup');
    await expect(scheduler.enqueue('schedule')).resolves.toBe(false);
    release?.();
    await expect(first).resolves.toBe(true);
    expect(enqueueIfDue).toHaveBeenCalledTimes(1);
  });

  it('reports a recent synchronization as not queued', async () => {
    const scheduler = createVariableSyncScheduler({
      intervalMs: 21_600_000,
      enqueueIfDue: vi.fn(async () => false),
    });

    await expect(scheduler.enqueue('startup')).resolves.toBe(false);
  });
});

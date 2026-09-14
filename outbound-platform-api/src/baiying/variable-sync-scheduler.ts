import { randomUUID } from 'node:crypto';

type SyncTrigger = 'startup' | 'schedule';

type VariableSyncSchedulerOptions = {
  intervalMs: number;
  enqueueIfDue(input: {
    jobId: string;
    requestedAt: string;
    requestedBy: string;
    minimumIntervalMs: number;
  }): Promise<boolean>;
  clock?: () => Date;
  createId?: () => string;
  onQueued?: (input: { trigger: SyncTrigger; jobId: string }) => void;
  onError?: (input: { trigger: SyncTrigger; error: unknown }) => void;
};

export function createVariableSyncScheduler(
  options: VariableSyncSchedulerOptions,
) {
  const clock = options.clock ?? (() => new Date());
  const createId = options.createId ?? randomUUID;
  let timer: ReturnType<typeof setInterval> | undefined;
  let enqueueing = false;

  const enqueue = async (trigger: SyncTrigger) => {
    if (enqueueing) return false;
    enqueueing = true;
    const jobId = createId();
    try {
      const queued = await options.enqueueIfDue({
        jobId,
        requestedAt: clock().toISOString(),
        requestedBy: 'system:variable-sync-scheduler',
        minimumIntervalMs: options.intervalMs,
      });
      if (!queued) return false;
      options.onQueued?.({ trigger, jobId });
      return true;
    } catch (error) {
      options.onError?.({ trigger, error });
      return false;
    } finally {
      enqueueing = false;
    }
  };

  return {
    enqueue,
    start() {
      if (timer) return;
      void enqueue('startup');
      timer = setInterval(() => void enqueue('schedule'), options.intervalMs);
      timer.unref();
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = undefined;
    },
  };
}

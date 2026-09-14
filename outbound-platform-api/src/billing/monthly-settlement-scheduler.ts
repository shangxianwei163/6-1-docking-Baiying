import type { SupplierSettlementSummary } from '@outbound/contracts';
import type { AutomaticSupplierSettlementService } from './monthly-settlement-service.js';
import {
  currentShanghaiMonth,
  previousShanghaiMonth,
  settlementMonthWindow,
  supplierSettlementSchedule,
} from './supplier-settlement.js';

type SchedulerTrigger = 'startup' | 'schedule';

export type SupplierSettlementScheduleActions = {
  precloseMonth: string | null;
  finalizeMonth: string | null;
};

type SchedulerOptions = {
  intervalMs: number;
  retryIntervalMs: number;
  autoFinalizeDelayMinutes: number;
  service: AutomaticSupplierSettlementService;
  clock?: () => Date;
  onResult?: (input: {
    trigger: SchedulerTrigger;
    action: 'preclose' | 'finalize' | 'adjustment';
    month: string;
    summary?: SupplierSettlementSummary;
    adjustmentCreated?: boolean;
  }) => void;
  onError?: (input: {
    trigger: SchedulerTrigger;
    action: 'preclose' | 'finalize' | 'adjustment';
    month: string;
    error: unknown;
  }) => void;
};

export function resolveSupplierSettlementScheduleActions(
  now: Date,
  autoFinalizeDelayMinutes = 10,
): SupplierSettlementScheduleActions {
  const currentMonth = currentShanghaiMonth(now);
  const currentWindow = settlementMonthWindow(currentMonth);
  const currentSchedule = supplierSettlementSchedule(
    currentMonth,
    autoFinalizeDelayMinutes,
  );
  const previousMonth = previousShanghaiMonth(now);
  const previousSchedule = supplierSettlementSchedule(
    previousMonth,
    autoFinalizeDelayMinutes,
  );
  return {
    precloseMonth:
      now >= currentSchedule.precloseAt && now < currentWindow.end
        ? currentMonth
        : null,
    finalizeMonth: now >= previousSchedule.autoFinalizeAt ? previousMonth : null,
  };
}

export function createSupplierSettlementScheduler(options: SchedulerOptions) {
  const clock = options.clock ?? (() => new Date());
  const lastAttemptAt = new Map<string, number>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;

  const due = (key: string, now: Date) => {
    const previous = lastAttemptAt.get(key);
    return previous === undefined || now.getTime() - previous >= options.retryIntervalMs;
  };

  const execute = async (
    trigger: SchedulerTrigger,
    action: 'preclose' | 'finalize' | 'adjustment',
    month: string,
    work: () => Promise<SupplierSettlementSummary | boolean>,
  ) => {
    const key = `${action}:${month}`;
    const now = clock();
    if (!due(key, now)) return;
    lastAttemptAt.set(key, now.getTime());
    try {
      const result = await work();
      options.onResult?.({
        trigger,
        action,
        month,
        ...(typeof result === 'boolean'
          ? { adjustmentCreated: result }
          : { summary: result }),
      });
    } catch (error) {
      options.onError?.({ trigger, action, month, error });
    }
  };

  const run = async (trigger: SchedulerTrigger) => {
    if (running) return;
    running = true;
    try {
      const now = clock();
      const actions = resolveSupplierSettlementScheduleActions(
        now,
        options.autoFinalizeDelayMinutes,
      );
      if (actions.precloseMonth) {
        await execute(trigger, 'preclose', actions.precloseMonth, () =>
          options.service.preclose(actions.precloseMonth!),
        );
      }
      if (actions.finalizeMonth) {
        await execute(trigger, 'finalize', actions.finalizeMonth, () =>
          options.service.finalizeAutomatically(actions.finalizeMonth!),
        );
        await execute(trigger, 'adjustment', actions.finalizeMonth, () =>
          options.service.capturePostCloseAdjustment(actions.finalizeMonth!),
        );
      }
    } finally {
      running = false;
    }
  };

  return {
    run,
    start() {
      if (timer) return;
      void run('startup');
      timer = setInterval(() => void run('schedule'), options.intervalMs);
      timer.unref();
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = undefined;
    },
  };
}

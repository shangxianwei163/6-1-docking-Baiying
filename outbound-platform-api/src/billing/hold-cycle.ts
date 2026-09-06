import { and, count, desc, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { accountLedger } from '../db/schema.js';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * 一个任务在人工安全重试后可以重新激活同一冻结记录。释放流水因此按周期编号：
 * 首次沿用历史键，第二次起追加 :2、:3……；调用方必须已锁定 fund_hold。
 */
export async function nextTaskHoldReleaseBusinessKey(
  tx: Transaction,
  taskId: string,
): Promise<string> {
  const [row] = await tx
    .select({ total: count() })
    .from(accountLedger)
    .where(
      and(
        eq(accountLedger.taskId, taskId),
        eq(accountLedger.entryType, 'TASK_HOLD_RELEASE'),
      ),
    );
  const cycle = Number(row?.total ?? 0) + 1;
  return cycle === 1
    ? `TASK_HOLD_RELEASE:${taskId}`
    : `TASK_HOLD_RELEASE:${taskId}:${cycle}`;
}

export async function findLatestTaskHoldReleaseLedger(
  tx: Transaction,
  taskId: string,
) {
  const [row] = await tx
    .select()
    .from(accountLedger)
    .where(
      and(
        eq(accountLedger.taskId, taskId),
        eq(accountLedger.entryType, 'TASK_HOLD_RELEASE'),
      ),
    )
    .orderBy(desc(accountLedger.occurredAt), desc(accountLedger.id))
    .limit(1);
  return row;
}

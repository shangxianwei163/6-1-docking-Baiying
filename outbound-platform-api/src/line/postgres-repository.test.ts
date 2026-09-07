import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../db/client.js';
import { PostgresLineRepository } from './postgres-repository.js';

const sourceLine = {
  userPhoneId: 'LINE-NEW',
  phone: '0571-10000',
  phoneName: '当前线路',
  phoneType: 9,
  sceneType: 1,
  rateType: 0,
  localSellingRate: 0,
  nonlocalSellingRate: 0,
  lineAmount: 2,
  billPeriod: 60,
};

describe('PostgresLineRepository', () => {
  it('upserts the current snapshot without deleting lines referenced by history', async () => {
    const deleteRows = vi.fn(() => {
      throw new Error('line synchronization must never delete managed lines');
    });
    const markMissingWhere = vi.fn(async () => undefined);
    const updateSet = vi.fn(() => ({ where: markMissingWhere }));
    const upsert = vi.fn(async () => undefined);
    const insertValues = vi.fn(() => ({ onConflictDoUpdate: upsert }));
    const rows = [
      {
        ...sourceLine,
        isActive: true,
        syncedAt: new Date('2026-09-07T02:00:00.000Z'),
      },
      {
        ...sourceLine,
        userPhoneId: 'LINE-HISTORY',
        phoneName: '历史线路',
        isActive: false,
        syncedAt: new Date('2026-09-04T02:00:00.000Z'),
      },
    ];
    const transaction = vi.fn(async (run: (tx: unknown) => Promise<unknown>) =>
      run({
        execute: vi.fn(async () => undefined),
        delete: deleteRows,
        update: vi.fn(() => ({ set: updateSet })),
        insert: vi.fn(() => ({ values: insertValues })),
        select: vi.fn(() => ({
          from: vi.fn(() => ({ orderBy: vi.fn(async () => rows) })),
        })),
      }),
    );
    const repository = new PostgresLineRepository(
      { transaction } as unknown as Database,
      () => new Date('2026-09-07T02:00:00.000Z'),
    );

    const result = await repository.synchronizeManagedLines([
      sourceLine,
      { ...sourceLine },
    ]);

    expect(deleteRows).not.toHaveBeenCalled();
    expect(markMissingWhere).toHaveBeenCalledOnce();
    expect(insertValues).toHaveBeenCalledOnce();
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ target: expect.anything() }),
    );
    expect(result).toEqual([
      expect.objectContaining({
        userPhoneId: 'LINE-NEW',
        isActive: true,
        syncedAt: '2026-09-07T02:00:00.000Z',
      }),
      expect.objectContaining({
        userPhoneId: 'LINE-HISTORY',
        isActive: false,
        syncedAt: '2026-09-04T02:00:00.000Z',
      }),
    ]);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { ErpCategorySyncService } from './sync-service.js';

describe('ERP category sync service', () => {
  it('stores the complete normalized category and returns a sync summary', async () => {
    const listCategories = vi.fn(async () => [{
      externalId: '46',
      name: '邀约-百天-SS1',
      categoryPath: '邀约-百天-SS1',
      level: 3,
      parentId: null,
      active: true,
      fields: { id: 46, main_category: '邀约', sub_category: '百天', c_level: 'SS1' },
    }]);
    const syncSourceCategories = vi.fn(async () => []);
    const service = new ErpCategorySyncService(
      { listCategories },
      'erp-token',
      { syncSourceCategories },
      () => new Date('2026-09-04T08:00:00.000Z'),
    );

    await expect(service.sync()).resolves.toEqual({ sourceSystem: 'ERP', count: 1, syncedAt: '2026-09-04T08:00:00.000Z' });
    expect(listCategories).toHaveBeenCalledWith('erp-token');
    expect(syncSourceCategories).toHaveBeenCalledWith([expect.objectContaining({
      externalId: '46',
      name: '邀约-百天-SS1',
      fields: expect.objectContaining({ c_level: 'SS1' }),
    })]);
  });

  it('deduplicates concurrent sync requests', async () => {
    let resolveCategories!: (value: never[]) => void;
    const listCategories = vi.fn(() => new Promise<never[]>((resolve) => { resolveCategories = resolve; }));
    const service = new ErpCategorySyncService({ listCategories }, 'erp-token', { syncSourceCategories: vi.fn(async () => []) });

    const first = service.sync();
    const second = service.sync();
    resolveCategories([]);
    await expect(first).rejects.toThrow('已保留上次成功数据');
    await expect(second).rejects.toThrow('已保留上次成功数据');
    expect(listCategories).toHaveBeenCalledOnce();
  });
});

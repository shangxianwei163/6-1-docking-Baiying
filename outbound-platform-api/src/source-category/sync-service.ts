import type { PlannedTaskRepository } from '../planned-task/repository.js';
import type { ErpCategoryClient } from './client.js';

export type CategorySyncResult = {
  sourceSystem: 'ERP';
  count: number;
  syncedAt: string;
};

export interface CategorySyncService {
  sync(): Promise<CategorySyncResult>;
}

export class ErpCategorySyncService implements CategorySyncService {
  private inFlight: Promise<CategorySyncResult> | null = null;

  constructor(
    private readonly client: ErpCategoryClient,
    private readonly token: string,
    private readonly repository: Pick<PlannedTaskRepository, 'syncSourceCategories'>,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  sync(): Promise<CategorySyncResult> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.execute().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async execute(): Promise<CategorySyncResult> {
    const categories = await this.client.listCategories(this.token);
    if (!categories.length) throw new Error('素玄 ERP 分类接口未返回任何分类，已保留上次成功数据');
    const syncedAt = this.clock().toISOString();
    await this.repository.syncSourceCategories(categories.map((category) => ({
      sourceSystem: 'ERP' as const,
      externalId: category.externalId,
      name: category.name,
      categoryPath: category.categoryPath,
      level: category.level,
      parentId: category.parentId,
      active: category.active,
      fields: category.fields,
    })));
    return { sourceSystem: 'ERP', count: categories.length, syncedAt };
  }
}

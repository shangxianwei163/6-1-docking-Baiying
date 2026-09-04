import { and, asc, eq, inArray } from 'drizzle-orm';
import type { PlannedTaskBindingInput, SourceCategoryObservation, SourceSystem } from '@outbound/contracts';
import type { Database } from '../db/client.js';
import { auditLogs, plannedTaskCategoryBindings, sourceDataCategories } from '../db/schema.js';
import type { PlannedTaskCategoryBinding, PlannedTaskRepository, SourceDataCategory } from './repository.js';

export class PostgresPlannedTaskRepository implements PlannedTaskRepository {
  constructor(
    private readonly db: Database,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async listBindings(workflowIds: string[]): Promise<PlannedTaskCategoryBinding[]> {
    if (!workflowIds.length) return [];
    const rows = await this.db.select().from(plannedTaskCategoryBindings)
      .where(inArray(plannedTaskCategoryBindings.workflowId, workflowIds));
    return rows.map(toBinding);
  }

  async saveBinding(input: PlannedTaskBindingInput, actorId: string, requestId: string): Promise<PlannedTaskCategoryBinding> {
    const now = this.clock();
    const [row] = await this.db.transaction(async (tx) => {
      const rows = await tx.insert(plannedTaskCategoryBindings).values({
        ...input,
        updatedBy: actorId,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: plannedTaskCategoryBindings.workflowId,
        set: {
          sourceSystem: input.sourceSystem,
          sourceCategoryId: input.sourceCategoryId,
          categoryPath: input.categoryPath,
          updatedBy: actorId,
          updatedAt: now,
        },
      }).returning();
      await tx.insert(auditLogs).values({
        requestId,
        actorId,
        action: 'PLANNED_TASK_CATEGORY_BOUND',
        objectType: 'BAIYING_WORKFLOW',
        objectId: input.workflowId,
        detail: { sourceSystem: input.sourceSystem, sourceCategoryId: input.sourceCategoryId, categoryPath: input.categoryPath },
      });
      return rows;
    });
    return toBinding(row);
  }

  async listSourceCategories(sourceSystem?: SourceSystem): Promise<SourceDataCategory[]> {
    const query = this.db.select().from(sourceDataCategories);
    const rows = sourceSystem
      ? await query.where(and(eq(sourceDataCategories.sourceSystem, sourceSystem), eq(sourceDataCategories.active, true))).orderBy(asc(sourceDataCategories.categoryPath))
      : await query.where(eq(sourceDataCategories.active, true)).orderBy(asc(sourceDataCategories.sourceSystem), asc(sourceDataCategories.categoryPath));
    return rows.map(toCategory);
  }

  async syncSourceCategories(observations: SourceCategoryObservation[]): Promise<SourceDataCategory[]> {
    const now = this.clock();
    const rows = await this.db.transaction(async (tx) => {
      const synced = [];
      for (const observation of observations) {
        const [row] = await tx.insert(sourceDataCategories).values({ ...observation, syncedAt: now }).onConflictDoUpdate({
          target: [sourceDataCategories.sourceSystem, sourceDataCategories.externalId],
          set: { categoryPath: observation.categoryPath, active: observation.active, syncedAt: now },
        }).returning();
        synced.push(row);
      }
      return synced;
    });
    return rows.map(toCategory);
  }
}

function toBinding(row: typeof plannedTaskCategoryBindings.$inferSelect): PlannedTaskCategoryBinding {
  return { ...row, sourceSystem: row.sourceSystem as 'ERP' | 'CRM', updatedAt: row.updatedAt.toISOString() };
}

function toCategory(row: typeof sourceDataCategories.$inferSelect): SourceDataCategory {
  return { ...row, sourceSystem: row.sourceSystem as 'ERP' | 'CRM', syncedAt: row.syncedAt.toISOString() };
}

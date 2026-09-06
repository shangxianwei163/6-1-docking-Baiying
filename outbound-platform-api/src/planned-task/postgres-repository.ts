import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { PlannedTaskBindingInput, SourceCategoryObservation, SourceSystem } from '@outbound/contracts';
import type { Database } from '../db/client.js';
import { auditLogs, plannedTaskCategoryBindings, sourceDataCategories } from '../db/schema.js';
import type { PlannedTaskCategoryBinding, PlannedTaskRepository, SourceDataCategory } from './repository.js';

export class PostgresPlannedTaskRepository implements PlannedTaskRepository {
  constructor(
    private readonly db: Database,
    private readonly clock: () => Date = () => new Date(),
    private readonly preserveLocalFixtures = false,
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
    if (!observations.length) return [];
    const now = this.clock();
    const rows = await this.db.transaction(async (tx) => {
      const synced = [];
      const sourceSystems = [...new Set(observations.map((observation) => observation.sourceSystem))];
      for (const sourceSystem of sourceSystems) {
        const sourceObservations = observations.filter((observation) => observation.sourceSystem === sourceSystem);
        const staleCategoryCondition = this.preserveLocalFixtures
          ? and(
              eq(sourceDataCategories.sourceSystem, sourceSystem),
              sql`${sourceDataCategories.fields}->>'fixture' IS DISTINCT FROM 'STAGE2_LOCAL_MOCK'`,
            )
          : eq(sourceDataCategories.sourceSystem, sourceSystem);
        await tx
          .update(sourceDataCategories)
          .set({ active: false })
          .where(staleCategoryCondition);
        const sourceRows = await tx.insert(sourceDataCategories).values(sourceObservations.map((observation) => ({
          ...observation,
          name: observation.name ?? observation.categoryPath,
          level: observation.level ?? observation.categoryPath.split('-').length,
          parentId: observation.parentId ?? null,
          fields: observation.fields ?? {},
          syncedAt: now,
        }))).onConflictDoUpdate({
          target: [sourceDataCategories.sourceSystem, sourceDataCategories.externalId],
          set: {
            name: sql`excluded.name`,
            categoryPath: sql`excluded.category_path`,
            level: sql`excluded.level`,
            parentId: sql`excluded.parent_id`,
            active: sql`excluded.active`,
            fields: sql`excluded.fields_json`,
            syncedAt: now,
          },
        }).returning();
        synced.push(...sourceRows);
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

import { inArray } from 'drizzle-orm';
import type { ScriptBindingInput } from '@outbound/contracts';
import type { Database } from '../db/client.js';
import { auditLogs, baiyingRobotBindings } from '../db/schema.js';
import type { ScriptBinding, ScriptRepository } from './repository.js';

export class PostgresScriptRepository implements ScriptRepository {
  constructor(
    private readonly db: Database,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async listAllBindings(): Promise<ScriptBinding[]> {
    const rows = await this.db.select().from(baiyingRobotBindings);
    return rows.map(toBinding);
  }

  async listBindings(robotDefIds: string[]): Promise<ScriptBinding[]> {
    if (!robotDefIds.length) return [];
    const rows = await this.db.select().from(baiyingRobotBindings)
      .where(inArray(baiyingRobotBindings.robotDefId, robotDefIds));
    return rows.map(toBinding);
  }

  async saveBinding(input: ScriptBindingInput, actorId: string, requestId: string): Promise<ScriptBinding> {
    const now = this.clock();
    const primaryCategory = input.categories[0];
    const [row] = await this.db.transaction(async (tx) => {
      const rows = await tx.insert(baiyingRobotBindings).values({
        robotDefId: input.robotDefId,
        sourceSystem: input.sourceSystem,
        sourceCategoryId: primaryCategory.sourceCategoryId,
        categoryPath: primaryCategory.categoryPath,
        categories: input.categories,
        studioId: input.studioId,
        studioName: input.studioName,
        lineId: input.lineId,
        lineName: input.lineName,
        updatedBy: actorId,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: baiyingRobotBindings.robotDefId,
        set: {
          sourceSystem: input.sourceSystem,
          sourceCategoryId: primaryCategory.sourceCategoryId,
          categoryPath: primaryCategory.categoryPath,
          categories: input.categories,
          studioId: input.studioId,
          studioName: input.studioName,
          lineId: input.lineId,
          lineName: input.lineName,
          updatedBy: actorId,
          updatedAt: now,
        },
      }).returning();
      await tx.insert(auditLogs).values({
        requestId,
        actorId,
        action: 'BAIYING_SCRIPT_BINDING_SAVED',
        objectType: 'BAIYING_ROBOT',
        objectId: input.robotDefId,
        detail: {
          sourceSystem: input.sourceSystem,
          categoryCount: input.categories.length,
          sourceCategoryIds: input.categories.map((category) => category.sourceCategoryId),
          studioId: input.studioId,
          lineId: input.lineId,
        },
      });
      return rows;
    });
    return toBinding(row);
  }
}

function toBinding(row: typeof baiyingRobotBindings.$inferSelect): ScriptBinding {
  const categories = row.categories.length ? row.categories : [{ sourceCategoryId: row.sourceCategoryId, categoryPath: row.categoryPath }];
  return {
    robotDefId: row.robotDefId,
    sourceSystem: row.sourceSystem as 'ERP' | 'CRM',
    categories,
    studioId: row.studioId,
    studioName: row.studioName,
    lineId: row.lineId,
    lineName: row.lineName,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt.toISOString(),
  };
}

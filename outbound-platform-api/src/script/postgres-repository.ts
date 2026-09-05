import { and, eq, inArray, sql } from 'drizzle-orm';
import type { ScriptBindingInput } from '@outbound/contracts';
import type { Database } from '../db/client.js';
import {
  auditLogs,
  baiyingLineStudioBindings,
  baiyingPhoneLines,
  baiyingRobotBindings,
  scriptBindings,
  scriptCategoryBindings,
  sourceDataCategories,
  studios,
} from '../db/schema.js';
import {
  ScriptBindingConflictError,
  type ScriptBinding,
  type ScriptRepository,
} from './repository.js';

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
    const rows = await this.db
      .select()
      .from(baiyingRobotBindings)
      .where(inArray(baiyingRobotBindings.robotDefId, robotDefIds));
    return rows.map(toBinding);
  }

  async saveBinding(
    input: ScriptBindingInput,
    actorId: string,
    requestId: string,
  ): Promise<ScriptBinding> {
    const now = this.clock();
    const row = await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`script-binding:${input.robotDefId}`}, 0))`,
      );
      const [studio] = await tx
        .select({ id: studios.id, name: studios.name })
        .from(studios)
        .where(eq(studios.businessCode, input.studioId))
        .limit(1);
      if (!studio) {
        throw new ScriptBindingConflictError(
          `影楼业务编号 ${input.studioId} 尚未导入真实配置`,
        );
      }
      const [line] = await tx
        .select({
          userPhoneId: baiyingPhoneLines.userPhoneId,
          phone: baiyingPhoneLines.phone,
          phoneName: baiyingPhoneLines.phoneName,
        })
        .from(baiyingPhoneLines)
        .where(eq(baiyingPhoneLines.userPhoneId, input.lineId))
        .limit(1);
      if (!line) {
        throw new ScriptBindingConflictError(`线路 ${input.lineId} 尚未同步`);
      }
      const [lineStudioBinding] = await tx
        .select({ userPhoneId: baiyingLineStudioBindings.userPhoneId })
        .from(baiyingLineStudioBindings)
        .where(
          and(
            eq(baiyingLineStudioBindings.userPhoneId, input.lineId),
            eq(baiyingLineStudioBindings.studioId, input.studioId),
          ),
        )
        .limit(1);
      if (!lineStudioBinding) {
        throw new ScriptBindingConflictError(
          `线路 ${input.lineId} 尚未绑定影楼 ${input.studioId}`,
        );
      }

      const categoryIds = input.categories.map(
        (category) => category.sourceCategoryId,
      );
      if (new Set(categoryIds).size !== categoryIds.length) {
        throw new ScriptBindingConflictError('同一话术不能重复绑定同一分类');
      }
      const categoryRows = await tx
        .select({
          externalId: sourceDataCategories.externalId,
          categoryPath: sourceDataCategories.categoryPath,
        })
        .from(sourceDataCategories)
        .where(
          and(
            eq(sourceDataCategories.sourceSystem, input.sourceSystem),
            eq(sourceDataCategories.active, true),
            inArray(sourceDataCategories.externalId, categoryIds),
          ),
        );
      if (categoryRows.length !== categoryIds.length) {
        const availableIds = new Set(categoryRows.map((row) => row.externalId));
        const missingIds = categoryIds.filter((id) => !availableIds.has(id));
        throw new ScriptBindingConflictError(
          `分类尚未同步或已停用：${missingIds.join(', ')}`,
        );
      }
      const categoryById = new Map(
        categoryRows.map((category) => [category.externalId, category]),
      );
      const canonicalCategories = categoryIds.map((id) => ({
        sourceCategoryId: id,
        categoryPath: categoryById.get(id)!.categoryPath,
      }));
      const primaryCategory = canonicalCategories[0];

      const activeBindings = await tx
        .select({ id: scriptBindings.id })
        .from(scriptBindings)
        .where(
          and(
            eq(scriptBindings.robotDefId, input.robotDefId),
            eq(scriptBindings.status, 'ACTIVE'),
          ),
        );
      if (activeBindings.length) {
        const activeIds = activeBindings.map((binding) => binding.id);
        await tx
          .update(scriptCategoryBindings)
          .set({ active: false })
          .where(inArray(scriptCategoryBindings.scriptBindingId, activeIds));
        await tx
          .update(scriptBindings)
          .set({ status: 'RETIRED', retiredAt: now })
          .where(inArray(scriptBindings.id, activeIds));
      }

      const [versionRow] = await tx
        .select({
          current: sql<number>`coalesce(max(${scriptBindings.version}), 0)::int`,
        })
        .from(scriptBindings)
        .where(
          and(
            eq(scriptBindings.robotDefId, input.robotDefId),
            eq(scriptBindings.studioId, studio.id),
            eq(scriptBindings.sourceSystem, input.sourceSystem),
          ),
        );
      const [normalizedBinding] = await tx
        .insert(scriptBindings)
        .values({
          robotDefId: input.robotDefId,
          studioId: studio.id,
          sourceSystem: input.sourceSystem,
          userPhoneId: input.lineId,
          version: (versionRow?.current ?? 0) + 1,
          createdBy: actorId,
          createdAt: now,
        })
        .returning({ id: scriptBindings.id });
      await tx.insert(scriptCategoryBindings).values(
        canonicalCategories.map((category) => ({
          scriptBindingId: normalizedBinding.id,
          studioId: studio.id,
          sourceSystem: input.sourceSystem,
          sourceCategoryId: category.sourceCategoryId,
          categoryPath: category.categoryPath,
          createdAt: now,
        })),
      );

      const rows = await tx
        .insert(baiyingRobotBindings)
        .values({
          robotDefId: input.robotDefId,
          sourceSystem: input.sourceSystem,
          sourceCategoryId: primaryCategory.sourceCategoryId,
          categoryPath: primaryCategory.categoryPath,
          categories: canonicalCategories,
          studioId: input.studioId,
          studioName: studio.name,
          lineId: input.lineId,
          lineName: line.phoneName || line.phone,
          updatedBy: actorId,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: baiyingRobotBindings.robotDefId,
          set: {
            sourceSystem: input.sourceSystem,
            sourceCategoryId: primaryCategory.sourceCategoryId,
            categoryPath: primaryCategory.categoryPath,
            categories: canonicalCategories,
            studioId: input.studioId,
            studioName: studio.name,
            lineId: input.lineId,
            lineName: line.phoneName || line.phone,
            updatedBy: actorId,
            updatedAt: now,
          },
        })
        .returning();
      await tx.insert(auditLogs).values({
        requestId,
        actorId,
        action: 'BAIYING_SCRIPT_BINDING_SAVED',
        objectType: 'BAIYING_ROBOT',
        objectId: input.robotDefId,
        detail: {
          sourceSystem: input.sourceSystem,
          categoryCount: canonicalCategories.length,
          sourceCategoryIds: canonicalCategories.map(
            (category) => category.sourceCategoryId,
          ),
          studioId: input.studioId,
          lineId: input.lineId,
          normalizedBindingId: normalizedBinding.id,
          normalizedBindingVersion: (versionRow?.current ?? 0) + 1,
        },
      });
      return rows[0];
    });
    return toBinding(row);
  }
}

function toBinding(
  row: typeof baiyingRobotBindings.$inferSelect,
): ScriptBinding {
  const categories = row.categories.length
    ? row.categories
    : [
        {
          sourceCategoryId: row.sourceCategoryId,
          categoryPath: row.categoryPath,
        },
      ];
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

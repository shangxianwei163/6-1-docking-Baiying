import { eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { LineStudioBindingInput } from '@outbound/contracts';
import type { Database } from '../db/client.js';
import {
  auditLogs,
  baiyingLineStudioBindings,
  baiyingPhoneLines,
} from '../db/schema.js';
import {
  LineBindingConflictError,
  LineSyncFailure,
  type LineRepository,
  type LineStudioBinding,
  type ManagedLine,
} from './repository.js';

export class PostgresLineRepository implements LineRepository {
  constructor(
    private readonly db: Database,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async synchronizeManagedLines(
    lines: Omit<ManagedLine, 'isActive' | 'syncedAt'>[],
  ): Promise<ManagedLine[]> {
    const syncedAt = this.clock();
    const uniqueLines = [
      ...new Map(lines.map((line) => [line.userPhoneId, line])).values(),
    ];
    try {
      const rows = await this.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(190004, 1)`);

        if (uniqueLines.length) {
          await tx
            .update(baiyingPhoneLines)
            .set({ isActive: false })
            .where(
              notInArray(
                baiyingPhoneLines.userPhoneId,
                uniqueLines.map((line) => line.userPhoneId),
              ),
            );

          for (const line of uniqueLines) {
            await tx
              .insert(baiyingPhoneLines)
              .values({ ...line, isActive: true, syncedAt })
              .onConflictDoUpdate({
                target: baiyingPhoneLines.userPhoneId,
                set: { ...line, isActive: true, syncedAt },
              });
          }
        } else {
          await tx.update(baiyingPhoneLines).set({ isActive: false });
        }

        return tx
          .select()
          .from(baiyingPhoneLines)
          .orderBy(baiyingPhoneLines.userPhoneId);
      });
      return rows.map(toManagedLine);
    } catch (error) {
      if (isPostgresIntegrityError(error)) {
        throw new LineSyncFailure(
          'LINE_SYNC_CONFLICT',
          '线路同步与现有业务数据冲突，请联系管理员处理',
          { cause: error },
        );
      }
      throw error;
    }
  }

  async listManagedLines(): Promise<ManagedLine[]> {
    const rows = await this.db
      .select()
      .from(baiyingPhoneLines)
      .orderBy(baiyingPhoneLines.userPhoneId);
    return rows.map(toManagedLine);
  }

  async listBindings(userPhoneIds: string[]): Promise<LineStudioBinding[]> {
    if (!userPhoneIds.length) return [];
    const rows = await this.db
      .select()
      .from(baiyingLineStudioBindings)
      .where(inArray(baiyingLineStudioBindings.userPhoneId, userPhoneIds));
    return rows.map(toBinding);
  }

  async saveBindings(
    input: LineStudioBindingInput,
    actorId: string,
    requestId: string,
  ): Promise<LineStudioBinding[]> {
    const now = this.clock();
    const rows = await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(190004, 1)`);
      const [line] = await tx
        .select({ isActive: baiyingPhoneLines.isActive })
        .from(baiyingPhoneLines)
        .where(eq(baiyingPhoneLines.userPhoneId, input.userPhoneId))
        .limit(1);
      if (!line) {
        throw new LineBindingConflictError(
          `线路 ${input.userPhoneId} 尚未同步`,
        );
      }
      if (!line.isActive) {
        throw new LineBindingConflictError(
          `线路 ${input.userPhoneId} 已停用，不能新增或修改影楼绑定`,
        );
      }
      await tx
        .delete(baiyingLineStudioBindings)
        .where(eq(baiyingLineStudioBindings.userPhoneId, input.userPhoneId));
      const inserted = input.studios.length
        ? await tx
            .insert(baiyingLineStudioBindings)
            .values(
              input.studios.map((studio) => ({
                userPhoneId: input.userPhoneId,
                studioId: studio.studioId,
                studioName: studio.studioName,
                updatedBy: actorId,
                updatedAt: now,
              })),
            )
            .returning()
        : [];
      await tx.insert(auditLogs).values({
        requestId,
        actorId,
        action: 'BAIYING_LINE_STUDIOS_BOUND',
        objectType: 'BAIYING_PHONE_LINE',
        objectId: input.userPhoneId,
        detail: { studioIds: input.studios.map((studio) => studio.studioId) },
      });
      return inserted;
    });
    return rows.map(toBinding);
  }
}

function toBinding(
  row: typeof baiyingLineStudioBindings.$inferSelect,
): LineStudioBinding {
  return { ...row, updatedAt: row.updatedAt.toISOString() };
}

function toManagedLine(
  row: typeof baiyingPhoneLines.$inferSelect,
): ManagedLine {
  return { ...row, syncedAt: row.syncedAt.toISOString() };
}

function isPostgresIntegrityError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  const code = Reflect.get(error, 'code');
  return typeof code === 'string' && code.startsWith('23');
}

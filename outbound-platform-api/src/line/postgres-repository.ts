import { eq, inArray } from 'drizzle-orm';
import type { LineStudioBindingInput } from '@outbound/contracts';
import type { Database } from '../db/client.js';
import { auditLogs, baiyingLineStudioBindings, baiyingPhoneLines } from '../db/schema.js';
import type { LineRepository, LineStudioBinding, ManagedLine } from './repository.js';

export class PostgresLineRepository implements LineRepository {
  constructor(
    private readonly db: Database,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async replaceManagedLines(lines: Omit<ManagedLine, 'syncedAt'>[]): Promise<ManagedLine[]> {
    const syncedAt = this.clock();
    const rows = await this.db.transaction(async (tx) => {
      await tx.delete(baiyingPhoneLines);
      if (!lines.length) return [];
      return tx.insert(baiyingPhoneLines).values(lines.map((line) => ({ ...line, syncedAt }))).returning();
    });
    return rows.map(toManagedLine);
  }

  async listManagedLines(): Promise<ManagedLine[]> {
    const rows = await this.db.select().from(baiyingPhoneLines).orderBy(baiyingPhoneLines.userPhoneId);
    return rows.map(toManagedLine);
  }

  async listBindings(userPhoneIds: string[]): Promise<LineStudioBinding[]> {
    if (!userPhoneIds.length) return [];
    const rows = await this.db.select().from(baiyingLineStudioBindings)
      .where(inArray(baiyingLineStudioBindings.userPhoneId, userPhoneIds));
    return rows.map(toBinding);
  }

  async saveBindings(input: LineStudioBindingInput, actorId: string, requestId: string): Promise<LineStudioBinding[]> {
    const now = this.clock();
    const rows = await this.db.transaction(async (tx) => {
      await tx.delete(baiyingLineStudioBindings).where(eq(baiyingLineStudioBindings.userPhoneId, input.userPhoneId));
      const inserted = input.studios.length
        ? await tx.insert(baiyingLineStudioBindings).values(input.studios.map((studio) => ({
            userPhoneId: input.userPhoneId,
            studioId: studio.studioId,
            studioName: studio.studioName,
            updatedBy: actorId,
            updatedAt: now,
          }))).returning()
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

function toBinding(row: typeof baiyingLineStudioBindings.$inferSelect): LineStudioBinding {
  return { ...row, updatedAt: row.updatedAt.toISOString() };
}

function toManagedLine(row: typeof baiyingPhoneLines.$inferSelect): ManagedLine {
  return { ...row, syncedAt: row.syncedAt.toISOString() };
}

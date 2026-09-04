import { and, desc, eq, sql } from 'drizzle-orm';
import type {
  MappingDraftInput,
  MappingRule,
  MappingVersion,
  PublishMappingInput,
  RemoveMappingDraftInput,
  SceneReadiness,
  SyncSceneObservation,
} from '@outbound/contracts';
import type { Database } from '../db/client.js';
import {
  auditLogs,
  baiyingSceneCompanies,
  baiyingScenes,
  mappingDrafts,
  mappingRules,
  mappingVersions,
  queueOutbox,
  sceneMappingReadiness,
  sceneVariableSnapshots,
} from '../db/schema.js';
import type { FailedSceneObservation, SceneSyncTarget } from '../baiying/variable-sync-service.js';
import { evaluateSceneReadiness, hashVariables, normalizeVariables, type LatestCompanySnapshot } from './readiness.js';
import {
  MappingConflictError,
  MappingNotFoundError,
  type MappingRepository,
  type PublishResult,
  type StoredDraft,
} from './repository.js';

type VersionRow = typeof mappingVersions.$inferSelect;
type RuleRow = typeof mappingRules.$inferSelect;
type DraftRow = typeof mappingDrafts.$inferSelect;

export class PostgresMappingRepository implements MappingRepository {
  constructor(
    private readonly db: Database,
    private readonly variableSyncQueueName: string,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async variableExistsInLatestSnapshot(variableName: string): Promise<boolean> {
    const result = await this.db.execute<{ exists: boolean }>(sql`
      WITH latest_snapshots AS (
        SELECT DISTINCT ON (${sceneVariableSnapshots.sceneDefId}, ${sceneVariableSnapshots.companyId})
          ${sceneVariableSnapshots.variables} AS "variables"
        FROM ${sceneVariableSnapshots}
        WHERE ${sceneVariableSnapshots.syncStatus} = 'SUCCESS'
        ORDER BY ${sceneVariableSnapshots.sceneDefId}, ${sceneVariableSnapshots.companyId}, ${sceneVariableSnapshots.syncedAt} DESC
      )
      SELECT EXISTS (
        SELECT 1
        FROM latest_snapshots
        WHERE "variables" ? ${variableName}
      ) AS "exists"
    `);
    return result[0]?.exists ?? false;
  }

  async saveDraft(input: MappingDraftInput, actorId: string, requestId: string): Promise<StoredDraft> {
    if (!(await this.variableExistsInLatestSnapshot(input.baiyingVariableName))) {
      throw new MappingNotFoundError('该变量不在百应 4.10 的成功同步快照中，不能手工新增');
    }

    const [draft] = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(72810410)`);
      const rows = await tx.insert(mappingDrafts).values({
        baiyingVariableName: input.baiyingVariableName,
        erpField: input.erpField || null,
        crmField: input.crmField || null,
        transformConfig: input.transformConfig,
        emptyPolicy: input.emptyPolicy,
        defaultValue: input.defaultValue || null,
        changeType: 'UPSERT',
        removalReason: null,
        updatedBy: actorId,
        updatedAt: this.clock(),
      }).onConflictDoUpdate({
        target: mappingDrafts.baiyingVariableName,
        set: {
          erpField: input.erpField || null,
          crmField: input.crmField || null,
          transformConfig: input.transformConfig,
          emptyPolicy: input.emptyPolicy,
          defaultValue: input.defaultValue || null,
          changeType: 'UPSERT',
          removalReason: null,
          updatedBy: actorId,
          updatedAt: this.clock(),
        },
      }).returning();
      await tx.insert(auditLogs).values({
        requestId,
        actorId,
        action: 'MAPPING_DRAFT_SAVED',
        objectType: 'BAIYING_VARIABLE',
        objectId: input.baiyingVariableName,
        detail: { erpField: input.erpField, crmField: input.crmField },
      });
      return rows;
    });
    return toStoredDraft(draft);
  }

  async stageRemoval(input: RemoveMappingDraftInput, actorId: string, requestId: string): Promise<StoredDraft> {
    const current = await this.listPublishedRules();
    if (!current.some((rule) => rule.baiyingVariableName === input.baiyingVariableName && rule.status === 'PUBLISHED')) {
      throw new MappingNotFoundError('没有可移除的已发布映射');
    }

    const [draft] = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(72810410)`);
      const rows = await tx.insert(mappingDrafts).values({
        baiyingVariableName: input.baiyingVariableName,
        changeType: 'REMOVE',
        removalReason: input.removalReason,
        updatedBy: actorId,
        updatedAt: this.clock(),
      }).onConflictDoUpdate({
        target: mappingDrafts.baiyingVariableName,
        set: {
          erpField: null,
          crmField: null,
          transformConfig: null,
          emptyPolicy: null,
          defaultValue: null,
          changeType: 'REMOVE',
          removalReason: input.removalReason,
          updatedBy: actorId,
          updatedAt: this.clock(),
        },
      }).returning();
      await tx.insert(auditLogs).values({
        requestId,
        actorId,
        action: 'MAPPING_REMOVAL_STAGED',
        objectType: 'BAIYING_VARIABLE',
        objectId: input.baiyingVariableName,
        detail: { removalReason: input.removalReason },
      });
      return rows;
    });
    return toStoredDraft(draft);
  }

  async listDrafts(): Promise<StoredDraft[]> {
    const rows = await this.db.select().from(mappingDrafts).orderBy(mappingDrafts.baiyingVariableName);
    return rows.map(toStoredDraft);
  }

  async listPublishedRules(): Promise<MappingRule[]> {
    const latest = await this.latestVersion();
    if (!latest) return [];
    const rows = await this.db.select().from(mappingRules)
      .where(eq(mappingRules.mappingVersionId, latest.id))
      .orderBy(mappingRules.baiyingVariableName);
    return rows.map((row) => toRule(row, latest.version));
  }

  async listVersions(): Promise<MappingVersion[]> {
    const rows = await this.db.select().from(mappingVersions).orderBy(desc(mappingVersions.version));
    if (rows.length === 0) return [];
    const counts = await this.db.select({ versionId: mappingRules.mappingVersionId, count: sql<number>`count(*)::int` })
      .from(mappingRules)
      .groupBy(mappingRules.mappingVersionId);
    const countByVersion = new Map(counts.map((item) => [item.versionId, item.count]));
    return rows.map((row) => toVersion(row, countByVersion.get(row.id) ?? 0));
  }

  async publishDrafts(input: PublishMappingInput, requestId: string): Promise<PublishResult> {
    const result = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(72810410)`);
      const [latest] = await tx.select().from(mappingVersions).orderBy(desc(mappingVersions.version)).limit(1);
      const draftRows = await tx.select().from(mappingDrafts).orderBy(mappingDrafts.baiyingVariableName);
      if (draftRows.length === 0) throw new MappingConflictError('没有待发布草稿');

      const previousRows = latest
        ? await tx.select().from(mappingRules).where(eq(mappingRules.mappingVersionId, latest.id))
        : [];
      const nextByVariable = new Map(previousRows.map((row) => [row.baiyingVariableName, row]));

      for (const draft of draftRows) {
        if (draft.changeType === 'REMOVE') {
          const existing = nextByVariable.get(draft.baiyingVariableName);
          if (!existing) throw new MappingConflictError(`映射“${draft.baiyingVariableName}”不存在，无法移除`);
          nextByVariable.set(draft.baiyingVariableName, { ...existing, status: 'REMOVED' });
          continue;
        }
        if (!draft.transformConfig || !draft.emptyPolicy || (!draft.erpField && !draft.crmField)) {
          throw new MappingConflictError(`映射“${draft.baiyingVariableName}”草稿不完整`);
        }
        nextByVariable.set(draft.baiyingVariableName, {
          id: crypto.randomUUID(),
          mappingVersionId: '',
          baiyingVariableName: draft.baiyingVariableName,
          erpField: draft.erpField,
          crmField: draft.crmField,
          transformConfig: draft.transformConfig,
          emptyPolicy: draft.emptyPolicy,
          defaultValue: draft.defaultValue,
          status: 'PUBLISHED',
          createdAt: this.clock(),
        });
      }

      const [versionRow] = await tx.insert(mappingVersions).values({
        version: (latest?.version ?? 0) + 1,
        publisherId: input.publisherId,
        changeSummary: input.changeSummary,
        publishedAt: this.clock(),
      }).returning();

      const ruleValues = [...nextByVariable.values()].map((rule) => ({
        mappingVersionId: versionRow.id,
        baiyingVariableName: rule.baiyingVariableName,
        erpField: rule.erpField,
        crmField: rule.crmField,
        transformConfig: rule.transformConfig,
        emptyPolicy: rule.emptyPolicy,
        defaultValue: rule.defaultValue,
        status: rule.status,
      }));
      const inserted = ruleValues.length ? await tx.insert(mappingRules).values(ruleValues).returning() : [];
      await tx.delete(mappingDrafts);
      await tx.insert(auditLogs).values({
        requestId,
        actorId: input.publisherId,
        action: 'MAPPING_VERSION_PUBLISHED',
        objectType: 'MAPPING_VERSION',
        objectId: String(versionRow.version),
        detail: { changedVariables: draftRows.map((draft) => draft.baiyingVariableName), ruleCount: inserted.length },
      });
      return {
        version: toVersion(versionRow, inserted.length),
        rules: inserted.map((row) => toRule(row, versionRow.version)),
      };
    });

    await this.refreshAllReadiness();
    return result;
  }

  async recordSuccessfulObservation(input: SyncSceneObservation): Promise<SceneReadiness> {
    const variables = normalizeVariables(input.variables);
    await this.db.transaction(async (tx) => {
      await tx.insert(baiyingScenes).values({
        sceneDefId: input.sceneDefId,
        robotDefId: input.robotDefId,
        sceneName: input.sceneName,
        updatedAt: this.clock(),
      }).onConflictDoUpdate({
        target: baiyingScenes.sceneDefId,
        set: { robotDefId: input.robotDefId, sceneName: input.sceneName, updatedAt: this.clock() },
      });
      await tx.insert(baiyingSceneCompanies).values({ sceneDefId: input.sceneDefId, companyId: input.companyId })
        .onConflictDoUpdate({
          target: [baiyingSceneCompanies.sceneDefId, baiyingSceneCompanies.companyId],
          set: { enabled: true },
        });
      await tx.insert(sceneVariableSnapshots).values({
        companyId: input.companyId,
        robotDefId: input.robotDefId,
        sceneDefId: input.sceneDefId,
        variables,
        variablesHash: hashVariables(variables),
        syncedAt: new Date(input.syncedAt),
        syncStatus: 'SUCCESS',
      });
    });
    return this.refreshSceneReadiness(input.sceneDefId);
  }

  async listEnabledSceneTargets(): Promise<SceneSyncTarget[]> {
    return this.db.select({
      companyId: baiyingSceneCompanies.companyId,
      robotDefId: baiyingScenes.robotDefId,
      sceneDefId: baiyingScenes.sceneDefId,
      sceneName: baiyingScenes.sceneName,
    }).from(baiyingSceneCompanies)
      .innerJoin(baiyingScenes, eq(baiyingSceneCompanies.sceneDefId, baiyingScenes.sceneDefId))
      .where(and(
        eq(baiyingSceneCompanies.enabled, true),
        eq(baiyingScenes.disabled, false),
      ))
      .orderBy(baiyingScenes.sceneDefId, baiyingSceneCompanies.companyId);
  }

  async recordFailedObservation(input: FailedSceneObservation): Promise<void> {
    await this.db.insert(sceneVariableSnapshots).values({
      companyId: input.companyId,
      robotDefId: input.robotDefId,
      sceneDefId: input.sceneDefId,
      variables: [],
      variablesHash: hashVariables([]),
      syncedAt: new Date(input.syncedAt),
      syncStatus: 'FAILED',
      errorMessage: input.errorMessage,
    });
    await this.refreshSceneReadiness(input.sceneDefId);
  }

  async listSceneReadiness(): Promise<SceneReadiness[]> {
    const rows = await this.db.select({
      sceneDefId: sceneMappingReadiness.sceneDefId,
      robotDefId: baiyingScenes.robotDefId,
      sceneName: baiyingScenes.sceneName,
      status: sceneMappingReadiness.status,
      variables: sceneMappingReadiness.variables,
      missingVariables: sceneMappingReadiness.missingVariables,
      lastSuccessfulSyncAt: sceneMappingReadiness.lastSuccessfulSyncAt,
      issueSummary: sceneMappingReadiness.issueSummary,
      version: mappingVersions.version,
      companyCount: sql<number>`(
        SELECT count(*)::int
        FROM ${baiyingSceneCompanies}
        WHERE ${baiyingSceneCompanies.sceneDefId} = ${sceneMappingReadiness.sceneDefId}
          AND ${baiyingSceneCompanies.enabled} = true
      )`,
    }).from(sceneMappingReadiness)
      .innerJoin(baiyingScenes, eq(sceneMappingReadiness.sceneDefId, baiyingScenes.sceneDefId))
      .leftJoin(mappingVersions, eq(sceneMappingReadiness.publishedMappingVersionId, mappingVersions.id))
      .orderBy(baiyingScenes.sceneName);
    return rows.map((row) => ({
      sceneDefId: row.sceneDefId,
      robotDefId: row.robotDefId,
      sceneName: row.sceneName,
      companyCount: row.companyCount,
      status: row.status,
      variables: row.variables,
      mappedVariables: row.variables.length - row.missingVariables.length,
      expectedVariables: row.variables.length,
      missingVariables: row.missingVariables,
      lastSuccessfulSyncAt: row.lastSuccessfulSyncAt?.toISOString() ?? null,
      issueSummary: row.issueSummary,
      publishedMappingVersion: row.version,
    }));
  }

  async enqueueVariableSync(input: { jobId: string; requestedAt: string; requestedBy: string }): Promise<void> {
    await this.db.insert(queueOutbox).values({
      id: input.jobId,
      eventType: 'BAIYING_VARIABLE_SYNC_REQUESTED',
      queueName: this.variableSyncQueueName,
      payload: input,
    });
  }

  private async latestVersion(): Promise<VersionRow | undefined> {
    const [row] = await this.db.select().from(mappingVersions).orderBy(desc(mappingVersions.version)).limit(1);
    return row;
  }

  private async refreshAllReadiness(): Promise<void> {
    const scenes = await this.db.select({ sceneDefId: baiyingScenes.sceneDefId }).from(baiyingScenes);
    await Promise.all(scenes.map(({ sceneDefId }) => this.refreshSceneReadiness(sceneDefId)));
  }

  private async refreshSceneReadiness(sceneDefId: string): Promise<SceneReadiness> {
    const [scene] = await this.db.select().from(baiyingScenes).where(eq(baiyingScenes.sceneDefId, sceneDefId)).limit(1);
    if (!scene) throw new MappingNotFoundError('话术场景不存在');

    const snapshotRows = await this.db.execute<{
      companyId: string;
      variables: string[];
      variablesHash: string;
      syncedAt: Date;
    }>(sql`
      SELECT DISTINCT ON (${sceneVariableSnapshots.companyId})
        ${sceneVariableSnapshots.companyId} AS "companyId",
        ${sceneVariableSnapshots.variables} AS "variables",
        ${sceneVariableSnapshots.variablesHash} AS "variablesHash",
        ${sceneVariableSnapshots.syncedAt} AS "syncedAt"
      FROM ${sceneVariableSnapshots}
      WHERE ${sceneVariableSnapshots.sceneDefId} = ${sceneDefId}
        AND ${sceneVariableSnapshots.syncStatus} = 'SUCCESS'
      ORDER BY ${sceneVariableSnapshots.companyId}, ${sceneVariableSnapshots.syncedAt} DESC
    `);
    const snapshots: LatestCompanySnapshot[] = snapshotRows.map((row) => ({
      ...row,
      syncedAt: new Date(row.syncedAt),
    }));
    const latest = await this.latestVersion();
    const rules = latest
      ? await this.db.select().from(mappingRules).where(and(
          eq(mappingRules.mappingVersionId, latest.id),
          eq(mappingRules.status, 'PUBLISHED'),
        ))
      : [];
    const publishedVariableNames = new Set(rules.filter((rule) => rule.erpField || rule.crmField).map((rule) => rule.baiyingVariableName));
    const [companyCount] = await this.db.select({ count: sql<number>`count(*)::int` })
      .from(baiyingSceneCompanies)
      .where(and(
        eq(baiyingSceneCompanies.sceneDefId, sceneDefId),
        eq(baiyingSceneCompanies.enabled, true),
      ));
    const readiness = evaluateSceneReadiness({
      scene,
      snapshots,
      publishedVariableNames,
      publishedMappingVersion: latest?.version ?? null,
      now: this.clock(),
      expectedCompanyCount: companyCount?.count ?? 0,
    });

    await this.db.insert(sceneMappingReadiness).values({
      sceneDefId,
      status: readiness.status,
      expectedVariablesHash: hashVariables(readiness.variables),
      publishedMappingVersionId: latest?.id ?? null,
      variables: readiness.variables,
      missingVariables: readiness.missingVariables,
      lastSuccessfulSyncAt: readiness.lastSuccessfulSyncAt ? new Date(readiness.lastSuccessfulSyncAt) : null,
      issueSummary: readiness.issueSummary,
      updatedAt: this.clock(),
    }).onConflictDoUpdate({
      target: sceneMappingReadiness.sceneDefId,
      set: {
        status: readiness.status,
        expectedVariablesHash: hashVariables(readiness.variables),
        publishedMappingVersionId: latest?.id ?? null,
        variables: readiness.variables,
        missingVariables: readiness.missingVariables,
        lastSuccessfulSyncAt: readiness.lastSuccessfulSyncAt ? new Date(readiness.lastSuccessfulSyncAt) : null,
        issueSummary: readiness.issueSummary,
        updatedAt: this.clock(),
      },
    });
    return readiness;
  }
}

function toStoredDraft(row: DraftRow): StoredDraft {
  return {
    baiyingVariableName: row.baiyingVariableName,
    erpField: row.erpField,
    crmField: row.crmField,
    transformConfig: row.transformConfig,
    emptyPolicy: row.emptyPolicy,
    defaultValue: row.defaultValue,
    changeType: row.changeType,
    removalReason: row.removalReason,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toRule(row: RuleRow, version: number): MappingRule {
  return {
    id: row.id,
    baiyingVariableName: row.baiyingVariableName,
    erpField: row.erpField,
    crmField: row.crmField,
    transformConfig: row.transformConfig,
    emptyPolicy: row.emptyPolicy,
    defaultValue: row.defaultValue,
    status: row.status,
    version,
  };
}

function toVersion(row: VersionRow, ruleCount: number): MappingVersion {
  return {
    id: row.id,
    version: row.version,
    publishedAt: row.publishedAt.toISOString(),
    publisherId: row.publisherId,
    changeSummary: row.changeSummary,
    ruleCount,
  };
}

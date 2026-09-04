import { createHash } from 'node:crypto';
import type { SceneReadiness, SceneStatus } from '@outbound/contracts';

export type LatestCompanySnapshot = {
  companyId: string;
  variables: string[];
  variablesHash: string;
  syncedAt: Date;
};

export type SceneIdentity = {
  sceneDefId: string;
  robotDefId: string;
  sceneName: string;
  disabled: boolean;
};

export function normalizeVariables(variables: string[]): string[] {
  return [...new Set(variables.map((value) => value.trim()).filter(Boolean))].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

export function hashVariables(variables: string[]): string {
  return createHash('sha256').update(JSON.stringify(normalizeVariables(variables))).digest('hex');
}

export function evaluateSceneReadiness(input: {
  scene: SceneIdentity;
  snapshots: LatestCompanySnapshot[];
  publishedVariableNames: Set<string>;
  publishedMappingVersion: number | null;
  now: Date;
  staleAfterHours?: number;
  expectedCompanyCount?: number;
}): SceneReadiness {
  const { scene, snapshots, publishedVariableNames, publishedMappingVersion, now } = input;
  const staleAfterMs = (input.staleAfterHours ?? 24) * 60 * 60 * 1000;
  const variables = normalizeVariables(snapshots.flatMap((snapshot) => snapshot.variables));
  const lastSuccessfulSync = snapshots.reduce<Date | null>((oldest, snapshot) => !oldest || snapshot.syncedAt < oldest ? snapshot.syncedAt : oldest, null);
  const missingVariables = variables.filter((variable) => !publishedVariableNames.has(variable));
  const hasDrift = new Set(snapshots.map((snapshot) => snapshot.variablesHash)).size > 1;
  const expectedCompanyCount = input.expectedCompanyCount ?? snapshots.length;
  const isStale = snapshots.length < expectedCompanyCount
    || !lastSuccessfulSync
    || snapshots.some((snapshot) => now.getTime() - snapshot.syncedAt.getTime() > staleAfterMs);

  let status: SceneStatus;
  let issueSummary: string | null = null;
  if (scene.disabled) {
    status = 'DISABLED';
    issueSummary = '管理员已停用该场景';
  } else if (isStale) {
    status = 'STALE_SYNC';
    issueSummary = snapshots.length < expectedCompanyCount
      ? '部分公司尚无成功的百应变量快照'
      : '超过 24 小时未成功同步百应变量';
  } else if (hasDrift) {
    status = 'DRIFT_DETECTED';
    issueSummary = '同一场景在不同公司返回的话术变量集合不一致';
  } else if (missingVariables.length > 0) {
    status = 'PENDING_MAPPING';
    issueSummary = `存在 ${missingVariables.length} 个变量尚无已发布映射`;
  } else {
    status = 'ACTIVE';
  }

  return {
    sceneDefId: scene.sceneDefId,
    robotDefId: scene.robotDefId,
    sceneName: scene.sceneName,
    companyCount: expectedCompanyCount,
    status,
    variables,
    mappedVariables: variables.length - missingVariables.length,
    expectedVariables: variables.length,
    missingVariables,
    lastSuccessfulSyncAt: lastSuccessfulSync?.toISOString() ?? null,
    issueSummary,
    publishedMappingVersion,
  };
}

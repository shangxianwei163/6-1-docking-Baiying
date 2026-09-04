import type { Database } from '../db/client.js';
import { baiyingSceneCompanies, baiyingScenes } from '../db/schema.js';
import type { PostgresMappingRepository } from '../mapping/postgres-repository.js';
import type { HttpBaiyingVariableClient } from './client.js';

export type BaiyingSyncSummary = {
  companyCount: number;
  robotCount: number;
  sceneCount: number;
  succeeded: number;
  failed: number;
  failures: Array<{ robotDefId: string; message: string }>;
};

/** 使用最新 OAuth v2 接口发现话术，并以 robotDefId 作为稳定场景标识。 */
export async function syncBaiyingCompany(input: {
  client: HttpBaiyingVariableClient;
  companyId: string;
  db: Database;
  repository: PostgresMappingRepository;
}): Promise<BaiyingSyncSummary> {
  const companies = await input.client.listCompanies();
  if (!companies.some((company) => company.companyId === input.companyId)) {
    throw new Error('绑定公司列表中没有配置的 companyId，已停止同步');
  }

  // 只同步发布过的话术；robotStatus=0 会包含已不存在、无法查询变量的历史记录。
  const robots = await input.client.listRobots(input.companyId, 2);
  const targets = [...new Map(robots.map((robot) => [robot.robotDefId, robot])).values()];
  const failures: BaiyingSyncSummary['failures'] = [];
  let succeeded = 0;

  for (const robot of targets) {
    const target = {
      companyId: input.companyId,
      robotDefId: robot.robotDefId,
      sceneDefId: robot.robotDefId,
      sceneName: robot.robotName,
    };
    await input.db.transaction(async (tx) => {
      await tx.insert(baiyingScenes).values({
        sceneDefId: target.sceneDefId,
        robotDefId: target.robotDefId,
        sceneName: target.sceneName,
      }).onConflictDoUpdate({
        target: baiyingScenes.sceneDefId,
        set: { robotDefId: target.robotDefId, sceneName: target.sceneName, disabled: false, updatedAt: new Date() },
      });
      await tx.insert(baiyingSceneCompanies).values({
        sceneDefId: target.sceneDefId,
        companyId: target.companyId,
      }).onConflictDoUpdate({
        target: [baiyingSceneCompanies.sceneDefId, baiyingSceneCompanies.companyId],
        set: { enabled: true },
      });
    });

    const syncedAt = new Date().toISOString();
    try {
      const variables = await input.client.querySceneVariables(target);
      await input.repository.recordSuccessfulObservation({ ...target, variables, syncedAt });
      succeeded += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : '百应变量同步失败';
      failures.push({ robotDefId: target.robotDefId, message });
      await input.repository.recordFailedObservation({ ...target, syncedAt, errorMessage: message });
    }
  }

  return {
    companyCount: companies.length,
    robotCount: robots.length,
    sceneCount: targets.length,
    succeeded,
    failed: failures.length,
    failures,
  };
}

import type { SyncSceneObservation } from '@outbound/contracts';
import type { BaiyingVariableClient } from './client.js';

export type SceneSyncTarget = {
  companyId: string;
  robotDefId: string;
  sceneDefId: string;
  sceneName: string;
};

export type FailedSceneObservation = SceneSyncTarget & {
  syncedAt: string;
  errorMessage: string;
};

export interface VariableSyncStore {
  listEnabledSceneTargets(): Promise<SceneSyncTarget[]>;
  recordSuccessfulObservation(input: SyncSceneObservation): Promise<unknown>;
  recordFailedObservation(input: FailedSceneObservation): Promise<void>;
}

export type VariableSyncSummary = {
  startedAt: string;
  finishedAt: string;
  targetCount: number;
  succeeded: number;
  failed: number;
  failures: Array<{ companyId: string; sceneDefId: string; message: string }>;
};

export class BaiyingVariableSyncService {
  constructor(
    private readonly store: VariableSyncStore,
    private readonly client: BaiyingVariableClient,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async run(): Promise<VariableSyncSummary> {
    const startedAt = this.clock().toISOString();
    const targets = await this.store.listEnabledSceneTargets();
    const failures: VariableSyncSummary['failures'] = [];
    let succeeded = 0;

    // 顺序执行便于遵守三方限流；拿到正式限流规则后再配置受控并发。
    for (const target of targets) {
      const syncedAt = this.clock().toISOString();
      try {
        const variables = await this.client.querySceneVariables({
          companyId: target.companyId,
          robotDefId: target.robotDefId,
        });
        await this.store.recordSuccessfulObservation({ ...target, variables, syncedAt });
        succeeded += 1;
      } catch (error) {
        const message = sanitizeError(error);
        failures.push({ companyId: target.companyId, sceneDefId: target.sceneDefId, message });
        await this.store.recordFailedObservation({ ...target, syncedAt, errorMessage: message });
      }
    }

    return {
      startedAt,
      finishedAt: this.clock().toISOString(),
      targetCount: targets.length,
      succeeded,
      failed: failures.length,
      failures,
    };
  }
}

function sanitizeError(error: unknown): string {
  if (!(error instanceof Error)) return '百应变量同步失败';
  return error.message.slice(0, 500) || '百应变量同步失败';
}

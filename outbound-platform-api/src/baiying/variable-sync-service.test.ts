import { describe, expect, it, vi } from 'vitest';
import { BaiyingVariableSyncService, type VariableSyncStore } from './variable-sync-service.js';

describe('BaiyingVariableSyncService', () => {
  it('keeps processing other companies when one 4.10 request fails', async () => {
    const targets = [
      { companyId: 'company-1', robotDefId: 'robot-1', sceneDefId: 'scene-1', sceneName: '场景一' },
      { companyId: 'company-2', robotDefId: 'robot-2', sceneDefId: 'scene-2', sceneName: '场景二' },
    ];
    const recordSuccessfulObservation = vi.fn(async () => undefined);
    const recordFailedObservation = vi.fn(async () => undefined);
    const store: VariableSyncStore = {
      listEnabledSceneTargets: vi.fn(async () => targets),
      recordSuccessfulObservation,
      recordFailedObservation,
    };
    const client = {
      querySceneVariables: vi.fn(async ({ companyId }: { companyId: string }) => {
        if (companyId === 'company-1') throw new Error('HTTP 503');
        return ['婚期'];
      }),
    };
    const timestamps = [
      '2026-09-03T08:00:00.000Z',
      '2026-09-03T08:00:01.000Z',
      '2026-09-03T08:00:02.000Z',
      '2026-09-03T08:00:03.000Z',
    ];
    const service = new BaiyingVariableSyncService(store, client, () => new Date(timestamps.shift()!));

    const summary = await service.run();

    expect(summary).toMatchObject({ targetCount: 2, succeeded: 1, failed: 1 });
    expect(recordFailedObservation).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'company-1', errorMessage: 'HTTP 503' }));
    expect(recordSuccessfulObservation).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'company-2', variables: ['婚期'] }));
  });
});

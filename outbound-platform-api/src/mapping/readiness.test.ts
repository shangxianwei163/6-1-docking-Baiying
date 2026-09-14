import { describe, expect, it } from 'vitest';
import { compareMappingVariables } from '@outbound/contracts';
import { evaluateSceneReadiness, hashVariables } from './readiness.js';

const scene = {
  sceneDefId: 'scene-1',
  robotDefId: 'robot-1',
  sceneName: '婚博会回访',
  disabled: false,
};
const now = new Date('2026-09-03T02:00:00.000Z');

describe('evaluateSceneReadiness', () => {
  it('marks a scene active only when company snapshots agree and every variable is published', () => {
    const variables = ['套餐意向', '婚期'];
    const result = evaluateSceneReadiness({
      scene,
      snapshots: [
        {
          companyId: 'company-a',
          variables,
          variablesHash: hashVariables(variables),
          syncedAt: now,
        },
        {
          companyId: 'company-b',
          variables: [...variables].reverse(),
          variablesHash: hashVariables([...variables].reverse()),
          syncedAt: now,
        },
      ],
      publishedVariableNames: new Set(variables),
      publishedMappingVersion: 12,
      now,
    });
    expect(result.status).toBe('ACTIVE');
    expect(result.mappedVariables).toBe(2);
  });

  it('blocks a scene when a 4.10 variable has no published mapping', () => {
    const variables = ['婚期', '预算范围'];
    const result = evaluateSceneReadiness({
      scene,
      snapshots: [
        {
          companyId: 'company-a',
          variables,
          variablesHash: hashVariables(variables),
          syncedAt: now,
        },
      ],
      publishedVariableNames: new Set(['婚期']),
      publishedMappingVersion: 12,
      now,
    });
    expect(result.status).toBe('PENDING_MAPPING');
    expect(result.missingVariables).toEqual(['预算范围']);
  });

  it('gives cross-company drift precedence over missing mappings', () => {
    const left = ['婚期'];
    const right = ['婚期', '客户等级'];
    const result = evaluateSceneReadiness({
      scene,
      snapshots: [
        {
          companyId: 'company-a',
          variables: left,
          variablesHash: hashVariables(left),
          syncedAt: now,
        },
        {
          companyId: 'company-b',
          variables: right,
          variablesHash: hashVariables(right),
          syncedAt: now,
        },
      ],
      publishedVariableNames: new Set(['婚期']),
      publishedMappingVersion: 12,
      now,
    });
    expect(result.status).toBe('DRIFT_DETECTED');
  });

  it('blocks a scene after 24 hours without a successful snapshot', () => {
    const syncedAt = new Date('2026-09-01T00:00:00.000Z');
    const variables = ['婚期'];
    const result = evaluateSceneReadiness({
      scene,
      snapshots: [
        {
          companyId: 'company-a',
          variables,
          variablesHash: hashVariables(variables),
          syncedAt,
        },
      ],
      publishedVariableNames: new Set(variables),
      publishedMappingVersion: 12,
      now,
    });
    expect(result.status).toBe('STALE_SYNC');
  });

  it('blocks a scene when one configured company has never produced a successful snapshot', () => {
    const variables = ['婚期'];
    const result = evaluateSceneReadiness({
      scene,
      snapshots: [
        {
          companyId: 'company-a',
          variables,
          variablesHash: hashVariables(variables),
          syncedAt: now,
        },
      ],
      expectedCompanyCount: 2,
      publishedVariableNames: new Set(variables),
      publishedMappingVersion: 12,
      now,
    });
    expect(result.status).toBe('STALE_SYNC');
    expect(result.issueSummary).toContain('部分公司');
  });

  it('treats Baiying as authoritative when a published variable disappears', () => {
    const variables = ['婚期'];
    const readiness = evaluateSceneReadiness({
      scene,
      snapshots: [
        {
          companyId: 'company-a',
          variables,
          variablesHash: hashVariables(variables),
          syncedAt: now,
        },
      ],
      publishedVariableNames: new Set(['婚期', '预算范围']),
      publishedMappingVersion: 12,
      now,
    });
    const changes = compareMappingVariables(
      [readiness],
      [
        { baiyingVariableName: '婚期', status: 'PUBLISHED' },
        { baiyingVariableName: '预算范围', status: 'PUBLISHED' },
      ],
    );

    expect(readiness.status).toBe('ACTIVE');
    expect(readiness.variables).toEqual(['婚期']);
    expect(changes).toEqual({
      addedVariables: [],
      removedVariables: ['预算范围'],
    });
  });

  it('does not retire mappings before Baiying has produced a successful snapshot', () => {
    expect(
      compareMappingVariables(
        [
          {
            variables: [],
            lastSuccessfulSyncAt: null,
            status: 'STALE_SYNC',
          },
        ],
        [{ baiyingVariableName: '婚期', status: 'PUBLISHED' }],
      ),
    ).toEqual({ addedVariables: [], removedVariables: [] });
  });

  it('ignores variables from scenes retired by the latest Baiying discovery', () => {
    expect(
      compareMappingVariables(
        [
          {
            variables: ['当前变量'],
            lastSuccessfulSyncAt: now.toISOString(),
            status: 'ACTIVE',
          },
          {
            variables: ['历史变量'],
            lastSuccessfulSyncAt: now.toISOString(),
            status: 'DISABLED',
          },
        ],
        [
          { baiyingVariableName: '当前变量', status: 'PUBLISHED' },
          { baiyingVariableName: '历史变量', status: 'PUBLISHED' },
        ],
      ),
    ).toEqual({ addedVariables: [], removedVariables: ['历史变量'] });
  });
});

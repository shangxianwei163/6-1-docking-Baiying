import { z } from 'zod';

export const transformTypeSchema = z.enum([
  'TEXT',
  'DATE',
  'MONEY',
  'ENUM',
  'TEMPLATE',
]);
export const emptyPolicySchema = z.enum(['BLOCK', 'DEFAULT', 'OMIT']);
export const mappingRuleStatusSchema = z.enum(['PUBLISHED', 'REMOVED']);
export const sceneStatusSchema = z.enum([
  'ACTIVE',
  'PENDING_MAPPING',
  'DRIFT_DETECTED',
  'STALE_SYNC',
  'DISABLED',
]);

export type TransformType = z.infer<typeof transformTypeSchema>;
export type EmptyPolicy = z.infer<typeof emptyPolicySchema>;
export type MappingRuleStatus = z.infer<typeof mappingRuleStatusSchema>;
export type SceneStatus = z.infer<typeof sceneStatusSchema>;

export const transformConfigSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('TEXT'),
    mode: z.enum(['TRIM', 'PRESERVE', 'UPPERCASE', 'LOWERCASE']),
  }),
  z.object({
    type: z.literal('DATE'),
    outputFormat: z.enum(['YYYY-MM-DD', 'YYYY年MM月DD日', 'MM/DD/YYYY']),
  }),
  z.object({
    type: z.literal('MONEY'),
    inputUnit: z.enum(['YUAN', 'CENT']),
    decimalPlaces: z.union([z.literal(0), z.literal(2)]),
  }),
  z.object({
    type: z.literal('ENUM'),
    values: z
      .record(z.string(), z.string())
      .refine((value) => Object.keys(value).length > 0, '至少需要一条枚举映射'),
  }),
  z.object({
    type: z.literal('TEMPLATE'),
    template: z.string().includes('{{value}}'),
  }),
]);
export type TransformConfig = z.infer<typeof transformConfigSchema>;

export const mappingDraftInputSchema = z
  .object({
    baiyingVariableName: z.string().trim().min(1).max(128),
    erpField: z.string().trim().max(128).nullable().default(null),
    crmField: z.string().trim().max(128).nullable().default(null),
    transformConfig: transformConfigSchema,
    emptyPolicy: emptyPolicySchema,
    defaultValue: z.string().max(1000).nullable().default(null),
  })
  .superRefine((value, context) => {
    if (!value.erpField && !value.crmField) {
      context.addIssue({
        code: 'custom',
        path: ['erpField'],
        message: 'ERP 与 CRM 至少配置一个取值字段',
      });
    }
    if (
      value.transformConfig.type === 'ENUM' &&
      value.emptyPolicy === 'DEFAULT' &&
      !value.defaultValue
    ) {
      context.addIssue({
        code: 'custom',
        path: ['defaultValue'],
        message: 'DEFAULT 策略必须配置默认值',
      });
    }
    if (value.emptyPolicy === 'DEFAULT' && !value.defaultValue) {
      context.addIssue({
        code: 'custom',
        path: ['defaultValue'],
        message: 'DEFAULT 策略必须配置默认值',
      });
    }
  });
export type MappingDraftInput = z.infer<typeof mappingDraftInputSchema>;

export const removeMappingDraftInputSchema = z.object({
  baiyingVariableName: z.string().trim().min(1).max(128),
  removalReason: z.string().trim().min(1).max(500),
});
export type RemoveMappingDraftInput = z.infer<
  typeof removeMappingDraftInputSchema
>;

export const publishMappingInputSchema = z.object({
  publisherId: z.string().min(1).max(128),
  changeSummary: z.string().trim().min(1).max(1000),
});
export type PublishMappingInput = z.infer<typeof publishMappingInputSchema>;

export const syncSceneObservationSchema = z.object({
  companyId: z.string().min(1).max(64),
  robotDefId: z.string().min(1).max(128),
  sceneDefId: z.string().min(1).max(128),
  sceneName: z.string().min(1).max(200),
  variables: z.array(z.string().trim().min(1).max(128)).max(500),
  syncedAt: z.iso.datetime({ offset: true }),
});
export type SyncSceneObservation = z.infer<typeof syncSceneObservationSchema>;

export const mappingRuleSchema = z.object({
  id: z.uuid(),
  baiyingVariableName: z.string(),
  erpField: z.string().nullable(),
  crmField: z.string().nullable(),
  transformConfig: transformConfigSchema,
  emptyPolicy: emptyPolicySchema,
  defaultValue: z.string().nullable(),
  status: mappingRuleStatusSchema,
  version: z.number().int().positive(),
});
export type MappingRule = z.infer<typeof mappingRuleSchema>;

export const sceneReadinessSchema = z.object({
  sceneDefId: z.string(),
  robotDefId: z.string(),
  sceneName: z.string(),
  companyCount: z.number().int().nonnegative(),
  status: sceneStatusSchema,
  variables: z.array(z.string()),
  mappedVariables: z.number().int().nonnegative(),
  expectedVariables: z.number().int().nonnegative(),
  missingVariables: z.array(z.string()),
  lastSuccessfulSyncAt: z.iso.datetime({ offset: true }).nullable(),
  issueSummary: z.string().nullable(),
  publishedMappingVersion: z.number().int().positive().nullable(),
});
export type SceneReadiness = z.infer<typeof sceneReadinessSchema>;

export const mappingVersionSchema = z.object({
  id: z.uuid(),
  version: z.number().int().positive(),
  publishedAt: z.iso.datetime({ offset: true }),
  publisherId: z.string(),
  changeSummary: z.string(),
  ruleCount: z.number().int().nonnegative(),
});
export type MappingVersion = z.infer<typeof mappingVersionSchema>;

export type MappingVariableChanges = {
  addedVariables: string[];
  removedVariables: string[];
};

/**
 * Compare Baiying's latest successful scene snapshots with the current
 * published mapping version. Baiying is authoritative for the target variable
 * set; ERP and CRM field names remain operator-managed source keys.
 */
export function compareMappingVariables(
  scenes: ReadonlyArray<
    Pick<SceneReadiness, 'variables' | 'lastSuccessfulSyncAt' | 'status'>
  >,
  rules: ReadonlyArray<Pick<MappingRule, 'baiyingVariableName' | 'status'>>,
): MappingVariableChanges {
  const authoritativeScenes = scenes.filter(
    (scene) =>
      scene.lastSuccessfulSyncAt !== null && scene.status !== 'DISABLED',
  );
  const currentVariables = new Set(
    authoritativeScenes
      .flatMap((scene) => scene.variables.map((value) => value.trim()))
      .filter(Boolean),
  );
  const publishedVariables = new Set(
    rules
      .filter((rule) => rule.status === 'PUBLISHED')
      .map((rule) => rule.baiyingVariableName.trim())
      .filter(Boolean),
  );
  const sortVariables = (values: string[]) =>
    values.sort((left, right) => left.localeCompare(right, 'zh-CN'));

  return {
    addedVariables: sortVariables(
      [...currentVariables].filter(
        (variable) => !publishedVariables.has(variable),
      ),
    ),
    removedVariables: authoritativeScenes.length
      ? sortVariables(
          [...publishedVariables].filter(
            (variable) => !currentVariables.has(variable),
          ),
        )
      : [],
  };
}

export const variableSyncRequestedSchema = z.object({
  jobId: z.uuid(),
  status: z.literal('QUEUED'),
  requestedAt: z.iso.datetime({ offset: true }),
});
export type VariableSyncRequested = z.infer<typeof variableSyncRequestedSchema>;

export const variableSyncJobStatusSchema = z.enum([
  'QUEUED',
  'RUNNING',
  'RETRYING',
  'SUCCEEDED',
  'FAILED',
]);
export type VariableSyncJobStatus = z.infer<typeof variableSyncJobStatusSchema>;

export const variableSyncJobSchema = z.object({
  jobId: z.uuid(),
  status: variableSyncJobStatusSchema,
  requestedAt: z.iso.datetime({ offset: true }),
  startedAt: z.iso.datetime({ offset: true }).nullable(),
  finishedAt: z.iso.datetime({ offset: true }).nullable(),
  attempts: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
});
export type VariableSyncJob = z.infer<typeof variableSyncJobSchema>;

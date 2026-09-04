import { z } from 'zod';

export const transformTypeSchema = z.enum(['TEXT', 'DATE', 'MONEY', 'ENUM', 'TEMPLATE']);
export const emptyPolicySchema = z.enum(['BLOCK', 'DEFAULT']);
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
  z.object({ type: z.literal('TEXT'), mode: z.enum(['TRIM', 'PRESERVE', 'UPPERCASE', 'LOWERCASE']) }),
  z.object({ type: z.literal('DATE'), outputFormat: z.enum(['YYYY-MM-DD', 'YYYY年MM月DD日', 'MM/DD/YYYY']) }),
  z.object({ type: z.literal('MONEY'), inputUnit: z.enum(['YUAN', 'CENT']), decimalPlaces: z.union([z.literal(0), z.literal(2)]) }),
  z.object({ type: z.literal('ENUM'), values: z.record(z.string(), z.string()).refine((value) => Object.keys(value).length > 0, '至少需要一条枚举映射') }),
  z.object({ type: z.literal('TEMPLATE'), template: z.string().includes('{{value}}') }),
]);
export type TransformConfig = z.infer<typeof transformConfigSchema>;

export const mappingDraftInputSchema = z.object({
  baiyingVariableName: z.string().trim().min(1).max(128),
  erpField: z.string().trim().max(128).nullable().default(null),
  crmField: z.string().trim().max(128).nullable().default(null),
  transformConfig: transformConfigSchema,
  emptyPolicy: emptyPolicySchema,
  defaultValue: z.string().max(1000).nullable().default(null),
}).superRefine((value, context) => {
  if (!value.erpField && !value.crmField) {
    context.addIssue({ code: 'custom', path: ['erpField'], message: 'ERP 与 CRM 至少配置一个取值字段' });
  }
  if (value.transformConfig.type === 'ENUM' && value.emptyPolicy === 'DEFAULT' && !value.defaultValue) {
    context.addIssue({ code: 'custom', path: ['defaultValue'], message: 'DEFAULT 策略必须配置默认值' });
  }
  if (value.emptyPolicy === 'DEFAULT' && !value.defaultValue) {
    context.addIssue({ code: 'custom', path: ['defaultValue'], message: 'DEFAULT 策略必须配置默认值' });
  }
});
export type MappingDraftInput = z.infer<typeof mappingDraftInputSchema>;

export const removeMappingDraftInputSchema = z.object({
  baiyingVariableName: z.string().trim().min(1).max(128),
  removalReason: z.string().trim().min(1).max(500),
});
export type RemoveMappingDraftInput = z.infer<typeof removeMappingDraftInputSchema>;

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

export const variableSyncRequestedSchema = z.object({
  jobId: z.uuid(),
  status: z.literal('QUEUED'),
  requestedAt: z.iso.datetime({ offset: true }),
});
export type VariableSyncRequested = z.infer<typeof variableSyncRequestedSchema>;

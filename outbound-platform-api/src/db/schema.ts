import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type { TransformConfig } from '@outbound/contracts';

export const sceneSyncStatus = pgEnum('scene_sync_status', ['SUCCESS', 'FAILED']);
export const sceneReadinessStatus = pgEnum('scene_readiness_status', [
  'ACTIVE',
  'PENDING_MAPPING',
  'DRIFT_DETECTED',
  'STALE_SYNC',
  'DISABLED',
]);
export const mappingChangeType = pgEnum('mapping_change_type', ['UPSERT', 'REMOVE']);
export const mappingRuleStatus = pgEnum('mapping_rule_status', ['PUBLISHED', 'REMOVED']);
export const emptyPolicy = pgEnum('empty_policy', ['BLOCK', 'DEFAULT']);

export const baiyingScenes = pgTable('baiying_scene', {
  sceneDefId: varchar('scene_def_id', { length: 128 }).primaryKey(),
  robotDefId: varchar('robot_def_id', { length: 128 }).notNull(),
  sceneName: varchar('scene_name', { length: 200 }).notNull(),
  disabled: boolean('disabled').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const baiyingSceneCompanies = pgTable('baiying_scene_company', {
  sceneDefId: varchar('scene_def_id', { length: 128 }).notNull().references(() => baiyingScenes.sceneDefId, { onDelete: 'cascade' }),
  companyId: varchar('company_id', { length: 64 }).notNull(),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.sceneDefId, table.companyId] })]);

export const sceneVariableSnapshots = pgTable('baiying_scene_variable_snapshot', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: varchar('company_id', { length: 64 }).notNull(),
  robotDefId: varchar('robot_def_id', { length: 128 }).notNull(),
  sceneDefId: varchar('scene_def_id', { length: 128 }).notNull().references(() => baiyingScenes.sceneDefId, { onDelete: 'cascade' }),
  variables: jsonb('variables_json').$type<string[]>().notNull(),
  variablesHash: varchar('variables_hash', { length: 64 }).notNull(),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull(),
  syncStatus: sceneSyncStatus('sync_status').notNull(),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('scene_snapshot_lookup_idx').on(table.sceneDefId, table.companyId, table.syncedAt),
]);

export const mappingVersions = pgTable('mapping_version', {
  id: uuid('id').primaryKey().defaultRandom(),
  version: integer('version').notNull(),
  publisherId: varchar('publisher_id', { length: 128 }).notNull(),
  changeSummary: text('change_summary').notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex('mapping_version_number_uq').on(table.version)]);

export const mappingRules = pgTable('global_variable_mapping', {
  id: uuid('id').primaryKey().defaultRandom(),
  mappingVersionId: uuid('mapping_version_id').notNull().references(() => mappingVersions.id, { onDelete: 'restrict' }),
  baiyingVariableName: varchar('baiying_variable_name', { length: 128 }).notNull(),
  erpField: varchar('erp_field', { length: 128 }),
  crmField: varchar('crm_field', { length: 128 }),
  transformConfig: jsonb('transform_config').$type<TransformConfig>().notNull(),
  emptyPolicy: emptyPolicy('empty_policy').notNull(),
  defaultValue: text('default_value'),
  status: mappingRuleStatus('status').notNull().default('PUBLISHED'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('mapping_rule_version_variable_uq').on(table.mappingVersionId, table.baiyingVariableName),
  index('mapping_rule_variable_idx').on(table.baiyingVariableName),
  check('mapping_has_source_field_ck', sql`${table.status} = 'REMOVED' OR ${table.erpField} IS NOT NULL OR ${table.crmField} IS NOT NULL`),
  check('mapping_default_value_ck', sql`${table.emptyPolicy} <> 'DEFAULT' OR ${table.defaultValue} IS NOT NULL`),
]);

export const mappingDrafts = pgTable('global_variable_mapping_draft', {
  baiyingVariableName: varchar('baiying_variable_name', { length: 128 }).primaryKey(),
  erpField: varchar('erp_field', { length: 128 }),
  crmField: varchar('crm_field', { length: 128 }),
  transformConfig: jsonb('transform_config').$type<TransformConfig>(),
  emptyPolicy: emptyPolicy('empty_policy'),
  defaultValue: text('default_value'),
  changeType: mappingChangeType('change_type').notNull(),
  removalReason: text('removal_reason'),
  updatedBy: varchar('updated_by', { length: 128 }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('mapping_draft_payload_ck', sql`
    (${table.changeType} = 'REMOVE' AND ${table.removalReason} IS NOT NULL)
    OR
    (${table.changeType} = 'UPSERT' AND ${table.transformConfig} IS NOT NULL AND ${table.emptyPolicy} IS NOT NULL AND (${table.erpField} IS NOT NULL OR ${table.crmField} IS NOT NULL))
  `),
]);

export const sceneMappingReadiness = pgTable('scene_mapping_readiness', {
  sceneDefId: varchar('scene_def_id', { length: 128 }).primaryKey().references(() => baiyingScenes.sceneDefId, { onDelete: 'cascade' }),
  status: sceneReadinessStatus('status').notNull(),
  expectedVariablesHash: varchar('expected_variables_hash', { length: 64 }),
  publishedMappingVersionId: uuid('published_mapping_version_id').references(() => mappingVersions.id, { onDelete: 'restrict' }),
  variables: jsonb('variables_json').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  missingVariables: jsonb('missing_variables_json').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  lastSuccessfulSyncAt: timestamp('last_successful_sync_at', { withTimezone: true }),
  issueSummary: text('issue_summary'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const taskMappingSnapshots = pgTable('task_mapping_snapshot', {
  taskId: uuid('task_id').primaryKey(),
  mappingVersionId: uuid('mapping_version_id').notNull().references(() => mappingVersions.id, { onDelete: 'restrict' }),
  variables: jsonb('variables_json').$type<string[]>().notNull(),
  mappingRules: jsonb('mapping_rules_json').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const auditLogs = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  requestId: varchar('request_id', { length: 128 }).notNull(),
  actorId: varchar('actor_id', { length: 128 }).notNull(),
  action: varchar('action', { length: 128 }).notNull(),
  objectType: varchar('object_type', { length: 128 }).notNull(),
  objectId: varchar('object_id', { length: 256 }).notNull(),
  detail: jsonb('detail_json').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sourceDataCategories = pgTable('source_data_category', {
  sourceSystem: varchar('source_system', { length: 32 }).notNull(),
  externalId: varchar('external_id', { length: 256 }).notNull(),
  categoryPath: varchar('category_path', { length: 500 }).notNull(),
  active: boolean('active').notNull().default(true),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.sourceSystem, table.externalId] }),
  index('source_category_active_idx').on(table.sourceSystem, table.active, table.categoryPath),
]);

export const plannedTaskCategoryBindings = pgTable('planned_task_category_binding', {
  workflowId: varchar('workflow_id', { length: 128 }).primaryKey(),
  sourceSystem: varchar('source_system', { length: 32 }).notNull(),
  sourceCategoryId: varchar('source_category_id', { length: 256 }).notNull(),
  categoryPath: varchar('category_path', { length: 500 }).notNull(),
  updatedBy: varchar('updated_by', { length: 128 }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const baiyingRobotBindings = pgTable('baiying_robot_binding', {
  robotDefId: varchar('robot_def_id', { length: 128 }).primaryKey(),
  sourceSystem: varchar('source_system', { length: 32 }).notNull(),
  sourceCategoryId: varchar('source_category_id', { length: 256 }).notNull(),
  categoryPath: varchar('category_path', { length: 500 }).notNull(),
  studioId: varchar('studio_id', { length: 128 }).notNull(),
  studioName: varchar('studio_name', { length: 200 }).notNull(),
  lineId: varchar('line_id', { length: 128 }).notNull(),
  lineName: varchar('line_name', { length: 200 }).notNull(),
  updatedBy: varchar('updated_by', { length: 128 }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const baiyingLineStudioBindings = pgTable('baiying_line_studio_binding', {
  userPhoneId: varchar('user_phone_id', { length: 128 }).notNull(),
  studioId: varchar('studio_id', { length: 128 }).notNull(),
  studioName: varchar('studio_name', { length: 200 }).notNull(),
  updatedBy: varchar('updated_by', { length: 128 }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.userPhoneId, table.studioId] }),
  index('line_studio_binding_line_idx').on(table.userPhoneId),
]);

export const baiyingPhoneLines = pgTable('baiying_phone_line', {
  userPhoneId: varchar('user_phone_id', { length: 128 }).primaryKey(),
  phone: varchar('phone', { length: 200 }).notNull(),
  phoneName: varchar('phone_name', { length: 200 }).notNull().default(''),
  phoneType: integer('phone_type').notNull(),
  sceneType: integer('scene_type').notNull(),
  rateType: integer('rate_type').notNull(),
  localSellingRate: doublePrecision('local_selling_rate').notNull(),
  nonlocalSellingRate: doublePrecision('nonlocal_selling_rate').notNull(),
  lineAmount: doublePrecision('line_amount').notNull(),
  billPeriod: integer('bill_period').notNull(),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
});

export const queueOutbox = pgTable('queue_outbox', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventType: varchar('event_type', { length: 128 }).notNull(),
  queueName: varchar('queue_name', { length: 128 }).notNull(),
  payload: jsonb('payload_json').$type<Record<string, unknown>>().notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  attempts: integer('attempts').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index('queue_outbox_pending_idx').on(table.publishedAt, table.createdAt)]);

export const idempotencyRecords = pgTable('idempotency_record', {
  sourceSystem: varchar('source_system', { length: 32 }).notNull(),
  idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull(),
  requestId: varchar('request_id', { length: 128 }).notNull(),
  responseStatus: integer('response_status').notNull(),
  responseBody: jsonb('response_body_json').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.sourceSystem, table.idempotencyKey] }),
  index('idempotency_expiry_idx').on(table.expiresAt),
]);

// Reserved for high-volume source identifiers without JavaScript bigint coercion.
export const externalSequence = pgTable('external_sequence', {
  name: varchar('name', { length: 64 }).primaryKey(),
  value: bigint('value', { mode: 'bigint' }).notNull(),
});

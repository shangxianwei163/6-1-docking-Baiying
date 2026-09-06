import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type {
  RecordingDownloadUrlEnvelope,
  TransformConfig,
} from '@outbound/contracts';

export const sceneSyncStatus = pgEnum('scene_sync_status', [
  'SUCCESS',
  'FAILED',
]);
export const sceneReadinessStatus = pgEnum('scene_readiness_status', [
  'ACTIVE',
  'PENDING_MAPPING',
  'DRIFT_DETECTED',
  'STALE_SYNC',
  'DISABLED',
]);
export const mappingChangeType = pgEnum('mapping_change_type', [
  'UPSERT',
  'REMOVE',
]);
export const mappingRuleStatus = pgEnum('mapping_rule_status', [
  'PUBLISHED',
  'REMOVED',
]);
export const emptyPolicy = pgEnum('empty_policy', ['BLOCK', 'DEFAULT']);
export const studioStatus = pgEnum('studio_status', ['ACTIVE', 'DISABLED']);
export const integrationClientStatus = pgEnum('integration_client_status', [
  'ACTIVE',
  'DISABLED',
]);
export const integrationEndpointStatus = pgEnum('integration_endpoint_status', [
  'DRAFT',
  'ACTIVE',
  'RETIRED',
  'DISABLED',
]);
export const pricingStatus = pgEnum('pricing_status', [
  'SCHEDULED',
  'ACTIVE',
  'RETIRED',
]);
export const pricingSourceMode = pgEnum('pricing_source_mode', [
  'UNIFORM',
  'PER_STUDIO',
]);
export const scriptBindingStatus = pgEnum('script_binding_status', [
  'ACTIVE',
  'RETIRED',
  'DISABLED',
]);
export const taskExecutionStatus = pgEnum('task_execution_status', [
  'ACCEPTED',
  'BAIYING_CREATING',
  'BAIYING_CREATED',
  'IMPORTING',
  'IMPORTED',
  'STARTING',
  'CALLING',
  'PAUSED',
  'CALL_COMPLETED',
  'RECONCILING',
  'COMPLETED',
  'CREATE_FAILED',
  'IMPORT_FAILED',
  'START_FAILED',
  'CANCELLED',
  'TERMINATED',
]);
export const resultDeliveryStatus = pgEnum('result_delivery_status', [
  'PENDING',
  'DELIVERING',
  'SUCCEEDED',
  'FAILED',
]);
export const recordingArchiveStatus = pgEnum('recording_archive_status', [
  'PENDING',
  'DOWNLOADING',
  'ARCHIVED',
  'PARTIAL',
  'FAILED',
  'NOT_AVAILABLE',
]);
export const recordingDeliveryStatus = pgEnum('recording_delivery_status', [
  'PENDING',
  'DELIVERING',
  'SUCCEEDED',
  'FAILED',
  'NOT_APPLICABLE',
]);
export const billingStatus = pgEnum('billing_status', [
  'RESERVED',
  'SETTLING',
  'SETTLED',
  'FAILED',
]);
export const taskImportStatus = pgEnum('task_import_status', [
  'PENDING',
  'SUCCEEDED',
  'FAILED',
  'DUPLICATED',
]);
export const normalizedCallStatus = pgEnum('normalized_call_status', [
  'PENDING',
  'ANSWERED',
  'NO_ANSWER',
  'BUSY',
  'REJECTED',
  'FAILED',
  'UNKNOWN',
]);
export const taskOperationType = pgEnum('task_operation_type', [
  'CREATE',
  'IMPORT',
  'START',
  'PAUSE',
  'RESUME',
  'TERMINATE',
  'QUERY',
]);
export const taskOperationStatus = pgEnum('task_operation_status', [
  'PENDING',
  'SUCCEEDED',
  'FAILED',
  'UNKNOWN',
]);
export const studioAccountStatus = pgEnum('studio_account_status', [
  'ACTIVE',
  'LOW_BALANCE',
  'OVERDUE',
  'DISABLED',
]);
export const fundHoldStatus = pgEnum('fund_hold_status', [
  'ACTIVE',
  'CAPTURED',
  'RELEASED',
]);
export const accountLedgerEntryType = pgEnum('account_ledger_entry_type', [
  'TOP_UP',
  'TASK_HOLD',
  'TASK_HOLD_RELEASE',
  'CALL_CHARGE',
  'OVERAGE_DEBIT',
  'REFUND',
  'ADJUSTMENT',
]);
export const accountAdjustmentKind = pgEnum('account_adjustment_kind', [
  'REFUND',
  'ADJUSTMENT_CREDIT',
  'ADJUSTMENT_DEBIT',
]);
export const accountAdjustmentStatus = pgEnum('account_adjustment_status', [
  'PENDING',
  'APPROVED',
  'REJECTED',
]);
export const callbackParseStatus = pgEnum('callback_parse_status', [
  'PENDING',
  'VALID',
  'INVALID',
  'UNKNOWN_TYPE',
]);
export const callbackProcessStatus = pgEnum('callback_process_status', [
  'PENDING',
  'PROCESSING',
  'SUCCEEDED',
  'FAILED',
]);
export const recordingKind = pgEnum('recording_kind', ['FULL', 'USER_ONLY']);
export const deliveryTarget = pgEnum('delivery_target', [
  'RESULT',
  'RECORDING',
]);
export const deliveryStatus = pgEnum('delivery_status', [
  'PENDING',
  'DELIVERING',
  'SUCCEEDED',
  'FAILED',
  'DEAD_LETTERED',
]);
export const deliveryAttemptStatus = pgEnum('delivery_attempt_status', [
  'SUCCEEDED',
  'RETRYABLE_FAILURE',
  'PERMANENT_FAILURE',
]);
export const deadLetterSourceType = pgEnum('dead_letter_source_type', [
  'OUTBOX',
  'CALLBACK',
  'RECORDING',
  'DELIVERY',
]);
export const deadLetterStatus = pgEnum('dead_letter_status', [
  'OPEN',
  'REPLAYING',
  'RESOLVED',
  'IGNORED',
]);
export const idempotencyProcessingStatus = pgEnum(
  'idempotency_processing_status',
  ['PENDING', 'COMPLETED', 'FAILED'],
);

export const baiyingScenes = pgTable('baiying_scene', {
  sceneDefId: varchar('scene_def_id', { length: 128 }).primaryKey(),
  robotDefId: varchar('robot_def_id', { length: 128 }).notNull(),
  sceneName: varchar('scene_name', { length: 200 }).notNull(),
  disabled: boolean('disabled').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const baiyingSceneCompanies = pgTable(
  'baiying_scene_company',
  {
    sceneDefId: varchar('scene_def_id', { length: 128 })
      .notNull()
      .references(() => baiyingScenes.sceneDefId, { onDelete: 'cascade' }),
    companyId: varchar('company_id', { length: 64 }).notNull(),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.sceneDefId, table.companyId] })],
);

export const sceneVariableSnapshots = pgTable(
  'baiying_scene_variable_snapshot',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: varchar('company_id', { length: 64 }).notNull(),
    robotDefId: varchar('robot_def_id', { length: 128 }).notNull(),
    sceneDefId: varchar('scene_def_id', { length: 128 })
      .notNull()
      .references(() => baiyingScenes.sceneDefId, { onDelete: 'cascade' }),
    variables: jsonb('variables_json').$type<string[]>().notNull(),
    variablesHash: varchar('variables_hash', { length: 64 }).notNull(),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull(),
    syncStatus: sceneSyncStatus('sync_status').notNull(),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('scene_snapshot_lookup_idx').on(
      table.sceneDefId,
      table.companyId,
      table.syncedAt,
    ),
  ],
);

export const mappingVersions = pgTable(
  'mapping_version',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    version: integer('version').notNull(),
    publisherId: varchar('publisher_id', { length: 128 }).notNull(),
    changeSummary: text('change_summary').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex('mapping_version_number_uq').on(table.version)],
);

export const mappingRules = pgTable(
  'global_variable_mapping',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mappingVersionId: uuid('mapping_version_id')
      .notNull()
      .references(() => mappingVersions.id, { onDelete: 'restrict' }),
    baiyingVariableName: varchar('baiying_variable_name', {
      length: 128,
    }).notNull(),
    erpField: varchar('erp_field', { length: 128 }),
    crmField: varchar('crm_field', { length: 128 }),
    transformConfig: jsonb('transform_config')
      .$type<TransformConfig>()
      .notNull(),
    emptyPolicy: emptyPolicy('empty_policy').notNull(),
    defaultValue: text('default_value'),
    status: mappingRuleStatus('status').notNull().default('PUBLISHED'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('mapping_rule_version_variable_uq').on(
      table.mappingVersionId,
      table.baiyingVariableName,
    ),
    index('mapping_rule_variable_idx').on(table.baiyingVariableName),
    check(
      'mapping_has_source_field_ck',
      sql`${table.status} = 'REMOVED' OR ${table.erpField} IS NOT NULL OR ${table.crmField} IS NOT NULL`,
    ),
    check(
      'mapping_default_value_ck',
      sql`${table.emptyPolicy} <> 'DEFAULT' OR ${table.defaultValue} IS NOT NULL`,
    ),
  ],
);

export const mappingDrafts = pgTable(
  'global_variable_mapping_draft',
  {
    baiyingVariableName: varchar('baiying_variable_name', {
      length: 128,
    }).primaryKey(),
    erpField: varchar('erp_field', { length: 128 }),
    crmField: varchar('crm_field', { length: 128 }),
    transformConfig: jsonb('transform_config').$type<TransformConfig>(),
    emptyPolicy: emptyPolicy('empty_policy'),
    defaultValue: text('default_value'),
    changeType: mappingChangeType('change_type').notNull(),
    removalReason: text('removal_reason'),
    updatedBy: varchar('updated_by', { length: 128 }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'mapping_draft_payload_ck',
      sql`
    (${table.changeType} = 'REMOVE' AND ${table.removalReason} IS NOT NULL)
    OR
    (${table.changeType} = 'UPSERT' AND ${table.transformConfig} IS NOT NULL AND ${table.emptyPolicy} IS NOT NULL AND (${table.erpField} IS NOT NULL OR ${table.crmField} IS NOT NULL))
  `,
    ),
  ],
);

export const sceneMappingReadiness = pgTable('scene_mapping_readiness', {
  sceneDefId: varchar('scene_def_id', { length: 128 })
    .primaryKey()
    .references(() => baiyingScenes.sceneDefId, { onDelete: 'cascade' }),
  status: sceneReadinessStatus('status').notNull(),
  expectedVariablesHash: varchar('expected_variables_hash', { length: 64 }),
  publishedMappingVersionId: uuid('published_mapping_version_id').references(
    () => mappingVersions.id,
    { onDelete: 'restrict' },
  ),
  variables: jsonb('variables_json')
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  missingVariables: jsonb('missing_variables_json')
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  lastSuccessfulSyncAt: timestamp('last_successful_sync_at', {
    withTimezone: true,
  }),
  issueSummary: text('issue_summary'),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const taskMappingSnapshots = pgTable('task_mapping_snapshot', {
  taskId: uuid('task_id').primaryKey(),
  mappingVersionId: uuid('mapping_version_id')
    .notNull()
    .references(() => mappingVersions.id, { onDelete: 'restrict' }),
  variables: jsonb('variables_json').$type<string[]>().notNull(),
  mappingRules: jsonb('mapping_rules_json').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const auditLogs = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  requestId: varchar('request_id', { length: 128 }).notNull(),
  actorId: varchar('actor_id', { length: 128 }).notNull(),
  action: varchar('action', { length: 128 }).notNull(),
  objectType: varchar('object_type', { length: 128 }).notNull(),
  objectId: varchar('object_id', { length: 256 }).notNull(),
  detail: jsonb('detail_json')
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  occurredAt: timestamp('occurred_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const sourceDataCategories = pgTable(
  'source_data_category',
  {
    sourceSystem: varchar('source_system', { length: 32 }).notNull(),
    externalId: varchar('external_id', { length: 256 }).notNull(),
    name: varchar('name', { length: 500 }).notNull().default(''),
    categoryPath: varchar('category_path', { length: 500 }).notNull(),
    level: integer('level'),
    parentId: varchar('parent_id', { length: 256 }),
    active: boolean('active').notNull().default(true),
    fields: jsonb('fields_json')
      .$type<Record<string, string | number | boolean | null>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    syncedAt: timestamp('synced_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.sourceSystem, table.externalId] }),
    index('source_category_active_idx').on(
      table.sourceSystem,
      table.active,
      table.categoryPath,
    ),
  ],
);

export const plannedTaskCategoryBindings = pgTable(
  'planned_task_category_binding',
  {
    workflowId: varchar('workflow_id', { length: 128 }).primaryKey(),
    sourceSystem: varchar('source_system', { length: 32 }).notNull(),
    sourceCategoryId: varchar('source_category_id', { length: 256 }).notNull(),
    categoryPath: varchar('category_path', { length: 500 }).notNull(),
    updatedBy: varchar('updated_by', { length: 128 }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export const baiyingRobotBindings = pgTable('baiying_robot_binding', {
  robotDefId: varchar('robot_def_id', { length: 128 }).primaryKey(),
  sourceSystem: varchar('source_system', { length: 32 }).notNull(),
  sourceCategoryId: varchar('source_category_id', { length: 256 }).notNull(),
  categoryPath: varchar('category_path', { length: 500 }).notNull(),
  categories: jsonb('categories_json')
    .$type<Array<{ sourceCategoryId: string; categoryPath: string }>>()
    .notNull()
    .default([]),
  studioId: varchar('studio_id', { length: 128 }).notNull(),
  studioName: varchar('studio_name', { length: 200 }).notNull(),
  lineId: varchar('line_id', { length: 128 }).notNull(),
  lineName: varchar('line_name', { length: 200 }).notNull(),
  updatedBy: varchar('updated_by', { length: 128 }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const baiyingLineStudioBindings = pgTable(
  'baiying_line_studio_binding',
  {
    userPhoneId: varchar('user_phone_id', { length: 128 }).notNull(),
    studioId: varchar('studio_id', { length: 128 }).notNull(),
    studioName: varchar('studio_name', { length: 200 }).notNull(),
    updatedBy: varchar('updated_by', { length: 128 }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userPhoneId, table.studioId] }),
    index('line_studio_binding_line_idx').on(table.userPhoneId),
  ],
);

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
  syncedAt: timestamp('synced_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const queueOutbox = pgTable(
  'queue_outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventType: varchar('event_type', { length: 128 }).notNull(),
    queueName: varchar('queue_name', { length: 128 }).notNull(),
    payload: jsonb('payload_json').$type<Record<string, unknown>>().notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    availableAt: timestamp('available_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedBy: varchar('locked_by', { length: 128 }),
    lastError: text('last_error'),
    deadLetteredAt: timestamp('dead_lettered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('queue_outbox_pending_idx').on(
      table.publishedAt,
      table.deadLetteredAt,
      table.availableAt,
      table.createdAt,
    ),
    index('queue_outbox_lock_idx').on(table.lockedAt, table.lockedBy),
  ],
);

export const idempotencyRecords = pgTable(
  'idempotency_record',
  {
    sourceSystem: varchar('source_system', { length: 32 }).notNull(),
    clientId: varchar('client_id', { length: 128 }).notNull().default('legacy'),
    idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull(),
    requestId: varchar('request_id', { length: 128 }).notNull(),
    requestBodySha256: char('request_body_sha256', { length: 64 }),
    taskId: uuid('task_id'),
    processingStatus: idempotencyProcessingStatus('processing_status')
      .notNull()
      .default('COMPLETED'),
    responseStatus: integer('response_status').notNull(),
    responseBody: jsonb('response_body_json')
      .$type<Record<string, unknown>>()
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.sourceSystem, table.clientId, table.idempotencyKey],
    }),
    index('idempotency_expiry_idx').on(table.expiresAt),
    index('idempotency_task_idx').on(table.taskId),
  ],
);

// Reserved for high-volume source identifiers without JavaScript bigint coercion.
export const externalSequence = pgTable('external_sequence', {
  name: varchar('name', { length: 64 }).primaryKey(),
  value: bigint('value', { mode: 'bigint' }).notNull(),
});

export const studios = pgTable(
  'studio',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessCode: varchar('business_code', { length: 64 }).notNull(),
    mcCode: varchar('mc_code', { length: 64 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    contactName: varchar('contact_name', { length: 128 }),
    contactPhoneCiphertext: text('contact_phone_ciphertext'),
    contactPhoneMasked: varchar('contact_phone_masked', { length: 32 }),
    status: studioStatus('status').notNull().default('ACTIVE'),
    createdBy: varchar('created_by', { length: 128 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('studio_business_code_uq').on(table.businessCode),
    uniqueIndex('studio_mc_code_uq').on(table.mcCode),
  ],
);

export const integrationClients = pgTable(
  'integration_client',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: varchar('client_id', { length: 128 }).notNull(),
    sourceSystem: varchar('source_system', { length: 32 }).notNull(),
    displayName: varchar('display_name', { length: 200 }).notNull(),
    secretRef: varchar('secret_ref', { length: 500 }).notNull(),
    status: integrationClientStatus('status').notNull().default('ACTIVE'),
    rateLimitPerMinute: integer('rate_limit_per_minute').notNull().default(60),
    createdBy: varchar('created_by', { length: 128 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('integration_client_client_id_uq').on(table.clientId),
    check(
      'integration_client_source_ck',
      sql`${table.sourceSystem} IN ('ERP', 'CRM')`,
    ),
    check(
      'integration_client_rate_limit_ck',
      sql`${table.rateLimitPerMinute} > 0`,
    ),
  ],
);

export const apiRequestNonces = pgTable(
  'api_request_nonce',
  {
    integrationClientId: uuid('integration_client_id')
      .notNull()
      .references(() => integrationClients.id, { onDelete: 'cascade' }),
    nonce: varchar('nonce', { length: 128 }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.integrationClientId, table.nonce] }),
    index('api_request_nonce_expiry_idx').on(table.expiresAt),
    index('api_request_nonce_rate_limit_idx').on(
      table.integrationClientId,
      table.receivedAt,
    ),
  ],
);

export const integrationClientStudios = pgTable(
  'integration_client_studio',
  {
    integrationClientId: uuid('integration_client_id')
      .notNull()
      .references(() => integrationClients.id, { onDelete: 'cascade' }),
    studioId: uuid('studio_id')
      .notNull()
      .references(() => studios.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.integrationClientId, table.studioId] }),
    index('integration_client_studio_studio_idx').on(table.studioId),
  ],
);

export const integrationEndpoints = pgTable(
  'integration_endpoint',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    studioId: uuid('studio_id')
      .notNull()
      .references(() => studios.id, { onDelete: 'restrict' }),
    sourceSystem: varchar('source_system', { length: 32 }).notNull(),
    version: integer('version').notNull(),
    resultUrl: text('result_url').notNull(),
    recordingUrl: text('recording_url').notNull(),
    signingSecretRef: varchar('signing_secret_ref', { length: 500 }),
    status: integrationEndpointStatus('status').notNull().default('DRAFT'),
    effectiveAt: timestamp('effective_at', { withTimezone: true }),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
    createdBy: varchar('created_by', { length: 128 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('integration_endpoint_version_uq').on(
      table.studioId,
      table.sourceSystem,
      table.version,
    ),
    uniqueIndex('integration_endpoint_active_uq')
      .on(table.studioId, table.sourceSystem)
      .where(sql`${table.status} = 'ACTIVE'`),
    check(
      'integration_endpoint_source_ck',
      sql`${table.sourceSystem} IN ('ERP', 'CRM')`,
    ),
    check('integration_endpoint_version_ck', sql`${table.version} > 0`),
    check(
      'integration_endpoint_active_secret_ck',
      sql`${table.status} <> 'ACTIVE' OR ${table.signingSecretRef} IS NOT NULL`,
    ),
  ],
);

export const studioPricingVersions = pgTable(
  'studio_pricing_version',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    studioId: uuid('studio_id')
      .notNull()
      .references(() => studios.id, { onDelete: 'restrict' }),
    version: integer('version').notNull(),
    voiceRate: numeric('voice_rate', { precision: 18, scale: 6 }).notNull(),
    smsRate: numeric('sms_rate', { precision: 18, scale: 6 }).notNull(),
    frozenMinutes: integer('frozen_minutes').notNull(),
    sourceMode: pricingSourceMode('source_mode').notNull(),
    status: pricingStatus('status').notNull(),
    effectiveFrom: timestamp('effective_from', {
      withTimezone: true,
    }).notNull(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    publishedBy: varchar('published_by', { length: 128 }).notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('studio_pricing_version_uq').on(table.studioId, table.version),
    uniqueIndex('studio_pricing_active_uq')
      .on(table.studioId)
      .where(sql`${table.status} = 'ACTIVE'`),
    check('studio_pricing_voice_rate_ck', sql`${table.voiceRate} >= 0`),
    check('studio_pricing_sms_rate_ck', sql`${table.smsRate} >= 0`),
    check('studio_pricing_frozen_minutes_ck', sql`${table.frozenMinutes} > 0`),
    check(
      'studio_pricing_effective_range_ck',
      sql`${table.effectiveTo} IS NULL OR ${table.effectiveTo} > ${table.effectiveFrom}`,
    ),
  ],
);

export const supplierPricingTiers = pgTable(
  'supplier_pricing_tier',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tierCode: varchar('tier_code', { length: 64 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    minMonthlyMinutes: bigint('min_monthly_minutes', {
      mode: 'bigint',
    }).notNull(),
    maxMonthlyMinutes: bigint('max_monthly_minutes', { mode: 'bigint' }),
    voiceRate: numeric('voice_rate', { precision: 18, scale: 6 }).notNull(),
    smsRate: numeric('sms_rate', { precision: 18, scale: 6 }).notNull(),
    effectiveFrom: timestamp('effective_from', {
      withTimezone: true,
    }).notNull(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    publishedBy: varchar('published_by', { length: 128 }).notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('supplier_pricing_tier_code_uq').on(table.tierCode),
    check('supplier_pricing_min_ck', sql`${table.minMonthlyMinutes} >= 0`),
    check(
      'supplier_pricing_max_ck',
      sql`${table.maxMonthlyMinutes} IS NULL OR ${table.maxMonthlyMinutes} > ${table.minMonthlyMinutes}`,
    ),
    check(
      'supplier_pricing_rate_ck',
      sql`${table.voiceRate} >= 0 AND ${table.smsRate} >= 0`,
    ),
    check(
      'supplier_pricing_effective_range_ck',
      sql`${table.effectiveTo} IS NULL OR ${table.effectiveTo} > ${table.effectiveFrom}`,
    ),
  ],
);

export const scriptBindings = pgTable(
  'script_binding',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    robotDefId: varchar('robot_def_id', { length: 128 }).notNull(),
    studioId: uuid('studio_id')
      .notNull()
      .references(() => studios.id, { onDelete: 'restrict' }),
    sourceSystem: varchar('source_system', { length: 32 }).notNull(),
    userPhoneId: varchar('user_phone_id', { length: 128 })
      .notNull()
      .references(() => baiyingPhoneLines.userPhoneId, {
        onDelete: 'restrict',
      }),
    status: scriptBindingStatus('status').notNull().default('ACTIVE'),
    version: integer('version').notNull(),
    createdBy: varchar('created_by', { length: 128 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('script_binding_version_uq').on(
      table.robotDefId,
      table.studioId,
      table.sourceSystem,
      table.version,
    ),
    uniqueIndex('script_binding_active_uq')
      .on(table.robotDefId, table.studioId, table.sourceSystem)
      .where(sql`${table.status} = 'ACTIVE'`),
    uniqueIndex('script_binding_identity_uq').on(
      table.id,
      table.studioId,
      table.sourceSystem,
    ),
    check(
      'script_binding_source_ck',
      sql`${table.sourceSystem} IN ('ERP', 'CRM')`,
    ),
    check('script_binding_version_ck', sql`${table.version} > 0`),
  ],
);

export const scriptCategoryBindings = pgTable(
  'script_category_binding',
  {
    scriptBindingId: uuid('script_binding_id')
      .notNull()
      .references(() => scriptBindings.id, { onDelete: 'cascade' }),
    studioId: uuid('studio_id').notNull(),
    sourceSystem: varchar('source_system', { length: 32 }).notNull(),
    sourceCategoryId: varchar('source_category_id', { length: 256 }).notNull(),
    categoryPath: varchar('category_path', { length: 500 }).notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.scriptBindingId, table.sourceCategoryId] }),
    foreignKey({
      columns: [table.scriptBindingId, table.studioId, table.sourceSystem],
      foreignColumns: [
        scriptBindings.id,
        scriptBindings.studioId,
        scriptBindings.sourceSystem,
      ],
      name: 'script_category_binding_identity_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.sourceSystem, table.sourceCategoryId],
      foreignColumns: [
        sourceDataCategories.sourceSystem,
        sourceDataCategories.externalId,
      ],
      name: 'script_category_binding_source_category_fk',
    }).onDelete('restrict'),
    uniqueIndex('script_category_binding_active_uq')
      .on(table.studioId, table.sourceSystem, table.sourceCategoryId)
      .where(sql`${table.active} = true`),
    index('script_category_binding_script_idx').on(
      table.scriptBindingId,
      table.active,
    ),
  ],
);

export const platformTasks = pgTable(
  'platform_task',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskNo: varchar('task_no', { length: 64 }).notNull(),
    externalRequestId: varchar('external_request_id', {
      length: 128,
    }).notNull(),
    sourceSystem: varchar('source_system', { length: 32 }).notNull(),
    integrationClientId: uuid('integration_client_id')
      .notNull()
      .references(() => integrationClients.id, { onDelete: 'restrict' }),
    studioId: uuid('studio_id')
      .notNull()
      .references(() => studios.id, { onDelete: 'restrict' }),
    studioNameSnapshot: varchar('studio_name_snapshot', {
      length: 200,
    }).notNull(),
    mcCodeSnapshot: varchar('mc_code_snapshot', { length: 64 }).notNull(),
    taskName: varchar('task_name', { length: 200 }).notNull(),
    phoneCount: integer('phone_count').notNull(),
    categorySnapshot: jsonb('category_snapshot_json')
      .$type<Array<{ id: string; path: string }>>()
      .notNull(),
    robotDefId: varchar('robot_def_id', { length: 128 }).notNull(),
    robotName: varchar('robot_name', { length: 200 }).notNull(),
    userPhoneId: varchar('user_phone_id', { length: 128 }).notNull(),
    lineName: varchar('line_name', { length: 200 }).notNull(),
    mappingVersionId: uuid('mapping_version_id')
      .notNull()
      .references(() => mappingVersions.id, { onDelete: 'restrict' }),
    pricingVersionId: uuid('pricing_version_id')
      .notNull()
      .references(() => studioPricingVersions.id, { onDelete: 'restrict' }),
    endpointVersionId: uuid('endpoint_version_id')
      .notNull()
      .references(() => integrationEndpoints.id, { onDelete: 'restrict' }),
    endpointSnapshot: jsonb('endpoint_snapshot_json')
      .$type<{
        resultUrl: string;
        recordingUrl: string;
        signingSecretRef: string;
      }>()
      .notNull(),
    customerRate: numeric('customer_rate', {
      precision: 18,
      scale: 6,
    }).notNull(),
    frozenMinutes: integer('frozen_minutes').notNull(),
    reservedAmount: numeric('reserved_amount', {
      precision: 18,
      scale: 6,
    }).notNull(),
    customerCharge: numeric('customer_charge', { precision: 18, scale: 6 })
      .notNull()
      .default('0'),
    platformRate: numeric('platform_rate', { precision: 18, scale: 6 }),
    platformCost: numeric('platform_cost', { precision: 18, scale: 6 }),
    profit: numeric('profit', { precision: 18, scale: 6 }),
    baiyingCompanyId: varchar('baiying_company_id', { length: 64 }).notNull(),
    baiyingCallJobId: varchar('baiying_call_job_id', { length: 64 }),
    executionStatus: taskExecutionStatus('execution_status')
      .notNull()
      .default('ACCEPTED'),
    providerStatus: integer('provider_status'),
    resultDeliveryStatus: resultDeliveryStatus('result_delivery_status')
      .notNull()
      .default('PENDING'),
    recordingArchiveStatus: recordingArchiveStatus('recording_archive_status')
      .notNull()
      .default('PENDING'),
    recordingDeliveryStatus: recordingDeliveryStatus(
      'recording_delivery_status',
    )
      .notNull()
      .default('PENDING'),
    billingStatus: billingStatus('billing_status')
      .notNull()
      .default('RESERVED'),
    importRequestedCount: integer('import_requested_count')
      .notNull()
      .default(0),
    importSucceededCount: integer('import_succeeded_count')
      .notNull()
      .default(0),
    importFailedCount: integer('import_failed_count').notNull().default(0),
    importRepeatedCount: integer('import_repeated_count').notNull().default(0),
    callInstanceCount: integer('call_instance_count').notNull().default(0),
    recordingDiscoveredCount: integer('recording_discovered_count')
      .notNull()
      .default(0),
    recordingArchivedCount: integer('recording_archived_count')
      .notNull()
      .default(0),
    recordingDeliveredCount: integer('recording_delivered_count')
      .notNull()
      .default(0),
    totalDurationSeconds: integer('total_duration_seconds')
      .notNull()
      .default(0),
    billingMinutes: integer('billing_minutes').notNull().default(0),
    failureStage: varchar('failure_stage', { length: 64 }),
    failureCode: varchar('failure_code', { length: 128 }),
    failureMessage: text('failure_message'),
    failureRetryable: boolean('failure_retryable'),
    lastRetryAt: timestamp('last_retry_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    providerCompletedAt: timestamp('provider_completed_at', {
      withTimezone: true,
    }),
    reconciledAt: timestamp('reconciled_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lockVersion: integer('lock_version').notNull().default(0),
  },
  (table) => [
    uniqueIndex('platform_task_task_no_uq').on(table.taskNo),
    uniqueIndex('platform_task_external_request_uq').on(
      table.integrationClientId,
      table.externalRequestId,
    ),
    uniqueIndex('platform_task_baiying_job_uq')
      .on(table.baiyingCompanyId, table.baiyingCallJobId)
      .where(sql`${table.baiyingCallJobId} IS NOT NULL`),
    index('platform_task_list_idx').on(table.studioId, table.createdAt),
    index('platform_task_status_idx').on(
      table.executionStatus,
      table.updatedAt,
    ),
    check(
      'platform_task_source_ck',
      sql`${table.sourceSystem} IN ('ERP', 'CRM')`,
    ),
    check(
      'platform_task_phone_count_ck',
      sql`${table.phoneCount} > 0 AND ${table.phoneCount} <= 10000`,
    ),
    check(
      'platform_task_money_ck',
      sql`${table.customerRate} >= 0 AND ${table.reservedAmount} >= 0 AND ${table.customerCharge} >= 0`,
    ),
    check('platform_task_frozen_minutes_ck', sql`${table.frozenMinutes} > 0`),
  ],
);

export const taskCallItems = pgTable(
  'task_call_item',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => platformTasks.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    externalCustomerId: varchar('external_customer_id', {
      length: 128,
    }).notNull(),
    dataCategoryId: varchar('data_category_id', { length: 256 }).notNull(),
    categoryPath: varchar('category_path', { length: 500 }).notNull(),
    phoneCiphertext: text('phone_ciphertext').notNull(),
    phoneHmac: char('phone_hmac', { length: 64 }).notNull(),
    phoneTail4: char('phone_tail4', { length: 4 }).notNull(),
    customerNameCiphertext: text('customer_name_ciphertext'),
    sourceFieldsCiphertext: text('source_fields_ciphertext').notNull(),
    mappedPropertiesCiphertext: text('mapped_properties_ciphertext').notNull(),
    importStatus: taskImportStatus('import_status')
      .notNull()
      .default('PENDING'),
    importError: text('import_error'),
    callStatus: normalizedCallStatus('call_status')
      .notNull()
      .default('PENDING'),
    durationSeconds: integer('duration_seconds').notNull().default(0),
    billingMinutes: integer('billing_minutes').notNull().default(0),
    customerCharge: numeric('customer_charge', { precision: 18, scale: 6 })
      .notNull()
      .default('0'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('task_call_item_ordinal_uq').on(table.taskId, table.ordinal),
    uniqueIndex('task_call_item_customer_uq').on(
      table.taskId,
      table.externalCustomerId,
    ),
    uniqueIndex('task_call_item_phone_uq').on(table.taskId, table.phoneHmac),
    index('task_call_item_status_idx').on(table.taskId, table.callStatus),
    check('task_call_item_ordinal_ck', sql`${table.ordinal} > 0`),
    check(
      'task_call_item_duration_ck',
      sql`${table.durationSeconds} >= 0 AND ${table.billingMinutes} >= 0 AND ${table.customerCharge} >= 0`,
    ),
  ],
);

export const taskOperations = pgTable(
  'task_operation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => platformTasks.id, { onDelete: 'cascade' }),
    operationType: taskOperationType('operation_type').notNull(),
    attemptNo: integer('attempt_no').notNull(),
    requestPayloadRedacted: jsonb('request_payload_redacted_json')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    responsePayloadRedacted: jsonb('response_payload_redacted_json').$type<
      Record<string, unknown>
    >(),
    providerRequestId: varchar('provider_request_id', { length: 128 }),
    status: taskOperationStatus('status').notNull().default('PENDING'),
    errorClass: varchar('error_class', { length: 128 }),
    errorCode: varchar('error_code', { length: 128 }),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('task_operation_attempt_uq').on(
      table.taskId,
      table.operationType,
      table.attemptNo,
    ),
    index('task_operation_status_idx').on(table.status, table.startedAt),
    check('task_operation_attempt_ck', sql`${table.attemptNo} > 0`),
  ],
);

export const callbackInbox = pgTable(
  'callback_inbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: varchar('provider', { length: 64 }).notNull().default('BAIYING'),
    callbackType: varchar('callback_type', { length: 128 }).notNull(),
    eventKey: varchar('event_key', { length: 512 }).notNull(),
    rawBodyCiphertext: text('raw_body_ciphertext').notNull(),
    rawBodySha256: char('raw_body_sha256', { length: 64 }).notNull(),
    headers: jsonb('headers_json')
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    parseStatus: callbackParseStatus('parse_status')
      .notNull()
      .default('PENDING'),
    processStatus: callbackProcessStatus('process_status')
      .notNull()
      .default('PENDING'),
    processAttempts: integer('process_attempts').notNull().default(0),
    availableAt: timestamp('available_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedBy: varchar('locked_by', { length: 128 }),
    deadLetteredAt: timestamp('dead_lettered_at', { withTimezone: true }),
    parseError: text('parse_error'),
    processError: text('process_error'),
    receivedAt: timestamp('received_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('callback_inbox_event_key_uq').on(table.eventKey),
    index('callback_inbox_pending_idx').on(
      table.processStatus,
      table.deadLetteredAt,
      table.availableAt,
      table.receivedAt,
    ),
    index('callback_inbox_lock_idx').on(table.lockedAt, table.lockedBy),
    index('callback_inbox_body_sha_idx').on(table.rawBodySha256),
    check('callback_inbox_attempts_ck', sql`${table.processAttempts} >= 0`),
  ],
);

export const callInstances = pgTable(
  'call_instance',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: varchar('company_id', { length: 64 }).notNull(),
    callInstanceId: varchar('call_instance_id', { length: 64 }).notNull(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => platformTasks.id, { onDelete: 'cascade' }),
    taskCallItemId: uuid('task_call_item_id')
      .notNull()
      .references(() => taskCallItems.id, { onDelete: 'restrict' }),
    callbackInboxId: uuid('callback_inbox_id').references(
      () => callbackInbox.id,
      { onDelete: 'set null' },
    ),
    callStatus: normalizedCallStatus('call_status').notNull(),
    providerCallStatus: integer('provider_call_status'),
    finishStatus: integer('finish_status'),
    calledTimes: integer('called_times'),
    durationSeconds: integer('duration_seconds').notNull().default(0),
    billingMinutes: integer('billing_minutes').notNull().default(0),
    customerCharge: numeric('customer_charge', { precision: 18, scale: 6 })
      .notNull()
      .default('0'),
    collectProperties: jsonb('collect_properties_json')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    providerOccurredAt: timestamp('provider_occurred_at', {
      withTimezone: true,
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('call_instance_provider_uq').on(
      table.companyId,
      table.callInstanceId,
    ),
    index('call_instance_task_idx').on(table.taskId, table.createdAt),
    check(
      'call_instance_duration_ck',
      sql`${table.durationSeconds} >= 0 AND ${table.billingMinutes} >= 0 AND ${table.customerCharge} >= 0`,
    ),
  ],
);

export const studioAccounts = pgTable(
  'studio_account',
  {
    studioId: uuid('studio_id')
      .primaryKey()
      .references(() => studios.id, { onDelete: 'restrict' }),
    currency: char('currency', { length: 3 }).notNull().default('CNY'),
    balance: numeric('balance', { precision: 18, scale: 6 })
      .notNull()
      .default('0'),
    activeHoldAmount: numeric('active_hold_amount', { precision: 18, scale: 6 })
      .notNull()
      .default('0'),
    status: studioAccountStatus('status').notNull().default('ACTIVE'),
    lockVersion: integer('lock_version').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check('studio_account_currency_ck', sql`${table.currency} = 'CNY'`),
    check('studio_account_hold_ck', sql`${table.activeHoldAmount} >= 0`),
  ],
);

export const fundHolds = pgTable(
  'fund_hold',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    studioId: uuid('studio_id')
      .notNull()
      .references(() => studios.id, { onDelete: 'restrict' }),
    taskId: uuid('task_id')
      .notNull()
      .references(() => platformTasks.id, { onDelete: 'restrict' }),
    originalAmount: numeric('original_amount', {
      precision: 18,
      scale: 6,
    }).notNull(),
    remainingAmount: numeric('remaining_amount', {
      precision: 18,
      scale: 6,
    }).notNull(),
    status: fundHoldStatus('status').notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    releasedAt: timestamp('released_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('fund_hold_task_uq').on(table.taskId),
    index('fund_hold_studio_status_idx').on(table.studioId, table.status),
    check(
      'fund_hold_amount_ck',
      sql`${table.originalAmount} > 0 AND ${table.remainingAmount} >= 0 AND ${table.remainingAmount} <= ${table.originalAmount}`,
    ),
  ],
);

export const accountLedger = pgTable(
  'account_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    studioId: uuid('studio_id')
      .notNull()
      .references(() => studios.id, { onDelete: 'restrict' }),
    taskId: uuid('task_id').references(() => platformTasks.id, {
      onDelete: 'restrict',
    }),
    callInstanceId: uuid('call_instance_id').references(
      () => callInstances.id,
      { onDelete: 'restrict' },
    ),
    entryType: accountLedgerEntryType('entry_type').notNull(),
    amount: numeric('amount', { precision: 18, scale: 6 }).notNull(),
    balanceAfter: numeric('balance_after', {
      precision: 18,
      scale: 6,
    }).notNull(),
    availableBalanceAfter: numeric('available_balance_after', {
      precision: 18,
      scale: 6,
    }).notNull(),
    businessKey: varchar('business_key', { length: 256 }).notNull(),
    operatorId: varchar('operator_id', { length: 128 }),
    reason: text('reason'),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('account_ledger_business_key_uq').on(table.businessKey),
    index('account_ledger_studio_time_idx').on(
      table.studioId,
      table.occurredAt,
    ),
    index('account_ledger_task_idx').on(table.taskId),
  ],
);

export const accountAdjustmentRequests = pgTable(
  'account_adjustment_request',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestNo: varchar('request_no', { length: 64 }).notNull(),
    idempotencyKey: uuid('idempotency_key').notNull(),
    studioId: uuid('studio_id')
      .notNull()
      .references(() => studios.id, { onDelete: 'restrict' }),
    kind: accountAdjustmentKind('kind').notNull(),
    amount: numeric('amount', { precision: 18, scale: 6 }).notNull(),
    balanceSnapshot: numeric('balance_snapshot', {
      precision: 18,
      scale: 6,
    }).notNull(),
    availableBalanceSnapshot: numeric('available_balance_snapshot', {
      precision: 18,
      scale: 6,
    }).notNull(),
    reason: text('reason').notNull(),
    supportingReference: varchar('supporting_reference', { length: 256 }),
    status: accountAdjustmentStatus('status').notNull().default('PENDING'),
    requestedBy: varchar('requested_by', { length: 128 }).notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    reviewedBy: varchar('reviewed_by', { length: 128 }),
    reviewNote: text('review_note'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    ledgerId: uuid('ledger_id').references(() => accountLedger.id, {
      onDelete: 'restrict',
    }),
    lockVersion: integer('lock_version').notNull().default(0),
  },
  (table) => [
    uniqueIndex('account_adjustment_request_no_uq').on(table.requestNo),
    uniqueIndex('account_adjustment_idempotency_uq').on(table.idempotencyKey),
    uniqueIndex('account_adjustment_ledger_uq').on(table.ledgerId),
    index('account_adjustment_status_time_idx').on(
      table.status,
      table.requestedAt,
    ),
    index('account_adjustment_studio_time_idx').on(
      table.studioId,
      table.requestedAt,
    ),
    check('account_adjustment_amount_ck', sql`${table.amount} > 0`),
    check(
      'account_adjustment_separation_ck',
      sql`${table.reviewedBy} IS NULL OR ${table.reviewedBy} <> ${table.requestedBy}`,
    ),
    check(
      'account_adjustment_state_ck',
      sql`(
        (${table.status} = 'PENDING' AND ${table.reviewedBy} IS NULL AND ${table.reviewNote} IS NULL AND ${table.reviewedAt} IS NULL AND ${table.ledgerId} IS NULL)
        OR
        (${table.status} = 'APPROVED' AND ${table.reviewedBy} IS NOT NULL AND ${table.reviewNote} IS NOT NULL AND ${table.reviewedAt} IS NOT NULL AND ${table.ledgerId} IS NOT NULL)
        OR
        (${table.status} = 'REJECTED' AND ${table.reviewedBy} IS NOT NULL AND ${table.reviewNote} IS NOT NULL AND ${table.reviewedAt} IS NOT NULL AND ${table.ledgerId} IS NULL)
      )`,
    ),
  ],
);

export const recordingAssets = pgTable(
  'recording_asset',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    callInstanceId: uuid('call_instance_id')
      .notNull()
      .references(() => callInstances.id, { onDelete: 'restrict' }),
    kind: recordingKind('kind').notNull(),
    providerUrlCiphertext: text('provider_url_ciphertext').notNull(),
    ossBucket: varchar('oss_bucket', { length: 255 }),
    ossObjectKey: varchar('oss_object_key', { length: 1024 }),
    contentType: varchar('content_type', { length: 128 }),
    sizeBytes: bigint('size_bytes', { mode: 'bigint' }),
    sha256: char('sha256', { length: 64 }),
    archiveStatus: recordingArchiveStatus('archive_status')
      .notNull()
      .default('PENDING'),
    deliveryStatus: recordingDeliveryStatus('delivery_status')
      .notNull()
      .default('PENDING'),
    downloadAttempts: integer('download_attempts').notNull().default(0),
    availableAt: timestamp('available_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedBy: varchar('locked_by', { length: 128 }),
    deadLetteredAt: timestamp('dead_lettered_at', { withTimezone: true }),
    lastError: text('last_error'),
    discoveredAt: timestamp('discovered_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    retentionUntil: timestamp('retention_until', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('recording_asset_call_kind_uq').on(
      table.callInstanceId,
      table.kind,
    ),
    uniqueIndex('recording_asset_object_key_uq')
      .on(table.ossBucket, table.ossObjectKey)
      .where(sql`${table.ossObjectKey} IS NOT NULL`),
    index('recording_asset_archive_idx').on(
      table.archiveStatus,
      table.deadLetteredAt,
      table.availableAt,
      table.discoveredAt,
    ),
    index('recording_asset_lock_idx').on(table.lockedAt, table.lockedBy),
    check(
      'recording_asset_size_ck',
      sql`${table.sizeBytes} IS NULL OR ${table.sizeBytes} >= 0`,
    ),
  ],
);

export const recordingUrlIssues = pgTable(
  'recording_url_issue',
  {
    integrationClientId: uuid('integration_client_id')
      .notNull()
      .references(() => integrationClients.id, { onDelete: 'restrict' }),
    sourceSystem: varchar('source_system', { length: 32 }).notNull(),
    idempotencyKeyHash: char('idempotency_key_hash', { length: 64 }).notNull(),
    requestFingerprint: char('request_fingerprint', { length: 64 }).notNull(),
    recordingId: uuid('recording_id')
      .notNull()
      .references(() => recordingAssets.id, { onDelete: 'restrict' }),
    requestId: varchar('request_id', { length: 128 }).notNull(),
    responseStatus: integer('response_status').notNull(),
    responseBody: jsonb('response_body_json')
      .$type<RecordingDownloadUrlEnvelope>()
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.integrationClientId, table.idempotencyKeyHash],
    }),
    index('recording_url_issue_expiry_idx').on(table.expiresAt),
    index('recording_url_issue_recording_idx').on(table.recordingId),
    check(
      'recording_url_issue_source_ck',
      sql`${table.sourceSystem} IN ('ERP', 'CRM')`,
    ),
    check('recording_url_issue_status_ck', sql`${table.responseStatus} = 200`),
    check(
      'recording_url_issue_expiry_ck',
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
  ],
);

export const deliveryEvents = pgTable(
  'delivery_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id').notNull(),
    eventKey: varchar('event_key', { length: 512 }).notNull(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => platformTasks.id, { onDelete: 'restrict' }),
    endpointVersionId: uuid('endpoint_version_id')
      .notNull()
      .references(() => integrationEndpoints.id, { onDelete: 'restrict' }),
    sourceSystem: varchar('source_system', { length: 32 }).notNull(),
    target: deliveryTarget('target').notNull(),
    eventType: varchar('event_type', { length: 128 }).notNull(),
    targetUrlSnapshot: text('target_url_snapshot').notNull(),
    payload: jsonb('payload_json').$type<Record<string, unknown>>(),
    payloadObjectKey: varchar('payload_object_key', { length: 1024 }),
    status: deliveryStatus('status').notNull().default('PENDING'),
    attemptCount: integer('attempt_count').notNull().default(0),
    retryCycleAttemptCount: integer('retry_cycle_attempt_count')
      .notNull()
      .default(0),
    availableAt: timestamp('available_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedBy: varchar('locked_by', { length: 128 }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('delivery_event_event_id_uq').on(table.eventId),
    uniqueIndex('delivery_event_event_key_uq').on(table.eventKey),
    index('delivery_event_pending_idx').on(table.status, table.availableAt),
    check(
      'delivery_event_source_ck',
      sql`${table.sourceSystem} IN ('ERP', 'CRM')`,
    ),
    check(
      'delivery_event_payload_ck',
      sql`${table.payload} IS NOT NULL OR ${table.payloadObjectKey} IS NOT NULL`,
    ),
    check(
      'delivery_event_attempts_ck',
      sql`${table.attemptCount} >= 0 AND ${table.retryCycleAttemptCount} >= 0`,
    ),
  ],
);

export const deliveryAttempts = pgTable(
  'delivery_attempt',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    deliveryEventId: uuid('delivery_event_id')
      .notNull()
      .references(() => deliveryEvents.id, { onDelete: 'cascade' }),
    attemptNo: integer('attempt_no').notNull(),
    status: deliveryAttemptStatus('status').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    responseStatus: integer('response_status'),
    responseSummary: text('response_summary'),
    errorClass: varchar('error_class', { length: 128 }),
    errorMessage: text('error_message'),
    durationMs: integer('duration_ms').notNull(),
  },
  (table) => [
    uniqueIndex('delivery_attempt_number_uq').on(
      table.deliveryEventId,
      table.attemptNo,
    ),
    check(
      'delivery_attempt_values_ck',
      sql`${table.attemptNo} > 0 AND ${table.durationMs} >= 0`,
    ),
  ],
);

export const deadLetterEvents = pgTable(
  'dead_letter_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceType: deadLetterSourceType('source_type').notNull(),
    sourceId: uuid('source_id').notNull(),
    originalEvent: jsonb('original_event_json').$type<
      Record<string, unknown>
    >(),
    originalObjectKey: varchar('original_object_key', { length: 1024 }),
    finalError: text('final_error').notNull(),
    suggestedAction: text('suggested_action'),
    status: deadLetterStatus('status').notNull().default('OPEN'),
    replayCount: integer('replay_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedBy: varchar('resolved_by', { length: 128 }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolutionNote: text('resolution_note'),
  },
  (table) => [
    uniqueIndex('dead_letter_source_uq').on(table.sourceType, table.sourceId),
    index('dead_letter_status_idx').on(table.status, table.createdAt),
    check(
      'dead_letter_payload_ck',
      sql`${table.originalEvent} IS NOT NULL OR ${table.originalObjectKey} IS NOT NULL`,
    ),
  ],
);

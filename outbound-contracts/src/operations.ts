import { z } from 'zod';
import {
  decimalAmountSchema,
  ledgerEntryTypeSchema,
  nonNegativeAmountSchema,
} from './billing.js';
import { sourceSystemSchema } from './envelope.js';
import { taskExecutionStatusSchema } from './outbound-task.js';

export const operatorStudioStatusSchema = z.enum(['ACTIVE', 'DISABLED']);
export const operatorAccountStatusSchema = z.enum([
  'ACTIVE',
  'LOW_BALANCE',
  'OVERDUE',
  'DISABLED',
]);
export const pricingSourceModeSchema = z.enum(['UNIFORM', 'PER_STUDIO']);
export const pricingVersionStatusSchema = z.enum([
  'SCHEDULED',
  'ACTIVE',
  'RETIRED',
]);

export const operatorAccountSchema = z.object({
  currency: z.literal('CNY'),
  balance: decimalAmountSchema,
  activeHoldAmount: nonNegativeAmountSchema,
  availableBalance: decimalAmountSchema,
  status: operatorAccountStatusSchema,
  lockVersion: z.number().int().nonnegative(),
  updatedAt: z.iso.datetime({ offset: true }),
});

export const operatorEndpointSchema = z.object({
  id: z.uuid(),
  sourceSystem: sourceSystemSchema,
  version: z.number().int().positive(),
  resultUrl: z.url(),
  recordingUrl: z.url(),
  secretConfigured: z.boolean(),
  status: z.enum(['DRAFT', 'ACTIVE', 'RETIRED', 'DISABLED']),
  effectiveAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});

export const operatorPricingVersionSchema = z.object({
  id: z.uuid(),
  studioId: z.uuid(),
  version: z.number().int().positive(),
  voiceRate: nonNegativeAmountSchema,
  smsRate: nonNegativeAmountSchema,
  frozenMinutes: z.number().int().positive().max(120),
  sourceMode: pricingSourceModeSchema,
  status: pricingVersionStatusSchema,
  effectiveFrom: z.iso.datetime({ offset: true }),
  effectiveTo: z.iso.datetime({ offset: true }).nullable(),
  publishedBy: z.string().min(1).max(128),
  publishedAt: z.iso.datetime({ offset: true }),
});

export const operatorStudioSchema = z.object({
  id: z.uuid(),
  businessCode: z.string().min(1).max(64),
  mcCode: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  contactName: z.string().max(128).nullable(),
  contactPhoneMasked: z.string().max(32).nullable(),
  status: operatorStudioStatusSchema,
  account: operatorAccountSchema,
  taskCount: z.number().int().nonnegative(),
  billedMinutes: z.number().int().nonnegative(),
  currentPricing: operatorPricingVersionSchema.nullable(),
  scheduledPricing: operatorPricingVersionSchema.nullable(),
  pricingVersionCount: z.number().int().nonnegative(),
  endpoints: z.array(operatorEndpointSchema),
  createdBy: z.string().min(1).max(128),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});

export const operatorStudioSummarySchema = z.object({
  all: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
  disabled: z.number().int().nonnegative(),
  accountActive: z.number().int().nonnegative(),
  lowBalance: z.number().int().nonnegative(),
  overdue: z.number().int().nonnegative(),
  accountDisabled: z.number().int().nonnegative(),
  totalBalance: decimalAmountSchema,
  totalActiveHold: nonNegativeAmountSchema,
  totalAvailable: decimalAmountSchema,
});

export const operatorStudioPageSchema = z.object({
  total: z.number().int().nonnegative(),
  pages: z.number().int().nonnegative(),
  pageNum: z.number().int().nonnegative(),
  pageSize: z.number().int().positive().max(100),
  summary: operatorStudioSummarySchema,
  studios: z.array(operatorStudioSchema),
});

export const createOperatorStudioInputSchema = z
  .object({
    name: z.string().trim().min(2).max(200),
    mcCode: z.string().trim().min(2).max(64),
    contactName: z.string().trim().max(128).nullable().optional(),
    contactPhone: z
      .string()
      .trim()
      .regex(/^\+?[1-9]\d{6,14}$/, '联系人手机号格式不正确')
      .nullable()
      .optional(),
  })
  .strict();

export const updateOperatorStudioInputSchema = z
  .object({
    name: z.string().trim().min(2).max(200).optional(),
    mcCode: z.string().trim().min(2).max(64).optional(),
    contactName: z.string().trim().max(128).nullable().optional(),
    contactPhone: z
      .string()
      .trim()
      .regex(/^\+?[1-9]\d{6,14}$/, '联系人手机号格式不正确')
      .nullable()
      .optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, '至少提交一个变更字段');

export const setOperatorStudioStatusInputSchema = z
  .object({
    status: operatorStudioStatusSchema,
    reason: z.string().trim().min(2).max(500),
  })
  .strict();

export const accountEvidenceChannelSchema = z.enum([
  'CORPORATE_TRANSFER',
  'WECHAT',
  'ALIPAY',
  'BANK_RECEIPT',
  'OTHER',
]);

export const accountLedgerEvidenceSchema = z.object({
  channel: accountEvidenceChannelSchema,
  receiptReference: z.string().min(1).max(128),
  receiptFileName: z.string().min(1).max(255).nullable(),
});

export const operatorLedgerEntrySchema = z.object({
  ledgerId: z.uuid(),
  studioId: z.uuid(),
  studioBusinessCode: z.string().min(1).max(64),
  studioName: z.string().min(1).max(200),
  taskNo: z
    .string()
    .regex(/^PT-\d{8}-\d{5,}$/)
    .nullable(),
  type: ledgerEntryTypeSchema,
  amount: decimalAmountSchema,
  balanceAfter: decimalAmountSchema,
  availableBalanceAfter: decimalAmountSchema,
  businessKey: z.string().min(1).max(256),
  operatorId: z.string().max(128).nullable(),
  reason: z.string().max(500).nullable(),
  evidence: accountLedgerEvidenceSchema.nullable(),
  occurredAt: z.iso.datetime({ offset: true }),
});

export const operatorLedgerPageSchema = z.object({
  total: z.number().int().nonnegative(),
  pages: z.number().int().nonnegative(),
  pageNum: z.number().int().nonnegative(),
  pageSize: z.number().int().positive().max(100),
  totalTopUp: nonNegativeAmountSchema,
  totalCharge: nonNegativeAmountSchema,
  items: z.array(operatorLedgerEntrySchema),
});

export const operatorTopUpResultSchema = z.object({
  entry: operatorLedgerEntrySchema,
  studio: operatorStudioSchema,
});

const positiveAmountSchema = nonNegativeAmountSchema.refine(
  (value) => Number(value) > 0,
  '金额必须大于 0',
);

export const createTopUpInputSchema = z
  .object({
    studioId: z.uuid(),
    amount: positiveAmountSchema,
    idempotencyKey: z.uuid(),
    channel: accountEvidenceChannelSchema,
    receiptReference: z.string().trim().min(1).max(128),
    receiptFileName: z.string().trim().min(1).max(255).nullable().optional(),
    reason: z.string().trim().min(2).max(500),
  })
  .strict();

export const accountAdjustmentKindSchema = z.enum([
  'REFUND',
  'ADJUSTMENT_CREDIT',
  'ADJUSTMENT_DEBIT',
]);
export const accountAdjustmentStatusSchema = z.enum([
  'PENDING',
  'APPROVED',
  'REJECTED',
]);
export const accountAdjustmentDecisionSchema = z.enum(['APPROVE', 'REJECT']);

export const operatorAdjustmentLedgerSchema = z.object({
  ledgerId: z.uuid(),
  amount: decimalAmountSchema,
  balanceAfter: decimalAmountSchema,
  availableBalanceAfter: decimalAmountSchema,
  occurredAt: z.iso.datetime({ offset: true }),
});

export const operatorAccountAdjustmentSchema = z.object({
  id: z.uuid(),
  requestNo: z.string().min(1).max(64),
  studioId: z.uuid(),
  studioBusinessCode: z.string().min(1).max(64),
  studioName: z.string().min(1).max(200),
  kind: accountAdjustmentKindSchema,
  amount: positiveAmountSchema,
  balanceChange: decimalAmountSchema,
  balanceSnapshot: decimalAmountSchema,
  availableBalanceSnapshot: decimalAmountSchema,
  currentBalance: decimalAmountSchema,
  currentAvailableBalance: decimalAmountSchema,
  currentAccountStatus: operatorAccountStatusSchema,
  reason: z.string().min(2).max(500),
  supportingReference: z.string().max(256).nullable(),
  status: accountAdjustmentStatusSchema,
  requestedBy: z.string().min(1).max(128),
  requestedAt: z.iso.datetime({ offset: true }),
  reviewedBy: z.string().min(1).max(128).nullable(),
  reviewNote: z.string().min(2).max(500).nullable(),
  reviewedAt: z.iso.datetime({ offset: true }).nullable(),
  ledger: operatorAdjustmentLedgerSchema.nullable(),
  canReview: z.boolean(),
  lockVersion: z.number().int().nonnegative(),
});

export const operatorAccountAdjustmentSummarySchema = z.object({
  all: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  approved: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  pendingCreditAmount: nonNegativeAmountSchema,
  pendingDebitAmount: nonNegativeAmountSchema,
});

export const operatorAccountAdjustmentPageSchema = z.object({
  total: z.number().int().nonnegative(),
  pages: z.number().int().nonnegative(),
  pageNum: z.number().int().nonnegative(),
  pageSize: z.number().int().positive().max(100),
  summary: operatorAccountAdjustmentSummarySchema,
  items: z.array(operatorAccountAdjustmentSchema),
});

export const createAccountAdjustmentInputSchema = z
  .object({
    studioId: z.uuid(),
    kind: accountAdjustmentKindSchema,
    amount: positiveAmountSchema,
    reason: z.string().trim().min(2).max(500),
    supportingReference: z
      .string()
      .trim()
      .min(1)
      .max(256)
      .nullable()
      .optional(),
    idempotencyKey: z.uuid(),
  })
  .strict();

export const decideAccountAdjustmentInputSchema = z
  .object({
    decision: accountAdjustmentDecisionSchema,
    note: z.string().trim().min(2).max(500),
  })
  .strict();

export const operatorSupplierPricingTierSchema = z.object({
  id: z.uuid(),
  tierCode: z.string().min(1).max(64),
  name: z.string().min(1).max(128),
  minMonthlyMinutes: z.string().regex(/^\d+$/),
  maxMonthlyMinutes: z.string().regex(/^\d+$/).nullable(),
  voiceRate: nonNegativeAmountSchema,
  smsRate: nonNegativeAmountSchema,
  effectiveFrom: z.iso.datetime({ offset: true }),
  effectiveTo: z.iso.datetime({ offset: true }).nullable(),
  publishedBy: z.string().min(1).max(128),
  publishedAt: z.iso.datetime({ offset: true }),
});

export const pricingStudioSummarySchema = z.object({
  studioId: z.uuid(),
  businessCode: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  studioStatus: operatorStudioStatusSchema,
  currentPricing: operatorPricingVersionSchema.nullable(),
  scheduledPricing: operatorPricingVersionSchema.nullable(),
  versions: z.array(operatorPricingVersionSchema),
});

export const pricingOverviewSchema = z.object({
  studios: z.array(pricingStudioSummarySchema),
  supplierTiers: z.array(operatorSupplierPricingTierSchema),
});

export const pricingRateInputSchema = z
  .object({
    voiceRate: positiveAmountSchema,
    smsRate: nonNegativeAmountSchema,
    frozenMinutes: z.number().int().positive().max(120),
  })
  .strict();

const pricingPublishBase = {
  effectiveFrom: z.iso.datetime({ offset: true }),
  reason: z.string().trim().min(2).max(500),
};

export const publishPricingInputSchema = z.discriminatedUnion('mode', [
  z
    .object({
      mode: z.literal('UNIFORM'),
      rate: pricingRateInputSchema,
      ...pricingPublishBase,
    })
    .strict(),
  z
    .object({
      mode: z.literal('PER_STUDIO'),
      entries: z
        .array(
          z
            .object({
              studioId: z.uuid(),
              rate: pricingRateInputSchema,
            })
            .strict(),
        )
        .min(1)
        .max(100)
        .superRefine((entries, context) => {
          const seen = new Set<string>();
          entries.forEach((entry, index) => {
            if (seen.has(entry.studioId)) {
              context.addIssue({
                code: 'custom',
                path: [index, 'studioId'],
                message: '同一影楼不能重复发布价格',
              });
            }
            seen.add(entry.studioId);
          });
        }),
      ...pricingPublishBase,
    })
    .strict(),
]);

export const pricingPreviewItemSchema = z.object({
  studioId: z.uuid(),
  businessCode: z.string().min(1).max(64),
  studioName: z.string().min(1).max(200),
  currentVoiceRate: nonNegativeAmountSchema.nullable(),
  nextVoiceRate: nonNegativeAmountSchema,
  nextSmsRate: nonNegativeAmountSchema,
  nextFrozenMinutes: z.number().int().positive(),
});

export const pricingPreviewSchema = z.object({
  mode: pricingSourceModeSchema,
  effectiveFrom: z.iso.datetime({ offset: true }),
  affectedStudioCount: z.number().int().positive(),
  items: z.array(pricingPreviewItemSchema).min(1),
});

export const pricingPublishResultSchema = z.object({
  mode: pricingSourceModeSchema,
  effectiveFrom: z.iso.datetime({ offset: true }),
  published: z.array(operatorPricingVersionSchema).min(1),
});

export const operatorAuditCategorySchema = z.enum([
  'FINANCIAL',
  'STUDIO',
  'PRICING',
  'CONFIGURATION',
  'SYSTEM',
]);

const auditDetailValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

export const operatorAuditEventSchema = z.object({
  id: z.uuid(),
  requestId: z.string().min(1).max(128),
  actorId: z.string().min(1).max(128),
  action: z.string().min(1).max(128),
  actionLabel: z.string().min(1).max(200),
  category: operatorAuditCategorySchema,
  objectType: z.string().min(1).max(128),
  objectId: z.string().min(1).max(256),
  objectLabel: z.string().min(1).max(500),
  detail: z.record(z.string(), auditDetailValueSchema),
  occurredAt: z.iso.datetime({ offset: true }),
});

export const operatorAuditSummarySchema = z.object({
  all: z.number().int().nonnegative(),
  today: z.number().int().nonnegative(),
  actors: z.number().int().nonnegative(),
  financial: z.number().int().nonnegative(),
  studio: z.number().int().nonnegative(),
  pricing: z.number().int().nonnegative(),
  configuration: z.number().int().nonnegative(),
  system: z.number().int().nonnegative(),
});

export const operatorAuditPageSchema = z.object({
  total: z.number().int().nonnegative(),
  pages: z.number().int().nonnegative(),
  pageNum: z.number().int().nonnegative(),
  pageSize: z.number().int().positive().max(100),
  summary: operatorAuditSummarySchema,
  items: z.array(operatorAuditEventSchema),
});

export const operatorAttentionPrioritySchema = z.enum(['P0', 'P1', 'P2']);
export const operatorAttentionKindSchema = z.enum([
  'TASK',
  'ACCOUNT',
  'APPROVAL',
  'DEAD_LETTER',
]);
export const operatorAttentionDestinationSchema = z.enum([
  'TASKS',
  'STUDIOS',
  'ADJUSTMENTS',
  'INTEGRATION_LOGS',
]);

export const operatorOverviewAttentionItemSchema = z.object({
  id: z.string().min(1).max(256),
  kind: operatorAttentionKindSchema,
  priority: operatorAttentionPrioritySchema,
  title: z.string().min(1).max(300),
  description: z.string().min(1).max(1000),
  objectId: z.string().min(1).max(256),
  destination: operatorAttentionDestinationSchema,
  actionLabel: z.string().min(1).max(64),
  occurredAt: z.iso.datetime({ offset: true }),
});

export const operatorOverviewRecentTaskSchema = z.object({
  id: z.uuid(),
  taskNo: z.string().regex(/^PT-\d{8}-\d{5,}$/),
  taskName: z.string().min(1).max(200),
  studioName: z.string().min(1).max(200),
  sourceSystem: sourceSystemSchema,
  executionStatus: taskExecutionStatusSchema,
  phoneCount: z.number().int().positive(),
  callInstanceCount: z.number().int().nonnegative(),
  customerCharge: nonNegativeAmountSchema,
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});

export const operatorOperationsOverviewSchema = z.object({
  generatedAt: z.iso.datetime({ offset: true }),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tasks: z.object({
    all: z.number().int().nonnegative(),
    today: z.number().int().nonnegative(),
    todayErp: z.number().int().nonnegative(),
    todayCrm: z.number().int().nonnegative(),
    running: z.number().int().nonnegative(),
    runningPhoneCount: z.number().int().nonnegative(),
    completedToday: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }),
  finance: z.object({
    totalBalance: decimalAmountSchema,
    totalActiveHold: nonNegativeAmountSchema,
    totalAvailable: decimalAmountSchema,
    lowBalanceStudios: z.number().int().nonnegative(),
    overdueStudios: z.number().int().nonnegative(),
  }),
  pipeline: z.object({
    callbackPending: z.number().int().nonnegative(),
    callbackStale: z.number().int().nonnegative(),
    outboxPending: z.number().int().nonnegative(),
    outboxStale: z.number().int().nonnegative(),
    deliveryFailed: z.number().int().nonnegative(),
    openDeadLetters: z.number().int().nonnegative(),
    pendingApprovals: z.number().int().nonnegative(),
  }),
  attention: z.object({
    total: z.number().int().nonnegative(),
    highPriority: z.number().int().nonnegative(),
    items: z.array(operatorOverviewAttentionItemSchema).max(12),
  }),
  callTrend: z.object({
    total: z.number().int().nonnegative(),
    answered: z.number().int().nonnegative(),
    points: z.array(
      z.object({
        hour: z.number().int().min(0).max(23),
        total: z.number().int().nonnegative(),
        answered: z.number().int().nonnegative(),
      }),
    ),
  }),
  recentTasks: z.array(operatorOverviewRecentTaskSchema).max(8),
});

export const integrationLogSystemSchema = z.enum(['ERP', 'CRM', 'BAIYING']);
export const integrationLogDirectionSchema = z.enum(['INBOUND', 'OUTBOUND']);
export const integrationLogStatusSchema = z.enum([
  'PENDING',
  'SUCCEEDED',
  'FAILED',
  'UNKNOWN',
]);
export const integrationLogCategorySchema = z.enum([
  'TASK_INTAKE',
  'PROVIDER_OPERATION',
  'CALLBACK',
  'DELIVERY',
]);

export const operatorIntegrationLogSchema = z.object({
  id: z.string().min(1).max(600),
  requestId: z.string().min(1).max(512),
  sourceSystem: integrationLogSystemSchema,
  direction: integrationLogDirectionSchema,
  category: integrationLogCategorySchema,
  operationCode: z.string().min(1).max(256),
  operationLabel: z.string().min(1).max(300),
  endpointLabel: z.string().min(1).max(300),
  taskNo: z
    .string()
    .regex(/^PT-\d{8}-\d{5,}$/)
    .nullable(),
  status: integrationLogStatusSchema,
  responseStatus: z.number().int().min(100).max(599).nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  attemptNo: z.number().int().nonnegative().nullable(),
  errorCode: z.string().max(256).nullable(),
  errorMessage: z.string().max(2000).nullable(),
  detail: z.record(z.string(), auditDetailValueSchema),
  occurredAt: z.iso.datetime({ offset: true }),
});

export const operatorIntegrationLogSummarySchema = z.object({
  all: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  unknown: z.number().int().nonnegative(),
  inbound: z.number().int().nonnegative(),
  outbound: z.number().int().nonnegative(),
  averageDurationMs: z.number().int().nonnegative().nullable(),
});

export const operatorIntegrationLogPageSchema = z.object({
  total: z.number().int().nonnegative(),
  pages: z.number().int().nonnegative(),
  pageNum: z.number().int().nonnegative(),
  pageSize: z.number().int().positive().max(100),
  summary: operatorIntegrationLogSummarySchema,
  items: z.array(operatorIntegrationLogSchema),
});

export type OperatorStudio = z.infer<typeof operatorStudioSchema>;
export type OperatorStudioPage = z.infer<typeof operatorStudioPageSchema>;
export type CreateOperatorStudioInput = z.infer<
  typeof createOperatorStudioInputSchema
>;
export type UpdateOperatorStudioInput = z.infer<
  typeof updateOperatorStudioInputSchema
>;
export type OperatorStudioStatus = z.infer<typeof operatorStudioStatusSchema>;
export type OperatorAccountStatus = z.infer<typeof operatorAccountStatusSchema>;
export type OperatorLedgerEntry = z.infer<typeof operatorLedgerEntrySchema>;
export type OperatorLedgerPage = z.infer<typeof operatorLedgerPageSchema>;
export type OperatorTopUpResult = z.infer<typeof operatorTopUpResultSchema>;
export type AccountEvidenceChannel = z.infer<
  typeof accountEvidenceChannelSchema
>;
export type CreateTopUpInput = z.infer<typeof createTopUpInputSchema>;
export type AccountAdjustmentKind = z.infer<typeof accountAdjustmentKindSchema>;
export type AccountAdjustmentStatus = z.infer<
  typeof accountAdjustmentStatusSchema
>;
export type AccountAdjustmentDecision = z.infer<
  typeof accountAdjustmentDecisionSchema
>;
export type OperatorAccountAdjustment = z.infer<
  typeof operatorAccountAdjustmentSchema
>;
export type OperatorAccountAdjustmentPage = z.infer<
  typeof operatorAccountAdjustmentPageSchema
>;
export type CreateAccountAdjustmentInput = z.infer<
  typeof createAccountAdjustmentInputSchema
>;
export type DecideAccountAdjustmentInput = z.infer<
  typeof decideAccountAdjustmentInputSchema
>;
export type OperatorPricingVersion = z.infer<
  typeof operatorPricingVersionSchema
>;
export type PricingOverview = z.infer<typeof pricingOverviewSchema>;
export type PublishPricingInput = z.infer<typeof publishPricingInputSchema>;
export type PricingPreview = z.infer<typeof pricingPreviewSchema>;
export type PricingPublishResult = z.infer<typeof pricingPublishResultSchema>;
export type OperatorAuditCategory = z.infer<typeof operatorAuditCategorySchema>;
export type OperatorAuditEvent = z.infer<typeof operatorAuditEventSchema>;
export type OperatorAuditPage = z.infer<typeof operatorAuditPageSchema>;
export type OperatorAttentionPriority = z.infer<
  typeof operatorAttentionPrioritySchema
>;
export type OperatorAttentionKind = z.infer<typeof operatorAttentionKindSchema>;
export type OperatorAttentionDestination = z.infer<
  typeof operatorAttentionDestinationSchema
>;
export type OperatorOverviewAttentionItem = z.infer<
  typeof operatorOverviewAttentionItemSchema
>;
export type OperatorOverviewRecentTask = z.infer<
  typeof operatorOverviewRecentTaskSchema
>;
export type OperatorOperationsOverview = z.infer<
  typeof operatorOperationsOverviewSchema
>;
export type IntegrationLogSystem = z.infer<typeof integrationLogSystemSchema>;
export type IntegrationLogDirection = z.infer<
  typeof integrationLogDirectionSchema
>;
export type IntegrationLogStatus = z.infer<typeof integrationLogStatusSchema>;
export type IntegrationLogCategory = z.infer<
  typeof integrationLogCategorySchema
>;
export type OperatorIntegrationLog = z.infer<
  typeof operatorIntegrationLogSchema
>;
export type OperatorIntegrationLogPage = z.infer<
  typeof operatorIntegrationLogPageSchema
>;

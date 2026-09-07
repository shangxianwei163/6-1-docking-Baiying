import { z } from 'zod';
import { sourceSystemSchema } from './envelope.js';
import {
  nonNegativeAmountSchema,
  taskBillingSummarySchema,
} from './billing.js';
import {
  recordingArchiveStatusSchema,
  recordingDeliveryStatusSchema,
} from './recording.js';

export const jsonScalarSchema = z.union([
  z.string().max(2000),
  z.number(),
  z.boolean(),
  z.null(),
]);

const outboundFieldsSchema = z
  .record(z.string().min(1).max(128), jsonScalarSchema)
  .superRefine((value, context) => {
    if (Object.keys(value).length > 100) {
      context.addIssue({
        code: 'custom',
        message: '单个客户最多允许 100 个业务字段',
      });
    }
  });

export const outboundCustomerSchema = z
  .object({
    externalCustomerId: z.string().trim().min(1).max(128),
    name: z.string().trim().min(1).max(200).optional(),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[1-9]\d{6,14}$/, '手机号必须是 7～15 位国际号码格式'),
    dataCategoryId: z.string().trim().min(1).max(256),
    fields: outboundFieldsSchema,
  })
  .strict();

export const createOutboundTaskRequestSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    externalRequestId: z.string().trim().min(1).max(128),
    sourceSystem: sourceSystemSchema,
    mcCode: z.string().trim().min(1).max(64),
    taskName: z.string().trim().min(1).max(200).optional(),
    customers: z.array(outboundCustomerSchema).min(1).max(10_000),
  })
  .strict()
  .superRefine((value, context) => {
    const customerIds = new Set<string>();
    const phones = new Set<string>();

    value.customers.forEach((customer, index) => {
      if (customerIds.has(customer.externalCustomerId)) {
        context.addIssue({
          code: 'custom',
          path: ['customers', index, 'externalCustomerId'],
          message: '同一任务内 externalCustomerId 不可重复',
        });
      }
      customerIds.add(customer.externalCustomerId);

      const normalizedPhone = customer.phone.startsWith('+86')
        ? customer.phone.slice(3)
        : customer.phone.startsWith('86') && customer.phone.length === 13
          ? customer.phone.slice(2)
          : customer.phone;
      if (phones.has(normalizedPhone)) {
        context.addIssue({
          code: 'custom',
          path: ['customers', index, 'phone'],
          message: '同一任务内手机号不可重复',
        });
      }
      phones.add(normalizedPhone);
    });
  });

export const taskExecutionStatusSchema = z.enum([
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

export const taskDisplayStatusSchema = z.enum([
  '执行中',
  '呼叫中',
  '执行完成',
  '执行失败',
]);
export const resultDeliveryStatusSchema = z.enum([
  'PENDING',
  'DELIVERING',
  'SUCCEEDED',
  'FAILED',
]);
export const taskCommandSchema = z.enum([
  'START',
  'RESUME',
  'PAUSE',
  'TERMINATE',
]);

export const taskFailureSchema = z.object({
  stage: z.enum([
    'VALIDATION',
    'BAIYING_CREATE',
    'BAIYING_IMPORT',
    'BAIYING_START',
    'RECONCILIATION',
  ]),
  code: z.string().min(1).max(128),
  message: z.string().min(1).max(1000),
  retryable: z.boolean(),
  occurredAt: z.iso.datetime({ offset: true }),
});

export const taskStatusSummarySchema = z.object({
  execution: taskExecutionStatusSchema,
  display: taskDisplayStatusSchema,
  resultDelivery: resultDeliveryStatusSchema,
  recordingArchive: recordingArchiveStatusSchema,
  recordingDelivery: recordingDeliveryStatusSchema,
  billing: z.enum(['RESERVED', 'SETTLING', 'SETTLED', 'FAILED']),
});

export const taskAcceptedSchema = z.object({
  taskId: z.uuid(),
  taskNo: z.string().regex(/^PT-\d{8}-\d{5,}$/),
  taskName: z.string().min(1).max(200).optional(),
  executionStatus: z.literal('ACCEPTED'),
  displayStatus: z.literal('执行中'),
  phoneCount: z.number().int().positive().max(10_000),
  reservedAmount: nonNegativeAmountSchema,
  currency: z.literal('CNY'),
  statusUrl: z.string().startsWith('/openapi/v1/outbound/tasks/'),
});

export const taskAcceptedEnvelopeSchema = z.object({
  code: z.literal('TASK_ACCEPTED'),
  message: z.string().min(1).max(1000),
  requestId: z.string().min(1).max(128),
  data: taskAcceptedSchema,
});

export const taskDetailSchema = z.object({
  taskId: z.uuid(),
  taskNo: z.string().regex(/^PT-\d{8}-\d{5,}$/),
  externalRequestId: z.string().min(1).max(128),
  sourceSystem: sourceSystemSchema,
  mcCode: z.string().min(1).max(64),
  studioId: z.string().min(1).max(128),
  studioName: z.string().min(1).max(200),
  taskName: z.string().min(1).max(200),
  phoneCount: z.number().int().positive().max(10_000),
  dataCategories: z
    .array(z.object({ id: z.string(), path: z.string() }))
    .min(1),
  script: z.object({ robotDefId: z.string(), name: z.string() }),
  line: z.object({ userPhoneId: z.string(), name: z.string() }),
  mapping: z.object({
    version: z.number().int().positive(),
    variableCount: z.number().int().nonnegative(),
  }),
  baiyingCallJobId: z.string().nullable(),
  providerStatus: z.object({
    code: z.number().int().nullable(),
    description: z.string().min(1).max(128).nullable(),
  }),
  statuses: taskStatusSummarySchema,
  importSummary: z.object({
    requested: z.number().int().nonnegative(),
    succeeded: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    repeated: z.number().int().nonnegative(),
  }),
  counts: z.object({
    imported: z.number().int().nonnegative(),
    callInstances: z.number().int().nonnegative(),
    recordingsDiscovered: z.number().int().nonnegative(),
    recordingsArchived: z.number().int().nonnegative(),
    recordingsDelivered: z.number().int().nonnegative(),
  }),
  durations: z.object({
    totalSeconds: z.number().int().nonnegative(),
    billingMinutes: z.number().int().nonnegative(),
  }),
  billing: taskBillingSummarySchema,
  failure: taskFailureSchema.nullable(),
  timestamps: z.object({
    createdAt: z.iso.datetime({ offset: true }),
    acceptedAt: z.iso.datetime({ offset: true }),
    startedAt: z.iso.datetime({ offset: true }).nullable(),
    providerCompletedAt: z.iso.datetime({ offset: true }).nullable(),
    reconciledAt: z.iso.datetime({ offset: true }).nullable(),
    closedAt: z.iso.datetime({ offset: true }).nullable(),
  }),
});

export const taskDetailEnvelopeSchema = z.object({
  code: z.literal('OK'),
  message: z.literal('success'),
  requestId: z.string().min(1).max(128),
  data: taskDetailSchema,
});

export const taskCommandRequestSchema = z
  .object({
    command: taskCommandSchema,
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export const taskCommandAcceptedSchema = z.object({
  operationId: z.uuid(),
  taskNo: z.string().regex(/^PT-\d{8}-\d{5,}$/),
  command: taskCommandSchema,
  operationStatus: z.literal('PENDING'),
  acceptedAt: z.iso.datetime({ offset: true }),
});

export const outboundCallDetailSchema = z.object({
  platformCallId: z.uuid(),
  externalCustomerId: z.string().min(1).max(128),
  baiyingCallInstanceId: z.string().min(1).max(64),
  phoneMasked: z.string().min(1).max(32),
  callStatus: z.enum([
    'ANSWERED',
    'NO_ANSWER',
    'BUSY',
    'REJECTED',
    'FAILED',
    'UNKNOWN',
  ]),
  finishStatus: z.number().int().nullable(),
  durationSeconds: z.number().int().nonnegative(),
  billingMinutes: z.number().int().nonnegative(),
  customerCharge: nonNegativeAmountSchema,
  collectProperties: z.record(z.string(), z.unknown()),
  recording: z.object({
    status: recordingArchiveStatusSchema,
    recordingId: z.uuid().nullable(),
    expiresAt: z.iso.datetime({ offset: true }).nullable(),
  }),
  resultDeliveryStatus: resultDeliveryStatusSchema,
  calledAt: z.iso.datetime({ offset: true }).nullable(),
  completedAt: z.iso.datetime({ offset: true }).nullable(),
});

export const outboundCallPageSchema = z.object({
  items: z.array(outboundCallDetailSchema),
  nextCursor: z.string().nullable(),
});

export const outboundCallPageEnvelopeSchema = z.object({
  code: z.literal('OK'),
  message: z.literal('success'),
  requestId: z.string().min(1).max(128),
  data: outboundCallPageSchema,
});

export type OutboundCustomer = z.infer<typeof outboundCustomerSchema>;
export type CreateOutboundTaskRequest = z.infer<
  typeof createOutboundTaskRequestSchema
>;
export type TaskExecutionStatus = z.infer<typeof taskExecutionStatusSchema>;
export type TaskDisplayStatus = z.infer<typeof taskDisplayStatusSchema>;
export type ResultDeliveryStatus = z.infer<typeof resultDeliveryStatusSchema>;
export type TaskCommand = z.infer<typeof taskCommandSchema>;
export type TaskFailure = z.infer<typeof taskFailureSchema>;
export type TaskStatusSummary = z.infer<typeof taskStatusSummarySchema>;
export type TaskAccepted = z.infer<typeof taskAcceptedSchema>;
export type TaskAcceptedEnvelope = z.infer<typeof taskAcceptedEnvelopeSchema>;
export type TaskDetail = z.infer<typeof taskDetailSchema>;
export type TaskDetailEnvelope = z.infer<typeof taskDetailEnvelopeSchema>;
export type TaskCommandRequest = z.infer<typeof taskCommandRequestSchema>;
export type TaskCommandAccepted = z.infer<typeof taskCommandAcceptedSchema>;
export type OutboundCallDetail = z.infer<typeof outboundCallDetailSchema>;
export type OutboundCallPage = z.infer<typeof outboundCallPageSchema>;
export type OutboundCallPageEnvelope = z.infer<
  typeof outboundCallPageEnvelopeSchema
>;

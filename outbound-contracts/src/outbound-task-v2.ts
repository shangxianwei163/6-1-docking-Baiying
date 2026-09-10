import { z } from 'zod';

export const outboundSourceCodeSchema = z.union([z.literal(0), z.literal(1)]);

export const v2CallStatusSchema = z.enum([
  'ANSWERED',
  'NO_ANSWER',
  'BUSY',
  'REJECTED',
  'FAILED',
  'UNKNOWN',
]);

export const intakeBatchStatusSchema = z.enum([
  'ACCEPTED',
  'PREPARING',
  'RUNNING',
  'PARTIAL_FAILED',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);

const MAX_VARIABLE_NAME_BYTES = 128;
const MAX_VARIABLE_VALUE_BYTES = 8 * 1024;
const MAX_CUSTOMER_VARIABLE_BYTES = 128 * 1024;
const protectedVariableNames = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);
const customerReservedFields = new Set(['phone', 'guid', 'customer_name']);

const dynamicVariableValueSchema = z.union([
  z
    .string()
    .refine(
      (value) => utf8Bytes(value) <= MAX_VARIABLE_VALUE_BYTES,
      `单个动态变量值不能超过 ${MAX_VARIABLE_VALUE_BYTES} UTF-8 字节`,
    ),
  z.number(),
  z.boolean(),
  z.null(),
]);

export const outboundCustomerInfoV2Schema = z
  .object({
    phone: z
      .string()
      .trim()
      .regex(/^\+?[1-9]\d{6,14}$/, '手机号必须是 7～15 位国际号码格式'),
    guid: z.string().trim().min(1).max(128),
    customer_name: z.string().trim().min(1).max(200).nullable().optional(),
  })
  .catchall(dynamicVariableValueSchema)
  .superRefine((value, context) => {
    const dynamicVariables = extractOutboundVariablesV2(value);
    for (const name of Object.keys(dynamicVariables)) {
      const normalized = name.trim();
      if (!normalized || utf8Bytes(normalized) > MAX_VARIABLE_NAME_BYTES) {
        context.addIssue({
          code: 'custom',
          path: [name],
          message: `动态变量名必须为 1～${MAX_VARIABLE_NAME_BYTES} UTF-8 字节`,
        });
      }
      if (
        normalized.toLowerCase().startsWith('sx_') ||
        protectedVariableNames.has(normalized.toLowerCase())
      ) {
        context.addIssue({
          code: 'custom',
          path: [name],
          message: `动态变量名 ${name} 属于平台保留命名空间`,
        });
      }
    }
    if (
      utf8Bytes(JSON.stringify(dynamicVariables)) > MAX_CUSTOMER_VARIABLE_BYTES
    ) {
      context.addIssue({
        code: 'custom',
        message: `单个号码的动态变量不能超过 ${MAX_CUSTOMER_VARIABLE_BYTES} UTF-8 字节`,
      });
    }
  });

export const outboundCustomerGroupV2Schema = z
  .object({
    c_level: z.string().trim().max(128),
    c_info_list: z.array(outboundCustomerInfoV2Schema).min(1).max(10_000),
  })
  .strict();

export const createOutboundBatchRequestV2Schema = z
  .object({
    main_category: z.string().trim().min(1).max(200),
    sub_category: z.string().trim().min(1).max(200),
    source: outboundSourceCodeSchema,
    company_code: z.string().trim().min(1).max(64),
    customer_list: z.array(outboundCustomerGroupV2Schema).min(1).max(10_000),
  })
  .strict()
  .superRefine((value, context) => {
    const customers = flattenOutboundCustomersV2(value);
    if (customers.length > 10_000) {
      context.addIssue({
        code: 'custom',
        path: ['customer_list'],
        message: '一个批次最多允许 10000 个号码',
      });
    }

    const guids = new Set<string>();
    const phones = new Set<string>();
    for (const customer of customers) {
      if (guids.has(customer.guid)) {
        context.addIssue({
          code: 'custom',
          path: customer.path.concat('guid'),
          message: '同一批次内 guid 不可重复',
        });
      }
      guids.add(customer.guid);

      const normalizedPhone = normalizeOutboundPhoneV2(customer.phone);
      if (phones.has(normalizedPhone)) {
        context.addIssue({
          code: 'custom',
          path: customer.path.concat('phone'),
          message: '同一批次内手机号不可重复',
        });
      }
      phones.add(normalizedPhone);
    }
  });

export const batchTaskSummaryV2Schema = z.object({
  task_id: z.uuid(),
  task_no: z.string().regex(/^PT-\d{8}-\d{5,}$/),
  phone_count: z.number().int().positive().max(10_000),
  status_url: z.string().startsWith('/openapi/v1/outbound/tasks/'),
});

export const batchAcceptedV2Schema = z.object({
  batch_id: z.uuid(),
  execution_status: z.literal('ACCEPTED'),
  phone_count: z.number().int().positive().max(10_000),
  task_count: z.number().int().positive(),
  tasks: z.array(batchTaskSummaryV2Schema).min(1),
  status_url: z.string().startsWith('/openapi/v2/outbound/batches/'),
});

export const batchAcceptedEnvelopeV2Schema = z.object({
  code: z.literal('BATCH_ACCEPTED'),
  message: z.string().min(1).max(1000),
  request_id: z.string().min(1).max(128),
  data: batchAcceptedV2Schema,
});

export const batchDetailV2Schema = z.object({
  batch_id: z.uuid(),
  source: outboundSourceCodeSchema,
  company_code: z.string().min(1).max(64),
  main_category: z.string().min(1).max(200),
  sub_category: z.string().min(1).max(200),
  execution_status: intakeBatchStatusSchema,
  phone_count: z.number().int().positive().max(10_000),
  task_count: z.number().int().positive(),
  tasks: z.array(
    batchTaskSummaryV2Schema.extend({
      execution_status: z.string().min(1).max(64),
    }),
  ),
  created_at: z.iso.datetime({ offset: true }),
  completed_at: z.iso.datetime({ offset: true }).nullable(),
});

export const batchDetailEnvelopeV2Schema = z.object({
  code: z.literal('OK'),
  message: z.literal('success'),
  request_id: z.string().min(1).max(128),
  data: batchDetailV2Schema,
});

export const outboundCallResultLegacyV2Schema = z
  .object({
    guid: z.string().min(1).max(128),
    externalCustomerId: z.string().min(1).max(128),
    phone_masked: z.string().min(1).max(32),
    call_status: v2CallStatusSchema,
    finish_status: z.number().int().nullable(),
    result_complete: z.boolean(),
    collected_variables: z.record(z.string(), z.unknown()),
    task_results: z.array(z.record(z.string(), z.unknown())),
  })
  .strict()
  .refine((value) => value.guid === value.externalCustomerId, {
    path: ['externalCustomerId'],
    message: '兼容字段 externalCustomerId 必须与 guid 相同',
  });

const callbackTextSchema = z.string().max(8_192);
const callbackNullableTextSchema = callbackTextSchema.nullable();
const callbackMoneySchema = z
  .string()
  .regex(/^\d{1,12}\.\d{6}$/, '回调金额必须是固定 6 位小数的非负字符串');

export const customerResultCodeV2Schema = z.enum([
  'HIGH_INTENT',
  'MEDIUM_INTENT',
  'LOW_INTENT',
  'NO_INTENT',
  'UNREACHED',
  'CALL_FAILED',
  'UNKNOWN',
]);

export const outboundCallResultV2Schema = z
  .object({
    event_id: z.uuid(),
    event_type: z.literal('OUTBOUND_CALL_RESULT'),
    occurred_at: z.iso.datetime({ offset: true }),
    company_code: z.string().min(1).max(64),
    batch_id: z.uuid().nullable(),
    task_no: z.string().regex(/^PT-\d{8}-\d{5,}$/),
    customer: z
      .object({
        guid: z.string().min(1).max(128),
        customer_name: z.string().max(200).nullable(),
        phone_masked: z.string().min(1).max(32),
      })
      .strict(),
    customer_result: z
      .object({
        result_code: customerResultCodeV2Schema,
        result_text: z.string().min(1).max(500),
        contacted: z.boolean(),
        intention_level: callbackNullableTextSchema,
        intention_text: z.string().min(1).max(200),
        summary: z.string().min(1).max(2_000),
        follow_up_required: z.boolean(),
        recommended_action: z.string().min(1).max(1_000),
        customer_concerns: z.array(callbackTextSchema).max(100),
        customer_tags: z.array(callbackTextSchema).max(100),
        collected_data: z.record(z.string(), z.unknown()),
      })
      .strict(),
    call: z
      .object({
        status: v2CallStatusSchema,
        status_text: z.string().min(1).max(200),
        called_at: z.iso.datetime({ offset: true }).nullable(),
        duration_seconds: z.number().int().nonnegative(),
      })
      .strict(),
    conversation_logs: z
      .array(
        z
          .object({
            sequence: z.number().int().positive(),
            speaker: z.enum(['AI', 'CUSTOMER']),
            content: z.string().max(20_000),
          })
          .strict(),
      )
      .max(10_000),
    billing: z
      .object({
        billing_minutes: z.number().int().nonnegative(),
        customer_charge: callbackMoneySchema,
        currency: z.literal('CNY'),
      })
      .strict(),
  })
  .strict();

export const outboundCallResultInternalEventLegacyV2Schema = z.object({
  schemaVersion: z.literal('2.0'),
  eventId: z.uuid(),
  eventType: z.literal('OUTBOUND_CALL_RESULT_V2'),
  occurredAt: z.iso.datetime({ offset: true }),
  sourceSystem: z.enum(['ERP', 'CRM']),
  mcCode: z.string().min(1).max(64),
  taskNo: z.string().regex(/^PT-\d{8}-\d{5,}$/),
  result: outboundCallResultLegacyV2Schema,
});

export const outboundCallResultInternalEventV21Schema = z.object({
  schemaVersion: z.literal('2.1'),
  eventId: z.uuid(),
  eventType: z.literal('OUTBOUND_CALL_RESULT_V2'),
  occurredAt: z.iso.datetime({ offset: true }),
  sourceSystem: z.enum(['ERP', 'CRM']),
  mcCode: z.string().min(1).max(64),
  taskNo: z.string().regex(/^PT-\d{8}-\d{5,}$/),
  result: outboundCallResultV2Schema,
});

export const outboundCallResultInternalEventV2Schema = z.discriminatedUnion(
  'schemaVersion',
  [
    outboundCallResultInternalEventLegacyV2Schema,
    outboundCallResultInternalEventV21Schema,
  ],
);

export type OutboundSourceCode = z.infer<typeof outboundSourceCodeSchema>;
export type OutboundCustomerInfoV2 = z.infer<
  typeof outboundCustomerInfoV2Schema
>;
export type CreateOutboundBatchRequestV2 = z.infer<
  typeof createOutboundBatchRequestV2Schema
>;
export type BatchAcceptedEnvelopeV2 = z.infer<
  typeof batchAcceptedEnvelopeV2Schema
>;
export type BatchDetailV2 = z.infer<typeof batchDetailV2Schema>;
export type OutboundCallResultV2 = z.infer<typeof outboundCallResultV2Schema>;
export type OutboundCallResultInternalEventV2 = z.infer<
  typeof outboundCallResultInternalEventV2Schema
>;

export function sourceSystemFromCodeV2(source: OutboundSourceCode) {
  return source === 0 ? ('ERP' as const) : ('CRM' as const);
}

export function sourceCodeFromSystemV2(sourceSystem: 'ERP' | 'CRM') {
  return sourceSystem === 'ERP' ? (0 as const) : (1 as const);
}

export function extractOutboundVariablesV2(
  customer: Record<string, unknown>,
): Record<string, string | number | boolean | null> {
  return Object.fromEntries(
    Object.entries(customer).filter(
      ([name]) => !customerReservedFields.has(name),
    ),
  ) as Record<string, string | number | boolean | null>;
}

export function flattenOutboundCustomersV2(
  request: Pick<CreateOutboundBatchRequestV2, 'customer_list'>,
) {
  return request.customer_list.flatMap((group, groupIndex) =>
    group.c_info_list.map((customer, customerIndex) => ({
      ...customer,
      cLevel: group.c_level,
      variables: extractOutboundVariablesV2(customer),
      path: [
        'customer_list',
        groupIndex,
        'c_info_list',
        customerIndex,
      ] as Array<string | number>,
    })),
  );
}

export function normalizeOutboundPhoneV2(phone: string): string {
  const compact = phone.trim().replace(/[\s()-]/g, '');
  if (compact.startsWith('+86')) return compact.slice(3);
  if (compact.startsWith('86') && compact.length === 13) {
    return compact.slice(2);
  }
  return compact;
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

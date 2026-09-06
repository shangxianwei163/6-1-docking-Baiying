import { z } from 'zod';

const decimalPattern = /^-?(?:0|[1-9]\d*)(?:\.\d{1,6})?$/;
const nonNegativeDecimalPattern = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/;

/** API 金额统一使用最多 6 位小数的十进制字符串，禁止通过 JSON number 传输。 */
export const decimalAmountSchema = z
  .string()
  .regex(decimalPattern, '金额必须是最多 6 位小数的十进制字符串');
export const nonNegativeAmountSchema = z
  .string()
  .regex(nonNegativeDecimalPattern, '金额必须是非负十进制字符串');

export const billingStatusSchema = z.enum([
  'RESERVED',
  'SETTLING',
  'SETTLED',
  'FAILED',
]);

export const supplierSettlementMonthSchema = z
  .string()
  .regex(/^20\d{2}-(?:0[1-9]|1[0-2])$/, '结算月份必须为 YYYY-MM');

export const supplierSettlementStatusSchema = z.enum(['OPEN', 'FINALIZED']);

export const supplierSettlementIssueSchema = z.object({
  code: z.enum([
    'TASK_NOT_SETTLED',
    'TASK_CALL_MINUTES_MISMATCH',
    'TASK_CUSTOMER_CHARGE_MISMATCH',
    'TASK_LEDGER_CHARGE_MISMATCH',
    'TASK_HOLD_CONSERVATION_MISMATCH',
    'TASK_HOLD_NOT_CLOSED',
    'SUPPLIER_TIER_NOT_FOUND',
    'SUPPLIER_TIER_OVERLAP',
    'FINALIZED_SOURCE_DRIFT',
  ]),
  taskNo: z.string().regex(/^PT-\d{8}-\d{5,}$/).nullable(),
  message: z.string().min(1).max(500),
});

export const supplierSettlementTierSnapshotSchema = z.object({
  id: z.uuid(),
  tierCode: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  minMonthlyMinutes: z.string().regex(/^\d+$/),
  maxMonthlyMinutes: z.string().regex(/^\d+$/).nullable(),
  voiceRate: nonNegativeAmountSchema,
});

export const supplierSettlementReconciliationSchema = z.object({
  status: z.enum(['BALANCED', 'BLOCKED']),
  discrepancyCount: z.number().int().nonnegative(),
  blockingTaskCount: z.number().int().nonnegative(),
  lateTaskCount: z.number().int().nonnegative(),
  issues: z.array(supplierSettlementIssueSchema).max(100),
  issuesTruncated: z.boolean(),
});

export const supplierSettlementSummarySchema = z.object({
  settlementId: z.uuid().nullable(),
  settlementMonth: supplierSettlementMonthSchema,
  timezone: z.literal('Asia/Shanghai'),
  periodStart: z.iso.datetime({ offset: true }),
  periodEnd: z.iso.datetime({ offset: true }),
  status: supplierSettlementStatusSchema,
  taskCount: z.number().int().nonnegative(),
  totalBillingMinutes: z.string().regex(/^\d+$/),
  tier: supplierSettlementTierSnapshotSchema.nullable(),
  totalCustomerCharge: nonNegativeAmountSchema,
  totalPlatformCost: nonNegativeAmountSchema,
  totalProfit: decimalAmountSchema,
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  reconciliation: supplierSettlementReconciliationSchema,
  finalizedBy: z.string().min(1).max(128).nullable(),
  finalizedAt: z.iso.datetime({ offset: true }).nullable(),
  idempotentReplay: z.boolean(),
});

export const finalizeSupplierSettlementInputSchema = z
  .object({
    expectedSourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    reason: z.string().trim().min(2).max(500),
    idempotencyKey: z.uuid(),
  })
  .strict();

export const taskBillingSummarySchema = z.object({
  currency: z.literal('CNY'),
  customerRate: nonNegativeAmountSchema,
  frozenMinutes: z.number().int().positive(),
  reservedAmount: nonNegativeAmountSchema,
  customerCharge: nonNegativeAmountSchema,
  platformRate: nonNegativeAmountSchema.nullable(),
  platformRateStatus: z.enum(['PROVISIONAL', 'FINAL', 'NOT_AVAILABLE']),
  platformCost: nonNegativeAmountSchema.nullable(),
  profit: decimalAmountSchema.nullable(),
  studioBalance: decimalAmountSchema,
  availableBalance: decimalAmountSchema,
  status: billingStatusSchema,
});

export const studioBalanceSchema = z.object({
  mcCode: z.string().min(1).max(64),
  currency: z.literal('CNY'),
  balance: decimalAmountSchema,
  activeHoldAmount: nonNegativeAmountSchema,
  availableBalance: decimalAmountSchema,
  accountStatus: z.enum(['ACTIVE', 'LOW_BALANCE', 'OVERDUE', 'DISABLED']),
  updatedAt: z.iso.datetime({ offset: true }),
});

export const ledgerEntryTypeSchema = z.enum([
  'TOP_UP',
  'TASK_HOLD',
  'TASK_HOLD_RELEASE',
  'CALL_CHARGE',
  'OVERAGE_DEBIT',
  'REFUND',
  'ADJUSTMENT',
]);

export const ledgerEntrySchema = z.object({
  ledgerId: z.uuid(),
  occurredAt: z.iso.datetime({ offset: true }),
  type: ledgerEntryTypeSchema,
  amount: decimalAmountSchema,
  balanceAfter: decimalAmountSchema,
  taskNo: z
    .string()
    .regex(/^PT-\d{8}-\d{5,}$/)
    .nullable(),
  platformCallId: z.uuid().nullable(),
  businessKey: z.string().min(1).max(256),
  remark: z.string().max(500).nullable(),
});

export const ledgerPageSchema = z.object({
  items: z.array(ledgerEntrySchema),
  nextCursor: z.string().nullable(),
});

export type DecimalAmount = z.infer<typeof decimalAmountSchema>;
export type BillingStatus = z.infer<typeof billingStatusSchema>;
export type SupplierSettlementMonth = z.infer<
  typeof supplierSettlementMonthSchema
>;
export type SupplierSettlementStatus = z.infer<
  typeof supplierSettlementStatusSchema
>;
export type SupplierSettlementIssue = z.infer<
  typeof supplierSettlementIssueSchema
>;
export type SupplierSettlementSummary = z.infer<
  typeof supplierSettlementSummarySchema
>;
export type FinalizeSupplierSettlementInput = z.infer<
  typeof finalizeSupplierSettlementInputSchema
>;
export type TaskBillingSummary = z.infer<typeof taskBillingSummarySchema>;
export type StudioBalance = z.infer<typeof studioBalanceSchema>;
export type LedgerEntryType = z.infer<typeof ledgerEntryTypeSchema>;
export type LedgerEntry = z.infer<typeof ledgerEntrySchema>;
export type LedgerPage = z.infer<typeof ledgerPageSchema>;

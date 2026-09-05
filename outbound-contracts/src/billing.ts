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
export type TaskBillingSummary = z.infer<typeof taskBillingSummarySchema>;
export type StudioBalance = z.infer<typeof studioBalanceSchema>;
export type LedgerEntryType = z.infer<typeof ledgerEntryTypeSchema>;
export type LedgerEntry = z.infer<typeof ledgerEntrySchema>;
export type LedgerPage = z.infer<typeof ledgerPageSchema>;

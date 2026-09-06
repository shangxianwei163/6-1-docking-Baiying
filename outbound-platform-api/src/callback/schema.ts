import { createHash } from 'node:crypto';
import { z } from 'zod';

export const supportedBaiyingCallbackTypeSchema = z.enum([
  'CALL_INSTANCE_RESULT',
  'JOB_INFO_RESULT',
]);

export type SupportedBaiyingCallbackType = z.infer<
  typeof supportedBaiyingCallbackTypeSchema
>;

export type NormalizedCallStatus =
  | 'ANSWERED'
  | 'NO_ANSWER'
  | 'BUSY'
  | 'REJECTED'
  | 'FAILED'
  | 'UNKNOWN';

export type BaiyingCallResult = {
  callbackType: 'CALL_INSTANCE_RESULT';
  companyId: string;
  callJobId: string;
  callInstanceId: string;
  callInstanceStatus: number | null;
  finishStatus: number;
  calledTimes: number | null;
  customerTelephone: string | null;
  durationSeconds: number;
  callStatus: NormalizedCallStatus;
  collectProperties: Record<string, unknown>;
  platformItemId: string | null;
  providerOccurredAt: Date | null;
  recordingUrls: {
    full: string | null;
    userOnly: string | null;
  };
};

export type BaiyingJobResult = {
  callbackType: 'JOB_INFO_RESULT';
  companyId: string;
  callJobId: string;
  callJobStatus: number;
  providerOccurredAt: Date | null;
};

export type ParsedBaiyingCallback = BaiyingCallResult | BaiyingJobResult;

export class BaiyingCallbackParseError extends Error {}
export class UnsupportedBaiyingCallbackTypeError extends Error {}

const providerIdSchema = z
  .union([z.string().trim().min(1).max(128), z.number().int().nonnegative()])
  .transform((value) => String(value));

const providerIntegerSchema = z.number().int().nonnegative();

const callInstanceSchema = z
  .object({
    companyId: providerIdSchema,
    callJobId: providerIdSchema,
    callInstanceId: providerIdSchema,
    callInstanceStatus: z.literal(2).optional(),
    finishStatus: providerIntegerSchema,
    calledTimes: providerIntegerSchema.optional(),
    customerTelephone: z.string().trim().min(1).max(64).optional(),
    duration: providerIntegerSchema.max(604_800).optional().default(0),
    properties: z.unknown().optional(),
    startTime: z.union([z.string(), z.number()]).optional(),
    endTime: z.union([z.string(), z.number()]).optional(),
    luyinOssUrl: z.string().trim().max(8_192).optional(),
    userLuyinOssUrl: z.string().trim().max(8_192).optional(),
  })
  .loose();

const callbackEnvelopeSchema = z
  .object({
    code: z.union([z.number(), z.string()]).optional(),
    data: z
      .object({
        callbackType: z.string().trim().min(1).max(128).optional(),
        // Some older payloads used dataType. Keeping it as a read-only alias
        // lets us retain provider compatibility without changing our contract.
        dataType: z.string().trim().min(1).max(128).optional(),
        data: z.record(z.string(), z.unknown()),
      })
      .loose(),
    resultMsg: z.string().optional(),
  })
  .loose();

export function parseBaiyingCallback(rawBody: string): ParsedBaiyingCallback {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch (error) {
    throw new BaiyingCallbackParseError(
      `回调正文不是有效 JSON：${errorMessage(error)}`,
    );
  }

  const envelope = callbackEnvelopeSchema.safeParse(json);
  if (!envelope.success) {
    throw new BaiyingCallbackParseError(
      `回调信封不符合约定：${z.prettifyError(envelope.error)}`,
    );
  }
  const callbackType =
    envelope.data.data.callbackType ?? envelope.data.data.dataType;
  if (!callbackType) {
    throw new BaiyingCallbackParseError('回调缺少 data.callbackType');
  }
  const supportedType =
    supportedBaiyingCallbackTypeSchema.safeParse(callbackType);
  if (!supportedType.success) {
    throw new UnsupportedBaiyingCallbackTypeError(
      `不支持的百应回调类型：${callbackType}`,
    );
  }

  if (supportedType.data === 'CALL_INSTANCE_RESULT') {
    const result = callInstanceSchema.safeParse(
      envelope.data.data.data.callInstance,
    );
    if (!result.success) {
      throw new BaiyingCallbackParseError(
        `CALL_INSTANCE_RESULT 缺少有效通话字段：${z.prettifyError(result.error)}`,
      );
    }
    const properties = parseProperties(result.data.properties);
    const taskResult = asObjectArray(envelope.data.data.data.taskResult);
    const collectProperties = {
      ...properties,
      ...(taskResult.length ? { taskResult } : {}),
    };
    return {
      callbackType: 'CALL_INSTANCE_RESULT',
      companyId: result.data.companyId,
      callJobId: result.data.callJobId,
      callInstanceId: result.data.callInstanceId,
      callInstanceStatus: result.data.callInstanceStatus ?? null,
      finishStatus: result.data.finishStatus,
      calledTimes: result.data.calledTimes ?? null,
      customerTelephone: result.data.customerTelephone ?? null,
      durationSeconds: result.data.duration,
      callStatus: normalizeCallStatus(result.data.finishStatus),
      collectProperties,
      platformItemId: readPlatformItemId(properties),
      providerOccurredAt: parseProviderDate(
        result.data.endTime ?? result.data.startTime,
      ),
      recordingUrls: {
        full: nonEmpty(result.data.luyinOssUrl),
        userOnly: nonEmpty(result.data.userLuyinOssUrl),
      },
    };
  }

  const jobResult = z
    .object({
      companyId: providerIdSchema,
      callJobId: providerIdSchema,
      callJobStatus: providerIntegerSchema.max(99),
      updateTime: z.union([z.string(), z.number()]).optional(),
      endTime: z.union([z.string(), z.number()]).optional(),
    })
    .loose()
    .safeParse(envelope.data.data.data);
  if (!jobResult.success) {
    throw new BaiyingCallbackParseError(
      `JOB_INFO_RESULT 缺少有效任务字段：${z.prettifyError(jobResult.error)}`,
    );
  }
  return {
    callbackType: 'JOB_INFO_RESULT',
    companyId: jobResult.data.companyId,
    callJobId: jobResult.data.callJobId,
    callJobStatus: jobResult.data.callJobStatus,
    providerOccurredAt: parseProviderDate(
      jobResult.data.updateTime ?? jobResult.data.endTime,
    ),
  };
}

export function inspectBaiyingCallback(rawBody: string): {
  callbackType: string;
  eventKey: string;
  rawBodySha256: string;
} {
  const rawBodySha256 = createHash('sha256')
    .update(rawBody, 'utf8')
    .digest('hex');
  let value: unknown;
  try {
    value = JSON.parse(rawBody);
  } catch {
    return {
      callbackType: 'INVALID_JSON',
      eventKey: `BAIYING:INVALID_JSON:${rawBodySha256}`,
      rawBodySha256,
    };
  }
  const root = asRecord(value);
  const envelope = asRecord(root?.data);
  const body = asRecord(envelope?.data);
  const call = asRecord(body?.callInstance);
  const callbackType = truncateIdentity(
    stringValue(envelope?.callbackType ?? envelope?.dataType) ?? 'UNKNOWN',
  );
  const companyId = stringValue(call?.companyId ?? body?.companyId) ?? '-';
  const callJobId = stringValue(call?.callJobId ?? body?.callJobId) ?? '-';
  const discriminator =
    callbackType === 'CALL_INSTANCE_RESULT'
      ? [
          stringValue(call?.callInstanceId) ?? '-',
          stringValue(call?.finishStatus) ?? '-',
          stringValue(call?.calledTimes) ?? '-',
        ]
      : callbackType === 'JOB_INFO_RESULT'
        ? [stringValue(body?.callJobStatus) ?? '-']
        : [];
  const identity = [
    callbackType,
    truncateIdentity(companyId),
    truncateIdentity(callJobId),
    ...discriminator.map(truncateIdentity),
    rawBodySha256,
  ].join('\u0000');
  return {
    callbackType,
    eventKey: `BAIYING:${callbackType}:${createHash('sha256').update(identity, 'utf8').digest('hex')}`,
    rawBodySha256,
  };
}

export function calculateBillingMinutes(durationSeconds: number): number {
  if (!Number.isSafeInteger(durationSeconds) || durationSeconds < 0) {
    throw new TypeError('通话时长必须是非负安全整数秒');
  }
  return durationSeconds > 0 ? Math.ceil(durationSeconds / 60) : 0;
}

export function normalizeCallStatus(
  finishStatus: number,
): NormalizedCallStatus {
  if (finishStatus === 0) return 'ANSWERED';
  if (finishStatus === 1) return 'REJECTED';
  if (finishStatus === 6) return 'BUSY';
  if ([2, 4, 5, 7, 8].includes(finishStatus)) return 'NO_ANSWER';
  if ([3, 9, 10, 11, 12, 22, 23, 25].includes(finishStatus)) {
    return 'FAILED';
  }
  return 'UNKNOWN';
}

export function normalizePhone(phone: string): string {
  const compact = phone.trim().replace(/[\s()-]/g, '');
  if (compact.startsWith('+86')) return compact.slice(3);
  if (compact.startsWith('86') && compact.length === 13)
    return compact.slice(2);
  return compact;
}

function parseProperties(value: unknown): Record<string, unknown> {
  const direct = asRecord(value);
  if (direct) return direct;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    return asRecord(JSON.parse(value)) ?? {};
  } catch {
    return {};
  }
}

function readPlatformItemId(
  properties: Record<string, unknown>,
): string | null {
  const value = properties.sx_platform_item_id;
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, 128)
    : null;
}

function asObjectArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(asRecord)
    .filter((item): item is Record<string, unknown> => Boolean(item));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function truncateIdentity(value: string): string {
  return value.replace(/[:\s]/g, '_').slice(0, 128);
}

function nonEmpty(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function parseProviderDate(value: string | number | undefined): Date | null {
  if (value === undefined) return null;
  if (typeof value === 'number') {
    const millis = value < 100_000_000_000 ? value * 1_000 : value;
    const parsed = new Date(millis);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)
    ? `${trimmed.replace(' ', 'T')}+08:00`
    : trimmed;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

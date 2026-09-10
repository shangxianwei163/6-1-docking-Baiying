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

export type CustomerResultCode =
  | 'HIGH_INTENT'
  | 'MEDIUM_INTENT'
  | 'LOW_INTENT'
  | 'NO_INTENT'
  | 'UNREACHED'
  | 'CALL_FAILED'
  | 'UNKNOWN';

export type NormalizedConversationLog = {
  sequence: number;
  speaker: 'AI' | 'CUSTOMER';
  content: string;
};

export type NormalizedCustomerResult = {
  resultCode: CustomerResultCode;
  resultText: string;
  contacted: boolean;
  intentionLevel: string | null;
  intentionText: string;
  summary: string;
  followUpRequired: boolean;
  recommendedAction: string;
  customerConcerns: string[];
  customerTags: string[];
  collectedData: Record<string, unknown>;
};

export type BaiyingCallResult = {
  callbackType: 'CALL_INSTANCE_RESULT';
  companyId: string;
  callJobId: string;
  callInstanceId: string;
  callInstanceStatus: number | null;
  finishStatus: number;
  calledTimes: number | null;
  customerName: string | null;
  customerTelephone: string | null;
  durationSeconds: number;
  callStatus: NormalizedCallStatus;
  callStatusText: string;
  calledAt: Date | null;
  importedProperties: Record<string, unknown>;
  collectProperties: Record<string, unknown>;
  taskResults: Record<string, unknown>[];
  customerResult: NormalizedCustomerResult;
  conversationLogs: NormalizedConversationLog[];
  resultComplete: boolean;
  platformItemId: string | null;
  correlationToken: string | null;
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
    customerName: z.string().trim().max(200).optional(),
    customerTelephone: z.string().trim().min(1).max(64).optional(),
    duration: providerIntegerSchema.max(604_800).optional().default(0),
    properties: z.unknown().optional(),
    collectProperties: z.unknown().optional(),
    // Internal reconciliation explicitly marks a synthesized result as
    // incomplete. Baiying's real completed-call callback omits this field.
    resultComplete: z.boolean().optional(),
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
    const importedProperties = parseProperties(result.data.properties);
    const collectProperties = filterCollectedProperties(
      parseProperties(result.data.collectProperties),
    );
    const taskResults = asObjectArray(envelope.data.data.data.taskResult);
    const callStatus = normalizeCallStatus(result.data.finishStatus);
    const calledAt =
      parseProviderDate(providerDateValue(importedProperties.callStartTime)) ??
      parseProviderDate(result.data.startTime);
    const conversationLogs = normalizeConversationLogs(
      envelope.data.data.data.phoneLogs,
    );
    return {
      callbackType: 'CALL_INSTANCE_RESULT',
      companyId: result.data.companyId,
      callJobId: result.data.callJobId,
      callInstanceId: result.data.callInstanceId,
      callInstanceStatus: result.data.callInstanceStatus ?? null,
      finishStatus: result.data.finishStatus,
      calledTimes: result.data.calledTimes ?? null,
      customerName: nonEmpty(result.data.customerName),
      customerTelephone: result.data.customerTelephone ?? null,
      durationSeconds: result.data.duration,
      callStatus,
      callStatusText: describeCallStatus(callStatus, result.data.finishStatus),
      calledAt,
      importedProperties: filterCollectedProperties(importedProperties),
      collectProperties,
      taskResults,
      customerResult: normalizeCustomerResult({
        callStatus,
        finishStatus: result.data.finishStatus,
        collectProperties,
        taskResults,
      }),
      conversationLogs,
      resultComplete: result.data.resultComplete ?? true,
      platformItemId: readPlatformItemId(importedProperties),
      correlationToken: readCorrelationToken(importedProperties),
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
  companyId: string | null;
  callJobId: string | null;
  callInstanceId: string | null;
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
      companyId: null,
      callJobId: null,
      callInstanceId: null,
    };
  }
  const root = asRecord(value);
  const envelope = asRecord(root?.data);
  const body = asRecord(envelope?.data);
  const call = asRecord(body?.callInstance);
  const callbackType = truncateIdentity(
    stringValue(envelope?.callbackType ?? envelope?.dataType) ?? 'UNKNOWN',
  );
  const companyId = stringValue(call?.companyId ?? body?.companyId);
  const callJobId = stringValue(call?.callJobId ?? body?.callJobId);
  const callInstanceId = stringValue(call?.callInstanceId);
  const discriminator =
    callbackType === 'CALL_INSTANCE_RESULT'
      ? [
          callInstanceId ?? '-',
          stringValue(call?.finishStatus) ?? '-',
          stringValue(call?.calledTimes) ?? '-',
        ]
      : callbackType === 'JOB_INFO_RESULT'
        ? [stringValue(body?.callJobStatus) ?? '-']
        : [];
  const identity = [
    callbackType,
    truncateIdentity(companyId ?? '-'),
    truncateIdentity(callJobId ?? '-'),
    ...discriminator.map(truncateIdentity),
    rawBodySha256,
  ].join('\u0000');
  return {
    callbackType,
    eventKey: `BAIYING:${callbackType}:${createHash('sha256').update(identity, 'utf8').digest('hex')}`,
    rawBodySha256,
    companyId: companyId ? truncateIdentity(companyId) : null,
    callJobId: callJobId ? truncateIdentity(callJobId) : null,
    callInstanceId: callInstanceId ? truncateIdentity(callInstanceId) : null,
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

export function describeCallStatus(
  callStatus: NormalizedCallStatus,
  finishStatus: number | null,
): string {
  if (finishStatus === 0) return '已接通';
  const descriptions: Record<number, string> = {
    1: '客户拒接',
    2: '无法接通',
    3: '外呼失败',
    4: '空号',
    5: '已关机',
    6: '客户占线',
    7: '号码停机',
    8: '无人接听',
    9: '主叫欠费',
    10: '呼损',
    11: '号码在黑名单中',
    12: '天盾拦截',
    22: '线路盲区',
    23: '呼出拦截',
    25: '无可用线路',
  };
  if (finishStatus !== null && descriptions[finishStatus]) {
    return descriptions[finishStatus];
  }
  const fallback: Record<NormalizedCallStatus, string> = {
    ANSWERED: '已接通',
    NO_ANSWER: '未接通',
    BUSY: '客户占线',
    REJECTED: '客户拒接',
    FAILED: '外呼失败',
    UNKNOWN: '通话状态未知',
  };
  return fallback[callStatus];
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

type NormalizedTaskResult = {
  name: string;
  value: unknown;
  description: string | null;
  labels: string[];
};

function normalizeCustomerResult(input: {
  callStatus: NormalizedCallStatus;
  finishStatus: number;
  collectProperties: Record<string, unknown>;
  taskResults: Record<string, unknown>[];
}): NormalizedCustomerResult {
  const taskResults = input.taskResults
    .map(normalizeTaskResult)
    .filter((result): result is NormalizedTaskResult => Boolean(result));
  const intentionEntry = findBusinessEntry(
    taskResults,
    input.collectProperties,
    /客户意向等级|意向等级|客户意向|意向度|意向分类|intention(?:_level)?|intent(?:_level)?/i,
  );
  const labelCandidates = uniqueStrings(
    taskResults.flatMap((result) => result.labels),
  );
  const intentionLevel = truncateText(
    scalarText(intentionEntry?.value) ??
      labelCandidates.find((label) => classifyIntention(label) !== 'UNKNOWN') ??
      null,
    8_192,
  );
  const intentionCode = classifyIntention(intentionLevel);
  const contacted = input.callStatus === 'ANSWERED';
  const resultCode = customerResultCode(
    input.callStatus,
    contacted,
    intentionCode,
  );
  const concernsEntry = findBusinessEntry(
    taskResults,
    input.collectProperties,
    /客户关注点|关注点|客户顾虑|顾虑|关注内容|concerns?/i,
  );
  const tagsEntry = findBusinessEntry(
    taskResults,
    input.collectProperties,
    /客户标签|用户标签|业务标签|customer_tags?|tags?/i,
  );
  const customerConcerns = uniqueStrings(listValue(concernsEntry?.value));
  const customerTags = uniqueStrings([
    ...labelCandidates,
    ...listValue(tagsEntry?.value),
  ]);
  const explicitSummary = scalarText(
    findBusinessEntry(
      taskResults,
      input.collectProperties,
      /客户情况摘要|客户摘要|通话摘要|业务摘要|沟通摘要|summary/i,
    )?.value,
  );
  const explicitAction = scalarText(
    findBusinessEntry(
      taskResults,
      input.collectProperties,
      /跟进建议|建议跟进动作|推荐动作|下一步动作|处理建议|recommended_action|next_action/i,
    )?.value,
  );
  const explicitFollowUp = booleanValue(
    findBusinessEntry(
      taskResults,
      input.collectProperties,
      /是否需要跟进|需要跟进|跟进标记|follow_up_required|need_follow_up/i,
    )?.value,
  );
  const intentionText = describeIntention(resultCode);
  return {
    resultCode,
    resultText: describeCustomerResult(resultCode),
    contacted,
    intentionLevel,
    intentionText,
    summary:
      truncateText(explicitSummary, 2_000) ??
      buildCustomerSummary({
        callStatusText: describeCallStatus(
          input.callStatus,
          input.finishStatus,
        ),
        contacted,
        intentionText,
        concerns: customerConcerns,
        collectedData: input.collectProperties,
      }),
    followUpRequired: explicitFollowUp ?? defaultFollowUpRequired(resultCode),
    recommendedAction:
      truncateText(explicitAction, 1_000) ??
      defaultRecommendedAction(resultCode),
    customerConcerns,
    customerTags,
    collectedData: filterBusinessCollectedData(input.collectProperties),
  };
}

function filterBusinessCollectedData(
  collectedData: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(collectedData).filter(
      ([name]) =>
        !/客户意向等级|意向等级|客户意向|意向度|意向分类|客户关注点|关注点|客户顾虑|顾虑|关注内容|客户标签|用户标签|业务标签|客户情况摘要|客户摘要|通话摘要|业务摘要|沟通摘要|跟进建议|建议跟进动作|推荐动作|下一步动作|处理建议|是否需要跟进|需要跟进|跟进标记|intention|intent|concerns?|customer_tags?|tags?|summary|recommended_action|next_action|follow_up_required|need_follow_up/i.test(
          name,
        ),
    ),
  );
}

function normalizeTaskResult(
  value: Record<string, unknown>,
): NormalizedTaskResult | null {
  const name = nonEmpty(
    stringValue(value.resultName ?? value.name ?? value.key) ?? undefined,
  );
  if (!name) return null;
  return {
    name,
    value: value.resultValue ?? value.value ?? null,
    description: nonEmpty(
      stringValue(value.resultDesc ?? value.description) ?? undefined,
    ),
    labels: normalizeResultLabels(value.resultLabels ?? value.labels),
  };
}

function normalizeResultLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return listValue(value);
  return uniqueStrings(
    value.flatMap((label) => {
      const record = asRecord(label);
      if (!record) return listValue(label);
      const name = scalarText(
        record.labelName ?? record.name ?? record.label ?? record.value,
      );
      return name ? [name] : [];
    }),
  );
}

function findBusinessEntry(
  taskResults: NormalizedTaskResult[],
  collectedData: Record<string, unknown>,
  namePattern: RegExp,
): { value: unknown } | null {
  const taskResult = taskResults.find((result) =>
    namePattern.test(result.name),
  );
  if (taskResult) {
    return {
      value: hasBusinessValue(taskResult.value)
        ? taskResult.value
        : taskResult.description,
    };
  }
  const collected = Object.entries(collectedData).find(([name]) =>
    namePattern.test(name),
  );
  return collected ? { value: collected[1] } : null;
}

function hasBusinessValue(value: unknown): boolean {
  return (
    value !== null &&
    value !== undefined &&
    (typeof value !== 'string' || Boolean(value.trim()))
  );
}

function classifyIntention(value: string | null): CustomerResultCode {
  if (!value) return 'UNKNOWN';
  const normalized = value.trim().replace(/\s+/g, '').toUpperCase();
  if (
    /^(D|N)(级|类|$)/.test(normalized) ||
    /^(D|N|NONE|NO_INTENT|无|无意向|暂无意向|不感兴趣|拒绝)$/.test(
      normalized,
    ) ||
    normalized.includes('无意向') ||
    normalized.includes('不感兴趣')
  ) {
    return 'NO_INTENT';
  }
  if (
    /^(A|S)(级|类|$)/.test(normalized) ||
    /^(A|S|HIGH|高|高意向|强意向|A级|A类)$/.test(normalized) ||
    normalized.includes('高意向') ||
    normalized.includes('强意向')
  ) {
    return 'HIGH_INTENT';
  }
  if (
    /^B(级|类|$)/.test(normalized) ||
    /^(B|MEDIUM|中|中意向|一般意向|B级|B类)$/.test(normalized) ||
    normalized.includes('中意向') ||
    normalized.includes('一般意向')
  ) {
    return 'MEDIUM_INTENT';
  }
  if (
    /^C(级|类|$)/.test(normalized) ||
    /^(C|LOW|低|低意向|弱意向|C级|C类)$/.test(normalized) ||
    normalized.includes('低意向') ||
    normalized.includes('弱意向')
  ) {
    return 'LOW_INTENT';
  }
  return 'UNKNOWN';
}

function customerResultCode(
  callStatus: NormalizedCallStatus,
  contacted: boolean,
  intentionCode: CustomerResultCode,
): CustomerResultCode {
  if (contacted) return intentionCode;
  if (callStatus === 'FAILED') return 'CALL_FAILED';
  if (['NO_ANSWER', 'BUSY', 'REJECTED'].includes(callStatus)) {
    return 'UNREACHED';
  }
  return 'UNKNOWN';
}

function describeIntention(resultCode: CustomerResultCode): string {
  const descriptions: Record<CustomerResultCode, string> = {
    HIGH_INTENT: '高意向',
    MEDIUM_INTENT: '中意向',
    LOW_INTENT: '低意向',
    NO_INTENT: '无意向',
    UNREACHED: '未接通，无法判断',
    CALL_FAILED: '外呼失败，无法判断',
    UNKNOWN: '意向暂不明确',
  };
  return descriptions[resultCode];
}

function describeCustomerResult(resultCode: CustomerResultCode): string {
  const descriptions: Record<CustomerResultCode, string> = {
    HIGH_INTENT: '客户有明确意向，建议尽快跟进',
    MEDIUM_INTENT: '客户有一定意向，建议继续跟进',
    LOW_INTENT: '客户意向较低，可后续培育',
    NO_INTENT: '客户目前没有明确意向',
    UNREACHED: '本次未接通客户',
    CALL_FAILED: '本次外呼失败',
    UNKNOWN: '客户意向暂不明确',
  };
  return descriptions[resultCode];
}

function defaultFollowUpRequired(resultCode: CustomerResultCode): boolean {
  return resultCode !== 'NO_INTENT';
}

function defaultRecommendedAction(resultCode: CustomerResultCode): string {
  const actions: Record<CustomerResultCode, string> = {
    HIGH_INTENT: '建议销售人员尽快联系客户，优先安排后续沟通',
    MEDIUM_INTENT: '建议根据客户关注点进行针对性跟进',
    LOW_INTENT: '建议进入后续培育名单，择期再次联系',
    NO_INTENT: '客户当前无明确意向，暂不安排主动跟进',
    UNREACHED: '建议稍后再次外呼客户',
    CALL_FAILED: '建议检查任务或线路状态后重新发起外呼',
    UNKNOWN: '建议业务人员查看通话记录后判断是否跟进',
  };
  return actions[resultCode];
}

function buildCustomerSummary(input: {
  callStatusText: string;
  contacted: boolean;
  intentionText: string;
  concerns: string[];
  collectedData: Record<string, unknown>;
}): string {
  if (!input.contacted) return `本次外呼${input.callStatusText}。`;
  const details = Object.entries(input.collectedData)
    .filter(
      ([name]) =>
        !/摘要|建议|标签|关注|顾虑|意向|summary|action|tags?|concerns?|intention|intent/i.test(
          name,
        ),
    )
    .slice(0, 3)
    .flatMap(([name, value]) => {
      const text = scalarText(value);
      return text ? [`${name}：${text}`] : [];
    });
  const parts = [`电话已接通，客户${input.intentionText}`];
  if (input.concerns.length) {
    parts.push(`关注${input.concerns.slice(0, 5).join('、')}`);
  }
  if (details.length) parts.push(details.join('；'));
  return truncateText(`${parts.join('；')}。`, 2_000)!;
}

function normalizeConversationLogs(
  value: unknown,
): NormalizedConversationLog[] {
  return asObjectArray(value)
    .flatMap((log) => {
      const rawSpeaker = scalarText(log.speaker)?.trim().toUpperCase();
      const speaker =
        rawSpeaker === 'AI'
          ? ('AI' as const)
          : rawSpeaker === 'ME'
            ? ('CUSTOMER' as const)
            : null;
      if (!speaker) return [];
      const content = scalarText(log.content) ?? '';
      return [{ speaker, content: content.slice(0, 20_000) }];
    })
    .slice(0, 10_000)
    .map((log, index) => ({
      sequence: index + 1,
      ...log,
    }));
}

function listValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const text = scalarText(item);
      return text ? [text] : [];
    });
  }
  const text = scalarText(value);
  if (!text) return [];
  const trimmed = text.trim();
  if (trimmed.startsWith('[')) {
    try {
      return listValue(JSON.parse(trimmed));
    } catch {
      // Fall through to delimiter parsing.
    }
  }
  return trimmed
    .split(/[,，、;；|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueStrings(values: string[]): string[] {
  return [
    ...new Set(
      values.map((value) => value.trim().slice(0, 8_192)).filter(Boolean),
    ),
  ].slice(0, 100);
}

function scalarText(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? '是' : '否';
  return null;
}

function booleanValue(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const text = scalarText(value)?.toLowerCase();
  if (!text) return null;
  if (['是', '需要', 'true', 'yes', 'y', '1'].includes(text)) return true;
  if (['否', '不需要', 'false', 'no', 'n', '0'].includes(text)) return false;
  return null;
}

function truncateText(value: string | null, maxLength: number): string | null {
  return value ? value.slice(0, maxLength) : null;
}

function readPlatformItemId(
  properties: Record<string, unknown>,
): string | null {
  const value = properties.sx_platform_item_id;
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, 128)
    : null;
}

function readCorrelationToken(
  properties: Record<string, unknown>,
): string | null {
  const value = properties.sx_correlation_token;
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value.trim())
    ? value.trim().toLowerCase()
    : null;
}

function filterCollectedProperties(
  properties: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(properties).filter(([name]) => {
      const normalized = name.trim().toLowerCase();
      return (
        normalized &&
        !normalized.startsWith('sx_') &&
        normalized !== '__proto__' &&
        normalized !== 'constructor' &&
        normalized !== 'prototype'
      );
    }),
  );
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

function providerDateValue(value: unknown): string | number | undefined {
  return typeof value === 'string' || typeof value === 'number'
    ? value
    : undefined;
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
  if (/^\d{10,13}$/.test(trimmed)) {
    return parseProviderDate(Number(trimmed));
  }
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)
    ? `${trimmed.replace(' ', 'T')}+08:00`
    : trimmed;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

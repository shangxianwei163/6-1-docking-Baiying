import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  operatorIntegrationLogDetailSchema,
  operatorIntegrationLogPageSchema,
  outboundCallResultCallbackTokenV2,
  recordingAvailableBatchEventV21Schema,
  toOutboundRecordingCallbackEnvelopeV2,
  type IntegrationLogDirection,
  type IntegrationLogStatus,
  type IntegrationLogSystem,
  type OperatorIntegrationLog,
  type OperatorIntegrationLogDetail,
  type OperatorIntegrationLogPage,
} from '@outbound/contracts';
import type { Database } from '../db/client.js';
import {
  callbackInbox,
  deliveryAttempts,
  deliveryEvents,
  idempotencyRecords,
  intakeBatches,
  platformTasks,
  taskCallItems,
  taskOperations,
} from '../db/schema.js';
import type { DataProtector } from '../security/data-protector.js';
import { redactOperatorText, sanitizeOperatorDetail } from './redaction.js';

export type IntegrationLogListInput = {
  keyword?: string;
  sourceSystem?: IntegrationLogSystem;
  direction?: IntegrationLogDirection;
  status?: IntegrationLogStatus;
  pageNum: number;
  pageSize: number;
};

type IntegrationDbRow = Omit<
  OperatorIntegrationLog,
  'operationLabel' | 'detail' | 'occurredAt'
> & {
  requestDetail: Record<string, unknown> | null;
  responseDetail: Record<string, unknown> | null;
  occurredAt: Date | string;
};

type IntegrationPageRow = {
  total: number;
  summaryAll: number;
  summarySucceeded: number;
  summaryFailed: number;
  summaryPending: number;
  summaryUnknown: number;
  summaryInbound: number;
  summaryOutbound: number;
  averageDurationMs: number | null;
  items: IntegrationDbRow[];
};

const operationLabels: Record<string, string> = {
  CREATE_OUTBOUND_TASK: '受理外呼任务',
  CREATE: '创建百应任务',
  IMPORT: '导入外呼名单',
  START: '启动百应任务',
  PAUSE: '暂停百应任务',
  RESUME: '恢复百应任务',
  TERMINATE: '终止百应任务',
  QUERY: '查询百应任务',
  RESULT: '回传外呼结果',
  RECORDING: '回传录音结果',
  CALL_INSTANCE_RESULT: '单通电话结果回调',
  JOB_INFO_RESULT: '外呼任务状态回调',
};

export interface IntegrationLogService {
  listLogs(input: IntegrationLogListInput): Promise<OperatorIntegrationLogPage>;
  getLogDetail(id: string): Promise<OperatorIntegrationLogDetail | null>;
}

export class PostgresIntegrationLogService implements IntegrationLogService {
  constructor(
    private readonly db: Database,
    private readonly protector?: Pick<DataProtector, 'decryptUtf8'>,
  ) {}

  async listLogs(
    input: IntegrationLogListInput,
  ): Promise<OperatorIntegrationLogPage> {
    const keyword = input.keyword?.trim() || null;
    const keywordPattern = keyword ? containsPattern(keyword) : null;
    const sourceSystem = input.sourceSystem ?? null;
    const direction = input.direction ?? null;
    const status = input.status ?? null;
    const offset = input.pageNum * input.pageSize;

    const rows = await this.db.execute<IntegrationPageRow>(sql`
      with integration_logs as (
        select
          'task-intake:' || record.source_system || ':' || record.client_id || ':' || record.idempotency_key as id,
          record.request_id as "requestId",
          record.source_system::text as "sourceSystem",
          'INBOUND'::text as direction,
          'TASK_INTAKE'::text as category,
          'CREATE_OUTBOUND_TASK'::text as "operationCode",
          '平台外呼任务受理'::text as "endpointLabel",
          task.task_no as "taskNo",
          case
            when record.processing_status = 'PENDING' then 'PENDING'
            when record.processing_status = 'COMPLETED' and record.response_status between 200 and 299 then 'SUCCEEDED'
            when record.processing_status = 'FAILED' or record.response_status >= 400 then 'FAILED'
            else 'UNKNOWN'
          end::text as status,
          record.response_status as "responseStatus",
          null::int as "durationMs",
          1::int as "attemptNo",
          case when record.response_status >= 400 then 'HTTP_' || record.response_status::text else null end as "errorCode",
          case when record.response_status >= 400 then record.response_body_json::text else null end as "errorMessage",
          jsonb_build_object(
            'clientId', record.client_id,
            'idempotencyKey', record.idempotency_key,
            'requestBodySha256', record.request_body_sha256
          ) as "requestDetail",
          record.response_body_json as "responseDetail",
          record.created_at as "occurredAt"
        from idempotency_record record
        left join platform_task task on task.id = record.task_id
        where record.source_system in ('ERP', 'CRM')

        union all

        select
          'task-operation:' || operation.id::text,
          coalesce(operation.provider_request_id, operation.id::text),
          'BAIYING'::text,
          'OUTBOUND'::text,
          'PROVIDER_OPERATION'::text,
          operation.operation_type::text,
          '百应任务编排'::text,
          task.task_no,
          operation.status::text,
          null::int,
          case
            when operation.finished_at is null then null
            else greatest(0, floor(extract(epoch from (operation.finished_at - operation.started_at)) * 1000)::int)
          end,
          operation.attempt_no,
          operation.error_code,
          operation.error_message,
          operation.request_payload_redacted_json,
          operation.response_payload_redacted_json,
          operation.started_at
        from task_operation operation
        join platform_task task on task.id = operation.task_id

        union all

        select
          'callback:' || inbox.id::text,
          inbox.event_key,
          'BAIYING'::text,
          'INBOUND'::text,
          'CALLBACK'::text,
          inbox.callback_type,
          '/api/v1/callbacks/baiying'::text,
          null::varchar,
          case
            when inbox.process_status = 'SUCCEEDED' then 'SUCCEEDED'
            when inbox.process_status = 'FAILED' or inbox.parse_status in ('INVALID', 'UNKNOWN_TYPE') then 'FAILED'
            when inbox.process_status in ('PENDING', 'PROCESSING') then 'PENDING'
            else 'UNKNOWN'
          end::text,
          200::int,
          case
            when inbox.processed_at is null then null
            else greatest(0, floor(extract(epoch from (inbox.processed_at - inbox.received_at)) * 1000)::int)
          end,
          inbox.process_attempts,
          case
            when inbox.parse_error is not null then 'CALLBACK_PARSE_FAILED'
            when inbox.process_error is not null then 'CALLBACK_PROCESS_FAILED'
            else null
          end,
          coalesce(inbox.process_error, inbox.parse_error),
          jsonb_build_object(
            'eventKey', inbox.event_key,
            'payloadSha256', inbox.raw_body_sha256,
            'headers', inbox.headers_json
          ),
          jsonb_build_object(
            'parseStatus', inbox.parse_status,
            'processStatus', inbox.process_status,
            'deadLettered', inbox.dead_lettered_at is not null
          ),
          inbox.received_at
        from callback_inbox inbox

        union all

        select
          'delivery-attempt:' || attempt.id::text,
          event.event_id::text,
          event.source_system::text,
          'OUTBOUND'::text,
          'DELIVERY'::text,
          event.target::text,
          case when event.target = 'RESULT' then 'ERP/CRM 结果回传' else 'ERP/CRM 录音回传' end,
          task.task_no,
          case when attempt.status = 'SUCCEEDED' then 'SUCCEEDED' else 'FAILED' end::text,
          attempt.response_status,
          attempt.duration_ms,
          attempt.attempt_no,
          attempt.error_class,
          attempt.error_message,
          jsonb_build_object(
            'eventId', event.event_id,
            'eventType', event.event_type,
            'target', event.target,
            'eventKey', event.event_key
          ),
          jsonb_build_object('summary', attempt.response_summary),
          attempt.requested_at
        from delivery_attempt attempt
        join delivery_event event on event.id = attempt.delivery_event_id
        join platform_task task on task.id = event.task_id
      ), base_filtered as (
        select *
        from integration_logs
        where (${sourceSystem}::text is null or "sourceSystem" = ${sourceSystem})
          and (${direction}::text is null or direction = ${direction})
          and (
            ${keywordPattern}::text is null
            or concat_ws(' ', "requestId", "operationCode", "endpointLabel", "taskNo") ilike ${keywordPattern}
          )
      ), filtered as (
        select *
        from base_filtered
        where (${status}::text is null or status = ${status})
      ), page_rows as (
        select *
        from filtered
        order by "occurredAt" desc, id desc
        limit ${input.pageSize}
        offset ${offset}
      )
      select
        (select count(*)::int from filtered) as total,
        (select count(*)::int from base_filtered) as "summaryAll",
        (select count(*) filter (where status = 'SUCCEEDED')::int from base_filtered) as "summarySucceeded",
        (select count(*) filter (where status = 'FAILED')::int from base_filtered) as "summaryFailed",
        (select count(*) filter (where status = 'PENDING')::int from base_filtered) as "summaryPending",
        (select count(*) filter (where status = 'UNKNOWN')::int from base_filtered) as "summaryUnknown",
        (select count(*) filter (where direction = 'INBOUND')::int from base_filtered) as "summaryInbound",
        (select count(*) filter (where direction = 'OUTBOUND')::int from base_filtered) as "summaryOutbound",
        (select round(avg("durationMs"))::int from base_filtered where "durationMs" is not null) as "averageDurationMs",
        coalesce((select jsonb_agg(to_jsonb(page_rows) order by "occurredAt" desc, id desc) from page_rows), '[]'::jsonb) as items
    `);
    const row = rows[0] ?? emptyPageRow();
    const items = row.items.map(toOperatorLog);
    return operatorIntegrationLogPageSchema.parse({
      total: row.total,
      pages: Math.ceil(row.total / input.pageSize),
      pageNum: input.pageNum,
      pageSize: input.pageSize,
      summary: {
        all: row.summaryAll,
        succeeded: row.summarySucceeded,
        failed: row.summaryFailed,
        pending: row.summaryPending,
        unknown: row.summaryUnknown,
        inbound: row.summaryInbound,
        outbound: row.summaryOutbound,
        averageDurationMs: row.averageDurationMs,
      },
      items,
    });
  }

  async getLogDetail(id: string): Promise<OperatorIntegrationLogDetail | null> {
    if (id.startsWith('callback:')) {
      return this.getCallbackDetail(id);
    }
    if (id.startsWith('delivery-attempt:')) {
      return this.getDeliveryDetail(id);
    }
    if (id.startsWith('task-operation:')) {
      return this.getProviderOperationDetail(id);
    }
    if (id.startsWith('task-intake:')) {
      return this.getTaskIntakeDetail(id);
    }
    return null;
  }

  private async getCallbackDetail(
    id: string,
  ): Promise<OperatorIntegrationLogDetail | null> {
    const inboxId = uuidOrNull(id.slice('callback:'.length));
    if (!inboxId) return null;
    const [row] = await this.db
      .select()
      .from(callbackInbox)
      .where(eq(callbackInbox.id, inboxId))
      .limit(1);
    if (!row) return null;

    let body: unknown = null;
    let note: string | null = null;
    if (this.protector) {
      try {
        body = parseJsonText(this.protector.decryptUtf8(row.rawBodyCiphertext));
      } catch {
        note = '原始回调正文解密失败，已显示其余完整处理字段。';
      }
    } else {
      note = '当前运行环境未配置回调正文解密器，已显示其余完整处理字段。';
    }

    return operatorIntegrationLogDetailSchema.parse({
      id,
      detailLevel: body === null ? 'STORED_SNAPSHOT' : 'FULL',
      request: {
        headers: row.headers,
        body,
        bodySha256: row.rawBodySha256,
      },
      response: {
        provider: row.provider,
        callbackType: row.callbackType,
        eventKey: row.eventKey,
        companyId: row.companyId,
        callJobId: row.callJobId,
        callInstanceId: row.callInstanceId,
        parseStatus: row.parseStatus,
        processStatus: row.processStatus,
        processAttempts: row.processAttempts,
        parseError: row.parseError,
        processError: row.processError,
        deadLetteredAt: row.deadLetteredAt?.toISOString() ?? null,
        receivedAt: row.receivedAt.toISOString(),
        processedAt: row.processedAt?.toISOString() ?? null,
      },
      note,
    });
  }

  private async getDeliveryDetail(
    id: string,
  ): Promise<OperatorIntegrationLogDetail | null> {
    const attemptId = uuidOrNull(id.slice('delivery-attempt:'.length));
    if (!attemptId) return null;
    const [row] = await this.db
      .select({ event: deliveryEvents, attempt: deliveryAttempts })
      .from(deliveryAttempts)
      .innerJoin(
        deliveryEvents,
        eq(deliveryEvents.id, deliveryAttempts.deliveryEventId),
      )
      .where(eq(deliveryAttempts.id, attemptId))
      .limit(1);
    if (!row) return null;

    const note = row.event.payload
      ? null
      : '请求正文保存在对象存储中，当前详情接口只能显示对象键。';
    return operatorIntegrationLogDetailSchema.parse({
      id,
      detailLevel: row.event.payload ? 'FULL' : 'STORED_SNAPSHOT',
      request: {
        targetUrl: row.event.targetUrlSnapshot,
        eventId: row.event.eventId,
        eventType: row.event.eventType,
        target: row.event.target,
        body: externalDeliveryBody(row.event.eventType, row.event.payload),
        payloadObjectKey: row.event.payloadObjectKey,
      },
      response: {
        httpStatus: row.attempt.responseStatus,
        body: parseJsonText(row.attempt.responseSummary),
        status: row.attempt.status,
        attemptNo: row.attempt.attemptNo,
        errorClass: row.attempt.errorClass,
        errorMessage: row.attempt.errorMessage,
        durationMs: row.attempt.durationMs,
        requestedAt: row.attempt.requestedAt.toISOString(),
      },
      note,
    });
  }

  private async getProviderOperationDetail(
    id: string,
  ): Promise<OperatorIntegrationLogDetail | null> {
    const operationId = uuidOrNull(id.slice('task-operation:'.length));
    if (!operationId) return null;
    const [row] = await this.db
      .select()
      .from(taskOperations)
      .where(eq(taskOperations.id, operationId))
      .limit(1);
    if (!row) return null;

    const storedRequest = this.decryptRequest(row.requestPayloadCiphertext);
    if (storedRequest !== null) {
      return operatorIntegrationLogDetailSchema.parse({
        id,
        detailLevel: 'FULL',
        request: storedRequest,
        response: row.responsePayloadRedacted,
        note: null,
      });
    }

    let reconstructed: Record<string, unknown> | null = null;
    try {
      reconstructed = await this.reconstructProviderRequest(
        row.taskId,
        row.operationType,
        row.requestPayloadRedacted,
      );
    } catch {
      reconstructed = null;
    }
    return operatorIntegrationLogDetailSchema.parse({
      id,
      detailLevel: reconstructed ? 'FULL' : 'STORED_SNAPSHOT',
      request: reconstructed ?? row.requestPayloadRedacted,
      response: row.responsePayloadRedacted,
      note: reconstructed
        ? '该历史记录未保存完整请求快照，已依据平台任务的加密业务数据重建完整请求。'
        : '该历史记录缺少可用于重建的任务数据，只能显示当时保存的请求快照。',
    });
  }

  private async getTaskIntakeDetail(
    id: string,
  ): Promise<OperatorIntegrationLogDetail | null> {
    const [sourceSystem, clientId, ...keyParts] = id
      .slice('task-intake:'.length)
      .split(':');
    const idempotencyKey = keyParts.join(':');
    if (!sourceSystem || !clientId || !idempotencyKey) return null;
    const [row] = await this.db
      .select()
      .from(idempotencyRecords)
      .where(
        and(
          eq(idempotencyRecords.sourceSystem, sourceSystem),
          eq(idempotencyRecords.clientId, clientId),
          eq(idempotencyRecords.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    if (!row) return null;

    const storedRequest = this.decryptRequest(row.requestBodyCiphertext);
    if (storedRequest !== null) {
      return operatorIntegrationLogDetailSchema.parse({
        id,
        detailLevel: 'FULL',
        request: storedRequest,
        response: row.responseBody,
        note: null,
      });
    }

    let reconstructed: Record<string, unknown> | null = null;
    try {
      reconstructed = row.taskId
        ? await this.reconstructTaskIntakeRequest(row.taskId)
        : null;
    } catch {
      reconstructed = null;
    }
    return operatorIntegrationLogDetailSchema.parse({
      id,
      detailLevel: reconstructed ? 'FULL' : 'STORED_SNAPSHOT',
      request: reconstructed ?? {
        sourceSystem: row.sourceSystem,
        clientId: row.clientId,
        idempotencyKey: row.idempotencyKey,
        requestId: row.requestId,
        requestBodySha256: row.requestBodySha256,
      },
      response: row.responseBody,
      note: reconstructed
        ? '该历史记录未保存原始请求快照，已依据平台任务的加密业务数据重建完整请求。'
        : '该历史记录缺少可用于重建的任务数据，只能显示当时保存的请求摘要。',
    });
  }

  private decryptRequest(ciphertext: string | null): unknown {
    if (!ciphertext || !this.protector) return null;
    try {
      return parseJsonText(this.protector.decryptUtf8(ciphertext));
    } catch {
      return null;
    }
  }

  private async reconstructProviderRequest(
    taskId: string,
    operationType: string,
    snapshot: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    if (!this.protector) return null;
    const [task] = await this.db
      .select()
      .from(platformTasks)
      .where(eq(platformTasks.id, taskId))
      .limit(1);
    if (!task) return null;

    if (operationType === 'CREATE') {
      return {
        callJobName: task.taskName,
        callJobType: 2,
        companyId: task.baiyingCompanyId,
        robotDefId: task.robotDefId,
        userPhoneIds: [task.userPhoneId],
      };
    }
    if (operationType === 'IMPORT') {
      const items = await this.listTaskCallItems(task.id);
      return {
        callJobId: task.baiyingCallJobId,
        companyId: task.baiyingCompanyId,
        customerInfoVOList: items.map((item) => ({
          name: item.customerNameCiphertext
            ? this.protector!.decryptUtf8(item.customerNameCiphertext)
            : `客户${item.ordinal}`,
          phone: this.protector!.decryptUtf8(item.phoneCiphertext),
          properties: {
            ...parseJsonRecord(
              this.protector!.decryptUtf8(item.mappedPropertiesCiphertext),
            ),
            sx_platform_item_id: item.id,
          },
        })),
        permitrepeatnum: false,
      };
    }
    if (operationType === 'QUERY') {
      if (snapshot.purpose === 'CREATE_RECOVERY') {
        return {
          companyId: task.baiyingCompanyId,
          jobName: task.taskName,
          pageNum: 1,
          pageSize: 200,
        };
      }
      return {
        companyId: task.baiyingCompanyId,
        callJobId: task.baiyingCallJobId,
      };
    }
    const command = providerCommand(operationType);
    if (command !== null) {
      return {
        callJobId: task.baiyingCallJobId,
        companyId: task.baiyingCompanyId,
        command,
      };
    }
    return snapshot;
  }

  private async reconstructTaskIntakeRequest(
    taskId: string,
  ): Promise<Record<string, unknown> | null> {
    if (!this.protector) return null;
    const [task] = await this.db
      .select()
      .from(platformTasks)
      .where(eq(platformTasks.id, taskId))
      .limit(1);
    if (!task) return null;

    if (!task.batchId) {
      const items = await this.listTaskCallItems(task.id);
      return {
        schemaVersion: task.contractVersion,
        externalRequestId: task.externalRequestId,
        sourceSystem: task.sourceSystem,
        mcCode: task.mcCodeSnapshot,
        taskName: task.taskName,
        customers: items.map((item) => ({
          externalCustomerId: item.externalCustomerId,
          ...(item.customerNameCiphertext
            ? { name: this.protector!.decryptUtf8(item.customerNameCiphertext) }
            : {}),
          phone: this.protector!.decryptUtf8(item.phoneCiphertext),
          dataCategoryId: item.dataCategoryId,
          fields: parseJsonRecord(
            this.protector!.decryptUtf8(item.sourceFieldsCiphertext),
          ),
        })),
      };
    }

    const [batch] = await this.db
      .select()
      .from(intakeBatches)
      .where(eq(intakeBatches.id, task.batchId))
      .limit(1);
    if (!batch) return null;
    const items = await this.listBatchCallItems(task.batchId);
    const groups = new Map<string, Array<Record<string, unknown>>>();
    for (const item of items) {
      const level = item.categorySnapshot?.cLevel ?? '';
      const customers = groups.get(level) ?? [];
      customers.push({
        phone: this.protector.decryptUtf8(item.phoneCiphertext),
        guid: item.externalCustomerId,
        ...(item.customerNameCiphertext
          ? {
              customer_name: this.protector.decryptUtf8(
                item.customerNameCiphertext,
              ),
            }
          : {}),
        ...parseJsonRecord(
          this.protector.decryptUtf8(item.sourceFieldsCiphertext),
        ),
      });
      groups.set(level, customers);
    }
    return {
      main_category: batch.mainCategory,
      sub_category: batch.subCategory,
      source: batch.sourceSystem === 'ERP' ? 0 : 1,
      company_code: batch.mcCodeSnapshot,
      customer_list: [...groups].map(([cLevel, customers]) => ({
        c_level: cLevel,
        c_info_list: customers,
      })),
    };
  }

  private listTaskCallItems(taskId: string) {
    return this.db
      .select()
      .from(taskCallItems)
      .where(eq(taskCallItems.taskId, taskId))
      .orderBy(asc(taskCallItems.ordinal));
  }

  private listBatchCallItems(batchId: string) {
    return this.db
      .select()
      .from(taskCallItems)
      .where(eq(taskCallItems.batchId, batchId))
      .orderBy(asc(taskCallItems.createdAt), asc(taskCallItems.ordinal));
  }
}

function toOperatorLog(row: IntegrationDbRow): OperatorIntegrationLog {
  const details = {
    request: row.requestDetail ?? {},
    response: row.responseDetail ?? {},
  };
  return {
    id: row.id,
    requestId: row.requestId,
    sourceSystem: row.sourceSystem,
    direction: row.direction,
    category: row.category,
    operationCode: row.operationCode,
    operationLabel:
      operationLabels[row.operationCode] ?? humanize(row.operationCode),
    endpointLabel: row.endpointLabel,
    taskNo: row.taskNo,
    status: row.status,
    responseStatus: row.responseStatus,
    durationMs: row.durationMs,
    attemptNo: row.attemptNo,
    errorCode: row.errorCode,
    errorMessage: redactOperatorText(row.errorMessage),
    detail: sanitizeOperatorDetail(details),
    occurredAt: toIso(row.occurredAt),
  };
}

function emptyPageRow(): IntegrationPageRow {
  return {
    total: 0,
    summaryAll: 0,
    summarySucceeded: 0,
    summaryFailed: 0,
    summaryPending: 0,
    summaryUnknown: 0,
    summaryInbound: 0,
    summaryOutbound: 0,
    averageDurationMs: null,
    items: [],
  };
}

function containsPattern(value: string) {
  return `%${value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
}

function humanize(value: string) {
  return value
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function toIso(value: Date | string) {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function parseJsonText(value: string | null): unknown {
  if (value === null || value === '') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function parseJsonRecord(value: string): Record<string, unknown> {
  const parsed = parseJsonText(value);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('接口日志关联的业务字段不是有效 JSON 对象');
  }
  return parsed as Record<string, unknown>;
}

function providerCommand(operationType: string): 1 | 2 | 3 | null {
  if (operationType === 'START' || operationType === 'RESUME') return 1;
  if (operationType === 'PAUSE') return 2;
  if (operationType === 'TERMINATE') return 3;
  return null;
}

function externalDeliveryBody(
  eventType: string,
  payload: Record<string, unknown> | null,
) {
  if (
    eventType === 'OUTBOUND_CALL_RESULT_V2' &&
    payload?.schemaVersion === '2.1' &&
    payload.result
  ) {
    return { Token: outboundCallResultCallbackTokenV2, Data: payload.result };
  }
  if (
    eventType === 'OUTBOUND_RECORDING_AVAILABLE_BATCH' &&
    payload?.schemaVersion === '2.1'
  ) {
    const parsed = recordingAvailableBatchEventV21Schema.safeParse(payload);
    if (parsed.success) {
      return toOutboundRecordingCallbackEnvelopeV2(parsed.data);
    }
  }
  return payload;
}

function uuidOrNull(value: string) {
  const parsed = z.uuid().safeParse(value);
  return parsed.success ? parsed.data : null;
}

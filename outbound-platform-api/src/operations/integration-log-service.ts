import { sql } from 'drizzle-orm';
import {
  operatorIntegrationLogPageSchema,
  type IntegrationLogDirection,
  type IntegrationLogStatus,
  type IntegrationLogSystem,
  type OperatorIntegrationLog,
  type OperatorIntegrationLogPage,
} from '@outbound/contracts';
import type { Database } from '../db/client.js';
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
};

export interface IntegrationLogService {
  listLogs(input: IntegrationLogListInput): Promise<OperatorIntegrationLogPage>;
}

export class PostgresIntegrationLogService implements IntegrationLogService {
  constructor(private readonly db: Database) {}

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

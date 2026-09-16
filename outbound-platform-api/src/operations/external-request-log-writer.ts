import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { externalApiRequestLogs } from '../db/schema.js';
import type { DataProtector } from '../security/data-protector.js';

export type ExternalRequestLogSource = 'ERP' | 'CRM' | 'BAIYING' | 'UNKNOWN';

export type ExternalRequestLogStartInput = {
  requestId: string;
  sourceSystem: ExternalRequestLogSource;
  operationCode: string;
  endpointLabel: string;
  method: string;
  path: string;
  query: Record<string, string>;
  idempotencyKey: string | null;
  requestHeaders: Record<string, string>;
  startedAt: Date;
};

export type ExternalRequestLogCompleteInput = {
  id: string;
  sourceSystem: ExternalRequestLogSource;
  clientId: string | null;
  requestBody: string | null;
  responseStatus: number;
  responseBody: string | null;
  responseSummary: Record<string, unknown> | null;
  taskNo: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  finishedAt: Date;
  durationMs: number;
};

export interface ExternalRequestLogWriter {
  start(input: ExternalRequestLogStartInput): Promise<string>;
  complete(input: ExternalRequestLogCompleteInput): Promise<void>;
}

export class PostgresExternalRequestLogWriter implements ExternalRequestLogWriter {
  constructor(
    private readonly db: Database,
    private readonly protector: Pick<DataProtector, 'encryptUtf8'>,
  ) {}

  async start(input: ExternalRequestLogStartInput): Promise<string> {
    const [row] = await this.db
      .insert(externalApiRequestLogs)
      .values({
        requestId: input.requestId,
        sourceSystem: input.sourceSystem,
        operationCode: input.operationCode,
        endpointLabel: input.endpointLabel,
        method: input.method,
        path: input.path,
        query: input.query,
        idempotencyKey: input.idempotencyKey,
        requestHeaders: input.requestHeaders,
        status: 'PENDING',
        startedAt: input.startedAt,
      })
      .returning({ id: externalApiRequestLogs.id });
    if (!row) throw new Error('外部接口访问日志创建失败');
    return row.id;
  }

  async complete(input: ExternalRequestLogCompleteInput): Promise<void> {
    const rows = await this.db
      .update(externalApiRequestLogs)
      .set({
        sourceSystem: input.sourceSystem,
        clientId: input.clientId,
        requestBodySha256:
          input.requestBody === null
            ? null
            : createHash('sha256')
                .update(input.requestBody, 'utf8')
                .digest('hex'),
        requestBodyCiphertext:
          input.requestBody === null
            ? null
            : this.protector.encryptUtf8(input.requestBody),
        responseStatus: input.responseStatus,
        responseBodyCiphertext:
          input.responseBody === null
            ? null
            : this.protector.encryptUtf8(input.responseBody),
        responseSummary: input.responseSummary,
        taskNo: input.taskNo,
        status:
          input.responseStatus >= 200 && input.responseStatus < 300
            ? 'SUCCEEDED'
            : 'FAILED',
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
        durationMs: Math.max(0, Math.trunc(input.durationMs)),
        finishedAt: input.finishedAt,
      })
      .where(
        and(
          eq(externalApiRequestLogs.id, input.id),
          eq(externalApiRequestLogs.status, 'PENDING'),
        ),
      )
      .returning({ id: externalApiRequestLogs.id });
    if (!rows.length) throw new Error('外部接口访问日志已完成或不存在');
  }
}

import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import {
  recordingDownloadUrlEnvelopeSchema,
  type RecordingDownloadUrlEnvelope,
} from '@outbound/contracts';
import type { Database } from '../db/client.js';
import {
  auditLogs,
  callInstances,
  platformTasks,
  recordingAssets,
  recordingUrlIssues,
} from '../db/schema.js';
import type { ExternalPrincipal } from '../openapi/authenticator.js';
import { ExternalApiFailure } from '../openapi/errors.js';
import {
  RecordingAccessFailure,
  requireAvailableRecordingAsset,
} from './access-service.js';
import { RecordingDownloadUrlIssuer } from './url-issuer.js';
import type { RecordingUrlSigner } from './url-signer.js';

export type RecordingUrlReissueResult = {
  status: 200;
  body: RecordingDownloadUrlEnvelope;
  replayed: boolean;
};

export interface RecordingUrlReissue {
  issue(input: {
    recordingId: string;
    principal: ExternalPrincipal;
    idempotencyKey: string;
    requestId: string;
  }): Promise<RecordingUrlReissueResult>;
}

export class PostgresRecordingUrlReissueService implements RecordingUrlReissue {
  private readonly urlIssuer: RecordingDownloadUrlIssuer;

  constructor(
    private readonly db: Database,
    private readonly signer: RecordingUrlSigner,
    private readonly options: {
      publicBaseUrl: string;
      ttlSeconds?: number;
      environment: 'development' | 'test' | 'production';
      idempotencyRetentionDays?: number;
      clock?: () => Date;
    },
  ) {
    this.urlIssuer = new RecordingDownloadUrlIssuer(signer, options);
    const retentionDays = this.idempotencyRetentionDays;
    if (!Number.isInteger(retentionDays) || retentionDays < 7) {
      throw new TypeError('录音重签幂等记录至少保留 7 天');
    }
  }

  async issue(input: {
    recordingId: string;
    principal: ExternalPrincipal;
    idempotencyKey: string;
    requestId: string;
  }): Promise<RecordingUrlReissueResult> {
    const idempotencyKey = input.idempotencyKey.trim();
    if (idempotencyKey.length < 8 || idempotencyKey.length > 128) {
      throw new ExternalApiFailure(
        'INVALID_REQUEST',
        'Idempotency-Key 长度必须为 8～128 个字符',
        400,
      );
    }
    const now = this.clock();
    const idempotencyKeyHash = sha256(idempotencyKey);
    const requestFingerprint = sha256(
      `RECORDING_DOWNLOAD_URL_REISSUE\n${input.recordingId}`,
    );

    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`recording-url-reissue:${input.principal.integrationClientId}:${idempotencyKeyHash}`}, 0))`,
      );
      const [stored] = await tx
        .select()
        .from(recordingUrlIssues)
        .where(
          and(
            eq(
              recordingUrlIssues.integrationClientId,
              input.principal.integrationClientId,
            ),
            eq(recordingUrlIssues.idempotencyKeyHash, idempotencyKeyHash),
          ),
        )
        .limit(1);
      if (stored && stored.expiresAt > now) {
        if (
          stored.sourceSystem !== input.principal.sourceSystem ||
          stored.requestFingerprint !== requestFingerprint ||
          stored.recordingId !== input.recordingId
        ) {
          throw new ExternalApiFailure(
            'IDEMPOTENCY_CONFLICT',
            '同一 Idempotency-Key 对应了不同的录音重签请求',
            409,
          );
        }
        const body = recordingDownloadUrlEnvelopeSchema.safeParse(
          stored.responseBody,
        );
        if (!body.success || stored.responseStatus !== 200) {
          throw new ExternalApiFailure(
            'SERVICE_TEMPORARILY_UNAVAILABLE',
            '历史录音重签幂等响应不可用',
            503,
          );
        }
        return { status: 200, body: body.data, replayed: true };
      }
      if (stored) {
        await tx
          .delete(recordingUrlIssues)
          .where(
            and(
              eq(
                recordingUrlIssues.integrationClientId,
                input.principal.integrationClientId,
              ),
              eq(recordingUrlIssues.idempotencyKeyHash, idempotencyKeyHash),
            ),
          );
      }

      const [row] = await tx
        .select({
          id: recordingAssets.id,
          taskId: callInstances.taskId,
          integrationClientId: platformTasks.integrationClientId,
          sourceSystem: platformTasks.sourceSystem,
          archiveStatus: recordingAssets.archiveStatus,
          bucket: recordingAssets.ossBucket,
          objectKey: recordingAssets.ossObjectKey,
          contentType: recordingAssets.contentType,
          sizeBytes: recordingAssets.sizeBytes,
          sha256: recordingAssets.sha256,
          retentionUntil: recordingAssets.retentionUntil,
          deletedAt: recordingAssets.deletedAt,
        })
        .from(recordingAssets)
        .innerJoin(
          callInstances,
          eq(callInstances.id, recordingAssets.callInstanceId),
        )
        .innerJoin(platformTasks, eq(platformTasks.id, callInstances.taskId))
        .where(eq(recordingAssets.id, input.recordingId))
        .limit(1);
      if (
        !row ||
        row.integrationClientId !== input.principal.integrationClientId ||
        row.sourceSystem !== input.principal.sourceSystem
      ) {
        throw new RecordingAccessFailure(
          'RECORDING_NOT_FOUND',
          '录音不存在',
          404,
        );
      }
      if (row.sourceSystem !== 'ERP' && row.sourceSystem !== 'CRM') {
        throw new RecordingAccessFailure(
          'RECORDING_NOT_FOUND',
          '录音不存在',
          404,
        );
      }
      const asset = requireAvailableRecordingAsset(
        { ...row, sourceSystem: row.sourceSystem },
        now,
      );
      const audience = this.signer.audienceToken(
        'INTEGRATION_CLIENT',
        input.principal.integrationClientId,
      );
      const data = this.urlIssuer.issue({
        recordingId: asset.id,
        audience,
        sha256: asset.sha256!,
        now,
      });
      const body = recordingDownloadUrlEnvelopeSchema.parse({
        code: 'OK',
        message: 'success',
        requestId: input.requestId,
        data,
      });
      await tx.insert(auditLogs).values({
        requestId: input.requestId,
        actorId: `integration:${input.principal.sourceSystem}:${input.principal.integrationClientId}`,
        action: 'RECORDING_DOWNLOAD_URL_ISSUED',
        objectType: 'RECORDING',
        objectId: input.recordingId,
        detail: {
          recordingId: input.recordingId,
          taskId: asset.taskId,
          expiresAt: data.expiresAt,
          sha256: asset.sha256,
        },
        occurredAt: now,
      });
      await tx.insert(recordingUrlIssues).values({
        integrationClientId: input.principal.integrationClientId,
        sourceSystem: input.principal.sourceSystem,
        idempotencyKeyHash,
        requestFingerprint,
        recordingId: input.recordingId,
        requestId: input.requestId,
        responseStatus: 200,
        responseBody: body,
        createdAt: now,
        expiresAt: new Date(
          now.getTime() + this.idempotencyRetentionDays * 24 * 60 * 60 * 1000,
        ),
      });
      return { status: 200, body, replayed: false };
    });
  }

  private get idempotencyRetentionDays(): number {
    return this.options.idempotencyRetentionDays ?? 7;
  }

  private clock(): Date {
    return this.options.clock?.() ?? new Date();
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

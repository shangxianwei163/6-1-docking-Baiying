import type {
  RecordingAccessAsset,
  RecordingAccessRepository,
} from './access-repository.js';
import type {
  RecordingByteRange,
  RecordingObjectReader,
} from './object-store.js';
import { RecordingDownloadUrlIssuer } from './url-issuer.js';
import type { RecordingUrlSigner } from './url-signer.js';

export type IssuedRecordingDownload = {
  recordingId: string;
  downloadUrl: string;
  expiresAt: string;
  sha256: string;
};

export type OpenedAuthorizedRecording = {
  body: AsyncIterable<Uint8Array>;
  contentType: string;
  sizeBytes: bigint;
  totalSizeBytes: bigint;
  range?: RecordingByteRange;
  sha256: string;
};

export interface RecordingAccess {
  issueOperatorUrl(
    recordingId: string,
    actorId: string,
    requestId: string,
  ): Promise<IssuedRecordingDownload>;
  issueIntegrationUrl(
    recordingId: string,
    principal: {
      integrationClientId: string;
      sourceSystem: 'ERP' | 'CRM';
    },
    requestId: string,
  ): Promise<IssuedRecordingDownload>;
  openSignedUrl(
    recordingId: string,
    input: {
      audience: string;
      expiresAtEpochSeconds: number;
      signature: string;
      requestId: string;
      rangeHeader?: string;
    },
  ): Promise<OpenedAuthorizedRecording>;
}

export class RecordingAccessFailure extends Error {
  constructor(
    public readonly code:
      | 'RECORDING_NOT_FOUND'
      | 'RECORDING_NOT_ARCHIVED'
      | 'RECORDING_EXPIRED'
      | 'RECORDING_URL_INVALID'
      | 'RECORDING_RANGE_INVALID'
      | 'RECORDING_OBJECT_UNAVAILABLE',
    message: string,
    public readonly status: 400 | 404 | 409 | 410 | 416 | 503,
  ) {
    super(message);
    this.name = 'RecordingAccessFailure';
  }
}

export class RecordingAccessService implements RecordingAccess {
  private readonly urlIssuer: RecordingDownloadUrlIssuer;

  constructor(
    private readonly repository: RecordingAccessRepository,
    private readonly objectReader: RecordingObjectReader,
    private readonly signer: RecordingUrlSigner,
    private readonly options: {
      publicBaseUrl: string;
      ttlSeconds?: number;
      environment: 'development' | 'test' | 'production';
      clock?: () => Date;
    },
  ) {
    this.urlIssuer = new RecordingDownloadUrlIssuer(signer, options);
  }

  async issueOperatorUrl(
    recordingId: string,
    actorId: string,
    requestId: string,
  ): Promise<IssuedRecordingDownload> {
    const now = this.clock();
    const asset = await this.requireAvailableAsset(recordingId, now);
    const audience = this.signer.audienceToken('OPERATOR', actorId);
    return this.issueBoundUrl({
      recordingId,
      audience,
      actorId,
      requestId,
      asset,
      now,
    });
  }

  async issueIntegrationUrl(
    recordingId: string,
    principal: {
      integrationClientId: string;
      sourceSystem: 'ERP' | 'CRM';
    },
    requestId: string,
  ): Promise<IssuedRecordingDownload> {
    const now = this.clock();
    const asset = await this.requireAvailableAsset(recordingId, now);
    if (
      asset.integrationClientId !== principal.integrationClientId ||
      asset.sourceSystem !== principal.sourceSystem
    ) {
      throw new RecordingAccessFailure(
        'RECORDING_NOT_FOUND',
        '录音不存在',
        404,
      );
    }
    const audience = this.signer.audienceToken(
      'INTEGRATION_CLIENT',
      principal.integrationClientId,
    );
    return this.issueBoundUrl({
      recordingId,
      audience,
      actorId: `integration:${principal.sourceSystem}:${principal.integrationClientId}`,
      requestId,
      asset,
      now,
      expiresAt: asset.retentionUntil!,
    });
  }

  private async issueBoundUrl(input: {
    recordingId: string;
    audience: string;
    actorId: string;
    requestId: string;
    asset: RecordingAccessAsset;
    now: Date;
    expiresAt?: Date;
  }): Promise<IssuedRecordingDownload> {
    const issued = this.urlIssuer.issue({
      recordingId: input.recordingId,
      audience: input.audience,
      sha256: input.asset.sha256!,
      now: input.now,
      expiresAt: input.expiresAt,
    });
    await this.repository.recordAudit({
      requestId: input.requestId,
      actorId: input.actorId,
      action: 'RECORDING_DOWNLOAD_URL_ISSUED',
      recordingId: input.recordingId,
      detail: {
        recordingId: input.recordingId,
        taskId: input.asset.taskId,
        expiresAt: issued.expiresAt,
        sha256: input.asset.sha256,
      },
      occurredAt: input.now,
    });
    return issued;
  }

  async openSignedUrl(
    recordingId: string,
    input: {
      audience: string;
      expiresAtEpochSeconds: number;
      signature: string;
      requestId: string;
      rangeHeader?: string;
    },
  ): Promise<OpenedAuthorizedRecording> {
    const now = this.clock();
    const nowEpochSeconds = Math.floor(now.getTime() / 1_000);
    if (
      !/^[a-f0-9]{64}$/.test(input.audience) ||
      !Number.isSafeInteger(input.expiresAtEpochSeconds) ||
      input.expiresAtEpochSeconds <= nowEpochSeconds
    ) {
      throw invalidUrl();
    }
    if (
      !this.signer.verify(
        {
          recordingId,
          audience: input.audience,
          expiresAtEpochSeconds: input.expiresAtEpochSeconds,
        },
        input.signature,
      )
    ) {
      throw invalidUrl();
    }
    const asset = await this.requireAvailableAsset(recordingId, now);
    const retentionEpochSeconds = Math.floor(
      asset.retentionUntil!.getTime() / 1_000,
    );
    if (input.expiresAtEpochSeconds > retentionEpochSeconds) {
      throw invalidUrl();
    }
    const range = parseRange(input.rangeHeader, asset.sizeBytes!);
    let opened;
    try {
      opened = await this.objectReader.openObject({
        bucket: asset.bucket!,
        objectKey: asset.objectKey!,
        ...(range ? { range } : {}),
      });
    } catch {
      throw new RecordingAccessFailure(
        'RECORDING_OBJECT_UNAVAILABLE',
        '录音对象暂时不可读取，请稍后重试',
        503,
      );
    }
    const expectedSizeBytes = range
      ? range.endInclusive - range.start + 1n
      : asset.sizeBytes!;
    if (opened.sizeBytes !== expectedSizeBytes) {
      throw new RecordingAccessFailure(
        'RECORDING_OBJECT_UNAVAILABLE',
        '录音对象大小与归档元数据不一致，已拒绝下载',
        503,
      );
    }
    await this.repository.recordAudit({
      requestId: input.requestId,
      actorId: `signed-url:${input.audience.slice(0, 16)}`,
      action: 'RECORDING_DOWNLOAD_OPENED',
      recordingId,
      detail: {
        recordingId,
        taskId: asset.taskId,
        audienceTokenPrefix: input.audience.slice(0, 16),
        sizeBytes: opened.sizeBytes.toString(),
        totalSizeBytes: asset.sizeBytes!.toString(),
        ...(range
          ? {
              rangeStart: range.start.toString(),
              rangeEndInclusive: range.endInclusive.toString(),
            }
          : {}),
        sha256: asset.sha256,
      },
      occurredAt: now,
    });
    return {
      body: opened.body,
      contentType: asset.contentType!,
      sizeBytes: opened.sizeBytes,
      totalSizeBytes: asset.sizeBytes!,
      ...(range ? { range } : {}),
      sha256: asset.sha256!,
    };
  }

  private async requireAvailableAsset(
    recordingId: string,
    now: Date,
  ): Promise<RecordingAccessAsset> {
    return requireAvailableRecordingAsset(
      await this.repository.find(recordingId),
      now,
    );
  }

  private clock(): Date {
    return this.options.clock?.() ?? new Date();
  }
}

export function requireAvailableRecordingAsset(
  asset: RecordingAccessAsset | null,
  now: Date,
): RecordingAccessAsset {
  if (!asset) {
    throw new RecordingAccessFailure('RECORDING_NOT_FOUND', '录音不存在', 404);
  }
  if (asset.archiveStatus !== 'ARCHIVED') {
    throw new RecordingAccessFailure(
      'RECORDING_NOT_ARCHIVED',
      '录音尚未完成归档',
      409,
    );
  }
  if (
    asset.deletedAt ||
    (asset.retentionUntil && asset.retentionUntil.getTime() <= now.getTime())
  ) {
    throw new RecordingAccessFailure(
      'RECORDING_EXPIRED',
      '录音已超过保存期限或已删除',
      410,
    );
  }
  if (
    !asset.bucket ||
    !asset.objectKey ||
    !asset.contentType?.startsWith('audio/') ||
    asset.sizeBytes === null ||
    asset.sizeBytes < 0n ||
    !asset.sha256 ||
    !/^[a-f0-9]{64}$/.test(asset.sha256) ||
    !asset.retentionUntil
  ) {
    throw new RecordingAccessFailure(
      'RECORDING_OBJECT_UNAVAILABLE',
      '录音归档元数据不完整',
      503,
    );
  }
  return asset;
}

function invalidUrl(): RecordingAccessFailure {
  return new RecordingAccessFailure(
    'RECORDING_URL_INVALID',
    '录音下载地址无效或已过期，请重新获取',
    400,
  );
}

function parseRange(
  header: string | undefined,
  totalSizeBytes: bigint,
): RecordingByteRange | undefined {
  if (header === undefined) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match || (!match[1] && !match[2]) || totalSizeBytes <= 0n) {
    throw invalidRange();
  }

  if (!match[1]) {
    const suffixLength = BigInt(match[2]!);
    if (suffixLength <= 0n) throw invalidRange();
    return {
      start:
        suffixLength >= totalSizeBytes ? 0n : totalSizeBytes - suffixLength,
      endInclusive: totalSizeBytes - 1n,
    };
  }

  const start = BigInt(match[1]);
  if (start >= totalSizeBytes) throw invalidRange();
  const requestedEnd = match[2] ? BigInt(match[2]) : totalSizeBytes - 1n;
  if (requestedEnd < start) throw invalidRange();
  return {
    start,
    endInclusive:
      requestedEnd >= totalSizeBytes ? totalSizeBytes - 1n : requestedEnd,
  };
}

function invalidRange(): RecordingAccessFailure {
  return new RecordingAccessFailure(
    'RECORDING_RANGE_INVALID',
    '录音播放范围无效',
    416,
  );
}

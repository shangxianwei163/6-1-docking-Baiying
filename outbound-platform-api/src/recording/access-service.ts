import type {
  RecordingAccessAsset,
  RecordingAccessRepository,
} from './access-repository.js';
import type { RecordingObjectReader } from './object-store.js';
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
  sha256: string;
};

export interface RecordingAccess {
  issueOperatorUrl(
    recordingId: string,
    actorId: string,
    requestId: string,
  ): Promise<IssuedRecordingDownload>;
  openSignedUrl(
    recordingId: string,
    input: {
      audience: string;
      expiresAtEpochSeconds: number;
      signature: string;
      requestId: string;
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
      | 'RECORDING_OBJECT_UNAVAILABLE',
    message: string,
    public readonly status: 400 | 404 | 409 | 410 | 503,
  ) {
    super(message);
    this.name = 'RecordingAccessFailure';
  }
}

export class RecordingAccessService implements RecordingAccess {
  private readonly publicBaseUrl: URL;

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
    this.publicBaseUrl = validateBaseUrl(
      options.publicBaseUrl,
      options.environment,
    );
    const ttl = this.ttlSeconds;
    if (!Number.isInteger(ttl) || ttl < 60 || ttl > 3_600) {
      throw new TypeError('录音下载 URL 有效期必须为 60～3600 秒');
    }
  }

  async issueOperatorUrl(
    recordingId: string,
    actorId: string,
    requestId: string,
  ): Promise<IssuedRecordingDownload> {
    const now = this.clock();
    const asset = await this.requireAvailableAsset(recordingId, now);
    const audience = this.signer.audienceToken('OPERATOR', actorId);
    const expiresAtEpochSeconds =
      Math.floor(now.getTime() / 1_000) + this.ttlSeconds;
    const signature = this.signer.sign({
      recordingId,
      audience,
      expiresAtEpochSeconds,
    });
    const downloadUrl = new URL(
      `/api/v1/recordings/${encodeURIComponent(recordingId)}/content`,
      this.publicBaseUrl,
    );
    downloadUrl.searchParams.set('exp', expiresAtEpochSeconds.toString());
    downloadUrl.searchParams.set('aud', audience);
    downloadUrl.searchParams.set('sig', signature);
    const expiresAt = new Date(expiresAtEpochSeconds * 1_000).toISOString();
    await this.repository.recordAudit({
      requestId,
      actorId,
      action: 'RECORDING_DOWNLOAD_URL_ISSUED',
      recordingId,
      detail: {
        recordingId,
        taskId: asset.taskId,
        expiresAt,
        sha256: asset.sha256,
      },
      occurredAt: now,
    });
    return {
      recordingId,
      downloadUrl: downloadUrl.toString(),
      expiresAt,
      sha256: asset.sha256!,
    };
  }

  async openSignedUrl(
    recordingId: string,
    input: {
      audience: string;
      expiresAtEpochSeconds: number;
      signature: string;
      requestId: string;
    },
  ): Promise<OpenedAuthorizedRecording> {
    const now = this.clock();
    const nowEpochSeconds = Math.floor(now.getTime() / 1_000);
    if (
      !/^[a-f0-9]{64}$/.test(input.audience) ||
      !Number.isSafeInteger(input.expiresAtEpochSeconds) ||
      input.expiresAtEpochSeconds <= nowEpochSeconds ||
      input.expiresAtEpochSeconds > nowEpochSeconds + this.ttlSeconds
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
    let opened;
    try {
      opened = await this.objectReader.openObject({
        bucket: asset.bucket!,
        objectKey: asset.objectKey!,
      });
    } catch {
      throw new RecordingAccessFailure(
        'RECORDING_OBJECT_UNAVAILABLE',
        '录音对象暂时不可读取，请稍后重试',
        503,
      );
    }
    if (opened.sizeBytes !== asset.sizeBytes) {
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
        sizeBytes: asset.sizeBytes!.toString(),
        sha256: asset.sha256,
      },
      occurredAt: now,
    });
    return {
      body: opened.body,
      contentType: asset.contentType!,
      sizeBytes: asset.sizeBytes!,
      sha256: asset.sha256!,
    };
  }

  private async requireAvailableAsset(
    recordingId: string,
    now: Date,
  ): Promise<RecordingAccessAsset> {
    const asset = await this.repository.find(recordingId);
    if (!asset) {
      throw new RecordingAccessFailure(
        'RECORDING_NOT_FOUND',
        '录音不存在',
        404,
      );
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

  private get ttlSeconds(): number {
    return this.options.ttlSeconds ?? 900;
  }

  private clock(): Date {
    return this.options.clock?.() ?? new Date();
  }
}

function validateBaseUrl(
  value: string,
  environment: 'development' | 'test' | 'production',
): URL {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) {
    throw new TypeError('录音公开基础地址不能包含凭证、查询串或片段');
  }
  if (url.protocol === 'https:') return url;
  const loopback =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '[::1]';
  if (environment !== 'production' && url.protocol === 'http:' && loopback) {
    return url;
  }
  throw new TypeError(
    '录音公开基础地址必须使用 HTTPS；本地环境仅允许环回 HTTP',
  );
}

function invalidUrl(): RecordingAccessFailure {
  return new RecordingAccessFailure(
    'RECORDING_URL_INVALID',
    '录音下载地址无效或已过期，请重新获取',
    400,
  );
}

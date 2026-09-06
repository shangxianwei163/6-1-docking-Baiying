import type { IssuedRecordingDownload } from './access-service.js';
import type { RecordingUrlSigner } from './url-signer.js';

export class RecordingDownloadUrlIssuer {
  readonly ttlSeconds: number;
  private readonly publicBaseUrl: URL;

  constructor(
    private readonly signer: RecordingUrlSigner,
    options: {
      publicBaseUrl: string;
      ttlSeconds?: number;
      environment: 'development' | 'test' | 'production';
    },
  ) {
    this.publicBaseUrl = validateBaseUrl(
      options.publicBaseUrl,
      options.environment,
    );
    this.ttlSeconds = options.ttlSeconds ?? 900;
    if (
      !Number.isInteger(this.ttlSeconds) ||
      this.ttlSeconds < 60 ||
      this.ttlSeconds > 3_600
    ) {
      throw new TypeError('录音下载 URL 有效期必须为 60～3600 秒');
    }
  }

  issue(input: {
    recordingId: string;
    audience: string;
    sha256: string;
    now: Date;
  }): IssuedRecordingDownload {
    const expiresAtEpochSeconds =
      Math.floor(input.now.getTime() / 1_000) + this.ttlSeconds;
    const signature = this.signer.sign({
      recordingId: input.recordingId,
      audience: input.audience,
      expiresAtEpochSeconds,
    });
    const downloadUrl = new URL(
      `/api/v1/recordings/${encodeURIComponent(input.recordingId)}/content`,
      this.publicBaseUrl,
    );
    downloadUrl.searchParams.set('exp', expiresAtEpochSeconds.toString());
    downloadUrl.searchParams.set('aud', input.audience);
    downloadUrl.searchParams.set('sig', signature);
    return {
      recordingId: input.recordingId,
      downloadUrl: downloadUrl.toString(),
      expiresAt: new Date(expiresAtEpochSeconds * 1_000).toISOString(),
      sha256: input.sha256,
    };
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

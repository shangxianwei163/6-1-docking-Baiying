import { z } from 'zod';

const tokenResponseSchema = z.object({
  code: z.number(),
  success: z.boolean().optional(),
  message: z.string().optional(),
  requestId: z.string().optional(),
  data: z.object({
    access_token: z.string().min(1),
    refresh_token: z.string().optional(),
    expires_in: z.number().positive(),
    expires_at: z.number().positive(),
  }).nullable(),
});

export interface BaiyingTokenProvider {
  getAccessToken(): Promise<string>;
  invalidate(): void;
}

type OAuthTokenProviderOptions = {
  tokenUrl: string;
  appKey: string;
  appSecret: string;
  companyId: string;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
};

type CachedToken = { value: string; expiresAt: number };

export class OAuthBaiyingTokenProvider implements BaiyingTokenProvider {
  private readonly fetch: typeof globalThis.fetch;
  private readonly now: () => number;
  private cachedToken: CachedToken | null = null;
  private inFlight: Promise<string> | null = null;

  constructor(private readonly options: OAuthTokenProviderOptions) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
  }

  async getAccessToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt - this.now() > 5 * 60 * 1000) {
      return this.cachedToken.value;
    }
    if (!this.inFlight) {
      this.inFlight = this.requestToken().finally(() => { this.inFlight = null; });
    }
    return this.inFlight;
  }

  invalidate(): void {
    this.cachedToken = null;
  }

  private async requestToken(): Promise<string> {
    const form = new URLSearchParams({
      client_id: this.options.appKey,
      client_secret: this.options.appSecret,
      company_id: this.options.companyId,
    });
    const response = await this.fetch(this.options.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
    });
    if (!response.ok) throw new BaiyingTokenError(`百应 Token 请求失败（HTTP ${response.status}）`);

    const parsed = tokenResponseSchema.safeParse(await response.json());
    if (!parsed.success || parsed.data.code !== 200 || !parsed.data.data) {
      const message = parsed.success ? parsed.data.message : undefined;
      throw new BaiyingTokenError(message || '百应 Token 返回结构不符合约定');
    }
    this.cachedToken = {
      value: parsed.data.data.access_token,
      expiresAt: parsed.data.data.expires_at,
    };
    return this.cachedToken.value;
  }
}

export class BaiyingTokenError extends Error {}

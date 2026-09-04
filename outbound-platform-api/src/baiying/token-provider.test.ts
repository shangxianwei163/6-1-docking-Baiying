import { describe, expect, it, vi } from 'vitest';
import { OAuthBaiyingTokenProvider } from './token-provider.js';

describe('OAuthBaiyingTokenProvider', () => {
  it('deduplicates concurrent token requests and caches the token', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({
      success: true,
      code: 200,
      message: 'successful',
      data: {
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_in: 604800,
        expires_at: 1_800_000_000_000,
      },
    }), { status: 200 }));
    const provider = new OAuthBaiyingTokenProvider({
      tokenUrl: 'https://open-tcs.byai.com/oauth/token',
      appKey: 'app-key',
      appSecret: 'app-secret',
      companyId: '263120',
      fetch,
      now: () => 1_700_000_000_000,
    });

    await expect(Promise.all([provider.getAccessToken(), provider.getAccessToken()]))
      .resolves.toEqual(['access-token', 'access-token']);
    await expect(provider.getAccessToken()).resolves.toBe('access-token');
    expect(fetch).toHaveBeenCalledOnce();
    const request = fetch.mock.calls[0]![1];
    const requestBody = request?.body as URLSearchParams;
    expect(requestBody.toString()).toContain('client_id=app-key');
    expect(requestBody.toString()).toContain('company_id=263120');
  });
});

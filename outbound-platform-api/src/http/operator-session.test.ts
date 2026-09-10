import { describe, expect, it, vi } from 'vitest';
import type { MappingRepository } from '../mapping/repository.js';
import type { OperationsOverviewService } from '../operations/overview-service.js';
import { OperatorSessionService } from '../security/operator-session.js';
import { createApp } from './app.js';

function setup(
  secure = false,
  overrides: Partial<Parameters<typeof createApp>[0]> = {},
) {
  const getOverview = vi.fn(async () => ({ businessDate: '2026-09-08' }));
  const app = createApp({
    mappingRepository: {} as MappingRepository,
    operationsOverviewService: {
      getOverview,
    } as unknown as OperationsOverviewService,
    operatorSessionService: new OperatorSessionService({
      username: 'fc6j1',
      password: 'fc6j18888',
      displayName: '平台管理员',
      organization: '华东运营中心',
      secret: 'operator-session-http-test-secret-long-enough',
    }),
    operatorSessionCookieSecure: secure,
    consoleOrigin: 'http://localhost:4173',
    workerSharedSecret: 'test-worker-secret-at-least-24',
    createId: () => 'request-auth-001',
    ...overrides,
  });
  return { app, getOverview };
}

async function login(app: ReturnType<typeof createApp>) {
  return app.request('/api/v1/operator-session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'fc6j1', password: 'fc6j18888' }),
  });
}

describe('operator session HTTP API', () => {
  it('creates an HttpOnly session and uses it to protect operator APIs', async () => {
    const { app, getOverview } = setup();
    const unauthorized = await app.request('/api/v1/operations-overview', {
      headers: { 'x-actor-id': 'fc6j1' },
    });
    expect(unauthorized.status).toBe(401);
    await expect(unauthorized.json()).resolves.toEqual({
      error: {
        code: 'UNAUTHORIZED',
        message: '登录已失效，请重新登录',
        requestId: 'request-auth-001',
      },
    });

    const response = await login(app);
    expect(response.status).toBe(200);
    const setCookie = response.headers.get('set-cookie')!;
    expect(setCookie).toContain('outbound_operator_session=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Max-Age=43200');
    expect(setCookie).toContain('SameSite=Lax');
    const cookie = setCookie.split(';', 1)[0];

    const current = await app.request('/api/v1/operator-session', {
      headers: { cookie },
    });
    expect(current.status).toBe(200);
    await expect(current.json()).resolves.toMatchObject({
      data: { username: 'fc6j1', displayName: '平台管理员' },
    });

    const overview = await app.request('/api/v1/operations-overview', {
      headers: { cookie, 'x-actor-id': 'fc6j1' },
    });
    expect(overview.status).toBe(200);
    expect(getOverview).toHaveBeenCalledOnce();

    const mismatchedActor = await app.request('/api/v1/operations-overview', {
      headers: { cookie, 'x-actor-id': 'another-operator' },
    });
    expect(mismatchedActor.status).toBe(401);
  });

  it('rejects a wrong password and clears the cookie on logout', async () => {
    const { app } = setup();
    const invalid = await app.request('/api/v1/operator-session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'fc6j1', password: 'wrong-password' }),
    });
    expect(invalid.status).toBe(401);

    const response = await login(app);
    const cookie = response.headers.get('set-cookie')!.split(';', 1)[0];
    const logout = await app.request('/api/v1/operator-session', {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(logout.status).toBe(200);
    expect(logout.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('uses a Secure SameSite=None cookie in production mode', async () => {
    const { app } = setup(true);
    const response = await login(app);
    const setCookie = response.headers.get('set-cookie')!;
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=None');
  });

  it('keeps multiple logins for the same administrator independent', async () => {
    const { app, getOverview } = setup();
    const firstLogin = await login(app);
    const secondLogin = await login(app);
    const firstCookie = firstLogin.headers.get('set-cookie')!.split(';', 1)[0];
    const secondCookie = secondLogin.headers
      .get('set-cookie')!
      .split(';', 1)[0];

    expect(firstCookie).not.toBe(secondCookie);

    const firstOverview = await app.request('/api/v1/operations-overview', {
      headers: { cookie: firstCookie, 'x-actor-id': 'fc6j1' },
    });
    const secondOverview = await app.request('/api/v1/operations-overview', {
      headers: { cookie: secondCookie, 'x-actor-id': 'fc6j1' },
    });

    expect(firstOverview.status).toBe(200);
    expect(secondOverview.status).toBe(200);
    expect(getOverview).toHaveBeenCalledTimes(2);

    const firstLogout = await app.request('/api/v1/operator-session', {
      method: 'DELETE',
      headers: { cookie: firstCookie },
    });
    expect(firstLogout.status).toBe(200);

    const secondStillActive = await app.request('/api/v1/operations-overview', {
      headers: { cookie: secondCookie, 'x-actor-id': 'fc6j1' },
    });
    expect(secondStillActive.status).toBe(200);
  });

  it.each([
    '/api/v1/callbacks/baiying',
    '/api/v1/callbacks/baiying/call-instance',
  ])('keeps the Baiying ingress public at %s', async (path) => {
    const ingest = vi.fn(async () => ({
      id: 'callback-inbox-001',
      eventKey: 'BAIYING:CALL_INSTANCE_RESULT:test',
      replayed: false,
      callbackType: 'CALL_INSTANCE_RESULT',
    }));
    const { app } = setup(false, {
      baiyingCallbackIngress: { ingest },
    });

    const response = await app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data: { callbackType: 'CALL_INSTANCE_RESULT' } }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ code: 200 });
    expect(ingest).toHaveBeenCalledOnce();
  });
});

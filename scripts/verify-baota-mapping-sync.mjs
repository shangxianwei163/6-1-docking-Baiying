const baseUrl = process.env.BAOTA_VERIFY_BASE_URL;
const username = process.env.BAOTA_VERIFY_USERNAME;
const password = process.env.BAOTA_VERIFY_PASSWORD;
const timeoutMs = Number(process.env.BAOTA_VERIFY_TIMEOUT_MS ?? 120_000);

if (!baseUrl || !username || !password) {
  throw new Error(
    'BAOTA_VERIFY_BASE_URL, BAOTA_VERIFY_USERNAME and BAOTA_VERIFY_PASSWORD are required',
  );
}

const loginResponse = await fetch(new URL('/api/v1/operator-session', baseUrl), {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username, password }),
});
if (!loginResponse.ok) {
  throw new Error(`operator login failed with HTTP ${loginResponse.status}`);
}

const cookie = loginResponse.headers.get('set-cookie')?.split(';', 1)[0];
if (!cookie) throw new Error('operator login did not issue a session cookie');

const syncResponse = await fetch(
  new URL('/api/v1/variable-sync-jobs', baseUrl),
  {
    method: 'POST',
    headers: {
      cookie,
      'x-actor-id': username,
    },
  },
);
if (syncResponse.status !== 202) {
  throw new Error(`variable sync request failed with HTTP ${syncResponse.status}`);
}
const syncRequest = await syncResponse.json();
const requestedAt = syncRequest?.data?.requestedAt;
if (typeof requestedAt !== 'string') {
  throw new Error('variable sync response did not include requestedAt');
}

const deadline = Date.now() + timeoutMs;
while (Date.now() < deadline) {
  const readinessResponse = await fetch(
    new URL('/api/v1/scenes/readiness', baseUrl),
    { headers: { cookie } },
  );
  if (!readinessResponse.ok) {
    throw new Error(
      `scene readiness request failed with HTTP ${readinessResponse.status}`,
    );
  }
  const body = await readinessResponse.json();
  const scenes = body?.data?.scenes;
  const refreshedScenes = Array.isArray(scenes)
    ? scenes.filter(
        (scene) =>
          typeof scene.lastSuccessfulSyncAt === 'string' &&
          scene.lastSuccessfulSyncAt >= requestedAt,
      )
    : [];
  if (refreshedScenes.length > 0) {
    console.info(
      `mapping sync verified with ${scenes.length} scene(s); ${refreshedScenes.length} refreshed after request`,
    );
    process.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}

throw new Error(`no scene readiness appeared within ${timeoutMs}ms`);

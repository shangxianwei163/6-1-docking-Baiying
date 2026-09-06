import { readFile } from 'node:fs/promises';

const views = await readFile(
  new URL('../components/platform/views.tsx', import.meta.url),
  'utf8',
);
const callbackService = await readFile(
  new URL(
    '../outbound-platform-api/src/operations/callback-preview-service.ts',
    import.meta.url,
  ),
  'utf8',
);

for (const forbidden of [
  'taskRows',
  'initialStudios',
  'RC-20260902-0008',
  'studio-rate-settings',
  'initialHainanRateTiers',
]) {
  if (views.includes(forbidden)) {
    throw new Error(`Obsolete demo source remains in views.tsx: ${forbidden}`);
  }
}

for (const required of [
  'loadOperatorStudios',
  'useActiveOperatorStudios',
  "studioStatus: 'ACTIVE'",
  'selectedStudio.businessCode',
]) {
  if (!views.includes(required)) {
    throw new Error(`Real studio binding dependency is missing: ${required}`);
  }
}

for (const forbidden of [
  'fetch(',
  'http.request',
  'https.request',
  'deliveryEvent',
  'queueOutbox',
  'callbackEndpoint',
  'SecretProvider',
]) {
  if (callbackService.includes(forbidden)) {
    throw new Error(`Preview service gained a forbidden capability: ${forbidden}`);
  }
}

console.log(
  'Stage 6B-3C source verification passed (legacy demos removed + real studio API + preview service has no delivery capability)',
);

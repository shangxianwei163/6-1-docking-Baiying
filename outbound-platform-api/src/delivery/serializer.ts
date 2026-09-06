export function serializeStableJson(value: unknown): Uint8Array {
  return Buffer.from(JSON.stringify(sortJson(value)), 'utf8');
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, 'en'))
      .map(([key, item]) => [key, sortJson(item)]),
  );
}

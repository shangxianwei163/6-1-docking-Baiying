import { describe, expect, it } from 'vitest';
import { stableJsonSha256 } from './request-hash.js';

describe('stable request hash', () => {
  it('ignores object key order but preserves array order and values', () => {
    expect(stableJsonSha256({ b: 2, a: { y: true, x: 'v' } })).toBe(
      stableJsonSha256({ a: { x: 'v', y: true }, b: 2 }),
    );
    expect(stableJsonSha256({ values: [1, 2] })).not.toBe(
      stableJsonSha256({ values: [2, 1] }),
    );
  });
});

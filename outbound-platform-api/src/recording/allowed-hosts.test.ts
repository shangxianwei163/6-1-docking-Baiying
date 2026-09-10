import { describe, expect, it } from 'vitest';
import { parseRecordingSourceAllowedHosts } from './allowed-hosts.js';

describe('parseRecordingSourceAllowedHosts', () => {
  it('normalizes, removes blanks, and de-duplicates hosts', () => {
    expect(
      parseRecordingSourceAllowedHosts(
        ' Audio.Example.com,cdn.example.com., audio.example.com, ',
      ),
    ).toEqual(['audio.example.com', 'cdn.example.com']);
  });

  it('returns an empty list when no allowlist is configured', () => {
    expect(parseRecordingSourceAllowedHosts('')).toEqual([]);
  });
});

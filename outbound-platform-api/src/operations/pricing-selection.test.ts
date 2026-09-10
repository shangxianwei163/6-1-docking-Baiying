import type { OperatorPricingVersion } from '@outbound/contracts';
import { describe, expect, it } from 'vitest';
import { currentPricing, scheduledPricing } from './service.js';

const now = new Date('2026-09-08T03:00:00.000Z');

function version(
  idSuffix: string,
  input: Partial<OperatorPricingVersion> = {},
): OperatorPricingVersion {
  return {
    id: `00000000-0000-4000-8000-${idSuffix.padStart(12, '0')}`,
    studioId: '00000000-0000-4000-8000-000000000100',
    version: Number(idSuffix),
    voiceRate: '0.480000',
    smsRate: '0.080000',
    frozenMinutes: 3,
    sourceMode: 'UNIFORM',
    status: 'ACTIVE',
    effectiveFrom: '2026-09-01T00:00:00.000Z',
    effectiveTo: null,
    publishedBy: 'pricing-test',
    publishedAt: '2026-09-01T00:00:00.000Z',
    ...input,
  };
}

describe('operator pricing version selection', () => {
  it('selects the newest active uniform or per-studio version at the given time', () => {
    const olderUniform = version('1');
    const newerPerStudio = version('2', {
      sourceMode: 'PER_STUDIO',
      effectiveFrom: '2026-09-07T00:00:00.000Z',
      voiceRate: '0.520000',
    });

    expect(currentPricing([olderUniform, newerPerStudio], now)).toEqual(
      newerPerStudio,
    );
  });

  it('excludes retired, expired, and future versions from current pricing', () => {
    expect(
      currentPricing(
        [
          version('1', { status: 'RETIRED' }),
          version('2', { effectiveTo: '2026-09-08T03:00:00.000Z' }),
          version('3', {
            status: 'SCHEDULED',
            effectiveFrom: '2026-09-09T00:00:00.000Z',
          }),
        ],
        now,
      ),
    ).toBeNull();
  });

  it('selects the nearest future scheduled price and ignores active versions', () => {
    const nearest = version('2', {
      status: 'SCHEDULED',
      effectiveFrom: '2026-10-01T00:00:00.000Z',
    });
    const later = version('3', {
      status: 'SCHEDULED',
      effectiveFrom: '2026-11-01T00:00:00.000Z',
    });

    expect(scheduledPricing([version('1'), later, nearest], now)).toEqual(
      nearest,
    );
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { CallbackInboxRepository } from './repository.js';
import {
  BaiyingCallbackIngressService,
  CallbackBodyTooLargeError,
} from './ingress-service.js';

describe('BaiyingCallbackIngressService', () => {
  it('encrypts and persists the exact raw body with only safe headers', async () => {
    const save = vi.fn<CallbackInboxRepository['save']>(async (input) => ({
      id: '53f6ddac-3103-4209-ae0d-bdd83162a3a9',
      eventKey: input.eventKey,
      replayed: false,
    }));
    const rawBody =
      '{ "data": {"callbackType":"JOB_INFO_RESULT","data":{"companyId":1,"callJobId":2,"callJobStatus":2}} }';
    const service = new BaiyingCallbackIngressService(
      {
        save,
        claimNext: vi.fn(),
        complete: vi.fn(),
        reject: vi.fn(),
        fail: vi.fn(),
      },
      {
        encryptUtf8: (value) => `encrypted:${value}`,
        decryptUtf8: vi.fn(),
        phoneHmac: vi.fn(),
        correlationHmac: vi.fn(),
      },
    );

    const result = await service.ingest({
      rawBody,
      headers: new Headers({
        'content-type': 'application/json',
        authorization: 'must-not-be-saved',
        'x-real-ip': '120.55.46.3',
      }),
    });

    expect(result.callbackType).toBe('JOB_INFO_RESULT');
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        callbackType: 'JOB_INFO_RESULT',
        companyId: '1',
        callJobId: '2',
        callInstanceId: null,
        rawBodyCiphertext: `encrypted:${rawBody}`,
        rawBodySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        headers: {
          'content-type': 'application/json',
          'x-real-ip': '120.55.46.3',
        },
      }),
    );
  });

  it('refuses a body over the configured limit before writing', async () => {
    const save = vi.fn<CallbackInboxRepository['save']>();
    const service = new BaiyingCallbackIngressService(
      {
        save,
        claimNext: vi.fn(),
        complete: vi.fn(),
        reject: vi.fn(),
        fail: vi.fn(),
      },
      {
        encryptUtf8: vi.fn(),
        decryptUtf8: vi.fn(),
        phoneHmac: vi.fn(),
        correlationHmac: vi.fn(),
      },
      4,
    );
    await expect(
      service.ingest({ rawBody: '12345', headers: new Headers() }),
    ).rejects.toBeInstanceOf(CallbackBodyTooLargeError);
    expect(save).not.toHaveBeenCalled();
  });
});

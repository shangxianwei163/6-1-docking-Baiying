import { describe, expect, it, vi } from 'vitest';
import { BaiyingProviderError } from './call-job-client.js';
import { HttpBaiyingCallJobClient } from './http-call-job-client.js';

function tokenProvider() {
  return {
    getAccessToken: vi.fn(async () => 'test-token'),
    invalidate: vi.fn(),
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('HttpBaiyingCallJobClient', () => {
  it('reads one completed-call page with the documented 500 row limit and redacted metadata', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      json({
        code: 200,
        requestId: 'completed-request',
        resultMsg: 'successful',
        data: {
          total: 501,
          pages: 2,
          pageNum: 1,
          list: [
            {
              callInstanceId: 3887178818710,
              callJobId: 241491320,
              customerTelephone: '13800000011',
              customerName: '客户2',
              callInstanceStatus: 2,
              finishStatus: 2,
              duration: 0,
              startTime: 1784885758000,
              endTime: 1784885768000,
              luyinOssUrl: 'https://recording.example/call.mp3',
              resultList: [{ name: '客户意向等级', value: 'E级' }],
              properties: {
                sx_platform_item_id: '11111111-1111-4111-8111-111111111111',
              },
              userProperties: { 姓名: '3000583249' },
            },
          ],
        },
      }),
    );
    const client = new HttpBaiyingCallJobClient({
      baseUrl: 'https://open.byai.com',
      tokenProvider: tokenProvider(),
      fetch,
    });

    const result = await client.listCompletedCalls({
      companyId: '263120',
      callJobId: '241491320',
      pageNum: 1,
      pageSize: 500,
    });

    expect(result).toMatchObject({
      total: 501,
      pages: 2,
      pageNum: 1,
      requestId: 'completed-request',
      calls: [
        {
          callInstanceId: '3887178818710',
          callJobId: '241491320',
          customerTelephone: '13800000011',
          durationSeconds: 0,
          fullRecordingUrl: 'https://recording.example/call.mp3',
          properties: {
            sx_platform_item_id: '11111111-1111-4111-8111-111111111111',
          },
          resultList: [{ name: '客户意向等级', value: 'E级' }],
        },
      ],
    });
    expect(result.response).toEqual({
      code: 200,
      resultMsg: 'successful',
      data: { total: 501, pages: 2, pageNum: 1, returnedCount: 1 },
    });
    const [url, init] = fetch.mock.calls[0]!;
    expect((url as URL).pathname).toBe(
      '/api/oauth/byai.openapi.calljob.calldone/1.0.0/list',
    );
    const form = init!.body as URLSearchParams;
    expect(Object.fromEntries(form)).toMatchObject({
      accessToken: 'test-token',
      companyId: '263120',
      callJobId: '241491320',
      pageNum: '1',
      pageSize: '500',
    });
  });

  it('rejects invalid completed-call pagination before issuing a request', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = new HttpBaiyingCallJobClient({
      baseUrl: 'https://open.byai.com',
      tokenProvider: tokenProvider(),
      fetch,
    });

    await expect(
      client.listCompletedCalls({
        companyId: '263120',
        callJobId: '241491320',
        pageNum: 0,
        pageSize: 501,
      }),
    ).rejects.toThrow('页码');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('normalizes the provider empty-page sentinel without weakening non-empty pagination', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      json({
        code: 200,
        requestId: 'empty-completed-request',
        resultMsg: 'successful',
        data: { total: 0, pages: 0, pageNum: 0, list: [] },
      }),
    );
    const client = new HttpBaiyingCallJobClient({
      baseUrl: 'https://open.byai.com',
      tokenProvider: tokenProvider(),
      fetch,
    });

    await expect(
      client.listCompletedCalls({
        companyId: '263120',
        callJobId: '277868620',
        pageNum: 1,
        pageSize: 500,
      }),
    ).resolves.toMatchObject({ total: 0, pages: 0, pageNum: 1, calls: [] });
  });

  it('uses the documented form endpoints for the complete task lifecycle', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        json({
          code: 200,
          requestId: 'create-request',
          resultMsg: 'successful',
          data: { callJobId: 241491320 },
        }),
      )
      .mockResolvedValueOnce(
        json({
          code: 200,
          requestId: 'import-request',
          resultMsg: 'successful',
          data: { total: 1, successNum: 1, placeFailNum: 0, repeatNum: 0 },
        }),
      )
      .mockResolvedValueOnce(
        json({
          code: 200,
          requestId: 'start-request',
          resultMsg: 'successful',
        }),
      )
      .mockResolvedValueOnce(
        json({
          code: 200,
          requestId: 'detail-request',
          resultMsg: 'successful',
          data: {
            callJobId: 241491320,
            jobName: 'LIVE-TEST',
            callJobStatus: 1,
            totalCount: 1,
          },
        }),
      )
      .mockResolvedValueOnce(
        json({
          code: 200,
          requestId: 'list-request',
          resultMsg: 'successful',
          data: {
            total: 1,
            pages: 1,
            pageNum: 1,
            list: [
              {
                callJobId: 241491320,
                jobName: 'LIVE-TEST',
                callJobStatus: 4,
                totalCount: 1,
              },
            ],
          },
        }),
      );
    const client = new HttpBaiyingCallJobClient({
      baseUrl: 'https://open.byai.com',
      tokenProvider: tokenProvider(),
      fetch,
    });

    const created = await client.createCallJob({
      callJobName: 'LIVE-TEST',
      callJobType: 2,
      companyId: '263120',
      robotDefId: '4845020',
      userPhoneIds: ['1788320'],
    });
    expect(created.callJobId).toBe('241491320');

    await expect(
      client.importCustomers({
        callJobId: created.callJobId,
        companyId: '263120',
        customers: [
          {
            platformItemId: '11111111-1111-4111-8111-111111111111',
            name: '测试客户',
            phone: '13800138000',
            properties: { 宝宝姓名: '测试宝宝' },
          },
        ],
        permitRepeatNumber: false,
      }),
    ).resolves.toMatchObject({ total: 1, successNum: 1 });
    await client.executeCallJob({
      callJobId: created.callJobId,
      companyId: '263120',
      command: 1,
    });
    await expect(
      client.getCallJob({ companyId: '263120', callJobId: created.callJobId }),
    ).resolves.toMatchObject({
      job: { state: 'CALLING', importedCustomerCount: 1 },
    });
    await expect(
      client.findCallJobsByName({
        companyId: '263120',
        callJobName: 'LIVE-TEST',
      }),
    ).resolves.toMatchObject({ jobs: [{ state: 'PAUSED' }] });

    expect(fetch.mock.calls.map(([url]) => (url as URL).pathname)).toEqual([
      '/api/oauth/byai.openapi.calljob/1.0.0/create',
      '/api/oauth/byai.openapi.calljob.customer/1.0.0/import',
      '/api/oauth/byai.openapi.calljob/1.0.0/execute',
      '/api/oauth/byai.openapi.calljob.detail/1.0.0/get',
      '/api/oauth/byai.openapi.calljob/1.0.0/list',
    ]);
    const createForm = fetch.mock.calls[0]![1]!.body as URLSearchParams;
    expect(createForm.get('callJobType')).toBe('2');
    expect(createForm.get('userPhoneIds')).toBe('[1788320]');
    const importForm = fetch.mock.calls[1]![1]!.body as URLSearchParams;
    expect(JSON.parse(importForm.get('customerInfoVOList')!)).toEqual([
      expect.objectContaining({
        phone: '13800138000',
        properties: expect.objectContaining({
          sx_platform_item_id: '11111111-1111-4111-8111-111111111111',
        }),
      }),
    ]);
  });

  it('invalidates and refreshes the token exactly once', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        json({ code: 40000010, resultMsg: 'token无效', data: null }),
      )
      .mockResolvedValueOnce(
        json({
          code: 200,
          resultMsg: 'successful',
          data: { total: 0, pages: 0, pageNum: 1, list: [] },
        }),
      );
    const provider = tokenProvider();
    const client = new HttpBaiyingCallJobClient({
      baseUrl: 'https://open.byai.com',
      tokenProvider: provider,
      fetch,
    });

    await expect(
      client.findCallJobsByName({
        companyId: '263120',
        callJobName: 'missing',
      }),
    ).resolves.toMatchObject({ jobs: [] });
    expect(provider.invalidate).toHaveBeenCalledOnce();
    expect(provider.getAccessToken).toHaveBeenCalledTimes(2);
  });

  it('classifies HTTP 429 as retryable without replaying a write', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json({}, 429));
    const client = new HttpBaiyingCallJobClient({
      baseUrl: 'https://open.byai.com',
      tokenProvider: tokenProvider(),
      fetch,
    });

    await expect(
      client.executeCallJob({
        companyId: '263120',
        callJobId: '1',
        command: 2,
      }),
    ).rejects.toMatchObject({
      kind: 'RETRYABLE',
      code: 'BAIYING_RATE_LIMITED',
    } satisfies Partial<BaiyingProviderError>);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('classifies query timeout as retryable and write timeout as unknown outcome', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>((_url, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    });
    const client = new HttpBaiyingCallJobClient({
      baseUrl: 'https://open.byai.com',
      tokenProvider: tokenProvider(),
      fetch,
      timeoutMs: 5,
    });

    await expect(
      client.getCallJob({ companyId: '263120', callJobId: '1' }),
    ).rejects.toMatchObject({ kind: 'RETRYABLE', code: 'BAIYING_TIMEOUT' });
    await expect(
      client.executeCallJob({
        companyId: '263120',
        callJobId: '1',
        command: 1,
      }),
    ).rejects.toMatchObject({
      kind: 'UNKNOWN_OUTCOME',
      code: 'BAIYING_TIMEOUT',
    });
  });
});

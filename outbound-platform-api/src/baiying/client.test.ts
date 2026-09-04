import { describe, expect, it, vi } from 'vitest';
import { BaiyingRequestError, HttpBaiyingVariableClient } from './client.js';

function createTokenProvider() {
  return { getAccessToken: vi.fn(async () => 'test-token'), invalidate: vi.fn() };
}

describe('HttpBaiyingVariableClient', () => {
  it('queries the documented robot list and keeps every card field returned by Baiying', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({
      code: 200,
      resultMsg: 'successful',
      data: [{
        robotDefId: 4845020,
        robotName: '开放平台演示话术',
        robotStatus: 5,
        industryOneName: '大金融',
        industryTwoName: '银行',
        deployTime: '2026-07-24 15:04:38',
      }],
    }), { status: 200 }));
    const client = new HttpBaiyingVariableClient({ baseUrl: 'https://open.byai.com', tokenProvider: createTokenProvider(), fetch });

    await expect(client.listRobots('263120', 2)).resolves.toEqual([{
      robotDefId: '4845020',
      robotName: '开放平台演示话术',
      robotStatus: 5,
      industryOneName: '大金融',
      industryTwoName: '银行',
      deployTime: '2026-07-24 15:04:38',
    }]);
    const [url, request] = fetch.mock.calls[0]!;
    expect((url as URL).href).toBe('https://open.byai.com/api/oauth/byai.openapi.robot/1.0.0/list');
    expect((request!.body as URLSearchParams).get('companyId')).toBe('263120');
    expect((request!.body as URLSearchParams).get('robotStatus')).toBe('2');
  });

  it('posts accessToken in the documented company list request body', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({
      code: 200,
      resultMsg: 'successful',
      data: [{ companyId: 263120, companyName: '测试公司', mobile: 'masked' }],
    }), { status: 200 }));
    const client = new HttpBaiyingVariableClient({ baseUrl: 'https://open.byai.com', tokenProvider: createTokenProvider(), fetch });

    await expect(client.listCompanies()).resolves.toEqual([{ companyId: '263120', companyName: '测试公司' }]);
    const [url, request] = fetch.mock.calls[0]!;
    expect((url as URL).href).toBe('https://open.byai.com/api/oauth/byai.openapi.company/1.0.0/list');
    expect(request).toMatchObject({ method: 'POST' });
    expect((request!.body as URLSearchParams).get('accessToken')).toBe('test-token');
  });

  it('queries the documented company phone line endpoint and keeps every returned field', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({
      code: 200,
      resultMsg: 'successful',
      data: [{
        userPhoneId: 1788320,
        phone: '大屏演示专用线路-仅测试不生产',
        phoneName: '演示线路',
        phoneType: 9,
        sceneType: 1,
        rateType: 0,
        localSellingRate: 0,
        nonlocalSellingRate: 0,
        lineAmount: 0,
        billPeriod: 60,
      }],
    }), { status: 200 }));
    const client = new HttpBaiyingVariableClient({ baseUrl: 'https://open.byai.com', tokenProvider: createTokenProvider(), fetch });

    await expect(client.listPhones('263120')).resolves.toEqual([expect.objectContaining({
      userPhoneId: '1788320', phoneName: '演示线路', phoneType: 9, billPeriod: 60,
    })]);
    const [url, request] = fetch.mock.calls[0]!;
    expect((url as URL).href).toBe('https://open.byai.com/api/oauth/byai.openapi.phone/1.0.0/list');
    expect((request!.body as URLSearchParams).get('companyId')).toBe('263120');
  });

  it('posts the documented 4.10 form and normalizes returned variables', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({
      code: 200,
      resultMsg: 'successful',
      data: { variables: [['婚期'], ['套餐意向']] },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const tokenProvider = createTokenProvider();
    const client = new HttpBaiyingVariableClient({ baseUrl: 'https://open.byai.com', tokenProvider, fetch });

    await expect(client.querySceneVariables({ companyId: '263120', robotDefId: '4845020' }))
      .resolves.toEqual(['婚期', '套餐意向']);
    const [url, request] = fetch.mock.calls[0]!;
    expect(url).toBeInstanceOf(URL);
    expect((url as URL).href).toBe('https://open.byai.com/api/oauth/byai.openapi.company.scenevariables/1.0.0/get');
    expect(request).toMatchObject({ method: 'POST' });
    expect(request?.body).toBeInstanceOf(URLSearchParams);
    const requestBody = request?.body as URLSearchParams;
    expect(requestBody.toString()).toContain('accessToken=test-token');
    expect(requestBody.toString()).toContain('hideDefaultVar=true');
  });

  it('re-acquires a token once when Baiying returns token invalid', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 40000010, resultMsg: 'token无效', data: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 200, resultMsg: 'successful', data: { variables: [] } }), { status: 200 }));
    const tokenProvider = createTokenProvider();
    const client = new HttpBaiyingVariableClient({ baseUrl: 'https://open.byai.com', tokenProvider, fetch });

    await expect(client.querySceneVariables({ companyId: '263120', robotDefId: '4845020' })).resolves.toEqual([]);
    expect(tokenProvider.invalidate).toHaveBeenCalledOnce();
    expect(tokenProvider.getAccessToken).toHaveBeenCalledTimes(2);
  });

  it('queries the documented complex workflow list 2.0 endpoint', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({
      code: 200,
      resultMsg: 'successful',
      data: {
        total: 1,
        pages: 1,
        pageNum: 0,
        pageSize: 20,
        list: [{
          id: 115315720,
          name: '非常六加一-百天-0528-测试',
          workflowExecuteStatus: 'FINISH',
          workflowType: 'OUT_TRIGGER',
          startTime: '2026-05-28 09:57:32',
          endTime: '2099-01-01 00:00:01',
        }],
      },
    }), { status: 200 }));
    const client = new HttpBaiyingVariableClient({ baseUrl: 'https://open.byai.com', tokenProvider: createTokenProvider(), fetch });

    await expect(client.listWorkflows({ pageNum: 0, pageSize: 20, workflowExecuteStatus: 'ALL' })).resolves.toMatchObject({
      total: 1,
      workflows: [{ id: '115315720', workflowExecuteStatus: 'FINISH' }],
    });
    const [url, request] = fetch.mock.calls[0]!;
    expect((url as URL).href).toBe('https://open.byai.com/api/oauth/byai.sop.workflow.list.page/1.0.0/search');
    expect((request!.body as URLSearchParams).get('pageNum')).toBe('0');
    expect((request!.body as URLSearchParams).get('workflowExecuteStatus')).toBe('ALL');
  });

  it('rejects business errors instead of silently accepting them', async () => {
    const client = new HttpBaiyingVariableClient({
      baseUrl: 'https://open.byai.com',
      tokenProvider: createTokenProvider(),
      fetch: vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({ code: 41000000, resultMsg: '参数非法', data: null }), { status: 200 })),
    });

    await expect(client.querySceneVariables({ companyId: '263120', robotDefId: '4845020' }))
      .rejects.toBeInstanceOf(BaiyingRequestError);
  });
});

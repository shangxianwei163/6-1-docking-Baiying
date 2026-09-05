import { describe, expect, it, vi } from 'vitest';
import { HttpSxErpCategoryClient, normalizeCategories } from './client.js';

describe('Sx ERP category client', () => {
  it('posts the documented Token request and keeps returned fields', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_input, _init) => new Response(JSON.stringify({
      Code: 200,
      Msg: '成功',
      Data: [{ CategoryID: 'SS1', CategoryName: '邀约', Level: 1, Children: [{ CategoryID: 'BT', CategoryName: '百天', Level: 2 }] }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const client = new HttpSxErpCategoryClient('http://erp.example/SAi/Sx_AllCategoryLevel', fetchImpl);

    const categories = await client.listCategories('erp-token');

    expect(fetchImpl).toHaveBeenCalledWith('http://erp.example/SAi/Sx_AllCategoryLevel', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ Token: 'erp-token' }),
    }));
    expect(categories).toEqual([
      expect.objectContaining({ externalId: 'SS1', name: '邀约', categoryPath: '邀约', level: 1 }),
      expect.objectContaining({ externalId: 'BT', name: '百天', categoryPath: '邀约-百天', parentId: 'SS1', level: 2 }),
    ]);
  });

  it('normalizes a JSON-string Data payload', () => {
    expect(normalizeCategories('[{"Code":"A1","Name":"客户激活","Enabled":true}]')[0]).toMatchObject({
      externalId: 'A1', name: '客户激活', active: true,
    });
  });

  it('normalizes the real Suxuan three-part category response', () => {
    expect(normalizeCategories([
      { id: 46, main_category: '邀约', sub_category: '百天', c_level: 'SS1' },
      { id: 45, main_category: '邀约', sub_category: '百天', c_level: '' },
    ])).toEqual([
      expect.objectContaining({ externalId: '46', name: '邀约-百天-SS1', categoryPath: '邀约-百天-SS1', level: 3 }),
      expect.objectContaining({ externalId: '45', name: '邀约-百天', categoryPath: '邀约-百天', level: 2 }),
    ]);
  });

  it('surfaces an ERP error response', async () => {
    const client = new HttpSxErpCategoryClient('http://erp.example/categories', async () => new Response(JSON.stringify({ Code: 600, Msg: 'Token 无效', Data: [] })));
    await expect(client.listCategories('bad-token')).rejects.toThrow('Token 无效');
  });
});

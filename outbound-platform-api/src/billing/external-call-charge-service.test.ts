import { describe, expect, it, vi } from 'vitest';
import { ExternalApiFailure } from '../openapi/errors.js';
import {
  decodeChargeCursor,
  encodeChargeCursor,
  PostgresExternalCallChargeService,
} from './external-call-charge-service.js';

describe('external call-charge cursor', () => {
  it('round-trips the stable ledger ordering keys', () => {
    const occurredAt = new Date('2026-09-14T02:32:18.000Z');
    const id = '22222222-2222-4222-8222-222222222221';

    expect(decodeChargeCursor(encodeChargeCursor(occurredAt, id))).toEqual({
      occurredAt,
      id,
    });
  });

  it('rejects malformed or forged cursor values', () => {
    expect(() => decodeChargeCursor('not-a-valid-cursor')).toThrow(
      new ExternalApiFailure(
        'INVALID_REQUEST',
        '扣费明细分页 cursor 无效',
        400,
      ),
    );
  });
});

describe('external call-charge access scope', () => {
  it('stops before reading the account when the token is not authorized', async () => {
    const db = fakeDatabase([
      [{ id: '11111111-1111-4111-8111-111111111111', mcCode: '5903679116' }],
      [],
    ]);
    const service = new PostgresExternalCallChargeService(db as never);

    await expect(
      service.listCallCharges(
        {
          integrationClientId: '22222222-2222-4222-8222-222222222222',
          clientId: 'erp-unauthorized',
          sourceSystem: 'ERP',
        },
        { companyCode: '5903679116', limit: 100 },
      ),
    ).rejects.toMatchObject({
      code: 'AUTHENTICATION_FAILED',
      status: 403,
      message: '请求 Token 无权访问该影楼',
    });
    expect(db.select).toHaveBeenCalledTimes(2);
  });

  it('returns the authorized studio account and a cursor-paginated charge page', async () => {
    const first = {
      id: '22222222-2222-4222-8222-222222222221',
      occurredAt: new Date('2026-09-14T02:32:18.000Z'),
      amount: '-0.960000',
      balanceAfter: '18152.650000',
      availableBalanceAfter: '18152.650000',
      callInstanceId: '33333333-3333-4333-8333-333333333331',
      reason: '通话结算',
      taskNo: 'PT-20260914-00001',
    };
    const second = {
      ...first,
      id: '22222222-2222-4222-8222-222222222220',
      occurredAt: new Date('2026-09-14T02:31:18.000Z'),
    };
    const db = fakeDatabase([
      [{ id: '11111111-1111-4111-8111-111111111111', mcCode: '5903679116' }],
      [{ studioId: '11111111-1111-4111-8111-111111111111' }],
      [{ currency: 'CNY', balance: '18152.650000', activeHoldAmount: '0' }],
      [{ totalCount: 2, totalCharge: '1.920000' }],
      [first, second],
    ]);
    const service = new PostgresExternalCallChargeService(db as never);

    const result = await service.listCallCharges(
      {
        integrationClientId: '22222222-2222-4222-8222-222222222222',
        clientId: 'erp-authorized',
        sourceSystem: 'ERP',
      },
      { companyCode: '5903679116', limit: 1 },
    );

    expect(result).toMatchObject({
      company_code: '5903679116',
      currency: 'CNY',
      balance: '18152.650000',
      available_balance: '18152.650000',
      total_count: 2,
      total_charge: '1.920000',
      items: [
        {
          ledger_id: first.id,
          type: 'CALL_CHARGE',
          amount: '-0.960000',
          task_no: 'PT-20260914-00001',
          platform_call_id: first.callInstanceId,
        },
      ],
    });
    expect(result.next_cursor).toBe(
      encodeChargeCursor(first.occurredAt, first.id),
    );
  });
});

function fakeDatabase(results: unknown[][]) {
  const pending = [...results];
  return {
    select: vi.fn(() => {
      const result = pending.shift() ?? [];
      const query = {
        from: () => query,
        leftJoin: () => query,
        where: () => query,
        orderBy: () => query,
        limit: () => Promise.resolve(result),
      };
      return query;
    }),
  };
}

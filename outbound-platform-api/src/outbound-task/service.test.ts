import { describe, expect, it, vi } from 'vitest';
import { ExternalApiFailure } from '../openapi/errors.js';
import { transformMappedValue } from '../mapping/transform.js';
import {
  aggregateBatchStatus,
  buildFilteredCustomerResultEvent,
  buildV2MappingSourceRecord,
  buildPlatformTaskName,
  describeBaiyingJobStatus,
  displayStatusFor,
  PostgresOutboundTaskService,
  selectConsistentCategoryBinding,
  shanghaiDate,
} from './service.js';

describe('outbound task helpers', () => {
  it('keeps the reserved v2 customer_name field available to mapping rules', () => {
    const sourceRecord = buildV2MappingSourceRecord(
      { bbage: '260天' },
      '詹绍梅',
    );

    expect(sourceRecord).toEqual({ bbage: '260天', customer_name: '詹绍梅' });
    expect(
      transformMappedValue({
        rule: {
          id: 'customer-name-rule',
          baiyingVariableName: '客户称呼',
          erpField: 'customer_name',
          crmField: 'customer_salutation',
          transformConfig: { type: 'TEXT', mode: 'TRIM' },
          emptyPolicy: 'BLOCK',
          defaultValue: null,
          status: 'PUBLISHED',
          version: 4,
        },
        sourceSystem: 'ERP',
        sourceRecord,
      }),
    ).toBe('詹绍梅');
  });

  it('keeps the existing empty-value policy for a missing customer_name', () => {
    expect(() =>
      transformMappedValue({
        rule: {
          id: 'customer-name-rule',
          baiyingVariableName: '客户称呼',
          erpField: 'customer_name',
          crmField: 'customer_salutation',
          transformConfig: { type: 'TEXT', mode: 'TRIM' },
          emptyPolicy: 'BLOCK',
          defaultValue: null,
          status: 'PUBLISHED',
          version: 4,
        },
        sourceSystem: 'ERP',
        sourceRecord: buildV2MappingSourceRecord({}, null),
      }),
    ).toThrow('客户称呼: 来源字段 customer_name 为空');
  });

  it('builds an immediate non-billable callback for a filtered customer', () => {
    const event = buildFilteredCustomerResultEvent({
      eventId: '22222222-2222-4222-8222-222222222222',
      occurredAt: new Date('2026-09-17T04:00:00.000Z'),
      sourceSystem: 'ERP',
      companyCode: '5903679116',
      batchId: '33333333-3333-4333-8333-333333333333',
      taskNo: 'PT-20260917-00001',
      guid: 'customer-missing-name',
      customerName: null,
      phone: '13500000001',
      errorReason: '客户称呼: 来源字段 customer_name 为空',
    });
    expect(event.schemaVersion).toBe('2.1');
    if (event.schemaVersion !== '2.1') {
      throw new Error('参数错误回调必须使用 2.1 合约');
    }

    expect(event.result.customer_result).toMatchObject({
      result_code: 'CALL_FAILED',
      contacted: false,
      summary: '客户称呼: 来源字段 customer_name 为空',
    });
    expect(event.result.customer_result).not.toHaveProperty('error_reason');
    expect(event.result.customer.guid).toBe('customer-missing-name');
    expect(event.result.call).toEqual({
      status: 'FAILED',
      status_text: '参数错误',
      called_at: null,
      duration_seconds: 0,
    });
    expect(event.result.billing).toEqual({
      billing_minutes: 0,
      customer_charge: '0.000000',
      currency: 'CNY',
    });
  });

  it('persists a non-sensitive operations metric when v2 category matching is ambiguous', async () => {
    const failure = new ExternalApiFailure(
      'DATA_CATEGORY_AMBIGUOUS',
      '三级分类匹配到多条启用的数据分类',
      422,
      {
        mainCategory: '排档',
        subCategory: '孕妈',
        cLevel: 'SR3',
        categoryIds: ['A', 'B'],
      },
    );
    const values = vi.fn(async () => undefined);
    const db = {
      transaction: vi.fn(async () => {
        throw failure;
      }),
      insert: vi.fn(() => ({ values })),
    };
    const service = new PostgresOutboundTaskService(db as never, {} as never, {
      baiyingCompanyId: '263120',
      clock: () => new Date('2026-09-10T03:00:00.000Z'),
    });

    await expect(
      service.acceptV2({
        principal: {
          integrationClientId: '11111111-1111-4111-8111-111111111111',
          clientId: 'erp-quality-test',
          sourceSystem: 'ERP',
        },
        idempotencyKey: 'phase10-idempotency',
        requestId: 'phase10-category-request',
        requestHash: 'a'.repeat(64),
        request: {
          main_category: '排档',
          sub_category: '孕妈',
          source: 0,
          company_code: '5903679116',
          customer_list: [
            {
              c_level: 'SR3',
              c_info_list: [
                {
                  phone: '15224992744',
                  guid: 'phase10-guid',
                  customer_name: '测试客户',
                },
              ],
            },
          ],
        },
      }),
    ).rejects.toBe(failure);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        metricCode: 'DATA_CATEGORY_AMBIGUOUS',
        sourceSystem: 'ERP',
        requestId: 'phase10-category-request',
        objectRef: '5903679116',
        detail: expect.objectContaining({ cLevel: 'SR3' }),
      }),
    );
    expect(JSON.stringify(values.mock.calls)).not.toContain('15224992744');
    expect(JSON.stringify(values.mock.calls)).not.toContain('测试客户');
  });

  it('preserves the persisted batch failure classification during compensation', () => {
    expect(aggregateBatchStatus(['IMPORT_FAILED', 'IMPORTED'], 'FAILED')).toBe(
      'FAILED',
    );
    expect(
      aggregateBatchStatus(['START_FAILED', 'START_FAILED'], 'PARTIAL_FAILED'),
    ).toBe('PARTIAL_FAILED');
  });

  it('maps execution states to the stable external display states', () => {
    expect(displayStatusFor('ACCEPTED')).toBe('执行中');
    expect(displayStatusFor('CALLING')).toBe('呼叫中');
    expect(displayStatusFor('PAUSED')).toBe('呼叫中');
    expect(displayStatusFor('TERMINATED')).toBe('呼叫中');
    expect(displayStatusFor('CALL_COMPLETED')).toBe('执行中');
    expect(displayStatusFor('RECONCILING')).toBe('执行中');
    expect(displayStatusFor('COMPLETED')).toBe('执行中');
    expect(displayStatusFor('COMPLETED', 'SUCCEEDED', 'SUCCEEDED')).toBe(
      '执行完成',
    );
    expect(displayStatusFor('COMPLETED', 'SUCCEEDED', 'NOT_APPLICABLE')).toBe(
      '执行完成',
    );
    expect(displayStatusFor('IMPORT_FAILED')).toBe('执行失败');
  });

  it('describes the original Baiying job status without hiding new values', () => {
    expect(describeBaiyingJobStatus(null)).toBeNull();
    expect(describeBaiyingJobStatus(2)).toBe('已完成');
    expect(describeBaiyingJobStatus(9)).toBe('线路欠费');
    expect(describeBaiyingJobStatus(99)).toBe('未知状态（99）');
  });

  it('generates task dates in Asia/Shanghai', () => {
    expect(shanghaiDate(new Date('2026-09-05T16:30:00.000Z'))).toBe('20260906');
  });

  it('builds the task name from the first real data category path', () => {
    expect(buildPlatformTaskName('PT-20260907-00023', ['排挡-百天-SS1'])).toBe(
      '20260907排挡百天SS100023',
    );
    expect(
      buildPlatformTaskName('PT-20260918-00021', [
        '排挡/3周/SS1',
        '排挡-3周-SR1',
      ]),
    ).toBe('20260918排挡3周SS100021');
  });

  it('accepts multiple categories bound to the same script and line', () => {
    expect(
      selectConsistentCategoryBinding(
        ['category-a', 'category-b'],
        [
          {
            categoryId: 'category-a',
            userPhoneId: 'line-1',
            robotDefId: 'robot-1',
          },
          {
            categoryId: 'category-b',
            userPhoneId: 'line-1',
            robotDefId: 'robot-1',
          },
        ],
      ),
    ).toMatchObject({ userPhoneId: 'line-1', robotDefId: 'robot-1' });
  });

  it.each([
    {
      changed: { userPhoneId: 'line-2', robotDefId: 'robot-1' },
      code: 'DATA_CATEGORY_LINE_CONFLICT',
    },
    {
      changed: { userPhoneId: 'line-1', robotDefId: 'robot-2' },
      code: 'DATA_CATEGORY_SCRIPT_CONFLICT',
    },
  ] as const)(
    'rejects multi-category binding conflict $code',
    ({ changed, code }) => {
      expect(() =>
        selectConsistentCategoryBinding(
          ['category-a', 'category-b'],
          [
            {
              categoryId: 'category-a',
              userPhoneId: 'line-1',
              robotDefId: 'robot-1',
            },
            { categoryId: 'category-b', ...changed },
          ],
        ),
      ).toThrow(expect.objectContaining<Partial<ExternalApiFailure>>({ code }));
    },
  );

  it('reports every category without an active script binding', () => {
    expect(() =>
      selectConsistentCategoryBinding(
        ['category-a', 'category-b'],
        [
          {
            categoryId: 'category-a',
            userPhoneId: 'line-1',
            robotDefId: 'robot-1',
          },
        ],
      ),
    ).toThrow(
      expect.objectContaining<Partial<ExternalApiFailure>>({
        code: 'DATA_CATEGORY_SCRIPT_UNBOUND',
        details: { categoryIds: ['category-b'] },
      }),
    );
  });
});

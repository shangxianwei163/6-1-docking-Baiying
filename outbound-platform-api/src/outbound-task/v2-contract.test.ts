import { describe, expect, it } from 'vitest';
import {
  createOutboundBatchRequestV2Schema,
  extractOutboundVariablesV2,
  flattenOutboundCustomersV2,
  outboundCallResultV2Schema,
  sourceSystemFromCodeV2,
} from '@outbound/contracts';

const request = {
  main_category: '排档',
  sub_category: '孕妈',
  source: 0 as const,
  company_code: '5903679116',
  customer_list: [
    {
      c_level: '',
      c_info_list: [
        {
          phone: '13500000001',
          guid: '11111111-1111-4111-8111-111111111101',
          customer_name: '测试客户A',
          photoshop: null,
          photodate: '2026-09-20',
        },
      ],
    },
    {
      c_level: 'SR3',
      c_info_list: [
        {
          phone: '18300000003',
          guid: '11111111-1111-4111-8111-111111111103',
          customer_name: '测试客户C',
          selectshop: '厦门店',
        },
      ],
    },
  ],
};

describe('ERP/CRM v2 outbound contract', () => {
  it('maps the numeric source and flattens c_level without losing dynamic variables', () => {
    const parsed = createOutboundBatchRequestV2Schema.parse(request);
    const customers = flattenOutboundCustomersV2(parsed);

    expect(sourceSystemFromCodeV2(parsed.source)).toBe('ERP');
    expect(customers).toHaveLength(2);
    expect(customers[1]).toMatchObject({
      guid: '11111111-1111-4111-8111-111111111103',
      cLevel: 'SR3',
      variables: { selectshop: '厦门店' },
    });
    expect(
      extractOutboundVariablesV2(parsed.customer_list[0]!.c_info_list[0]!),
    ).toEqual({ photoshop: null, photodate: '2026-09-20' });
  });

  it('does not impose the v1 100-field business limit', () => {
    const manyVariables = Object.fromEntries(
      Array.from({ length: 250 }, (_, index) => [`field_${index}`, `${index}`]),
    );
    expect(
      createOutboundBatchRequestV2Schema.safeParse({
        ...request,
        customer_list: [
          {
            c_level: '',
            c_info_list: [
              {
                phone: '13500000001',
                guid: '11111111-1111-4111-8111-111111111101',
                ...manyVariables,
              },
            ],
          },
        ],
      }).success,
    ).toBe(true);
  });

  it.each([
    ['guid', '11111111-1111-4111-8111-111111111101'],
    ['phone', '13500000001'],
  ] as const)(
    'rejects duplicate %s values across c_level groups',
    (field, value) => {
      const duplicated = structuredClone(request);
      Object.assign(duplicated.customer_list[1]!.c_info_list[0]!, {
        [field]: value,
      });
      const parsed = createOutboundBatchRequestV2Schema.safeParse(duplicated);
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(
          parsed.error.issues.some((issue) =>
            issue.message.includes('不可重复'),
          ),
        ).toBe(true);
      }
    },
  );

  it('rejects platform-reserved dynamic variable names', () => {
    const parsed = createOutboundBatchRequestV2Schema.safeParse({
      ...request,
      customer_list: [
        {
          c_level: '',
          c_info_list: [
            {
              phone: '13500000001',
              guid: '11111111-1111-4111-8111-111111111101',
              sx_platform_item_id: 'spoofed',
            },
          ],
        },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it('keeps the compatibility id equal to guid in the minimal result', () => {
    const result = {
      guid: '11111111-1111-4111-8111-111111111101',
      externalCustomerId: '11111111-1111-4111-8111-111111111101',
      phone_masked: '135****0001',
      call_status: 'ANSWERED' as const,
      finish_status: 0,
      result_complete: true,
      collected_variables: { appointment: '2026-09-20' },
      task_results: [{ key: '意向等级', value: 'A' }],
    };
    expect(outboundCallResultV2Schema.parse(result)).toEqual(result);
    expect(
      outboundCallResultV2Schema.safeParse({
        ...result,
        externalCustomerId: 'another-guid',
      }).success,
    ).toBe(false);
  });
});

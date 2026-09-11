import { describe, expect, it } from 'vitest';
import {
  createOutboundBatchRequestV2Schema,
  extractOutboundVariablesV2,
  flattenOutboundCustomersV2,
  outboundCallResultCallbackEnvelopeV2Schema,
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

  it('accepts the business-first customer result callback', () => {
    const result = {
      event_id: '22222222-2222-4222-8222-222222222222',
      event_type: 'OUTBOUND_CALL_RESULT' as const,
      occurred_at: '2026-09-10T15:30:25+08:00',
      company_code: '5903679116',
      batch_id: '59fd515e-00f2-4d62-93ec-8883fb3aa090',
      task_no: 'PT-20260910-00001',
      customer: {
        guid: '11111111-1111-4111-8111-111111111101',
        customer_name: '张女士',
        phone_masked: '135****0001',
      },
      customer_result: {
        result_code: 'HIGH_INTENT' as const,
        result_text: '客户有明确意向，建议尽快跟进',
        contacted: true,
        intention_level: 'A',
        intention_text: '高意向',
        summary: '客户近期有拍摄计划。',
        follow_up_required: true,
        recommended_action: '建议尽快联系客户',
        customer_concerns: ['套餐价格'],
        customer_tags: ['高意向'],
        collected_data: { appointment: '2026-09-20' },
      },
      call: {
        status: 'ANSWERED' as const,
        status_text: '已接通',
        called_at: '2026-09-10T15:28:30+08:00',
        duration_seconds: 115,
      },
      conversation_logs: [
        { sequence: 1, speaker: 'AI' as const, content: '您好。' },
        { sequence: 2, speaker: 'CUSTOMER' as const, content: '你好。' },
      ],
      billing: {
        billing_minutes: 2,
        customer_charge: '0.960000',
        currency: 'CNY' as const,
      },
    };
    expect(outboundCallResultV2Schema.parse(result)).toEqual(result);
    expect(
      outboundCallResultCallbackEnvelopeV2Schema.parse({
        Token: '^******^',
        Data: result,
      }),
    ).toEqual({ Token: '^******^', Data: result });
    expect(
      outboundCallResultCallbackEnvelopeV2Schema.safeParse({ Data: result })
        .success,
    ).toBe(false);
    expect(
      outboundCallResultCallbackEnvelopeV2Schema.safeParse({
        Token: 'erp-local-access-token',
        Data: result,
      }).success,
    ).toBe(false);
    expect(
      outboundCallResultV2Schema.safeParse({
        ...result,
        customer_result: {
          ...result.customer_result,
          result_code: 'NOT_A_REAL_RESULT',
        },
      }).success,
    ).toBe(false);
  });
});

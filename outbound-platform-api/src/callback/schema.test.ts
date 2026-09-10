import { describe, expect, it } from 'vitest';
import {
  BaiyingCallbackParseError,
  calculateBillingMinutes,
  inspectBaiyingCallback,
  normalizeCallStatus,
  parseBaiyingCallback,
  UnsupportedBaiyingCallbackTypeError,
} from './schema.js';

describe('Baiying callback schema', () => {
  it.each([
    [0, 'ANSWERED'],
    [1, 'REJECTED'],
    [2, 'NO_ANSWER'],
    [6, 'BUSY'],
    [8, 'NO_ANSWER'],
    [9, 'FAILED'],
    [999, 'UNKNOWN'],
  ] as const)('maps finishStatus %i to %s', (status, expected) => {
    expect(normalizeCallStatus(status)).toBe(expected);
  });

  it.each([
    [0, 0],
    [1, 1],
    [59, 1],
    [60, 1],
    [61, 2],
  ])(
    'rounds %i seconds per call to %i billing minute(s)',
    (seconds, minutes) => {
      expect(calculateBillingMinutes(seconds)).toBe(minutes);
    },
  );

  it('normalizes a completed call and reads the platform item id from JSON-string properties', () => {
    const parsed = parseBaiyingCallback(
      JSON.stringify({
        code: 200,
        data: {
          callbackType: 'CALL_INSTANCE_RESULT',
          data: {
            callInstance: {
              companyId: 1001,
              callJobId: 2002,
              callInstanceId: 3003,
              callInstanceStatus: 2,
              finishStatus: 0,
              calledTimes: 1,
              duration: 61,
              customerName: '张女士',
              customerTelephone: '+86 138-0000-0000',
              properties:
                '{"sx_platform_item_id":"de7119d0-582c-44dd-94d6-bc420d254513","sx_correlation_token":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","callStartTime":"2026-09-06 18:28:59","导入变量":"不能作为采集结果返回"}',
              collectProperties: {
                预约门店: '湖滨店',
                客户关注点: '套餐价格、外景拍摄',
                客户情况摘要: '客户近期有婚纱照拍摄计划。',
                sx_platform_debug: '不能外泄',
              },
              startTime: '2026-09-06 18:29:01',
              endTime: '2026-09-06 18:30:00',
              luyinOssUrl: 'https://recording.example.test/full.mp3',
            },
            taskResult: [
              {
                resultName: '客户意向等级',
                resultValue: 'A',
                resultLabels: [{ labelName: '近期需求' }],
              },
            ],
            phoneLogs: [
              { speaker: 'AI', content: '您好，请问近期有拍摄计划吗？' },
              { speaker: 'ME', content: '有的，我想了解价格。' },
            ],
          },
        },
        resultMsg: '成功',
      }),
    );
    if (parsed.callbackType !== 'CALL_INSTANCE_RESULT') {
      throw new Error('预期得到单次通话结果');
    }

    expect(parsed).toMatchObject({
      callbackType: 'CALL_INSTANCE_RESULT',
      companyId: '1001',
      callJobId: '2002',
      callInstanceId: '3003',
      customerName: '张女士',
      durationSeconds: 61,
      callStatus: 'ANSWERED',
      callStatusText: '已接通',
      platformItemId: 'de7119d0-582c-44dd-94d6-bc420d254513',
      correlationToken:
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      importedProperties: {
        导入变量: '不能作为采集结果返回',
      },
      collectProperties: {
        预约门店: '湖滨店',
        客户关注点: '套餐价格、外景拍摄',
        客户情况摘要: '客户近期有婚纱照拍摄计划。',
      },
      taskResults: [
        {
          resultName: '客户意向等级',
          resultValue: 'A',
          resultLabels: [{ labelName: '近期需求' }],
        },
      ],
      customerResult: {
        resultCode: 'HIGH_INTENT',
        resultText: '客户有明确意向，建议尽快跟进',
        contacted: true,
        intentionLevel: 'A',
        intentionText: '高意向',
        summary: '客户近期有婚纱照拍摄计划。',
        followUpRequired: true,
        recommendedAction: '建议销售人员尽快联系客户，优先安排后续沟通',
        customerConcerns: ['套餐价格', '外景拍摄'],
        customerTags: ['近期需求'],
        collectedData: { 预约门店: '湖滨店' },
      },
      conversationLogs: [
        {
          sequence: 1,
          speaker: 'AI',
          content: '您好，请问近期有拍摄计划吗？',
        },
        {
          sequence: 2,
          speaker: 'CUSTOMER',
          content: '有的，我想了解价格。',
        },
      ],
      resultComplete: true,
    });
    expect(parsed.calledAt?.toISOString()).toBe('2026-09-06T10:28:59.000Z');
    expect(parsed.providerOccurredAt?.toISOString()).toBe(
      '2026-09-06T10:30:00.000Z',
    );
  });

  it('returns a readable business conclusion when the customer is not reached', () => {
    const parsed = parseBaiyingCallback(
      JSON.stringify({
        data: {
          callbackType: 'CALL_INSTANCE_RESULT',
          data: {
            callInstance: {
              companyId: 1001,
              callJobId: 2002,
              callInstanceId: 3004,
              finishStatus: 8,
              duration: 0,
              startTime: '2026-09-06 19:00:00',
            },
          },
        },
      }),
    );
    if (parsed.callbackType !== 'CALL_INSTANCE_RESULT') {
      throw new Error('预期得到单次通话结果');
    }

    expect(parsed.callStatusText).toBe('无人接听');
    expect(parsed.customerResult).toEqual({
      resultCode: 'UNREACHED',
      resultText: '本次未接通客户',
      contacted: false,
      intentionLevel: null,
      intentionText: '未接通，无法判断',
      summary: '本次外呼无人接听。',
      followUpRequired: true,
      recommendedAction: '建议稍后再次外呼客户',
      customerConcerns: [],
      customerTags: [],
      collectedData: {},
    });
  });

  it('normalizes a job completion callback and accepts the legacy dataType alias', () => {
    expect(
      parseBaiyingCallback(
        JSON.stringify({
          data: {
            dataType: 'JOB_INFO_RESULT',
            data: {
              companyId: '1001',
              callJobId: '2002',
              callJobStatus: 2,
            },
          },
        }),
      ),
    ).toEqual({
      callbackType: 'JOB_INFO_RESULT',
      companyId: '1001',
      callJobId: '2002',
      callJobStatus: 2,
      providerOccurredAt: null,
    });
  });

  it('builds stable duplicate keys but distinguishes different raw payloads', () => {
    const first = JSON.stringify({
      data: {
        callbackType: 'JOB_INFO_RESULT',
        data: { companyId: 1, callJobId: 2, callJobStatus: 2 },
      },
    });
    const formatted = JSON.stringify(JSON.parse(first), null, 2);
    expect(inspectBaiyingCallback(first).eventKey).toBe(
      inspectBaiyingCallback(first).eventKey,
    );
    expect(inspectBaiyingCallback(first).eventKey).not.toBe(
      inspectBaiyingCallback(formatted).eventKey,
    );
    expect(inspectBaiyingCallback(first)).toMatchObject({
      companyId: '1',
      callJobId: '2',
      callInstanceId: null,
    });
    expect(inspectBaiyingCallback('{').callbackType).toBe('INVALID_JSON');
  });

  it('extracts non-sensitive provider identities for task-scoped Inbox reconciliation', () => {
    const inspected = inspectBaiyingCallback(
      JSON.stringify({
        data: {
          callbackType: 'CALL_INSTANCE_RESULT',
          data: {
            callInstance: {
              companyId: 1001,
              callJobId: 2002,
              callInstanceId: 3003,
              finishStatus: 0,
            },
          },
        },
      }),
    );

    expect(inspected).toMatchObject({
      companyId: '1001',
      callJobId: '2002',
      callInstanceId: '3003',
    });
  });

  it('classifies malformed and unsupported payloads separately', () => {
    expect(() => parseBaiyingCallback('{')).toThrow(BaiyingCallbackParseError);
    expect(() =>
      parseBaiyingCallback(
        JSON.stringify({
          data: { callbackType: 'NEW_EVENT', data: {} },
        }),
      ),
    ).toThrow(UnsupportedBaiyingCallbackTypeError);
  });
});

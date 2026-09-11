'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, ExternalLink, Share2 } from 'lucide-react';

type Row = [name: string, type: string, required: string, description: string];
type Rule = [title: string, description: string];
type ApiDoc = {
  id: string;
  group: string;
  direction: string;
  method: 'GET' | 'POST';
  title: string;
  path: string;
  summary: string;
  status: string;
  caller: string;
  receiver: string;
  contentType: string;
  auth: string;
  params: Row[];
  request?: string;
  response: string;
  responseLead?: string;
  errorResponse?: string;
  rules: Rule[];
  errors?: Row[];
  sourceUrl?: string;
  sourceLabel?: string;
  contractVersion?: string;
  host?: 'platform' | 'baiying' | 'configured';
};

const platformBaseUrl = (
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.DEV
    ? 'http://127.0.0.1:8788'
    : 'https://scheduling.paiyide.cc')
).replace(/\/$/, '');
const baiyingBaseUrl = 'https://open.byai.com';

const requestHeaders: Row[] = [
  [
    'X-Access-Token',
    'Header · string',
    '是',
    '从影楼管理详情复制对应的 ERP 或 CRM 固定 Token',
  ],
  ['X-Request-Id', 'Header · string', '否', '调用方追踪 ID；缺省时由平台生成'],
];
const idempotency: Row = [
  'Idempotency-Key',
  'Header · string',
  '是',
  '8～128 字符；网络超时重试必须沿用原值',
];
const commonErrors: Row[] = [
  ['400', 'HTTP', '否', '请求格式或参数不合法，修正后重新提交'],
  ['401', 'HTTP', '否', 'X-Access-Token 缺失或无效'],
  ['403', 'HTTP', '否', 'Token 来源与请求 source 不一致，或无权访问当前影楼'],
  ['404', 'HTTP', '否', '资源不存在，或当前客户端无权访问'],
  ['409', 'HTTP', '否', '幂等冲突、余额不足、状态冲突或重放请求'],
  ['413', 'HTTP', '否', '请求体超过 25 MiB 上限'],
  ['422', 'HTTP', '否', '分类、话术、线路、映射或业务规则未通过'],
  ['503', 'HTTP', '否', '依赖暂时不可用，原幂等键退避重试'],
];
const requestRules: Rule[] = [
  [
    '认证方式',
    '请求头直接发送 X-Access-Token，不需要计算签名、时间戳或 Nonce。',
  ],
  [
    '权限边界',
    'ERP Token 只能提交 ERP 来源，CRM Token 只能提交 CRM 来源，并且只能访问授权 MC code。',
  ],
];
const baiyingOk = `{
  "code": 200,
  "data": {},
  "resultMsg": "successful",
  "requestId": "baiying-request-id"
}`;
const callbackAck = `{
  "code": 200,
  "message": "success"
}`;

function platformDoc(
  doc: Omit<
    ApiDoc,
    | 'group'
    | 'direction'
    | 'status'
    | 'caller'
    | 'receiver'
    | 'contentType'
    | 'auth'
    | 'host'
  >,
): ApiDoc {
  return {
    ...doc,
    group: 'ERP / CRM 调用平台',
    direction: 'ERP / CRM → 平台',
    status: '已实现',
    caller: 'ERP 或 CRM',
    receiver: '百应外呼调度台',
    contentType: 'application/json;charset=utf-8',
    auth: 'X-Access-Token 固定 Token',
    contractVersion: doc.contractVersion ?? '2.0',
    host: 'platform',
  };
}

function baiyingDoc(
  doc: Omit<
    ApiDoc,
    | 'group'
    | 'direction'
    | 'caller'
    | 'receiver'
    | 'contentType'
    | 'auth'
    | 'host'
  >,
): ApiDoc {
  return {
    ...doc,
    group: '平台调用百应',
    direction: '平台 → 百应',
    caller: '百应外呼调度台',
    receiver: '百应开放平台',
    contentType: 'application/x-www-form-urlencoded',
    auth: 'OAuth accessToken 放入表单 Body',
    host: 'baiying',
  };
}

const createBatchRequest = `{
  "main_category": "排档",
  "sub_category": "孕妈",
  "source": 0,
  "company_code": "5903679116",
  "customer_list": [
    {
      "c_level": "",
      "c_info_list": [
        {
          "phone": "13500000001",
          "guid": "11111111-1111-4111-8111-111111111101",
          "customer_name": "测试客户A",
          "photoshop": "湖滨店",
          "photodate": "2026-09-20"
        }
      ]
    },
    {
      "c_level": "SR3",
      "c_info_list": [
        {
          "phone": "18300000003",
          "guid": "11111111-1111-4111-8111-111111111103",
          "customer_name": "测试客户B",
          "selectshop": null,
          "自定义扩展变量": "可继续增加"
        }
      ]
    }
  ]
}`;
const createBatchResponse = `{
  "code": "BATCH_ACCEPTED",
  "message": "外呼批次已受理",
  "request_id": "9bba018d-36b2-478d-af0a-af3f7d573937",
  "data": {
    "batch_id": "4f4f0d65-8d01-48c9-b87f-71569344cb63",
    "execution_status": "ACCEPTED",
    "phone_count": 2,
    "task_count": 2,
    "tasks": [
      {
        "task_id": "c5f1d5e0-1c67-4d02-a7a3-58666ea55792",
        "task_no": "PT-20260909-00025",
        "phone_count": 1,
        "status_url": "/openapi/v1/outbound/tasks/PT-20260909-00025"
      },
      {
        "task_id": "0871e61e-7749-4684-9cb6-aad28c220a5a",
        "task_no": "PT-20260909-00026",
        "phone_count": 1,
        "status_url": "/openapi/v1/outbound/tasks/PT-20260909-00026"
      }
    ],
    "status_url": "/openapi/v2/outbound/batches/4f4f0d65-8d01-48c9-b87f-71569344cb63"
  }
}`;
const insufficientBalanceResponse = `{
  "code": "INSUFFICIENT_BALANCE",
  "message": "影楼可用余额不足",
  "requestId": "9bba018d-36b2-478d-af0a-af3f7d573937",
  "recharge_qr_code_url": "https://scheduling.paiyide.cc/recharge/ums-recharge-qr-code.png",
  "details": {
    "availableBalance": "1.000000",
    "reservedAmount": "9.600000"
  }
}`;
const batchDetailResponse = `{
  "code": "OK",
  "message": "success",
  "request_id": "9bba018d-36b2-478d-af0a-af3f7d573937",
  "data": {
    "batch_id": "4f4f0d65-8d01-48c9-b87f-71569344cb63",
    "source": 0,
    "company_code": "5903679116",
    "main_category": "排档",
    "sub_category": "孕妈",
    "execution_status": "RUNNING",
    "phone_count": 2,
    "task_count": 2,
    "tasks": [
      {
        "task_id": "c5f1d5e0-1c67-4d02-a7a3-58666ea55792",
        "task_no": "PT-20260909-00025",
        "phone_count": 1,
        "execution_status": "CALLING",
        "status_url": "/openapi/v1/outbound/tasks/PT-20260909-00025"
      }
    ],
    "created_at": "2026-09-09T10:00:00+08:00",
    "completed_at": null
  }
}`;
const callbackHeaders: Row[] = [
  [
    'X-Platform-Event-Id',
    'Header · uuid',
    '是',
    '回调事件唯一标识，也是接收方幂等键',
  ],
  ['X-Timestamp', 'Header · string', '是', '平台生成事件时的 Unix 毫秒时间戳'],
  [
    'X-Signature',
    'Header · string',
    '是',
    '使用影楼来源端点 callbackSecret 计算的 HMAC 签名',
  ],
  [
    'X-Contract-Version',
    'Header · string',
    '是',
    '业务结果与录音回调均固定为 2.1',
  ],
];
const resultEvent = `{
  "Token": "^******^",
  "Data": {
    "event_id": "8d87e451-8aad-4a48-90a1-b6e38429a964",
    "event_type": "OUTBOUND_CALL_RESULT",
    "occurred_at": "2026-09-10T15:30:25+08:00",
    "company_code": "5903679116",
    "batch_id": "59fd515e-00f2-4d62-93ec-8883fb3aa090",
    "task_no": "PT-20260910-00001",
    "customer": {
      "guid": "CRM-CUSTOMER-10001",
      "customer_name": "张女士",
      "phone_masked": "138****8888"
    },
    "customer_result": {
      "result_code": "HIGH_INTENT",
      "result_text": "客户有明确意向，建议尽快跟进",
      "contacted": true,
      "intention_level": "A",
      "intention_text": "高意向",
      "summary": "客户计划近期拍摄婚纱照，关注套餐价格和外景拍摄。",
      "follow_up_required": true,
      "recommended_action": "建议销售人员尽快联系客户并发送套餐报价",
      "customer_concerns": ["套餐价格", "外景拍摄"],
      "customer_tags": ["婚纱照", "近期需求", "高意向"],
      "collected_data": {
        "拍摄类型": "婚纱照",
        "预算": "5000元左右",
        "意向门店": "海口店",
        "期望拍摄时间": "2026年10月"
      }
    },
    "call": {
      "status": "ANSWERED",
      "status_text": "已接通",
      "called_at": "2026-09-10T15:28:30+08:00",
      "duration_seconds": 115
    },
    "conversation_logs": [
      {
        "sequence": 1,
        "speaker": "AI",
        "content": "您好，请问近期有拍摄婚纱照的计划吗？"
      },
      {
        "sequence": 2,
        "speaker": "CUSTOMER",
        "content": "有的，我想了解一下你们的价格。"
      }
    ],
    "billing": {
      "billing_minutes": 2,
      "customer_charge": "0.960000",
      "currency": "CNY"
    }
  }
}`;
const recordingEvent = `{
  "Token": "^******^",
  "Data": {
    "event_id": "11111111-1111-4111-8111-111111111114",
    "event_type": "OUTBOUND_RECORDING_AVAILABLE_BATCH",
    "occurred_at": "2026-09-07T10:31:00+08:00",
    "company_code": "5903679116",
    "task_no": "PT-20260907-00023",
    "recordings": [{
      "guid": "CRM-CUSTOMER-10001",
      "phone_masked": "138****8888",
      "recording_id": "33333333-3333-4333-8333-333333333333",
      "recording_url": "https://scheduling.paiyide.cc/api/v1/recordings/33333333-3333-4333-8333-333333333333/content?exp=1788662760&aud=...&sig=...",
      "expires_at": "2026-09-07T10:46:00+08:00"
    }]
  }
}`;

const apiDocs: ApiDoc[] = [
  platformDoc({
    id: 'create-outbound-task',
    method: 'POST',
    title: '新增外呼批次',
    path: '/openapi/v2/outbound/tasks',
    summary:
      'ERP/CRM 提交一个业务批次；平台按三级分类实际命中的话术和线路自动生成一个或多个百应任务。',
    params: [
      ...requestHeaders,
      idempotency,
      ['main_category', 'Body · string', '是', '一级分类，例如“排档”'],
      ['sub_category', 'Body · string', '是', '二级分类，例如“孕妈”'],
      [
        'source',
        'Body · integer',
        '是',
        '0=ERP，1=CRM；必须与请求 Token 的来源一致',
      ],
      [
        'company_code',
        'Body · string',
        '是',
        '影楼 MC code，只用于识别发起影楼',
      ],
      [
        'customer_list',
        'Body · array',
        '是',
        '按 c_level 分组的客户数组；整个批次最多 10,000 个号码',
      ],
      [
        'customer_list[].c_level',
        'Body · string',
        '是',
        '三级分类；允许空字符串，空字符串不是 SR3 的默认值',
      ],
      [
        'customer_list[].c_info_list[].phone',
        'Body · string',
        '是',
        '客户号码；归一化后在本批次内不可重复',
      ],
      [
        'customer_list[].c_info_list[].guid',
        'Body · string',
        '是',
        '本次发起的号码唯一值；同一号码下次发起必须生成新 GUID',
      ],
      [
        'customer_list[].c_info_list[].customer_name',
        'Body · string|null',
        '否',
        '客户称呼；空值按未提供处理',
      ],
      [
        'customer_list[].c_info_list[].{变量名}',
        'Body · scalar|null',
        '否',
        '任意逐号码动态变量；null 不导入百应，强依赖变量按已发布映射使用默认值',
      ],
    ],
    request: createBatchRequest,
    response: createBatchResponse,
    errorResponse: insufficientBalanceResponse,
    responseLead:
      'HTTP 202 表示整批已原子受理，不表示百应已经开始呼叫；batch_id 由平台生成。',
    rules: [
      ...requestRules,
      [
        '批次与任务',
        '对 ERP/CRM 始终是一个 batch_id；执行层按实际路由生成 1～N 个平台任务，每个对应一个百应任务。',
      ],
      [
        'GUID 与重试',
        '同一次 HTTP 超时重试复用原 GUID、Idempotency-Key 和完全相同的 Body；新业务发起生成新 GUID 和新幂等键。',
      ],
      [
        '变量边界',
        '业务字段种类和数量不设固定上限；仍限制变量名 128 字节、单值 8 KiB、单号码变量 128 KiB、请求体 25 MiB。',
      ],
      [
        '全批屏障',
        '所有子任务全部创建并导入成功后才统一启动；任一子任务失败时不会放行剩余任务。',
      ],
      [
        '余额不足充值',
        '可用余额不足时返回 HTTP 409 和 INSUFFICIENT_BALANCE；recharge_qr_code_url 是可直接展示给用户扫码充值的公开图片地址。',
      ],
    ],
    errors: commonErrors,
  }),
  platformDoc({
    id: 'get-outbound-batch',
    method: 'GET',
    title: '查询外呼批次',
    path: '/openapi/v2/outbound/batches/{batchId}',
    summary: '查询一个业务批次的汇总状态，以及平台自动拆分出的所有执行任务。',
    params: [
      ...requestHeaders,
      ['batchId', 'Path · uuid', '是', '新增外呼批次成功后返回的 batch_id'],
    ],
    response: batchDetailResponse,
    rules: [
      ...requestRules,
      [
        '状态汇总',
        '批次状态由全部执行任务汇总；PARTIAL_FAILED 表示部分任务已经启动或完成、另一些任务失败。',
      ],
      [
        '轮询建议',
        '创建后可按返回的 status_url 查询；调用方应退避轮询，不要固定高频请求。',
      ],
    ],
    errors: commonErrors.filter(([code]) =>
      ['401', '404', '503'].includes(code),
    ),
  }),
  {
    id: 'result-callback',
    group: '平台回传 ERP / CRM',
    direction: '平台 → ERP / CRM',
    method: 'POST',
    title: '业务结果回传',
    path: '{studio.resultCallbackUrl}',
    summary:
      '每个 guid 投递一次业务结论；顶层 Token 固定为 ^******^，ERP/CRM 优先读取 Data.customer_result。',
    status: '外部接收方实现',
    caller: '百应外呼调度台',
    receiver: 'ERP / CRM',
    contentType: 'application/json;charset=utf-8',
    auth: 'Body Token + X-Signature 回调签名 + X-Platform-Event-Id 幂等',
    contractVersion: '2.1',
    host: 'configured',
    params: [
      ...callbackHeaders,
      [
        'Token',
        'Body · string',
        '是',
        '固定验证值 ^******^；按原样发送，不转义、不掩码、不派生',
      ],
      [
        'Data.event_id',
        'Body · uuid',
        '是',
        '与 X-Platform-Event-Id 相同，用于幂等',
      ],
      ['Data.event_type', 'Body · string', '是', '固定为 OUTBOUND_CALL_RESULT'],
      ['Data.occurred_at', 'Body · datetime', '是', '平台形成最终结果的时间'],
      ['Data.company_code', 'Body · string', '是', '影楼编码'],
      ['Data.batch_id', 'Body · uuid|null', '是', '发起外呼时返回的批次 ID'],
      ['Data.task_no', 'Body · string', '是', '平台任务编号'],
      [
        'Data.customer.guid',
        'Body · string',
        '是',
        'ERP/CRM 发起外呼时传入的客户唯一标识',
      ],
      ['Data.customer.customer_name', 'Body · string|null', '是', '客户姓名'],
      [
        'Data.customer.phone_masked',
        'Body · string',
        '是',
        '脱敏号码，不返回完整手机号',
      ],
      [
        'Data.customer_result.result_code',
        'Body · enum',
        '是',
        '最终业务分类；ERP/CRM 自动处理时优先读取',
      ],
      [
        'Data.customer_result.result_text',
        'Body · string',
        '是',
        '可以直接展示给业务人员的中文结论',
      ],
      [
        'Data.customer_result.contacted',
        'Body · boolean',
        '是',
        '是否实际接通客户',
      ],
      [
        'Data.customer_result.intention_level / intention_text',
        'Body · string|null / string',
        '是',
        '百应原始意向值及平台归一化中文说明',
      ],
      [
        'Data.customer_result.summary',
        'Body · string',
        '是',
        '可以直接展示的客户情况摘要',
      ],
      [
        'Data.customer_result.follow_up_required',
        'Body · boolean',
        '是',
        '是否应在 ERP/CRM 创建跟进事项',
      ],
      [
        'Data.customer_result.recommended_action',
        'Body · string',
        '是',
        '建议业务人员采取的下一步动作',
      ],
      [
        'Data.customer_result.customer_concerns / customer_tags',
        'Body · string[]',
        '是',
        '客户关注点和业务标签',
      ],
      [
        'Data.customer_result.collected_data',
        'Body · object',
        '是',
        '仅包含本次通话实际采集到的业务数据',
      ],
      [
        'Data.call',
        'Body · object',
        '是',
        '通话状态、中文状态、拨号时间和通话秒数',
      ],
      [
        'Data.conversation_logs',
        'Body · array',
        '是',
        '完整 AI/客户对话，speaker 为 AI 或 CUSTOMER',
      ],
      [
        'Data.billing',
        'Body · object',
        '是',
        'billing_minutes 为计费分钟数，customer_charge 为固定 6 位小数字符串，currency 固定为 CNY',
      ],
    ],
    request: resultEvent,
    response: callbackAck,
    responseLead:
      'ERP/CRM 应在原始事件可靠落库后立即返回任意 2xx；双方联调统一返回以下 JSON。',
    rules: [
      [
        '验签原文',
        'POST、回调 path、时间戳、事件 ID、原始 Body SHA-256 依次用换行连接。',
      ],
      [
        '幂等',
        '以 X-Platform-Event-Id 唯一落库；平台重试时事件 ID 和 Body 保持不变，重复事件仍返回成功。',
      ],
      [
        '重试',
        '网络错误、408、429、5xx 按 1 分钟至 8 小时退避重试；其他 4xx 进入死信。',
      ],
      [
        '业务读取顺序',
        '程序优先读取 Data.customer_result.result_code 和 follow_up_required；页面优先展示 result_text、summary 和 recommended_action；Data.conversation_logs 作为可展开明细。',
      ],
      [
        '业务分类',
        'result_code 为 HIGH_INTENT、MEDIUM_INTENT、LOW_INTENT、NO_INTENT、UNREACHED、CALL_FAILED 或 UNKNOWN。',
      ],
      [
        '数据范围',
        'Body 不包含完整手机号、呼叫前原始动态变量、百应任务/机器人/线路 ID 或平台内部 sx_* 字段。',
      ],
      [
        '配置位置',
        '在影楼新增/编辑弹窗配置 ERP/CRM 结果地址和回调密钥；地址支持 HTTP 或 HTTPS。',
      ],
    ],
  },
  {
    id: 'recording-callback',
    group: '平台回传 ERP / CRM',
    direction: '平台 → ERP / CRM',
    method: 'POST',
    title: '录音可下载回传',
    path: '{studio.recordingCallbackUrl}',
    summary:
      '平台归档百应录音后，只回传客户 GUID、脱敏手机号和短期录音下载信息。',
    status: '外部接收方实现',
    caller: '百应外呼调度台',
    receiver: 'ERP / CRM',
    contentType: 'application/json;charset=utf-8',
    auth: 'Body Token + X-Signature 回调签名 + X-Platform-Event-Id 幂等',
    contractVersion: '2.1',
    host: 'configured',
    params: [
      ...callbackHeaders,
      [
        'Token',
        'Body · string',
        '是',
        '固定字面值 ^******^，不可转义、脱敏或替换',
      ],
      ['Data.event_id', 'Body · uuid', '是', '与请求头事件 ID 一致'],
      [
        'Data.event_type',
        'Body · string',
        '是',
        '固定为 OUTBOUND_RECORDING_AVAILABLE_BATCH',
      ],
      ['Data.occurred_at', 'Body · datetime', '是', '平台归档录音的时间'],
      ['Data.company_code', 'Body · string', '是', '影楼 MC code'],
      ['Data.task_no', 'Body · string', '是', '平台任务号'],
      ['Data.recordings', 'Body · array', '是', '本次可下载的录音'],
      [
        'Data.recordings[].guid',
        'Body · string',
        '是',
        'ERP/CRM 发起外呼时提交的客户 GUID',
      ],
      [
        'Data.recordings[].phone_masked',
        'Body · string',
        '是',
        '同一客户原始记录生成的脱敏手机号',
      ],
      [
        'Data.recordings[].recording_id',
        'Body · uuid',
        '是',
        '平台录音 ID，地址过期后用于重新签发',
      ],
      [
        'Data.recordings[].recording_url',
        'Body · https URL',
        '是',
        '平台签发的短期录音下载地址',
      ],
      [
        'Data.recordings[].expires_at',
        'Body · date-time',
        '是',
        '下载地址失效时间',
      ],
    ],
    request: recordingEvent,
    response: callbackAck,
    responseLead: '接收方应以 guid 关联客户，并在 expires_at 前下载录音。',
    rules: [
      [
        '客户关联',
        'guid、phone_masked 与 recording_url 来自同一条平台通话记录；以 guid 为主键，手机号用于人工核对。',
      ],
      [
        '验签与幂等',
        '与业务结果回传使用相同算法；以 X-Platform-Event-Id 唯一落库，重复事件返回成功。',
      ],
      [
        '录音安全',
        'recording_url 是平台签发的短期地址，不是百应临时地址；禁止写入日志、监控或工单。',
      ],
      ['重新签发', 'URL 过期后调用平台重新签发接口，不要继续重试旧 URL。'],
      ['配置位置', '在影楼新增/编辑弹窗分别配置 ERP/CRM 录音回传地址。'],
    ],
  },
  baiyingDoc({
    id: 'baiying-oauth-token',
    method: 'POST',
    title: '获取百应 Access Token',
    path: 'https://open-tcs.byai.com/oauth/token',
    summary:
      '用 appKey、appSecret 和 companyId 换取短期令牌；平台提前 5 分钟刷新。',
    status: '已接入',
    params: [
      ['client_id', 'Form · string', '是', '百应应用 appKey'],
      [
        'client_secret',
        'Form · string',
        '是',
        '百应应用密钥，仅在平台后端配置，不下发到浏览器',
      ],
      ['company_id', 'Form · string', '是', '百应公司 ID'],
    ],
    request: 'client_id=app-key&client_secret=***&company_id=12345',
    response: `{ "code": 200, "data": { "access_token": "***", "expires_in": 7200, "expires_at": 1788772800000 } }`,
    rules: [
      ['密钥安全', 'appSecret 与 accessToken 不进入前端、不写普通日志。'],
      ['缓存策略', '复用未过期 Token；距过期不足 5 分钟时主动刷新。'],
    ],
    sourceUrl: 'https://open.byai.com/v2/auth.html',
    sourceLabel: '百应 OAuth 文档',
  }),
  baiyingDoc({
    id: 'baiying-company-list',
    method: 'POST',
    title: '查询百应公司列表',
    path: '/api/oauth/byai.openapi.company/1.0.0/list',
    summary: '校验 Token 可访问的百应公司并解析 companyId。',
    status: '已接入',
    params: [['accessToken', 'Form · string', '是', '百应 OAuth Token']],
    response: `{ "code": 200, "data": [{ "companyId": 12345, "companyName": "示例公司" }], "resultMsg": "successful" }`,
    rules: [['使用场景', '连接检查与资源同步前校验，不向运营前端透传 Token。']],
    sourceUrl: 'https://open.byai.com/',
    sourceLabel: '百应开放平台',
  }),
  baiyingDoc({
    id: 'baiying-robot-list',
    method: 'POST',
    title: '查询百应话术列表',
    path: '/api/oauth/byai.openapi.robot/1.0.0/list',
    summary: '同步话术及发布状态，用于话术绑定和变量巡检。',
    status: '已接入',
    params: [
      ['accessToken', 'Form · string', '是', '百应 OAuth Token'],
      ['companyId', 'Form · string', '是', '百应公司 ID'],
      ['robotStatus', 'Form · integer', '否', '0 全部、1 已上线、2 发布过'],
    ],
    response: `{ "code": 200, "data": [{ "robotDefId": 286485, "robotName": "百天邀约", "robotStatus": 2 }], "resultMsg": "successful" }`,
    rules: [['同步口径', '新任务只使用已发布且当前有效的话术。']],
    sourceUrl: 'https://open.byai.com/',
    sourceLabel: '百应开放平台',
  }),
  baiyingDoc({
    id: 'baiying-phone-list',
    method: 'POST',
    title: '查询百应线路列表',
    path: '/api/oauth/byai.openapi.phone/1.0.0/list',
    summary: '实时读取外呼线路、费率类型和线路余额，用于线路管理。',
    status: '已接入',
    params: [
      ['accessToken', 'Form · string', '是', '百应 OAuth Token'],
      ['companyId', 'Form · string', '是', '百应公司 ID'],
      ['userPhoneId', 'Form · string', '否', '指定线路 ID'],
    ],
    response: `{ "code": 200, "data": [{ "userPhoneId": 45678, "phoneName": "华东主线路", "lineAmount": 200 }], "resultMsg": "successful" }`,
    rules: [['实时数据', '接口失败时显示不可用状态，不使用伪造线路兜底。']],
    sourceUrl: 'https://open.byai.com/',
    sourceLabel: '百应开放平台',
  }),
  baiyingDoc({
    id: 'baiying-communication-balance',
    method: 'POST',
    title: '查询百应通信余额',
    path: '/api/oauth/byai.openapi.company.communication/1.0.0/balance',
    summary: '查询百应公司的线路通信余额。',
    status: '已接入',
    params: [
      ['accessToken', 'Form · string', '是', '百应 OAuth Token'],
      ['companyId', 'Form · string', '是', '百应公司 ID'],
    ],
    response: `{ "code": 200, "data": { "amount": 1200.5 }, "resultMsg": "successful" }`,
    rules: [['数据边界', '仅用于供应商监控，不参与影楼客户余额账本。']],
    sourceUrl: 'https://open.byai.com/',
    sourceLabel: '百应开放平台',
  }),
  baiyingDoc({
    id: 'baiying-ai-balance',
    method: 'POST',
    title: '查询百应 AI 账户余额',
    path: '/api/oauth/byai.openapi.company.ai/1.0.0/balance',
    summary: '查询 AI 账户剩余金额、单价和可用次数。',
    status: '已接入',
    params: [
      ['accessToken', 'Form · string', '是', '百应 OAuth Token'],
      ['companyId', 'Form · string', '是', '百应公司 ID'],
    ],
    response: `{ "code": 200, "data": { "amount": 580, "price": "0.20", "num": 2900 }, "resultMsg": "successful" }`,
    rules: [['数据边界', '供应商余额与平台影楼余额相互独立。']],
    sourceUrl: 'https://open.byai.com/',
    sourceLabel: '百应开放平台',
  }),
  baiyingDoc({
    id: 'baiying-seat-overview',
    method: 'POST',
    title: '查询百应坐席概况',
    path: '/api/oauth/byai.openapi.seatinfo/1.0.0/get',
    summary: '查询公司已用与总 AI 外呼坐席。',
    status: '已接入',
    params: [
      ['accessToken', 'Form · string', '是', '百应 OAuth Token'],
      ['companyId', 'Form · string', '是', '百应公司 ID'],
    ],
    response: `{ "code": 200, "data": { "companyUsingCallSeat": 2, "companyAllCallSeat": 10 }, "resultMsg": "successful" }`,
    rules: [['监控用途', '只读查询，失败不会修改任务或本地配置。']],
    sourceUrl: 'https://open.byai.com/',
    sourceLabel: '百应开放平台',
  }),
  baiyingDoc({
    id: 'baiying-scene-variables',
    method: 'POST',
    title: '查询百应话术变量',
    path: '/api/oauth/byai.openapi.company.scenevariables/1.0.0/get',
    summary: '获取已发布话术变量，用于字段映射巡检。',
    status: '已接入',
    params: [
      ['accessToken', 'Form · string', '是', '百应 OAuth Token'],
      ['companyId', 'Form · string', '是', '百应公司 ID'],
      ['robotDefId', 'Form · string', '是', '百应话术 ID'],
      ['hideDefaultVar', 'Form · boolean', '是', '固定 true，只同步自定义变量'],
    ],
    response: `{ "code": 200, "data": { "variables": ["客户姓名", "婚期"] }, "resultMsg": "successful" }`,
    rules: [['映射门禁', '变量必须来自最近成功快照，运营不能手工创造变量名。']],
    sourceUrl: 'https://open.byai.com/',
    sourceLabel: '百应开放平台',
  }),
  baiyingDoc({
    id: 'baiying-workflow-list',
    method: 'POST',
    title: '查询百应复杂任务列表',
    path: '/api/oauth/byai.sop.workflow.list.page/1.0.0/search',
    summary: '分页读取百应复杂任务并合并平台数据分类绑定。',
    status: '已接入',
    params: [
      ['accessToken', 'Form · string', '是', '百应 OAuth Token'],
      [
        'workflowExecuteStatus',
        'Form · enum',
        '否',
        'ALL、DRAFT、UNSTART、START、FINISH、PAUSE',
      ],
      ['pageNum / pageSize', 'Form · integer', '否', '默认 0 / 20'],
      ['name / workflowId', 'Form · string', '否', '名称或任务 ID 过滤'],
    ],
    response: `{ "code": 200, "data": { "total": 1, "pages": 1, "list": [{ "id": 38028, "name": "百天邀约", "workflowExecuteStatus": "START" }] }, "resultMsg": "successful" }`,
    rules: [['实时读取', '计划任务页面以百应返回为准，本地只保存分类绑定。']],
    sourceUrl: 'https://open.byai.com/',
    sourceLabel: '百应开放平台',
  }),
  baiyingDoc({
    id: 'baiying-create-calljob',
    method: 'POST',
    title: '创建百应 AI 外呼任务',
    path: '/api/oauth/byai.openapi.calljob/1.0.0/create',
    summary: '异步编排第一步：为一个平台任务创建唯一百应 callJobId。',
    status: '已接入（真实写入需开关）',
    params: [
      ['accessToken', 'Form · string', '是', '百应 OAuth Token'],
      ['callJobName', 'Form · string', '是', '平台生成的确定性名称'],
      ['callJobType', 'Form · integer', '是', '固定为 2（手动任务）'],
      ['companyId', 'Form · string', '是', '百应公司 ID'],
      ['robotDefId', 'Form · string', '是', '任务话术快照'],
      ['userPhoneIds', 'Form · array', '是', '任务线路快照'],
    ],
    request:
      'accessToken=***&callJobName=PT-20260907-00023-a1b2c3d4&callJobType=2&companyId=12345&robotDefId=286485&userPhoneIds=[45678]',
    response: `{ "code": 200, "data": { "callJobId": 241491320 }, "resultMsg": "successful" }`,
    rules: [
      [
        '未知结果恢复',
        '请求超时后禁止直接重建；先按确定性名称查询，确认不存在才允许重试。',
      ],
      ['失败处理', '明确失败后进入执行失败，释放冻结金额并回传可读原因。'],
    ],
    sourceUrl: 'https://open.byai.com/v2/operations/calljob-create.html',
    sourceLabel: '百应创建任务文档',
  }),
  baiyingDoc({
    id: 'baiying-search-calljob',
    method: 'POST',
    title: '查询百应外呼任务',
    path: '/api/oauth/byai.openapi.calljob/1.0.0/list',
    summary: '按确定性名称查询任务，用于创建响应丢失后的补偿确认。',
    status: '已接入',
    params: [
      ['accessToken', 'Form · string', '是', '百应 OAuth Token'],
      ['companyId', 'Form · string', '是', '百应公司 ID'],
      ['jobName', 'Form · string', '否', '确定性任务名称'],
      ['pageNum / pageSize', 'Form · integer', '否', '分页参数'],
    ],
    response: `{ "code": 200, "data": { "list": [{ "callJobId": 241491320, "jobName": "PT-20260907-00023-a1b2c3d4" }] }, "resultMsg": "successful" }`,
    rules: [['唯一性门禁', '唯一命中才补写 callJobId；同名多条必须转人工。']],
    sourceUrl: 'https://open.byai.com/v2/operations/calljob-list.html',
    sourceLabel: '百应任务列表文档',
  }),
  baiyingDoc({
    id: 'baiying-import-customers',
    method: 'POST',
    title: '导入号码到百应任务',
    path: '/api/oauth/byai.openapi.calljob.customer/1.0.0/import',
    summary: '把已校验并完成字段映射的客户名单导入唯一百应任务。',
    status: '已接入（真实写入需开关）',
    params: [
      ['accessToken', 'Form · string', '是', '百应 OAuth Token'],
      ['callJobId', 'Form · string', '是', '百应任务 ID'],
      ['companyId', 'Form · string', '是', '百应公司 ID'],
      [
        'customerInfoVOList',
        'Form · JSON array',
        '是',
        '客户、号码和 properties，最多 10,000 条',
      ],
      ['permitrepeatnum', 'Form · boolean', '是', '固定 false'],
    ],
    request:
      'callJobId=241491320&companyId=12345&permitrepeatnum=false&customerInfoVOList=[{"name":"王女士","phone":"13800000000","properties":{"sx_platform_item_id":"item-uuid"}}]&accessToken=***',
    response: `{ "code": 200, "data": { "total": 1, "successNum": 1, "placeFailNum": 0, "repeatNum": 0 }, "resultMsg": "successful" }`,
    rules: [
      [
        '全量成功',
        'successNum 等于客户数且失败、重复均为 0；部分成功按整个任务失败处理。',
      ],
      [
        '失败清理',
        '不启动任务，尝试终止百应任务、释放冻结金额并保留失败明细。',
      ],
    ],
    sourceUrl:
      'https://open.byai.com/v2/operations/calljob-customer-import.html',
    sourceLabel: '百应导入客户文档',
  }),
  baiyingDoc({
    id: 'baiying-execute-calljob',
    method: 'POST',
    title: '启动 / 暂停 / 终止百应任务',
    path: '/api/oauth/byai.openapi.calljob/1.0.0/execute',
    summary: '执行百应任务控制命令，查询确认成功后推进平台状态。',
    status: '已接入（真实写入需开关）',
    params: [
      ['accessToken', 'Form · string', '是', '百应 OAuth Token'],
      ['callJobId', 'Form · string', '是', '百应任务 ID'],
      ['companyId', 'Form · string', '是', '百应公司 ID'],
      ['command', 'Form · integer', '是', '1 启动/恢复、2 暂停、3 终止'],
    ],
    request: 'accessToken=***&callJobId=241491320&companyId=12345&command=1',
    response: baiyingOk,
    rules: [
      ['成功判断', '同时满足 code=200 与 resultMsg=successful 才算成功。'],
      [
        '失败状态',
        '启动、暂停或终止任一操作失败，平台进入执行失败并回传用户可读原因。',
      ],
    ],
    sourceUrl: 'https://open.byai.com/v2/operations/calljob-execute.html',
    sourceLabel: '百应任务控制文档',
  }),
  {
    id: 'baiying-callback',
    group: '百应回调平台',
    direction: '百应 → 平台',
    method: 'POST',
    title: '百应任务与通话回调',
    path: '/api/v1/callbacks/baiying',
    summary:
      '统一接收 CALL_INSTANCE_RESULT 与 JOB_INFO_RESULT；原文可靠落库后立即 ACK，后续处理全部异步。',
    status: '已实现',
    caller: '百应开放平台',
    receiver: '百应外呼调度台',
    contentType: 'application/json;charset=utf-8',
    auth: '生产由阿里云 WAF/ALB 限制百应官方来源 IP',
    host: 'platform',
    params: [
      ['code', 'Body · number', '是', '百应响应码'],
      [
        'data.callbackType',
        'Body · enum',
        '是',
        'CALL_INSTANCE_RESULT 或 JOB_INFO_RESULT',
      ],
      [
        'data.data.callInstance.companyId',
        'Body · number|string',
        '通话回调',
        '百应公司 ID',
      ],
      [
        'data.data.callInstance.callJobId',
        'Body · number|string',
        '通话回调',
        '百应任务 ID',
      ],
      [
        'data.data.callInstance.callInstanceId',
        'Body · number|string',
        '通话回调',
        '百应通话 ID',
      ],
      [
        'data.data.callInstance.callInstanceStatus',
        'Body · number',
        '否',
        '完成回调固定为 2',
      ],
      [
        'data.data.callInstance.finishStatus',
        'Body · number',
        '通话回调',
        '通话结果：0 接听、1 拒接、6 占线，其余按百应状态映射',
      ],
      [
        'data.data.callInstance.calledTimes',
        'Body · number',
        '否',
        '累计拨打次数',
      ],
      [
        'data.data.callInstance.customerTelephone',
        'Body · string',
        '否',
        '客户号码，仅在受限后端处理',
      ],
      [
        'data.data.callInstance.duration',
        'Body · number',
        '否',
        '通话时长秒数，缺省按 0',
      ],
      [
        'data.data.callInstance.startTime / endTime',
        'Body · string|number',
        '否',
        '百应拨打与结束时间',
      ],
      [
        'data.data.callInstance.luyinOssUrl',
        'Body · string',
        '否',
        '完整录音临时地址',
      ],
      [
        'data.data.callInstance.userLuyinOssUrl',
        'Body · string',
        '否',
        '仅被叫侧录音临时地址',
      ],
      [
        'data.data.callInstance.properties',
        'Body · object|string',
        '否',
        '话术变量与 sx_platform_item_id',
      ],
      [
        'data.data.taskResult',
        'Body · array',
        '否',
        '百应采集结果，合并到平台 collectProperties',
      ],
      [
        'data.data.companyId',
        'Body · number|string',
        '任务回调',
        '百应公司 ID',
      ],
      [
        'data.data.callJobId',
        'Body · number|string',
        '任务回调',
        '百应任务 ID',
      ],
      ['data.data.callJobStatus', 'Body · number', '任务回调', '百应任务状态'],
      [
        'data.data.updateTime / endTime',
        'Body · string|number',
        '否',
        '任务状态发生时间',
      ],
      ['resultMsg', 'Body · string', '否', '百应响应内容'],
    ],
    request: `{
  "code": 200,
  "data": {
    "callbackType": "CALL_INSTANCE_RESULT",
    "data": {
      "callInstance": {
        "callJobId": 241491320,
        "callInstanceId": 70258002706,
        "callInstanceStatus": 2,
        "finishStatus": 0,
        "customerTelephone": "136****0000",
        "duration": 24,
        "luyinOssUrl": "https://example.com/full.mp3",
        "properties": { "sx_platform_item_id": "item-uuid" }
      },
      "phoneLogs": [],
      "taskResult": [],
      "callRepeat": []
    }
  },
  "resultMsg": "成功"
}`,
    response: `{ "code": 200 }`,
    responseLead: '原始回调可靠落库后立即响应；重复报文同样返回成功。',
    rules: [
      [
        '幂等处理',
        '按业务键和原文哈希去重，避免重试造成重复通话、计费或回传。',
      ],
      ['计费分钟', '逐通话按 ceil(duration / 60) 计算后汇总。'],
      [
        '录音归档',
        '百应临时录音及时下载到平台归档存储，再向 ERP/CRM 提供短期地址。',
      ],
      ['失败重试', '未返回规定成功内容时，百应最多重试 15 次。'],
    ],
    errors: [
      ['400', 'HTTP', '否', 'JSON 或最小路由字段不合法'],
      ['413', 'HTTP', '否', '正文超过平台限制'],
      ['415', 'HTTP', '否', 'Content-Type 不是 application/json'],
      ['503', 'HTTP', '否', 'Inbox 暂不可用，百应应重试'],
    ],
    sourceUrl: 'https://open.byai.com/v2/event-callbacks/call-instance.html',
    sourceLabel: '百应回调原始文档',
  },
];

const groups = [...new Set(apiDocs.map((doc) => doc.group))];

function endpointFor(doc: ApiDoc) {
  if (doc.path.startsWith('http')) return doc.path;
  if (doc.host === 'baiying') return `${baiyingBaseUrl}${doc.path}`;
  if (doc.host === 'configured') return doc.path;
  return `${platformBaseUrl}${doc.path}`;
}

function CopyButton({
  value,
  label = '复制',
}: {
  value: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  return (
    <button
      type="button"
      className="api-copy-button"
      onClick={() => void copy()}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? '已复制' : label}
    </button>
  );
}

function ParameterTable({
  rows,
  firstColumn = '参数名',
}: {
  rows: Row[];
  firstColumn?: string;
}) {
  return (
    <div className="api-parameter-table">
      <table>
        <thead>
          <tr>
            <th>{firstColumn}</th>
            <th>位置 / 类型</th>
            <th>必传</th>
            <th>说明</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`${row[0]}-${rowIndex}`}>
              {row.map((cell, index) => (
                <td key={`${row[0]}-${index}`}>
                  {index === 0 ? <code>{cell}</code> : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ApiDocumentation({
  publicView = false,
}: {
  publicView?: boolean;
}) {
  const [activeId, setActiveId] = useState('create-outbound-task');
  useEffect(() => {
    const selected = new URLSearchParams(window.location.search).get('api');
    if (!selected || !apiDocs.some((doc) => doc.id === selected)) return;
    const timer = window.setTimeout(() => setActiveId(selected), 0);
    return () => window.clearTimeout(timer);
  }, []);
  const active = useMemo(
    () => apiDocs.find((doc) => doc.id === activeId) ?? apiDocs[0],
    [activeId],
  );
  const endpoint = endpointFor(active);
  const shareUrl =
    typeof window === 'undefined'
      ? `/api-docs?api=${active.id}`
      : `${window.location.origin}/api-docs?api=${active.id}`;

  const select = (doc: ApiDoc) => {
    setActiveId(doc.id);
    const url = new URL(window.location.href);
    url.searchParams.set('api', doc.id);
    window.history.replaceState({}, '', url);
  };

  return (
    <div
      className={publicView ? 'api-docs-page api-docs-public' : 'api-docs-page'}
    >
      <header className="api-docs-header">
        <div>
          <span>
            {publicView ? 'PUBLIC API DOCUMENTATION' : 'API INTEGRATION'}
          </span>
          <h2>API 接口文档</h2>
          <p>
            ERP、CRM 按当前 v2
            契约接入调度平台，以及平台与百应之间的地址、鉴权、字段和处理规则。
          </p>
        </div>
        <CopyButton value={shareUrl} label="复制当前接口链接" />
      </header>
      <div className="api-docs-workspace">
        <aside className="api-catalog" aria-label="接口目录">
          <header>
            <span>接口目录</span>
            <small>{apiDocs.length} 个接口</small>
          </header>
          <div className="api-catalog-list">
            {groups.map((group) => (
              <section className="api-catalog-group" key={group}>
                <h3>
                  {group}
                  <small>
                    {apiDocs.filter((doc) => doc.group === group).length}
                  </small>
                </h3>
                {apiDocs
                  .filter((doc) => doc.group === group)
                  .map((doc) => (
                    <button
                      key={doc.id}
                      type="button"
                      className={`api-catalog-card${doc.id === active.id ? ' is-active' : ''}`}
                      onClick={() => select(doc)}
                    >
                      <span>
                        <b data-method={doc.method}>{doc.method}</b>
                        <i>{doc.direction}</i>
                      </span>
                      <strong>{doc.title}</strong>
                      <code>{doc.path}</code>
                      <small>{doc.summary}</small>
                    </button>
                  ))}
              </section>
            ))}
          </div>
        </aside>
        <article className="api-reference" key={active.id}>
          <section className="api-reference-hero">
            <div>
              <span className="api-method" data-method={active.method}>
                {active.method}
              </span>
              <span
                className={`api-state${active.status !== '已实现' && active.status !== '已接入' ? ' is-pending' : ''}`}
              >
                {active.status}
              </span>
              <span className="api-direction">{active.direction}</span>
              <h1>{active.title}</h1>
              <p>{active.summary}</p>
            </div>
            {active.sourceUrl ? (
              <a href={active.sourceUrl} target="_blank" rel="noreferrer">
                {active.sourceLabel ?? '原始文档'} <ExternalLink size={12} />
              </a>
            ) : (
              <span className="api-contract-source">
                契约版本 {active.contractVersion ?? '当前'}
              </span>
            )}
          </section>
          <section className="api-reference-section">
            <h3>请求地址</h3>
            <div className="api-endpoint">
              <span data-method={active.method}>{active.method}</span>
              <code>{endpoint}</code>
              <CopyButton value={endpoint} />
            </div>
            <div className="api-callouts">
              <p>
                <b>Content-Type</b>
                <code>{active.contentType}</code>
              </p>
              <p>
                <b>认证</b>
                <span>{active.auth}</span>
              </p>
              <p>
                <b>调用方 / 接收方</b>
                <span>
                  {active.caller} → {active.receiver}
                </span>
              </p>
            </div>
          </section>
          <section className="api-reference-section">
            <h3>请求参数</h3>
            <p className="api-section-lead">
              字段名称、位置、类型和必传规则以当前契约为准。
            </p>
            <ParameterTable rows={active.params} />
          </section>
          {active.request ? (
            <section className="api-reference-section">
              <div className="api-section-title">
                <h3>请求示例</h3>
                <CopyButton value={active.request} />
              </div>
              <pre className="api-code-block">
                <code>{active.request}</code>
              </pre>
            </section>
          ) : null}
          <section className="api-reference-section">
            <div className="api-section-title">
              <h3>成功响应</h3>
              <CopyButton value={active.response} />
            </div>
            {active.responseLead ? (
              <p className="api-section-lead">{active.responseLead}</p>
            ) : null}
            <pre className="api-code-block">
              <code>{active.response}</code>
            </pre>
          </section>
          {active.errors?.length ? (
            <section className="api-reference-section">
              <h3>错误码与处理</h3>
              <p className="api-section-lead">
                HTTP 状态码表示传输结果，业务原因以响应体 code 和 message 为准。
              </p>
              <ParameterTable rows={active.errors} firstColumn="状态码" />
            </section>
          ) : null}
          {active.errorResponse ? (
            <section className="api-reference-section">
              <div className="api-section-title">
                <h3>余额不足响应</h3>
                <CopyButton value={active.errorResponse} />
              </div>
              <p className="api-section-lead">
                ERP/CRM 可直接展示 recharge_qr_code_url
                指向的图片供用户扫码充值。
              </p>
              <pre className="api-code-block">
                <code>{active.errorResponse}</code>
              </pre>
            </section>
          ) : null}
          <section className="api-reference-section">
            <h3>处理规则</h3>
            <div className="api-rule-grid">
              {active.rules.map(([title, description]) => (
                <article key={title}>
                  <b>{title}</b>
                  <p>{description}</p>
                </article>
              ))}
            </div>
          </section>
        </article>
      </div>
      {publicView ? (
        <footer className="api-public-footer">
          <Share2 size={13} />
          公开链接只展示接口契约，不包含运营后台入口、凭证或业务数据。
        </footer>
      ) : null}
    </div>
  );
}

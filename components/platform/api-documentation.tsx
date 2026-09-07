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
  rules: Rule[];
  errors?: Row[];
  sourceUrl?: string;
  sourceLabel?: string;
  host?: 'platform' | 'baiying' | 'configured';
};

const platformBaseUrl = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8788').replace(/\/$/, '');
const baiyingBaseUrl = 'https://open.byai.com';

const requestHeaders: Row[] = [
  ['X-Client-Id', 'Header · string', '是', '平台分配给 ERP 或 CRM 的客户端标识'],
  ['X-Timestamp', 'Header · string', '是', 'Unix 毫秒时间戳，允许最大偏差 ±5 分钟'],
  ['X-Nonce', 'Header · string', '是', '每次请求唯一随机串，用于防重放'],
  ['X-Signature', 'Header · string', '是', 'Base64(HMAC-SHA256(clientSecret, canonicalRequest))'],
  ['X-Request-Id', 'Header · string', '否', '调用方追踪 ID；缺省时由平台生成'],
];
const idempotency: Row = ['Idempotency-Key', 'Header · string', '是', '8～128 字符；网络超时重试必须沿用原值'];
const commonErrors: Row[] = [
  ['400', 'HTTP', '否', '请求格式或参数不合法，修正后重新提交'],
  ['401', 'HTTP', '否', '签名、时间戳、Nonce 或客户端凭证校验失败'],
  ['404', 'HTTP', '否', '资源不存在，或当前客户端无权访问'],
  ['409', 'HTTP', '否', '幂等冲突、余额不足、状态冲突或重放请求'],
  ['422', 'HTTP', '否', '分类、话术、线路、映射或业务规则未通过'],
  ['429', 'HTTP', '否', '请求频率超限，按退避策略重试'],
  ['503', 'HTTP', '否', '依赖暂时不可用，原幂等键退避重试'],
];
const requestRules: Rule[] = [
  ['签名原文', '大写 HTTP 方法、规范化 path/query、时间戳、Nonce、原始 Body SHA-256 依次用换行符连接。'],
  ['权限边界', 'ERP 凭证只能提交 ERP 来源，CRM 凭证只能提交 CRM 来源，并且只能访问授权 MC code。'],
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

function platformDoc(doc: Omit<ApiDoc, 'group' | 'direction' | 'status' | 'caller' | 'receiver' | 'contentType' | 'auth' | 'host'>): ApiDoc {
  return {
    ...doc,
    group: 'ERP / CRM 调用平台',
    direction: 'ERP / CRM → 平台',
    status: '已实现',
    caller: 'ERP 或 CRM',
    receiver: '百应外呼调度台',
    contentType: 'application/json;charset=utf-8',
    auth: 'HMAC-SHA256 请求签名 + MC code 授权',
    host: 'platform',
  };
}

function baiyingDoc(doc: Omit<ApiDoc, 'group' | 'direction' | 'caller' | 'receiver' | 'contentType' | 'auth' | 'host'>): ApiDoc {
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

const createTaskRequest = `{
  "schemaVersion": "1.0",
  "externalRequestId": "ERP-REQ-20260907-0023",
  "sourceSystem": "ERP",
  "mcCode": "MC-ZTY-001",
  "customers": [{
    "externalCustomerId": "ERP-C-10001",
    "name": "王女士",
    "phone": "13800000000",
    "dataCategoryId": "SS1",
    "fields": { "wedding_date": "2026-10-18" }
  }]
}`;
const createTaskResponse = `{
  "code": "TASK_ACCEPTED",
  "message": "任务已受理，正在创建百应外呼任务",
  "requestId": "9bba018d-36b2-478d-af0a-af3f7d573937",
  "data": {
    "taskId": "c5f1d5e0-1c67-4d02-a7a3-58666ea55792",
    "taskNo": "PT-20260907-00023",
    "taskName": "20260907排挡百天SS1-00023",
    "executionStatus": "ACCEPTED",
    "displayStatus": "执行中",
    "phoneCount": 1,
    "reservedAmount": "0.960000",
    "currency": "CNY",
    "statusUrl": "/openapi/v1/outbound/tasks/PT-20260907-00023"
  }
}`;
const callbackHeaders: Row[] = [
  ['X-Platform-Event-Id', 'Header · uuid', '是', '与 Body.eventId 相同，也是接收方幂等键'],
  ['X-Timestamp', 'Header · string', '是', '平台生成事件时的 Unix 毫秒时间戳'],
  ['X-Signature', 'Header · string', '是', '使用影楼来源端点 callbackSecret 计算的 HMAC 签名'],
  ['schemaVersion', 'Body · string', '是', '固定为 1.0'],
  ['eventId', 'Body · uuid', '是', '事件唯一标识；重试时保持不变'],
  ['eventType', 'Body · string', '是', '事件类型'],
  ['sourceSystem', 'Body · enum', '是', 'ERP 或 CRM'],
  ['mcCode', 'Body · string', '是', '影楼 MC code'],
  ['taskNo', 'Body · string', '是', '平台任务编号'],
  ['baiyingCallJobId', 'Body · string|null', '是', '百应任务 ID；创建阶段失败时可以为 null'],
];
const resultEvent = `{
  "schemaVersion": "1.0",
  "eventId": "11111111-1111-4111-8111-111111111111",
  "eventType": "OUTBOUND_TASK_STARTED",
  "occurredAt": "2026-09-07T10:02:10+08:00",
  "sourceSystem": "ERP",
  "mcCode": "MC-ZTY-001",
  "taskNo": "PT-20260907-00023",
  "baiyingCallJobId": "241491320",
  "executionStatus": "CALLING",
  "startedAt": "2026-09-07T10:02:09+08:00"
}`;
const recordingEvent = `{
  "schemaVersion": "1.0",
  "eventId": "11111111-1111-4111-8111-111111111114",
  "eventType": "OUTBOUND_RECORDING_AVAILABLE_BATCH",
  "occurredAt": "2026-09-07T10:31:00+08:00",
  "sourceSystem": "ERP",
  "mcCode": "MC-ZTY-001",
  "taskNo": "PT-20260907-00023",
  "baiyingCallJobId": "241491320",
  "batchNo": 1,
  "isLastBatch": true,
  "recordings": [{
    "recordingId": "33333333-3333-4333-8333-333333333333",
    "kind": "FULL",
    "contentType": "audio/mpeg",
    "sizeBytes": 384210,
    "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "downloadUrl": "https://oss.example.invalid/recording?signature=redacted",
    "expiresAt": "2026-09-07T10:46:00+08:00"
  }]
}`;

const apiDocs: ApiDoc[] = [
  platformDoc({
    id: 'create-outbound-task', method: 'POST', title: '新增外呼任务', path: '/openapi/v1/outbound/tasks',
    summary: '提交真实客户数据；平台完成鉴权、配置快照、余额冻结与可靠入队后返回 202，百应编排异步执行。',
    params: [...requestHeaders, idempotency,
      ['schemaVersion', 'Body · string', '是', '固定为 1.0'],
      ['externalRequestId', 'Body · string', '是', '来源系统业务关联号，1～128 字符'],
      ['sourceSystem', 'Body · enum', '是', '必须与客户端凭证一致：ERP 或 CRM'],
      ['mcCode', 'Body · string', '是', '影楼 MC code'],
      ['customers', 'Body · array', '是', '1～10,000 个客户；手机号与 externalCustomerId 不可重复'],
      ['customers[].dataCategoryId', 'Body · string', '是', '真实数据分类，用于解析任务名称、话术、线路和映射'],
      ['customers[].fields', 'Body · object', '是', '来源业务字段，最多 100 个'],
      ['taskName', 'Body · string', '否', '兼容旧调用保留但会被忽略，由平台自动生成'],
    ],
    request: createTaskRequest, response: createTaskResponse,
    responseLead: 'HTTP 202 只表示平台已受理，不表示百应已经开始呼叫。',
    rules: [...requestRules, ['任务命名', '北京时间日期 + 真实数据分类 + 当日五位序号，例如 20260907排挡百天SS1-00023。'], ['异步失败', '百应创建、导入或启动失败后仍保留任务数据，并通过失败事件和任务查询返回可读原因。']],
    errors: commonErrors,
  }),
  platformDoc({
    id: 'get-outbound-task', method: 'GET', title: '查询外呼任务详情', path: '/openapi/v1/outbound/tasks/{taskNo}',
    summary: '查询任务配置快照、百应任务 ID、执行状态、导入统计、计费、录音和回传状态。',
    params: [...requestHeaders, ['taskNo', 'Path · string', '是', '平台任务编号，例如 PT-20260907-00023']],
    response: `{
  "code": "OK",
  "message": "success",
  "requestId": "request-id",
  "data": {
    "taskNo": "PT-20260907-00023",
    "taskName": "20260907排挡百天SS1-00023",
    "sourceSystem": "ERP",
    "mcCode": "MC-ZTY-001",
    "baiyingCallJobId": "241491320",
    "statuses": {
      "execution": "CALLING",
      "display": "呼叫中",
      "resultDelivery": "PENDING",
      "recordingArchive": "PENDING",
      "recordingDelivery": "PENDING",
      "billing": "RESERVED"
    },
    "failure": null
  }
}`,
    rules: [...requestRules, ['展示状态', '业务状态固定为执行中、呼叫中、执行完成、执行失败；内部状态保留精细编排阶段。']],
    errors: commonErrors.filter(([code]) => ['401', '404', '429'].includes(code)),
  }),
  platformDoc({
    id: 'list-outbound-calls', method: 'GET', title: '查询任务通话明细', path: '/openapi/v1/outbound/tasks/{taskNo}/calls',
    summary: '用不透明游标分页查询脱敏通话结果、计费分钟和录音归档状态。',
    params: [...requestHeaders, ['taskNo', 'Path · string', '是', '平台任务编号'], ['cursor', 'Query · string', '否', '上一页返回的不透明游标，只能原样带回'], ['limit', 'Query · integer', '否', '1～500，默认 200']],
    response: `{
  "code": "OK",
  "message": "success",
  "requestId": "request-id",
  "data": {
    "items": [{
      "platformCallId": "22222222-2222-4222-8222-222222222222",
      "externalCustomerId": "ERP-C-10001",
      "phoneMasked": "138****0000",
      "callStatus": "ANSWERED",
      "durationSeconds": 24,
      "billingMinutes": 1,
      "customerCharge": "0.480000"
    }],
    "nextCursor": null
  }
}`,
    rules: [...requestRules, ['隐私保护', '只返回脱敏手机号；完整手机号和原始百应回调不通过查询接口下发。']],
    errors: commonErrors.filter(([code]) => ['401', '404', '429'].includes(code)),
  }),
  platformDoc({
    id: 'get-outbound-call', method: 'GET', title: '查询单条通话明细', path: '/openapi/v1/outbound/tasks/{taskNo}/calls/{callId}',
    summary: '按平台通话 ID 查询一次呼叫的结果、采集字段、计费和录音状态。',
    params: [...requestHeaders, ['taskNo', 'Path · string', '是', '平台任务编号'], ['callId', 'Path · uuid', '是', '平台通话 ID，不是百应 callInstanceId']],
    response: `{
  "code": "OK",
  "message": "success",
  "requestId": "request-id",
  "data": {
    "platformCallId": "22222222-2222-4222-8222-222222222222",
    "externalCustomerId": "ERP-C-10001",
    "baiyingCallInstanceId": "70258002706",
    "phoneMasked": "138****0000",
    "callStatus": "ANSWERED",
    "durationSeconds": 24,
    "billingMinutes": 1,
    "customerCharge": "0.480000",
    "collectProperties": { "intent_level": "A" },
    "recording": { "status": "ARCHIVED", "recordingId": "33333333-3333-4333-8333-333333333333" }
  }
}`,
    rules: [...requestRules, ['计费分钟', '逐通话按 ceil(durationSeconds / 60) 计算；0 秒计 0 分钟，1～59 秒计 1 分钟。']],
    errors: commonErrors.filter(([code]) => ['401', '404', '429'].includes(code)),
  }),
  platformDoc({
    id: 'command-outbound-task', method: 'POST', title: '控制外呼任务', path: '/openapi/v1/outbound/tasks/{taskNo}/commands',
    summary: '异步提交启动、恢复、暂停或终止命令；最终结果以百应响应、状态回调或补偿查询为准。',
    params: [...requestHeaders, idempotency, ['taskNo', 'Path · string', '是', '平台任务编号'], ['command', 'Body · enum', '是', 'START、RESUME、PAUSE 或 TERMINATE'], ['reason', 'Body · string', '是', '操作原因，1～500 字符']],
    request: `{ "command": "PAUSE", "reason": "运营暂停核对名单" }`,
    response: `{
  "code": "COMMAND_ACCEPTED",
  "message": "任务命令已受理",
  "requestId": "request-id",
  "data": {
    "operationId": "44444444-4444-4444-8444-444444444444",
    "taskNo": "PT-20260907-00023",
    "command": "PAUSE",
    "operationStatus": "PENDING",
    "acceptedAt": "2026-09-07T10:40:00+08:00"
  }
}`,
    rules: [...requestRules, ['执行语义', '返回 202 不承诺百应已完成操作；百应操作失败时任务进入执行失败并保留完整数据。']],
    errors: commonErrors,
  }),
  platformDoc({
    id: 'reissue-recording-url', method: 'POST', title: '重新签发录音地址', path: '/openapi/v1/outbound/recordings/{recordingId}/download-url',
    summary: '为已归档到私有阿里云 OSS 的录音重新签发短期下载 URL。',
    params: [...requestHeaders, idempotency, ['recordingId', 'Path · uuid', '是', '平台录音 ID']],
    response: `{
  "code": "OK",
  "message": "success",
  "requestId": "request-id",
  "data": {
    "recordingId": "33333333-3333-4333-8333-333333333333",
    "downloadUrl": "https://oss.example.invalid/recording?signature=redacted",
    "expiresAt": "2026-09-07T10:46:00+08:00",
    "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }
}`,
    rules: [...requestRules, ['URL 安全', 'URL 默认 15 分钟有效，不得写入普通日志；过期后使用新的幂等键再次签发。']],
    errors: commonErrors,
  }),
  platformDoc({
    id: 'get-studio-balance', method: 'GET', title: '查询影楼余额', path: '/openapi/v1/studios/{mcCode}/balance',
    summary: '查询影楼账户账面余额、活动冻结、可用余额和账户状态。',
    params: [...requestHeaders, ['mcCode', 'Path · string', '是', '客户端获授权访问的影楼 MC code']],
    response: `{
  "code": "OK",
  "message": "success",
  "requestId": "request-id",
  "data": {
    "mcCode": "MC-ZTY-001",
    "currency": "CNY",
    "balance": "13277.480000",
    "activeHoldAmount": "0.960000",
    "availableBalance": "13276.520000",
    "accountStatus": "ACTIVE",
    "updatedAt": "2026-09-07T10:40:00+08:00"
  }
}`,
    rules: [...requestRules, ['金额类型', '金额使用最多 6 位小数的十进制字符串，禁止使用 JSON number。']],
    errors: commonErrors.filter(([code]) => ['401', '404', '429'].includes(code)),
  }),
  platformDoc({
    id: 'list-studio-ledger', method: 'GET', title: '查询影楼账户流水', path: '/openapi/v1/studios/{mcCode}/ledger',
    summary: '倒序分页查询充值、冻结、扣费、释放、退款和人工调整的不可变账本流水。',
    params: [...requestHeaders, ['mcCode', 'Path · string', '是', '客户端获授权访问的影楼 MC code'], ['cursor', 'Query · string', '否', '上一页返回的不透明游标'], ['limit', 'Query · integer', '否', '1～500，默认 100']],
    response: `{
  "code": "OK",
  "message": "success",
  "requestId": "request-id",
  "data": {
    "items": [{
      "occurredAt": "2026-09-07T10:35:00+08:00",
      "type": "CALL_CHARGE",
      "amount": "-0.480000",
      "balanceAfter": "13277.480000",
      "taskNo": "PT-20260907-00023",
      "businessKey": "CALL_CHARGE:22222222"
    }],
    "nextCursor": null
  }
}`,
    rules: [...requestRules, ['不可变账本', '流水不得覆盖或删除；退款和人工调整使用新的反向流水表达。']],
    errors: commonErrors.filter(([code]) => ['401', '404', '429'].includes(code)),
  }),
  {
    id: 'result-callback', group: '平台回传 ERP / CRM', direction: '平台 → ERP / CRM', method: 'POST', title: '业务结果回传', path: '{studio.resultCallbackUrl}',
    summary: '投递启动成功、启动失败、分批通话结果和完成摘要；地址按影楼、来源系统分别配置。',
    status: '外部接收方实现', caller: '百应外呼调度台', receiver: 'ERP / CRM', contentType: 'application/json;charset=utf-8', auth: 'X-Signature 回调签名 + eventId 幂等', host: 'configured',
    params: [...callbackHeaders,
      ['occurredAt', 'Body · date-time', '是', '事件发生时间，ISO 8601 且带时区'],
      ['eventType', 'Body · enum', '是', 'OUTBOUND_TASK_STARTED、OUTBOUND_TASK_START_FAILED、OUTBOUND_CALL_RESULT_BATCH 或 OUTBOUND_TASK_COMPLETED'],
      ['executionStatus', 'Body · enum', '启动/完成事件', 'CALLING、CREATE_FAILED、IMPORT_FAILED、START_FAILED 或 COMPLETED'],
      ['failure', 'Body · object', '失败事件', '失败阶段、错误码、用户可读原因、是否可重试和发生时间'],
      ['batchNo / isLastBatch', 'Body · integer / boolean', '通话批次', '通话结果批次号和最后一批标记'],
      ['calls', 'Body · array', '通话批次', '最多 200 条；包含客户关联号、脱敏号码、通话状态、时长、计费和采集字段'],
      ['summary', 'Body · object', '完成事件', '号码、接听、时长、计费、客户话费和录音归档汇总'],
    ],
    request: resultEvent, response: callbackAck,
    responseLead: 'ERP/CRM 应在原始事件可靠落库后立即返回任意 2xx；双方联调统一返回以下 JSON。',
    rules: [['验签原文', 'POST、回调 path、时间戳、事件 ID、原始 Body SHA-256 依次用换行连接。'], ['幂等与乱序', '以 eventId 唯一落库；重复事件仍返回成功，完成事件可能早于录音事件。'], ['重试', '网络错误、408、429、5xx 按 1 分钟至 8 小时退避重试；其他 4xx 进入死信。'], ['配置位置', '在影楼新增/编辑弹窗配置 ERP/CRM 结果地址；HMAC/KMS 未配置前保持 DRAFT，不会真实投递。']],
  },
  {
    id: 'recording-callback', group: '平台回传 ERP / CRM', direction: '平台 → ERP / CRM', method: 'POST', title: '录音可下载回传', path: '{studio.recordingCallbackUrl}',
    summary: '百应录音归档到私有 OSS 后，按最多 100 条一批发送短期下载地址和完整性校验信息。',
    status: '外部接收方实现', caller: '百应外呼调度台', receiver: 'ERP / CRM', contentType: 'application/json;charset=utf-8', auth: 'X-Signature 回调签名 + eventId 幂等', host: 'configured',
    params: [...callbackHeaders, ['eventType', 'Body · string', '是', '固定为 OUTBOUND_RECORDING_AVAILABLE_BATCH'], ['batchNo', 'Body · integer', '是', '批次号，从 1 开始'], ['isLastBatch', 'Body · boolean', '是', '是否最后一批'], ['recordings', 'Body · array', '是', '1～100 条录音'], ['recordings[].platformCallId', 'Body · uuid', '是', '平台通话 ID'], ['recordings[].baiyingCallInstanceId', 'Body · string', '是', '百应通话 ID'], ['recordings[].kind', 'Body · enum', '是', 'FULL 或 USER_ONLY'], ['recordings[].sha256', 'Body · string', '是', '文件 SHA-256 小写十六进制值'], ['recordings[].downloadUrl', 'Body · https URL', '是', '私有 OSS 短期下载地址'], ['recordings[].expiresAt', 'Body · date-time', '是', '下载地址失效时间']],
    request: recordingEvent, response: callbackAck,
    responseLead: '接收方应在 expiresAt 前下载，并以 sha256 校验文件完整性。',
    rules: [['验签与幂等', '与业务结果回传使用相同算法；以 eventId 唯一落库，重复事件返回成功。'], ['录音安全', 'downloadUrl 是私有 OSS 短期 URL，不是百应临时地址；禁止写入日志、监控或工单。'], ['重新签发', 'URL 过期后调用平台重新签发接口，不要继续重试旧 URL。'], ['配置位置', '在影楼新增/编辑弹窗分别配置 ERP/CRM 录音回传地址。']],
  },
  baiyingDoc({
    id: 'baiying-oauth-token', method: 'POST', title: '获取百应 Access Token', path: 'https://open-tcs.byai.com/oauth/token',
    summary: '用 appKey、appSecret 和 companyId 换取短期令牌；平台提前 5 分钟刷新。', status: '已接入',
    params: [['client_id', 'Form · string', '是', '百应应用 appKey'], ['client_secret', 'Form · string', '是', '百应应用密钥，只存放在 KMS/环境密文'], ['company_id', 'Form · string', '是', '百应公司 ID']],
    request: 'client_id=app-key&client_secret=***&company_id=12345',
    response: `{ "code": 200, "data": { "access_token": "***", "expires_in": 7200, "expires_at": 1788772800000 } }`,
    rules: [['密钥安全', 'appSecret 与 accessToken 不进入前端、不写普通日志。'], ['缓存策略', '复用未过期 Token；距过期不足 5 分钟时主动刷新。']],
    sourceUrl: 'https://open.byai.com/v2/auth.html', sourceLabel: '百应 OAuth 文档',
  }),
  baiyingDoc({id:'baiying-company-list',method:'POST',title:'查询百应公司列表',path:'/api/oauth/byai.openapi.company/1.0.0/list',summary:'校验 Token 可访问的百应公司并解析 companyId。',status:'已接入',params:[['accessToken','Form · string','是','百应 OAuth Token']],response:`{ "code": 200, "data": [{ "companyId": 12345, "companyName": "示例公司" }], "resultMsg": "successful" }`,rules:[['使用场景','连接检查与资源同步前校验，不向运营前端透传 Token。']],sourceUrl:'https://open.byai.com/',sourceLabel:'百应开放平台'}),
  baiyingDoc({id:'baiying-robot-list',method:'POST',title:'查询百应话术列表',path:'/api/oauth/byai.openapi.robot/1.0.0/list',summary:'同步话术及发布状态，用于话术绑定和变量巡检。',status:'已接入',params:[['accessToken','Form · string','是','百应 OAuth Token'],['companyId','Form · string','是','百应公司 ID'],['robotStatus','Form · integer','否','0 全部、1 已上线、2 发布过']],response:`{ "code": 200, "data": [{ "robotDefId": 286485, "robotName": "百天邀约", "robotStatus": 2 }], "resultMsg": "successful" }`,rules:[['同步口径','新任务只使用已发布且当前有效的话术。']],sourceUrl:'https://open.byai.com/',sourceLabel:'百应开放平台'}),
  baiyingDoc({id:'baiying-phone-list',method:'POST',title:'查询百应线路列表',path:'/api/oauth/byai.openapi.phone/1.0.0/list',summary:'实时读取外呼线路、费率类型和线路余额，用于线路管理。',status:'已接入',params:[['accessToken','Form · string','是','百应 OAuth Token'],['companyId','Form · string','是','百应公司 ID'],['userPhoneId','Form · string','否','指定线路 ID']],response:`{ "code": 200, "data": [{ "userPhoneId": 45678, "phoneName": "华东主线路", "lineAmount": 200 }], "resultMsg": "successful" }`,rules:[['实时数据','接口失败时显示不可用状态，不使用伪造线路兜底。']],sourceUrl:'https://open.byai.com/',sourceLabel:'百应开放平台'}),
  baiyingDoc({id:'baiying-communication-balance',method:'POST',title:'查询百应通信余额',path:'/api/oauth/byai.openapi.company.communication/1.0.0/balance',summary:'查询百应公司的线路通信余额。',status:'已接入',params:[['accessToken','Form · string','是','百应 OAuth Token'],['companyId','Form · string','是','百应公司 ID']],response:`{ "code": 200, "data": { "amount": 1200.5 }, "resultMsg": "successful" }`,rules:[['数据边界','仅用于供应商监控，不参与影楼客户余额账本。']],sourceUrl:'https://open.byai.com/',sourceLabel:'百应开放平台'}),
  baiyingDoc({id:'baiying-ai-balance',method:'POST',title:'查询百应 AI 账户余额',path:'/api/oauth/byai.openapi.company.ai/1.0.0/balance',summary:'查询 AI 账户剩余金额、单价和可用次数。',status:'已接入',params:[['accessToken','Form · string','是','百应 OAuth Token'],['companyId','Form · string','是','百应公司 ID']],response:`{ "code": 200, "data": { "amount": 580, "price": "0.20", "num": 2900 }, "resultMsg": "successful" }`,rules:[['数据边界','供应商余额与平台影楼余额相互独立。']],sourceUrl:'https://open.byai.com/',sourceLabel:'百应开放平台'}),
  baiyingDoc({id:'baiying-seat-overview',method:'POST',title:'查询百应坐席概况',path:'/api/oauth/byai.openapi.seatinfo/1.0.0/get',summary:'查询公司已用与总 AI 外呼坐席。',status:'已接入',params:[['accessToken','Form · string','是','百应 OAuth Token'],['companyId','Form · string','是','百应公司 ID']],response:`{ "code": 200, "data": { "companyUsingCallSeat": 2, "companyAllCallSeat": 10 }, "resultMsg": "successful" }`,rules:[['监控用途','只读查询，失败不会修改任务或本地配置。']],sourceUrl:'https://open.byai.com/',sourceLabel:'百应开放平台'}),
  baiyingDoc({id:'baiying-scene-variables',method:'POST',title:'查询百应话术变量',path:'/api/oauth/byai.openapi.company.scenevariables/1.0.0/get',summary:'获取已发布话术变量，用于字段映射巡检。',status:'已接入',params:[['accessToken','Form · string','是','百应 OAuth Token'],['companyId','Form · string','是','百应公司 ID'],['robotDefId','Form · string','是','百应话术 ID'],['hideDefaultVar','Form · boolean','是','固定 true，只同步自定义变量']],response:`{ "code": 200, "data": { "variables": ["客户姓名", "婚期"] }, "resultMsg": "successful" }`,rules:[['映射门禁','变量必须来自最近成功快照，运营不能手工创造变量名。']],sourceUrl:'https://open.byai.com/',sourceLabel:'百应开放平台'}),
  baiyingDoc({id:'baiying-workflow-list',method:'POST',title:'查询百应复杂任务列表',path:'/api/oauth/byai.sop.workflow.list.page/1.0.0/search',summary:'分页读取百应复杂任务并合并平台数据分类绑定。',status:'已接入',params:[['accessToken','Form · string','是','百应 OAuth Token'],['workflowExecuteStatus','Form · enum','否','ALL、DRAFT、UNSTART、START、FINISH、PAUSE'],['pageNum / pageSize','Form · integer','否','默认 0 / 20'],['name / workflowId','Form · string','否','名称或任务 ID 过滤']],response:`{ "code": 200, "data": { "total": 1, "pages": 1, "list": [{ "id": 38028, "name": "百天邀约", "workflowExecuteStatus": "START" }] }, "resultMsg": "successful" }`,rules:[['实时读取','计划任务页面以百应返回为准，本地只保存分类绑定。']],sourceUrl:'https://open.byai.com/',sourceLabel:'百应开放平台'}),
  baiyingDoc({id:'baiying-create-calljob',method:'POST',title:'创建百应 AI 外呼任务',path:'/api/oauth/byai.openapi.calljob/1.0.0/create',summary:'异步编排第一步：为一个平台任务创建唯一百应 callJobId。',status:'待接真实客户端',params:[['accessToken','Form · string','是','百应 OAuth Token'],['callJobName','Form · string','是','平台生成的确定性名称'],['callJobType','Form · integer','是','固定为 1'],['companyId','Form · string','是','百应公司 ID'],['robotDefId','Form · string','是','任务话术快照'],['userPhoneIds','Form · array','是','任务线路快照']],request:'accessToken=***&callJobName=PT-20260907-00023-a1b2c3d4&callJobType=1&companyId=12345&robotDefId=286485&userPhoneIds=45678',response:`{ "code": 200, "data": { "callJobId": 241491320 }, "resultMsg": "successful" }`,rules:[['未知结果恢复','请求超时后禁止直接重建；先按确定性名称查询，确认不存在才允许重试。'],['失败处理','明确失败后进入执行失败，释放冻结金额并回传可读原因。']],sourceUrl:'https://open.byai.com/v2/operations/calljob-create.html',sourceLabel:'百应创建任务文档'}),
  baiyingDoc({id:'baiying-search-calljob',method:'POST',title:'查询百应外呼任务',path:'/api/oauth/byai.openapi.calljob/1.0.0/list',summary:'按确定性名称查询任务，用于创建响应丢失后的补偿确认。',status:'待接真实客户端',params:[['accessToken','Form · string','是','百应 OAuth Token'],['companyId','Form · string','是','百应公司 ID'],['callJobName','Form · string','否','确定性任务名称'],['pageNum / pageSize','Form · integer','否','分页参数']],response:`{ "code": 200, "data": { "list": [{ "callJobId": 241491320, "callJobName": "PT-20260907-00023-a1b2c3d4" }] }, "resultMsg": "successful" }`,rules:[['唯一性门禁','唯一命中才补写 callJobId；同名多条必须转人工。']],sourceUrl:'https://open.byai.com/v2/operations/calljob-list.html',sourceLabel:'百应任务列表文档'}),
  baiyingDoc({id:'baiying-import-customers',method:'POST',title:'导入号码到百应任务',path:'/api/oauth/byai.openapi.calljob.customer/1.0.0/import',summary:'把已校验并完成字段映射的客户名单导入唯一百应任务。',status:'待接真实客户端',params:[['accessToken','Form · string','是','百应 OAuth Token'],['callJobId','Form · string','是','百应任务 ID'],['companyId','Form · string','是','百应公司 ID'],['customerInfoVOList','Form · JSON array','是','客户、号码和 properties，最多 10,000 条'],['permitrepeatnum','Form · boolean','是','固定 false']],request:'callJobId=241491320&companyId=12345&permitrepeatnum=false&customerInfoVOList=[{"name":"王女士","phone":"13800000000","properties":{"sx_platform_item_id":"item-uuid"}}]&accessToken=***',response:`{ "code": 200, "data": { "total": 1, "successNum": 1, "placeFailNum": 0, "repeatNum": 0 }, "resultMsg": "successful" }`,rules:[['全量成功','successNum 等于客户数且失败、重复均为 0；部分成功按整个任务失败处理。'],['失败清理','不启动任务，尝试终止百应任务、释放冻结金额并保留失败明细。']],sourceUrl:'https://open.byai.com/v2/operations/calljob-customer-import.html',sourceLabel:'百应导入客户文档'}),
  baiyingDoc({id:'baiying-execute-calljob',method:'POST',title:'启动 / 暂停 / 终止百应任务',path:'/api/oauth/byai.openapi.calljob/1.0.0/execute',summary:'执行百应任务控制命令，确认成功后推进平台状态。',status:'待接真实客户端',params:[['accessToken','Form · string','是','百应 OAuth Token'],['callJobId','Form · string','是','百应任务 ID'],['companyId','Form · string','是','百应公司 ID'],['command','Form · integer','是','1 启动/恢复、2 暂停、3 终止']],request:'accessToken=***&callJobId=241491320&companyId=12345&command=1',response:baiyingOk,rules:[['成功判断','同时满足 code=200 与 resultMsg=successful 才算成功。'],['失败状态','启动、暂停或终止任一操作失败，平台进入执行失败并回传用户可读原因。']],sourceUrl:'https://open.byai.com/v2/operations/calljob-execute.html',sourceLabel:'百应任务控制文档'}),
  {
    id: 'baiying-callback', group: '百应回调平台', direction: '百应 → 平台', method: 'POST', title: '百应任务与通话回调', path: '/api/v1/callbacks/baiying',
    summary: '统一接收 CALL_INSTANCE_RESULT 与 JOB_INFO_RESULT；原文可靠落库后立即 ACK，后续处理全部异步。',
    status: '已实现', caller: '百应开放平台', receiver: '百应外呼调度台', contentType: 'application/json;charset=utf-8', auth: '生产由阿里云 WAF/ALB 限制百应官方来源 IP', host: 'platform',
    params: [['code','Body · number','是','百应响应码'],['data.callbackType','Body · enum','是','CALL_INSTANCE_RESULT 或 JOB_INFO_RESULT'],['data.data.callInstance.companyId','Body · number|string','通话回调','百应公司 ID'],['data.data.callInstance.callJobId','Body · number|string','通话回调','百应任务 ID'],['data.data.callInstance.callInstanceId','Body · number|string','通话回调','百应通话 ID'],['data.data.callInstance.callInstanceStatus','Body · number','否','完成回调固定为 2'],['data.data.callInstance.finishStatus','Body · number','通话回调','通话结果：0 接听、1 拒接、6 占线，其余按百应状态映射'],['data.data.callInstance.calledTimes','Body · number','否','累计拨打次数'],['data.data.callInstance.customerTelephone','Body · string','否','客户号码，仅在受限后端处理'],['data.data.callInstance.duration','Body · number','否','通话时长秒数，缺省按 0'],['data.data.callInstance.startTime / endTime','Body · string|number','否','百应拨打与结束时间'],['data.data.callInstance.luyinOssUrl','Body · string','否','完整录音临时地址'],['data.data.callInstance.userLuyinOssUrl','Body · string','否','仅被叫侧录音临时地址'],['data.data.callInstance.properties','Body · object|string','否','话术变量与 sx_platform_item_id'],['data.data.taskResult','Body · array','否','百应采集结果，合并到平台 collectProperties'],['data.data.companyId','Body · number|string','任务回调','百应公司 ID'],['data.data.callJobId','Body · number|string','任务回调','百应任务 ID'],['data.data.callJobStatus','Body · number','任务回调','百应任务状态'],['data.data.updateTime / endTime','Body · string|number','否','任务状态发生时间'],['resultMsg','Body · string','否','百应响应内容']],
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
    responseLead: '兼容旧地址 /api/v1/callbacks/baiying/call-instance；重复报文同样返回成功。',
    rules: [['幂等处理', '按业务键和原文哈希去重，避免重试造成重复通话、计费或回传。'], ['计费分钟', '逐通话按 ceil(duration / 60) 计算后汇总。'], ['录音归档', '百应临时录音及时下载到私有 OSS，再向 ERP/CRM 提供短期地址。'], ['失败重试', '未返回规定成功内容时，百应最多重试 15 次。']],
    errors: [['400','HTTP','否','JSON 或最小路由字段不合法'],['413','HTTP','否','正文超过平台限制'],['415','HTTP','否','Content-Type 不是 application/json'],['503','HTTP','否','Inbox 暂不可用，百应应重试']],
    sourceUrl: 'https://open.byai.com/v2/event-callbacks/call-instance.html', sourceLabel: '百应回调原始文档',
  },
];

const groups = [...new Set(apiDocs.map((doc) => doc.group))];

function endpointFor(doc: ApiDoc) {
  if (doc.path.startsWith('http')) return doc.path;
  if (doc.host === 'baiying') return `${baiyingBaseUrl}${doc.path}`;
  if (doc.host === 'configured') return doc.path;
  return `${platformBaseUrl}${doc.path}`;
}

function CopyButton({ value, label = '复制' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  return <button type="button" className="api-copy-button" onClick={() => void copy()}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? '已复制' : label}</button>;
}

function ParameterTable({ rows, firstColumn = '参数名' }: { rows: Row[]; firstColumn?: string }) {
  return <div className="api-parameter-table"><table><thead><tr><th>{firstColumn}</th><th>位置 / 类型</th><th>必传</th><th>说明</th></tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={`${row[0]}-${rowIndex}`}>{row.map((cell, index) => <td key={`${row[0]}-${index}`}>{index === 0 ? <code>{cell}</code> : cell}</td>)}</tr>)}</tbody></table></div>;
}

export function ApiDocumentation({ publicView = false }: { publicView?: boolean }) {
  const [activeId, setActiveId] = useState('create-outbound-task');
  useEffect(() => {
    const selected = new URLSearchParams(window.location.search).get('api');
    if (!selected || !apiDocs.some((doc) => doc.id === selected)) return;
    const timer = window.setTimeout(() => setActiveId(selected), 0);
    return () => window.clearTimeout(timer);
  }, []);
  const active = useMemo(() => apiDocs.find((doc) => doc.id === activeId) ?? apiDocs[0], [activeId]);
  const endpoint = endpointFor(active);
  const shareUrl = typeof window === 'undefined' ? `/api-docs?api=${active.id}` : `${window.location.origin}/api-docs?api=${active.id}`;

  const select = (doc: ApiDoc) => {
    setActiveId(doc.id);
    const url = new URL(window.location.href);
    url.searchParams.set('api', doc.id);
    window.history.replaceState({}, '', url);
  };

  return <div className={publicView ? 'api-docs-page api-docs-public' : 'api-docs-page'}>
    <header className="api-docs-header">
      <div><span>{publicView ? 'PUBLIC API DOCUMENTATION' : 'API INTEGRATION'}</span><h2>API 接口文档</h2><p>ERP、CRM、百应与调度平台之间的地址、鉴权、字段、示例、错误码和处理规则。</p></div>
      <CopyButton value={shareUrl} label="复制当前接口链接" />
    </header>
    <div className="api-docs-workspace">
      <aside className="api-catalog" aria-label="接口目录">
        <header><span>接口目录</span><small>{apiDocs.length} 个接口</small></header>
        <div className="api-catalog-list">
          {groups.map((group) => <section className="api-catalog-group" key={group}><h3>{group}<small>{apiDocs.filter((doc) => doc.group === group).length}</small></h3>
            {apiDocs.filter((doc) => doc.group === group).map((doc) => <button key={doc.id} type="button" className={`api-catalog-card${doc.id === active.id ? ' is-active' : ''}`} onClick={() => select(doc)}><span><b data-method={doc.method}>{doc.method}</b><i>{doc.direction}</i></span><strong>{doc.title}</strong><code>{doc.path}</code><small>{doc.summary}</small></button>)}
          </section>)}
        </div>
      </aside>
      <article className="api-reference" key={active.id}>
        <section className="api-reference-hero"><div><span className="api-method" data-method={active.method}>{active.method}</span><span className={`api-state${active.status !== '已实现' && active.status !== '已接入' ? ' is-pending' : ''}`}>{active.status}</span><span className="api-direction">{active.direction}</span><h1>{active.title}</h1><p>{active.summary}</p></div>{active.sourceUrl ? <a href={active.sourceUrl} target="_blank" rel="noreferrer">{active.sourceLabel ?? '原始文档'} <ExternalLink size={12} /></a> : <span className="api-contract-source">契约版本 1.0</span>}</section>
        <section className="api-reference-section"><h3>请求地址</h3><div className="api-endpoint"><span data-method={active.method}>{active.method}</span><code>{endpoint}</code><CopyButton value={endpoint} /></div><div className="api-callouts"><p><b>Content-Type</b><code>{active.contentType}</code></p><p><b>认证</b><span>{active.auth}</span></p><p><b>调用方 / 接收方</b><span>{active.caller} → {active.receiver}</span></p></div></section>
        <section className="api-reference-section"><h3>请求参数</h3><p className="api-section-lead">字段名称、位置、类型和必传规则以当前契约为准。</p><ParameterTable rows={active.params} /></section>
        {active.request ? <section className="api-reference-section"><div className="api-section-title"><h3>请求示例</h3><CopyButton value={active.request} /></div><pre className="api-code-block"><code>{active.request}</code></pre></section> : null}
        <section className="api-reference-section"><div className="api-section-title"><h3>成功响应</h3><CopyButton value={active.response} /></div>{active.responseLead ? <p className="api-section-lead">{active.responseLead}</p> : null}<pre className="api-code-block"><code>{active.response}</code></pre></section>
        {active.errors?.length ? <section className="api-reference-section"><h3>错误码与处理</h3><p className="api-section-lead">HTTP 状态码表示传输结果，业务原因以响应体 code 和 message 为准。</p><ParameterTable rows={active.errors} firstColumn="状态码" /></section> : null}
        <section className="api-reference-section"><h3>处理规则</h3><div className="api-rule-grid">{active.rules.map(([title, description]) => <article key={title}><b>{title}</b><p>{description}</p></article>)}</div></section>
      </article>
    </div>
    {publicView ? <footer className="api-public-footer"><Share2 size={13} />公开链接只展示接口契约，不包含运营后台入口、凭证或业务数据。</footer> : null}
  </div>;
}

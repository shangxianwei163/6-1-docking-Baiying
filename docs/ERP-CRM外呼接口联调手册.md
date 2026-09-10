# ERP / CRM 外呼接口联调手册

> 契约版本：2.0.0
> 文档日期：2026-09-10
> 适用系统：ERP、CRM 及百应外呼调度平台
> 生产地址：`https://scheduling.paiyide.cc`

## 1. 接口清单

| 方向           | 方法与地址                                   | 用途                             |
| -------------- | -------------------------------------------- | -------------------------------- |
| ERP/CRM → 平台 | `POST /openapi/v2/outbound/tasks`            | 新增一个外呼业务批次             |
| ERP/CRM → 平台 | `GET /openapi/v2/outbound/batches/{batchId}` | 查询批次及执行任务状态           |
| 平台 → ERP/CRM | 运营端配置的结果回传地址                     | 每个 `guid` 回传一次最终业务结果 |
| 平台 → ERP/CRM | 运营端配置的录音回传地址                     | 录音归档后回传下载信息           |

新增接入只使用本手册中的接口和字段，不使用其他历史请求结构。

## 2. 整体流转

1. ERP/CRM 每次发起外呼时，为每个号码生成新的 `guid`。
2. ERP/CRM 把一级分类、二级分类和按三级分类分组的客户列表一次提交给平台。
3. 平台校验请求 Token、影楼、分类、话术、线路、变量映射、价格和余额。
4. 平台生成一个 `batch_id`，再按实际命中的话术、线路和场景拆成 1～N 个执行任务。
5. 每个执行任务对应一个百应任务。所有百应任务创建并完成号码导入后，平台才统一放行启动。
6. 百应回调后，平台使用内部关联令牌和号码摘要双重核验，定位本次发起对应的 `guid`。
7. 平台把每个 `guid` 的最终结果可靠投递到原 ERP 或 CRM。
8. 有录音时，平台完成归档后再向录音地址投递下载信息。

不同 `c_level` 不一定产生不同百应任务：只有实际命中的话术、线路、场景或映射版本不同才拆分；实际路由相同则合并为一个任务。

## 3. 身份认证

平台为 ERP 和 CRM 分别提供：

- 固定请求 Token
- 允许访问的 MC code
- 结果回传地址和录音回传地址
- 回调验签密钥 `callbackSecret`

请求 Token 可直接在运营后台的影楼管理详情中查看和复制。ERP Token 只能提交 `source=0`，CRM Token 只能提交 `source=1`；调用方只能访问 Token 已授权的 `company_code`。

### 3.1 请求头

```http
X-Access-Token: erp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
X-Request-Id: 9bba018d-36b2-478d-af0a-af3f7d573937
Content-Type: application/json
```

新增批次还必须发送：

```http
Idempotency-Key: erp-call-20260909-0001
```

`X-Request-Id` 可省略，`X-Access-Token` 必须发送。ERP/CRM 不需要计算签名，也不需要生成时间戳或 Nonce。

## 4. 新增外呼批次

```http
POST /openapi/v2/outbound/tasks
```

### 4.1 请求字段

| 字段                          | 类型                       | 必传 | 说明                                     |
| ----------------------------- | -------------------------- | ---- | ---------------------------------------- |
| `main_category`               | string                     | 是   | 一级分类                                 |
| `sub_category`                | string                     | 是   | 二级分类                                 |
| `source`                      | integer                    | 是   | `0=ERP`，`1=CRM`，必须与请求 Token 一致  |
| `company_code`                | string                     | 是   | 发起影楼的 MC code                       |
| `customer_list`               | array                      | 是   | 按三级分类分组的客户列表                 |
| `customer_list[].c_level`     | string                     | 是   | 三级分类，允许空字符串                   |
| `customer_list[].c_info_list` | array                      | 是   | 当前三级分类下的号码列表                 |
| `phone`                       | string                     | 是   | 7～15 位国际号码格式；同一批次内不可重复 |
| `guid`                        | string                     | 是   | 本次发起的号码唯一值，建议使用 UUID      |
| `customer_name`               | string/null                | 否   | 客户称呼                                 |
| 其他字段                      | string/number/boolean/null | 否   | 当前号码自己的动态业务变量               |

号码对象除 `phone`、`guid` 和 `customer_name` 外，其他字段都按动态变量处理，不限定变量名称和固定数量。平台保留以下技术限制：

- 单变量名最多 128 UTF-8 字节。
- 单变量值最多 8 KiB。
- 单号码动态变量 JSON 最多 128 KiB。
- 整个请求最多 10,000 个号码、25 MiB。
- `sx_*`、`__proto__`、`constructor`、`prototype` 是平台保留名称，调用方不能使用。
- 动态变量为 `null` 时不导入百应；话术强依赖变量由平台已发布映射提供默认值。

### 4.2 请求示例

```json
{
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
          "photodate": "2026-09-20",
          "selectshop": null
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
          "自定义扩展变量": "可继续增加"
        }
      ]
    }
  ]
}
```

### 4.3 成功响应

HTTP 状态码：`202 Accepted`

```json
{
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
}
```

`202` 只表示平台已经完整受理，不表示百应已经拨号。`task_count` 可能为 1，也可能大于 1。

影楼可用余额不足时返回 `409 Conflict`，ERP/CRM 可以直接展示 `recharge_qr_code_url` 指向的图片供用户扫码充值：

```json
{
  "code": "INSUFFICIENT_BALANCE",
  "message": "影楼可用余额不足",
  "requestId": "9bba018d-36b2-478d-af0a-af3f7d573937",
  "recharge_qr_code_url": "https://scheduling.paiyide.cc/recharge/ums-recharge-qr-code.png",
  "details": {
    "availableBalance": "1.000000",
    "reservedAmount": "9.600000"
  }
}
```

### 4.4 GUID 与幂等规则

| 场景                 | 调用要求                                                                              | 平台行为                        |
| -------------------- | ------------------------------------------------------------------------------------- | ------------------------------- |
| HTTP 超时后重试      | 复用原 GUID、原 `Idempotency-Key`、原 Token 和字节完全一致的 Body                     | 返回原批次，不重复建任务        |
| 同幂等键但 Body 不同 | 禁止                                                                                  | 返回 `409 IDEMPOTENCY_CONFLICT` |
| 同一号码以后再次发起 | 使用新 GUID 和新 `Idempotency-Key`                                                    | 创建新批次，允许再次呼叫        |
| 同批次 GUID 重复     | 禁止                                                                                  | 整批返回 `422 GUID_DUPLICATED`  |
| 同批次手机号重复     | 禁止                                                                                  | 整批返回 `422 PHONE_DUPLICATED` |

平台生成 `batch_id`，ERP/CRM 不需要传业务批次号。幂等记录在批次未结束时不会过期，批次结束后至少保留 180 天。

## 5. 查询外呼批次

```http
GET /openapi/v2/outbound/batches/{batchId}
```

请求使用与新增接口相同的 `X-Access-Token`，但 GET 不需要 `Idempotency-Key`。

```json
{
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
}
```

批次状态：`ACCEPTED`、`PREPARING`、`RUNNING`、`PARTIAL_FAILED`、`COMPLETED`、`FAILED`、`CANCELLED`。

## 6. 业务结果回传

平台向影楼当前来源配置的结果地址发送 HTTP POST。地址同时支持 HTTP 和 HTTPS，可以使用非标准端口；平台不接受新增任务请求临时指定回调地址，也不跟随 HTTP 3xx 跳转。

### 6.1 请求头

```http
X-Platform-Event-Id: 22222222-2222-4222-8222-222222222222
X-Timestamp: 1788661800000
X-Signature: Base64-HMAC-SHA256-Signature
X-Contract-Version: 2.0
Content-Type: application/json
```

### 6.2 请求 Body

```json
{
  "guid": "11111111-1111-4111-8111-111111111101",
  "externalCustomerId": "11111111-1111-4111-8111-111111111101",
  "phone_masked": "135****0001",
  "call_status": "ANSWERED",
  "finish_status": 0,
  "result_complete": true,
  "collected_variables": {
    "预约门店": "湖滨店",
    "预约日期": "2026-09-20"
  },
  "task_results": [
    {
      "resultName": "客户意向等级",
      "resultValue": "A"
    }
  ]
}
```

字段说明：

| 字段                  | 类型         | 说明                                                             |
| --------------------- | ------------ | ---------------------------------------------------------------- |
| `guid`                | string       | ERP/CRM 本次发起时传入的 GUID                                    |
| `externalCustomerId`  | string       | 短期过渡字段，值与 `guid` 完全相同；新接入只读取 `guid`          |
| `phone_masked`        | string       | 脱敏号码                                                         |
| `call_status`         | enum         | `ANSWERED`、`NO_ANSWER`、`BUSY`、`REJECTED`、`FAILED`、`UNKNOWN` |
| `finish_status`       | integer/null | 百应结束状态码                                                   |
| `result_complete`     | boolean      | 是否取得完整最终结果                                             |
| `collected_variables` | object       | 仅来自百应本次通话实际采集结果                                   |
| `task_results`        | array        | 仅来自百应本次通话实际产生的任务结果                             |

每个 `guid` 只投递一个最终业务结果。Body 不包含完整手机号、呼叫前原始动态变量、批次号、任务号、百应任务 ID 或平台内部 `sx_*` 字段。

## 7. 录音回传

有录音时，平台归档完成后向影楼当前来源配置的录音地址发送 HTTP POST。没有实际拨号或百应没有生成录音时，不发送录音回调。

```json
{
  "schemaVersion": "1.0",
  "eventId": "33333333-3333-4333-8333-333333333333",
  "eventType": "OUTBOUND_RECORDING_AVAILABLE_BATCH",
  "occurredAt": "2026-09-09T10:31:00+08:00",
  "sourceSystem": "ERP",
  "mcCode": "5903679116",
  "taskNo": "PT-20260909-00025",
  "baiyingCallJobId": "279131720",
  "batchNo": 1,
  "isLastBatch": true,
  "recordings": [
    {
      "recordingId": "44444444-4444-4444-8444-444444444444",
      "platformCallId": "55555555-5555-4555-8555-555555555555",
      "baiyingCallInstanceId": "3891451944180",
      "kind": "FULL",
      "contentType": "audio/mpeg",
      "sizeBytes": 384210,
      "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "downloadUrl": "https://scheduling.paiyide.cc/api/v1/recordings/44444444-4444-4444-8444-444444444444/content?exp=1788662760&aud=...&sig=...",
      "expiresAt": "2026-09-09T10:46:00+08:00"
    }
  ]
}
```

接收方应在 `expiresAt` 前下载录音并使用 `sha256` 校验文件完整性。录音下载地址不得写入普通日志、监控告警或工单。

## 8. 回调验签与 ACK

业务结果和录音回调使用相同签名算法：

```text
POST + "\n" +
CALLBACK_PATH + "\n" +
X_TIMESTAMP + "\n" +
X_PLATFORM_EVENT_ID + "\n" +
LOWERCASE_HEX_SHA256(RAW_BODY_BYTES)
```

接收方处理顺序：

1. 校验时间戳允许范围。
2. 使用当前回调地址对应的 `callbackSecret` 校验 HMAC-SHA256 签名。
3. 以 `X-Platform-Event-Id` 唯一落库。
4. 完成原始 Body 持久化后立即返回任意 `2xx`。
5. 重复事件不重复处理业务，但仍返回成功。

联调统一 ACK：

```json
{
  "code": 200,
  "message": "success"
}
```

网络错误、`408`、`429` 和 `5xx` 会进入退避重试；其他 `4xx` 视为不可重试错误并进入人工处理。

## 9. 常见错误

| HTTP | code                                                               | 说明                                                     |
| ---- | ------------------------------------------------------------------ | -------------------------------------------------------- |
| 400  | `INVALID_REQUEST`                                                  | JSON、请求头、幂等键或字段格式不合法                     |
| 401  | `AUTHENTICATION_FAILED`                                            | `X-Access-Token` 缺失或无效                              |
| 403  | `AUTHENTICATION_FAILED`                                            | 来源与请求 Token 不一致，或当前 Token 无权访问影楼       |
| 404  | `STUDIO_NOT_FOUND` / `TASK_NOT_FOUND`                              | 影楼或批次不存在                                         |
| 409  | `IDEMPOTENCY_CONFLICT` / `INSUFFICIENT_BALANCE`                    | 幂等冲突或可用余额不足；余额不足时携带充值二维码图片链接 |
| 413  | `INVALID_REQUEST`                                                  | 请求体超过 25 MiB                                        |
| 422  | `GUID_DUPLICATED` / `PHONE_DUPLICATED` / `DATA_CATEGORY_NOT_FOUND` | 批次内 GUID 或手机号重复，或分类、话术、线路、映射未通过 |
| 503  | `SERVICE_TEMPORARILY_UNAVAILABLE`                                  | 平台或依赖暂时不可用，使用原幂等键重试                   |

错误响应示例：

```json
{
  "code": "GUID_DUPLICATED",
  "message": "同一批次内 guid 不可重复",
  "requestId": "9bba018d-36b2-478d-af0a-af3f7d573937"
}
```

## 10. 联调验收清单

- ERP 使用 `source=0`，CRM 使用 `source=1`，错误来源会被拒绝。
- `company_code` 能匹配正确影楼和对应回调地址。
- 同一路由的多个 `c_level` 合并为一个任务，不同路由自动拆成多个任务。
- 同批次重复 GUID、重复手机号都会在调用百应前整批拒绝。
- 同一次超时重试不会重复创建批次、冻结金额或导入号码。
- 同一号码在新批次中使用新 GUID 后允许再次发起。
- 不同号码的动态变量不会串号；`null` 不导入百应。
- 百应重复或乱序回调不会造成重复计费或重复结果回传。
- ERP/CRM 收到的 `guid` 与发起记录一致，且只收到脱敏号码和实际采集结果。
- 结果回调地址能够返回 `2xx`；有录音时录音地址能够下载并校验文件。

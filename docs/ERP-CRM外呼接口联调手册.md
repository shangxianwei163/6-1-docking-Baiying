# ERP / CRM 外呼接口联调手册

> 契约版本：1.0.0  
> 文档日期：2026-09-06  
> 状态：阶段 0 联调基线，待 ERP、CRM 双方签字确认  
> 机器可读契约：`outbound-contracts/openapi/openapi.yaml`

## 1. 联调目标

ERP 和 CRM 使用同一套接口创建外呼任务、查询任务及通话结果、控制任务，并查询所属影楼账户。平台异步调用百应，随后把启动结果、通话结果、录音清单和完成摘要投递到任务来源系统。

本契约固定以下语义：

- 创建成功表示平台已完成本地校验、余额冻结和任务持久化，不表示百应已经开始呼叫。
- 每个来源请求只生成一个平台任务和一个百应 `callJobId`。
- 一个请求中的所有数据分类必须解析到同一话术和同一线路，否则整个请求被拒绝。
- 百应客户导入必须全量成功才允许启动；部分成功按整个任务启动失败处理。
- 调用和回调均采用至少一次投递，双方必须实现幂等。
- 金额使用最多 6 位小数的十进制字符串；禁止使用 JSON number 传金额。

## 2. 固定容量与默认值

| 项目                  | 1.0 固定值                              |
| --------------------- | --------------------------------------- |
| 单任务客户数          | 1～10,000                               |
| 单客户 `fields` 数量  | 最多 100                                |
| `fields` 键长度       | 1～128 字符                             |
| `fields` 字符串值     | 最多 2,000 字符                         |
| 创建任务 Body         | UTF-8 编码后最多 25 MiB                 |
| 通话结果事件          | 每批最多 200 条，或最多等待 5 秒聚合    |
| 录音事件              | 每批最多 100 条                         |
| 查询通话默认/最大页数 | 200 / 500                               |
| 账本默认/最大页数     | 100 / 500                               |
| 请求时间偏差          | 最多 ±5 分钟                            |
| Nonce 防重放窗口      | 至少 10 分钟                            |
| 幂等记录保留          | 至少 7 天                               |
| 录音下载 URL          | 默认 15 分钟有效                        |
| 平台录音保存          | 默认 180 天，正式上线前由业务与法务确认 |

超过 10,000 个客户时，来源系统应按业务批次主动拆分请求，并为每批使用不同的 `externalRequestId` 与 `Idempotency-Key`。

## 3. 环境与凭证

联调开始前，平台分别向 ERP 和 CRM 提供：

| 配置             | 说明                                      |
| ---------------- | ----------------------------------------- |
| `baseUrl`        | 联调环境 API 地址                         |
| `clientId`       | 来源系统客户端 ID                         |
| `clientSecret`   | Base64 编码的 32 字节随机密钥，只展示一次 |
| `allowedMcCodes` | 当前凭证可访问的 MC code 清单             |
| 结果回调 URL     | 接收启动、失败、通话结果和完成事件        |
| 录音回调 URL     | 接收录音可下载事件                        |
| `callbackSecret` | Base64 编码的回调验签密钥，只展示一次     |

ERP 凭证只能提交 `sourceSystem=ERP`，CRM 凭证只能提交 `sourceSystem=CRM`。客户端也只能访问授权 MC code 下的数据。

## 4. 请求签名

### 4.1 请求头

所有 `/openapi/v1` 请求必须包含：

```http
X-Client-Id: erp-uat-01
X-Timestamp: 1788660000000
X-Nonce: 4164c09726074d3f9598b393250fed22
X-Signature: nZ4i...base64...
X-Request-Id: 9bba018d-36b2-478d-af0a-af3f7d573937
Content-Type: application/json
```

所有有副作用的接口还必须包含：

```http
Idempotency-Key: erp-order-batch-20260906-001
```

### 4.2 签名原文

```text
UPPERCASE_HTTP_METHOD + "\n" +
CANONICAL_TARGET + "\n" +
X_TIMESTAMP + "\n" +
X_NONCE + "\n" +
LOWERCASE_HEX_SHA256(RAW_BODY_BYTES)
```

`CANONICAL_TARGET` 的规则：

1. 只包含 URL path 与规范化 query，不包含 scheme、host、fragment。
2. 没有 query 时就是原始 path，例如 `/openapi/v1/outbound/tasks`。
3. 有 query 时，键和值先按 RFC 3986 进行百分号编码，再按编码后的键、值升序排列，保留重复键，以 `&` 连接。
4. 空 Body 的 SHA-256 固定为 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`。
5. Body Hash 基于实际发送的原始字节；平台不会重新格式化 JSON 后再验签。
6. 使用 Base64 解码后的 `clientSecret` 字节作为 HMAC-SHA256 Key，结果再做标准 Base64 编码。

例如：

```text
GET
/openapi/v1/outbound/tasks/PT-20260906-00025/calls?cursor=abc%2B123&limit=200
1788660000000
4164c09726074d3f9598b393250fed22
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

### 4.3 ERP（C#）签名示例

```csharp
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

static string Encode(string value) => Uri.EscapeDataString(value);

static string CanonicalTarget(
    string path,
    IEnumerable<KeyValuePair<string, string>> query)
{
    var encoded = query
        .Select(x => (Key: Encode(x.Key), Value: Encode(x.Value)))
        .OrderBy(x => x.Key, StringComparer.Ordinal)
        .ThenBy(x => x.Value, StringComparer.Ordinal)
        .Select(x => $"{x.Key}={x.Value}");
    var queryString = string.Join("&", encoded);
    return queryString.Length == 0 ? path : $"{path}?{queryString}";
}

static string Sign(
    string method,
    string target,
    string timestamp,
    string nonce,
    byte[] body,
    string secretBase64)
{
    var bodyHash = Convert.ToHexString(SHA256.HashData(body)).ToLowerInvariant();
    var canonical = $"{method.ToUpperInvariant()}\n{target}\n{timestamp}\n{nonce}\n{bodyHash}";
    var key = Convert.FromBase64String(secretBase64);
    return Convert.ToBase64String(HMACSHA256.HashData(key, Encoding.UTF8.GetBytes(canonical)));
}

var path = "/openapi/v1/outbound/tasks";
var target = CanonicalTarget(path, Array.Empty<KeyValuePair<string, string>>());
var body = JsonSerializer.SerializeToUtf8Bytes(requestDto);
var timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString();
var nonce = Guid.NewGuid().ToString("N");
var signature = Sign("POST", target, timestamp, nonce, body, clientSecretBase64);

using var request = new HttpRequestMessage(HttpMethod.Post, baseUrl + target);
request.Headers.Add("X-Client-Id", clientId);
request.Headers.Add("X-Timestamp", timestamp);
request.Headers.Add("X-Nonce", nonce);
request.Headers.Add("X-Signature", signature);
request.Headers.Add("X-Request-Id", Guid.NewGuid().ToString());
request.Headers.Add("Idempotency-Key", idempotencyKey);
request.Content = new ByteArrayContent(body);
request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
```

### 4.4 CRM（PHP）签名示例

```php
<?php

function canonicalTarget(string $path, array $query = []): string
{
    ksort($query, SORT_STRING);
    $queryString = http_build_query($query, '', '&', PHP_QUERY_RFC3986);
    return $queryString === '' ? $path : $path . '?' . $queryString;
}

function signRequest(
    string $method,
    string $target,
    string $timestamp,
    string $nonce,
    string $body,
    string $secretBase64
): string {
    $key = base64_decode($secretBase64, true);
    if ($key === false) {
        throw new RuntimeException('clientSecret 不是合法 Base64');
    }
    $canonical = strtoupper($method) . "\n"
        . $target . "\n"
        . $timestamp . "\n"
        . $nonce . "\n"
        . hash('sha256', $body);
    return base64_encode(hash_hmac('sha256', $canonical, $key, true));
}

$path = '/openapi/v1/outbound/tasks';
$target = canonicalTarget($path);
$body = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
$timestamp = (string) floor(microtime(true) * 1000);
$nonce = bin2hex(random_bytes(16));
$signature = signRequest('POST', $target, $timestamp, $nonce, $body, $clientSecretBase64);

$headers = [
    'Content-Type: application/json',
    'X-Client-Id: ' . $clientId,
    'X-Timestamp: ' . $timestamp,
    'X-Nonce: ' . $nonce,
    'X-Signature: ' . $signature,
    'X-Request-Id: ' . bin2hex(random_bytes(16)),
    'Idempotency-Key: ' . $idempotencyKey,
];
```

PHP 示例的 query 使用唯一键；如未来接口允许重复 query 键，调用方必须使用可保留重复键的键值对列表实现规范化。

## 5. 创建任务

```http
POST /openapi/v1/outbound/tasks
```

ERP 和 CRM 请求样例分别位于：

- `outbound-contracts/examples/erp-create-task.request.json`
- `outbound-contracts/examples/crm-create-task.request.json`

成功返回 HTTP `202 Accepted`。响应中的 `reservedAmount` 是本次冻结金额，`statusUrl` 可立即查询：

```json
{
  "code": "TASK_ACCEPTED",
  "message": "任务已受理，正在创建百应外呼任务",
  "requestId": "9bba018d-36b2-478d-af0a-af3f7d573937",
  "data": {
    "taskId": "c5f1d5e0-1c67-4d02-a7a3-58666ea55792",
    "taskNo": "PT-20260906-00025",
    "executionStatus": "ACCEPTED",
    "displayStatus": "执行中",
    "phoneCount": 1,
    "reservedAmount": "0.960000",
    "currency": "CNY",
    "statusUrl": "/openapi/v1/outbound/tasks/PT-20260906-00025"
  }
}
```

### 5.1 幂等规则

`externalRequestId` 是来源系统业务关联号；`Idempotency-Key` 是 HTTP 重试幂等键，两者不能互相替代。

| 场景                                 | 平台行为                                               |
| ------------------------------------ | ------------------------------------------------------ |
| 同客户端、同幂等键、相同原始业务报文 | 返回第一次的状态码和任务结果，不重复冻结、不重复建任务 |
| 同客户端、同幂等键、不同业务报文     | HTTP 409，`IDEMPOTENCY_CONFLICT`                       |
| 调用方超时、不确定是否受理           | 使用原幂等键和完全相同的 Body 重试                     |
| 确认要创建另一个任务                 | 使用新的 `externalRequestId` 和新的幂等键              |

平台以解析后的业务 Payload 生成稳定哈希用于幂等冲突判断；签名仍以实际发送的原始 Body 字节计算。

### 5.2 同步错误与异步失败

- 请求格式、权限、余额、分类、话术、线路或映射问题在创建请求中同步返回 `4xx`，不会创建任务。
- 返回 `202` 后发生的百应创建、导入或启动失败，通过 `OUTBOUND_TASK_START_FAILED` 事件和任务查询接口返回。
- 创建阶段失败时百应 ID 可能尚不存在，所以失败事件中的 `baiyingCallJobId` 允许为 `null`。

## 6. 查询与控制接口

| 接口                                                              | 用途                                                     |
| ----------------------------------------------------------------- | -------------------------------------------------------- |
| `GET /openapi/v1/outbound/tasks/{taskNo}`                         | 查询任务、配置快照、导入统计、五条状态线、计费与失败信息 |
| `GET /openapi/v1/outbound/tasks/{taskNo}/calls`                   | 用游标分页查询脱敏通话明细                               |
| `GET /openapi/v1/outbound/tasks/{taskNo}/calls/{callId}`          | 查询单条通话、计费和录音状态                             |
| `POST /openapi/v1/outbound/tasks/{taskNo}/commands`               | 提交 `START`、`RESUME`、`PAUSE`、`TERMINATE`             |
| `POST /openapi/v1/outbound/recordings/{recordingId}/download-url` | 重新签发短期录音 URL                                     |
| `GET /openapi/v1/studios/{mcCode}/balance`                        | 查询余额、冻结和可用余额                                 |
| `GET /openapi/v1/studios/{mcCode}/ledger`                         | 查询充值、冻结、扣费、释放、退款和调整流水               |

所有分页 `cursor` 都是不透明字符串。调用方只能原样带回，不能解析、拼接或长期缓存。

命令接口返回 `202` 和 `operationStatus=PENDING`，不承诺百应已完成该操作。调用方应等待状态回调或查询任务终态。

## 7. 平台向 ERP/CRM 投递事件

结果回调地址接收：

- `OUTBOUND_TASK_STARTED`
- `OUTBOUND_TASK_START_FAILED`
- `OUTBOUND_CALL_RESULT_BATCH`
- `OUTBOUND_TASK_COMPLETED`

录音回调地址只接收：

- `OUTBOUND_RECORDING_AVAILABLE_BATCH`

完整样例位于 `outbound-contracts/examples/*.event.json`。

### 7.1 回调签名

平台发送：

```http
X-Platform-Event-Id: 11111111-1111-4111-8111-111111111113
X-Timestamp: 1788661800000
X-Signature: 6q5h...base64...
Content-Type: application/json
```

回调签名原文：

```text
POST + "\n" +
CALLBACK_PATH + "\n" +
X_TIMESTAMP + "\n" +
X_PLATFORM_EVENT_ID + "\n" +
LOWERCASE_HEX_SHA256(RAW_BODY_BYTES)
```

使用 Base64 解码后的 `callbackSecret` 作为 HMAC Key。接收方应先验证：时间偏差、Header 事件 ID 与 Body `eventId` 相等、HMAC 使用常量时间比较；再以 `eventId` 唯一落库，最后 ACK。

### 7.2 ACK 与幂等

标准 ACK：

```http
HTTP/1.1 200 OK
Content-Type: application/json

{"code":200,"message":"success"}
```

平台把任意 HTTP `2xx` 视为成功，但双方联调测试统一使用上述 JSON。重复事件必须返回同样的成功响应，不能因为数据库唯一键冲突返回 `409`。

接收方应按如下顺序处理：

1. 保留原始 Body 字节并验签。
2. 开启本地数据库事务。
3. 以 `eventId` 插入 Inbox；已存在时直接标记为重复。
4. 原始事件可靠落库后提交事务。
5. 返回 ACK。
6. 在接收方自己的异步任务中更新业务数据，不要在 HTTP 回调链路做耗时操作。

事件可能重复或乱序。`OUTBOUND_TASK_COMPLETED` 表示通话结果已完成对账，不表示录音回传已经完成；录音事件可以稍后到达。

### 7.3 事件重试

非 `2xx`、网络错误和超时按以下节奏重试：

```text
1 分钟 → 5 分钟 → 15 分钟 → 30 分钟 → 1 小时 → 2 小时 → 4 小时 → 8 小时
```

重试沿用原 `eventId` 和原 Body。`408`、`429`、`5xx` 默认可重试；其他 `4xx` 默认进入死信并触发人工处理。

## 8. 录音下载

平台回调提供的 `downloadUrl` 指向私有阿里云 OSS 对象的短期签名 URL，不是百应临时地址。调用方应：

1. 在 `expiresAt` 前下载，不在日志、监控或工单中记录完整 URL。
2. 下载后计算 SHA-256，并与事件中的 `sha256` 小写十六进制值比较。
3. URL 过期或即将过期时，调用重新签发接口；不要直接重试旧 URL。
4. 以 `recordingId` 幂等保存文件，避免重复事件产生重复附件。

## 9. 重试决策

| 结果                       | 调用方动作                              |
| -------------------------- | --------------------------------------- |
| `202` / `200`              | 保存响应，等待回调或按 `statusUrl` 查询 |
| 网络断开/超时              | 原 `Idempotency-Key`、原业务 Body 重试  |
| `400` / `404` / `422`      | 修正业务数据，不自动重试                |
| `401`                      | 校时并检查凭证；不得无限重试            |
| `409 REPLAY_DETECTED`      | 新建 Nonce 和时间戳后重签；幂等键不变   |
| `409 IDEMPOTENCY_CONFLICT` | 停止重试并人工检查调用方键管理          |
| `409 INSUFFICIENT_BALANCE` | 充值或调整任务后使用新业务请求          |
| `429` / `503`              | 指数退避并加随机抖动，原幂等键重试      |

## 10. 联调验收清单

### 10.1 平台提供

- [ ] 联调环境域名、ERP/CRM 独立凭证和 MC code 权限。
- [ ] 测试影楼、价格、余额、数据分类、话术、线路和映射。
- [ ] 百应测试公司、Token、回调配置和可拨打测试号码。
- [ ] OpenAPI 1.0.0 及本目录中的固定样例。

### 10.2 ERP 与 CRM 分别确认

- [ ] 可接受 `202 + 查询/异步回调`，不会把 `202` 当作呼叫已开始。
- [ ] 能生成并校验本文 HMAC 签名，服务器时间已同步。
- [ ] 创建超时后能复用原幂等键与业务 Body。
- [ ] 能以 `eventId` 幂等保存回调并在持久化后快速 ACK。
- [ ] 能接收每批 200 条通话结果和每批 100 条录音清单。
- [ ] 能从短期 HTTPS URL 下载录音并校验 SHA-256。
- [ ] 已确认结果 URL、录音 URL、联系人和故障通知方式。

### 10.3 必测用例

- [ ] ERP 正常任务与 CRM 正常任务各一条完整闭环。
- [ ] 同幂等键、同 Body 重试只产生一个任务和一笔冻结。
- [ ] 同幂等键、不同 Body 返回 `IDEMPOTENCY_CONFLICT`。
- [ ] 无效签名、过期时间戳和重复 Nonce 均被拒绝。
- [ ] 重复回调只落一份业务结果，且每次都快速 ACK。
- [ ] 任务启动失败时能处理 `baiyingCallJobId=null`。
- [ ] 录音 URL 过期后可重新签发并成功下载。
- [ ] 余额不足、分类冲突、线路冲突和映射缺失返回约定错误码。

## 11. 契约变更规则

- `schemaVersion=1.0` 内只允许增加可选字段；接收方应忽略未知字段。新增枚举值必须先做兼容性评审。
- 删除字段、修改字段含义、把可选改必填、改变签名算法均属于破坏性变更，必须发布新版本。
- OpenAPI、TypeScript/Zod Schema、固定 JSON 样例和本手册必须在同一次变更中更新并通过校验。
- 双方联调通过后记录确认人、确认日期和契约 Git commit；正式实现只以该冻结版本为准。

# outbound-platform-api

独立部署的 TypeScript API，首批覆盖百应 4.10 变量快照落库、ERP/CRM 直接字段映射、草稿发布、不可变版本和场景就绪状态。

## 边界

- 前端只调用本 API，不读取百应、ERP 或 CRM 密钥。
- 百应变量名只能来自 4.10 成功快照，管理端不能手工创造。
- 每个百应变量分别配置 `erpField` 和 `crmField`；导入时按来源系统读取对应字段。
- 发布会生成完整、不可变的规则快照；任务应锁定 `mappingVersionId`。
- “立即同步”返回 `202` 并写入 `queue_outbox`，不在 HTTP 请求中等待百应。

## 本地启动

1. 启动 Docker Desktop。
2. 在仓库根目录执行 `npm run db:up`，启动只监听 `127.0.0.1:5432` 的 PostgreSQL。
3. 执行 `npm run db:migrate`。
4. 首次建立本地演示库时执行 `npm run db:import:phase1`。
5. 执行 `npm run db:bootstrap:stage2-local`，建立不会拨号或回调外部系统的本地 ERP/CRM 配置。
6. 执行 `npm run db:reconcile:phase1`，确认输出中的 `ok` 为 `true`。
7. 执行 `npm run db:verify:stage2`，验证鉴权、幂等、预检和原子冻结；验证任务会自动清理。
8. 执行 `npm run backend:build`。
9. 执行 `npm run backend:dev`，默认监听 `http://localhost:8788`。
10. 另开终端执行 `npm run stage2:send:erp` 或 `npm run stage2:send:crm`，发送一条签名后的本地模拟任务。
11. 另开终端执行 `npm run baiying:worker --workspace @outbound/platform-api`，消费页面“同步百应变量”写入的本地 outbox 任务。
12. 执行 `npm run db:verify:stage4` 验证本地回调、幂等计费和结算闭环；需要持续消费 Inbox 时运行 `npm run stage4:worker:local`。

本机实际密码保存在忽略提交的 `.env.postgres.local` 和 `outbound-platform-api/.env`，示例文件不包含真实密钥。

## 阶段 1 数据底座

从仓库根目录可执行：

```bash
npm run db:migrate
npm run db:import:phase1
npm run db:reconcile:phase1
npm run db:verify:phase1
```

- `db:import:phase1` 只补充缺失的本地静态配置，不覆盖已有账户余额或已发布版本，可安全重复执行；生产环境会拒绝运行。
- 从现行页面导入的回调端点状态为 `DRAFT`。配置真实密钥引用并完成连通性验证后才能激活，示例域名不得用于联调或生产。
- `db:reconcile:phase1` 逐字段核对影楼、账户、价格和供应阶梯，并确认每条旧话术绑定都有规范化对应关系；失败时进程退出码为 1。
- `db:verify:phase1` 创建并自动清理隔离夹具，验证精确金额、账户并发锁、冻结/释放/充值幂等、配置读取、话术双写，以及 Outbox `FOR UPDATE SKIP LOCKED`、重试和死信。
- 开发/测试环境需要撤销 0008 时，可使用 `drizzle/rollback/0008_phase1_data_foundation.down.sql`。该脚本会删除阶段 1 表，只能在没有真实任务和账本数据时运行。
- 生产部署到阿里云时采用 expand → backfill → switch → contract；故障回退切换 Feature Flag 和旧读路径，不执行破坏性数据库回滚，也不删除任务或账本流水。

## 阶段 2A 本地任务闭环

阶段 2A 已实现：

- `POST /openapi/v1/outbound/tasks`，完成 25 MiB、Schema、10,000 客户、手机号与重复值校验。
- ERP/CRM HMAC-SHA256、5 分钟时间窗、Nonce 防重放、客户端权限和每分钟限流。
- MC code、启用影楼、回调端点、价格、余额、分类、话术、线路、场景和映射预检。
- 在单一 PostgreSQL 事务中保存任务、加密客户明细、配置快照、资金冻结、账本、幂等响应和 `TASK_ACCEPTED` Outbox。
- 同幂等键同业务报文返回原任务；同键不同报文返回 `IDEMPOTENCY_CONFLICT`。
- `GET /openapi/v1/outbound/tasks/{taskNo}` 与通话分页查询；百应编排尚未开始前通话页为空。

本地客户端为 `erp-local-01` 和 `crm-local-01`，只授权 `MC-ZTY-001`。密钥通过 `WORKER_SHARED_SECRET` 派生，模拟端点使用 `.invalid` 域名，任务场景标记为 `LOCAL-MOCK`。本地密钥提供器和数据加密器在 `NODE_ENV=production` 时会拒绝启动；阿里云部署时必须换成 KMS `SecretProvider`，配置真实 ERP/CRM 凭证和回调地址后再启用生产入口。

从仓库根目录运行完整验证：

```bash
npm run db:migrate
npm run db:bootstrap:stage2-local
npm run db:verify:stage2
```

开发/测试环境需要撤销 0009 时，可使用 `drizzle/rollback/0009_stage2_local_intake.down.sql`。它只删除 Nonce 防重放表；生产环境不执行该破坏性回滚。

## 阶段 4A 本地回调与计费闭环

阶段 4A 已实现：

- `POST /api/v1/callbacks/baiying` 统一接收 `CALL_INSTANCE_RESULT` 和 `JOB_INFO_RESULT`；旧的 `/api/v1/callbacks/baiying/call-instance` 保留为兼容别名。
- HTTP 链路按 5 MiB 上限读取原始正文，完成 SHA-256、加密 Inbox 和唯一事件键持久化后才返回 `{"code":200}`。
- Callback Worker 使用 PostgreSQL `FOR UPDATE SKIP LOCKED`、超时锁恢复、有界退避和死信；未知 JSON 与未知类型也保留加密原文供审计。
- 通话用 `companyId + callInstanceId` 做业务幂等，通过 `sx_platform_item_id` 或手机号 HMAC 关联客户；精确重复和不同原文的业务重复均不会重复扣费。
- 每条通话按 `ceil(duration / 60)` 结算，捕获冻结金额、释放差额并记录超额扣款；任务完成后先对账再进入 `COMPLETED`。
- 任务详情返回百应原始任务状态码及中文解释，通话分页查询已返回真实数据库数据；完整录音 URL 仅加密登记，阶段 5 才会下载到阿里云 OSS。

本地验收不会联网、不会拨号、不会下载录音，也不会请求 ERP/CRM：

```bash
npm run db:migrate
npm run db:verify:stage4
npm run stage4:worker:local
```

开发/测试环境需要撤销 0010 时，可使用 `drizzle/rollback/0010_callback_inbox_worker.down.sql`。生产环境继续采用 expand → backfill → switch → contract，不执行破坏性 down 脚本。

## 阶段 6A 真实任务运营页

运营后台现已使用以下内部只读接口展示 PostgreSQL 中的任务，不再使用页面内静态任务数据：

- `GET /api/v1/outbound-tasks`：关键词、状态、创建日期与页码筛选，同时返回状态数量汇总。
- `GET /api/v1/outbound-tasks/{taskNo}`：任务快照、独立状态线、失败原因、计费、实时账户余额和脱敏后的回调配置。
- `GET /api/v1/outbound-tasks/{taskNo}/calls`：游标分页通话明细，只返回掩码手机号和已归一化结果。

三个接口均要求运营后台发送 `X-Actor-Id`。前端会校验共享契约，Schema 漂移不会被静默展示。具备至少一条“呼叫中”和一条含通话的“执行完成”本地任务后，可运行浏览器回归：

```bash
npm run stage6:verify:ui
```

该脚本复用本机 Chrome，验证真实列表、完成状态筛选、任务详情、通话计费和手机号脱敏，并将检查截图写入 `/tmp`。

## 阶段 6B-1 影楼、账务与价格运营

运营后台的“影楼管理”“充值记录”和“话费设置”已连接 PostgreSQL，不再依赖浏览器静态业务数据：

- `GET/POST /api/v1/studios`、`PATCH /api/v1/studios/{studioId}` 和 `POST /api/v1/studios/{studioId}/status`：分页查询、新增、修改和启停；MC code 保持唯一，联系人电话加密保存、脱敏返回，写操作均记录审计日志。
- `GET /api/v1/account-ledger` 和 `POST /api/v1/account-ledger/top-ups`：查询不可变账户流水，并在账户行锁内原子完成线下充值、余额更新和审计；同一幂等键不会重复入账。当前保存收款渠道、凭证号和文件名元数据，文件内容待阶段 5 接入阿里云 OSS。
- `GET /api/v1/pricing`、`POST /api/v1/pricing/preview` 和 `POST /api/v1/pricing/publish`：读取当前/预约客户价格及供应商成本阶梯，支持统一或单影楼预览和不可变版本发布；立即版本只影响新任务，预约版本按上海时区次日零点生效。

所有内部接口均要求 `X-Actor-Id`。本轮刻意不开放无审批的退款和人工调整入口，也不激活 ERP/CRM 回传端点；这两部分分别留给 6B-2 和取得真实地址、KMS 密钥后的外部联调阶段。

从仓库根目录执行事务和只读页面回归：

```bash
npm run db:verify:stage6b
npm run stage6b:verify:ui
```

数据库脚本会创建隔离影楼并在结束时清理，覆盖加密、幂等充值、即时/预约定价与审计；浏览器脚本只读取数据、打开表单和调用价格预览，不会新增、充值或发布版本，截图写入 `/tmp`。

## 阶段 6B-2 退款、人工调整与操作审计

“充值记录”页面现已增加资金申请与独立复核工作台，“操作日志”页面改为读取 PostgreSQL 审计记录：

- `GET/POST /api/v1/account-adjustments`：分页筛选申请，或发起客户退款、人工补账、人工冲减；申请保存账户余额快照并支持幂等重放，但不会立即改动余额。
- `POST /api/v1/account-adjustments/{adjustmentId}/decisions`：由非申请人批准或拒绝。批准时同时锁定审批单和账户、重新校验可用余额、更新余额并生成唯一账本流水；拒绝不写账本。
- `GET /api/v1/audit-logs`：按关键词和业务分类分页读取真实审计事件；密钥、令牌、认证、Cookie、密文和手机号等敏感键在服务端递归脱敏后才返回浏览器。

迁移和验收命令：

```bash
npm run db:migrate
npm run db:verify:stage6b2
npm run stage6b2:verify:ui
```

数据库验收创建并清理隔离资金夹具；浏览器验收使用只读待复核夹具验证复核界面，并读取真实审计事件，不会提交资金决策。开发/测试环境需要撤销 0011 时，可使用 `drizzle/rollback/0011_account_adjustment_approval.down.sql`，但只允许在没有真实审批数据时执行。当前 `X-Actor-Id` 是本地内部联调身份；阿里云生产部署必须由可信 SSO/网关覆盖该请求头，浏览器传值不能作为真实授权依据。

## 阶段 6B-3A 实时总览与统一接口日志

“总览”和“接口日志”现已直接读取 PostgreSQL，不再展示页面演示数字：

- `GET /api/v1/operations-overview`：按上海业务日聚合任务、资金、消息积压、投递失败、死信、待审批、逐小时呼叫趋势、关注项与最近任务。
- `GET /api/v1/integration-logs`：联合查询 ERP/CRM 任务受理、百应编排操作、百应回调与 ERP/CRM 投递尝试，支持关键词、系统、方向、状态和分页筛选。
- 接口日志复用各业务链路的事实表，不另写一份容易失真的“通用日志”；Callback 加密原文、目标 URL 和投递载荷不会下发，允许展示的快照及错误文本会在服务端递归脱敏。

本阶段没有新建数据表或调用外部系统。可在后端和前端运行期间执行：

```bash
npm run db:verify:stage6b3
npm run stage6b3:verify:ui
```

数据库脚本会短暂创建并自动清理 Callback、Outbox 与死信隔离夹具；浏览器脚本只读真实聚合接口并检查详情脱敏及 390px 布局。

## 阶段 6B-3B 任务处置与异常恢复

“呼叫任务”详情和新增的“异常中心”已形成可审计的本地异常处置闭环：

- `POST /api/v1/outbound-tasks/{taskNo}/commands`：暂停、恢复或终止任务；先记录 `PENDING` 操作，再调用供应商适配器，只有确认结果才更新任务状态。
- `POST /api/v1/outbound-tasks/{taskNo}/retry`：只恢复可证明安全的失败阶段并重新入队；部分导入、已产生通话或资金状态不确定时拒绝盲目重试。
- `GET /api/v1/dead-letters`：按关键词、来源和状态分页查询死信，只返回脱敏摘要。
- `POST /api/v1/dead-letters/{id}/replay`：原位恢复 Outbox、Callback、录音或回传记录；Worker 成功处理 Outbox/Callback 后自动标记解决。
- `POST /api/v1/dead-letters/{id}/ignore`：保留原记录并记录忽略原因，不重新投递。

所有写操作要求 `X-Actor-Id`、操作原因和 UUID 幂等键。开发环境使用严格零网络的任务命令模拟器；`NODE_ENV=production` 时不会加载模拟器，取得真实百应写接口前任务控制返回明确的未配置错误。失败任务重新冻结后使用独立的冻结/释放周期账本键，不覆盖历史流水。

本地数据库验收不会连接百应、ERP 或 CRM，也不会拨号：

```bash
npm run db:verify:stage6b3b
npm run stage6b3b:verify:ui
```

数据库脚本使用隔离夹具验证状态、资金、幂等、审计和 Worker 自动闭环并在结束后清理；浏览器脚本使用只读/模拟路由验证确认弹窗、异常处置、脱敏详情与 390px 布局，不会触发真实外部请求。

## 阶段 6B-3C 安全回调预览与演示数据退场

“回调测试”页面只生成 ERP/CRM 将来可接收的脱敏合成报文，不发送请求：

- `POST /api/v1/callback-previews` 只允许 `environment=SAFE_PREVIEW`，支持通话结果批次、任务完成摘要和录音可用批次三种事件。
- 请求体不接受回调 URL、密钥或自定义 Header；返回固定声明 `deliveryAttempted=false`、`networkAccess=DISABLED` 和 `destination=null`。
- 示例签名固定为 `SAFE_PREVIEW_UNSIGNED`，录音地址使用不可路由的 `example.invalid`；服务不依赖端点仓库、投递队列、HTTP 客户端或 KMS。
- 旧总览、影楼、充值、价格和日志演示实现已删除；话术与线路绑定中的影楼选项改为读取真实 `/api/v1/studios`。

本阶段不需要真实 ERP/CRM 客户端、回调地址或 KMS 密钥：

```bash
npm run stage6b3c:verify
```

未来取得测试材料后，应另建受控“真实联调”服务并限制测试域名、测试凭证和出网白名单，不能把安全预览接口扩展成通用 URL 投递器。

## 当前交付范围

阶段 0 契约、阶段 1 数据底座、阶段 2A 本地任务受理、阶段 3A 本地百应编排、阶段 4A 本地回调计费闭环、阶段 6A 真实任务运营页，以及阶段 6B-1/6B-2/6B-3A/6B-3B/6B-3C 的影楼、充值、价格、资金审批、操作审计、实时总览、统一接口日志、任务控制、异常恢复和安全回调预览已完成，包括配置版本、任务模型、账户账本、双人复核、外部 HMAC/Nonce/限流、原子受理、可恢复的 Callback Inbox、录音发现、投递/死信、人工重放、规范化话术绑定，以及 PostgreSQL Outbox 的安全领取与重试语义。

百应最新 OAuth v2 鉴权、公司发现、机器人/话术发现和话术变量查询已接入。可执行 `npm run baiying:check` 做只读链路检查，或执行 `npm run baiying:sync` 将真实变量快照幂等写入本地 PostgreSQL。真实 ERP/CRM 凭证、回调地址和阿里云 KMS 适配归入阶段 2B；真实百应写接口、回调联调和完成通话分页补偿归入阶段 3B/4B，当前不会拨号或调用真实 ERP/CRM。生产队列首期使用 PostgreSQL Outbox/Inbox Worker，达到方案阈值后接入阿里云 RocketMQ 5.x，事务 Outbox 与持久 Inbox 始终保留。

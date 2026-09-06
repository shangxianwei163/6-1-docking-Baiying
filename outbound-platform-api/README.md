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

## 当前交付范围

阶段 0 契约、阶段 1 数据底座和阶段 2A 本地任务闭环已完成，包括配置版本、任务模型、账户账本、外部 HMAC/Nonce/限流、原子受理、回调 Inbox、录音/投递/死信、规范化话术绑定，以及 PostgreSQL Outbox 的安全领取与重试语义。

百应最新 OAuth v2 鉴权、公司发现、机器人/话术发现和话术变量查询已接入。可执行 `npm run baiying:check` 做只读链路检查，或执行 `npm run baiying:sync` 将真实变量快照幂等写入本地 PostgreSQL。真实 ERP/CRM 凭证、回调地址和阿里云 KMS 适配归入阶段 2B，当前不会调用真实 ERP/CRM。生产队列首期使用 PostgreSQL Outbox Worker，达到方案阈值后接入阿里云 RocketMQ 5.x，事务 Outbox 始终保留。

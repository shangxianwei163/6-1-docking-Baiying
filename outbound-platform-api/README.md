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
4. 执行 `npm run backend:build`。
5. 执行 `npm run backend:dev`，默认监听 `http://localhost:8788`。
6. 另开终端执行 `npm run baiying:worker --workspace @outbound/platform-api`，消费页面“同步百应变量”写入的本地 outbox 任务。

本机实际密码保存在忽略提交的 `.env.postgres.local` 和 `outbound-platform-api/.env`，示例文件不包含真实密钥。

## 当前交付范围

已完成数据库结构、Drizzle 模型、共享 Zod DTO、OpenAPI 3.1、映射业务规则、场景状态计算、HTTP API 和单元/API 测试。

百应最新 OAuth v2 鉴权、公司发现、机器人/话术发现和话术变量查询已接入。可执行 `npm run baiying:check` 做只读链路检查，或执行 `npm run baiying:sync` 将真实变量快照幂等写入本地 PostgreSQL。旧版 HMAC/v1.25 客户端已移除；Cloudflare Queue 的生产消费者与 Cron 调度仍待接入。

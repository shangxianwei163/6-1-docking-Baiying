import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config as loadEnvironment } from 'dotenv';
import postgres from 'postgres';

loadEnvironment({
  path: fileURLToPath(
    new URL('../outbound-platform-api/.env', import.meta.url),
  ),
  quiet: true,
});

const sourceDatabaseUrl = requiredEnvironment('DATABASE_URL');
const sourceUrl = new URL(sourceDatabaseUrl);
if (!['127.0.0.1', 'localhost', '::1'].includes(sourceUrl.hostname)) {
  throw new Error('Stage 7 本地验收只允许连接 localhost PostgreSQL');
}
if (process.env.NODE_ENV === 'production') {
  throw new Error('生产环境禁止运行 Stage 7 本地验收');
}

const databaseName = `outbound_stage7_${randomUUID().replaceAll('-', '')}`;
if (!/^outbound_stage7_[a-f0-9]{32}$/.test(databaseName)) {
  throw new Error('Stage 7 临时数据库名称生成失败');
}
const maintenanceUrl = new URL(sourceUrl);
maintenanceUrl.pathname = '/postgres';
const verificationUrl = new URL(sourceUrl);
verificationUrl.pathname = `/${databaseName}`;
const admin = postgres(maintenanceUrl.toString(), {
  max: 1,
  connect_timeout: 10,
  idle_timeout: 5,
});
let databaseCreated = false;

const steps = [
  ['迁移临时数据库', 'db:migrate'],
  ['导入本地基础配置', 'db:import:phase1'],
  ['类型检查', 'backend:typecheck'],
  ['后端单元与 HTTP 契约测试', 'backend:test'],
  ['阶段 1 账务与 Outbox', 'db:verify:phase1'],
  ['阶段 2 受理、鉴权与幂等', 'db:verify:stage2'],
  ['阶段 3 百应编排故障恢复', 'db:verify:stage3'],
  ['阶段 4 回调、计费与对账', 'db:verify:stage4'],
  ['阶段 5A 录音归档恢复', 'db:verify:stage5a'],
  ['阶段 5B 回传重试与签名 URL', 'db:verify:stage5b'],
  ['阶段 6B 运营账务', 'db:verify:stage6b'],
  ['阶段 6B-2 双人复核', 'db:verify:stage6b2'],
  ['阶段 6B-3 可观测性', 'db:verify:stage6b3'],
  ['阶段 6B-3B 任务控制与死信恢复', 'db:verify:stage6b3b'],
  ['阶段 6B-3C 零网络边界', 'stage6b3c:verify:source'],
  ['阶段 7A 容量、并发与回调突发', 'db:verify:stage7a'],
];

try {
  await admin.unsafe(`CREATE DATABASE "${databaseName}" TEMPLATE template0`);
  databaseCreated = true;
  console.info(`[Stage 7 本地验收] 已创建隔离数据库 ${databaseName}`);

  const environment = {
    ...process.env,
    DATABASE_URL: verificationUrl.toString(),
    NODE_ENV: 'test',
  };
  for (const [label, script] of steps) {
    console.info(`\n[Stage 7 本地验收] ${label}`);
    await run('npm', ['run', script], environment);
  }

  console.info('\n[Stage 7 本地验收] 全部检查通过');
} finally {
  if (databaseCreated) {
    await admin.unsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    console.info(`[Stage 7 本地验收] 已删除隔离数据库 ${databaseName}`);
  }
  await admin.end({ timeout: 5 });
}

function run(command, args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: environment,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          signal
            ? `${command} ${args.join(' ')} 被信号 ${signal} 终止`
            : `${command} ${args.join(' ')} 退出码为 ${code ?? 'unknown'}`,
        ),
      );
    });
  });
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
}

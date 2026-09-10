import { spawn } from 'node:child_process';

const steps = [
  ['运营后台登录', 'scripts/verify-operator-login-ui.py'],
  ['阶段 6A 任务列表与详情', 'scripts/verify-stage6-ui.py'],
  ['阶段 6B 配置与账务', 'scripts/verify-stage6b-ui.py'],
  ['阶段 6B-2 审批与审计', 'scripts/verify-stage6b2-ui.py'],
  ['阶段 6B-3 总览与接口日志', 'scripts/verify-stage6b3-ui.py'],
  ['阶段 6B-3B 任务控制与死信', 'scripts/verify-stage6b3b-ui.py'],
  ['阶段 6B-3C 安全回调预览', 'scripts/verify-stage6b3c-ui.py'],
  ['阶段 7B 供应商月结', 'scripts/verify-stage7b-ui.py'],
  ['话费设置分页与编辑器', 'scripts/verify-pricing-tabs-ui.py'],
  ['线路实时同步与缓存降级', 'scripts/verify-line-management-ui.py'],
  ['弹窗壳与短视口布局', 'scripts/verify-dialog-shells-ui.py'],
];

for (const [label, script] of steps) {
  console.info(`\n[本地 UI 验收] ${label}`);
  await run('python3', [script]);
}

console.info('\n[本地 UI 验收] 全部检查通过');

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
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
            ? `${scriptLabel(args)} 被信号 ${signal} 终止`
            : `${scriptLabel(args)} 退出码为 ${code ?? 'unknown'}`,
        ),
      );
    });
  });
}

function scriptLabel(args) {
  return args.join(' ');
}

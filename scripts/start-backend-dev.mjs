import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiRoot = resolve(root, 'outbound-platform-api');
const tsxCommand = resolve(
  root,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
);

const services = [
  { name: 'api', entry: 'src/server.ts' },
  { name: 'variable-sync-worker', entry: 'src/baiying/local-sync-worker.ts' },
];
let stopping = false;

const children = services.map((service) => {
  const child = spawn(tsxCommand, ['watch', service.entry], {
    cwd: apiRoot,
    env: process.env,
    stdio: 'inherit',
  });
  child.once('error', (error) => {
    console.error(`[dev:${service.name}] failed to start`, error);
    shutdown(1);
  });
  child.once('exit', (code, signal) => {
    if (stopping) return;
    console.error(
      `[dev:${service.name}] exited unexpectedly (code=${code}, signal=${signal})`,
    );
    shutdown(code || 1);
  });
  return child;
});

function shutdown(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  const forceTimer = setTimeout(() => {
    for (const child of children) {
      if (!child.killed) child.kill('SIGKILL');
    }
    process.exit(exitCode);
  }, 10_000);
  forceTimer.unref();
  void Promise.allSettled(
    children.map(
      (child) => new Promise((resolveExit) => child.once('exit', resolveExit)),
    ),
  ).finally(() => process.exit(exitCode));
}

process.once('SIGINT', () => shutdown(0));
process.once('SIGTERM', () => shutdown(0));

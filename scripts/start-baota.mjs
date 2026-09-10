import { existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiRoot = resolve(root, 'outbound-platform-api');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const nodeCommand = process.execPath;
const vinextCommand = resolve(
  root,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'vinext.cmd' : 'vinext',
);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`);
  }
}

if (!existsSync(vinextCommand)) {
  run(npmCommand, ['ci']);
}

run(npmCommand, ['run', 'db:migrate']);

const services = [
  {
    name: 'frontend',
    command: vinextCommand,
    args: [
      'start',
      '--hostname',
      '127.0.0.1',
      '--port',
      '4173',
    ],
    cwd: root,
  },
  {
    name: 'api',
    command: nodeCommand,
    args: ['dist/server.js'],
    cwd: apiRoot,
  },
  {
    name: 'variable-sync-worker',
    command: nodeCommand,
    args: ['dist/baiying/local-sync-worker.js'],
    cwd: apiRoot,
  },
  {
    name: 'baiying-worker',
    command: nodeCommand,
    args: ['dist/orchestration/baiying-worker.js'],
    cwd: apiRoot,
  },
  {
    name: 'callback-worker',
    command: nodeCommand,
    args: ['dist/callback/local-worker.js'],
    cwd: apiRoot,
  },
  {
    name: 'reconciliation-worker',
    command: nodeCommand,
    args: ['dist/reconciliation/local-worker.js'],
    cwd: apiRoot,
  },
  {
    name: 'recording-worker',
    command: nodeCommand,
    args: ['dist/recording/network-worker.js'],
    cwd: apiRoot,
  },
  {
    name: 'delivery-worker',
    command: nodeCommand,
    args: ['dist/delivery/network-worker.js'],
    cwd: apiRoot,
  },
];

let stopping = false;

const children = services.map((service) => {
  const child = spawn(service.command, service.args, {
    cwd: service.cwd,
    env: process.env,
    stdio: 'inherit',
  });
  child.once('error', (error) => {
    console.error(`[baota:${service.name}] failed to start`, error);
    shutdown(1);
  });
  child.once('exit', (code, signal) => {
    if (stopping) return;
    console.error(
      `[baota:${service.name}] exited unexpectedly (code=${code}, signal=${signal})`,
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
      (child) =>
        new Promise((resolveExit) => child.once('exit', resolveExit)),
    ),
  ).finally(() => process.exit(exitCode));
}

process.once('SIGINT', () => shutdown(0));
process.once('SIGTERM', () => shutdown(0));

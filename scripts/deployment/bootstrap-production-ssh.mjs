import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import WebSocket from 'ws';
import { BaotaClient } from './baota-client.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function parseEnvironmentFile(path) {
  const values = {};
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function required(values, name) {
  const value = process.env[name] || values[name];
  if (!value) throw new Error(`${name} is required in .env.baota.local`);
  return value;
}

async function installPublicKey(client, publicKey, panelUrl) {
  const panel = new URL(panelUrl);
  const socketUrl = new URL('/webssh', panel.origin);
  socketUrl.protocol = 'wss:';
  const cookie = [...client.cookies.entries()]
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');

  const authorizedLine = `no-agent-forwarding,no-port-forwarding,no-X11-forwarding,no-pty ${publicKey.trim()}`;
  const encodedKey = Buffer.from(authorizedLine).toString('base64');
  const remoteSetup = [
    'set -eu',
    'umask 077',
    'install -d -m 700 /root/.ssh',
    'touch /root/.ssh/authorized_keys',
    'chmod 600 /root/.ssh/authorized_keys',
    `deploy_key="$(printf '%s' '${encodedKey}' | base64 -d)"`,
    'if ! grep -Fqx -- "$deploy_key" /root/.ssh/authorized_keys; then',
    '  printf \'%s\\n\' "$deploy_key" >> /root/.ssh/authorized_keys',
    'fi',
    'command -v cp >/dev/null',
    'command -v sha256sum >/dev/null',
    'command -v flock >/dev/null',
    'test -d /www/wwwroot/scheduling.paiyide.cc',
    'test "$(readlink -f /www/wwwroot/scheduling.paiyide.cc)" = \'/www/wwwroot/scheduling.paiyide.cc\'',
    "printf '%s%s\\n' '__CODEX_SSH_' 'BOOTSTRAP_OK__'",
  ].join('\n');
  const command = `printf '%s' '${Buffer.from(remoteSetup).toString('base64')}' | base64 -d | bash\r`;

  await new Promise((resolveSetup, rejectSetup) => {
    const socket = new WebSocket(socketUrl, {
      rejectUnauthorized: false,
      headers: {
        Cookie: cookie,
        Origin: panel.origin,
        'User-Agent': 'Mozilla/5.0',
      },
    });
    const timeout = setTimeout(() => {
      socket.terminate();
      rejectSetup(new Error('Baota web terminal bootstrap timed out'));
    }, 15_000);

    socket.once('open', () => {
      socket.send(
        JSON.stringify({
          id: `production-release-bootstrap-${Date.now()}`,
          host: '127.0.0.1',
          ps: 'local',
          'x-http-token': client.requestToken,
        }),
      );
      setTimeout(() => {
        socket.send(command);
        setTimeout(() => {
          // The panel's terminal output framing differs between Baota versions.
          // The direct SSH probe below is the authoritative completion check.
          clearTimeout(timeout);
          socket.terminate();
          resolveSetup();
        }, 2_000);
      }, 750);
    });
    socket.once('error', (error) => {
      if (socket.readyState !== WebSocket.CLOSED) {
        clearTimeout(timeout);
        rejectSetup(error);
      }
    });
  });
}

async function main() {
  const values = parseEnvironmentFile(join(root, '.env.baota.local'));
  const panelUrl = required(values, 'BAOTA_PANEL_URL');
  const keyPath = resolve(required(values, 'PRODUCTION_SSH_KEY'));
  const publicKey = readFileSync(`${keyPath}.pub`, 'utf8');
  const sshHost = required(values, 'PRODUCTION_SSH_HOST');
  const sshPort =
    process.env.PRODUCTION_SSH_PORT || values.PRODUCTION_SSH_PORT || '22';
  const sshUser =
    process.env.PRODUCTION_SSH_USER || values.PRODUCTION_SSH_USER || 'root';

  const client = new BaotaClient({
    panelUrl,
    username: required(values, 'BAOTA_USERNAME'),
    password: required(values, 'BAOTA_PASSWORD'),
  });
  await client.login();
  await installPublicKey(client, publicKey, panelUrl);

  const verification = spawnSync(
    'ssh',
    [
      '-i',
      keyPath,
      '-p',
      sshPort,
      '-o',
      'IdentitiesOnly=yes',
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=10',
      '-o',
      'StrictHostKeyChecking=accept-new',
      `${sshUser}@${sshHost}`,
      "test -d /www/wwwroot/scheduling.paiyide.cc && command -v cp >/dev/null && printf 'verified'",
    ],
    { encoding: 'utf8' },
  );
  if (verification.status !== 0 || verification.stdout.trim() !== 'verified') {
    throw new Error(
      'SSH key was installed but the direct connection check failed',
    );
  }

  process.stdout.write(
    'Production SSH deployment channel initialized and verified.\n',
  );
}

main().catch((error) => {
  process.stderr.write(
    `Production SSH bootstrap failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});

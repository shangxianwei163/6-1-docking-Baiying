import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { BaotaClient } from './deployment/baota-client.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const environmentPath = join(root, '.env.baota.local');
const serverReleaseScript = join(
  root,
  'scripts',
  'deployment',
  'server-release.sh',
);
const dryRun = process.argv.includes('--dry-run');
const unexpectedArguments = process.argv
  .slice(2)
  .filter((arg) => arg !== '--dry-run');

if (unexpectedArguments.length > 0) {
  throw new Error(
    `Unknown release argument: ${unexpectedArguments.join(', ')}`,
  );
}

function log(message) {
  process.stdout.write(`[release] ${message}\n`);
}

function parseEnvironmentFile(path) {
  if (!existsSync(path)) {
    throw new Error(`Missing local deployment environment: ${path}`);
  }

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

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, COPYFILE_DISABLE: '1' },
    stdio: options.capture ? 'pipe' : 'inherit',
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.capture
      ? `\n${result.stdout ?? ''}${result.stderr ?? ''}`.trimEnd()
      : '';
    throw new Error(
      `${command} ${args.join(' ')} failed with ${result.status}${detail}`,
    );
  }
  return options.capture ? (result.stdout ?? '').trim() : '';
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function collectManagedFiles(directory) {
  const files = [];

  function visit(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolutePath = join(current, entry.name);
      const relativePath = relative(directory, absolutePath)
        .split('\\')
        .join('/');
      if (entry.isSymbolicLink() || lstatSync(absolutePath).isSymbolicLink()) {
        throw new Error(
          `Release cannot contain symbolic links: ${relativePath}`,
        );
      }
      if (entry.isDirectory()) visit(absolutePath);
      else if (entry.isFile()) files.push(relativePath);
      else throw new Error(`Unsupported release entry: ${relativePath}`);
    }
  }

  visit(directory);
  return files.sort((left, right) => left.localeCompare(right));
}

function assertCleanMainCommit() {
  const branch = run('git', ['branch', '--show-current'], { capture: true });
  if (branch !== 'main') {
    throw new Error(
      `Production releases must run from main, not ${branch || 'detached HEAD'}`,
    );
  }

  const trackedChanges = run(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=no'],
    { capture: true },
  );
  if (trackedChanges) {
    throw new Error(
      'Tracked changes must be committed before a production release',
    );
  }

  const allowedUntrackedRoots = new Set([
    '?? .planning/',
    '?? .playwright-cli/',
    '?? output/',
  ]);
  const untrackedChanges = run(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=normal'],
    { capture: true },
  )
    .split('\n')
    .filter(
      (line) => line.startsWith('?? ') && !allowedUntrackedRoots.has(line),
    );
  if (untrackedChanges.length > 0) {
    throw new Error(
      `Untracked release files must be committed or ignored:\n${untrackedChanges.join('\n')}`,
    );
  }

  log('checking GitHub main');
  run('git', ['fetch', '--quiet', 'github', 'main']);
  const commit = run('git', ['rev-parse', 'HEAD'], { capture: true });
  const githubCommit = run('git', ['rev-parse', 'github/main'], {
    capture: true,
  });
  if (commit !== githubCommit) {
    throw new Error('HEAD is not the commit currently pushed to GitHub main');
  }
  return commit;
}

function runChecksAndBuilds() {
  const commands = [
    { command: 'npm', args: ['run', 'backend:test'] },
    { command: 'npm', args: ['run', 'backend:typecheck'] },
    { command: 'npm', args: ['run', 'lint'] },
    { command: 'npm', args: ['run', 'backend:build'] },
    { command: 'npm', args: ['run', 'build'] },
  ];
  for (const { command, args } of commands) {
    log(`running ${command} ${args.join(' ')}`);
    run(command, args);
  }
}

function createArtifact(commit, temporaryRoot) {
  const releaseDirectory = join(temporaryRoot, 'release');
  const sourceArchive = join(temporaryRoot, 'source.tar');
  const artifact = join(
    temporaryRoot,
    `scheduling-paiyide-${commit.slice(0, 12)}.tar.gz`,
  );

  run('git', ['archive', '--format=tar', `--output=${sourceArchive}`, commit]);
  run('mkdir', ['-p', releaseDirectory]);
  run('tar', ['-xf', sourceArchive, '-C', releaseDirectory]);

  for (const outputDirectory of [
    'dist',
    'outbound-contracts/dist',
    'outbound-platform-api/dist',
  ]) {
    const source = join(root, outputDirectory);
    if (!existsSync(source)) {
      throw new Error(`Build output is missing: ${outputDirectory}`);
    }
    cpSync(source, join(releaseDirectory, outputDirectory), {
      recursive: true,
      force: true,
    });
  }

  const metadata = {
    commit,
    shortCommit: commit.slice(0, 12),
    builtAt: new Date().toISOString(),
    packageLockSha256: sha256File(join(root, 'package-lock.json')),
  };
  writeFileSync(
    join(releaseDirectory, '.production-release.json'),
    `${JSON.stringify(metadata, null, 2)}\n`,
  );

  const managedFiles = collectManagedFiles(releaseDirectory);
  managedFiles.push('.production-managed-files');
  managedFiles.sort((left, right) => left.localeCompare(right));
  writeFileSync(
    join(releaseDirectory, '.production-managed-files'),
    `${managedFiles.join('\n')}\n`,
  );

  run('tar', ['--no-xattrs', '-czf', artifact, '-C', releaseDirectory, '.']);
  return { artifact, sha256: sha256File(artifact) };
}

function validateSshConfiguration(configuration) {
  if (!/^[A-Za-z0-9.-]+$/.test(configuration.host)) {
    throw new Error('PRODUCTION_SSH_HOST contains unsupported characters');
  }
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(configuration.user)) {
    throw new Error('PRODUCTION_SSH_USER contains unsupported characters');
  }
  if (!/^\d{1,5}$/.test(configuration.port)) {
    throw new Error('PRODUCTION_SSH_PORT must be a valid port number');
  }
  if (!existsSync(configuration.key)) {
    throw new Error(`Production SSH key is missing: ${configuration.key}`);
  }
}

function sshArguments(configuration) {
  return [
    '-i',
    configuration.key,
    '-p',
    configuration.port,
    '-o',
    'IdentitiesOnly=yes',
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=10',
    '-o',
    'ServerAliveInterval=10',
    '-o',
    'StrictHostKeyChecking=accept-new',
    `${configuration.user}@${configuration.host}`,
  ];
}

function scpArguments(configuration) {
  return [
    '-i',
    configuration.key,
    '-P',
    configuration.port,
    '-o',
    'IdentitiesOnly=yes',
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=10',
    '-o',
    'StrictHostKeyChecking=accept-new',
  ];
}

function runRemote(configuration, command, capture = false) {
  return run('ssh', [...sshArguments(configuration), command], { capture });
}

async function waitForHealth(siteUrl, attempts = 30) {
  const healthUrl = new URL('/health', siteUrl);
  let lastProblem = 'no response';

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(healthUrl, {
        signal: AbortSignal.timeout(8_000),
        headers: { Accept: 'application/json' },
      });
      const body = await response.text();
      if (response.status === 200) {
        const parsed = JSON.parse(body);
        if (parsed?.status === 'ok') return;
      }
      lastProblem = `HTTP ${response.status}`;
    } catch (error) {
      lastProblem = error instanceof Error ? error.message : String(error);
    }
    if (attempt < attempts) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 2_000));
    }
  }
  throw new Error(`Production health check failed: ${lastProblem}`);
}

async function verifyProduction(siteUrl) {
  await waitForHealth(siteUrl);

  const authenticationProbe = await fetch(
    new URL('/openapi/v2/outbound/batches/deployment-healthcheck', siteUrl),
    {
      headers: {
        Accept: 'application/json',
        'X-Access-Token': `invalid-deployment-token-${Date.now()}`,
      },
      signal: AbortSignal.timeout(10_000),
    },
  );
  const authenticationBody = await authenticationProbe.text();
  if (
    authenticationProbe.status !== 401 ||
    !authenticationBody.includes('AUTHENTICATION_FAILED') ||
    authenticationBody.includes('X-Client-Id')
  ) {
    throw new Error(
      `Production token acceptance check failed with HTTP ${authenticationProbe.status}`,
    );
  }

  const documentation = await fetch(
    new URL('/api-docs?api=result-callback', siteUrl),
    { signal: AbortSignal.timeout(10_000) },
  );
  if (documentation.status !== 200) {
    throw new Error(
      `Production API documentation returned HTTP ${documentation.status}`,
    );
  }
}

async function main() {
  const startedAt = Date.now();
  const fileEnvironment = parseEnvironmentFile(environmentPath);
  const panelProject =
    process.env.BAOTA_PROJECT_NAME ||
    fileEnvironment.BAOTA_PROJECT_NAME ||
    'scheduling_paiyide_cc';
  const siteUrl = required(fileEnvironment, 'PRODUCTION_SITE_URL');
  const sshConfiguration = {
    host: required(fileEnvironment, 'PRODUCTION_SSH_HOST'),
    user:
      process.env.PRODUCTION_SSH_USER ||
      fileEnvironment.PRODUCTION_SSH_USER ||
      'root',
    port:
      process.env.PRODUCTION_SSH_PORT ||
      fileEnvironment.PRODUCTION_SSH_PORT ||
      '22',
    key: resolve(required(fileEnvironment, 'PRODUCTION_SSH_KEY')),
  };
  validateSshConfiguration(sshConfiguration);

  const commit = assertCleanMainCommit();
  log(`preparing ${commit}`);
  runChecksAndBuilds();

  const temporaryRoot = mkdtempSync(
    join(tmpdir(), 'scheduling-paiyide-release-'),
  );
  let remoteDirectory = '';
  let deployed = false;
  let backupId = '';
  let panelClient;

  try {
    const release = createArtifact(commit, temporaryRoot);
    log(
      `artifact ready (${basename(release.artifact)}, sha256 verified locally)`,
    );

    if (dryRun) {
      log('dry run completed; production was not changed');
      return;
    }

    panelClient = new BaotaClient({
      panelUrl: required(fileEnvironment, 'BAOTA_PANEL_URL'),
      username: required(fileEnvironment, 'BAOTA_USERNAME'),
      password: required(fileEnvironment, 'BAOTA_PASSWORD'),
    });
    log('checking the existing Baota project');
    await panelClient.login();
    const projects = await panelClient.getNodeProjects();
    if (!JSON.stringify(projects).includes(panelProject)) {
      throw new Error(`Existing Baota project was not found: ${panelProject}`);
    }

    remoteDirectory = `/tmp/scheduling-paiyide-release-${commit.slice(0, 12)}-${process.pid}`;
    runRemote(sshConfiguration, `mkdir -p -- '${remoteDirectory}'`);
    log('uploading the prebuilt release to the Baota server');
    run('scp', [
      ...scpArguments(sshConfiguration),
      release.artifact,
      serverReleaseScript,
      `${sshConfiguration.user}@${sshConfiguration.host}:${remoteDirectory}/`,
    ]);

    const remoteArtifact = `${remoteDirectory}/${basename(release.artifact)}`;
    const remoteScript = `${remoteDirectory}/${basename(serverReleaseScript)}`;
    runRemote(sshConfiguration, `bash '${remoteScript}' preflight`);
    const deploymentOutput = runRemote(
      sshConfiguration,
      `bash '${remoteScript}' deploy '${remoteArtifact}' '${release.sha256}' '${commit}'`,
      true,
    );
    process.stdout.write(`${deploymentOutput}\n`);
    backupId =
      deploymentOutput.match(/DEPLOY_RESULT backup_id=([^\s]+)/)?.[1] ?? '';
    if (!backupId)
      throw new Error('Server did not return a rollback backup id');
    deployed = true;

    log(`restarting existing Baota project ${panelProject}`);
    await panelClient.restartNodeProject(panelProject);
    log('running production acceptance checks');
    await verifyProduction(siteUrl);

    const remoteCommit = runRemote(
      sshConfiguration,
      `sed -n 's/.*"commit": "\\([0-9a-f]*\\)".*/\\1/p' '/www/wwwroot/scheduling.paiyide.cc/.production-release.json'`,
      true,
    );
    if (remoteCommit !== commit) {
      throw new Error(
        'Production release marker does not match the deployed Git commit',
      );
    }

    log(
      `production release completed in ${Math.ceil((Date.now() - startedAt) / 1000)}s`,
    );
    log(`online commit: ${commit}`);
  } catch (error) {
    if (deployed && backupId && panelClient) {
      log(`release verification failed; rolling back with backup ${backupId}`);
      try {
        const remoteScript = `${remoteDirectory}/${basename(serverReleaseScript)}`;
        runRemote(
          sshConfiguration,
          `bash '${remoteScript}' rollback '${backupId}'`,
        );
        await panelClient.restartNodeProject(panelProject);
        await waitForHealth(siteUrl);
        log('previous production release was restored successfully');
      } catch (rollbackError) {
        const rollbackMessage =
          rollbackError instanceof Error
            ? rollbackError.message
            : String(rollbackError);
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}; automatic rollback also failed: ${rollbackMessage}`,
        );
      }
    }
    throw error;
  } finally {
    if (remoteDirectory) {
      try {
        runRemote(sshConfiguration, `rm -rf -- '${remoteDirectory}'`);
      } catch {
        log('warning: remote temporary release directory could not be removed');
      }
    }
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(
    `[release] FAILED: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});

const fs = require('node:fs/promises');
const path = require('node:path');
const { constants } = require('node:fs');

const MAX_CONFIG_BYTES = 1024 * 1024;
const PYTEST_CONFIGS = ['pytest.ini', 'pyproject.toml', 'setup.cfg'];
const JEST_CONFIGS = ['jest.config.js', 'jest.config.cjs', 'jest.config.mjs', 'jest.config.json', 'jest.config.ts'];
const VITEST_CONFIGS = ['vitest.config.js', 'vitest.config.cjs', 'vitest.config.mjs', 'vitest.config.ts'];

async function readRootConfig(root, name, fsImpl) {
  const file = path.join(root, name);
  let handle;
  try {
    const info = await fsImpl.lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) return { error: 'Configuration files must be regular files.' };
    if (info.size > MAX_CONFIG_BYTES) return { error: 'Configuration file is larger than 1 MiB.' };
    const noFollow = fs.constants.O_NOFOLLOW || 0;
    handle = await fsImpl.open(file, constants.O_RDONLY | noFollow);
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size > MAX_CONFIG_BYTES) return { error: 'Configuration file is not a bounded regular file.' };
    const buffer = Buffer.alloc(MAX_CONFIG_BYTES + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset > MAX_CONFIG_BYTES) return { error: 'Configuration file grew larger than 1 MiB while being read.' };
    return { content: buffer.subarray(0, offset).toString('utf8') };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    return { error: 'Configuration file could not be read.' };
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function executableOnPath(name, environment, platform, fsImpl) {
  const pathValue = environment.PATH || environment.Path || '';
  const extensions = platform === 'win32'
    ? (environment.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';') : [''];
  for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${name}${extension}`);
      try {
        const info = await fsImpl.stat(candidate);
        if (info.isFile() && (platform === 'win32' || (await fsImpl.access(candidate, constants.X_OK).then(() => true, () => false)))) return candidate;
      } catch { /* Continue searching the inherited executable path. */ }
    }
  }
  return null;
}

async function isExecutableFile(candidate, platform, fsImpl) {
  try {
    if (!(await fsImpl.stat(candidate)).isFile()) return false;
    return platform === 'win32' || await fsImpl.access(candidate, constants.X_OK).then(() => true, () => false);
  } catch { return false; }
}

async function projectBinary(root, name, platform, fsImpl) {
  const suffixes = platform === 'win32' ? ['.cmd', '.exe', '.bat', ''] : [''];
  for (const suffix of suffixes) {
    const candidate = path.join(root, 'node_modules', '.bin', `${name}${suffix}`);
    if (await isExecutableFile(candidate, platform, fsImpl)) return candidate;
  }
  return null;
}

function detectNodeRunner(script, dependencies = {}) {
  if (/\bvitest\b/i.test(script)) return 'vitest';
  if (/\bjest\b/i.test(script)) return 'jest';
  if (/\bpytest\b/i.test(script)) return 'pytest';
  if (/\bnode\s+(?:--test\b|--test-reporter\b)/i.test(script)) return 'node:test';
  if (dependencies.vitest) return 'vitest';
  if (dependencies.jest) return 'jest';
  return null;
}

function createTestCommandDiscovery({ getProjectRoot, fsImpl = fs, environment = process.env, platform = process.platform } = {}) {
  if (typeof getProjectRoot !== 'function') throw new TypeError('A project-root resolver is required.');

  async function discover(projectId) {
    if (typeof projectId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectId)) {
      throw new TypeError('A valid project identifier is required.');
    }
    const authorizedRoot = await getProjectRoot(projectId);
    let root;
    try {
      root = await fsImpl.realpath(authorizedRoot);
      const info = await fsImpl.stat(root);
      if (!info.isDirectory() || root !== authorizedRoot) throw new Error('invalid project root');
    } catch {
      throw new Error('BUILDX could not confirm this project folder. Choose it again before discovering tests.');
    }

    const commands = [];
    const issues = [];
    const packageFile = await readRootConfig(root, 'package.json', fsImpl);
    if (packageFile?.error) issues.push({ source: 'package.json', message: packageFile.error });
    if (packageFile?.content !== undefined) {
      try {
        const manifest = JSON.parse(packageFile.content);
        if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('invalid manifest');
        if (manifest.scripts !== undefined && (!manifest.scripts || typeof manifest.scripts !== 'object' || Array.isArray(manifest.scripts))) {
          issues.push({ source: 'package.json', message: 'The scripts field must be an object of command strings.' });
        }
        const scripts = manifest.scripts && typeof manifest.scripts === 'object' && !Array.isArray(manifest.scripts) ? manifest.scripts : {};
        const dependencies = {
          ...(manifest.dependencies && typeof manifest.dependencies === 'object' && !Array.isArray(manifest.dependencies) ? manifest.dependencies : {}),
          ...(manifest.devDependencies && typeof manifest.devDependencies === 'object' && !Array.isArray(manifest.devDependencies) ? manifest.devDependencies : {}),
        };
        for (const [name, script] of Object.entries(scripts)) {
          if (!/^(?:test|test[:.-][\w:.-]+)$/i.test(name)) continue;
          if (typeof script !== 'string' || !script.trim()) {
            issues.push({ source: `package.json scripts.${name}`, message: 'The configured test script must be a non-empty command string.' });
            continue;
          }
          const runner = detectNodeRunner(script, dependencies);
          const source = `package.json scripts.${name}`;
          const command = name === 'test' ? 'npm test' : `npm run ${name}`;
          let available = false;
          let unavailableReason = '';
          const npmAvailable = Boolean(await executableOnPath('npm', environment, platform, fsImpl));
          if (!npmAvailable) unavailableReason = 'npm is not available on PATH.';
          else if (runner === 'vitest' || runner === 'jest') {
            available = Boolean(await projectBinary(root, runner, platform, fsImpl) || await executableOnPath(runner, environment, platform, fsImpl));
            if (!available) unavailableReason = `${runner} is referenced by the project script but is not installed or available on PATH.`;
          } else if (runner === 'pytest') {
            available = Boolean(await executableOnPath('pytest', environment, platform, fsImpl));
            if (!available) unavailableReason = 'pytest is referenced by the npm script but is not available on PATH.';
          } else if (runner === 'node:test') {
            available = Boolean(await executableOnPath('node', environment, platform, fsImpl));
            if (!available) unavailableReason = 'Node.js is not available on PATH.';
          } else {
            unavailableReason = 'The configured script does not identify a supported test runner. You can enter a command manually.';
          }
          commands.push({ id: `npm:${name}`, command, runner: runner || 'unidentified project script', source, kind: 'discovered', available, unavailable_reason: unavailableReason });
        }
      } catch {
        issues.push({ source: 'package.json', message: 'The package manifest is malformed JSON.' });
      }
    }

    const pytestConfigSources = [];
    for (const name of PYTEST_CONFIGS) {
      const config = await readRootConfig(root, name, fsImpl);
      if (config?.error) issues.push({ source: name, message: config.error });
      else if (config?.content !== undefined) {
        const configured = name === 'pytest.ini' ? /^\s*\[pytest\]\s*$/im.test(config.content)
          : name === 'pyproject.toml' ? /^\s*\[tool\.pytest\.ini_options\]\s*$/im.test(config.content)
            : /^\s*\[tool:pytest\]\s*$/im.test(config.content);
        if (configured) pytestConfigSources.push(name);
      }
    }
    if (pytestConfigSources.length) {
      let localRunner = null;
      const localCandidates = platform === 'win32'
        ? [path.join(root, '.venv', 'Scripts', 'pytest.exe'), path.join(root, 'venv', 'Scripts', 'pytest.exe')]
        : [path.join(root, '.venv', 'bin', 'pytest'), path.join(root, 'venv', 'bin', 'pytest')];
      for (const candidate of localCandidates) {
        if (await isExecutableFile(candidate, platform, fsImpl)) { localRunner = candidate; break; }
      }
      const globalRunner = await executableOnPath('pytest', environment, platform, fsImpl);
      const localRelative = localRunner ? path.relative(root, localRunner).split(path.sep).join(platform === 'win32' ? '\\' : '/') : '';
      const runner = localRunner ? (platform === 'win32' ? `.\\${localRelative} -q` : `./${localRelative} -q`) : 'pytest -q';
      const available = Boolean(localRunner || globalRunner);
      commands.push({ id: 'pytest:configured', command: runner, runner: 'pytest', source: pytestConfigSources.join(', '), kind: 'discovered', available,
        unavailable_reason: available ? '' : 'pytest is configured but is not installed in a project virtual environment or available on PATH.' });
    }

    const configCandidates = [
      ...JEST_CONFIGS.map((name) => ({ name, runner: 'jest' })),
      ...VITEST_CONFIGS.map((name) => ({ name, runner: 'vitest' })),
    ];
    for (const candidate of configCandidates) {
      const config = await readRootConfig(root, candidate.name, fsImpl);
      if (config?.error) issues.push({ source: candidate.name, message: config.error });
      else if (config?.content !== undefined) {
        const installed = Boolean(await projectBinary(root, candidate.runner, platform, fsImpl)
          || await executableOnPath(candidate.runner, environment, platform, fsImpl));
        if (!commands.some((item) => item.runner === candidate.runner)) {
          const runnerArgs = candidate.runner === 'jest' ? '--runInBand' : '--run';
          commands.push({ id: `${candidate.runner}:config`, command: platform === 'win32'
            ? `.\\node_modules\\.bin\\${candidate.runner}.cmd ${runnerArgs}` : `./node_modules/.bin/${candidate.runner} ${runnerArgs}`,
          runner: candidate.runner, source: candidate.name, kind: 'discovered', available: installed,
          unavailable_reason: installed ? '' : `${candidate.runner} has a config file but is not installed or available on PATH.` });
        }
      }
    }

    const unique = [...new Map(commands.map((item) => [item.command, item])).values()];
    if (new Set(unique.filter((item) => item.available).map((item) => item.runner)).size > 1) {
      issues.push({ source: 'project configuration', message: 'More than one test runner is configured. Choose the exact command and source you intend to run.' });
    }
    return { project_id: projectId, commands: unique, issues, manual_command_supported: true,
      message: unique.length ? '' : 'No recognized test command was found. Enter a command manually to configure a run.' };
  }
  return Object.freeze({ discover });
}

module.exports = { createTestCommandDiscovery, detectNodeRunner, MAX_CONFIG_BYTES };

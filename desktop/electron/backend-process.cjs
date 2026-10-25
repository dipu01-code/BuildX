const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function resolvePython(backendDir, env = process.env) {
  if (env.BUILDX_PYTHON) return env.BUILDX_PYTHON;
  const localPython = process.platform === 'win32'
    ? path.join(backendDir, '.venv', 'Scripts', 'python.exe')
    : path.join(backendDir, '.venv', 'bin', 'python');
  if (fs.existsSync(localPython)) return localPython;
  return process.platform === 'win32' ? 'python' : 'python3';
}

function spawnProcess(command, args, options) {
  return spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
}

function runMigrations({ backendDir, dataDir, env = process.env, spawnImpl = spawnProcess }) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(resolvePython(backendDir, env), ['-m', 'alembic', 'upgrade', 'head'], {
      cwd: backendDir,
      env: { ...env, BUILDX_HOST: '127.0.0.1', BUILDX_DATA_DIR: dataDir },
    });
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error('Database migration timed out.'));
    }, 30000);
    child.stderr?.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-2000); });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`Database migration failed with exit code ${code}: ${stderr}`));
    });
  });
}

function startBackend({ backendDir, dataDir, env = process.env, spawnImpl = spawnProcess }) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(resolvePython(backendDir, env), ['-m', 'app'], {
      cwd: backendDir,
      env: {
        ...env,
        BUILDX_HOST: '127.0.0.1',
        BUILDX_PORT: '0',
        BUILDX_DATA_DIR: dataDir,
      },
    });
    let buffer = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error('Backend startup timed out.'));
    }, 15000);

    function fail(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill();
      reject(error);
    }

    child.once('error', fail);
    child.once('close', (code) => {
      if (!settled) fail(new Error(`Backend exited during startup with code ${code}.`));
    });
    function onOutput(chunk) {
      buffer += chunk.toString();
      let lineEnd = buffer.indexOf('\n');
      while (lineEnd !== -1) {
        const line = buffer.slice(0, lineEnd).trim();
        buffer = buffer.slice(lineEnd + 1);
        try {
          const record = JSON.parse(line);
          if (record.message === 'Backend listening') {
            if (record.host !== '127.0.0.1' || !Number.isInteger(record.port)
              || record.port < 1 || record.port > 65535) {
              fail(new Error('Backend reported an unsafe listening address.'));
              return;
            }
            if (!settled) {
              settled = true;
              clearTimeout(timeout);
              resolve({ child, baseUrl: `http://127.0.0.1:${record.port}` });
            }
          }
        } catch {
          // Ignore non-JSON output until the structured startup line arrives.
        }
        lineEnd = buffer.indexOf('\n');
      }
    }
    child.stderr?.on('data', onOutput);
  });
}

module.exports = { resolvePython, runMigrations, startBackend };

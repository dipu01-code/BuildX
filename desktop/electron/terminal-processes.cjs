const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_COMMAND_CHARS = 4000;
const DEFAULT_RETAINED_SESSIONS = 20;
const TERMINATE_GRACE_MS = 2000;
const OUTPUT_FLUSH_INTERVAL_MS = 40;
const OUTPUT_FLUSH_MAX_BYTES = 16 * 1024;

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function terminalLimits(environment = process.env) {
  return Object.freeze({
    timeoutMs: boundedInteger(environment.BUILDX_TERMINAL_TIMEOUT_MS, 5 * 60 * 1000, 1000, 30 * 60 * 1000),
    maxConcurrent: boundedInteger(environment.BUILDX_TERMINAL_MAX_CONCURRENCY, 2, 1, 4),
    maxOutputBytes: boundedInteger(environment.BUILDX_TERMINAL_MAX_OUTPUT_BYTES, 512 * 1024, 16 * 1024, 2 * 1024 * 1024),
  });
}

function safeEnvironment(environment, cwd, platform) {
  const names = ['PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'COLORTERM'];
  const result = {};
  for (const name of names) {
    const value = environment[name];
    if (typeof value === 'string' && !value.includes('\0')) result[name] = value;
  }
  result.PWD = cwd;
  if (platform === 'win32') {
    for (const name of ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']) {
      const value = environment[name];
      if (typeof value === 'string' && !value.includes('\0')) result[name] = value;
    }
  }
  return result;
}

function createTerminalProcesses({
  getProjectRoot,
  emit = () => {},
  spawnImpl = spawn,
  fsImpl = fs,
  platform = process.platform,
  environment = process.env,
  now = Date.now,
  limits = terminalLimits(environment),
  maxRetainedSessions = DEFAULT_RETAINED_SESSIONS,
} = {}) {
  if (typeof getProjectRoot !== 'function') throw new TypeError('A project-root resolver is required.');
  const sessions = new Map();
  const requests = new Map();

  function snapshot(session) {
    const elapsed = (session.endedAt ?? now()) - session.startedAt;
    return {
      id: session.id, project_id: session.projectId, command: session.command,
      purpose: session.purpose, configuration_source: session.configurationSource, test_runner: session.testRunner,
      working_directory: session.cwd, status: session.status, exit_code: session.exitCode,
      termination_reason: session.terminationReason, created_at: session.createdAt,
      started_at: session.startedAtISO, ended_at: session.endedAtISO,
      elapsed_ms: Math.max(0, elapsed), stdout: session.stdout, stderr: session.stderr,
      output_truncated: session.outputTruncated,
    };
  }

  function publish(session, event) {
    try { emit({ project_id: session.projectId, session_id: session.id, ...event }); }
    catch { /* A disconnected renderer does not affect the child process. */ }
  }

  function prune() {
    const finished = [...sessions.values()].filter((session) => session.endedAt !== null)
      .sort((left, right) => right.startedAt - left.startedAt);
    for (const session of finished.slice(maxRetainedSessions)) {
      sessions.delete(session.id);
      if (requests.get(session.requestId) === session.id) requests.delete(session.requestId);
    }
  }

  function append(session, stream, chunk) {
    const value = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    const bytes = Buffer.byteLength(value, 'utf8');
    const marker = '\n[BUILDX: output limit reached; additional output is discarded]\n';
    const willTruncate = bytes > limits.maxOutputBytes - session.outputBytes;
    const reserve = willTruncate && !session.outputTruncated ? Buffer.byteLength(marker, 'utf8') : 0;
    const available = Math.max(0, limits.maxOutputBytes - session.outputBytes - reserve);
    const accepted = bytes <= available ? value : Buffer.from(value).subarray(0, available).toString('utf8');
    const acceptedBytes = Buffer.byteLength(accepted, 'utf8');
    if (accepted) {
      session[stream] += accepted;
      session.outputBytes += acceptedBytes;
      session.pendingOutput[stream] += accepted;
      session.pendingOutputBytes += acceptedBytes;
      if (session.pendingOutputBytes >= OUTPUT_FLUSH_MAX_BYTES) flushOutput(session);
      else if (!session.outputFlushHandle) {
        session.outputFlushHandle = setTimeout(() => flushOutput(session), OUTPUT_FLUSH_INTERVAL_MS);
        session.outputFlushHandle.unref?.();
      }
    }
    if (acceptedBytes < bytes && !session.outputTruncated) {
      flushOutput(session);
      session.outputTruncated = true;
      session.stderr += marker;
      session.outputBytes += Buffer.byteLength(marker, 'utf8');
      publish(session, { type: 'output', stream: 'system', data: marker });
      publish(session, { type: 'truncated' });
    }
  }

  function flushOutput(session) {
    clearTimeout(session.outputFlushHandle);
    session.outputFlushHandle = null;
    for (const stream of ['stdout', 'stderr']) {
      const data = session.pendingOutput[stream];
      if (data) publish(session, { type: 'output', stream, data });
      session.pendingOutput[stream] = '';
    }
    session.pendingOutputBytes = 0;
  }

  function signal(session, name) {
    if (!session.child?.pid) return false;
    try {
      if (platform !== 'win32' && session.child.detached) process.kill(-session.child.pid, name);
      else session.child.kill(name);
      return true;
    } catch (error) {
      if (error.code === 'ESRCH') return false;
      throw new Error('BUILDX could not signal this process.');
    }
  }

  function finish(session, { code = null, signalName = null, spawnError = false } = {}) {
    if (session.endedAt !== null) return;
    clearTimeout(session.timeoutHandle);
    clearTimeout(session.killHandle);
    session.exitCode = Number.isInteger(code) ? code : null;
    if (spawnError) append(session, 'stderr', 'BUILDX could not start the system command shell. Check the local shell installation and try again.\n');
    flushOutput(session);
    session.endedAt = now();
    session.endedAtISO = new Date(session.endedAt).toISOString();
    if (session.timedOut) {
      session.status = 'timed_out';
      session.terminationReason = 'timeout';
    } else if (session.stopRequested) {
      session.status = 'terminated';
      session.terminationReason = 'user';
    } else if (spawnError || code !== 0) {
      session.status = 'failed';
      session.terminationReason = spawnError ? 'spawn_error' : signalName ? 'signal' : 'exit_code';
    } else {
      session.status = 'succeeded';
      session.terminationReason = null;
    }
    session.child = null;
    publish(session, { type: 'status', session: snapshot(session) });
    prune();
  }

  function shellInvocation(command) {
    if (platform === 'win32') {
      const executable = environment.ComSpec || environment.COMSPEC || 'cmd.exe';
      return { executable, args: ['/d', '/s', '/c', command] };
    }
    return { executable: '/bin/sh', args: ['-c', command] };
  }

  async function start({ projectId, command, requestId, approval, purpose = 'command', configurationSource = null, testRunner = null }) {
    if (typeof projectId !== 'string' || !UUID_PATTERN.test(projectId)) throw new TypeError('A valid project identifier is required.');
    if (typeof requestId !== 'string' || !UUID_PATTERN.test(requestId)) throw new TypeError('A valid terminal request identifier is required.');
    if (!['command', 'test'].includes(purpose) || (purpose === 'test'
      && (typeof configurationSource !== 'string' || !configurationSource.trim() || configurationSource.length > 300
        || typeof testRunner !== 'string' || !testRunner.trim() || testRunner.length > 60))) {
      throw new TypeError('The test run configuration source is invalid.');
    }
    if (typeof command !== 'string' || !command.trim() || command.length > MAX_COMMAND_CHARS || command.includes('\0')) {
      throw new TypeError(`Enter a command of 1 to ${MAX_COMMAND_CHARS} characters.`);
    }
    let root;
    try {
      root = await getProjectRoot(projectId);
      const canonical = await fsImpl.realpath(root);
      const info = await fsImpl.stat(canonical);
      if (!info.isDirectory() || canonical !== root) throw new Error('invalid root');
      if (!approval || approval.project_id !== projectId || approval.command !== command
        || approval.working_directory !== canonical || (purpose === 'test'
          && (approval.source !== configurationSource || approval.runner !== testRunner))) {
        throw new Error('The command or project directory changed after review. Review it again before running.');
      }
      root = canonical;
    } catch (error) {
      if (/changed after review/.test(error.message)) throw error;
      throw new Error('BUILDX could not confirm the selected project folder. Choose the project folder again before running a command.');
    }

    const existingId = requests.get(requestId);
    if (existingId) {
      const existing = sessions.get(existingId);
      if (existing?.projectId === projectId && existing.command === command && existing.cwd === root
        && existing.purpose === purpose && existing.configurationSource === configurationSource && existing.testRunner === testRunner) return snapshot(existing);
      throw new Error('This terminal request identifier was already used for a different command or configuration.');
    }
    const activeCount = [...sessions.values()].filter((session) => session.endedAt === null).length;
    if (activeCount >= limits.maxConcurrent) throw new Error(`BUILDX allows up to ${limits.maxConcurrent} running terminal processes.`);

    const invocation = shellInvocation(command);
    const createdAt = new Date(now()).toISOString();
    const session = {
      id: crypto.randomUUID(), requestId, projectId, command, cwd: root, purpose, configurationSource, testRunner,
      createdAt, startedAt: now(), startedAtISO: new Date().toISOString(), endedAt: null,
      endedAtISO: null, status: 'running', exitCode: null, terminationReason: null,
      stdout: '', stderr: '', outputBytes: 0, outputTruncated: false,
      pendingOutput: { stdout: '', stderr: '' }, pendingOutputBytes: 0, outputFlushHandle: null,
      stopRequested: false, timedOut: false, child: null, timeoutHandle: null, killHandle: null,
    };
    const options = {
      cwd: root,
      env: safeEnvironment(environment, root, platform),
      shell: false,
      detached: platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    };
    session.child = spawnImpl(invocation.executable, invocation.args, options);
    sessions.set(session.id, session);
    requests.set(requestId, session.id);
    publish(session, { type: 'status', session: snapshot(session) });
    session.child.stdout?.on('data', (chunk) => append(session, 'stdout', chunk));
    session.child.stderr?.on('data', (chunk) => append(session, 'stderr', chunk));
    session.child.once('error', () => finish(session, { spawnError: true }));
    session.child.once('close', (code, signalName) => finish(session, { code, signalName }));
    session.timeoutHandle = setTimeout(() => {
      if (session.endedAt !== null) return;
      session.timedOut = true;
      session.terminationReason = 'timeout';
      publish(session, { type: 'timeout_requested' });
      signal(session, 'SIGTERM');
      session.killHandle = setTimeout(() => signal(session, 'SIGKILL'), TERMINATE_GRACE_MS);
    }, limits.timeoutMs);
    session.timeoutHandle.unref?.();
    return snapshot(session);
  }

  function list(projectId) {
    if (typeof projectId !== 'string' || !UUID_PATTERN.test(projectId)) throw new TypeError('A valid project identifier is required.');
    return [...sessions.values()].filter((session) => session.projectId === projectId)
      .sort((left, right) => right.startedAt - left.startedAt).map(snapshot);
  }

  function stop(projectId, sessionId) {
    if (typeof projectId !== 'string' || !UUID_PATTERN.test(projectId)) throw new TypeError('A valid project identifier is required.');
    if (typeof sessionId !== 'string' || !UUID_PATTERN.test(sessionId)) throw new TypeError('A valid process session identifier is required.');
    const session = sessions.get(sessionId);
    if (!session || session.projectId !== projectId) throw new Error('The terminal process session was not found for this project.');
    if (session.endedAt !== null) return { accepted: false, session: snapshot(session) };
    session.stopRequested = true;
    session.terminationReason = 'user';
    signal(session, 'SIGTERM');
    session.killHandle = setTimeout(() => signal(session, 'SIGKILL'), TERMINATE_GRACE_MS);
    session.killHandle.unref?.();
    publish(session, { type: 'stop_requested' });
    return { accepted: true, session_id: session.id, status: session.status };
  }

  async function shutdown() {
    const running = [...sessions.values()].filter((session) => session.endedAt === null);
    if (!running.length) return;
    for (const session of running) {
      session.stopRequested = true;
      try { signal(session, 'SIGTERM'); } catch { /* Best effort during application shutdown. */ }
    }
    await new Promise((resolve) => setTimeout(resolve, TERMINATE_GRACE_MS));
    for (const session of running) {
      if (session.endedAt === null) {
        try { signal(session, 'SIGKILL'); } catch { /* The process may have exited already. */ }
      }
    }
  }

  return Object.freeze({ start, list, stop, shutdown, limits });
}

module.exports = { createTerminalProcesses, MAX_COMMAND_CHARS, terminalLimits, safeEnvironment };

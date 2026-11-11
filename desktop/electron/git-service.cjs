const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const { safeEnvironment } = require('./terminal-processes.cjs');
const { parseRelativePath } = require('./workspace-files.cjs');

const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_PATHS = 100;
const MAX_MESSAGE_CHARS = 5000;
const TIMEOUT_MS = 30 * 1000;

function gitError(message) {
  const error = new Error(message);
  error.safeMessage = true;
  return error;
}

// Parses `git status --porcelain=v2 --branch -z` output.
function parseStatus(output) {
  const entries = output.split('\0');
  const status = { branch: null, detached: false, initial: false, upstream: null, ahead: 0, behind: 0, files: [] };
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry) continue;
    if (entry.startsWith('# ')) {
      const [, key, ...rest] = entry.split(' ');
      const value = rest.join(' ');
      if (key === 'branch.oid') status.initial = value === '(initial)';
      else if (key === 'branch.head') {
        status.detached = value === '(detached)';
        status.branch = status.detached ? null : value;
      } else if (key === 'branch.upstream') status.upstream = value;
      else if (key === 'branch.ab') {
        const match = /^\+(\d+) -(\d+)$/.exec(value);
        if (match) { status.ahead = Number(match[1]); status.behind = Number(match[2]); }
      }
      continue;
    }
    const kind = entry[0];
    let file;
    if (kind === '1' || kind === '2' || kind === 'u') {
      const fields = entry.split(' ');
      const fixedFields = kind === '1' ? 8 : kind === '2' ? 9 : 10;
      file = { path: fields.slice(fixedFields).join(' '), orig_path: null, index: fields[1][0], worktree: fields[1][1], conflicted: kind === 'u' };
      if (kind === '2') { file.orig_path = entries[index + 1]; index += 1; }
    } else if (kind === '?') {
      file = { path: entry.slice(2), orig_path: null, index: '?', worktree: '?', conflicted: false };
    } else continue;
    file.untracked = file.index === '?';
    file.directory = file.path.endsWith('/');
    if (file.directory) file.path = file.path.slice(0, -1);
    file.staged = !file.untracked && !file.conflicted && file.index !== '.';
    file.unstaged = file.untracked || file.conflicted || file.worktree !== '.';
    status.files.push(file);
  }
  return status;
}

function validatePaths(paths) {
  if (!Array.isArray(paths) || !paths.length || paths.length > MAX_PATHS) {
    throw gitError(`Choose 1 to ${MAX_PATHS} files.`);
  }
  for (const value of paths) parseRelativePath(value);
  return paths;
}

function createGitService({
  getProjectRoot, execFileImpl = execFile, fsImpl = fs, environment = process.env, platform = process.platform,
} = {}) {
  if (typeof getProjectRoot !== 'function') throw new TypeError('A project-root resolver is required.');
  // Repository config can name programs for git to run; turn off the ones these commands reach.
  // Filter drivers in .git/config still apply, exactly as when running git in a terminal.
  const globalArgs = [
    '--literal-pathspecs', '-c', 'core.fsmonitor=false', '-c', `core.hooksPath=${platform === 'win32' ? 'NUL' : '/dev/null'}`,
    '-c', 'commit.gpgsign=false', '-c', 'core.pager=cat', '-c', 'color.ui=false',
  ];

  function run(root, args) {
    return new Promise((resolve, reject) => {
      execFileImpl('git', [...globalArgs, ...args], {
        cwd: root,
        env: { ...safeEnvironment(environment, root, platform), GIT_TERMINAL_PROMPT: '0' },
        maxBuffer: MAX_OUTPUT_BYTES, timeout: TIMEOUT_MS, windowsHide: true, encoding: 'utf8',
      }, (error, stdout, stderr) => {
        if (!error) return resolve(stdout);
        if (error.code === 'ENOENT') return reject(gitError('Git is not installed or is not on PATH.'));
        if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return reject(gitError('Git output is larger than 1 MiB.'));
        if (error.killed) return reject(gitError('Git did not finish within 30 seconds.'));
        const detail = String(stderr || '').trim().split('\n').slice(0, 3).join('\n').slice(0, 500);
        return reject(gitError(detail || 'The Git command failed.'));
      });
    });
  }

  // Only a repository whose top level is the confirmed project folder is used, so git never touches files outside it.
  async function repositoryRoot(projectId) {
    const root = await getProjectRoot(projectId);
    let topLevel;
    try { topLevel = (await run(root, ['rev-parse', '--show-toplevel'])).trim(); }
    catch (error) {
      if (/not a git repository/i.test(error.message)) return null;
      throw error;
    }
    if (await fsImpl.realpath(topLevel) !== root) {
      throw gitError('This project folder is inside a larger Git repository. Open the repository root as the project to use source control.');
    }
    return root;
  }

  async function requireRepository(projectId) {
    const root = await repositoryRoot(projectId);
    if (!root) throw gitError('This project folder is not a Git repository.');
    return root;
  }

  async function readStatus(root) {
    return parseStatus(await run(root, ['--no-optional-locks', 'status', '--porcelain=v2', '--branch', '-z', '--untracked-files=normal']));
  }

  async function status(projectId) {
    const root = await repositoryRoot(projectId);
    if (!root) return { project_id: projectId, repository: false };
    return { project_id: projectId, repository: true, ...(await readStatus(root)) };
  }

  async function diff(projectId, relativePath, staged) {
    parseRelativePath(relativePath);
    const root = await requireRepository(projectId);
    const args = ['diff', ...(staged ? ['--cached'] : []), '--no-ext-diff', '--no-textconv', '--', relativePath];
    return { project_id: projectId, path: relativePath, staged: Boolean(staged), diff: await run(root, args) };
  }

  async function stage(projectId, paths) {
    validatePaths(paths);
    const root = await requireRepository(projectId);
    await run(root, ['add', '--all', '--', ...paths]);
    return status(projectId);
  }

  async function unstage(projectId, paths) {
    validatePaths(paths);
    const root = await requireRepository(projectId);
    // `reset` also works before the first commit, unlike `restore --staged`.
    await run(root, ['reset', '--quiet', '--', ...paths]);
    return status(projectId);
  }

  async function commit(projectId, { message, staged_paths: reviewedPaths } = {}) {
    if (typeof message !== 'string' || !message.trim() || message.length > MAX_MESSAGE_CHARS || message.includes('\0')) {
      throw gitError(`Enter a commit message of 1 to ${MAX_MESSAGE_CHARS} characters.`);
    }
    if (!Array.isArray(reviewedPaths) || !reviewedPaths.length) throw gitError('Stage at least one file before committing.');
    const root = await requireRepository(projectId);
    const current = await readStatus(root);
    const stagedNow = current.files.filter((file) => file.staged).flatMap((file) => [file.path, file.orig_path].filter(Boolean)).sort();
    const reviewed = [...reviewedPaths].sort();
    if (stagedNow.length !== reviewed.length || stagedNow.some((value, index) => value !== reviewed[index])) {
      throw gitError('The staged files changed after review. Review the staged files again before committing.');
    }
    await run(root, ['commit', '--quiet', '-m', message]);
    const oid = (await run(root, ['rev-parse', 'HEAD'])).trim();
    return { commit: oid, status: await status(projectId) };
  }

  return Object.freeze({ status, diff, stage, unstage, commit });
}

module.exports = { createGitService, parseStatus, MAX_MESSAGE_CHARS, MAX_PATHS };

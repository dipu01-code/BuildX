const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const path = require('node:path');
const fsConstants = require('node:fs').constants;
const { TextDecoder } = require('node:util');
const ignore = require('ignore');

const MAX_TEXT_FILE_BYTES = 1024 * 1024;
const MAX_DIRECTORY_ENTRIES = 5000;
const MAX_INDEX_FILES = 5000;
const MAX_INDEX_BYTES = 25 * 1024 * 1024;
const MAX_IGNORE_FILE_BYTES = 256 * 1024;
const GENERATED_DIRECTORIES = new Set([
  '.git', 'node_modules', 'bower_components', 'vendor', 'dist', 'build', 'out', 'coverage',
  '.next', '.nuxt', '.cache', '.turbo', '.parcel-cache', '.vite', '.venv', 'venv', 'env',
  '.tox', '.mypy_cache', '.pytest_cache', '.ruff_cache', '__pycache__', 'target', '.idea',
]);
const SENSITIVE_DIRECTORIES = new Set(['.git', '.aws', '.ssh', 'secrets', 'credentials', 'certificates']);
const SENSITIVE_FILE_PATTERNS = [
  /^\.env(?:\..*)?$/i, /^\.npmrc$/i, /^\.pypirc$/i, /^\.netrc$/i, /^\.dockercfg$/i,
  /^(?:credentials|secrets|auth)(?:\.[^.]+)?$/i, /^service-account.*\.json$/i,
  /(?:^|[._-])(?:secret|credential|password|token)(?:[._-]|$)/i,
  /\.(?:pem|key|p12|pfx|p7b|p7c|jks|keystore)$/i,
  /^(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)$/i,
];
const PRIVATE_KEY_CONTENT = /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----|-----BEGIN PGP PRIVATE KEY BLOCK-----/i;
const SECRET_ASSIGNMENT_CONTENT = /(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["']?(?:sk-[a-z0-9_-]{12,}|gh[pousr]_[a-z0-9]{12,}|AKIA[0-9A-Z]{16}|[a-z0-9/+_=-]{32,})/i;

function controlledError(message, code = 'WORKSPACE_ERROR') {
  const error = new Error(message);
  error.code = code;
  error.safeMessage = true;
  return error;
}

function parseRelativePath(value, { allowRoot = false } = {}) {
  if (typeof value !== 'string' || value.length > 2048 || value.includes('\0')) {
    throw controlledError('Choose a valid project-relative path.', 'INVALID_PATH');
  }
  if (value === '' && allowRoot) return [];
  if (!value || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)
    || /^[a-z]:/i.test(value) || value.startsWith('\\')) {
    throw controlledError('Absolute paths are not allowed inside a project.', 'INVALID_PATH');
  }
  const segments = value.split(/[\\/]/);
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes(':'))) {
    throw controlledError('The project path contains an invalid path segment.', 'INVALID_PATH');
  }
  return segments;
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

async function readBounded(handle, maximum) {
  const buffer = Buffer.alloc(maximum + 1);
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  return offset > maximum ? null : buffer.subarray(0, offset);
}

function safeOperation(operation) {
  return async (...args) => {
    try { return await operation(...args); }
    catch (error) {
      if (error?.safeMessage) throw error;
      const messages = {
        ENOENT: 'The requested workspace item no longer exists.',
        EACCES: 'The workspace operation was denied by the operating system.',
        EPERM: 'The workspace operation was denied by the operating system.',
        EEXIST: 'An item with that name already exists.',
        ENOTDIR: 'A parent path is not a directory.',
        EISDIR: 'The selected item is a folder, not a file.',
        ENOTEMPTY: 'The folder is not empty.',
      };
      throw controlledError(messages[error?.code] || 'The workspace operation could not be completed.');
    }
  };
}

function createWorkspaceFiles({ fsImpl = fs, platform = process.platform } = {}) {
  const authorizedRoots = new Map();
  function getRevision(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }

  async function getRoot(projectApi, projectId) {
    const project = await projectApi.getProject(projectId);
    if (!project.root_path) throw controlledError('Choose a project directory before opening its workspace.', 'NO_PROJECT_DIRECTORY');
    const authorizedRoot = authorizedRoots.get(projectId);
    if (!authorizedRoot) {
      throw controlledError('Confirm this project folder with the native folder picker before opening its workspace.', 'PROJECT_DIRECTORY_NOT_CONFIRMED');
    }
    let root;
    try {
      root = await fsImpl.realpath(project.root_path);
      const stats = await fsImpl.stat(root);
      if (!stats.isDirectory()) throw new Error('not a directory');
    } catch {
      throw controlledError('The project directory is missing or inaccessible. Choose it again to continue.', 'PROJECT_DIRECTORY_UNAVAILABLE');
    }
    if (root !== authorizedRoot) {
      authorizedRoots.delete(projectId);
      throw controlledError('The saved project folder changed. Choose it again to confirm workspace access.', 'PROJECT_DIRECTORY_CHANGED');
    }
    return root;
  }

  async function resolvePath(root, relativePath, { allowRoot = false, allowMissingFinal = false } = {}) {
    const segments = parseRelativePath(relativePath, { allowRoot });
    const candidate = path.resolve(root, ...segments);
    if (!isWithin(root, candidate)) throw controlledError('The requested path is outside the project.', 'PATH_OUTSIDE_PROJECT');
    let current = root;
    for (let index = 0; index < segments.length; index += 1) {
      current = path.join(current, segments[index]);
      try {
        const stats = await fsImpl.lstat(current);
        if (stats.isSymbolicLink()) throw controlledError('Symbolic links are not available in the workspace.', 'SYMLINK_BLOCKED');
        if (index < segments.length - 1 && !stats.isDirectory()) {
          throw controlledError('A parent path is not a directory.', 'INVALID_PATH');
        }
      } catch (error) {
        if (error.code === 'ENOENT' && allowMissingFinal && index === segments.length - 1) break;
        throw error;
      }
    }
    if (segments.length && !allowMissingFinal) {
      const resolved = await fsImpl.realpath(candidate);
      if (!isWithin(root, resolved)) throw controlledError('The requested path resolves outside the project.', 'PATH_OUTSIDE_PROJECT');
      return { target: resolved, segments };
    }
    if (segments.length && allowMissingFinal) {
      const parent = await fsImpl.realpath(path.dirname(candidate));
      if (!isWithin(root, parent)) throw controlledError('The requested path resolves outside the project.', 'PATH_OUTSIDE_PROJECT');
    }
    return { target: candidate, segments };
  }

  async function withRoot(projectApi, projectId, callback) {
    const root = await getRoot(projectApi, projectId);
    return callback(root);
  }

  async function list(projectApi, projectId, relativePath = '') {
    return withRoot(projectApi, projectId, async (root) => {
      const { target } = await resolvePath(root, relativePath, { allowRoot: true });
      const stats = await fsImpl.stat(target);
      if (!stats.isDirectory()) throw controlledError('Choose a folder to browse.', 'NOT_A_DIRECTORY');
      const directory = await fsImpl.opendir(target);
      const names = [];
      for await (const entry of directory) {
        names.push(entry.name);
        if (names.length > MAX_DIRECTORY_ENTRIES) {
          await directory.close();
          throw controlledError('This folder has too many items to display.', 'DIRECTORY_TOO_LARGE');
        }
      }
      const entries = await Promise.all(names.map(async (name) => {
        const childPath = path.join(target, name);
        try {
          const info = await fsImpl.lstat(childPath);
          if (info.isSymbolicLink()) return { name, path: relativePath ? `${relativePath}/${name}` : name, type: 'symlink', size: null };
          return {
            name,
            path: relativePath ? `${relativePath}/${name}` : name,
            type: info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other',
            size: info.isFile() ? info.size : null,
          };
        } catch {
          return { name, path: relativePath ? `${relativePath}/${name}` : name, type: 'unavailable', size: null };
        }
      }));
      entries.sort((left, right) => {
        const typeOrder = (entry) => entry.type === 'directory' ? 0 : 1;
        return typeOrder(left) - typeOrder(right) || left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
      });
      return { path: relativePath, entries };
    });
  }

  async function readText(projectApi, projectId, relativePath) {
    return withRoot(projectApi, projectId, async (root) => {
      const { target } = await resolvePath(root, relativePath);
      let handle;
      try {
        handle = await fsImpl.open(target, 'r');
        const info = await handle.stat();
        if (!info.isFile()) throw controlledError('Only regular text files can be previewed.', 'NOT_A_FILE');
        if (info.size > MAX_TEXT_FILE_BYTES) throw controlledError('This file is too large to preview (1 MiB maximum).', 'FILE_TOO_LARGE');
        const buffer = Buffer.alloc(info.size);
        const { bytesRead } = await handle.read(buffer, 0, info.size, 0);
        const contentBytes = buffer.subarray(0, bytesRead);
        if (contentBytes.includes(0)) throw controlledError('This file appears to be binary and cannot be previewed as text.', 'BINARY_FILE');
        let content;
        try { content = new TextDecoder('utf-8', { fatal: true }).decode(contentBytes); }
        catch { throw controlledError('This file is not valid UTF-8 text and cannot be previewed.', 'INVALID_TEXT'); }
        return { path: relativePath, content, size: info.size, encoding: 'utf-8', revision: getRevision(contentBytes) };
      } finally {
        await handle?.close();
      }
    });
  }

  async function inspectProposalTarget(projectApi, projectId, relativePath) {
    return withRoot(projectApi, projectId, async (root) => {
      const segments = parseRelativePath(relativePath);
      if (segments.some((segment) => SENSITIVE_DIRECTORIES.has(segment.toLowerCase())
        || SENSITIVE_FILE_PATTERNS.some((pattern) => pattern.test(segment)))) {
        throw controlledError('This protected or sensitive path cannot be used for a proposal.', 'PROTECTED_PATH');
      }
      const { target } = await resolvePath(root, relativePath, { allowMissingFinal: true });
      try {
        const info = await fsImpl.lstat(target);
        if (info.isSymbolicLink() || !info.isFile()) throw controlledError('Choose a regular text file for a proposal.', 'INVALID_PROPOSAL_TARGET');
        if (info.size > MAX_TEXT_FILE_BYTES) throw controlledError('The target file exceeds the 1 MiB proposal limit.', 'FILE_TOO_LARGE');
        const bytes = await fsImpl.readFile(target);
        if (bytes.includes(0)) throw controlledError('Binary files cannot be proposed for editing.', 'BINARY_FILE');
        let content;
        try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
        catch { throw controlledError('The target file is not valid UTF-8 text.', 'INVALID_TEXT'); }
        if (PRIVATE_KEY_CONTENT.test(content) || SECRET_ASSIGNMENT_CONTENT.test(content)) {
          throw controlledError('Files containing likely credentials cannot be sent for proposal generation.', 'SENSITIVE_CONTENT');
        }
        return { exists: true, content, hash: getRevision(bytes) };
      } catch (error) {
        if (error.code === 'ENOENT') return { exists: false, content: null, hash: null };
        throw error;
      }
    });
  }

  async function createFile(projectApi, projectId, relativePath) {
    return withRoot(projectApi, projectId, async (root) => {
      const { target } = await resolvePath(root, relativePath, { allowMissingFinal: true });
      const handle = await fsImpl.open(target, 'wx', 0o600);
      await handle.close();
      return { path: relativePath };
    });
  }

  async function writeText(projectApi, projectId, relativePath, content, expectedRevision) {
    return withRoot(projectApi, projectId, async (root) => {
      if (typeof content !== 'string' || typeof expectedRevision !== 'string' || !/^[0-9a-f]{64}$/.test(expectedRevision)) {
        throw controlledError('The file content or save revision is invalid.', 'INVALID_SAVE');
      }
      const contentBytes = Buffer.from(content, 'utf8');
      if (contentBytes.length > MAX_TEXT_FILE_BYTES) {
        throw controlledError('This file exceeds the 1 MiB editor limit and cannot be saved.', 'FILE_TOO_LARGE');
      }
      const initial = await resolvePath(root, relativePath);
      const initialStats = await fsImpl.stat(initial.target);
      if (!initialStats.isFile()) throw controlledError('Only regular files can be saved from the editor.', 'NOT_A_FILE');
      if (initialStats.size > MAX_TEXT_FILE_BYTES) {
        throw controlledError('This file is now larger than the 1 MiB editor limit. Your unsaved edits are still available; save them as a copy or review the file outside BUILDX.', 'FILE_CONFLICT');
      }
      const current = await fsImpl.readFile(initial.target);
      if (getRevision(current) !== expectedRevision) {
        throw controlledError('This file changed on disk since it was opened. Your unsaved edits are still available; save them as a copy or reload the latest file.', 'FILE_CONFLICT');
      }
      const parent = path.dirname(initial.target);
      const temporaryPath = path.join(parent, `.buildx-${crypto.randomUUID()}.tmp`);
      let handle;
      try {
        handle = await fsImpl.open(temporaryPath, 'wx', initialStats.mode & 0o777);
        await handle.writeFile(contentBytes);
        await handle.sync();
        await handle.close();
        handle = null;
        const latest = await resolvePath(root, relativePath);
        if ((await fsImpl.stat(latest.target)).size > MAX_TEXT_FILE_BYTES) {
          throw controlledError('This file grew beyond the 1 MiB editor limit while saving. Your unsaved edits are still available; save them as a copy or review the file outside BUILDX.', 'FILE_CONFLICT');
        }
        const latestBytes = await fsImpl.readFile(latest.target);
        if (getRevision(latestBytes) !== expectedRevision) {
          throw controlledError('This file changed on disk while saving. Your unsaved edits are still available; save them as a copy or reload the latest file.', 'FILE_CONFLICT');
        }
        await fsImpl.rename(temporaryPath, latest.target);
        return { path: relativePath, size: contentBytes.length, revision: getRevision(contentBytes) };
      } finally {
        await handle?.close();
        await fsImpl.rm(temporaryPath, { force: true }).catch(() => {});
      }
    });
  }

  async function applyProposal(projectApi, projectId, proposal) {
    return withRoot(projectApi, projectId, async (root) => {
      if (proposal?.status !== 'approved') throw controlledError('Only an explicitly approved proposal can be applied.', 'PROPOSAL_NOT_APPROVED');
      const operation = proposal?.operation;
      if (!operation || !['create', 'modify'].includes(operation.operation)
        || typeof operation.proposed_content !== 'string' || Buffer.byteLength(operation.proposed_content, 'utf8') > MAX_TEXT_FILE_BYTES) {
        throw controlledError('The approved proposal is invalid or too large.', 'INVALID_PROPOSAL');
      }
      const segments = parseRelativePath(operation.relative_path);
      if (segments.some((segment) => SENSITIVE_DIRECTORIES.has(segment.toLowerCase())
        || SENSITIVE_FILE_PATTERNS.some((pattern) => pattern.test(segment)))) {
        throw controlledError('This protected or sensitive path cannot be changed by a proposal.', 'PROTECTED_PATH');
      }
      const initial = await resolvePath(root, operation.relative_path, { allowMissingFinal: operation.operation === 'create' });
      let originalBytes = null;
      let mode = 0o600;
      if (operation.operation === 'modify') {
        if (!/^[0-9a-f]{64}$/.test(operation.original_hash || '')) throw controlledError('The approved base version is invalid.', 'INVALID_PROPOSAL');
        const info = await fsImpl.stat(initial.target);
        if (!info.isFile() || info.size > MAX_TEXT_FILE_BYTES) throw controlledError('The target is not an editable text file.', 'FILE_TOO_LARGE');
        mode = info.mode & 0o777;
        originalBytes = await fsImpl.readFile(initial.target);
        if (getRevision(originalBytes) !== operation.original_hash) throw controlledError('The file changed since review. Regenerate and review a new proposal.', 'FILE_CONFLICT');
        if (originalBytes.includes(0)) throw controlledError('Binary files cannot be changed by a proposal.', 'BINARY_FILE');
      } else if (operation.original_hash !== null) {
        throw controlledError('The new file proposal has an invalid base version.', 'INVALID_PROPOSAL');
      }
      const contentBytes = Buffer.from(operation.proposed_content, 'utf8');
      const parent = path.dirname(initial.target);
      const temporaryPath = path.join(parent, `.buildx-${crypto.randomUUID()}.tmp`);
      let handle;
      try {
        handle = await fsImpl.open(temporaryPath, 'wx', mode);
        await handle.writeFile(contentBytes);
        await handle.sync();
        await handle.close();
        handle = null;
        const latest = await resolvePath(root, operation.relative_path, { allowMissingFinal: operation.operation === 'create' });
        if (operation.operation === 'create') {
          await fsImpl.link(temporaryPath, latest.target);
          await fsImpl.unlink(temporaryPath);
        } else {
          const latestBytes = await fsImpl.readFile(latest.target);
          if (getRevision(latestBytes) !== operation.original_hash) throw controlledError('The file changed while applying the proposal. Regenerate and review a new proposal.', 'FILE_CONFLICT');
          await fsImpl.rename(temporaryPath, latest.target);
        }
        return { path: operation.relative_path, result_hash: getRevision(contentBytes), status: 'applied' };
      } finally {
        await handle?.close();
        await fsImpl.rm(temporaryPath, { force: true }).catch(() => {});
      }
    });
  }

  async function createFolder(projectApi, projectId, relativePath) {
    return withRoot(projectApi, projectId, async (root) => {
      const { target } = await resolvePath(root, relativePath, { allowMissingFinal: true });
      await fsImpl.mkdir(target, { mode: 0o700 });
      return { path: relativePath };
    });
  }

  async function move(projectApi, projectId, fromPath, toPath) {
    return withRoot(projectApi, projectId, async (root) => {
      const source = await resolvePath(root, fromPath, { allowRoot: true });
      if (source.segments.length === 0) throw controlledError('The project root cannot be renamed or moved.', 'PROJECT_ROOT_PROTECTED');
      const destination = await resolvePath(root, toPath, { allowMissingFinal: true });
      if (destination.segments.length === 0) throw controlledError('The project root cannot be replaced.', 'PROJECT_ROOT_PROTECTED');
      const info = await fsImpl.lstat(source.target);
      if (info.isDirectory() && isWithin(source.target, destination.target)) {
        throw controlledError('A folder cannot be moved into itself or one of its children.', 'MOVE_INTO_DESCENDANT');
      }
      // Refuse an already existing destination; path-based APIs cannot close every race with other local processes.
      try {
        await fsImpl.lstat(destination.target);
        throw controlledError('An item with that name already exists.', 'DESTINATION_EXISTS');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      try { await fsImpl.rename(source.target, destination.target); }
      catch (error) {
        if (error.code === 'EXDEV') throw controlledError('The item could not be moved across filesystems. Choose a destination on the same filesystem.', 'CROSS_DEVICE_MOVE');
        throw error;
      }
      return { fromPath, path: toPath };
    });
  }

  async function remove(projectApi, projectId, relativePath) {
    return withRoot(projectApi, projectId, async (root) => {
      const item = await resolvePath(root, relativePath, { allowRoot: true });
      if (item.segments.length === 0) throw controlledError('The project root cannot be deleted.', 'PROJECT_ROOT_PROTECTED');
      const info = await fsImpl.lstat(item.target);
      await fsImpl.rm(item.target, { recursive: info.isDirectory(), force: false });
      return { path: relativePath };
    });
  }

  async function chooseDirectory(projectApi, projectId, dialog, window) {
    const project = await projectApi.getProject(projectId);
    const result = await dialog.showOpenDialog(window, {
      title: `Choose a folder for ${project.name}`,
      properties: ['openDirectory', 'createDirectory'],
      ...(platform === 'darwin' ? { securityScopedBookmarks: true } : {}),
    });
    if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
    let canonical;
    try {
      canonical = await fsImpl.realpath(result.filePaths[0]);
      if (!(await fsImpl.stat(canonical)).isDirectory()) throw new Error('not a directory');
    } catch {
      throw controlledError('The selected location is not an accessible directory.', 'INVALID_PROJECT_DIRECTORY');
    }
    const updated = await projectApi.updateProject(projectId, { root_path: canonical });
    authorizedRoots.set(projectId, canonical);
    return { canceled: false, project: updated };
  }

  async function readIgnoreMatcher(directory) {
    const ignorePath = path.join(directory, '.gitignore');
    let handle;
    try {
      const linkInfo = await fsImpl.lstat(ignorePath);
      if (linkInfo.isSymbolicLink() || !linkInfo.isFile()) {
        return { matcher: null, error: 'The .gitignore file is not a regular file.' };
      }
      if (linkInfo.size > MAX_IGNORE_FILE_BYTES) {
        return { matcher: null, error: 'The .gitignore file exceeds the 256 KiB limit.' };
      }
      handle = await fsImpl.open(ignorePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
      const openedInfo = await handle.stat();
      if (!openedInfo.isFile() || openedInfo.size > MAX_IGNORE_FILE_BYTES
        || openedInfo.ino !== linkInfo.ino || openedInfo.dev !== linkInfo.dev) {
        return { matcher: null, error: 'The .gitignore file changed while it was being read.' };
      }
      const bytes = await readBounded(handle, MAX_IGNORE_FILE_BYTES);
      if (!bytes) return { matcher: null, error: 'The .gitignore file exceeds the 256 KiB limit.' };
      const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return { matcher: ignore().add(source), error: null };
    } catch (error) {
      if (error.code === 'ENOENT') return { matcher: null, error: null };
      return { matcher: null, error: error instanceof TypeError
        ? 'The .gitignore file is not valid UTF-8 text.'
        : 'The .gitignore file could not be read.' };
    } finally {
      await handle?.close().catch(() => {});
    }
  }

  function ignoredByRules(relativePath, ancestors, isDirectory) {
    return ancestors.some(({ base, matcher }) => {
      const localPath = base ? path.posix.relative(base, relativePath) : relativePath;
      return localPath && matcher.ignores(isDirectory ? `${localPath}/` : localPath);
    });
  }

  async function discoverIndexableFiles(projectApi, projectId, existingFiles = []) {
    const root = await getRoot(projectApi, projectId);
    const knownFiles = new Map(existingFiles.map((file) => [file.relative_path, file]));
    const counters = {
      discoveredCount: 0, processedCount: 0, skippedCount: 0, totalBytes: 0,
      skipReasons: {}, errors: [], preservePaths: [], incomplete: false,
    };

    function skip(reason, relativePath, message = null, incomplete = false, retainPrior = false) {
      counters.skippedCount += 1;
      counters.skipReasons[reason] = (counters.skipReasons[reason] || 0) + 1;
      if (message && counters.errors.length < 100) {
        counters.errors.push({ path: relativePath || '', message });
      }
      if (incomplete) counters.incomplete = true;
      if (retainPrior && relativePath && counters.preservePaths.length < MAX_INDEX_FILES) {
        counters.preservePaths.push(relativePath);
      }
      return { type: 'skip', reason, path: relativePath || '' };
    }

    const iterate = async function* iterate() {
      const stack = [{ absolute: root, relative: '', ancestors: [] }];
      let visitedEntries = 0;
      let reachedLimit = false;
      while (stack.length && !reachedLimit) {
        const directory = stack.pop();
        let ancestors = directory.ancestors;
        const localIgnore = await readIgnoreMatcher(directory.absolute);
        if (localIgnore.error) yield skip('ignore_file_error', directory.relative, localIgnore.error, true);
        if (localIgnore.matcher) ancestors = [...ancestors, { base: directory.relative, matcher: localIgnore.matcher }];

        let handle;
        try {
          handle = await fsImpl.opendir(directory.absolute);
          const entries = [];
          for await (const entry of handle) {
            entries.push(entry);
            visitedEntries += 1;
            if (visitedEntries > MAX_INDEX_FILES * 4) {
              yield skip('entry_limit', directory.relative, 'The project exceeds the 20,000-entry indexing limit.', true);
              reachedLimit = true;
              break;
            }
          }
          entries.sort((left, right) => left.name.localeCompare(right.name));
          const children = [];
          for (const entry of entries) {
            if (reachedLimit) break;
            const relativePath = directory.relative ? `${directory.relative}/${entry.name}` : entry.name;
            if (entry.name.includes('\\') || entry.name.includes(':') || entry.name === '.' || entry.name === '..') {
              yield skip('invalid_path', relativePath);
              continue;
            }
            let info;
            try { info = await fsImpl.lstat(path.join(directory.absolute, entry.name)); }
            catch (error) {
              yield skip('unreadable', relativePath, error.code === 'ENOENT'
                ? 'The file disappeared during indexing.' : 'The file could not be inspected.', false, error.code !== 'ENOENT');
              continue;
            }
            if (info.isSymbolicLink()) {
              yield skip('symlink', relativePath);
              continue;
            }
            if (info.isDirectory()) {
              if (SENSITIVE_DIRECTORIES.has(entry.name.toLowerCase())) {
                yield skip('sensitive_directory', relativePath);
                continue;
              }
              if (GENERATED_DIRECTORIES.has(entry.name.toLowerCase())) {
                yield skip('generated_directory', relativePath);
                continue;
              }
              if (ignoredByRules(relativePath, ancestors, true)) {
                yield skip('gitignore', relativePath);
                continue;
              }
              children.push({ absolute: path.join(directory.absolute, entry.name), relative: relativePath, ancestors });
              continue;
            }
            if (!info.isFile()) {
              yield skip('unsupported_file_type', relativePath);
              continue;
            }
            counters.discoveredCount += 1;
            if (counters.discoveredCount > MAX_INDEX_FILES) {
              counters.discoveredCount = MAX_INDEX_FILES;
              yield skip('file_limit', relativePath, 'The project exceeds the 5,000-file indexing limit.', true);
              reachedLimit = true;
              break;
            }
            if (ignoredByRules(relativePath, ancestors, false)) {
              yield skip('gitignore', relativePath);
              continue;
            }
            const filename = path.posix.basename(relativePath);
            const sensitive = SENSITIVE_FILE_PATTERNS.some((pattern) => pattern.test(filename));
            if (sensitive) {
              yield skip('sensitive_file', relativePath);
              continue;
            }
            if (info.size > MAX_TEXT_FILE_BYTES) {
              yield skip('file_too_large', relativePath, 'The file exceeds the 1 MiB per-file limit.');
              continue;
            }
            if (counters.totalBytes + info.size > MAX_INDEX_BYTES) {
              yield skip('project_size_limit', relativePath, 'The project exceeds the 25 MiB indexing limit.', true);
              reachedLimit = true;
              break;
            }
            let fileHandle;
            try {
              const { target } = await resolvePath(root, relativePath);
              fileHandle = await fsImpl.open(target, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
              const openedInfo = await fileHandle.stat();
              if (!openedInfo.isFile() || openedInfo.size > MAX_TEXT_FILE_BYTES
                || openedInfo.ino !== info.ino || openedInfo.dev !== info.dev
                || openedInfo.size !== info.size || openedInfo.mtimeMs !== info.mtimeMs) {
                yield skip('file_changed', relativePath, 'The file changed while indexing; refresh to retry it.', false, true);
                continue;
              }
              const bytes = await readBounded(fileHandle, MAX_TEXT_FILE_BYTES);
              if (!bytes) {
                yield skip('file_too_large', relativePath, 'The file grew beyond the 1 MiB per-file limit.');
                continue;
              }
              const afterRead = await fileHandle.stat();
              if (afterRead.ino !== openedInfo.ino || afterRead.size !== openedInfo.size
                || afterRead.mtimeMs !== openedInfo.mtimeMs || bytes.length !== openedInfo.size) {
                yield skip('file_changed', relativePath, 'The file changed while indexing; refresh to retry it.', false, true);
                continue;
              }
              if (bytes.includes(0)) {
                yield skip('binary_file', relativePath);
                continue;
              }
              let content;
              try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
              catch {
                yield skip('invalid_text', relativePath, 'The file is not valid UTF-8 text.');
                continue;
              }
              if (PRIVATE_KEY_CONTENT.test(content) || SECRET_ASSIGNMENT_CONTENT.test(content)) {
                yield skip('sensitive_content', relativePath);
                continue;
              }
              counters.totalBytes += bytes.length;
              counters.processedCount += 1;
              const contentHash = crypto.createHash('sha256').update(bytes).digest('hex');
              const known = knownFiles.get(relativePath);
              yield {
                type: 'file',
                file: {
                  relative_path: relativePath,
                  content_hash: contentHash,
                  file_size: bytes.length,
                  modified_at_ms: Math.max(0, Math.trunc(openedInfo.mtimeMs)),
                  content: known?.content_hash === contentHash ? null : content,
                },
              };
            } catch (error) {
              const reason = error?.code === 'SYMLINK_BLOCKED' || error?.code === 'PATH_OUTSIDE_PROJECT'
                ? 'symlink' : error?.code === 'ENOENT' ? 'file_changed' : 'unreadable';
              yield skip(reason, relativePath, reason === 'file_changed'
                ? 'The file disappeared while indexing.'
                : 'The file could not be read. Check its permissions and refresh.', false,
              reason === 'unreadable');
            } finally {
              await fileHandle?.close().catch(() => {});
            }
          }
          // An explicit stack prevents deeply nested folders from exhausting the JS call stack.
          stack.push(...children.reverse());
        } catch {
          yield skip('unreadable_directory', directory.relative, 'A project folder could not be read.', true);
        } finally {
          await handle?.close().catch(() => {});
        }
      }
    };

    return Object.freeze({ iterate, summary: () => ({
      ...counters, skipReasons: { ...counters.skipReasons }, errors: [...counters.errors],
      preservePaths: [...counters.preservePaths],
    }) });
  }

  return Object.freeze({
    list: safeOperation(list),
    readText: safeOperation(readText),
    inspectProposalTarget: safeOperation(inspectProposalTarget),
    writeText: safeOperation(writeText),
    applyProposal: safeOperation(applyProposal),
    createFile: safeOperation(createFile),
    createFolder: safeOperation(createFolder),
    move: safeOperation(move),
    remove: safeOperation(remove),
    chooseDirectory: safeOperation(chooseDirectory),
    discoverIndexableFiles: safeOperation(discoverIndexableFiles),
  });
}

module.exports = {
  MAX_TEXT_FILE_BYTES, MAX_INDEX_FILES, MAX_INDEX_BYTES, createWorkspaceFiles, isWithin, parseRelativePath,
};

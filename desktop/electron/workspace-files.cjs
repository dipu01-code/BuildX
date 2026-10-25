const fs = require('node:fs/promises');
const path = require('node:path');
const { TextDecoder } = require('node:util');

const MAX_TEXT_FILE_BYTES = 1024 * 1024;
const MAX_DIRECTORY_ENTRIES = 5000;

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
  async function getRoot(projectApi, projectId) {
    const project = await projectApi.getProject(projectId);
    if (!project.root_path) throw controlledError('Choose a project directory before opening its workspace.', 'NO_PROJECT_DIRECTORY');
    let root;
    try {
      root = await fsImpl.realpath(project.root_path);
      const stats = await fsImpl.stat(root);
      if (!stats.isDirectory()) throw new Error('not a directory');
    } catch {
      throw controlledError('The project directory is missing or inaccessible. Choose it again to continue.', 'PROJECT_DIRECTORY_UNAVAILABLE');
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
        return { path: relativePath, content, size: info.size, encoding: 'utf-8' };
      } finally {
        await handle?.close();
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
    return { canceled: false, project: updated };
  }

  return Object.freeze({
    list: safeOperation(list),
    readText: safeOperation(readText),
    createFile: safeOperation(createFile),
    createFolder: safeOperation(createFolder),
    move: safeOperation(move),
    remove: safeOperation(remove),
    chooseDirectory: safeOperation(chooseDirectory),
  });
}

module.exports = { MAX_TEXT_FILE_BYTES, createWorkspaceFiles, isWithin, parseRelativePath };

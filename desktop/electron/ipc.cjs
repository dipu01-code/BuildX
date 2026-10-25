const APP_INFO_CHANNEL = 'app:get-info';
const PROJECT_CHANNELS = Object.freeze({
  list: 'projects:list',
  get: 'projects:get',
  create: 'projects:create',
  update: 'projects:update',
  delete: 'projects:delete',
});
const WORKSPACE_CHANNELS = Object.freeze({
  chooseDirectory: 'workspace:choose-directory',
  list: 'workspace:list',
  readText: 'workspace:read-text',
  createFile: 'workspace:create-file',
  createFolder: 'workspace:create-folder',
  move: 'workspace:move',
  delete: 'workspace:delete',
});

const PROJECT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROJECT_FIELDS = new Set(['name', 'description', 'project_type']);

function validateProjectId(value) {
  if (typeof value !== 'string' || !PROJECT_ID_PATTERN.test(value)) {
    throw new TypeError('A valid project identifier is required.');
  }
}

function validateProjectPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Project data must be an object.');
  }
  for (const [field, fieldValue] of Object.entries(value)) {
    if (!PROJECT_FIELDS.has(field)) throw new TypeError('Unsupported project field.');
    if (fieldValue !== null && typeof fieldValue !== 'string') {
      throw new TypeError('Project fields must be text or null.');
    }
  }
  if ('name' in value && (typeof value.name !== 'string' || !value.name.trim())) {
    throw new TypeError('A non-empty project name is required.');
  }
}

function validateRelativePath(value, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || value.length > 2048 || (!allowEmpty && !value)) {
    throw new TypeError('A valid project-relative path is required.');
  }
  if (!value && allowEmpty) return;
  if (value.startsWith('/') || value.startsWith('\\') || /^[a-z]:/i.test(value)) {
    throw new TypeError('Workspace paths must be relative to the project.');
  }
  if (value.split(/[\\/]/).some((segment) => !segment || segment === '.' || segment === '..' || segment.includes(':'))) {
    throw new TypeError('Workspace paths contain an invalid path segment.');
  }
}

function registerIpcHandlers({
  ipcMain, validateSender, getAppInfo,
  listProjects, getProject, createProject, updateProject, deleteProject,
  chooseProjectDirectory, listWorkspaceDirectory, readWorkspaceText,
  createWorkspaceFile, createWorkspaceFolder, moveWorkspaceItem, deleteWorkspaceItem,
}) {
  ipcMain.handle(APP_INFO_CHANNEL, (event, ...args) => {
    validateSender(event);
    if (args.length !== 0) {
      throw new TypeError('app:get-info does not accept arguments.');
    }
    return getAppInfo();
  });

  ipcMain.handle(PROJECT_CHANNELS.list, (event, ...args) => {
    validateSender(event);
    if (args.length !== 0) throw new TypeError('projects:list does not accept arguments.');
    return listProjects();
  });

  ipcMain.handle(PROJECT_CHANNELS.get, (event, ...args) => {
    validateSender(event);
    if (args.length !== 1) throw new TypeError('projects:get requires one project identifier.');
    validateProjectId(args[0]);
    return getProject(args[0]);
  });

  ipcMain.handle(PROJECT_CHANNELS.create, (event, ...args) => {
    validateSender(event);
    if (args.length !== 1) throw new TypeError('projects:create requires one project object.');
    validateProjectPayload(args[0]);
    return createProject(args[0]);
  });

  ipcMain.handle(PROJECT_CHANNELS.update, (event, ...args) => {
    validateSender(event);
    if (args.length !== 2) throw new TypeError('projects:update requires an identifier and project object.');
    validateProjectId(args[0]);
    validateProjectPayload(args[1]);
    return updateProject(args[0], args[1]);
  });

  ipcMain.handle(PROJECT_CHANNELS.delete, (event, ...args) => {
    validateSender(event);
    if (args.length !== 1) throw new TypeError('projects:delete requires one project identifier.');
    validateProjectId(args[0]);
    return deleteProject(args[0]);
  });

  ipcMain.handle(WORKSPACE_CHANNELS.chooseDirectory, (event, ...args) => {
    validateSender(event);
    if (args.length !== 1) throw new TypeError('workspace:choose-directory requires one project identifier.');
    validateProjectId(args[0]);
    return chooseProjectDirectory(args[0]);
  });

  ipcMain.handle(WORKSPACE_CHANNELS.list, (event, ...args) => {
    validateSender(event);
    if (args.length !== 2) throw new TypeError('workspace:list requires a project identifier and relative path.');
    validateProjectId(args[0]); validateRelativePath(args[1], { allowEmpty: true });
    return listWorkspaceDirectory(args[0], args[1]);
  });

  ipcMain.handle(WORKSPACE_CHANNELS.readText, (event, ...args) => {
    validateSender(event);
    if (args.length !== 2) throw new TypeError('workspace:read-text requires a project identifier and relative path.');
    validateProjectId(args[0]); validateRelativePath(args[1]);
    return readWorkspaceText(args[0], args[1]);
  });

  ipcMain.handle(WORKSPACE_CHANNELS.createFile, (event, ...args) => {
    validateSender(event);
    if (args.length !== 2) throw new TypeError('workspace:create-file requires a project identifier and relative path.');
    validateProjectId(args[0]); validateRelativePath(args[1]);
    return createWorkspaceFile(args[0], args[1]);
  });

  ipcMain.handle(WORKSPACE_CHANNELS.createFolder, (event, ...args) => {
    validateSender(event);
    if (args.length !== 2) throw new TypeError('workspace:create-folder requires a project identifier and relative path.');
    validateProjectId(args[0]); validateRelativePath(args[1]);
    return createWorkspaceFolder(args[0], args[1]);
  });

  ipcMain.handle(WORKSPACE_CHANNELS.move, (event, ...args) => {
    validateSender(event);
    if (args.length !== 3) throw new TypeError('workspace:move requires a project identifier, source, and destination.');
    validateProjectId(args[0]); validateRelativePath(args[1]); validateRelativePath(args[2]);
    return moveWorkspaceItem(args[0], args[1], args[2]);
  });

  ipcMain.handle(WORKSPACE_CHANNELS.delete, (event, ...args) => {
    validateSender(event);
    if (args.length !== 2) throw new TypeError('workspace:delete requires a project identifier and relative path.');
    validateProjectId(args[0]); validateRelativePath(args[1]);
    return deleteWorkspaceItem(args[0], args[1]);
  });
}

module.exports = { PROJECT_CHANNELS, WORKSPACE_CHANNELS, registerIpcHandlers };

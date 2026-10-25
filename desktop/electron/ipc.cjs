const APP_INFO_CHANNEL = 'app:get-info';
const PROJECT_CHANNELS = Object.freeze({
  list: 'projects:list',
  get: 'projects:get',
  create: 'projects:create',
  update: 'projects:update',
  delete: 'projects:delete',
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

function registerIpcHandlers({
  ipcMain, validateSender, getAppInfo,
  listProjects, getProject, createProject, updateProject, deleteProject,
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
}

module.exports = { PROJECT_CHANNELS, registerIpcHandlers };

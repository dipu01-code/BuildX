const APP_INFO_CHANNEL = 'app:get-info';
const AI_CHANNELS = Object.freeze({
  status: 'ai:get-status',
  testConnection: 'ai:test-connection',
});
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
  writeText: 'workspace:write-text',
  createFile: 'workspace:create-file',
  createFolder: 'workspace:create-folder',
  move: 'workspace:move',
  delete: 'workspace:delete',
});
const CONTEXT_CHANNELS = Object.freeze({
  refresh: 'context:index-refresh',
  status: 'context:index-status',
  files: 'context:index-files',
  search: 'context:search',
});
const CONVERSATION_CHANNELS = Object.freeze({
  create: 'conversations:create',
  list: 'conversations:list',
  get: 'conversations:get',
  send: 'conversations:send',
  delete: 'conversations:delete',
});
const PLANNER_CHANNELS = Object.freeze({
  generate: 'plans:generate', list: 'plans:list', get: 'plans:get', save: 'plans:save', update: 'plans:update', delete: 'plans:delete',
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
  ipcMain, validateSender, getAppInfo, getAIStatus, testAIConnection,
  listProjects, getProject, createProject, updateProject, deleteProject,
  chooseProjectDirectory, listWorkspaceDirectory, readWorkspaceText, writeWorkspaceText,
  createWorkspaceFile, createWorkspaceFolder, moveWorkspaceItem, deleteWorkspaceItem,
  refreshProjectIndex, getProjectIndexStatus, listProjectIndexedFiles, searchProjectContext,
  generatePlan, listPlans, getPlan, savePlan, updatePlan, deletePlan,
  createConversation, listConversations, getConversation, sendConversationMessage, deleteConversation,
}) {
  ipcMain.handle(APP_INFO_CHANNEL, (event, ...args) => {
    validateSender(event);
    if (args.length !== 0) {
      throw new TypeError('app:get-info does not accept arguments.');
    }
    return getAppInfo();
  });

  ipcMain.handle(AI_CHANNELS.status, (event, ...args) => {
    validateSender(event);
    if (args.length !== 0) throw new TypeError('ai:get-status does not accept arguments.');
    return getAIStatus();
  });

  ipcMain.handle(AI_CHANNELS.testConnection, (event, ...args) => {
    validateSender(event);
    if (args.length !== 0) throw new TypeError('ai:test-connection does not accept arguments.');
    return testAIConnection();
  });

  for (const [channel, handler] of [
    [PLANNER_CHANNELS.generate, generatePlan], [PLANNER_CHANNELS.list, listPlans],
    [PLANNER_CHANNELS.get, getPlan], [PLANNER_CHANNELS.save, savePlan],
    [PLANNER_CHANNELS.update, updatePlan], [PLANNER_CHANNELS.delete, deletePlan],
  ]) {
    ipcMain.handle(channel, (event, ...args) => {
      validateSender(event);
      const expectedArgs = channel === PLANNER_CHANNELS.generate || channel === PLANNER_CHANNELS.save ? 2
        : channel === PLANNER_CHANNELS.update ? 3
          : channel === PLANNER_CHANNELS.get || channel === PLANNER_CHANNELS.delete ? 2 : 1;
      if (args.length !== expectedArgs) {
        throw new TypeError('Invalid project planning request.');
      }
      return handler(...args);
    });
  }

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

  ipcMain.handle(WORKSPACE_CHANNELS.writeText, (event, ...args) => {
    validateSender(event);
    if (args.length !== 4) throw new TypeError('workspace:write-text requires project, path, content, and revision.');
    validateProjectId(args[0]); validateRelativePath(args[1]);
    if (typeof args[2] !== 'string' || args[2].length > 1024 * 1024
      || typeof args[3] !== 'string' || !/^[0-9a-f]{64}$/.test(args[3])) {
      throw new TypeError('The file content or save revision is invalid.');
    }
    return writeWorkspaceText(args[0], args[1], args[2], args[3]);
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

  ipcMain.handle(CONTEXT_CHANNELS.refresh, (event, ...args) => {
    validateSender(event);
    if (args.length !== 1) throw new TypeError('context:index-refresh requires one project identifier.');
    validateProjectId(args[0]);
    return refreshProjectIndex(args[0]);
  });

  ipcMain.handle(CONTEXT_CHANNELS.status, (event, ...args) => {
    validateSender(event);
    if (args.length !== 1) throw new TypeError('context:index-status requires one project identifier.');
    validateProjectId(args[0]);
    return getProjectIndexStatus(args[0]);
  });

  ipcMain.handle(CONTEXT_CHANNELS.files, (event, ...args) => {
    validateSender(event);
    if (args.length !== 1) throw new TypeError('context:index-files requires one project identifier.');
    validateProjectId(args[0]);
    return listProjectIndexedFiles(args[0]);
  });

  ipcMain.handle(CONTEXT_CHANNELS.search, (event, ...args) => {
    validateSender(event);
    if (args.length !== 3) throw new TypeError('context:search requires a project identifier, query, and limit.');
    validateProjectId(args[0]);
    if (typeof args[1] !== 'string' || args[1].trim().length < 2 || args[1].length > 300) {
      throw new TypeError('Enter a search query between 2 and 300 characters.');
    }
    if (!Number.isInteger(args[2]) || args[2] < 1 || args[2] > 20) {
      throw new TypeError('The context search result limit must be from 1 to 20.');
    }
    return searchProjectContext(args[0], args[1], args[2]);
  });

  ipcMain.handle(CONVERSATION_CHANNELS.create, (event, ...args) => {
    validateSender(event);
    if (args.length !== 1) throw new TypeError('conversations:create requires a project identifier.');
    validateProjectId(args[0]);
    return createConversation(args[0]);
  });
  ipcMain.handle(CONVERSATION_CHANNELS.list, (event, ...args) => {
    validateSender(event);
    if (args.length !== 1) throw new TypeError('conversations:list requires a project identifier.');
    validateProjectId(args[0]);
    return listConversations(args[0]);
  });
  ipcMain.handle(CONVERSATION_CHANNELS.get, (event, ...args) => {
    validateSender(event);
    if (args.length !== 2) throw new TypeError('conversations:get requires project and conversation identifiers.');
    validateProjectId(args[0]); validateProjectId(args[1]);
    return getConversation(args[0], args[1]);
  });
  ipcMain.handle(CONVERSATION_CHANNELS.send, (event, ...args) => {
    validateSender(event);
    if (args.length !== 4) throw new TypeError('conversations:send requires project, conversation, request, and message.');
    validateProjectId(args[0]); validateProjectId(args[1]); validateProjectId(args[2]);
    if (typeof args[3] !== 'string' || !args[3].trim() || args[3].length > 8000) {
      throw new TypeError('Enter a message of 1 to 8,000 characters.');
    }
    return sendConversationMessage(args[0], args[1], args[2], args[3]);
  });
  ipcMain.handle(CONVERSATION_CHANNELS.delete, (event, ...args) => {
    validateSender(event);
    if (args.length !== 2) throw new TypeError('conversations:delete requires project and conversation identifiers.');
    validateProjectId(args[0]); validateProjectId(args[1]);
    return deleteConversation(args[0], args[1]);
  });
}

module.exports = { AI_CHANNELS, CONTEXT_CHANNELS, CONVERSATION_CHANNELS, PROJECT_CHANNELS, WORKSPACE_CHANNELS, registerIpcHandlers };

const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, dialog, ipcMain, session, shell } = require('electron');
const { registerIpcHandlers } = require('./ipc.cjs');
const { createAIAPI } = require('./ai-api.cjs');
const { createPlannerApi } = require('./planner-api.cjs');
const { createProjectApi } = require('./project-api.cjs');
const { createContextApi } = require('./context-api.cjs');
const { createContextIndexer } = require('./context-indexer.cjs');
const { createConversationApi } = require('./conversation-api.cjs');
const { createChangeProposalApi } = require('./change-proposal-api.cjs');
const { createTerminalProcesses } = require('./terminal-processes.cjs');
const { createTestCommandDiscovery } = require('./test-command-discovery.cjs');
const { resolvePython, runMigrations, startBackend } = require('./backend-process.cjs');
const { createWorkspaceFiles } = require('./workspace-files.cjs');
const {
  createContentSecurityPolicy,
  isSafeExternalUrl,
  isTrustedRendererUrl,
  normalizeDevServerUrl,
  rendererFilePath,
} = require('./security.cjs');

const devServerUrl = process.env.BUILDX_DEV_SERVER_URL || '';
const expectedDevUrl = normalizeDevServerUrl(devServerUrl);
const expectedRendererPath = rendererFilePath(__dirname);
let mainWindow;
let backendProcess;
let backendBaseUrl;

function getBackendDirectory() {
  if (process.env.BUILDX_BACKEND_DIR) return path.resolve(process.env.BUILDX_BACKEND_DIR);
  if (app.isPackaged) return path.join(process.resourcesPath, 'backend');
  return path.resolve(__dirname, '../../backend');
}

const projectApi = createProjectApi({ getBaseUrl: () => backendBaseUrl });
const aiApi = createAIAPI({ getBaseUrl: () => backendBaseUrl });
const plannerApi = createPlannerApi({ getBaseUrl: () => backendBaseUrl });
const workspaceFiles = createWorkspaceFiles();
const contextApi = createContextApi({ getBaseUrl: () => backendBaseUrl });
const conversationApi = createConversationApi({ getBaseUrl: () => backendBaseUrl });
const changeProposalApi = createChangeProposalApi({ getBaseUrl: () => backendBaseUrl });
const terminalProcesses = createTerminalProcesses({
  getProjectRoot: (projectId) => workspaceFiles.getAuthorizedDirectory(projectApi, projectId),
  emit: (event) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('terminal:event', event);
  },
});
const testCommandDiscovery = createTestCommandDiscovery({
  getProjectRoot: (projectId) => workspaceFiles.getAuthorizedDirectory(projectApi, projectId),
});
const contextIndexer = createContextIndexer({ workspaceFiles, projectApi, contextApi });

function isTrustedUrl(value) {
  return isTrustedRendererUrl(value, {
    devServerUrl,
    rendererPath: expectedRendererPath,
  });
}

function validateIpcSender(event) {
  const isMainFrame = event.senderFrame === event.sender.mainFrame;
  if (!isMainFrame || !isTrustedUrl(event.senderFrame.url)) {
    throw new Error('Blocked IPC request from an untrusted renderer.');
  }
}

registerIpcHandlers({
  ipcMain,
  validateSender: validateIpcSender,
  getAppInfo: () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
  }),
  ...projectApi,
  ...aiApi,
  ...plannerApi,
  ...conversationApi,
  ...changeProposalApi,
  generateProposal: async (projectId, payload) => {
    const base = await workspaceFiles.inspectProposalTarget(projectApi, projectId, payload.relative_path);
    const requestedCreate = payload.original_content === null;
    if (requestedCreate !== !base.exists) throw new Error('The target file changed state. Refresh it and prepare a new proposal.');
    return changeProposalApi.generateProposal(projectId, {
      ...payload, original_content: base.content, original_hash: base.hash,
    });
  },
  applyApprovedChangeProposal: async (projectId, proposalId) => {
    const proposal = await changeProposalApi.getProposal(projectId, proposalId);
    if (proposal.project_id !== projectId || proposal.status !== 'approved') throw new Error('Only this project’s explicitly approved proposal can be applied.');
    try {
      const result = await workspaceFiles.applyProposal(projectApi, projectId, proposal);
      return changeProposalApi.recordProposalOutcome(projectId, proposalId, { status: 'applied', result_hash: result.result_hash });
    } catch (error) {
      const conflicted = error?.code === 'FILE_CONFLICT' || error?.code === 'DESTINATION_EXISTS';
      await changeProposalApi.recordProposalOutcome(projectId, proposalId, { status: conflicted ? 'conflicted' : 'failed', message: error?.message || 'The change could not be applied.' }).catch(() => {});
      throw error;
    }
  },
  startTerminalProcess: (projectId, payload) => terminalProcesses.start({
    projectId, command: payload.command, requestId: payload.request_id, approval: payload.approval,
  }),
  listTerminalProcesses: (projectId) => ({ sessions: terminalProcesses.list(projectId), limits: terminalProcesses.limits }),
  stopTerminalProcess: (projectId, sessionId) => terminalProcesses.stop(projectId, sessionId),
  discoverTestCommands: (projectId) => testCommandDiscovery.discover(projectId),
  startTestProcess: (projectId, payload) => terminalProcesses.start({
    projectId, command: payload.command, requestId: payload.request_id, approval: payload.approval,
    purpose: 'test', configurationSource: payload.configuration_source, testRunner: payload.runner,
  }),
  refreshProjectIndex: (projectId) => contextIndexer.refresh(projectId),
  getProjectIndexStatus: (projectId) => contextApi.getIndexStatus(projectId),
  listProjectIndexedFiles: (projectId) => contextApi.listIndexedFiles(projectId, { limit: 200 }),
  searchProjectContext: (projectId, query, limit) => contextApi.searchProjectContext(projectId, query, limit),
  chooseProjectDirectory: (projectId) => workspaceFiles.chooseDirectory(
    projectApi, projectId, dialog, BrowserWindow.getFocusedWindow(),
  ),
  listWorkspaceDirectory: (projectId, relativePath) => workspaceFiles.list(projectApi, projectId, relativePath),
  readWorkspaceText: (projectId, relativePath) => workspaceFiles.readText(projectApi, projectId, relativePath),
  writeWorkspaceText: (projectId, relativePath, content, revision) => workspaceFiles.writeText(
    projectApi, projectId, relativePath, content, revision,
  ),
  createWorkspaceFile: (projectId, relativePath) => workspaceFiles.createFile(projectApi, projectId, relativePath),
  createWorkspaceFolder: (projectId, relativePath) => workspaceFiles.createFolder(projectApi, projectId, relativePath),
  moveWorkspaceItem: (projectId, fromPath, toPath) => workspaceFiles.move(projectApi, projectId, fromPath, toPath),
  deleteWorkspaceItem: (projectId, relativePath) => workspaceFiles.remove(projectApi, projectId, relativePath),
});

function configureContentSecurityPolicy() {
  const policy = createContentSecurityPolicy(Boolean(expectedDevUrl));
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    });
  });
}

function openSafeExternalUrl(value) {
  if (!isSafeExternalUrl(value)) return;
  shell.openExternal(value).catch((error) => {
    console.error('Could not open external link:', error);
  });
}

function installNavigationPolicy(window) {
  window.webContents.on('will-navigate', (event, targetUrl) => {
    if (isTrustedUrl(targetUrl)) return;
    event.preventDefault();
    openSafeExternalUrl(targetUrl);
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    openSafeExternalUrl(url);
    return { action: 'deny' };
  });
}

async function showStartupFailure(error) {
  console.error('BUILDX renderer failed to load:', error);
  await dialog.showMessageBox({
    type: 'error',
    title: 'BUILDX could not start',
    message: 'The BUILDX desktop interface could not be loaded.',
    detail: 'Check the development server or rebuild the application, then try again.',
    buttons: ['Quit'],
  });
  app.quit();
}

async function loadRenderer(window) {
  try {
    if (expectedDevUrl) {
      await window.loadURL(expectedDevUrl.href);
    } else {
      await window.loadFile(expectedRendererPath);
    }
  } catch (error) {
    await showStartupFailure(error);
  }
}

function createMainWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 920,
    minHeight: 640,
    show: false,
    backgroundColor: '#101311',
    title: 'BUILDX',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow = window;
  installNavigationPolicy(window);
  window.once('ready-to-show', () => window.show());
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error('BUILDX renderer process stopped:', details.reason);
    dialog.showErrorBox(
      'BUILDX stopped unexpectedly',
      'The desktop interface stopped responding. Restart BUILDX to continue.',
    );
  });
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = undefined;
  });

  loadRenderer(window);
}

const hasSingleInstance = app.requestSingleInstanceLock();
if (!hasSingleInstance) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) {
      createMainWindow();
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    configureContentSecurityPolicy();
    const backendDir = getBackendDirectory();
    if (fs.existsSync(backendDir)) {
      const python = resolvePython(backendDir);
      const pythonEnv = { ...process.env, BUILDX_PYTHON: python };
      return runMigrations({ backendDir, dataDir: app.getPath('userData'), env: pythonEnv })
        .then(() => startBackend({ backendDir, dataDir: app.getPath('userData'), env: pythonEnv }))
        .then(({ child, baseUrl }) => {
          backendProcess = child;
          backendBaseUrl = baseUrl;
        })
        .catch((error) => {
          console.error('BUILDX project service could not start:', error.message);
        })
        .finally(() => createMainWindow());
    }
    console.error('BUILDX backend directory is unavailable; project management will be offline.');
    createMainWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  }).catch(showStartupFailure);

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  let terminalShutdownComplete = false;
  app.on('before-quit', (event) => {
    if (!terminalShutdownComplete) {
      event.preventDefault();
      terminalProcesses.shutdown().finally(() => {
        terminalShutdownComplete = true;
        app.quit();
      });
      return;
    }
    if (backendProcess && !backendProcess.killed) backendProcess.kill();
  });
}

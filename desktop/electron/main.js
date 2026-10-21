const path = require('node:path');
const { app, BrowserWindow, dialog, ipcMain, session, shell } = require('electron');
const { registerIpcHandlers } = require('./ipc.cjs');
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
    createMainWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  }).catch(showStartupFailure);

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

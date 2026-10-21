const APP_INFO_CHANNEL = 'app:get-info';

function registerIpcHandlers({ ipcMain, validateSender, getAppInfo }) {
  ipcMain.handle(APP_INFO_CHANNEL, (event, ...args) => {
    validateSender(event);
    if (args.length !== 0) {
      throw new TypeError('app:get-info does not accept arguments.');
    }
    return getAppInfo();
  });
}

module.exports = { registerIpcHandlers };

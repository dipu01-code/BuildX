// Renders icon.svg to the 1024px icon.png that electron-builder turns into platform icons.
// Run after editing the SVG: npx electron desktop/assets/render-icon.cjs
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(__dirname, 'icon.svg'), 'utf8');
  const window = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } });
  await window.loadURL(`data:text/html,${encodeURIComponent(`<style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg}`)}`);
  const image = await window.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, 'icon.png'), image.resize({ width: 1024, height: 1024 }).toPNG());
  app.quit();
});

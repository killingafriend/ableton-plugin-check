const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('pluginApi', {
  scan: extraDirs => ipcRenderer.invoke('plugins:scan', extraDirs),
  // Dateien im Hauptprozess lesen: robuster als der Zugriff aus dem Renderer (Dropbox, iCloud, große Dateien).
  pathForFile: file => webUtils.getPathForFile(file),
  readFile: p => ipcRenderer.invoke('file:read', p),
  pickFolder: () => ipcRenderer.invoke('plugins:pickFolder'),
});

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  isElectron: true,
  downloadAndInstallUpdate: (url, fileName) => ipcRenderer.invoke('download-and-install-update', { url, fileName }),
  openExternal: (url) => ipcRenderer.send('open-external', url),
});

const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('zhizhiDesktop', {
  platform: process.platform,
  onLinkReaderClose: callback => { const listener = () => callback(); ipcRenderer.on('link-reader-close', listener); return () => ipcRenderer.removeListener('link-reader-close', listener); },
  linkReader: (action, data) => ipcRenderer.invoke('link-reader', action, data),
  onLinkReaderError: callback => { const listener = () => callback(); ipcRenderer.on('link-reader-error', listener); return () => ipcRenderer.removeListener('link-reader-error', listener); },
  setTheme: mode => ipcRenderer.invoke('window-theme', mode),
  setSidebarBlur: enabled => ipcRenderer.invoke('sidebar-material', enabled),
});

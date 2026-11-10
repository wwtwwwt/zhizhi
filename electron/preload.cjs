const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('zhizhiDesktop', {
  platform: process.platform,
  setSidebarBlur: enabled => ipcRenderer.invoke('sidebar-material', enabled),
});

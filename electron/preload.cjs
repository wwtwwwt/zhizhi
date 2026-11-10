const { contextBridge } = require('electron');
// Expose only immutable presentation information; no privileged operations.
contextBridge.exposeInMainWorld('zhizhiDesktop', { nativeSidebar: process.platform === 'darwin' });

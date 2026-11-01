import { app, BrowserWindow, dialog, Menu, safeStorage, session, shell } from 'electron';
import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../server/store';
import { createApp } from '../server/app';
import { readLocalDocument } from '../server/local-document';

const here = dirname(fileURLToPath(import.meta.url));
const development = !app.isPackaged;
const hot = development && process.env.ZHIZHI_DESKTOP_DEV === '1';
app.setName('枝知');
app.setPath('userData', process.env.ZHIZHI_DATA_DIR || join(app.getPath('appData'), development ? 'zhizhi-development' : 'zhizhi'));
let store: Store | undefined, server: Server | undefined;
let active: Map<string, AbortController> | undefined;
let quitting = false;

async function shutdown() {
  for (const controller of active?.values() || []) controller.abort('interrupted');
  if (server) {
    server.closeAllConnections();
    await new Promise<void>(resolve => server!.close(() => resolve()));
  }
  const deadline = Date.now() + 3000;
  while (active?.size && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
  store?.db.close();
}
app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (quitting) return;
  event.preventDefault(); quitting = true;
  void shutdown().finally(() => app.quit());
});

async function start() {
  if (!safeStorage.isEncryptionAvailable() || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) {
    throw new Error('系统安全存储不可用。请启用系统钥匙串或密钥服务后重新启动枝知。');
  }
  const dataDir = app.getPath('userData');
  mkdirSync(dataDir, {recursive:true,mode:0o700});
  store = new Store(dataDir, {
    encode: text => JSON.stringify({encrypted: safeStorage.encryptString(text).toString('base64')}),
    decode: text => safeStorage.decryptString(Buffer.from(JSON.parse(text).encrypted, 'base64')),
  });
  const token = randomBytes(32).toString('hex');
  const service = createApp(store, {apiToken:token, pickDocument:async()=>{const selected=await dialog.showOpenDialog({title:'选择 Markdown 文件',properties:['openFile'],filters:[{name:'Markdown',extensions:['md','markdown']}]});return selected.canceled || !selected.filePaths[0] ? null : readLocalDocument(selected.filePaths[0]);}, staticDir:join(here,'../dist'), allowedOrigins:hot?['http://127.0.0.1:5174']:[]});
  active = service.active;
  server = createServer(service.app);
  // Reusing the assigned port preserves same-origin browser preferences between launches.
  const portPath = join(dataDir, 'desktop-runtime.json');
  let port = 0;
  try { const saved = JSON.parse(readFileSync(portPath,'utf8')).port; if(Number.isInteger(saved) && saved > 1023 && saved < 65536) port=saved; } catch {}
  async function listen(value:number) {
    await new Promise<void>((resolve,reject)=>{
      server!.once('error',reject);
      server!.listen(value,'127.0.0.1',()=>{server!.off('error',reject);resolve();});
    });
  }
  try { await listen(hot?3002:port); }
  catch(error) { if(!hot && port && (error as NodeJS.ErrnoException).code==='EADDRINUSE') await listen(0); else throw error; }
  const address=server.address() as {port:number};
  const serviceOrigin=`http://127.0.0.1:${address.port}`;
  if(!hot) writeFileSync(portPath,JSON.stringify({port:address.port}),{mode:0o600});
  const origin=hot?'http://127.0.0.1:5174':serviceOrigin;
  const browserSession=session.defaultSession;
  browserSession.webRequest.onBeforeSendHeaders({urls:[`${origin}/api/*`,...(hot?[`${serviceOrigin}/api/*`]:[])]},(details,callback)=>{
    callback({requestHeaders:{...details.requestHeaders,'x-zhizhi-token':token}});
  });
  browserSession.setPermissionRequestHandler((_webContents,permission,callback)=>callback(permission==='clipboard-sanitized-write'));
  browserSession.setPermissionCheckHandler((_webContents,permission)=>permission==='clipboard-sanitized-write');
  const window=new BrowserWindow({width:1240,height:860,minWidth:760,minHeight:540,title:'枝知',backgroundColor:'#ffffff',show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
  const external=(url:string)=>{try{if(['http:','https:'].includes(new URL(url).protocol))void shell.openExternal(url);}catch{}};
  window.webContents.setWindowOpenHandler(({url})=>{external(url);return {action:'deny'};});
  window.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==origin){event.preventDefault();external(url);}});
  window.webContents.on('will-attach-webview',event=>event.preventDefault());
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform==='darwin'?[{label:'枝知',submenu:[{role:'about' as const},{type:'separator' as const},{role:'quit' as const}]}]:[]),
    {label:'编辑',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
    ...(development?[{label:'开发',submenu:[{role:'reload' as const},{role:'toggleDevTools' as const}]}]:[]),
  ]));
  await window.loadURL(origin);
  window.show();
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance',()=>{const window=BrowserWindow.getAllWindows()[0];if(window){if(window.isMinimized())window.restore();window.show();window.focus();}});
  void app.whenReady().then(start).catch(async error=>{
    dialog.showErrorBox('枝知启动失败',error instanceof Error?error.message:'无法启动本地服务');
    app.quit();
  });
}

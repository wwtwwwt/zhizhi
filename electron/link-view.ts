import { WebContentsView, ipcMain, session, type BrowserWindow } from 'electron';
import { readerUrl } from '../shared/links';
export function installLinkView(window: BrowserWindow, external: (url: string) => void) {
  let view: WebContentsView | undefined;
  const isolated = session.fromPartition('zhizhi-link-reader');
  isolated.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  isolated.setPermissionCheckHandler(()=>false);
  isolated.on('will-download', event=>event.preventDefault());
  isolated.webRequest.onBeforeRequest((details,callback)=>callback({cancel: !readerUrl(details.url) && !details.url.startsWith('data:') && !details.url.startsWith('blob:')}));
  const trusted = (event: Electron.IpcMainInvokeEvent) => event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame;
  const close = () => { if (view) { window.contentView.removeChildView(view); view.webContents.close(); view=undefined; } };
  ipcMain.handle('link-reader', (event, action: unknown, data: any) => {
    if (!trusted(event)) return false;
    if (action === 'close') { close(); return true; }
    if (action === 'external') { const url=readerUrl(view?.webContents.getURL() || data); if(url)external(url); return !!url; }
    if (action === 'bounds') {
      if(!view || !data || !['x','y','width','height'].every(key=>Number.isFinite(data[key])))return false;
      const [width,height]=window.getContentSize();
      const x=Math.max(0,Math.min(width,Math.round(data.x))), y=Math.max(0,Math.min(height,Math.round(data.y)));
      view.setBounds({x,y,width:Math.max(0,Math.min(width-x,Math.round(data.width))),height:Math.max(0,Math.min(height-y,Math.round(data.height)))});return true;
    }
    if (action === 'open') {
      const url=typeof data==='string' && readerUrl(data); if(!url)return false;
      close(); view=new WebContentsView({webPreferences:{session:isolated,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
      window.contentView.addChildView(view);
      view.webContents.on('before-input-event',(event,input)=>{if(input.type==='keyDown' && input.key==='Escape'){event.preventDefault();window.webContents.send('link-reader-close');}});
      view.webContents.setWindowOpenHandler(({url})=>{if(readerUrl(url))void view?.webContents.loadURL(url).catch(()=>{});return {action:'deny'};});
      const guard=(event:Electron.Event,url:string)=>{if(!readerUrl(url))event.preventDefault();};
      view.webContents.on('will-navigate',guard);view.webContents.on('will-redirect',guard);
      view.webContents.on('will-attach-webview',event=>event.preventDefault());
      view.webContents.on('did-fail-load',(_event,code,_description,_url,isMainFrame)=>{if(isMainFrame && code!==-3 && !window.isDestroyed())window.webContents.send('link-reader-error');});
      void view.webContents.loadURL(url).catch(()=>{});return true;
    }
    return false;
  });
  window.webContents.on('did-start-navigation',(_event,_url,_inPlace,isMainFrame)=>{if(isMainFrame)close();});
  window.on('close',close);
  window.on('closed',()=>ipcMain.removeHandler('link-reader')); 
}

import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
const dataDir=await mkdtemp(join(tmpdir(),'zhizhi-desktop-'));
const executablePath=process.env.ZHIZHI_TEST_EXECUTABLE;
const env={...process.env,ZHIZHI_DATA_DIR:dataDir};
delete env.ELECTRON_RUN_AS_NODE;delete env.ZHIZHI_DESKTOP_DEV;
const hot=process.env.ZHIZHI_TEST_HOT==='1';
let vite;
if(hot){
  env.ZHIZHI_DESKTOP_DEV='1';
  vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1'],{env,stdio:'ignore'});
  let ready=false;
  for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:5174')).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
  if(!ready){vite.kill();throw new Error('桌面开发 Vite 未启动');}
}
let desktop;
async function launch(){
  desktop=await electron.launch({...(executablePath?{executablePath,args:[]}:{args:['.']}),env,timeout:30000});
  const page=await desktop.firstWindow();await page.waitForLoadState('domcontentloaded');
  return page;
}
async function close(){
  const child=desktop.process();
  const exited=new Promise(resolve=>child.once('exit',resolve));
  await(await desktop.firstWindow()).evaluate(()=>window.close());
  await Promise.race([exited,new Promise((_,reject)=>setTimeout(()=>reject(new Error('关闭窗口后应用未退出')),10000).unref())]);
  desktop=undefined;
}
try{
  const page=await launch();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const runtime=await desktop.evaluate(({app})=>({packaged:app.isPackaged,path:app.getPath('userData'),node:process.versions.node}));
  expect(runtime.path).toBe(dataDir);if(executablePath)expect(runtime.packaged).toBe(true);
  const origin=new URL(page.url()).origin;
  expect((await fetch(origin+'/api/health')).status).toBe(401);
  const model=await page.evaluate(async()=>{
    const response=await fetch('/api/models',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Desktop Stub',model:'stub',baseUrl:'http://127.0.0.1:9999/v1',supportsImages:false,parameters:[],apiKey:'desktop-smoke-key'})});
    if(!response.ok)throw new Error(await response.text());return response.json();
  });
  expect(model.hasApiKey).toBe(true);expect(JSON.stringify(model)).not.toContain('desktop-smoke-key');
  const secrets=await readFile(join(dataDir,'secrets.json'),'utf8');expect(secrets).not.toContain('desktop-smoke-key');expect(JSON.parse(secrets).encrypted).toBeTruthy();
  await page.locator('.workspace .unified-composer textarea').fill('桌面模拟测试');
  await page.getByRole('button',{name:'发送问题',exact:true}).click();
  await expect(page.locator('.workspace .message-assistant [data-node]').first()).toBeVisible();
  await expect(page.getByRole('button',{name:'停止生成',exact:true})).toHaveCount(0);
  await page.reload();
  await page.locator('.workspace .unified-composer').getByRole('button',{name:'切换模型',exact:true}).click();
  await page.getByRole('menuitemradio',{name:'Desktop Stub',exact:true}).click();
  await close();expect((await fetch((hot?'http://127.0.0.1:3002':origin)+'/api/health').catch(()=>null))).toBe(null);
  const reopened=await launch();expect(new URL(reopened.url()).origin).toBe(origin);
  await expect(reopened.locator('.workspace .unified-composer').getByRole('button',{name:'切换模型',exact:true})).toHaveText('Desktop Stub');
  const models=await reopened.evaluate(async()=>await(await fetch('/api/models')).json());expect(models.find(m=>m.id===model.id).hasApiKey).toBe(true);
  // Reading hasApiKey exercises actual safeStorage decryption after a full app restart.
  expect(errors).toEqual([]);await close();
  console.log('Desktop smoke passed: runtime, authenticated API, encrypted keys, fake streaming, restart persistence, close-to-quit.',runtime);
}finally{if(desktop)await desktop.close();vite?.kill('SIGTERM');await rm(dataDir,{recursive:true,force:true});}

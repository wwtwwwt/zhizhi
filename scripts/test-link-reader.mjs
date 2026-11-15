import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dataDir=await mkdtemp(join(tmpdir(),'zhizhi-reader-'));
const env={...process.env,ZHIZHI_DATA_DIR:dataDir};delete env.ELECTRON_RUN_AS_NODE;delete env.ZHIZHI_DESKTOP_DEV;
let desktop;
try {
  desktop=await electron.launch({args:['.'],env,timeout:30000});
  const page=await desktop.firstWindow();await page.waitForLoadState('domcontentloaded');
  await desktop.evaluate(({session})=>session.fromPartition('zhizhi-link-reader').protocol.handle('https',()=>new Response('<html><body>Local reader fixture</body></html>',{headers:{'Content-Type':'text/html'}})));
  await page.evaluate(()=>{const a=document.createElement('a');a.href='https://example.com/article';a.textContent='Reader fixture link';document.body.append(a);});
  await page.getByRole('link',{name:'Reader fixture link'}).click();
  await expect(page.getByRole('dialog',{name:'网页',exact:true})).toBeVisible();
  await expect.poll(()=>desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].contentView.children.length)).toBe(1);
  await expect.poll(()=>desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].contentView.children[0].webContents.getURL())).toBe('https://example.com/article');
  const isolation=await desktop.evaluate(async({BrowserWindow})=>{
    const view=BrowserWindow.getAllWindows()[0].contentView.children[0];
    return {bounds:view.getBounds(),globals:await view.webContents.executeJavaScript('[typeof window.require, typeof window.zhizhiDesktop]'),text:await view.webContents.executeJavaScript('document.body.textContent')};
  });
  expect(isolation.bounds.width).toBeGreaterThan(100);expect(isolation.bounds.height).toBeGreaterThan(100);
  expect(isolation.globals).toEqual(['undefined','undefined']);expect(isolation.text).toContain('Local reader fixture');
  expect(await page.evaluate(()=>window.zhizhiDesktop.linkReader('open','http://127.0.0.1/private'))).toBe(false);
  await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].contentView.children[0].webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'}));
  await expect(page.getByRole('dialog',{name:'网页',exact:true})).toHaveCount(0);
  await expect.poll(()=>desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].contentView.children.length)).toBe(0);
  console.log('Electron link reader: isolation, bounds, local URL rejection and Escape cleanup passed.');
} finally {if(desktop)await desktop.close();await rm(dataDir,{recursive:true,force:true});}

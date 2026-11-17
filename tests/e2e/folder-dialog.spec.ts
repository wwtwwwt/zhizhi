import { expect,test } from '@playwright/test';
test('folder management dialogs escape the isolated translucent sidebar',async({page,request})=>{
  await page.goto('/');
  await page.evaluate(()=>{document.documentElement.classList.add('native-sidebar-blur');document.documentElement.dataset.theme='dark';});
  await page.getByRole('button',{name:'新建文件夹',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'新建文件夹',exact:true});await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(el=>!!el.closest('.sidebar'))).toBe(false);
  const input=dialog.getByRole('textbox',{name:'文件夹名称'});await expect(input).toBeFocused();
  const bounds=await dialog.boundingBox();expect(bounds!.x).toBeGreaterThan(200);
  const name=`新建检查${Date.now()}`;await input.fill(name);await dialog.getByRole('button',{name:'确认',exact:true}).click();
  await expect(dialog).toHaveCount(0);const row=page.locator('.folder-row').filter({has:page.getByRole('button',{name,exact:true})});await expect(row).toBeVisible();
  await row.hover();await row.getByTitle('重命名文件夹',{exact:true}).click();
  const rename=page.getByRole('dialog',{name:'重命名文件夹',exact:true});await expect(rename).toBeVisible();expect(await rename.evaluate(el=>!!el.closest('.sidebar'))).toBe(false);
  await page.keyboard.press('Escape');await expect(rename).toHaveCount(0);
  const folders=await(await request.get('/api/folders')).json();await request.delete(`/api/folders/${folders.find((f:{name:string})=>f.name===name).id}`);
});

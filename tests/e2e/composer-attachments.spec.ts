import { expect, test } from '@playwright/test';

test('unified attachment picker routes mixed files and filters images by model capability', async ({page,request}) => {
  const model=await(await request.post('/api/models',{data:{name:`Attachment stub ${Date.now()}`,model:'stub',baseUrl:'http://127.0.0.1:1/v1',supportsImages:false,parameters:[]}})).json();
  const session=await(await request.post('/api/sessions',{data:{}})).json();
  await page.goto('/');await page.evaluate(({sessionId,modelId})=>{localStorage.setItem('lastSession',sessionId);localStorage.setItem('lastModelId',modelId);},{sessionId:session.id,modelId:model.id});await page.reload();
  const composer=page.locator('.workspace .unified-composer'), picker=composer.locator('input[type=file]');
  await expect(picker).toHaveCount(1);await expect(picker).not.toHaveAttribute('accept',/image\//);
  await picker.setInputFiles([{name:'skip.png',mimeType:'image/png',buffer:Buffer.from('image')},{name:'keep.md',mimeType:'text/plain',buffer:Buffer.from('文档内容')}]);
  await expect(composer.locator('.attachment-chip')).toHaveCount(1);await expect(composer.locator('.attachment-chip')).toContainText('keep.md');
  await expect(page.getByText('当前模型不支持图片，已跳过 1 张图片',{exact:true})).toBeVisible();
  await composer.getByRole('button',{name:'移除附件：keep.md'}).click();
  await composer.getByRole('button',{name:'切换模型',exact:true}).click();await composer.getByRole('menuitemradio',{name:'模拟模式',exact:true}).click();
  await expect(picker).toHaveAttribute('accept',/image\/png/);
  const waiting=page.waitForEvent('filechooser');await composer.getByRole('button',{name:'添加附件',exact:true}).click();const chooser=await waiting;expect(chooser.isMultiple()).toBe(true);
  await chooser.setFiles([{name:'pixel.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1sAAAAASUVORK5CYII=','base64')},{name:'code.py',mimeType:'text/plain',buffer:Buffer.from('print(1)')}]);
  await expect(composer.locator('.attachment-chip')).toHaveCount(2);await expect(composer.locator('.attachment-chip img')).toHaveCount(1);
  let sent:any;await page.route('**/api/streams/*/messages',async route=>{sent=route.request().postDataJSON();await route.fulfill({status:400,json:{error:{message:'测试结束，不调用模型'}}});});
  await composer.getByRole('button',{name:'发送问题',exact:true}).click();
  await expect.poll(()=>sent?.attachments?.map((a:any)=>a.kind)).toEqual(['image','text']);
  await request.delete(`/api/models/${model.id}`);await request.delete(`/api/sessions/${session.id}`);
});

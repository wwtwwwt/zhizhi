import {expect,test} from '@playwright/test';
test('general proxy autosaves and complete model share imports after preview',async({page,request})=>{
  const model=await(await request.post('/api/models',{data:{name:`分享测试 ${Date.now()}`,baseUrl:'https://example.com/v1',model:'test/model',apiType:'responses',apiKey:'synthetic-share-key',supportsImages:true,parameters:[{key:'context_length',value:256000,enabled:true}]}})).json();
  await page.goto('/settings');await page.getByRole('tab',{name:'通用',exact:true}).click();
  await page.getByRole('combobox',{name:'代理模式',exact:true}).selectOption('direct');
  await expect.poll(async()=>(await(await request.get('/api/settings')).json()).proxyMode).toBe('direct');
  await page.reload();await page.getByRole('tab',{name:'通用',exact:true}).click();await expect(page.getByRole('combobox',{name:'代理模式'})).toHaveValue('direct');
  await page.getByRole('combobox',{name:'代理模式'}).selectOption('system');await expect.poll(async()=>(await(await request.get('/api/settings')).json()).proxyMode).toBe('system');
  await page.getByRole('tab',{name:'供应商',exact:true}).click();await page.getByRole('button',{name:`分享模型：${model.name}`,exact:true}).click();
  const share=page.getByRole('dialog',{name:'分享模型',exact:true});await expect(share).toContainText('分享码包含 API Key');const field=share.getByRole('textbox',{name:'模型分享码',exact:true});await expect(field).toHaveValue(/^zhizhi:model:1:/);const code=await field.inputValue();await share.getByRole('button',{name:'取消',exact:true}).click();
  await page.getByRole('button',{name:'导入分享码',exact:true}).click();const importing=page.getByRole('dialog',{name:'导入分享码',exact:true});await importing.getByRole('textbox',{name:'模型分享码'}).fill(code);await importing.getByRole('button',{name:'读取配置',exact:true}).click();await expect(importing).toContainText('包含 API Key');await expect(importing).toContainText('https://example.com/v1');await importing.getByRole('button',{name:'导入模型',exact:true}).click();await expect(importing).toHaveCount(0);
  const models=await(await request.get('/api/models')).json();const copies=models.filter((value:any)=>value.name===model.name);expect(copies).toHaveLength(2);expect(copies.every((value:any)=>value.hasApiKey)).toBe(true);expect(JSON.stringify(copies)).not.toContain('synthetic-share-key');
  for(const copy of copies)await request.delete(`/api/models/${copy.id}`);
});

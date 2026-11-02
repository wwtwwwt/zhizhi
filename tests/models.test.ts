import { expect, test } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store';
import { createApp } from '../server/app';
import { defaultParameters } from '../shared/models';
import { readSSE } from '../shared/sse';

async function listen(server: Server) { await new Promise<void>(r=>server.listen(0,'127.0.0.1',r)); return `http://127.0.0.1:${(server.address() as {port:number}).port}`; }
async function close(server: Server) { server.closeAllConnections(); await new Promise<void>(r=>server.close(()=>r())); }

test('models discovery uses saved key; upstream receives enabled parameters and multimodal parts; reasoning persists separately', async()=>{
  const dir=mkdtempSync(join(tmpdir(),'learn-models-')), store=new Store(dir); let received:any, key='';
  const upstream=createServer(async(req,res)=>{
    key=req.headers.authorization || '';
    if(req.url==='/v1/models'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({data:[{id:'vision-stub'},{id:'text-stub'},{id:'vision-stub'}]}));return;}
    let body='';for await(const c of req)body+=c;received=JSON.parse(body);
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    res.write('data: {"choices":[{"delta":{"reasoning_content":"服务商提供的思考摘要"}}]}\n\n');
    res.write('data: {"choices":[{"delta":{"content":"**回答**完成。"}}]}\n\n');res.end('data: [DONE]\n\n');
  });
  const upstreamUrl=await listen(upstream), {app}=createApp(store), appServer=createServer(app), base=await listen(appServer);
  const send=async(path:string,method='GET',data?:unknown)=>fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
  try{
    const config={name:'可视模型',baseUrl:upstreamUrl+'/v1',model:'vision-stub',supportsImages:true,apiKey:'stub-key',parameters:defaultParameters().map(p=>p.key==='reasoning_effort'?{...p,enabled:true}:p)};
    const model=await(await send('/api/models','POST',config)).json();expect(model.hasApiKey).toBe(true);expect(JSON.stringify(model)).not.toContain('stub-key');
    const discovery=await(await send('/api/models/discover','POST',{baseUrl:config.baseUrl,configuredModelId:model.id})).json();expect(discovery.models).toEqual(['text-stub','vision-stub']);expect(key).toBe('Bearer stub-key');
    const sess=await(await send('/api/sessions','POST',{})).json();
    const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1sAAAAASUVORK5CYII=';
    const q=await(await send(`/api/streams/${sess.root_stream_id}/messages`,'POST',{text:'解释文件',modelId:model.id,requestId:randomUUID(),attachments:[{name:'a.png',kind:'image',mime:'image/png',data:png},{name:'a.py',kind:'text',mime:'text/plain',data:'print(42)'}]})).json();
    const response=await send(`/api/generations/${q.generationId}/events`);const events=[];for await(const event of readSSE(response.body!))events.push(event);
    expect(events.some(e=>e.event==='reasoning')).toBe(true);expect(events.some(e=>e.event==='complete')).toBe(true);
    expect(received.temperature).toBe(.7);expect(received.max_tokens).toBe(4096);expect(received.reasoning_effort).toBe('medium');expect(received.context_length).toBeUndefined();
    const text=JSON.stringify(received.messages);expect(text).toContain('data:image/png;base64,');expect(text).toContain('print(42)');expect(text).not.toContain('服务商提供的思考摘要');
    const message=store.stream(sess.root_stream_id).messages[1];expect(message.reasoning_text).toBe('服务商提供的思考摘要');expect(message.content_markdown).toBe('**回答**完成。');
    expect(JSON.stringify(store.context(sess.root_stream_id))).not.toContain('服务商提供的思考摘要');
    const wrong=await send('/api/models','POST',{...config,parameters:[{key:'messages',value:[],enabled:true}]});expect(wrong.status).toBe(400);
    expect((await send('/api/models/fake','DELETE')).status).toBe(400);
  }finally{await close(appServer);await close(upstream);store.db.close();rmSync(dir,{recursive:true,force:true});}
});

test.each(['branch','block'])('deleting a %s aborts descendant active streams without recreating deleted data',async(kind)=>{
  const dir=mkdtempSync(join(tmpdir(),'learn-delete-stream-')),store=new Store(dir);
  store.saveSettings({...store.settings(),fakeDelay:80});
  const session=store.createSession(),root=store.appendQuestion(session.root_stream_id,'问题',randomUUID());
  store.run("UPDATE generations SET status='streaming' WHERE id=?",root.generationId);store.finish(root.generationId,'原文内容');
  const source=store.stream(session.root_stream_id).messages[1].slots[0].node;
  const branch=store.createBranch(source.id,0,2,'原文','慢速回答',randomUUID());
  const {app,active}=createApp(store),server=createServer(app),base=await listen(server);
  try{
    const response=await fetch(`${base}/api/generations/${branch.generationId}/events`);expect(response.ok).toBe(true);expect(active.has(branch.generationId)).toBe(true);
    const deleted=await fetch(kind==='branch'?`${base}/api/branches/${branch.branch!.id}`:`${base}/api/slots/${source.slot_id}`,{method:'DELETE',headers:{'Content-Type':'application/json'},...(kind==='block'?{body:JSON.stringify({expectedActiveNodeId:source.id,scope:'all'})}:{})});expect(deleted.status).toBe(200);expect((await deleted.json()).streamIds).toContain(branch.streamId);
    const events=[];for await(const event of readSSE(response.body!))events.push(event);
    expect(events.filter(e=>e.event==='error').map(e=>JSON.parse(e.data).code)).toContain('BRANCH_DELETED');
    expect(active.has(branch.generationId)).toBe(false);expect(store.one('SELECT id FROM streams WHERE id=?',branch.streamId)).toBeUndefined();
    expect((await fetch(`${base}/api/health`)).ok).toBe(true);expect(store.all('PRAGMA foreign_key_check')).toHaveLength(0);
  }finally{await close(server);store.db.close();rmSync(dir,{recursive:true,force:true});}
});

test('storage API reports local bytes and requires explicit reset confirmation; reset clears all app data and keys',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'learn-storage-')),store=new Store(dir);
  const model=store.models.save({provider:'openai',name:'模型',baseUrl:'http://localhost/v1',model:'stub',supportsImages:false,parameters:defaultParameters(),apiKey:'private-test-key'});
  store.saveSettings({...store.settings(),nickname:'测试昵称',fontSize:18,sendShortcut:'mod-enter'});
  const session=store.createSession();store.appendQuestion(session.root_stream_id,'测试数据',randomUUID());
  const server=createServer(createApp(store).app),base=await listen(server);
  try{
    const info=await(await fetch(base+'/api/storage')).json();expect(info.mode).toBe('local');expect(info.path).toBe(dir);expect(info.totalBytes).toBeGreaterThan(0);expect(info.sessions).toBe(1);expect(info.models).toBe(1);expect(JSON.stringify(info)).not.toContain('private-test-key');
    expect((await fetch(base+'/api/storage',{method:'DELETE',headers:{'Content-Type':'application/json'},body:'{}'})).status).toBe(400);expect(store.sessions()).toHaveLength(1);
    const result=await fetch(base+'/api/storage',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirm:'DELETE_ALL_DATA'})});expect(result.ok).toBe(true);
    expect(store.sessions()).toHaveLength(0);expect(store.all('SELECT * FROM generations')).toHaveLength(0);expect(store.models.list().map(m=>m.id)).toEqual(['fake']);expect(store.models.key(model.id)).toBe('');expect(store.settings()).toMatchObject({nickname:'你',fontSize:15,sendShortcut:'enter',});expect(store.all('PRAGMA foreign_key_check')).toHaveLength(0);
    expect((await fetch(base+'/api/health')).ok).toBe(true);
    expect(store.models.list()).toHaveLength(1);
    const bad=await fetch(base+'/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({fontSize:100})});expect(bad.status).toBe(400);
  }finally{await close(server);store.db.close();rmSync(dir,{recursive:true,force:true});}
});

import { test, expect } from 'vitest';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { Store } from '../server/store';
import { createApp } from '../server/app';
import { defaultParameters } from '../shared/models';
import { readSSE } from '../shared/sse';

test('desktop secret codec encrypts keys, survives restart, and resets without plaintext',()=>{
  const dir=mkdtempSync(join(tmpdir(),'zhizhi-secret-')),key=randomBytes(32);
  const codec={
    encode(text:string){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);const data=Buffer.concat([cipher.update(text,'utf8'),cipher.final()]);return JSON.stringify({iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')});},
    decode(text:string){const value=JSON.parse(text),cipher=createDecipheriv('aes-256-gcm',key,Buffer.from(value.iv,'base64'));cipher.setAuthTag(Buffer.from(value.tag,'base64'));return Buffer.concat([cipher.update(Buffer.from(value.data,'base64')),cipher.final()]).toString('utf8');},
  };
  let store=new Store(dir,codec);
  try{
    const model=store.models.save({provider:'openai',name:'stub',baseUrl:'http://localhost/v1',model:'stub',supportsImages:false,parameters:defaultParameters(),apiKey:'desktop-private-key'});
    expect(readFileSync(join(dir,'secrets.json'),'utf8')).not.toContain('desktop-private-key');
    store.db.close();store=new Store(dir,codec);expect(store.models.key(model.id)).toBe('desktop-private-key');
    expect(JSON.stringify(store.models.list())).not.toContain('desktop-private-key');
    store.clearData();expect(store.secrets.read()).toEqual({});
  }finally{store.db.close();rmSync(dir,{recursive:true,force:true});}
});

test('desktop API requires session token, rejects foreign origins, and authenticates internal fake streaming',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'zhizhi-api-')),store=new Store(dir);
  store.saveSettings({...store.settings(),fakeDelay:0});
  const {app}=createApp(store,{apiToken:'desktop-token',allowedOrigins:[]}),server=createServer(app);
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const request=(path:string,method='GET',body?:unknown,extra={})=>fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json','x-zhizhi-token':'desktop-token',...extra},body:body?JSON.stringify(body):undefined});
  try{
    expect((await fetch(base+'/api/health')).status).toBe(401);
    expect((await request('/health','GET',undefined,{Origin:'http://127.0.0.1:5173'})).status).toBe(403);
    expect((await request('/health','GET',undefined,{Origin:base})).ok).toBe(true);
    const session=await(await request('/sessions','POST',{})).json();
    const job=await(await request(`/streams/${session.root_stream_id}/messages`,'POST',{text:'测试',requestId:randomUUID()})).json();
    const response=await request(`/generations/${job.generationId}/events`),events=[];
    for await(const event of readSSE(response.body!))events.push(event);
    expect(events.some(e=>e.event==='complete')).toBe(true);
    expect(events.some(e=>e.event==='error')).toBe(false);
  }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));store.db.close();rmSync(dir,{recursive:true,force:true});}
});

test('cancel persists every emitted delta as stopped blocks and later context', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zhizhi-stop-')), store = new Store(dir);
  store.saveSettings({ ...store.settings(), fakeDelay: 20 });
  const { app } = createApp(store), server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const session = store.createSession();
    const generation = store.appendQuestion(session.root_stream_id, '停止测试', randomUUID());
    const response = await fetch(`${base}/api/generations/${generation.generationId}/events`);
    let emitted = '', cancelled = false;
    for await (const event of readSSE(response.body!)) {
      if (event.event === 'delta') {
        emitted += JSON.parse(event.data).text;
        if (!cancelled && emitted.length >= 24) {
          cancelled = true;
          expect((await fetch(`${base}/api/generations/${generation.generationId}/cancel`, { method: 'POST' })).ok).toBe(true);
        }
      }
    }
    expect(cancelled).toBe(true);
    const message = store.stream(session.root_stream_id).messages[1];
    expect(message.status).toBe('stopped');
    expect(message.content_markdown).toBe(emitted);
    expect(message.slots.length).toBeGreaterThan(0);
    expect(store.context(session.root_stream_id).at(-1)?.role).toBe('assistant');
    expect(store.context(session.root_stream_id).at(-1)?.content).toBe(emitted.trim());
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    store.db.close(); rmSync(dir, { recursive: true, force: true });
  }
});

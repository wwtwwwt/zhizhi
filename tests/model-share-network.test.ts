import {expect,test} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {Store} from '../server/store';
import {createApp} from '../server/app';
import {networkFetch,withNetwork,localAddress} from '../server/network';

test('complete model shares preserve credentials and parameters while preview and lists remain private',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'zhizhi-share-')),store=new Store(dir),modes:string[]=[];
  const server=createServer(createApp(store,{onProxyChange:async mode=>{modes.push(mode);}}).app);
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api`;
  const post=async(path:string,data:unknown)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
  try{
    const original={name:'中文测试',baseUrl:'https://example.com/v1',model:'vendor/model',apiType:'messages',authType:'bearer',apiKey:'synthetic-key-only',supportsImages:true,parameters:[{key:'context_length',value:256000,enabled:true},{key:'custom',value:{a:[1,true]},enabled:false}]};
    const model=await(await post('/models',original)).json();
    expect(JSON.stringify(model)).not.toContain(original.apiKey);
    const response=await post(`/models/${model.id}/share`,{});expect(response.headers.get('cache-control')).toBe('no-store');const {code}=await response.json();
    expect(JSON.parse(Buffer.from(code.split(':').at(-1)!,'base64url').toString())).toEqual(original);
    const preview=await(await post('/models/share/preview',{code})).json();expect(preview.hasApiKey).toBe(true);expect(JSON.stringify(preview)).not.toContain(original.apiKey);
    const imported=await(await post('/models/share/import',{code})).json();expect(imported.id).not.toBe(model.id);expect(imported).toMatchObject({name:original.name,apiType:'messages',authType:'bearer',supportsImages:true,parameters:original.parameters});expect(store.models.key(imported.id)).toBe(original.apiKey);
    expect((await post('/models/share/import',{code:'invalid'})).status).toBe(400);
    const invalid='zhizhi:model:1:'+Buffer.from(JSON.stringify({...original,baseUrl:'javascript:alert(1)'})).toString('base64url');expect((await post('/models/share/import',{code:invalid})).status).toBe(400);
    expect((await post('/models/fake/share',{})).status).toBe(400);
    const settings=await fetch(base+'/settings',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({proxyMode:'direct'})});expect((await settings.json()).proxyMode).toBe('direct');expect(modes).toEqual(['direct']);expect(store.settings().proxyMode).toBe('direct');
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));store.db.close();rmSync(dir,{recursive:true,force:true});}
});
test('request scoped network selection stays isolated and bypass recognizes loopback',async()=>{
  const first:typeof fetch=async()=>Response.json('first'),second:typeof fetch=async()=>Response.json('second');
  const result=await Promise.all([withNetwork(first,async()=>{await new Promise(r=>setTimeout(r,10));return(await networkFetch('https://example.com')).json();}),withNetwork(second,async()=>(await networkFetch('https://example.com')).json())]);expect(result).toEqual(['first','second']);
  expect(localAddress('http://127.0.0.2:1234')).toBe(true);expect(localAddress('http://[::1]:1234')).toBe(true);expect(localAddress('https://example.com')).toBe(false);
});

import { expect, test } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { streamAgent } from '../server/providers/agent';
import { createSearchTools, publicWebUrl } from '../server/web-search';
import { createApp } from '../server/app';
import { Store } from '../server/store';
import { readSSE } from '../shared/sse';
import { defaultParameters, type ApiType, type ModelConfig } from '../shared/models';
import type { SearchProgress } from '../shared/search';
async function listen(server: Server) { await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); return `http://127.0.0.1:${(server.address() as { port: number }).port}`; }
async function close(server: Server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
const model = (apiType: ApiType, baseUrl: string): ModelConfig => ({ id:'stub', provider:'openai', name:'stub', model:'stub', baseUrl, apiType, supportsImages:true, parameters:defaultParameters().map(p=>p.key==='temperature'?{...p,enabled:false}:p) });
const event = (res: import('node:http').ServerResponse, value: unknown) => res.write(`data: ${JSON.stringify(value)}\n\n`);
function chat(res: import('node:http').ServerResponse, delta: object, finish: string | null = null) { event(res,{id:'chat',object:'chat.completion.chunk',created:1,model:'stub',choices:[{index:0,delta,finish_reason:finish}]}); }

for (const api of ['chat','responses','messages'] as ApiType[]) test(`${api} loops through search + read, preserves results and stops at final answer`, async()=>{
  const bodies: any[] = [], calls: string[] = [], progress: SearchProgress[] = [];
  const server=createServer(async(req,res)=>{
    let text='';for await(const part of req)text+=part;const body=JSON.parse(text);
    if(req.url?.startsWith('/tools/')){
      calls.push(req.url);expect(req.headers.authorization).toBe('Bearer search-secret');res.setHeader('Content-Type','application/json');
      res.end(JSON.stringify(req.url==='/tools/search'?{results:[{title:'真实来源',url:'https://example.com/article',summary:'搜索摘要'}]}:{title:'真实来源',content:'网页原文'}));return;
    }
    bodies.push(body);const step=bodies.length;res.writeHead(200,{'Content-Type':'text/event-stream'});
    const name=step===1?'web_search':'web_read', args=step===1?{query:'测试资料'}:{url:'https://example.com/article',offset:0};
    if(api==='chat'){
      if(step<3){chat(res,{reasoning_content:'思考摘要'});chat(res,{role:'assistant',tool_calls:[{index:0,id:`call${step}`,type:'function',function:{name,arguments:JSON.stringify(args)}}]});chat(res,{},'tool_calls');}
      else {chat(res,{role:'assistant',content:'已核实的回答'});chat(res,{},'stop');}res.end('data: [DONE]\n\n');
    } else if(api==='responses'){
      if(step<3){event(res,{type:'response.output_item.added',output_index:1,item:{type:'reasoning',id:`reason${step}`,encrypted_content:'encrypted-test-reasoning',summary:[]}});event(res,{type:'response.output_item.done',output_index:1,item:{type:'reasoning',id:`reason${step}`,encrypted_content:'encrypted-test-reasoning',summary:[]}});const item={type:'function_call',id:`fc${step}`,call_id:`call${step}`,name,arguments:JSON.stringify(args),status:'completed'};event(res,{type:'response.output_item.added',output_index:0,item:{...item,arguments:''}});event(res,{type:'response.function_call_arguments.delta',item_id:item.id,output_index:0,delta:JSON.stringify(args)});event(res,{type:'response.output_item.done',output_index:0,item});event(res,{type:'response.completed',response:{id:`r${step}`,created_at:1,model:'stub',status:'completed',output:[item],usage:{input_tokens:10,output_tokens:10,total_tokens:20}}});}
      else {event(res,{type:'response.output_item.added',output_index:0,item:{type:'message',id:'msg',role:'assistant',content:[]}});event(res,{type:'response.output_text.delta',item_id:'msg',output_index:0,content_index:0,delta:'已核实的回答'});event(res,{type:'response.output_item.done',output_index:0,item:{type:'message',id:'msg',role:'assistant',content:[{type:'output_text',text:'已核实的回答',annotations:[]}]}});event(res,{type:'response.completed',response:{id:'r3',created_at:1,model:'stub',status:'completed',output:[],usage:{input_tokens:10,output_tokens:10,total_tokens:20}}});}res.end();
    } else {
      event(res,{type:'message_start',message:{id:`m${step}`,type:'message',role:'assistant',model:'stub',content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:0}}});
      if(step<3){event(res,{type:'content_block_start',index:0,content_block:{type:'thinking',thinking:''}});event(res,{type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:'思考摘要'}});event(res,{type:'content_block_delta',index:0,delta:{type:'signature_delta',signature:'signed-test-thinking'}});event(res,{type:'content_block_stop',index:0});}
      event(res,{type:'content_block_start',index:step<3?1:0,content_block:step<3?{type:'tool_use',id:`call${step}`,name,input:{}}:{type:'text',text:''}});
      event(res,{type:'content_block_delta',index:step<3?1:0,delta:step<3?{type:'input_json_delta',partial_json:JSON.stringify(args)}:{type:'text_delta',text:'已核实的回答'}});
      event(res,{type:'content_block_stop',index:step<3?1:0});event(res,{type:'message_delta',delta:{stop_reason:step<3?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:10}});event(res,{type:'message_stop'});res.end();
    }
  });
  const base=await listen(server);
  try{
    let output='';for await(const text of streamAgent({model:model(api,base+'/v1'),apiKey:'model-secret',searchKey:'search-secret',messages:[{role:'user',content:[{type:'text',text:'查找资料'},{type:'image_url',image_url:{url:'data:image/png;base64,aGVsbG8='}}]}],signal:new AbortController().signal,onReasoning:()=>{},onProgress:value=>progress.push(value),searchEndpoint:base+'/tools'}))output+=text;
    expect(output).toContain('已核实的回答');expect(output).toContain('https://example.com/article');expect(bodies).toHaveLength(3);expect(calls).toEqual(['/tools/search','/tools/fetch']);
    expect(JSON.stringify(bodies[1])).toContain('搜索摘要');expect(JSON.stringify(bodies[2])).toContain('网页原文');
    expect(progress.at(-1)?.activities.map(item=>item.status)).toEqual(['complete','complete']);
    expect(JSON.stringify(bodies)).not.toContain('search-secret');
    expect(JSON.stringify(bodies[0])).toContain('aGVsbG8=');
    if(api==='responses'){expect(bodies.every(body=>body.store===false)).toBe(true);expect(JSON.stringify(bodies[1])).toContain('encrypted-test-reasoning');}
    if(api==='messages')expect(JSON.stringify(bodies[1])).toContain('signed-test-thinking');
    if(api==='chat')expect(JSON.stringify(bodies[1])).toContain('reasoning_content');
  }finally{await close(server);}
});

test('search tools paginate long pages, cache reads, expose failures, deduplicate sources and abort',async()=>{
  let requests=0; const abort=new AbortController(),progress:SearchProgress[]=[];
  const service=createSearchTools({key:'secret',signal:abort.signal,onProgress:value=>progress.push(value),fetch:async()=>{requests++;return new Response(JSON.stringify({title:'page',content:'x'.repeat(12000)}),{headers:{'Content-Type':'application/json'}});}});
  const read=service.tools.web_read.execute!;
  const context={toolCallId:'t',messages:[]} as any;
  const first=await read({url:'https://example.com',offset:0},context) as any;
  expect(first.content.length).toBe(10000);expect(first.nextOffset).toBe(10000);
  const second=await read({url:'https://example.com',offset:10000},context) as any;
  expect(second.content.length).toBe(2000);expect(second.nextOffset).toBeNull();expect(requests).toBe(1);expect(service.getSources()).toHaveLength(1);
  expect((await read({url:'http://127.0.0.1',offset:0},context) as any).error).toContain('公开网页');
  abort.abort();await expect(read({url:'https://example.com',offset:0},context)).rejects.toBeDefined();
  for(const url of ['file:///etc/passwd','http://192.168.1.1','http://localhost','http://[::1]','https://u:p@example.com'])expect(()=>publicWebUrl(url)).toThrow();
  const failure=createSearchTools({key:'secret',signal:new AbortController().signal,onProgress:()=>{},fetch:async()=>new Response('',{status:402})});
  expect((await failure.tools.web_search.execute!({query:'q'},context) as any).error).toContain('余额');
});

test('configuration remains private, off mode uses one original request and auto requires configuration',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'zhizhi-agent-')),store=new Store(dir);let requests=0;
  const upstream=createServer(async(req,res)=>{requests++;let data='';for await(const part of req)data+=part;expect(JSON.parse(data).tools).toBeUndefined();res.writeHead(200,{'Content-Type':'text/event-stream'});chat(res,{content:'普通回答'});res.end('data: [DONE]\n\n');});
  const base=await listen(upstream),server=createServer(createApp(store).app),url=await listen(server);
  const send=async(path:string,method='GET',body?:unknown)=>fetch(url+'/api'+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  try{
    const saved=store.models.save({...model('chat',base+'/v1'),id:undefined,apiKey:'model-key'}),session=store.createSession();
    expect(await(await send('/search-settings')).json()).toEqual({provider:'deepseek',configured:false});
    expect(()=>store.appendQuestion(session.root_stream_id,'q',randomUUID(),{modelId:saved.id,webSearch:'auto'})).toThrow('配置联网');
    expect(store.stream(session.root_stream_id).messages).toHaveLength(0);
    const response=await(await send('/search-settings','PUT',{apiKey:'search-key'})).json();expect(response).toEqual({provider:'deepseek',configured:true});
    store.models.setKey(saved.id,'new-model-key');expect(store.secrets.read().searchKey).toBe('search-key');
    const result=store.appendQuestion(session.root_stream_id,'q',randomUUID(),{modelId:saved.id,webSearch:'off'});
    const events=await send(`/generations/${result.generationId}/events`);for await(const _ of readSSE(events.body!)){}
    expect(requests).toBe(1);expect(store.stream(session.root_stream_id).messages[1].slots[0].node.markdown).toBe('普通回答');
    await send('/search-settings','PUT',{clear:true});expect(store.secrets.read().modelKeys?.[saved.id]).toBe('new-model-key');expect(store.secrets.read().searchKey).toBeUndefined();
  }finally{await close(server);await close(upstream);store.db.close();rmSync(dir,{recursive:true,force:true});}
});

test('auto dispatch streams tool progress but retains only final text in future context', async()=>{
  const dir=mkdtempSync(join(tmpdir(),'zhizhi-agent-live-')),store=new Store(dir);let requests=0;
  const upstream=createServer(async(req,res)=>{
    let text='';for await(const part of req)text+=part;
    if(req.url==='/tools/search'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({results:[{title:'来源',url:'https://example.com',summary:'TRANSIENT_TOOL_RESULT'}]}));return;}
    requests++;res.writeHead(200,{'Content-Type':'text/event-stream'});
    if(requests===1){chat(res,{tool_calls:[{index:0,id:'tool',type:'function',function:{name:'web_search',arguments:'{"query":"资料"}'}}]});chat(res,{},'tool_calls');}
    else {chat(res,{content:'持久回答'});chat(res,{},'stop');}res.end('data: [DONE]\n\n');
  });
  const base=await listen(upstream),server=createServer(createApp(store,{searchEndpoint:base+'/tools'}).app),url=await listen(server);
  try{
    const saved=store.models.save({...model('chat',base+'/v1'),id:undefined,apiKey:'model-key'}),session=store.createSession();store.secrets.write({...store.secrets.read(),searchKey:'search-key'});
    const result=store.appendQuestion(session.root_stream_id,'查资料',randomUUID(),{modelId:saved.id,webSearch:'auto'});
    const response=await fetch(url+`/api/generations/${result.generationId}/events`),events=[];
    for await(const item of readSSE(response.body!))events.push(item);
    expect(events.some(item=>item.event==='search-progress')).toBe(true);expect(events.at(-1)?.event).toBe('complete');expect(requests).toBe(2);
    const context=JSON.stringify(store.context(session.root_stream_id));expect(context).toContain('持久回答');expect(context).toContain('https://example.com');expect(context).not.toContain('TRANSIENT_TOOL_RESULT');expect(context).not.toContain('web_search');
    const generation=store.need('generations',result.generationId);expect(generation.context_json).not.toContain('TRANSIENT_TOOL_RESULT');expect(generation.settings_json).not.toContain('search-key');
  }finally{await close(server);await close(upstream);store.db.close();rmSync(dir,{recursive:true,force:true});}
});

test('tool cap and cancellation abort an in-flight request',async()=>{
  const context={toolCallId:'t',messages:[]} as any;
  let requests=0;
  const capped=createSearchTools({key:'key',signal:new AbortController().signal,onProgress:()=>{},fetch:async()=>{requests++;return Response.json({results:[]});}});
  for(let i=0;i<12;i++)await capped.tools.web_search.execute!({query:'q'},context);
  await expect(capped.tools.web_search.execute!({query:'q'},context)).rejects.toThrow('12');expect(requests).toBe(12);
  const controller=new AbortController();let started!:()=>void;
  const ready=new Promise<void>(resolve=>{started=resolve;});
  const service=createSearchTools({key:'key',signal:controller.signal,onProgress:()=>{},fetch:async(_input,init)=>{started();return new Promise((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>reject(init!.signal!.reason),{once:true}));}});
  const running=service.tools.web_search.execute!({query:'q'},context);await ready;controller.abort();await expect(running).rejects.toBeDefined();
});

test('agent checks assembled budget, caps steps and cancels model streaming',async()=>{
  let requests=0,resolveRequest!:()=>void;
  const upstream=createServer(async(req,res)=>{
    for await(const _ of req){}requests++;resolveRequest?.();res.writeHead(200,{'Content-Type':'text/event-stream'});res.flushHeaders();
    if(req.url==='/hang/chat/completions')return;
    chat(res,{tool_calls:[{index:0,id:`t${requests}`,type:'function',function:{name:'web_search',arguments:'{"query":"q"}'}}]});chat(res,{},'tool_calls');res.end('data: [DONE]\n\n');
  });
  const search=createServer((_req,res)=>{res.setHeader('Content-Type','application/json');res.end('{"results":[]}');});
  const base=await listen(upstream),searchBase=await listen(search);
  const consume=async(selected:ModelConfig,signal=new AbortController().signal)=>{for await(const _ of streamAgent({model:selected,apiKey:'key',searchKey:'search',messages:[{role:'user',content:'q'}],signal,onReasoning:()=>{},onProgress:()=>{},searchEndpoint:searchBase})){};};
  try{
    const tiny=model('chat',base+'/v1');tiny.parameters=[{key:'context_length',value:256,enabled:true},{key:'max_tokens',value:10,enabled:true}];
    await expect(consume(tiny)).rejects.toThrow('上下文');expect(requests).toBe(0);
    await expect(consume(model('chat',base+'/v1'))).rejects.toThrow('8次');expect(requests).toBe(8);
    const controller=new AbortController(),ready=new Promise<void>(resolve=>{resolveRequest=resolve;});
    const pending=consume(model('chat',base+'/hang'),controller.signal);await ready;controller.abort();await expect(pending).rejects.toBeDefined();
  }finally{await close(upstream);await close(search);}
});

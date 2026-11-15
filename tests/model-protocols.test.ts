import { expect, test } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { streamChat } from '../server/providers/chat';
import { requestBody, endpoint } from '../server/providers/protocol';
import { createApp } from '../server/app';
import { Store } from '../server/store';
import { defaultParameters, modelBudget, type ApiType, type ModelConfig } from '../shared/models';
import { readSSE } from '../shared/sse';
import { checkModel, discoverModels } from '../server/model-connection';

async function listen(server: Server) { await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); return `http://127.0.0.1:${(server.address() as {port:number}).port}`; }
async function close(server: Server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
const config = (apiType: ApiType): ModelConfig => ({ id:'test', provider:'openai', apiType, name:'test', baseUrl:'http://localhost/v1', model:'stub', parameters:defaultParameters(), supportsImages:true });
function wire(api: ApiType, broken = false) {
  const events = api === 'chat' ? [{ choices:[{delta:{reasoning_content:'思考'}}] }, { choices:[{delta:{content:'回答中文'}}] }] : api === 'responses' ? [{type:'response.reasoning_summary_text.delta',delta:'思考'}, {type:'response.output_text.delta',delta:'回答中文'}] : [{type:'content_block_delta',delta:{type:'thinking_delta',thinking:'思考'}}, {type:'content_block_delta',delta:{type:'text_delta',text:'回答中文'}}];
  if (!broken) events.push((api === 'responses' ? {type:'response.completed',response:{usage:{output_tokens:3}}} : api === 'messages' ? {type:'message_stop'} : null) as any);
  return events.map(event => `data: ${event ? JSON.stringify(event) : '[DONE]'}\n\n`).join('');
}

test('protocol payloads preserve system, roles and images and translate output and reasoning options', () => {
  const messages = [{role:'system' as const,content:'系统'}, {role:'user' as const,content:[{type:'text' as const,text:'看图'}, {type:'image_url' as const,image_url:{url:'data:image/png;base64,YQ=='}}]}, {role:'assistant' as const,content:'上一轮'}, {role:'user' as const,content:'继续'}];
  const responses = requestBody({...config('responses'), parameters:[...defaultParameters().filter(p=>p.key!=='reasoning_effort'), {key:'reasoning_effort',value:'low',enabled:true}]}, messages) as any;
  expect(responses.input[0]).toEqual({role:'system',content:'系统'});
  expect(responses.input[1].content[1]).toEqual({type:'input_image',image_url:'data:image/png;base64,YQ=='});
  expect(responses).toMatchObject({store:false,max_output_tokens:4096,reasoning:{effort:'low'}});
  expect(responses.max_tokens).toBeUndefined(); expect(responses.context_length).toBeUndefined();
  const anthropic = requestBody(config('messages'), messages) as any;
  expect(anthropic.system).toEqual([{type:'text',text:'系统'}]);
  expect(anthropic.messages.map((m:any)=>m.role)).toEqual(['user','assistant','user']);
  expect(anthropic.messages[0].content[1]).toMatchObject({type:'image',source:{type:'base64',media_type:'image/png',data:'YQ=='}});
  expect(anthropic.max_tokens).toBe(4096);
  expect(endpoint('https://api.anthropic.com','messages')).toBe('https://api.anthropic.com/v1/messages');
  expect(endpoint('https://proxy/v1/','messages')).toBe('https://proxy/v1/messages');
  expect(modelBudget({...config('responses'),parameters:[{key:'max_output_tokens',value:777,enabled:true}]}).output).toBe(777);
});

test.each(['chat','responses','messages'] as ApiType[])('%s streams text/reasoning, authenticates, rejects interrupted/error streams and aborts', async api => {
  let received: any;
  const upstream = createServer(async (req,res) => {
    let body=''; for await(const part of req)body+=part;
    received={path:req.url,headers:req.headers,...JSON.parse(body)};
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    res.end(received.model === 'error' ? 'data: {"type":"error","error":{"message":"fail"}}\n\n' : wire(api,received.model==='broken'));
  });
  const base=await listen(upstream);
  const options={settings:{modelConfig:{...config(api),baseUrl:base+'/v1'}},messages:[{role:'user' as const,content:'你好'}],apiKey:'test-key',fakeUrl:'',kind:'reply',depth:0,signal:new AbortController().signal};
  const collect=async (model='stub',signal=options.signal)=>{let output='',reasoning='';for await(const text of streamChat({...options,signal,settings:{modelConfig:{...options.settings.modelConfig,model}},onReasoning:text=>reasoning+=text}))output+=text;return{output,reasoning};};
  try {
    expect(await collect()).toEqual({output:'回答中文',reasoning:'思考'});
    expect(received.path).toBe(`/v1/${api==='chat'?'chat/completions':api}`);
    expect(api==='messages'?received.headers['x-api-key']:received.headers.authorization).toBe(api==='messages'?'test-key':'Bearer test-key');
    if(api==='messages')expect(received.headers['anthropic-version']).toBe('2023-06-01');
    await expect(collect('broken')).rejects.toThrow('提前结束');
    await expect(collect('error')).rejects.toThrow('中途返回错误');
    const abort=new AbortController();abort.abort();await expect(collect('stub',abort.signal)).rejects.toBeDefined();
  } finally {await close(upstream);}
});

test.each(['responses','messages'] as ApiType[])('%s persists streaming replies, attachments, branch replies and rewrite proposals',async api=>{
  const dir=mkdtempSync(join(tmpdir(),'zhizhi-protocol-')),store=new Store(dir);
  const upstream=createServer(async(req,res)=>{for await(const _ of req){}res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(wire(api));});
  const base=await listen(upstream),appServer=createServer(createApp(store).app),appUrl=await listen(appServer);
  const send=async(path:string,method='GET',data?:unknown)=>fetch(appUrl+path,{method,headers:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
  const run=async(id:string)=>{const response=await send(`/api/generations/${id}/events`);const events=[];for await(const event of readSSE(response.body!))events.push(event);expect(events.some(event=>event.event==='complete')).toBe(true);};
  try {
    const model=store.models.save({...config(api),id:undefined,baseUrl:base+'/v1',apiKey:'test-key'});
    const session=store.createSession();
    const result=store.appendQuestion(session.root_stream_id,'问题',randomUUID(),{modelId:model.id,attachments:[{name:'a.png',kind:'image',mime:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1sAAAAASUVORK5CYII='}]});
    await run(result.generationId);
    const message=store.stream(session.root_stream_id).messages[1];expect(message.slots[0].node.markdown).toBe('回答中文');expect(message.reasoning_text).toBe('思考');
    const source=message.slots[0].node;
    const branch=store.createBranch(source.id,0,2,'回答','追问',randomUUID(),'question',{modelId:model.id});if(!('generationId' in branch))throw new Error('缺少生成任务');await run(branch.generationId);
    const rewrite=store.rewrite(source.id,randomUUID(),model.id);await run(rewrite.generationId);
    expect(store.stream(session.root_stream_id).messages[1].slots[0].proposals).toHaveLength(1);
  } finally {await close(appServer);await close(upstream);store.db.close();rmSync(dir,{recursive:true,force:true});}
});

test('import/discovery/check routes keep imported keys private and unsaved until confirmed; chat probes adapt output parameter',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'zhizhi-setup-api-')),store=new Store(dir);
  let received:any,header='';
  const upstream=createServer(async(req,res)=>{
    header=req.headers.authorization || '';
    if(req.url?.startsWith('/v1/models')){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({data:[{id:'gpt-stub'}]}));return;}
    let text='';for await(const part of req)text+=part;received=JSON.parse(text);
    if(received.max_tokens){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'Unsupported max_tokens; use max_completion_tokens'}}));return;}
    res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(wire('chat'));
  });
  const base=await listen(upstream),server=createServer(createApp(store,{readModelImports:async()=>[{id:'import-id',source:'Codex',baseUrl:base+'/v1',apiKey:'private-key',apiType:'chat',authType:'bearer',model:'gpt-stub'}]}).app),appUrl=await listen(server);
  const send=async(path:string,data:unknown)=>fetch(appUrl+'/api/models'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  try{
    const sources=await(await send('/import-sources',{})).json();expect(sources).toHaveLength(1);expect(JSON.stringify(sources)).not.toContain('private-key');
    const connection={baseUrl:base+'/v1',apiType:'chat',authType:'bearer',importSourceId:sources[0].id};
    const discovery=await(await send('/discover',connection)).json();expect(discovery.models).toEqual(['gpt-stub']);expect(header).toBe('Bearer private-key');
    const check=await(await send('/check',{...connection,model:'gpt-stub'})).json();expect(check).toEqual({ok:true,outputParameter:'max_completion_tokens'});expect(received.max_completion_tokens).toBe(256);
    expect(store.models.list()).toHaveLength(1);expect(store.secrets.read().modelKeys).toBeUndefined();
    const changed=await send('/discover',{...connection,baseUrl:base+'/wrong'});expect(changed.status).toBe(400);
    const saved=await(await send('',{...connection,name:'Imported',model:'gpt-stub',supportsImages:false,parameters:defaultParameters()})).json();expect(saved.apiType).toBe('chat');expect(saved.hasApiKey).toBe(true);expect(JSON.stringify(saved)).not.toContain('private-key');expect(saved.importSourceId).toBeUndefined();expect(store.models.key(saved.id)).toBe('private-key');
  }finally{await close(server);await close(upstream);store.db.close();rmSync(dir,{recursive:true,force:true});}
});

test('Messages discovery follows pagination with bearer auth and Responses probe distinguishes budget exhaustion from interruption', async () => {
  const paths: string[] = [];
  const upstream = createServer(async (req, res) => {
    if (req.method === 'GET') {
      paths.push(req.url!);
      expect(req.headers.authorization).toBe('Bearer test-key');
      expect(req.headers['anthropic-version']).toBe('2023-06-01');
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(req.url?.includes('after_id=') ? { data: [{ id: 'b' }], has_more: false } : { data: [{ id: 'a' }], last_id: 'a', has_more: true }));
      return;
    }
    let body = ''; for await (const part of req) body += part;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"type":"response.reasoning_summary_text.delta","delta":"thinking"}\n\n');
    if (JSON.parse(body).model === 'bounded') res.write('data: {"type":"response.incomplete","response":{"incomplete_details":{"reason":"max_output_tokens"}}}\n\n');
    res.end();
  });
  const base = await listen(upstream);
  try {
    expect(await discoverModels(base, 'messages', 'test-key', new AbortController().signal, 'bearer')).toEqual(['a', 'b']);
    expect(paths[1]).toContain('after_id=a');
    const model = { ...config('responses'), baseUrl: base, model: 'bounded' };
    await expect(checkModel(model, '', new AbortController().signal)).resolves.toBe('max_tokens');
    await expect(checkModel({ ...model, model: 'interrupted' }, '', new AbortController().signal)).rejects.toThrow('提前结束');
  } finally { await close(upstream); }
});

test.each(['chat', 'responses', 'messages'] as ApiType[])('%s cancels an active stream after preserving received text', async api => {
  const upstream = createServer(async (req, res) => {
    for await (const _ of req) {}
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(wire(api, true));
  });
  const base = await listen(upstream), abort = new AbortController();
  let output = '';
  try {
    const consume = async () => {
      for await (const text of streamChat({ settings: { modelConfig: { ...config(api), baseUrl: base } }, apiKey: '', messages: [{ role: 'user', content: 'test' }], fakeUrl: '', kind: 'reply', depth: 0, signal: abort.signal })) {
        output += text; abort.abort();
      }
    };
    await expect(consume()).rejects.toBeDefined();
    expect(output).toBe('回答中文');
  } finally { abort.abort(); await close(upstream); }
});

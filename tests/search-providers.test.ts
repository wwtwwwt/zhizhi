import {expect,test} from 'vitest';
import {createServer,type Server} from 'node:http';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {createSearchTools} from '../server/web-search';
import {Secrets} from '../server/secrets';
import {saveSearchConfig,searchConfig,publicSearchConfig} from '../server/search-config';
async function listen(server:Server){await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));return `http://127.0.0.1:${(server.address() as {port:number}).port}`;}
async function close(server:Server){server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
const context={toolCallId:'test',messages:[]} as any;
test('provider keys are isolated, selections saved, Exa keyless and public state private',()=>{
  const dir=mkdtempSync(join(tmpdir(),'zhizhi-search-keys-')),secrets=new Secrets(dir);
  try{
    secrets.write({modelKeys:{m:'model-key'},searchKey:'deepseek-key'});
    saveSearchConfig(secrets,{provider:'tavily',apiKey:'tavily-key'});expect(searchConfig(secrets).key).toBe('tavily-key');
    saveSearchConfig(secrets,{provider:'exa'});expect(searchConfig(secrets)).toMatchObject({provider:'exa',key:'',configured:true});
    saveSearchConfig(secrets,{provider:'tavily'});expect(searchConfig(secrets).key).toBe('tavily-key');
    saveSearchConfig(secrets,{provider:'tavily',clear:true});expect(searchConfig(secrets).configured).toBe(false);
    saveSearchConfig(secrets,{provider:'deepseek'});expect(searchConfig(secrets).key).toBe('deepseek-key');
    expect(JSON.stringify(publicSearchConfig(secrets))).not.toContain('-key');expect(secrets.read().modelKeys?.m).toBe('model-key');
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('Tavily search/extract use correct auth, normalize results and cache paginated content',async()=>{
  const requests:any[]=[],tools=createSearchTools({provider:'tavily',key:'tvly-test',signal:new AbortController().signal,onProgress:()=>{},fetch:async(input,init)=>{
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer tvly-test');const body=JSON.parse(String(init?.body));requests.push({url:String(input),body});
    return Response.json(String(input).endsWith('/search')?{results:[{title:'T',url:'https://example.com',content:'summary',published_date:'today'}]}:{results:[{url:'https://example.com/',raw_content:'x'.repeat(11000)}]});
  }});
  const search=await tools.tools.web_search.execute!({query:'test'},context) as any;expect(search.results[0]).toMatchObject({summary:'summary',date:'today'});
  const first=await tools.tools.web_read.execute!({url:'https://example.com',offset:0},context) as any;expect(first.content.length).toBe(10000);
  const second=await tools.tools.web_read.execute!({url:'https://example.com',offset:10000},context) as any;expect(second.content.length).toBe(1000);
  expect(requests).toHaveLength(2);expect(requests[0]).toMatchObject({url:'https://api.tavily.com/search',body:{max_results:5,search_depth:'basic'}});expect(requests[1].body).toEqual({urls:['https://example.com/'],extract_depth:'basic',format:'markdown'});
});
test('Exa hosted MCP handshakes, whitelists tools, normalizes text and closes connections',async()=>{
  const calls:any[]=[],methods:string[]=[];
  const server=createServer(async(req,res)=>{
    expect(req.headers['x-api-key']).toBe('exa-test');expect(req.url).toContain('tools=web_search_exa%2Cweb_fetch_exa');
    if(req.method==='GET'){res.writeHead(405);res.end();return;}
    let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);methods.push(body.method);
    if(body.method==='notifications/initialized'){res.writeHead(202);res.end();return;}
    let result:any;
    if(body.method==='initialize')result={protocolVersion:body.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'exa-stub',version:'1'}};
    else if(body.method==='tools/call'){calls.push(body.params);result={content:[{type:'text',text:body.params.name==='web_search_exa'?'Title: Article\nURL: https://example.com/article\nText: excerpt':'Full page markdown'}]};}
    else {res.writeHead(405);res.end();return;}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:body.id,result}));
  });const endpoint=await listen(server);
  try{
    const tools=createSearchTools({provider:'exa',key:'exa-test',signal:new AbortController().signal,onProgress:()=>{},endpoint});
    const search=await tools.tools.web_search.execute!({query:'test'},context) as any;expect(search.results[0]).toMatchObject({title:'Article',url:'https://example.com/article'});
    const read=await tools.tools.web_read.execute!({url:'https://example.com/article',offset:0},context) as any;expect(read.content).toBe('Full page markdown');
    expect(calls.map(call=>call.name)).toEqual(['web_search_exa','web_fetch_exa']);expect(calls[0].arguments).toEqual({query:'test',objective:'test',numResults:5});expect(calls[1].arguments.urls).toEqual(['https://example.com/article']);expect(methods.filter(m=>m==='initialize')).toHaveLength(2);
  }finally{await close(server);}
});
test('Tavily failures remain explicit and Exa MCP error text is not leaked',async()=>{
  const t=createSearchTools({provider:'tavily',key:'key',signal:new AbortController().signal,onProgress:()=>{},fetch:async()=>new Response('',{status:401})});
  expect(await t.tools.web_search.execute!({query:'q'},context)).toMatchObject({error:expect.stringContaining('密钥')});
  const e=createSearchTools({provider:'exa',key:'private-key',signal:new AbortController().signal,onProgress:()=>{},fetch:async()=>{throw new Error('private-key');}});
  const result=await e.tools.web_search.execute!({query:'q'},context);expect(JSON.stringify(result)).not.toContain('private-key');expect(result).toHaveProperty('error');
});

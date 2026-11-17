import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { SearchProvider } from '../shared/search';
type Options = {provider?:SearchProvider;key:string;signal:AbortSignal;endpoint?:string;fetch?:typeof fetch};
export async function boundedResponse(response: Response) {
  if(!response.ok){await response.body?.cancel();throw new Error(`搜索服务返回 ${response.status}${response.status===402 ? '，请检查余额' : response.status===401 || response.status===403 ? '，请检查密钥或使用额度' : ''}`);}
  const reader=response.body?.getReader();if(!reader)throw new Error('搜索服务没有返回内容');
  let size=0;const chunks:Uint8Array[]=[];
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4*1024*1024)throw new Error('网页结果过大，请缩小查询范围');chunks.push(value);}}
  finally{await reader.cancel().catch(()=>{});}
  return Buffer.concat(chunks).toString('utf8');
}
// The model sees only our two bounded tools. No remote instructions or other
// MCP tools are imported into its prompt, even when a key unlocks more tools.
export function searchService(options:Options) {
  const provider=options.provider || 'deepseek';
  const request=async(path:string,body:unknown)=>{
    const response=await(options.fetch || fetch)(`${options.endpoint || (provider==='tavily' ? 'https://api.tavily.com' : 'https://api.deepseek.com/v1/tools')}/${path}`,{method:'POST',headers:{Authorization:`Bearer ${options.key}`,'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.any([options.signal,AbortSignal.timeout(30_000)])});
    const text=await boundedResponse(response);try{return JSON.parse(text);}catch{throw new Error('搜索服务返回了无效JSON');}
  };
  const exa=async(name:string,args:Record<string,unknown>)=>{
    const signal=AbortSignal.any([options.signal,AbortSignal.timeout(30_000)]);
    const url=new URL(options.endpoint || 'https://mcp.exa.ai/mcp');url.searchParams.set('tools','web_search_exa,web_fetch_exa');
    const transport=new StreamableHTTPClientTransport(url,{requestInit:{headers:options.key ? {'x-api-key':options.key} : {}},fetch:async(input,init)=>{
      const response=await(options.fetch || fetch)(input,{...init,redirect:'error',signal:AbortSignal.any([signal,...(init?.signal?[init.signal]:[])])});
      // MCP may return 202/204 notifications or a bounded JSON/SSE tool result.
      if(response.status===202 || response.status===204)return response;
      const text=await boundedResponse(response);return new Response(text,{status:response.status,headers:response.headers});
    }});
    const client=new Client({name:'zhizhi-search',version:'1.0.0'},{capabilities:{}});
    try{
      await client.connect(transport,{signal});
      const result=await client.callTool({name,arguments:args},undefined,{signal,timeout:30_000});
      if(result.isError)throw new Error('Exa 查询失败，请检查密钥、额度或稍后重试');
      const text=(Array.isArray(result.content)?result.content:[]).flatMap(item=>item.type==='text' && typeof item.text==='string'?[item.text]:[]).join('\n');
      return {structured:result.structuredContent,text};
    }catch(error){signal.throwIfAborted();throw new Error(error instanceof Error && error.message==='Exa 查询失败，请检查密钥、额度或稍后重试' ? error.message : '无法完成 Exa 查询，请检查网络、密钥或使用额度');}
    finally{await client.close().catch(()=>{});}
  };
  return {
    async search(query:string):Promise<{results:any[]}>{
      if(provider==='deepseek')return request('search',{query,count:5,need_content:false});
      if(provider==='tavily'){
        const data=await request('search',{query,max_results:5,search_depth:'basic',include_answer:false,include_raw_content:false});
        if(!Array.isArray(data.results))throw new Error('搜索服务返回格式无效');
        return {results:data.results.map((item:any)=>({...item,summary:item.content,date:item.published_date}))};
      }
      const result=await exa('web_search_exa',{query,objective:query,numResults:5});
      const structured=result.structured as {results?:any[]}|undefined;
      if(Array.isArray(structured?.results))return {results:structured.results.map(item=>({...item,summary:item.text || item.summary || item.highlights?.join('\n'),date:item.publishedDate}))};
      try{const data=JSON.parse(result.text);if(Array.isArray(data.results))return {results:data.results.map((item:any)=>({...item,summary:item.text || item.summary || item.highlights?.join('\n')}))};}catch{}
      // Hosted Exa MCP emits human-readable Title/URL/Text sections.
      const sections=result.text.split(/(?=^Title:\s)/m),results:any[]=[];
      for(const section of sections){const url=/^URL:\s*(https?:\/\/\S+)/m.exec(section)?.[1];if(url)results.push({url,title:/^Title:\s*(.+)/m.exec(section)?.[1] || url,summary:section.replace(/^Title:.*\n?|^URL:.*\n?/gm,'')});}
      if(!results.length && !/no (?:results|relevant|matching)|no search results/i.test(result.text))throw new Error('Exa 返回格式无法识别，请稍后重试');
      return {results};
    },
    async read(url:string):Promise<{title?:string;content:string}>{
      if(provider==='deepseek')return request('fetch',{url});
      if(provider==='tavily'){
        const data=await request('extract',{urls:[url],extract_depth:'basic',format:'markdown'});
        const page=data.results?.find((item:any)=>item.url===url) || data.results?.[0];
        if(typeof page?.raw_content!=='string' || !page.raw_content.trim())throw new Error('Tavily 未能读取此网页');
        return {title:page.title || url,content:page.raw_content};
      }
      const result=await exa('web_fetch_exa',{urls:[url],maxCharacters:100000});
      let structured=result.structured as {results?:any[]}|undefined;
      if(!structured){try{structured=JSON.parse(result.text);}catch{}}
      if(Array.isArray(structured?.results)){
        const page=structured.results.find(item=>item.url===url) || structured.results[0];
        const content=page?.text || page?.content;
        if(typeof content!=='string' || !content.trim())throw new Error('Exa 未能读取此网页');
        return {title:page.title || url,content};
      }
      return {title:url,content:result.text};
    },
  };
}

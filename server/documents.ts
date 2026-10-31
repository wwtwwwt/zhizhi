import { randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import { ProxyAgent, fetch } from 'undici';
import { AppError, type Store } from './store';
import { nodeTree, parseTree, printTree, splitMarkdown } from '../shared/markdown';
import { imageNodes, resourcePath, safeImageUrl, visitAst, type DocumentImport } from '../shared/documents';

const maxMarkdown = 2 * 1024 * 1024, maxImages = 12 * 1024 * 1024;
function imageMime(data: Buffer) {
  if (data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) return 'image/jpeg';
  if (/^GIF8[79]a/.test(data.subarray(0,6).toString())) return 'image/gif';
  if (data.subarray(0,4).toString() === 'RIFF' && data.subarray(8,12).toString() === 'WEBP') return 'image/webp';
  if (/^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)?<svg[\s>]/i.test(data.toString('utf8'))) return 'image/svg+xml';
  throw new AppError(400, 'INVALID_RESOURCE', '图片资源需要为 PNG、JPG、GIF、WebP 或 SVG');
}
export function importDocument(store: Store, input: DocumentImport) {
  const name = input.name.trim();
  if (!name || name.length > 250 || !input.markdown.trim() || Buffer.byteLength(input.markdown) > maxMarkdown) throw new AppError(400, 'INVALID_DOCUMENT', '文档名称无效、内容为空或超过 2 MiB');
  const files = new Map<string, { id: string; path: string; mime: string; data: Buffer }>(); let total = 0;
  for (const f of input.resources) {
    const path = resourcePath(f.path); if (!path || files.has(path) || !/^[A-Za-z0-9+/]*={0,2}$/.test(f.data)) throw new AppError(400, 'INVALID_RESOURCE', '图片资源路径重复或编码无效');
    const data = Buffer.from(f.data,'base64'); total += data.length;
    if (data.length > 5 * 1024 * 1024 || total > maxImages) throw new AppError(400, 'RESOURCE_LIMIT', '单张图片最多 5 MiB，总计最多 12 MiB');
    files.set(path, { id: randomUUID(), path, mime: imageMime(data), data });
  }
  const used = new Set<string>(), missing = new Set<string>();
  const tree = parseTree(input.markdown);
  visitAst(tree, n => {
    if (n.type === 'imageReference') throw new AppError(400,'MISSING_RESOURCES',`图片引用缺少定义：${n.identifier}`);
    if (n.type === 'image') {
      const url = n.url || '';
      if (/^data:/i.test(url)) {
        const match = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/=]+)$/i.exec(url);
        if (!match) throw new AppError(400, 'INVALID_RESOURCE', '不支持此内嵌图片格式');
        const data = Buffer.from(match[2], 'base64'); total += data.length;
        if (data.length > 5 * 1024 * 1024 || total > maxImages) throw new AppError(400, 'RESOURCE_LIMIT', '图片资源过大');
        const path = `embedded-${files.size}`, file = { id: randomUUID(), path, mime: imageMime(data), data };
        files.set(path,file); used.add(path); n.url = `/api/document-resources/${file.id}`;
      } else if (/^https?:\/\//i.test(url)) { /* Keep externally hosted image references. */ }
      else if (/^[a-z][a-z\d+.-]*:/i.test(url)) throw new AppError(400, 'INVALID_RESOURCE', '图片引用协议不受支持');
      else if (input.baseUrl) {
        n.url = new URL(url, input.baseUrl).href;
        if (!safeImageUrl(n.url)) throw new AppError(400,'INVALID_RESOURCE','图片地址无效');
      } else {
        const parent = input.documentPath?.includes('/') ? input.documentPath.slice(0,input.documentPath.lastIndexOf('/')+1) : '';
        const path = resourcePath(parent+url), file = files.get(path);
        if (!file) missing.add(url); else { used.add(path); n.url = `/api/document-resources/${file.id}`; }
      }
    } else if (n.type === 'link' && n.url && input.baseUrl) {
      try { n.url = new URL(n.url,input.baseUrl).href; } catch { /* Invalid links remain non-clickable. */ }
    }
  });
  if (missing.size) throw new AppError(400, 'MISSING_RESOURCES', `缺少图片资源：${[...missing].slice(0,8).join('、')}。请补选图片或包含它们的文件夹。`);
  tree.children = tree.children?.filter(n => n.type !== 'definition');
  const markdown = printTree(tree);
  if (!splitMarkdown(markdown).length) throw new AppError(400,'INVALID_DOCUMENT','文档没有可显示的内容');
  return store.tx(() => {
    const sid = randomUUID(), root = randomUUID(), mid = randomUUID(), time = new Date().toISOString();
    store.run('INSERT INTO sessions VALUES(?,?,?,?)',sid,name.slice(0,120),time,time);
    store.run("INSERT INTO streams VALUES(?,?,'root','[]')",root,sid);
    store.run("INSERT INTO messages(id,stream_id,ordinal,role,status,document_name,document_source) VALUES(?,?,0,'user','complete',?,?)",mid,root,name,input.sourceUrl || null);
    store.finalizeMessage(mid,markdown);
    for (const path of used) { const f = files.get(path)!; store.run('INSERT INTO document_resources VALUES(?,?,?,?,?)', f.id,mid,path,f.mime,f.data); }
    return { id: sid, title: name.slice(0,120), root_stream_id: root, updated_at: time };
  });
}

export function paperUrl(value: string) {
  const input = value.trim();
  const url = new URL(/^https?:\/\//i.test(input) ? input : `https://arxiv.org/abs/${input.replace(/^arxiv:/i,'')}`);
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || /^(localhost|127\.|0\.|\[|10\.|192\.168\.|169\.254\.)/i.test(url.hostname)) throw new AppError(400,'INVALID_URL','请输入公开的论文链接或 arXiv ID');
  if (/^(?:www\.|export\.)?arxiv\.org$/i.test(url.hostname)) {
    const match = url.pathname.match(/^\/(?:abs|pdf|html)\/(\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+(?:\.[A-Z]{2})?\/\d{7}(?:v\d+)?)(?:\.pdf)?\/?$/i);
    if (!match) throw new AppError(400,'INVALID_URL','arXiv 链接格式无效');
    return `https://arxiv.org/html/${match[1]}`;
  }
  return url.href;
}
async function proxyFor(endpoint: string) {
  if (new URL(endpoint).hostname === '127.0.0.1') return undefined;
  const configured = process.env.INKTOMD_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  if (configured) return new ProxyAgent(configured);
  // The user's local dev proxy. A missing proxy must not prevent direct use.
  const available = await new Promise<boolean>(resolve => { const socket = createConnection({host:'127.0.0.1',port:7897}); const done = (ok:boolean) => { socket.destroy(); resolve(ok); }; socket.setTimeout(150,()=>done(false)); socket.once('connect',()=>done(true)); socket.once('error',()=>done(false)); });
  return available ? new ProxyAgent('http://127.0.0.1:7897') : undefined;
}
export async function convertPaper(value: string, endpoint = 'https://www.inktomd.com/api/convert-url', signal?: AbortSignal) {
  let url: string;
  try { url = paperUrl(value); } catch (e) { throw e instanceof AppError ? e : new AppError(400,'INVALID_URL','请输入有效的论文链接或 arXiv ID'); }
  const dispatcher = await proxyFor(endpoint);
  const timeout = AbortSignal.timeout(120_000), combined = signal ? AbortSignal.any([timeout,signal]) : timeout;
  const request = async (target: string) => {
    const response = await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:target}),signal:combined,...(dispatcher ? {dispatcher} : {})});
    if (!response.ok) { await response.body?.cancel(); throw new AppError(502,'PAPER_CONVERSION_FAILED', response.status === 429 ? 'InkToMd 请求次数已达上限，请稍后再试' : `InkToMd 转换失败（${response.status}）`); }
    const reader = response.body!.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try { while (true) { const {done,value} = await reader.read(); if (done) break; size += value.length; if (size > maxMarkdown * 2) throw new AppError(502,'PAPER_TOO_LARGE','转换结果超过大小限制'); chunks.push(value); } }
    finally { await reader.cancel().catch(()=>{}); }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {markdown?:string};
    if (typeof data.markdown !== 'string' || !data.markdown.trim()) throw new AppError(502,'PAPER_CONVERSION_FAILED','InkToMd 没有返回正文');
    if (/No HTML (?:available|for)|HTML is not available|Page not found|404 Not Found/i.test(data.markdown.slice(0,1000))) throw new AppError(502,'NO_HTML','论文暂时没有 HTML 全文');
    return data.markdown;
  };
  try {
    let markdown: string;
    try { markdown = await request(url); }
    catch (e) { if (!url.startsWith('https://arxiv.org/html/') || combined.aborted || e instanceof AppError && ['PAPER_TOO_LARGE'].includes(e.code) || e instanceof AppError && e.message.includes('上限')) throw e; url = url.replace('/html/','/pdf/'); markdown = await request(url); }
    const headings = parseTree(markdown).children?.filter(n=>n.type === 'heading') || [];
    const heading = headings.find(n=>n.depth === 1) || headings[0];
    if (url.startsWith('https://arxiv.org/html/') && heading) {
      markdown = markdown.slice(heading.position!.start.offset!);
      const end = markdown.search(/^## Instructions for reporting errors/m); if (end >= 0) markdown = markdown.slice(0,end);
    }
    const name = heading ? nodeTree(printTree({type:'root',children:[heading]})).text.replace(/^Title:\s*/i,'').slice(0,240) : new URL(url).pathname.split('/').filter(Boolean).pop() || '论文';
    // PDF conversion cannot reliably provide a base for relative asset paths.
    if (new URL(url).pathname.startsWith('/pdf/') && imageNodes(markdown).some(n => !/^https?:|^data:/i.test(n.url || ''))) throw new AppError(502,'MISSING_PAPER_IMAGES','InkToMd 返回了没有下载地址的图片。请下载 Markdown 和图片后从文件导入。');
    return { name: `${name}.md`, markdown, resources: [], baseUrl: url, sourceUrl: value } satisfies DocumentImport;
  } catch(e) { throw e instanceof AppError ? e : new AppError(502,'PAPER_CONVERSION_FAILED', combined.aborted ? '论文转换已取消或超时，请重试' : '无法连接 InkToMd，请检查网络或代理后重试'); }
  finally { await dispatcher?.close(); }
}

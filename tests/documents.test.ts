import { expect, test } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store';
import { createApp } from '../server/app';
import { importDocument, paperUrl } from '../server/documents';
import { nodeTree, splitMarkdown } from '../shared/markdown';
import { withoutImages } from '../shared/documents';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1sAAAAASUVORK5CYII=';
async function listen(s:Server) { await new Promise<void>(r=>s.listen(0,'127.0.0.1',r)); return `http://127.0.0.1:${(s.address() as {port:number}).port}`; }
async function close(s:Server) { s.closeAllConnections(); await new Promise<void>(r=>s.close(()=>r())); }

test('images split out of formatted paragraphs, lists, references and tables; fenced examples remain text',()=>{
  const md='# 文档\n\n**前 ![图][pic] 后**\n\n- 列表 ![二](b.png) 文字\n\n|甲|乙|\n|--|--|\n|![三](c.png)|字|\n\n[pic]: ./a.png "图题"\n\n```md\n![保留示例](sample.png)\n```';
  const blocks=splitMarkdown(md);
  expect(blocks.filter(b=>b.type==='image')).toHaveLength(3);
  expect(blocks.filter(b=>b.type==='image').every(b=>splitMarkdown(b.markdown).length===1)).toBe(true);
  expect(blocks.some(b=>b.markdown==='**前 **')).toBe(false);
  expect(blocks.find(b=>b.type==='code')?.markdown).toContain('sample.png');
  expect(blocks.some(b=>b.type==='definition')).toBe(false);
  expect(blocks.some(b=>b.markdown.includes('./a.png'))).toBe(true);
  const stripped=withoutImages('正文 ![图](foo.png)\n\n`![示例](code.png)`');
  expect(stripped).not.toContain('foo.png');expect(stripped).toContain('code.png');
});

test('document imports are atomic, keep resources across reload and omit images in main, frozen branch and rewritten context',()=>{
  const dir=mkdtempSync(join(tmpdir(),'learn-document-'));let store=new Store(dir);
  try {
    expect(()=>importDocument(store,{name:'讲义.md',markdown:'缺失 ![图](missing.png)',resources:[]})).toThrow('缺少图片资源');expect(store.sessions()).toHaveLength(0);
    const session=importDocument(store,{name:'讲义.md',documentPath:'project/docs/讲义.md',markdown:'# 文档\n\n**先修知识**\n\n![图](../images/a%20b.png)\n\n后续正文',resources:[{path:'project/images/a b.png',data:png}]});
    let message=store.stream(session.root_stream_id).messages[0];
    expect(message.document_name).toBe('讲义.md');expect(message.role).toBe('user');expect(message.generation_id).toBe(null);
    expect(message.slots.map(s=>s.node.block_type)).toEqual(['heading','paragraph','image','paragraph']);
    expect(store.all('SELECT * FROM generations')).toHaveLength(0);
    const resource=store.all('SELECT * FROM document_resources')[0];expect(Buffer.from(resource.data).toString('base64')).toBe(png);
    expect(message.slots[2].node.markdown).toContain(`/api/document-resources/${resource.id}`);
    const branchSource=message.slots[3].node;
    const branch=store.createBranch(branchSource.id,0,2,branchSource.selection_text.slice(0,2),'详细解释',randomUUID());
    const context=store.context(branch.streamId);expect(JSON.stringify(context)).not.toContain(resource.id);expect(JSON.stringify(context)).not.toContain('image_url');expect(JSON.stringify(context)).toContain('先修知识');
    const generation=store.need('generations',branch.generationId);expect(generation.context_json).not.toContain(resource.id);store.run("UPDATE generations SET status='complete' WHERE id=?",branch.generationId);store.run("UPDATE messages SET status='complete' WHERE generation_id=?",branch.generationId);
    const rewrite=store.rewrite(branchSource.id,randomUUID());expect(store.need('generations',rewrite.generationId).context_json).not.toContain(resource.id);
    store.db.close();store=new Store(dir);message=store.stream(session.root_stream_id).messages[0];expect(message.document_name).toBe('讲义.md');expect(JSON.stringify(store.context(branch.streamId))).not.toContain(resource.id);
    store.run('DELETE FROM sessions WHERE id=?',session.id);expect(store.all('SELECT * FROM document_resources')).toHaveLength(0);
  } finally {store.db.close();rmSync(dir,{recursive:true,force:true});}
});

test('paper URL conversion uses full text, preserves relative images, normalizes references and surfaces converter failures without empty sessions',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'learn-paper-')),store=new Store(dir);const targets:string[]=[];
  const converter=createServer(async(req,res)=>{
    let body='';for await(const c of req)body+=c;const {url}=JSON.parse(body);targets.push(url);
    res.setHeader('Content-Type','application/json');
    if(url.includes('fail.example')){res.writeHead(429);res.end('{}');return;}
    if(url.endsWith('/pdf/9999.00001')){res.end(JSON.stringify({markdown:'# PDF 全文\n\n完整正文。'}));return;}
    if(url.endsWith('9999.00001')){res.writeHead(404);res.end('{}');return;}
    res.end(JSON.stringify({markdown:'##### Report Issue\n\n# 测试论文\n\n正文\n\n![Figure][fig]\n\n[fig]: 1706.03762/Figures/chart.png\n\n## Instructions for reporting errors\n\n非正文'}));
  });
  const endpoint=await listen(converter),server=createServer(createApp(store,{paperEndpoint:endpoint+'/convert-url'}).app),base=await listen(server);
  const post=(url:string)=>fetch(base+'/api/documents/paper',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url})});
  try {
    const response=await post('https://arxiv.org/abs/1706.03762');expect(response.status).toBe(200);const session=await response.json();const message=store.stream(session.root_stream_id).messages[0];
    expect(targets).toEqual(['https://arxiv.org/html/1706.03762']);expect(message.document_name).toBe('测试论文.md');expect(message.content_markdown).not.toContain('Report Issue');expect(message.content_markdown).not.toContain('非正文');
    expect(message.slots.find(s=>s.node.block_type==='image')?.node.markdown).toContain('https://arxiv.org/html/1706.03762/Figures/chart.png');
    expect(JSON.stringify(store.context(session.root_stream_id))).not.toContain('chart.png');
    expect(paperUrl('arXiv:1706.03762v7')).toBe('https://arxiv.org/html/1706.03762v7');expect(paperUrl('https://arxiv.org/pdf/hep-th/9901001.pdf')).toBe('https://arxiv.org/html/hep-th/9901001');
    const failed=await post('https://fail.example/paper');expect(failed.status).toBe(502);expect((await failed.json()).error.message).toContain('上限');expect(store.sessions()).toHaveLength(1);
    const fallback=await post('9999.00001');expect(fallback.status).toBe(200);const pdf=await fallback.json();expect(store.stream(pdf.root_stream_id).messages[0].document_name).toBe('PDF 全文.md');expect(targets.slice(-2)).toEqual(['https://arxiv.org/html/9999.00001','https://arxiv.org/pdf/9999.00001']);
    const resourceResponse=await fetch(base+'/api/documents/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'图.md',markdown:'![图](x.png)',resources:[{path:'x.png',data:png}]})});expect(resourceResponse.status).toBe(200);
    const resource=store.all('SELECT id FROM document_resources')[0];const image=await fetch(`${base}/api/document-resources/${resource.id}`);expect(image.headers.get('content-type')).toContain('image/png');expect(Buffer.from(await image.arrayBuffer()).toString('base64')).toBe(png);
    expect(()=>importDocument(store,{name:'bad.md',markdown:'![x](javascript:alert)',resources:[]})).toThrow('协议');
  } finally {await close(server);await close(converter);store.db.close();rmSync(dir,{recursive:true,force:true});}
});

test('HTML document images resolve local resources and never enter model context', () => {
  const dir=mkdtempSync(join(tmpdir(),'learn-html-document-')),store=new Store(dir);
  try {
    const session=importDocument(store,{name:'paper.md',markdown:'<table><tr><td>A</td><td><img src="figure.png" alt="Figure"></td></tr></table>\n\nAuthor<sup>∗</sup>',resources:[{path:'figure.png',data:png}]});
    const message=store.stream(session.root_stream_id).messages[0];
    const image=message.slots.find(s=>s.node.block_type==='image')!;
    expect(image.node.markdown).toContain('/api/document-resources/');
    expect(message.slots.some(s=>s.node.selection_text==='Author∗')).toBe(true);
    expect(withoutImages(message.content_markdown)).not.toContain('/api/document-resources/');
  } finally {store.db.close();rmSync(dir,{recursive:true,force:true});}
});

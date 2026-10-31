import { expect, test } from 'vitest';
import { createServer } from 'node:http';
import { readSSE } from '../shared/sse';
import { streamChat } from '../server/providers/chat';
import { nodeTree, splitMarkdown, validBoundary, mathRanges, validMathSelection, expandMathSelection, rawMarkdownSlice } from '../shared/markdown';

test('SSE survives every byte boundary, Unicode, CRLF and multiline data', async () => {
  const bytes = new TextEncoder().encode(': heartbeat\r\nevent: delta\r\ndata: 中文👩‍💻\r\ndata: 第二行\r\n\r\ndata: [DONE]\n\n');
  const body = new ReadableStream<Uint8Array>({ start(c) { for (const b of bytes) c.enqueue(new Uint8Array([b])); c.close(); } });
  const out = []; for await (const e of readSSE(body)) out.push(e);
  expect(out).toEqual([{ event: 'delta', data: '中文👩‍💻\n第二行' }, { event: 'message', data: '[DONE]' }]);
});
test('Markdown blocks preserve fine structure and inline selection text', () => {
  const blocks = splitMarkdown('# 标题\n\n甲**粗体**与`代码`。\n\n1. 第一项\n2. 第二项\n\n> 引用\n\n```ts\nconst x = 1\n```\n\n|甲|乙|\n|--|--|\n|一|二|\n\n$$\nx^2\n$$');
  expect(blocks.map(b => b.type)).toEqual(['heading','paragraph','listItem','listItem','paragraph','code','table','math']);
  expect(blocks[1].text).toBe('甲粗体与代码。'); expect(blocks[3].meta.marker).toBe('2.');
  expect(nodeTree('a👩‍💻é').text).toBe('a👩‍💻é');
  expect(validBoundary('é', 0, 1)).toBe(false);
});
test('inline and display formula offsets remain canonical and cannot be partially selected', () => {
  const md = '前 $x^2 + y$ 后\n\n$$\n\\frac{1}{2}\n$$';
  const ranges = mathRanges(md); expect(ranges.map(r => r.value)).toEqual(['x^2 + y', '\\frac{1}{2}']);
  expect(ranges.map(r => r.display)).toEqual([false, true]);
  const first = ranges[0]; expect(validMathSelection(md, first.start, first.end)).toBe(true);
  expect(validMathSelection(md, first.start + 1, first.end)).toBe(false);
  expect(expandMathSelection(md, first.start + 2, first.end - 1)).toEqual({ start: first.start, end: first.end });
  expect(nodeTree(md).text.slice(first.start, first.end)).toBe('x^2 + y');
  expect(mathRanges('`$x$`\n\n```\n$$y$$\n```')).toHaveLength(0);
});
test('Chat Completions adapter sends proper request, parses stream, detects truncation and abort', async () => {
  let received: any;
  const server = createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c; received = { path: req.url, key: req.headers.authorization, ...JSON.parse(body) };
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"content":"解释中文"}}]}\n\n');
    res.end(received.model === 'broken' ? '' : 'data: [DONE]\n\n');
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address() as { port: number };
  const options = { settings: { modelConfig: { id:'stub',name:'stub',supportsImages:false,parameters:[],provider: 'openai' as const, baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'local-test' } }, messages: [{ role: 'user' as const, content: '问题' }], apiKey: 'stub-key', fakeUrl: '', kind: 'reply', depth: 0, signal: new AbortController().signal };
  const collect = async (o = options) => { let out = ''; for await (const text of streamChat(o)) out += text; return out; };
  try {
    expect(await collect()).toBe('解释中文'); expect(received).toMatchObject({ path: '/v1/chat/completions', key: 'Bearer stub-key', stream: true, messages: options.messages }); expect(received.__fake).toBeUndefined();
    await expect(collect({ ...options, settings: { modelConfig: { ...options.settings.modelConfig, model: 'broken' } } })).rejects.toThrow('提前结束');
    const controller = new AbortController(); controller.abort(); await expect(collect({ ...options, signal: controller.signal })).rejects.toBeDefined();
  } finally { await new Promise<void>(r => server.close(() => r())); }
});

test('raw copy maps formatted, escaped and formula offsets without repairing truncated syntax', () => {
  const md = '# 前 **加粗** 与 `code`、$x^2$ 后';
  const text = nodeTree(md).text;
  expect(rawMarkdownSlice(md, 0, text.length)).toBe(md);
  expect(rawMarkdownSlice(md, 0, 3)).toBe('# 前 **加');
  expect(rawMarkdownSlice(md, text.indexOf('加'), text.indexOf('加') + 2)).toBe('**加粗**');
  expect(rawMarkdownSlice(md, text.indexOf('code'), text.indexOf('code') + 4)).toBe('`code`');
  expect(rawMarkdownSlice(md, text.indexOf('x^2'), text.indexOf('x^2') + 3)).toBe('$x^2$');
  const escaped = '前 \u005c\u005c* 与 &amp; 后';
  const visible = nodeTree(escaped).text;
  expect(rawMarkdownSlice(escaped, visible.indexOf('&'), visible.indexOf('&') + 1)).toBe('&amp;');
  expect(rawMarkdownSlice('甲[链接](https://example.com)尾', 1, 3)).toBe('[链接](https://example.com)');
});

test.each([
  '- **已经习惯 `checkout`：**继续用也没问题，它没有被废弃。',
  '**注意：**LLM 仍然可以继续。',
  '**配置 `model` 和 $x^2$：**继续使用。',
  '**链接 [文档](https://example.com)：**继续阅读。',
])('bold recovery supports inline nodes and punctuation: %s', markdown => {
  const tree = nodeTree(markdown).tree;
  const strong: any[] = [];
  const walk = (node: any) => { if (node.type === 'strong') strong.push(node); node.children?.forEach(walk); };
  walk(tree);
  expect(strong).toHaveLength(1);
  if (markdown.includes('`checkout`')) expect(strong[0].children?.map((node: any) => node.type)).toContain('inlineCode');
});

test('CJK punctuation adjacent bold recovers strong syntax with original Markdown offsets', () => {
  const md='前文**判断：**有真实行业场景；**结论（重要）：**继续。';
  const {tree,text}=nodeTree(md);
  expect(text).toBe('前文判断：有真实行业场景；结论（重要）：继续。');
  expect(tree.children![0].children!.filter(n=>n.type==='strong')).toHaveLength(2);
  expect(rawMarkdownSlice(md,2,5)).toBe('**判断：**');
  expect(rawMarkdownSlice(md,2,4)).toBe('**判断');
  expect(splitMarkdown(md)[0].markdown).toBe(md);
  expect(nodeTree('前 **判断：**有 &amp; 后').text).toBe('前 判断：有 & 后');
  for(const literal of ['`**判断：**有`','\\*\\*判断：**有','**未结束：有','** 判断：**有']) {
    const parsed=nodeTree(literal);expect(parsed.tree.children![0].children!.some(n=>n.type==='strong')).toBe(false);
  }
  expect(nodeTree('```md\n**判断：**有\n```').tree.children![0].type).toBe('code');
});


test.each(['LLM...', '123条', 'GPT-4', '有中文', 'école'])('punctuation bold accepts a following word: %s', tail => {
  const md=`**注意：**${tail}`;const {tree,text}=nodeTree(md);
  expect(tree.children![0].children![0].type).toBe('strong');expect(text).toBe(`注意：${tail}`);
  expect(rawMarkdownSlice(md,0,3)).toBe('**注意：**');expect(rawMarkdownSlice(md,0,text.length)).toBe(md);
  expect(splitMarkdown(md)[0].text).toBe(text);
});

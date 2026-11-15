import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readerUrl } from '../shared/links';
import { Markdown } from '../src/Markdown';
import { nodeTree, splitMarkdown, rawMarkdownSlice } from '../shared/markdown';
import { SearchProgressPanel } from '../src/SearchProgressPanel';

test('hard breaks render one canonical newline without another br and preserve offsets',()=>{
  const source='1. **找到旧“永恒”的遗留物**  \n   影当年斩落雷鸟后，还斩断了时间。\n2. 后续';
  const [block]=splitMarkdown(source),html=renderToStaticMarkup(<Markdown source={block.markdown}/>);
  expect(html).toContain('<strong>');expect(html).toContain('markdown-hard-break');expect(html).not.toContain('<br');
  const {text}=nodeTree(block.markdown);expect(text).toBe('找到旧“永恒”的遗留物\n影当年斩落雷鸟后，还斩断了时间。');
  const start=text.indexOf('影');expect(rawMarkdownSlice(block.markdown,start,start+2)).toBe('影当');
});
test('reader accepts only public web URLs',()=>{
  expect(readerUrl('https://example.com/a?q=1')).toBe('https://example.com/a?q=1');
  for(const url of ['javascript:alert(1)','file:///etc/passwd','http://localhost','http://127.1','http://[::1]','http://192.168.1.1','https://name:pass@example.com','http://service.local'])expect(readerUrl(url)).toBeNull();
});
test('search progress presents article counts rather than tool execution logs',()=>{
  const html=renderToStaticMarkup(<SearchProgressPanel progress={{sources:[],activities:[{id:1,tool:'搜索网页',input:'query',status:'complete',resultCount:5},{id:2,tool:'读取网页',input:'https://example.com',status:'running'}]}}/>);
  expect(html).toContain('已检索到 5 篇资料');expect(html).toContain('正在精读 1 篇资料');expect(html).not.toContain('query');expect(html).not.toContain('次操作');
});

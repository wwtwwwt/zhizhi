import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseDocument } from 'htmlparser2';
import { StreamingMarkdown } from '../src/StreamingMarkdown';
import { splitMarkdown } from '../shared/markdown';

test('streamed lists use finalized block boundaries, markers and nested/quote layout', () => {
  const source = '前面的段落。\n\n3. 第一项\n4. 第二项\n   - 嵌套项\n\n   第二项的续段。\n\n后面的段落。\n\n> - 引用列表';
  const expected = splitMarkdown(source);
  const html = renderToStaticMarkup(<StreamingMarkdown source={source}/>);
  const root = parseDocument(html);
  const container = root.children.find(n => n.type === 'tag')!;
  if (container.type !== 'tag') throw new Error('missing stream container');
  const blocks = container.children.filter(n => n.type === 'tag');
  expect(blocks).toHaveLength(expected.length);
  blocks.forEach((element, i) => {
    if (element.type !== 'tag') throw new Error('missing block');
    const meta = expected[i].meta;
    expect(element.attribs.class.includes('list-block')).toBe(!!meta.marker);
    expect(element.attribs.class.includes('quoted')).toBe(!!meta.quote);
    expect(element.attribs.style).toBe(meta.depth ? `margin-left:${meta.depth * 20}px` : 'margin-left:0');
    const children = element.children.filter(n => n.type === 'tag');
    if (meta.marker) {
      const marker = children.shift()!;
      expect(marker.type === 'tag' && marker.attribs.class).toBe('list-marker');
      expect('children' in marker && marker.children[0].type === 'text' && marker.children[0].data).toBe(meta.marker);
    }
    expect(children[0].type === 'tag' && children[0].attribs.class).toBe('markdown');
  });
  expect(html).not.toMatch(/<(ul|ol|li)[\s>]/);
  expect(html).toContain('stream-token');
});

test('incomplete streamed list/formatting remains renderable while tokens arrive', () => {
  const source = '说明\n\n- 第一项 **加粗**\n- 第二项 $x^2$\n  1. 嵌套 `code`\n\n结尾';
  for (let end = 1; end <= source.length; end++) {
    expect(() => renderToStaticMarkup(<StreamingMarkdown source={source.slice(0, end)}/>)).not.toThrow();
  }
});

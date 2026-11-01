import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from '../src/Markdown';
import { nodeTree, rawMarkdownSlice, splitMarkdown, printTree, parseTree } from '../shared/markdown';
import { withoutImages } from '../shared/documents';

const table = '<table><tr><td>Method</td><td>Source</td><td>Target</td><td>Sci</td><td>Prod</td><td>Trans</td></tr><tr><td>T2T</td><td>0.83</td><td>0.39</td><td>0.46</td><td>0.37</td><td>0.37</td></tr><tr><td>T2T + Prompt</td><td>0.88</td><td>0.45</td><td>0.49</td><td>0.46</td><td>0.40</td></tr><tr><td>BART</td><td>0.52</td><td>0.20</td><td>0.21</td><td>0.19</td><td>0.20</td></tr><tr><td>OptGen w/o copy</td><td>0.55</td><td>0.34</td><td>0.38</td><td>0.32</td><td>0.33</td></tr><tr><td>OptGen w/o prompt</td><td>0.58</td><td>0.61</td><td>0.64</td><td>0.63</td><td>0.57</td></tr><tr><td>OptGen</td><td>0.60</td><td>0.63</td><td>0.60</td><td>0.66</td><td>0.64</td></tr></table>';
const render = (source: string, streaming = false) => renderToStaticMarkup(<Markdown source={source} streaming={streaming}/>);

test('paper HTML table renders rows/cells, remains one block and copies exact source', () => {
  const blocks = splitMarkdown(table); expect(blocks).toHaveLength(1);
  expect(blocks[0].text).not.toContain('<td>');
  const html = render(table); expect(html.match(/<tr>/g)).toHaveLength(7); expect(html.match(/<td>/g)).toHaveLength(42);
  expect(html).toContain('<table><tbody>'); expect(rawMarkdownSlice(table, 0, blocks[0].text.length)).toBe(table);
  const from = blocks[0].text.indexOf('T2T'); expect(rawMarkdownSlice(table, from, from + 3)).toContain('T2T</td>');
  expect(render(table, true).match(/<td>/g)).toHaveLength(42);
  for (let i = 1; i <= table.length; i += 13) expect(() => render(table.slice(0, i), true)).not.toThrow();
});

test('inline HTML keeps Markdown formatting, entities, branch offsets and source copy', () => {
  const md = 'Shiqi He<sup>∗</sup>，H<sub>2</sub>O，<strong>**注意：**LLM `code`</strong> &amp; end';
  const { text } = nodeTree(md); expect(text).toBe('Shiqi He∗，H2O，注意：LLM code & end');
  expect(render(md)).toContain('<sup><span data-offset="8">∗</span></sup>'); expect(render(md)).toContain('<sub>'); expect(render(md)).toContain('<code>');
  expect(rawMarkdownSlice(md, 8, 9)).toBe('<sup>∗</sup>');
  const from = text.indexOf('&'); expect(rawMarkdownSlice(md, from, from + 1)).toBe('&amp;');
  const html = renderToStaticMarkup(<Markdown source={md} anchors={[{id:'sup-branch',source_node_id:'n',stream_id:'s',start_offset:8,end_offset:9,selected_text:'∗'}]}/>);
  expect(html).toContain('data-branch="sup-branch"');
  expect(nodeTree(printTree(parseTree(md))).text).toBe(text);
  const blocks = splitMarkdown(table + '，Shiqi He<sup>∗</sup>'); expect(blocks).toHaveLength(2); expect(blocks[1].text).toBe('，Shiqi He∗');
});

test('HTML allows structural table attributes but never executes active content', () => {
  const md = '<table onclick="evil()"><caption>Result</caption><thead><tr><th colspan="2" scope="col" style="color:red">A &amp; B</th></tr></thead><tbody><tr><td rowspan="2">C</td><td>D</td></tr></tbody></table>\n\n<script>alert(1)</script>\n\n前 <iframe>secret</iframe><svg onload="evil()"><text>bad</text></svg><a href="javascript:evil()">link</a><img src="javascript:evil()" onerror="evil()"> 后';
  const html = render(md); expect(html).toContain('colSpan="2"'); expect(html).toContain('rowSpan="2"'); expect(html).toContain('<caption>');
  for (const word of ['onclick', 'onerror', 'onload', '<script', '<iframe', '<svg', 'javascript:', 'secret', 'alert(1)', 'color:red']) expect(html).not.toContain(word);
  expect(render('`<sup>literal</sup>`\n\n```html\n<table>literal</table>\n```')).toContain('&lt;sup&gt;literal&lt;/sup&gt;');
});

test('HTML image references remain independent presentation blocks through serialization', () => {
  const md = '<table><tr><td>前<img src="https://example.com/figure.png" alt="图">后</td></tr></table>';
  const blocks = splitMarkdown(md); expect(blocks.map(b=>b.type)).toContain('image'); expect(blocks.map(b=>b.text).join('')).toBe('前图后');
  expect(nodeTree(printTree(parseTree(md))).text).toBe('前图后');
  expect(withoutImages(md)).not.toContain('figure.png');
  const linked = '<table><tr><td><a href="https://example.com/?a=1&amp;b=2">reference</a><br>next</td></tr></table>';
  const serialized = printTree(parseTree(linked));
  expect(serialized).toContain('<a href="https://example.com/?a=1&amp;b=2">reference</a><br>next');
  expect(nodeTree(serialized).text).toBe('reference\nnext');
});

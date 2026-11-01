import { parseDocument } from 'htmlparser2';
import type { Ast } from './types';

// HTML is parsed into our own AST. Never pass imported HTML or its attributes
// directly to React/the DOM: event handlers, styles and embedded content are dropped.
const allowed = new Set('table thead tbody tfoot tr th td caption colgroup col sup sub b strong i em u s del mark small span div p br hr ul ol li blockquote pre code h1 h2 h3 h4 h5 h6 a img details summary kbd samp var abbr'.split(' '));
const blocked = new Set('script style iframe object embed svg math template noscript textarea title xmp plaintext'.split(' '));
const voidTags = new Set(['br', 'hr', 'img', 'col']);
const inlineTags = new Set('sup sub b strong i em u s del mark small span code a kbd samp var abbr'.split(' '));
type HtmlNode = ReturnType<typeof parseDocument>['children'][number];
const position = (start: number, end: number) => ({ start: { offset: start }, end: { offset: end } });

function element(tag: string, attrs: Record<string, string>, children: Ast[], start: number, end: number): Ast {
  if (['table', 'thead', 'tbody', 'tfoot', 'tr', 'colgroup'].includes(tag)) children = children.filter(child => child.type !== 'text' || !!child.value?.trim());
  if (tag === 'img') return { type: 'image', url: attrs.src || '', alt: attrs.alt || '', position: position(start, end) };
  if (tag === 'a') return { type: 'link', url: attrs.href || '', children, position: position(start, end) };
  if (tag === 'br') return { type: 'break', position: position(start, end) };
  const properties: Record<string, string | number> = {};
  for (const key of ['colspan', 'rowspan', 'span']) {
    const value = Number(attrs[key]);
    if (Number.isInteger(value) && value > 0 && value <= 100 && ['td', 'th', 'col', 'colgroup'].includes(tag)) properties[key === 'colspan' ? 'colSpan' : key === 'rowspan' ? 'rowSpan' : key] = value;
  }
  if (['left', 'center', 'right'].includes(attrs.align)) properties.align = attrs.align;
  if (tag === 'th' && ['row', 'col', 'rowgroup', 'colgroup'].includes(attrs.scope)) properties.scope = attrs.scope;
  return { type: 'htmlElement', tagName: tag, properties, children, position: position(start, end) };
}

function fragment(raw: string, offset: number): Ast[] {
  const convert = (node: HtmlNode): Ast[] => {
    const start = offset + (node.startIndex ?? 0), end = offset + (node.endIndex === null ? raw.length : node.endIndex + 1);
    if (node.type === 'text') return [{ type: 'text', value: node.data, position: position(start, end) }];
    if (!('attribs' in node) || blocked.has(node.name)) return [];
    const children = node.children.flatMap(convert);
    return allowed.has(node.name) ? [element(node.name, node.attribs, children, start, end)] : children;
  };
  return parseDocument(raw, { withStartIndices: true, withEndIndices: true, decodeEntities: true }).children.flatMap(convert);
}

export function resolveHtml(tree: Ast) {
  const visit = (parent: Ast) => {
    if (!parent.children) return;
    const children: Ast[] = [], stack: { tag: string; node: Ast; discard: boolean }[] = [];
    const append = (node: Ast) => {
      if (stack.some(entry => entry.discard)) return;
      const target = stack.at(-1)?.node.children ?? children;
      target.push(node);
    };
    for (const child of parent.children) {
      if (child.type !== 'html') { visit(child); append(child); continue; }
      const raw = child.value || '', start = child.position?.start.offset ?? 0, end = child.position?.end.offset ?? start + raw.length;
      // Inline HTML tokens surround ordinary Markdown nodes (including code,
      // emphasis and links), so retain those nodes and their original offsets.
      const token = parent.type !== 'root' && raw.match(/^<(\/)?([a-z][\w-]*)\b[^>]*>$/i);
      if (!token) { fragment(raw, start).forEach(append); continue; }
      const tag = token[2].toLowerCase();
      if (token[1]) {
        const index = stack.findLastIndex(entry => entry.tag === tag);
        if (index >= 0) { for (const entry of stack.slice(index)) entry.node.position!.end.offset = end; stack.splice(index); }
      } else {
        const parsed = parseDocument(raw).children.find(node => 'name' in node);
        const attrs = parsed && 'attribs' in parsed ? parsed.attribs : {};
        const node = element(tag, attrs, [], start, end);
        if (allowed.has(tag)) append(node);
        // Unknown tags are transparent; blocked tags suppress their contents.
        if (!voidTags.has(tag) && !raw.endsWith('/>')) {
          if (allowed.has(tag) || blocked.has(tag)) stack.push({ tag, node, discard: blocked.has(tag) });
        }
      }
    }
    if (parent.type === 'root') {
      const grouped: Ast[] = []; let inline: Ast[] = [];
      const flush = () => {
        if (inline.some(node => node.type !== 'text' || node.value?.trim())) grouped.push({ type: 'paragraph', children: inline, position: { start: inline[0].position!.start, end: inline.at(-1)!.position!.end } });
        inline = [];
      };
      for (const node of children) {
        if (node.type === 'text' || node.type === 'link' || node.type === 'image' || node.type === 'break' || (node.type === 'htmlElement' && inlineTags.has(node.tagName!))) inline.push(node);
        else { flush(); grouped.push(node); }
      }
      flush(); parent.children = grouped;
    } else parent.children = children;
  };
  visit(tree);
}

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
// Used when image isolation/reference resolution needs to serialize an AST.
export function htmlElementSource(node: Ast, inline: (node: Ast) => string): string {
  const attrs = Object.entries(node.properties || {}).map(([key, value]) => ` ${key.toLowerCase()}="${escape(String(value))}"`).join('');
  const serialize = (child: Ast): string => {
    if (child.type === 'htmlElement') return htmlElementSource(child, inline);
    if (child.type === 'text') return escape(child.value || '');
    if (child.type === 'image') return `<img src="${escape(child.url || '')}" alt="${escape(child.alt || '')}">`;
    if (child.type === 'break') return '<br>';
    if (child.type === 'link') return `<a href="${escape(child.url || '')}">${(child.children || []).map(serialize).join('')}</a>`;
    if (child.type === 'inlineCode') return `<code>${escape(child.value || '')}</code>`;
    const tag = ({ strong: 'strong', emphasis: 'em', delete: 'del' } as Record<string, string>)[child.type];
    if (tag) return `<${tag}>${(child.children || []).map(serialize).join('')}</${tag}>`;
    return inline(child);
  };
  return `<${node.tagName}${attrs}>${(node.children || []).map(serialize).join('')}${voidTags.has(node.tagName!) ? '' : `</${node.tagName}>`}`;
}

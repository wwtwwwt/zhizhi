import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkStringify from 'remark-stringify';
import type { Ast, ParsedBlock, RenderMeta } from './types';

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const writer = unified().use(remarkGfm).use(remarkMath).use(remarkStringify);
export function printTree(tree: Ast): string { return writer.stringify(tree as never).trimEnd(); }
export function parseTree(markdown: string): Ast {
  const tree = parser.parse(markdown) as unknown as Ast;
  // CommonMark rejects a closing ** after punctuation followed by a word.
  // Recover that form at the inline-parent level so the bold span may contain
  // code, math, links, or other inline nodes instead of only one text leaf.
  const recoverStrong = (parent: Ast) => {
    if (parent.type !== 'strong' && parent.children?.length && parent.position?.start.offset !== undefined && parent.position.end.offset !== undefined) {
      const parentStart = parent.position.start.offset;
      const raw = markdown.slice(parentStart, parent.position.end.offset);
      const pairs = /(?<![\\*])\*\*(?![\s*])([^\n]*?[^\s*])\*\*(?!\*)/gu;
      const candidates = [...raw.matchAll(pairs)].map(match => {
        const at = match.index!;
        return { at, end: at + match[0].length, inner: match[1] };
      }).filter(candidate => {
        const sourceStart = parentStart + candidate.at;
        const sourceEnd = parentStart + candidate.end;
        const covered = (parent.children || []).filter(child => {
          const start = child.position?.start.offset ?? 0;
          const end = child.position?.end.offset ?? start;
          return start < sourceEnd && end > sourceStart;
        });
        // Already parsed formatting is valid; only recover spans whose
        // delimiters remained in ordinary text or were split by inline nodes.
        return covered.length > 0 && !covered.some(child => child.type === 'strong') &&
          covered.some(child => child.type === 'text');
      });
      if (candidates.length) {
        const parseFragment = (fragment: string, sourceOffset: number): Ast[] => {
          if (!fragment) return [];
          const parsed = parser.parse(`x${fragment}x`) as unknown as Ast;
          const children = parsed.children?.[0]?.children || [];
          const shift = (node: Ast) => {
            if (node.position) {
              const start = node.position.start.offset ?? 0;
              const end = node.position.end.offset ?? start;
              node.position.start.offset = sourceOffset + start - 1;
              node.position.end.offset = sourceOffset + end - 1;
            }
            node.children?.forEach(shift);
          };
          children.forEach(shift);
          if (children[0]?.type === 'text') {
            children[0].value = children[0].value!.slice(1);
            if (children[0].position) children[0].position.start.offset = (children[0].position.start.offset ?? 0) + 1;
          }
          const tail = children.at(-1);
          if (tail?.type === 'text') {
            tail.value = tail.value!.slice(0, -1);
            if (tail.position) tail.position.end.offset = (tail.position.end.offset ?? 0) - 1;
          }
          return children.filter(node => node.value !== '');
        };
        const rebuilt: Ast[] = [];
        let cursor = 0;
        for (const candidate of candidates) {
          rebuilt.push(...parseFragment(raw.slice(cursor, candidate.at), parentStart + cursor));
          const sourceStart = parentStart + candidate.at;
          const sourceEnd = parentStart + candidate.end;
          const parsed = parseFragment(candidate.inner, sourceStart + 2);
          rebuilt.push({ type: 'strong', children: parsed, position: { start: { offset: sourceStart }, end: { offset: sourceEnd } } });
          cursor = candidate.end;
        }
        rebuilt.push(...parseFragment(raw.slice(cursor), parentStart + cursor));
        parent.children = rebuilt;
      }

    }
    parent.children?.forEach(child => recoverStrong(child));
  };
  recoverStrong(tree);
  const definitions = new Map<string, Ast>();
  const collect = (n: Ast) => { if (n.type === 'definition') { const key = n.identifier!.toLowerCase(); if (!definitions.has(key)) definitions.set(key, n); } n.children?.forEach(collect); }; collect(tree);
  const resolve = (n: Ast) => {
    if (n.type === 'imageReference' || n.type === 'linkReference') { const d = definitions.get(n.identifier!.toLowerCase()); if (d) { n.type = n.type === 'imageReference' ? 'image' : 'link'; n.url = d.url; n.title = d.title; } }
    n.children?.forEach(resolve);
  }; resolve(tree); return tree;
}
export function annotate(tree: Ast): string {
  let text = '';
  const walk = (n: Ast) => {
    if (n.type === 'image') { n.value = n.alt || ''; }
    if (n.type === 'break') n.value = '\n';
    if (n.value !== undefined) { n.offset = text.length; text += n.value; }
    else n.children?.forEach(walk);
  };
  walk(tree);
  return text;
}
export function nodeTree(markdown: string) { const tree = parseTree(markdown); const text = annotate(tree); return { tree, text }; }
export function mathRanges(markdown: string) {
  const { tree } = nodeTree(markdown), ranges: { start: number; end: number; value: string; display: boolean }[] = [];
  const walk = (n: Ast) => { if (n.type === 'math' || n.type === 'inlineMath') ranges.push({ start: n.offset!, end: n.offset! + (n.value || '').length, value: n.value || '', display: n.type === 'math' }); else n.children?.forEach(walk); };
  walk(tree); return ranges;
}
export function expandMathSelection(markdown: string, start: number, end: number) {
  for (const math of mathRanges(markdown)) if (start < math.end && end > math.start) { start = Math.min(start, math.start); end = Math.max(end, math.end); }
  return { start, end };
}
export function validMathSelection(markdown: string, start: number, end: number) {
  const expanded = expandMathSelection(markdown, start, end); return expanded.start === start && expanded.end === end;
}
export function splitMarkdown(markdown: string): ParsedBlock[] {
  let root = parseTree(markdown);
  if (root.children?.some(n => n.type === 'definition')) {
    // Each stored block must remain independently renderable after definitions
    // have been separated from their reference uses.
    root.children = root.children.filter(n => n.type !== 'definition');
    markdown = printTree(root); root = parseTree(markdown);
  }
  const out: ParsedBlock[] = [];
  const slice = (n: Ast) => markdown.slice(n.position?.start.offset ?? 0, n.position?.end.offset ?? 0);
  const push = (source: string, type: string, meta: RenderMeta) => {
    if (!source.trim()) return;
    const { tree, text } = nodeTree(source);
    const hasImage = (n: Ast): boolean => n.type === 'image' || !!n.children?.some(hasImage);
    if (!hasImage(tree)) { out.push({ markdown: source, type, text, tree, meta }); return; }
    // Lift images out of paragraphs, links, formatting and tables while keeping
    // the surrounding text's Markdown structure balanced.
    const isolate = (n: Ast): Ast[] => {
      if (n.type === 'image' || !hasImage(n)) return [n];
      const result: Ast[] = []; let children: Ast[] = [];
      const flush = () => { if (children.length) result.push({ ...n, children }); children = []; };
      for (const child of n.children || []) for (const part of isolate(child)) {
        if (part.type === 'image') { flush(); result.push(part); } else children.push(part);
      }
      flush(); return result;
    };
    let firstText = true;
    for (const part of isolate(tree)) {
      const raw = printTree(part.type === 'root' ? part : { type: 'root', children: part.type === 'image' ? [{ type: 'paragraph', children: [part] }] : [part] });
      if (!raw.trim()) continue;
      const parsed = nodeTree(raw);
      out.push({ markdown: raw, type: part.type === 'image' ? 'image' : type, ...parsed, meta: part.type === 'image' || !firstText ? { ...meta, marker: undefined } : meta });
      if (part.type !== 'image') firstText = false;
    }
  };
  const walk = (n: Ast, meta: RenderMeta = {}) => {
    if (n.type === 'list') {
      n.children?.forEach((item, index) => {
        const own = (item.children || []).filter(c => c.type !== 'list').map(slice).join('\n\n');
        push(own, 'listItem', { ...meta, marker: n.ordered ? `${(n.start || 1) + index}.` : '•' });
        item.children?.filter(c => c.type === 'list').forEach(c => walk(c, { ...meta, depth: (meta.depth || 0) + 1 }));
      });
    } else if (n.type === 'blockquote') {
      n.children?.forEach(c => {
        if (c.type === 'list') walk(c, { ...meta, quote: true });
        else push(slice(c).replace(/^\s*>\s?/gm, ''), c.type, { ...meta, quote: true });
      });
    } else push(slice(n), n.type, meta);
  };
  root.children?.forEach(n => walk(n));
  return out;
}

export function validBoundary(text: string, start: number, end: number) {
  const points = new Set<number>([0, text.length]);
  for (const p of new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(text)) points.add(p.index);
  return Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && end <= text.length && points.has(start) && points.has(end);
}

// Map visible UTF-16 offsets back to the original source. Delimiters are deliberately
// left truncated when only part of a formatted span is selected.
export function rawMarkdownSlice(markdown: string, from: number, to: number): string {
  const { tree, text } = nodeTree(markdown);
  ({ start: from, end: to } = expandMathSelection(markdown, from, to));
  if (from <= 0 && to >= text.length) return markdown;
  const starts: number[] = [], ends: number[] = [];
  const containers: { from: number; to: number; rawStart: number; rawEnd: number }[] = [];
  const walk = (n: Ast): { from: number; to: number } => {
    const rawStart = n.position?.start.offset || 0, rawEnd = n.position?.end.offset || rawStart;
    if (n.value !== undefined) {
      const value = n.value, at = n.offset || 0, raw = markdown.slice(rawStart, rawEnd);
      if (n.type === 'text') {
        let cursor = 0, index = 0;
        while (index < value.length && cursor < raw.length) {
          const begin = cursor; let decoded = raw[cursor++];
          if (decoded === '\\' && /[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/.test(raw[cursor] || ' ')) decoded = raw[cursor++];
          else if (decoded === '&') {
            const entity = raw.slice(begin).match(/^&(?:#\d+|#x[\da-f]+|[a-z][\da-z]+);/i)?.[0];
            if (entity) { const result = nodeTree(entity).text; if (result !== entity) { decoded = result; cursor = begin + entity.length; } }
          } else if (decoded === '\r' && raw[cursor] === '\n') { cursor++; decoded = '\n'; }
          for (let k = 0; k < decoded.length; k++) { starts[at + index] = rawStart + begin; ends[at + index] = rawStart + cursor; index++; }
        }
      } else {
        // Code, math and hard breaks are atomic syntax at their source edges.
        const located = raw.indexOf(value), inner = located >= 0 ? located : 0;
        for (let i = 0; i < value.length; i++) { starts[at + i] = rawStart + inner + i; ends[at + i] = rawStart + inner + i + 1; }
      }
      containers.push({ from: at, to: at + value.length, rawStart, rawEnd });
      return { from: at, to: at + value.length };
    }
    const ranges = n.children?.map(walk) || [];
    const range = { from: ranges[0]?.from || 0, to: ranges.at(-1)?.to || 0 };
    if (n.type !== 'root' && range.to > range.from) containers.push({ ...range, rawStart, rawEnd });
    return range;
  };
  walk(tree);
  let start = starts[from] ?? 0, end = ends[to - 1] ?? markdown.length;
  for (const c of containers) {
    if (from === c.from && to > c.from) start = Math.min(start, c.rawStart);
    if (to === c.to && from < c.to) end = Math.max(end, c.rawEnd);
  }
  if (from === 0) start = 0;
  if (to === text.length) end = markdown.length;
  return markdown.slice(start, end);
}

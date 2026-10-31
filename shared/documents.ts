import { parseTree } from './markdown';
import type { Ast } from './types';

export type DocumentResource = { path: string; data: string };
export type DocumentImport = { name: string; markdown: string; resources: DocumentResource[]; baseUrl?: string; sourceUrl?: string; documentPath?: string };
export function visitAst(tree: Ast, fn: (node: Ast) => void) { fn(tree); tree.children?.forEach(n => visitAst(n, fn)); }
export function imageNodes(markdown: string) { const nodes: Ast[] = []; visitAst(parseTree(markdown), n => { if (n.type === 'image') nodes.push(n); }); return nodes; }
export function resourcePath(path: string) {
  let value = path.split(/[?#]/)[0];
  try { value = decodeURIComponent(value); } catch { /* Literal filenames are allowed. */ }
  const parts: string[] = [];
  for (const p of value.replace(/\\/g, '/').split('/')) { if (!p || p === '.') continue; if (p === '..') { if (!parts.length) return ''; parts.pop(); } else parts.push(p); }
  return parts.join('/');
}
export function safeImageUrl(url: string) { return /^https?:\/\//i.test(url) || /^\/api\/document-resources\/[a-f\d-]+$/i.test(url) || /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z\d+/=]+$/i.test(url); }
// Images are presentation resources, not model input. Code fences containing image
// syntax remain text. Positions come from the Markdown parser, never a regex.
export function withoutImages(markdown: string) {
  const edits = imageNodes(markdown).map(n => [n.position!.start.offset!, n.position!.end.offset!] as const).sort((a,b) => b[0]-a[0]);
  for (const [start,end] of edits) markdown = markdown.slice(0,start) + markdown.slice(end);
  return markdown.trim();
}

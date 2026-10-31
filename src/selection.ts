import { rawMarkdownSlice } from '../shared/markdown';
// Math's rendered DOM is decorative; data-select-length provides its canonical width.
function textLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length || 0;
  if (node instanceof HTMLElement && node.dataset.math !== undefined) return Number(node.dataset.selectLength);
  return [...node.childNodes].reduce((n, child) => n + textLength(child), 0);
}
export function canonicalOffset(body: HTMLElement, target: Node, offset: number, edge: 'start' | 'end'): number {
  let count = 0, found = false;
  const walk = (node: Node) => {
    if (found) return;
    if (node instanceof HTMLElement && node.dataset.math !== undefined) {
      if (node === target || node.contains(target)) { count += edge === 'end' ? Number(node.dataset.selectLength) : 0; found = true; } else count += textLength(node);
    } else if (node === target) {
      count += node.nodeType === Node.TEXT_NODE ? offset : [...node.childNodes].slice(0, offset).reduce((n, child) => n + textLength(child), 0); found = true;
    } else if (node.nodeType === Node.TEXT_NODE) count += textLength(node);
    else node.childNodes.forEach(walk);
  };
  walk(body); if (!found) throw new Error('选区不属于当前内容'); return count;
}
export function normalizeFormulaRange(range: Range, body: HTMLElement): Range {
  const next = range.cloneRange();
  for (const formula of body.querySelectorAll<HTMLElement>('[data-math]')) {
    if (!next.intersectsNode(formula)) continue;
    if (formula.contains(next.startContainer)) next.setStartBefore(formula);
    if (formula.contains(next.endContainer)) next.setEndAfter(formula);
  }
  return next;
}
export function selectedPlainText(range: Range): string {
  const fragment = range.cloneContents();
  fragment.querySelectorAll<HTMLElement>('[data-math]').forEach(el => el.replaceWith(document.createTextNode(el.dataset.mathSource || '')));
  return fragment.textContent || '';
}
export function selectionMarkdown(scope: HTMLElement, range: Range): string | null {
  const bodies = [...scope.querySelectorAll<HTMLElement>('[data-node][data-markdown]')].filter(el => !el.closest('[inert]') && range.intersectsNode(el));
  if (scope.matches('[data-node][data-markdown]') && range.intersectsNode(scope)) bodies.unshift(scope);
  const chunks: string[] = [];
  for (const body of bodies) {
    const whole = document.createRange(); whole.selectNodeContents(body);
    const selected = range.cloneRange();
    if (selected.compareBoundaryPoints(Range.START_TO_START, whole) < 0) selected.setStart(whole.startContainer, whole.startOffset);
    if (selected.compareBoundaryPoints(Range.END_TO_END, whole) > 0) selected.setEnd(whole.endContainer, whole.endOffset);
    if (selected.collapsed) continue;
    const normalized = normalizeFormulaRange(selected, body);
    const start = canonicalOffset(body, normalized.startContainer, normalized.startOffset, 'start');
    const end = canonicalOffset(body, normalized.endContainer, normalized.endOffset, 'end');
    if (end <= start && body.textContent) continue;
    let raw = rawMarkdownSlice(body.dataset.markdown || '', start, end);
    if (start === 0 && body.dataset.prefix) raw = body.dataset.prefix + raw;
    chunks.push(raw);
  }
  return chunks.length ? chunks.join('\n\n') : null;
}
export function copyMarkdownSelection(event: React.ClipboardEvent<HTMLElement>) {
  if (event.defaultPrevented || (event.target as HTMLElement).closest('textarea,input,[contenteditable=true]')) return;
  const selection = getSelection(); if (!selection?.rangeCount || selection.isCollapsed) return;
  const raw = selectionMarkdown(event.currentTarget, selection.getRangeAt(0));
  if (raw === null) return;
  event.preventDefault(); event.clipboardData.setData('text/plain', raw);
}
// Native selection painting skips KaTeX's decorative descendants, so track the
// atomic formulas explicitly, including selection spanning surrounding text.
export function syncFormulaSelection(scope: HTMLElement) {
  const selection = getSelection(), range = selection?.rangeCount && !selection.isCollapsed ? selection.getRangeAt(0) : null;
  scope.querySelectorAll<HTMLElement>('[data-math]').forEach(el => {
    el.toggleAttribute('data-selected', !!range && range.intersectsNode(el));
  });
}

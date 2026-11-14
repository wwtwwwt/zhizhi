import { Fragment, createElement, useCallback, useMemo, useState } from 'react';
import { nodeTree } from '../shared/markdown';
import type { Anchor, Ast } from '../shared/types';
import katex from 'katex';
import { ImageViewer } from './ImageViewer';
import { MarkdownHeading } from './MarkdownHeading';
import { safeImageUrl } from '../shared/documents';

function DocumentImage({url, alt}: {url: string; alt: string}) {
  const [failed,setFailed] = useState(false), [viewing,setViewing] = useState(false);
  const close=useCallback(()=>setViewing(false),[]);
  if (!safeImageUrl(url) || failed) return <span className="image-load-error" role="status" aria-label="图片无法加载"/>;
  return <><img tabIndex={0} role="img" title="点击查看图片" onClick={e=>{e.stopPropagation();setViewing(true);}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();setViewing(true);}}} className="markdown-image" src={url} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>{viewing && <ImageViewer url={url} alt={alt} onClose={close}/>}</>;
}

function Formula({ value, display, streaming }: { value: string; display: boolean; streaming?: boolean }) {
  const html = useMemo(() => { try { return katex.renderToString(value, { displayMode: display, throwOnError: !!streaming, trust: false, strict: 'ignore', output: 'html', maxExpand: 500, maxSize: 20 }); } catch { return '<span class="formula-pending">…</span>'; } }, [value, display, streaming]);
  return <span className="formula-render" aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }}/>;
}

export function Markdown({ source, anchors = [], onBranch, activeBranchId, onActiveBranch, streaming = false }: { source: string; anchors?: Anchor[]; onBranch?: (a: Anchor) => void; activeBranchId?: string | null; onActiveBranch?: (id: string | null) => void; streaming?: boolean }) {
  const tree = useMemo(() => nodeTree(source).tree, [source]);
  const leaf = (node: Ast, key: string) => {
    const value = node.value || '', start = node.offset || 0, end = start + value.length;
    if (node.type === 'math' || node.type === 'inlineMath') {
      const display = node.type === 'math', source = display ? `$$\n${value}\n$$` : `$${value}$`;
      const anchor = anchors.find(a => a.start_offset < end && a.end_offset > start);
      return <span key={key} className={`formula-atom ${display ? 'formula-display' : ''} ${anchor ? 'formula-anchor' : ''} ${anchor?.kind === 'note' ? 'note-anchor' : ''}`} data-math="" data-math-source={source} data-select-length={value.length} data-offset={start} data-branch={anchor?.id} data-active={!!anchor && activeBranchId === anchor.id || undefined} role="button" tabIndex={0} aria-label={anchor ? `打开分支：${value}` : `选择公式：${value}`} onMouseEnter={() => anchor && onActiveBranch?.(anchor.id)} onMouseLeave={() => onActiveBranch?.(null)} onFocus={() => anchor && onActiveBranch?.(anchor.id)} onBlur={() => onActiveBranch?.(null)} onClick={e => {
        e.stopPropagation(); if (anchor) { onBranch?.(anchor); return; }
        const selection = getSelection(), range = document.createRange(); range.selectNode(e.currentTarget); selection?.removeAllRanges(); selection?.addRange(range);
        e.currentTarget.closest('[data-node]')?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); } }}><Formula value={value} display={display} streaming={streaming}/></span>;
    }
    const edges = new Set([start, end]);
    anchors.forEach(a => { if (a.start_offset > start && a.start_offset < end) edges.add(a.start_offset); if (a.end_offset > start && a.end_offset < end) edges.add(a.end_offset); });
    const points = [...edges].sort((a, b) => a - b);
    const parts = points.slice(0, -1).map((from, i) => {
      const to = points[i + 1]; const anchor = anchors.find(a => a.start_offset < to && a.end_offset > from);
      const text = value.slice(from - start, to - start);
      const content = streaming ? [...text.matchAll(/[\p{Script=Han}]|[^\s\p{Script=Han}]+|\s+/gu)].map(token => <span className="stream-token" key={token.index}>{token[0]}</span>) : text;
      return anchor ? <mark className={anchor.kind === 'note' ? 'note-anchor' : undefined} key={from} data-offset={from} data-branch={anchor.id} data-active={activeBranchId === anchor.id || undefined} tabIndex={0} role="button" aria-label={`打开分支：${anchor.selected_text}`} title="打开追问分支" onMouseEnter={() => onActiveBranch?.(anchor.id)} onMouseLeave={() => onActiveBranch?.(null)} onFocus={() => onActiveBranch?.(anchor.id)} onBlur={() => onActiveBranch?.(null)} onClick={e => { if (window.getSelection()?.toString()) return; e.stopPropagation(); onBranch?.(anchor); }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onBranch?.(anchor); } }}>{content}</mark> : <span key={from} data-offset={from}>{content}</span>;
    });
    if (node.type === 'code') return <pre key={key}><code>{parts}</code></pre>;
    if (node.type === 'inlineCode') return <code key={key}>{parts}</code>;
    return <Fragment key={key}>{parts}</Fragment>;
  };
  const render = (node: Ast, key: string): React.ReactNode => {
    // Keep a canonical newline text node for selection offsets as well as the
    // visual break; a bare <br> has no DOM text and shifts later branch anchors.
    if (node.type === 'break') return <Fragment key={key}>{leaf(node, `${key}-text`)}<br/></Fragment>;
    if (node.type === 'image') return <span key={key} className="markdown-image-block"><DocumentImage key={node.url} url={node.url || ''} alt={node.alt || ''}/>{node.alt && <span className="image-caption">{leaf(node,`${key}-alt`)}</span>}</span>;
    if (node.value !== undefined) return leaf(node, key);
    const children = node.children?.map((n, i) => render(n, `${key}-${i}`));
    switch (node.type) {
      case 'htmlElement': {
        if (node.tagName === 'table') {
          const rows: React.ReactNode[] = [], sections: React.ReactNode[] = [];
          const flush = () => { if (rows.length) { sections.push(<tbody key={`rows-${sections.length}`}>{rows.splice(0)}</tbody>); } };
          node.children?.forEach((child, i) => { if (child.tagName === 'tr') rows.push(children![i]); else { flush(); sections.push(children![i]); } });
          flush();
          return <div className="table-scroll" key={key}><table>{sections}</table></div>;
        }
        return createElement(node.tagName!, { key, ...node.properties }, children?.length ? children : undefined);
      }
      case 'root': return <Fragment key={key}>{children}</Fragment>;
      case 'paragraph': return <p key={key}>{children}</p>;
      case 'heading': return <MarkdownHeading key={key} level={node.depth || 2}>{children}</MarkdownHeading>;
      case 'strong': return <strong key={key}>{children}</strong>;
      case 'emphasis': return <em key={key}>{children}</em>;
      case 'delete': return <del key={key}>{children}</del>;
      case 'link': return /^https?:\/\//i.test(node.url || '') ? <a key={key} href={node.url} target="_blank" rel="noreferrer">{children}</a> : <span key={key}>{children}</span>;
      case 'blockquote': return <blockquote key={key}>{children}</blockquote>;
      case 'list': return node.ordered ? <ol key={key} start={node.start || 1}>{children}</ol> : <ul key={key}>{children}</ul>;
      case 'listItem': return <li key={key}>{children}</li>;
      case 'table': return <div className="table-scroll" key={key}><table><tbody>{children}</tbody></table></div>;
      case 'tableRow': return <tr key={key}>{children}</tr>;
      case 'tableCell': return <td key={key}>{children}</td>;
      case 'thematicBreak': return <hr key={key}/>;
      default: return <Fragment key={key}>{children}</Fragment>;
    }
  };
  return <>{render(tree, 'root')}</>;
}

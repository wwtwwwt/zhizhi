import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { layoutConversationMap, type ConversationMapData, type MapMessage, type MapSearchHit } from '../shared/conversation-map';
import { useAppState } from './client';
import { MarkdownBlocks } from './StreamingMarkdown';
import type { RenderMeta, Stream } from '../shared/types';

const kindLabels = { user: '用户', assistant: 'AI', note: '笔记', document: '文档' };

export function ConversationMap({ sessionId, open, selectedId, searchHost, onClose, onJump }: { sessionId: string; open: boolean; selectedId?: string | null; searchHost: HTMLElement | null; onClose: () => void; onJump: (message: MapMessage, data: ConversationMapData, hit?: MapSearchHit) => Promise<void> }) {
  const state = useAppState();
  const [data, setData] = useState<ConversationMapData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [jumping, setJumping] = useState(false);
  const [query, setQuery] = useState('');
  const [searchHits, setSearchHits] = useState<MapSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [resultIndex, setResultIndex] = useState(0);
  const [blockPreview, setBlockPreview] = useState<{ markdown: string; meta?: RenderMeta } | null>(null);
  const [preview, setPreview] = useState<{ message: MapMessage; left: number; top: number } | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const layer = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(43);
  const hidePreview = () => { clearTimeout(previewTimer.current); setPreview(null); };
  useEffect(() => () => clearTimeout(previewTimer.current), []);
  useLayoutEffect(() => {
    const header = layer.current?.parentElement?.querySelector<HTMLElement>('.topbar');
    if (!header) return;
    const update = () => setHeaderHeight(header.offsetHeight);
    const observer = new ResizeObserver(update);
    observer.observe(header); update();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!open) { hidePreview(); return; }
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [open, onClose]);
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    setLoading(true); setError('');
    void fetch(`/api/sessions/${sessionId}/map`, { signal: abort.signal }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || '无法读取对话地图');
      if (!abort.signal.aborted) { setData(result); hidePreview(); }
    }).catch(error => { if (!abort.signal.aborted) setError(error.message); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [sessionId, open, state.streams, state.sessions]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => { if (event.ctrlKey || event.metaKey) event.preventDefault(); };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);
  const layout = useMemo(() => data ? layoutConversationMap(data) : null, [data]);
  const points = useMemo(() => new Map(layout?.nodes.map(node => [node.id, node])), [layout]);
  const branches = useMemo(() => new Map(data?.branches.map(branch => [branch.anchor.stream_id, branch])), [data]);
  const matches = useMemo(() => new Set(searchHits.map(hit => hit.messageId)), [searchHits]);
  const currentHit = searchHits[resultIndex];
  useEffect(() => {
    setBlockPreview(null);
    if (!open || !currentHit) return;
    const message = data?.messages.find(message => message.id === currentHit.messageId);
    if (!message) return;
    if (currentHit.quote) { setBlockPreview({ markdown: branches.get(message.streamId)?.anchor.selected_text || currentHit.excerpt }); return; }
    if (!currentHit.slotId) { setBlockPreview({ markdown: currentHit.excerpt }); return; }
    const select = (stream: Stream) => stream.messages.find(message => message.id === currentHit.messageId)?.slots.find(slot => slot.id === currentHit.slotId && slot.node.id === currentHit.nodeId);
    const cached = state.streams[message.streamId];
    const slot = cached && select(cached);
    if (slot) { setBlockPreview({ markdown: slot.node.markdown, meta: slot.meta }); return; }
    const abort = new AbortController();
    void fetch(`/api/streams/${message.streamId}`, { signal: abort.signal }).then(async response => {
      if (!response.ok) throw new Error('预览不可用');
      const stream = await response.json() as Stream;
      const slot = select(stream);
      if (!abort.signal.aborted) setBlockPreview(slot ? { markdown: slot.node.markdown, meta: slot.meta } : { markdown: currentHit.excerpt });
    }).catch(() => { if (!abort.signal.aborted) setBlockPreview({ markdown: currentHit.excerpt }); });
    return () => abort.abort();
  }, [open, currentHit, data, branches]);
  const centerNode = (id: string) => {
    const element = viewport.current, node = element?.querySelector<HTMLElement>(`[data-map-message="${CSS.escape(id)}"]`);
    if (!element || !node) return;
    const bounds = node.getBoundingClientRect(), area = element.getBoundingClientRect();
    element.scrollTo({ left: element.scrollLeft + bounds.left - area.left + bounds.width / 2 - element.clientWidth / 2, top: element.scrollTop + bounds.top - area.top + bounds.height / 2 - element.clientHeight / 2, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  };
  useEffect(() => {
    const needle = query.trim();
    setSearchHits([]); setResultIndex(0); setSearchError(''); hidePreview();
    if (!open || !needle) { setSearching(false); return; }
    setSearching(true);
    const abort = new AbortController();
    const timer = setTimeout(() => {
      void fetch(`/api/sessions/${sessionId}/map/search?q=${encodeURIComponent(needle)}`, { signal: abort.signal }).then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error?.message || '搜索失败');
        if (!abort.signal.aborted) setSearchHits(result);
      }).catch(error => { if (!abort.signal.aborted) setSearchError(error.message); }).finally(() => { if (!abort.signal.aborted) setSearching(false); });
    }, 220);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [query, sessionId, open, data]);
  useEffect(() => { if (open && currentHit) centerNode(currentHit.messageId); }, [open, currentHit?.messageId, layout]);
  const moveResult = (direction: number) => {
    if (!searchHits.length) return;
    const next = (resultIndex + direction + searchHits.length) % searchHits.length;
    setResultIndex(next); centerNode(searchHits[next].messageId); hidePreview();
  };
  const jump = (message: MapMessage) => {
    if (!data || jumping) return;
    hidePreview(); setJumping(true);
    void onJump(message, data, searchHits.find(hit => hit.messageId === message.id)).finally(() => setJumping(false));
  };
  const showPreview = (message: MapMessage, x: number, y: number, delay = 160) => {
    clearTimeout(previewTimer.current);
    const show = () => setPreview({ message, left: Math.max(8, Math.min(x + 32 + 270 <= innerWidth - 8 ? x + 32 : x - 302, innerWidth - 278)), top: Math.max(8, y + 28 + 236 <= innerHeight - 8 ? y + 28 : y - 264) });
    if (delay) previewTimer.current = setTimeout(show, delay); else show();
  };
  const livePreview = preview && Object.values(state.jobs).find(job => job.messageId === preview.message.id)?.text;
  const sourceBranch = preview && branches.get(preview.message.streamId);
  const sourceQuote = sourceBranch && sourceBranch.parentMessageId === preview?.message.parentId ? sourceBranch.anchor.selected_text : undefined;
  return <div ref={layer} className={`conversation-map-layer ${open ? 'open' : ''}`} style={{ top: headerHeight }} aria-hidden={!open} inert={!open}>
    <button className={`conversation-map-backdrop ${state.settings?.blurBackdrop ? 'blurred' : ''}`} tabIndex={-1} aria-label="关闭对话地图" onClick={onClose}/>
    <section id="conversation-map-panel" className="conversation-map-panel" aria-label="对话地图">
    {open && searchHost && createPortal(<div className="map-search-controls"><label className="map-search-field"><Search size={14}/><input type="search" aria-label="搜索对话地图" placeholder="搜索消息和引用内容" maxLength={200} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); moveResult(event.shiftKey ? -1 : 1); } if (event.key === 'Escape' && query) { event.preventDefault(); event.stopPropagation(); setQuery(''); } }}/>{query && <button aria-label="清除地图搜索" onClick={() => setQuery('')}><X size={13}/></button>}</label>
      {query.trim() && <><output className="map-search-count" aria-live="polite">{searching ? '搜索中…' : searchError || (searchHits.length ? `${resultIndex + 1} / ${searchHits.length}` : '无结果')}</output><div className="map-search-actions"><button aria-label="上一个搜索结果" disabled={!searchHits.length} onClick={() => moveResult(-1)}><ChevronUp size={15}/></button><button aria-label="下一个搜索结果" disabled={!searchHits.length} onClick={() => moveResult(1)}><ChevronDown size={15}/></button><button aria-label="打开搜索结果" disabled={!currentHit || jumping} onClick={() => { const message = currentHit && points.get(currentHit.messageId); if (message) jump(message); }}><ArrowUpRight size={15}/></button></div></>}
    </div>, searchHost)}
    {query.trim() && <div className="conversation-map-toolbar searching">{currentHit && <div className={`map-search-excerpt ${blockPreview?.meta?.quote ? 'quoted' : ''}`} role="region" aria-label="搜索内容预览">{blockPreview ? <MarkdownBlocks source={blockPreview.markdown} firstMeta={blockPreview.meta}/> : <p>{currentHit.excerpt}</p>}</div>}</div>}
    <div className="conversation-map-clip"><div className="conversation-map-scroll" ref={viewport} onScroll={hidePreview} onMouseLeave={hidePreview}>
      {error ? <p className="conversation-map-status" role="alert">{error}</p> : !layout ? <p className="conversation-map-status" role="status">{loading ? '正在读取地图…' : ''}</p> : !layout.nodes.length ? <p className="conversation-map-status">暂无消息</p> : <div className="conversation-map-stage"><div className={`conversation-map-canvas ${query.trim() && !searching && !searchError ? 'searching' : ''}`} style={{ width: layout.width, height: layout.height }}>
        <svg width={layout.width} height={layout.height} aria-hidden="true">{layout.nodes.map(node => {
          const parent = node.parentId ? points.get(node.parentId) : undefined;
          if (!parent) return null;
          return <path key={node.id} d={parent.x === node.x ? `M${parent.x} ${parent.y}V${node.y}` : `M${parent.x} ${parent.y}H${node.x}V${node.y}`}/>;
        })}</svg>
        {layout.nodes.map(node => <button key={node.id} className={`conversation-map-node map-node-${node.kind} ${currentHit?.messageId === node.id ? 'map-search-current' : ''}`} data-map-message={node.id} data-search-match={matches.has(node.id) || undefined} style={{ left: node.x, top: node.y }} aria-label={`${kindLabels[node.kind]}：${node.preview.slice(0, 60) || '生成中'}`} aria-current={selectedId === node.id ? 'location' : undefined} disabled={jumping} onMouseLeave={hidePreview} onFocus={event => { const bounds = event.currentTarget.getBoundingClientRect(); showPreview(node, bounds.right, bounds.bottom, 0); }} onBlur={hidePreview} onClick={() => jump(node)}><span onMouseEnter={event => showPreview(node, event.clientX, event.clientY)} onMouseLeave={hidePreview}/></button>)}
      </div></div>}
    </div></div>
    </section>
    {open && preview && createPortal(<div className="conversation-map-preview" role="tooltip" style={{ left: preview.left, top: preview.top }}><span>{kindLabels[preview.message.kind]}</span>{sourceQuote && <blockquote className="map-preview-quote"><span>引用</span><p>{sourceQuote}</p></blockquote>}<div>{livePreview || preview.message.preview || '正在生成…'}</div></div>, document.body)}
  </div>;
}

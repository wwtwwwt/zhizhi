import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { layoutConversationMap, type ConversationMapData, type MapMessage, type MapSearchHit } from '../shared/conversation-map';
import { useAppState } from './client';
import { MarkdownBlocks } from './StreamingMarkdown';
import { useMapSplitResize } from './useMapSplitResize';
import type { Message, Stream } from '../shared/types';

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
  const [selection, setSelection] = useState<{ id: string; hit?: MapSearchHit } | null>(null);
  const [messagePreview, setMessagePreview] = useState<Message | null>(null);
  const previewStreams = useMemo(() => new Map<string, Stream>(), [sessionId, state.streams]);
  const hadPreview = useRef(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const contentPreview = useRef<HTMLDivElement>(null);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const viewport = useRef<HTMLDivElement>(null);
  const splitBody = useRef<HTMLDivElement>(null);
  const split = useMapSplitResize(splitBody, open && !!selection);
  const layer = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(43);
  useEffect(() => () => clearTimeout(clickTimer.current), []);
  useEffect(() => { clearTimeout(clickTimer.current); setSelection(null); setMessagePreview(null); }, [sessionId, open]);
  useLayoutEffect(() => {
    const header = layer.current?.parentElement?.querySelector<HTMLElement>('.topbar');
    if (!header) return;
    const update = () => setHeaderHeight(header.offsetHeight);
    const observer = new ResizeObserver(update);
    observer.observe(header); update();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!open) return;
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
      if (!abort.signal.aborted) { setData(result); }
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
  const selectedMessage = data?.messages.find(message => message.id === selection?.id);
  const cachedPreviewStream = selectedMessage && (state.streams[selectedMessage.streamId] || previewStreams.get(selectedMessage.streamId));
  const previewMessage = cachedPreviewStream?.messages.find(message => message.id === selectedMessage?.id) || (messagePreview?.id === selectedMessage?.id ? messagePreview : null);
  const selectedBranch = selectedMessage && branches.get(selectedMessage.streamId);
  const selectedQuote = selectedBranch && selectedBranch.parentMessageId === selectedMessage?.parentId ? selectedBranch.anchor.selected_text : undefined;
  const liveText = selectedMessage && Object.values(state.jobs).find(job => job.messageId === selectedMessage.id)?.text;
  useEffect(() => {
    setMessagePreview(null); setPreviewError(''); setPreviewLoading(false);
    if (!open || !selectedMessage) return;
    const select = (stream: Stream) => stream.messages.find(message => message.id === selectedMessage.id);
    const cached = state.streams[selectedMessage.streamId] || previewStreams.get(selectedMessage.streamId);
    const message = cached && select(cached);
    if (message) { setMessagePreview(message); return; }
    const abort = new AbortController();
    setPreviewLoading(true);
    void fetch(`/api/streams/${selectedMessage.streamId}`, { signal: abort.signal }).then(async response => {
      if (!response.ok) throw new Error('无法读取完整消息');
      const stream = await response.json() as Stream;
      const message = select(stream);
      if (!message) throw new Error('消息已不可用');
      if (!abort.signal.aborted) { previewStreams.set(selectedMessage.streamId, stream); setMessagePreview(message); }
    }).catch(error => { if (!abort.signal.aborted) setPreviewError(error.message); })
      .finally(() => { if (!abort.signal.aborted) setPreviewLoading(false); });
    return () => abort.abort();
  }, [open, selectedMessage, state.streams, previewStreams]);
  useLayoutEffect(() => {
    const element = contentPreview.current;
    if (!element) return;
    const target = selection?.hit?.quote ? element.querySelector<HTMLElement>('.map-detail-quote') : selection?.hit?.slotId ? element.querySelector<HTMLElement>(`[data-preview-slot="${CSS.escape(selection.hit.slotId)}"]`) : null;
    element.scrollTop = target ? element.scrollTop + target.getBoundingClientRect().top - element.getBoundingClientRect().top - 12 : 0;
  }, [selection, previewMessage]);
  const centerNode = (id: string) => {
    const element = viewport.current, node = element?.querySelector<HTMLElement>(`[data-map-message="${CSS.escape(id)}"]`);
    if (!element || !node) return;
    const bounds = node.getBoundingClientRect(), area = element.getBoundingClientRect();
    element.scrollTo({ left: element.scrollLeft + bounds.left - area.left + bounds.width / 2 - element.clientWidth / 2, top: element.scrollTop + bounds.top - area.top + bounds.height / 2 - element.clientHeight / 2, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  };
  useEffect(() => {
    const needle = query.trim();
    setSearchHits([]); setResultIndex(0); setSearchError('');
    setSelection(current => current?.hit ? { id: current.id } : current);
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
  useEffect(() => {
    if (open && currentHit) { clearTimeout(clickTimer.current); setSelection({ id: currentHit.messageId, hit: currentHit }); }
  }, [open, currentHit]);
  useEffect(() => {
    if (open && selection && (selection.hit || !hadPreview.current)) centerNode(selection.id);
    hadPreview.current = open && !!selection;
  }, [open, selection, layout]);
  const moveResult = (direction: number) => {
    if (!searchHits.length) return;
    const next = (resultIndex + direction + searchHits.length) % searchHits.length;
    setResultIndex(next);
  };
  const jump = (message: MapMessage, hit?: MapSearchHit) => {
    if (!data || jumping) return;
    clearTimeout(clickTimer.current); setJumping(true);
    void onJump(message, data, hit).finally(() => setJumping(false));
  };
  const selectNode = (message: MapMessage) => {
    clearTimeout(clickTimer.current);
    // Only the initial opening moves the clicked node. Once open, switch
    // immediately and keep the map still so a second click can navigate.
    if (selectedMessage) setSelection({ id: message.id });
    else clickTimer.current = setTimeout(() => setSelection({ id: message.id }), 280);
  };
  return <div ref={layer} className={`conversation-map-layer ${open ? 'open' : ''}`} style={{ top: headerHeight }} aria-hidden={!open} inert={!open}>
    <button className={`conversation-map-backdrop ${state.settings?.blurBackdrop ? 'blurred' : ''}`} tabIndex={-1} aria-label="关闭对话地图" onClick={onClose}/>
    <section id="conversation-map-panel" className="conversation-map-panel" aria-label="对话地图">
    {open && searchHost && createPortal(<div className="map-search-controls"><label className="map-search-field"><Search size={14}/><input type="search" aria-label="搜索对话地图" placeholder="搜索消息和引用内容" maxLength={200} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); moveResult(event.shiftKey ? -1 : 1); } if (event.key === 'Escape' && query) { event.preventDefault(); event.stopPropagation(); setQuery(''); } }}/>{query && <button aria-label="清除地图搜索" onClick={() => setQuery('')}><X size={13}/></button>}</label>
      {query.trim() && <><output className="map-search-count" aria-live="polite">{searching ? '搜索中…' : searchError || (searchHits.length ? `${resultIndex + 1} / ${searchHits.length}` : '无结果')}</output><div className="map-search-actions"><button aria-label="上一个搜索结果" disabled={!searchHits.length} onClick={() => moveResult(-1)}><ChevronUp size={15}/></button><button aria-label="下一个搜索结果" disabled={!searchHits.length} onClick={() => moveResult(1)}><ChevronDown size={15}/></button><button aria-label="打开搜索结果" disabled={!currentHit || jumping} onClick={() => { const message = currentHit && points.get(currentHit.messageId); if (message) jump(message, currentHit); }}><ArrowUpRight size={15}/></button></div></>}
    </div>, searchHost)}
    <div ref={splitBody} className={`conversation-map-body ${selectedMessage ? 'has-preview' : ''} ${split.resizing ? 'resizing' : ''}`} style={{ '--map-split': `${split.ratio * 100}%`, '--map-preview-width': `${split.width * (1 - split.ratio)}px` } as CSSProperties}>
    <div className="conversation-map-clip"><div className="conversation-map-scroll" ref={viewport}>
      {error ? <p className="conversation-map-status" role="alert">{error}</p> : !layout ? <p className="conversation-map-status" role="status">{loading ? '正在读取地图…' : ''}</p> : !layout.nodes.length ? <p className="conversation-map-status">暂无消息</p> : <div className="conversation-map-stage"><div className={`conversation-map-canvas ${query.trim() && !searching && !searchError ? 'searching' : ''}`} style={{ width: layout.width, height: layout.height }}>
        <svg width={layout.width} height={layout.height} aria-hidden="true">{layout.nodes.map(node => {
          const parent = node.parentId ? points.get(node.parentId) : undefined;
          if (!parent) return null;
          return <path key={node.id} d={parent.x === node.x ? `M${parent.x} ${parent.y}V${node.y}` : `M${parent.x} ${parent.y}H${node.x}V${node.y}`}/>;
        })}</svg>
        {layout.nodes.map(node => <button key={node.id} className={`conversation-map-node map-node-${node.kind} ${currentHit?.messageId === node.id ? 'map-search-current' : ''}`} data-map-message={node.id} data-search-match={matches.has(node.id) || undefined} style={{ left: node.x, top: node.y }} aria-label={`${kindLabels[node.kind]}：${node.preview.slice(0, 60) || '生成中'}`} aria-current={selectedId === node.id ? 'location' : undefined} aria-pressed={selection?.id === node.id} disabled={jumping} onClick={event => {
          if (event.detail === 0) { clearTimeout(clickTimer.current); setSelection({ id: node.id }); }
          else selectNode(node);
        }} onDoubleClick={() => jump(node, selection?.id === node.id ? selection.hit : undefined)}><span/></button>)}
      </div></div>}
    </div></div>
    <div className="map-preview-pane" inert={!selectedMessage} aria-hidden={!selectedMessage}>
    {selectedMessage && <aside className="map-message-detail" aria-label="消息内容预览">
      <header><span>{kindLabels[selectedMessage.kind]}</span><div>
        <button className="icon-button" aria-label="跳转到消息" title="跳转到消息" disabled={jumping} onClick={() => jump(selectedMessage, selection?.hit)}><ArrowUpRight size={15}/></button>
        <button className="icon-button" aria-label="关闭消息预览" title="关闭消息预览" onClick={() => { clearTimeout(clickTimer.current); setSelection(null); }}><X size={15}/></button>
      </div></header>
      <div className="map-message-detail-content" ref={contentPreview}>
        {selectedQuote && <blockquote className={`map-detail-quote ${selection?.hit?.quote ? 'map-preview-match' : ''}`}><span>引用</span><p>{selectedQuote}</p></blockquote>}
        {previewLoading && <p role="status" className="conversation-map-status">正在读取消息…</p>}
        {previewError && <p role="alert" className="conversation-map-status">{previewError}，以下仅显示消息摘要。</p>}
        {liveText ? <MarkdownBlocks source={liveText}/> : previewMessage?.slots.length ? previewMessage.slots.map(slot => <div key={slot.id} data-preview-slot={slot.id} className={selection?.hit?.slotId === slot.id && selection?.hit?.nodeId === slot.node.id ? 'map-preview-match' : undefined}><MarkdownBlocks source={slot.node.markdown} firstMeta={slot.meta}/></div>) : <MarkdownBlocks source={previewMessage?.content_markdown || selectedMessage.preview || (selectedMessage.status === 'streaming' || selectedMessage.status === 'queued' ? '正在生成…' : '')}/>}
        {!!previewMessage?.attachments?.length && <div className="map-detail-attachments">{previewMessage.attachments.map(attachment => <span key={attachment.id}>{attachment.name}</span>)}</div>}
      </div>
    </aside>}
    </div>
    <div className={`map-split-handle ${split.ready ? 'ready' : ''}`} role="separator" aria-label="调整地图与预览比例" aria-orientation="vertical" aria-valuemin={Math.round(split.minimum * 100)} aria-valuemax={Math.round(split.maximum * 100)} aria-valuenow={Math.round(split.ratio * 100)} tabIndex={selectedMessage ? 0 : -1} aria-hidden={!selectedMessage} onPointerEnter={split.enter} onPointerLeave={split.leave} onPointerDown={split.start} onPointerMove={split.move} onPointerUp={split.stop} onPointerCancel={split.stop} onLostPointerCapture={split.stop} onKeyDown={event => { if (split.keyboard(event.key)) event.preventDefault(); }}/>
    </div>
    </section>
  </div>;
}

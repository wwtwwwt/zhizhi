import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { layoutConversationMap, type ConversationMapData, type MapMessage } from '../shared/conversation-map';
import { useAppState } from './client';

const kindLabels = { user: '用户', assistant: 'AI', note: '笔记', document: '文档' };

export function ConversationMap({ sessionId, open, selectedId, onClose, onJump }: { sessionId: string; open: boolean; selectedId?: string | null; onClose: () => void; onJump: (message: MapMessage, data: ConversationMapData) => Promise<void> }) {
  const state = useAppState();
  const [data, setData] = useState<ConversationMapData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [jumping, setJumping] = useState(false);
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
  const showPreview = (message: MapMessage, x: number, y: number, delay = 160) => {
    clearTimeout(previewTimer.current);
    const show = () => setPreview({ message, left: Math.max(8, Math.min(x + 32 + 270 <= innerWidth - 8 ? x + 32 : x - 302, innerWidth - 278)), top: Math.max(8, y + 28 + 160 <= innerHeight - 8 ? y + 28 : y - 188) });
    if (delay) previewTimer.current = setTimeout(show, delay); else show();
  };
  const livePreview = preview && Object.values(state.jobs).find(job => job.messageId === preview.message.id)?.text;
  return <div ref={layer} className={`conversation-map-layer ${open ? 'open' : ''}`} style={{ top: headerHeight }} aria-hidden={!open} inert={!open}>
    <button className={`conversation-map-backdrop ${state.settings?.blurBackdrop ? 'blurred' : ''}`} tabIndex={-1} aria-label="关闭对话地图" onClick={onClose}/>
    <section id="conversation-map-panel" className="conversation-map-panel" aria-label="对话地图">
    <div className="conversation-map-clip"><div className="conversation-map-scroll" ref={viewport} onScroll={hidePreview} onMouseLeave={hidePreview}>
      {error ? <p className="conversation-map-status" role="alert">{error}</p> : !layout ? <p className="conversation-map-status" role="status">{loading ? '正在读取地图…' : ''}</p> : !layout.nodes.length ? <p className="conversation-map-status">暂无消息</p> : <div className="conversation-map-stage"><div className="conversation-map-canvas" style={{ width: layout.width, height: layout.height }}>
        <svg width={layout.width} height={layout.height} aria-hidden="true">{layout.nodes.map(node => {
          const parent = node.parentId ? points.get(node.parentId) : undefined;
          if (!parent) return null;
          return <path key={node.id} d={parent.x === node.x ? `M${parent.x} ${parent.y}V${node.y}` : `M${parent.x} ${parent.y}H${node.x}V${node.y}`}/>;
        })}</svg>
        {layout.nodes.map(node => <button key={node.id} className={`conversation-map-node map-node-${node.kind}`} data-map-message={node.id} style={{ left: node.x, top: node.y }} aria-label={`${kindLabels[node.kind]}：${node.preview.slice(0, 60) || '生成中'}`} aria-current={selectedId === node.id ? 'location' : undefined} disabled={jumping} onMouseLeave={hidePreview} onFocus={event => { const bounds = event.currentTarget.getBoundingClientRect(); showPreview(node, bounds.right, bounds.bottom, 0); }} onBlur={hidePreview} onClick={() => {
          if (!data) return;
          hidePreview(); setJumping(true);
          void onJump(node, data).finally(() => setJumping(false));
        }}><span onMouseEnter={event => showPreview(node, event.clientX, event.clientY)} onMouseLeave={hidePreview}/></button>)}
      </div></div>}
    </div></div>
    </section>
    {open && preview && createPortal(<div className="conversation-map-preview" role="tooltip" style={{ left: preview.left, top: preview.top }}><span>{kindLabels[preview.message.kind]}</span><div>{livePreview || preview.message.preview || '正在生成…'}</div></div>, document.body)}
  </div>;
}

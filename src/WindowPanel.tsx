import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useAppState } from './client';
import { X } from 'lucide-react';
import { useCenteredResize } from './useCenteredResize';
import type { Corner } from '../shared/workspace-layout';
export function WindowPanel({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const state = useAppState();
  const ref = useRef<HTMLDivElement>(null), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [closing, setClosing] = useState(false), [entered, setEntered] = useState(false); const resize = useCenteredResize();
  const close = () => { if (closing) return; setClosing(true); timer.current = setTimeout(onClose, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 160); };
  const closeRef = useRef(close); closeRef.current = close;
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; ref.current?.focus(); const listener = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeRef.current(); }
    if (e.key === 'Tab') { const items = [...ref.current!.querySelectorAll<HTMLElement>('button:not(:disabled),input,textarea,select,a[href],[tabindex="0"]')].filter(el => el.getClientRects().length); const first = items[0], last = items.at(-1); if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } }
  }; window.addEventListener('keydown', listener, true); return () => { clearTimeout(timer.current); window.removeEventListener('keydown', listener, true); previous?.focus({ preventScroll: true }); }; }, []);
  return <><div className={`model-management-backdrop branch-backdrop ${state.settings?.blurBackdrop ? 'blurred' : ''} ${closing ? 'closing' : ''}`} onClick={close}/><div ref={ref} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className={`branch-dialog model-management-window ${closing ? 'closing' : ''} ${entered ? 'entered' : ''} ${resize.resizing ? 'resizing' : ''}`} style={{ width: resize.size.width, height: resize.size.height, '--behind': 0, '--stack-scale': 1 } as CSSProperties} onAnimationEnd={e => { if (e.target === e.currentTarget) setEntered(true); }}><header className="branch-header"><strong>{title}</strong><button className="icon-button" aria-label={`关闭${title}`} onClick={close}><X size={17}/></button></header>{children}{(['nw','ne','sw','se'] as Corner[]).map(c => <button className={`resize-corner resize-${c}`} key={c} aria-label={`调整管理窗口：${c}`} onPointerDown={e => { setEntered(true); resize.start(e,c); }} onPointerMove={resize.move} onPointerUp={resize.stop} onPointerCancel={resize.stop} onLostPointerCapture={resize.stop} onKeyDown={e => { if (resize.keyboard(c,e.key)) { e.preventDefault(); e.stopPropagation(); } }}/>)}</div></>;
}

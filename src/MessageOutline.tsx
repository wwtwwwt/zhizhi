import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { ChevronDown, ListTree } from 'lucide-react';

type Heading = { element: HTMLElement; text: string; level: number };
type Outline = { messageId: string; headings: Heading[]; left: number; top: number; width: number; height: number; active: number };

export function MessageOutline({ scroll, messageId, onNavigate }: { scroll: RefObject<HTMLDivElement | null>; messageId: string | null; onNavigate: () => void }) {
  const [outline, setOutline] = useState<Outline | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [presented, setPresented] = useState<Outline | null>(null);
  const [visible, setVisible] = useState(false);
  const latest = useRef(outline);
  latest.current = outline;
  const presentedId = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (outline && outline.messageId === presentedId.current) setPresented(outline);
  }, [outline]);
  useEffect(() => {
    let frame = 0, nextFrame = 0;
    if (outline && outline.messageId === presentedId.current) { setVisible(true); return; }
    setVisible(false);
    const show = () => {
      const next = latest.current;
      presentedId.current = next?.messageId || null;
      setPresented(next);
      if (next) frame = requestAnimationFrame(() => { nextFrame = requestAnimationFrame(() => setVisible(true)); });
    };
    const timer = setTimeout(show, presentedId.current && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 180 : 0);
    return () => { clearTimeout(timer); cancelAnimationFrame(frame); cancelAnimationFrame(nextFrame); };
  }, [outline?.messageId]);
  useLayoutEffect(() => {
    const viewport = scroll.current;
    const message = viewport?.querySelector<HTMLElement>(`[data-message="${messageId}"]`);
    const content = message?.querySelector<HTMLElement>('.message-content');
    const rail = message?.querySelector<HTMLElement>('.message-tools');
    if (!viewport || !message || !content || !rail) { setOutline(null); return; }
    let frame = 0;
    const update = () => {
      const headings = [...content.querySelectorAll<HTMLElement>('.markdown h2, .markdown h3')]
        .filter(element => !element.closest('.rewrite-preview'))
        .map(element => ({ element, text: element.textContent?.trim() || '', level: Number(element.tagName.slice(1)) }))
        .filter(heading => heading.text);
      const bounds = viewport.getBoundingClientRect(), parent = viewport.parentElement!.getBoundingClientRect();
      const area = rail.getBoundingClientRect();
      if (!headings.length || content.offsetHeight < viewport.clientHeight * 1.2 || message.getBoundingClientRect().bottom <= bounds.top) { setOutline(null); return; }
      const current = headings.findLastIndex(heading => heading.element.getBoundingClientRect().top <= bounds.top + 48);
      setOutline({ messageId: messageId!, headings, left: area.left - parent.left, top: bounds.top - parent.top, width: area.width, height: Math.max(60, Math.min(300, viewport.clientHeight * .45)), active: current });
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    const resize = new ResizeObserver(schedule);
    resize.observe(viewport); resize.observe(content); resize.observe(rail);
    const mutation = new MutationObserver(schedule);
    mutation.observe(content, { subtree: true, childList: true, characterData: true });
    viewport.addEventListener('scroll', schedule, { passive: true });
    update();
    return () => { resize.disconnect(); mutation.disconnect(); viewport.removeEventListener('scroll', schedule); cancelAnimationFrame(frame); };
  }, [scroll, messageId]);
  if (!presented) return null;
  return <nav className={`message-outline ${collapsed ? 'collapsed' : ''} ${visible ? 'visible' : ''}`} inert={!visible} aria-hidden={!visible} aria-label="当前回答目录" style={{ left: presented.left, top: presented.top, width: presented.width }}>
    <div className="message-outline-heading"><ListTree size={14} aria-hidden="true"/><button className="message-outline-toggle" aria-label={collapsed ? '展开目录' : '收起目录'} title={collapsed ? '展开目录' : '收起目录'} aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}><ChevronDown size={14}/></button></div>
    <div className="message-outline-collapse" inert={collapsed} aria-hidden={collapsed}><div className="message-outline-clip"><div className="message-outline-items" style={{ maxHeight: presented.height }}>{presented.headings.map((heading, index) => <button key={index} className={heading.level === 3 ? 'outline-subheading' : undefined} aria-current={presented.active === index ? 'location' : undefined} title={heading.text} onClick={() => {
      const viewport = scroll.current; if (!viewport) return;
      onNavigate();
      viewport.scrollTo({ top: viewport.scrollTop + heading.element.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 12, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    }}>{heading.text}</button>)}</div></div></div>
  </nav>;
}

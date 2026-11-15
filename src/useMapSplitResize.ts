import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';

export function useMapSplitResize(container: RefObject<HTMLDivElement | null>, active: boolean) {
  const [preferred, setPreferred] = useState(() => {
    try { const saved = Number(localStorage.getItem('mapSplitRatio')); if (saved >= .2 && saved <= .8) return saved; } catch {}
    return .45;
  });
  const [width, setWidth] = useState(0), [ready, setReady] = useState(false), [resizing, setResizing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const drag = useRef<{ id: number; element: HTMLElement; start: number; ratio: number; width: number } | null>(null);
  const minimum = width ? Math.min(.45, Math.max(.2, 180 / width)) : .2;
  const maximum = width ? Math.max(.55, Math.min(.8, 1 - 260 / width)) : .8;
  const clamp = (value: number) => Math.max(minimum, Math.min(maximum, value));
  const ratio = clamp(preferred);
  const stop = () => {
    clearTimeout(timer.current);
    const current = drag.current; drag.current = null;
    if (current?.element.hasPointerCapture(current.id)) current.element.releasePointerCapture(current.id);
    setResizing(false); setReady(false);
  };
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element); setWidth(element.clientWidth);
    return () => { observer.disconnect(); clearTimeout(timer.current); };
  }, [container]);
  useEffect(() => { if (!active) stop(); }, [active]);
  useEffect(() => { try { localStorage.setItem('mapSplitRatio', String(preferred)); } catch {} }, [preferred]);
  useEffect(() => {
    document.documentElement.classList.toggle('map-split-resizing', resizing);
    return () => document.documentElement.classList.remove('map-split-resizing');
  }, [resizing]);
  useEffect(() => { window.addEventListener('blur', stop); return () => window.removeEventListener('blur', stop); }, []);
  return {
    ratio, width, minimum, maximum, ready, resizing, stop,
    enter: () => { clearTimeout(timer.current); timer.current = setTimeout(() => setReady(true), 250); },
    leave: () => { clearTimeout(timer.current); if (!drag.current) setReady(false); },
    start: (event: PointerEvent<HTMLElement>) => {
      if (!active || !ready || event.button !== 0 || !width) return;
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { id: event.pointerId, element: event.currentTarget, start: event.clientX, ratio, width };
      setResizing(true);
    },
    move: (event: PointerEvent<HTMLElement>) => {
      const current = drag.current;
      if (current?.id === event.pointerId) setPreferred(clamp(current.ratio + (event.clientX - current.start) / current.width));
    },
    keyboard: (key: string) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return false;
      setPreferred(key === 'Home' ? minimum : key === 'End' ? maximum : clamp(ratio + (key === 'ArrowRight' ? .02 : -.02)));
      return true;
    },
  };
}

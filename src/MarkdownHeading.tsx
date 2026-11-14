import { createElement, useLayoutEffect, useRef, type ReactNode } from 'react';

export function MarkdownHeading({ level, children }: { level: number; children: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    const element = heading.current;
    if (!element) return;
    const update = () => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const last = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0).at(-1);
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const context = document.createElement('canvas').getContext('2d');
      if (!last || !context) { delete element.dataset.markerFits; return; }
      context.font = `${style.fontWeight} ${parseFloat(style.fontSize) * .72}px ${style.fontFamily}`;
      const width = context.measureText('#'.repeat(level)).width;
      const left = last.right - bounds.left + 8;
      element.dataset.markerFits = String(left + width <= element.clientWidth);
      element.style.setProperty('--heading-marker-left', `${left}px`);
      element.style.setProperty('--heading-marker-top', `${last.top - bounds.top}px`);
      element.style.setProperty('--heading-marker-height', `${last.height}px`);
    };
    const observer = new ResizeObserver(update);
    observer.observe(element);
    let mounted = true;
    void document.fonts.ready.then(() => { if (mounted) update(); });
    update();
    return () => { mounted = false; observer.disconnect(); };
  }, [level, children]);
  return createElement(`h${level}`, { ref: heading, 'data-heading-marker': '#'.repeat(level) }, children);
}

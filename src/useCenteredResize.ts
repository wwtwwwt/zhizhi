import { useEffect, useRef, useSyncExternalStore, type PointerEvent } from 'react';
import { clampDialogSize, resizeCentered, type Corner, type Size } from '../shared/workspace-layout';

export const dialogSizeKey = 'dialogSize';
const viewport = (): Size => ({ width: innerWidth, height: innerHeight });
function initialSize(): Size {
  try {
    const saved = JSON.parse(localStorage.getItem(dialogSizeKey) || 'null');
    if (saved && Number.isFinite(saved.width) && saved.width > 0 && Number.isFinite(saved.height) && saved.height > 0)
      return { width: saved.width, height: saved.height };
  } catch { /* Unavailable storage or malformed preferences use the default size. */ }
  return { width: Math.min(1040, innerWidth - 96), height: Math.min(850, innerHeight - 150) };
}
// All branch and management windows subscribe to one preferred size. Viewport
// clamping is temporary, so a smaller screen does not overwrite that preference.
let snapshot = { preferred: initialSize(), viewport: viewport(), resizing: false };
const listeners = new Set<() => void>();
const getSnapshot = () => snapshot;
function update(value: Partial<typeof snapshot>) {
  snapshot = { ...snapshot, ...value };
  listeners.forEach(listener => listener());
}
function saveSize() {
  try { localStorage.setItem(dialogSizeKey, JSON.stringify(snapshot.preferred)); } catch { /* Resizing still works without storage. */ }
}
function viewportChanged() {
  const next = viewport();
  if (next.width !== snapshot.viewport.width || next.height !== snapshot.viewport.height) update({ viewport: next });
}
function subscribe(listener: () => void) {
  if (!listeners.size) window.addEventListener('resize', viewportChanged);
  listeners.add(listener); viewportChanged();
  return () => { listeners.delete(listener); if (!listeners.size) window.removeEventListener('resize', viewportChanged); };
}
export function useCenteredResize() {
  const shared = useSyncExternalStore(subscribe, getSnapshot);
  const size = clampDialogSize(shared.preferred, shared.viewport);
  const drag = useRef<{ x: number; y: number; size: Size; corner: Corner; pointerId: number } | null>(null);
  const stop = () => {
    if (!drag.current) return;
    drag.current = null; update({ resizing: false }); saveSize();
  };
  useEffect(() => () => stop(), []);
  const start = (e: PointerEvent<HTMLButtonElement>, corner: Corner) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, size, corner, pointerId: e.pointerId }; update({ resizing: true });
  };
  const move = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (d && d.pointerId === e.pointerId) update({ preferred: resizeCentered(d.size, e.clientX - d.x, e.clientY - d.y, d.corner, viewport()) });
  };
  const keyboard = (corner: Corner, key: string) => {
    if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(key)) return false;
    update({ preferred: resizeCentered(clampDialogSize(snapshot.preferred, viewport()), key === 'ArrowRight' ? 10 : key === 'ArrowLeft' ? -10 : 0, key === 'ArrowDown' ? 10 : key === 'ArrowUp' ? -10 : 0, corner, viewport()) });
    saveSize(); return true;
  };
  return { size, resizing: shared.resizing, start, move, stop, keyboard };
}

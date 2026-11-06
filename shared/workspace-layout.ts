export type Size = { width: number; height: number };
export type Corner = 'nw' | 'ne' | 'sw' | 'se';
export function clampDialogSize(size: Size, viewport: Size): Size {
  const maxWidth = Math.max(160, viewport.width - 24), maxHeight = Math.max(160, viewport.height - 35);
  return { width: Math.min(maxWidth, Math.max(Math.min(520, maxWidth), size.width)), height: Math.min(maxHeight, Math.max(Math.min(220, maxHeight), size.height)) };
}
export function resizeCentered(size: Size, dx: number, dy: number, corner: Corner, viewport: Size): Size {
  return clampDialogSize({ width: size.width + dx * 2 * (corner.endsWith('e') ? 1 : -1), height: size.height + dy * 2 * (corner.startsWith('s') ? 1 : -1) }, viewport);
}
// Place annotations without inserting space between document paragraphs.
export function layoutSideItems(items: { id: string; top: number; blockHeight: number; height: number }[], gap = 6) {
  let bottom = 0;
  return items.map(item => { const top = Math.max(item.top, bottom ? bottom + gap : 0), height = Math.max(item.blockHeight, item.height); bottom = top + height; return { id: item.id, top, height }; });
}

// Artboards: several open documents placed side by side on the canvas
import { renderMarkup, type DocSize } from './svg';

export interface BoardRect { id: string; name: string; svg: string; x: number; size: DocSize; src: string }

const cache = new Map<string, { size: DocSize; src: string }>();

/** Size and image source of a document; inactive artboards render as an <img> so their ids and defs stay isolated */
function view(svg: string) {
  const hit = cache.get(svg);
  if (hit) return hit;
  const { html, size } = renderMarkup(svg);
  const v = { size, src: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(html) };
  if (cache.size > 100) cache.clear();
  cache.set(svg, v);
  return v;
}

/**
 * Lay the artboards out in a row, top-aligned, in document units.
 * The gap scales with the tallest board so small icons and large drawings both get a sensible spacing.
 */
export function layoutBoards(list: { id: string; name: string; svg: string }[]): { rects: BoardRect[]; w: number; h: number } {
  const views = list.map((b) => view(b.svg));
  const h = Math.max(1, ...views.map((v) => v.size.h));
  const gap = h * 0.2;
  let x = 0;
  const rects = list.map((b, i) => {
    const r = { id: b.id, name: b.name, svg: b.svg, x, size: views[i].size, src: views[i].src };
    x += views[i].size.w + gap;
    return r;
  });
  return { rects, w: Math.max(1, x - gap), h };
}

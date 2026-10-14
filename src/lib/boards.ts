// Artboards: several open documents placed in rows and columns on the canvas
import { renderMarkup, type DocSize } from './svg';

export interface BoardRect { id: string; name: string; svg: string; x: number; y: number; size: DocSize; src: string }

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
 * Lay the artboards out in rows and columns (as square as possible), each top-left in its cell, in document units.
 * Columns are as wide as their widest board, rows as tall as their tallest. The gap scales with the largest
 * board so small icons and large drawings both get a sensible spacing; rows get extra room for the name labels.
 */
export function layoutBoards(list: { id: string; name: string; svg: string }[]): { rects: BoardRect[]; w: number; h: number } {
  const views = list.map((b) => view(b.svg));
  const cols = Math.max(1, Math.ceil(Math.sqrt(list.length)));
  const big = Math.max(1, ...views.map((v) => Math.max(v.size.w, v.size.h)));
  const gap = big * 0.2, rowGap = big * 0.3;
  const colW: number[] = [], rowH: number[] = [];
  views.forEach((v, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    colW[c] = Math.max(colW[c] ?? 0, v.size.w);
    rowH[r] = Math.max(rowH[r] ?? 0, v.size.h);
  });
  const at = (sizes: number[], i: number, g: number) => sizes.slice(0, i).reduce((a, b) => a + b + g, 0);
  const rects = list.map((b, i) => ({
    id: b.id, name: b.name, svg: b.svg, size: views[i].size, src: views[i].src,
    x: at(colW, i % cols, gap), y: at(rowH, Math.floor(i / cols), rowGap),
  }));
  return { rects, w: Math.max(1, at(colW, colW.length, gap) - gap), h: Math.max(1, at(rowH, rowH.length, rowGap) - rowGap) };
}

// Grid layouts: arrange elements into cells, or place copies of them in a grid / scattered at random
import { mulAll, rotateAt, scaleAt, translate, unionBoxes, type Box, type Mat } from './matrix';

export interface Item { id: string; b: Box }

export type GridFrame = 'base' | 'doc' | 'bounds';
export type GridFit = 'fit' | 'uniform' | 'keep';
export interface ArrangeOpts {
  cols: number;
  frame: GridFrame;
  /** margin inside the frame and space between cells, in % of the frame's shorter side */
  padding: number;
  gap: number;
  fit: GridFit;
}

const center = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const contains = (o: Box, p: { x: number; y: number }) => p.x > o.x && p.x < o.x + o.w && p.y > o.y && p.y < o.y + o.h;

/** The largest item that encloses the centers of all others – a background like an icon's rounded square */
export function findBase(items: Item[]): Item | null {
  if (items.length < 3) return null;
  const big = items.reduce((a, b) => (b.b.w * b.b.h > a.b.w * a.b.h ? b : a));
  return items.every((it) => it === big || contains(big.b, center(it.b))) ? big : null;
}

/**
 * Which cell each item goes to: the one closest to where it already is (positions normalized to the
 * items' bounds and to the grid), so a rough arrangement turns into the matching tidy one
 */
function assignCells(items: Item[], cols: number, rows: number): Item[] {
  const U = unionBoxes(items.map((it) => it.b))!;
  const nx = (v: number) => (U.w ? (v - U.x) / U.w : 0.5), ny = (v: number) => (U.h ? (v - U.y) / U.h : 0.5);
  const cells = items.map((_, i) => ({ x: cols > 1 ? (i % cols) / (cols - 1) : 0.5, y: rows > 1 ? Math.floor(i / cols) / (rows - 1) : 0.5 }));
  const pairs = items.flatMap((it, a) => {
    const p = center(it.b);
    return cells.map((c, k) => ({ a, k, d: Math.hypot(nx(p.x) - c.x, ny(p.y) - c.y) }));
  }).sort((p, q) => p.d - q.d);
  const out: Item[] = new Array(items.length);
  const used = new Set<number>();
  for (const { a, k } of pairs) {
    if (used.has(a) || out[k]) continue;
    out[k] = items[a];
    used.add(a);
  }
  return out;
}

export const autoCols = (n: number) => Math.max(1, Math.ceil(Math.sqrt(n)));

/** Matrices that move (and scale) each item into its own cell, centered */
export function arrangeLayout(all: Item[], doc: Box, o: ArrangeOpts): { id: string; m: Mat }[] {
  const base = o.frame === 'base' ? findBase(all) : null;
  const rest = all.filter((it) => it !== base);
  if (!rest.length) return [];
  const F = base ? base.b : o.frame === 'doc' ? doc : unionBoxes(rest.map((it) => it.b))!;
  const unit = Math.min(F.w, F.h) / 100;
  const pad = o.padding * unit, gap = o.gap * unit;
  const cols = Math.max(1, Math.min(rest.length, Math.round(o.cols)));
  const rows = Math.ceil(rest.length / cols);
  const items = assignCells(rest, cols, rows);
  const cw = Math.max(1e-6, (F.w - 2 * pad - gap * (cols - 1)) / cols);
  const ch = Math.max(1e-6, (F.h - 2 * pad - gap * (rows - 1)) / rows);
  const fitK = (b: Box) => Math.min(b.w ? cw / b.w : Infinity, b.h ? ch / b.h : Infinity);
  const uniform = Math.min(...items.map((it) => fitK(it.b)));
  return items.map((it, i) => {
    const r = Math.floor(i / cols);
    // an incomplete last row is centered
    const inRow = r === rows - 1 ? items.length - r * cols : cols;
    const c = i % cols + (cols - inRow) / 2;
    const cx = F.x + pad + c * (cw + gap) + cw / 2, cy = F.y + pad + r * (ch + gap) + ch / 2;
    const k = o.fit === 'keep' ? 1 : o.fit === 'uniform' ? uniform : fitK(it.b);
    const p = center(it.b);
    return { id: it.id, m: mulAll(translate(cx, cy), scaleAt(isFinite(k) ? k : 1, isFinite(k) ? k : 1), translate(-p.x, -p.y)) };
  });
}

export interface CopyGridOpts { cols: number; rows: number; gapX: number; gapY: number }

/** One matrix per copy, the first (identity) is the original */
export function copyGrid(U: Box, o: CopyGridOpts): Mat[] {
  const out: Mat[] = [];
  for (let r = 0; r < Math.max(1, o.rows); r++) {
    for (let c = 0; c < Math.max(1, o.cols); c++) out.push(translate(c * (U.w + o.gapX), r * (U.h + o.gapY)));
  }
  return out;
}

export interface ScatterOpts {
  count: number;
  /** maximum rotation either way, degrees */
  rotate: number;
  /** scale range in % */
  scaleMin: number;
  scaleMax: number;
  avoidOverlap: boolean;
  seed: number;
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random positions inside the frame, the original included; overlap is avoided by treating copies as circles */
export function scatter(U: Box, F: Box, o: ScatterOpts): Mat[] {
  const rand = rng(o.seed);
  const p = center(U), diag = Math.hypot(U.w, U.h) / 2;
  const lo = Math.min(o.scaleMin, o.scaleMax) / 100, hi = Math.max(o.scaleMin, o.scaleMax) / 100;
  const placed: { x: number; y: number; r: number }[] = [];
  const out: Mat[] = [];
  for (let i = 0; i < Math.max(1, o.count); i++) {
    const k = lo + rand() * (hi - lo);
    const rot = (rand() * 2 - 1) * o.rotate;
    const r = diag * k;
    let best = { x: 0, y: 0 }, bestDist = -Infinity;
    // try a few spots, keep the one furthest from the others
    for (let t = 0; t < (o.avoidOverlap ? 60 : 1); t++) {
      const x = F.x + Math.min(r, F.w / 2) + rand() * Math.max(0, F.w - 2 * r);
      const y = F.y + Math.min(r, F.h / 2) + rand() * Math.max(0, F.h - 2 * r);
      const d = Math.min(Infinity, ...placed.map((q) => Math.hypot(q.x - x, q.y - y) - q.r - r));
      if (d > bestDist) { best = { x, y }; bestDist = d; }
      if (d >= 0) break;
    }
    placed.push({ ...best, r });
    out.push(mulAll(translate(best.x, best.y), rotateAt(rot), scaleAt(k, k), translate(-p.x, -p.y)));
  }
  return out;
}

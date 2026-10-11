import { fmt, type Box, type Pt } from './matrix';
import { toEditable, parsePath, serializePath, type Seg, type P2 } from './path';

export type ShapeKind = 'rect' | 'square' | 'circle' | 'ellipse' | 'triangle' | 'polygon' | 'star' | 'arrow' | 'line' | 'cross' | 'heart';

export interface ShapeOpts { starPoints: number; starInner: number; polySides: number; prec: number }
export interface ShapeSpec { tag: string; attrs: Record<string, string> }

export const SHAPE_LABELS: Record<ShapeKind, string> = {
  rect: 'Rechteck', square: 'Quadrat', circle: 'Kreis', ellipse: 'Ellipse', triangle: 'Dreieck', polygon: 'Polygon',
  star: 'Stern', arrow: 'Pfeil', line: 'Linie', cross: 'Kreuz', heart: 'Herz',
};

/** Shapes that keep a 1:1 aspect ratio while drawing */
export const SQUARE_SHAPES = new Set<ShapeKind>(['square', 'circle']);

/** Map unit-space points to fill the box exactly */
function fit(pts: P2[], b: Box): P2[] {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  return pts.map(([x, y]) => [b.x + ((x - x0) / (x1 - x0 || 1)) * b.w, b.y + ((y - y0) / (y1 - y0 || 1)) * b.h]);
}

function radial(n: number, radii: number[]): P2[] {
  const pts: P2[] = [];
  const total = n * radii.length;
  for (let i = 0; i < total; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / total;
    const r = radii[i % radii.length];
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return pts;
}

export function shapeSpec(kind: ShapeKind, b: Box, o: ShapeOpts, line?: { a: Pt; b: Pt }): ShapeSpec {
  const f = (n: number) => fmt(n, o.prec);
  const pts = (p: P2[]) => p.map(([x, y]) => `${f(x)} ${f(y)}`).join(' ');
  switch (kind) {
    case 'rect': case 'square':
      return { tag: 'rect', attrs: { x: f(b.x), y: f(b.y), width: f(b.w), height: f(b.h) } };
    case 'circle': case 'ellipse':
      if (Math.abs(b.w - b.h) < 1e-9) return { tag: 'circle', attrs: { cx: f(b.x + b.w / 2), cy: f(b.y + b.h / 2), r: f(b.w / 2) } };
      return { tag: 'ellipse', attrs: { cx: f(b.x + b.w / 2), cy: f(b.y + b.h / 2), rx: f(b.w / 2), ry: f(b.h / 2) } };
    case 'line': {
      const l = line ?? { a: { x: b.x, y: b.y + b.h / 2 }, b: { x: b.x + b.w, y: b.y + b.h / 2 } };
      return { tag: 'line', attrs: { x1: f(l.a.x), y1: f(l.a.y), x2: f(l.b.x), y2: f(l.b.y) } };
    }
    case 'triangle':
      return { tag: 'polygon', attrs: { points: pts(fit([[0.5, 0], [1, 1], [0, 1]], b)) } };
    case 'polygon':
      return { tag: 'polygon', attrs: { points: pts(fit(radial(Math.max(3, Math.round(o.polySides)), [1]), b)) } };
    case 'star':
      return { tag: 'polygon', attrs: { points: pts(fit(radial(Math.max(3, Math.round(o.starPoints)), [1, Math.min(0.95, Math.max(0.05, o.starInner))]), b)) } };
    case 'cross': {
      const t = 1 / 3;
      return { tag: 'polygon', attrs: { points: pts(fit([[t, 0], [1 - t, 0], [1 - t, t], [1, t], [1, 1 - t], [1 - t, 1 - t], [1 - t, 1], [t, 1], [t, 1 - t], [0, 1 - t], [0, t], [t, t]], b)) } };
    }
    case 'arrow': {
      const hl = Math.min(b.w * 0.5, b.h); // head length
      const sx = b.x + b.w - hl;
      return {
        tag: 'polygon',
        attrs: { points: pts([[b.x, b.y + b.h * 0.3], [sx, b.y + b.h * 0.3], [sx, b.y], [b.x + b.w, b.y + b.h / 2], [sx, b.y + b.h], [sx, b.y + b.h * 0.7], [b.x, b.y + b.h * 0.7]]) },
      };
    }
    case 'heart': {
      // unit heart in a 1×1 box
      const X = (u: number) => f(b.x + u * b.w), Y = (v: number) => f(b.y + v * b.h);
      const d = `M${X(0.5)} ${Y(1)}C${X(0.5)} ${Y(1)} ${X(0)} ${Y(0.62)} ${X(0)} ${Y(0.3)}C${X(0)} ${Y(0.12)} ${X(0.13)} ${Y(0)} ${X(0.28)} ${Y(0)}C${X(0.4)} ${Y(0)} ${X(0.47)} ${Y(0.07)} ${X(0.5)} ${Y(0.15)}C${X(0.53)} ${Y(0.07)} ${X(0.6)} ${Y(0)} ${X(0.72)} ${Y(0)}C${X(0.87)} ${Y(0)} ${X(1)} ${Y(0.12)} ${X(1)} ${Y(0.3)}C${X(1)} ${Y(0.62)} ${X(0.5)} ${Y(1)} ${X(0.5)} ${Y(1)}Z`;
      return { tag: 'path', attrs: { d } };
    }
  }
}

// ---------- corner rounding ----------
const sub = (a: P2, b: P2): P2 => [a[0] - b[0], a[1] - b[1]];
const len = (a: P2) => Math.hypot(a[0], a[1]);
const eq = (a: P2, b: P2) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;

interface S { c: string; v: number[]; from: P2; to: P2 }

/**
 * Round every corner where two straight segments meet with an arc of the given radius.
 * The radius is clamped so neighbouring roundings never overlap (max. half of each segment).
 */
export function roundCorners(d: string, radius: number, prec = 3): string {
  const segs = toEditable(parsePath(d));
  const out: Seg[] = [];
  // split into subpaths
  const subs: { segs: S[]; closed: boolean }[] = [];
  let cur: { segs: S[]; closed: boolean } | null = null;
  let pos: P2 = [0, 0], start: P2 = [0, 0];
  for (const s of segs) {
    if (s.c === 'M') { start = pos = [s.v[0], s.v[1]]; cur = { segs: [], closed: false }; subs.push(cur); continue; }
    if (!cur) { cur = { segs: [], closed: false }; subs.push(cur); start = pos; }
    if (s.c === 'Z') {
      if (!eq(pos, start)) cur.segs.push({ c: 'L', v: [...start], from: pos, to: start });
      cur.closed = true; pos = start; cur = null; continue;
    }
    const to: P2 = [s.v[s.v.length - 2], s.v[s.v.length - 1]];
    if (s.c === 'L' && eq(pos, to)) continue;
    cur.segs.push({ c: s.c, v: s.v.slice(), from: pos, to });
    pos = to;
  }

  for (const sp of subs) {
    const n = sp.segs.length;
    if (!n) continue;
    // fillet at the END of segment i (between i and i+1)
    const fil: ({ p1: P2; p2: P2; r: number; sweep: number } | null)[] = sp.segs.map(() => null);
    for (let i = 0; i < n; i++) {
      const j = i + 1 < n ? i + 1 : sp.closed ? 0 : -1;
      if (j < 0) continue;
      const a = sp.segs[i], b = sp.segs[j];
      if (a.c !== 'L' || b.c !== 'L') continue;
      const V = a.to;
      const u1 = sub(a.from, V), u2 = sub(b.to, V);
      const l1 = len(u1), l2 = len(u2);
      if (l1 < 1e-9 || l2 < 1e-9) continue;
      const cos = (u1[0] * u2[0] + u1[1] * u2[1]) / (l1 * l2);
      const theta = Math.acos(Math.max(-1, Math.min(1, cos)));
      if (theta < 1e-3 || Math.PI - theta < 1e-3) continue;
      let t = radius / Math.tan(theta / 2);
      t = Math.min(t, l1 / 2, l2 / 2);
      const r = t * Math.tan(theta / 2);
      const p1: P2 = [V[0] + (u1[0] / l1) * t, V[1] + (u1[1] / l1) * t];
      const p2: P2 = [V[0] + (u2[0] / l2) * t, V[1] + (u2[1] / l2) * t];
      const cr = (V[0] - a.from[0]) * (b.to[1] - V[1]) - (V[1] - a.from[1]) * (b.to[0] - V[0]);
      fil[i] = { p1, p2, r, sweep: cr > 0 ? 1 : 0 };
    }
    const prevFil = (i: number) => (i > 0 ? fil[i - 1] : sp.closed ? fil[n - 1] : null);
    const first = sp.segs[0];
    const f0 = prevFil(0);
    const mIdx = out.length;
    out.push({ c: 'M', v: f0 ? [...f0.p2] : [...first.from] });
    sp.segs.forEach((s, i) => {
      const fe = fil[i];
      if (s.c === 'L') {
        const to = fe ? fe.p1 : s.to;
        const prev = out[out.length - 1].v;
        if (!eq([prev[prev.length - 2], prev[prev.length - 1]], to)) out.push({ c: 'L', v: [...to] });
      }
      else out.push({ c: s.c, v: s.v });
      if (fe) out.push({ c: 'A', v: [fe.r, fe.r, 0, 0, fe.sweep, fe.p2[0], fe.p2[1]] });
    });
    if (sp.closed) {
      // the last explicit point equals the M point → let Z close it
      const last = out[out.length - 1];
      const m = out[mIdx].v;
      if (last.c === 'L' && eq([last.v[0], last.v[1]], [m[0], m[1]])) out.pop();
      out.push({ c: 'Z', v: [] });
    }
  }
  return serializePath(out, prec);
}

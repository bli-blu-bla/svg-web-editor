// Node model for path editing: anchors with optional in/out handles (cubic Bézier control points)
import { fmt } from './matrix';
import { parsePath, toCurves } from './path';

export interface P { x: number; y: number }
export interface PNode { x: number; y: number; hin: P | null; hout: P | null }
export interface SubPath { nodes: PNode[]; closed: boolean }
export interface NodeRef { s: number; j: number }
export type NodeKind = 'corner' | 'smooth' | 'symmetric';

const EPS = 1e-6;
const same = (a: P, b: P) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS;
const len = (a: P, b: P) => Math.hypot(b.x - a.x, b.y - a.y);
/** a handle sitting on its anchor is no handle */
const handle = (h: P, n: P): P | null => (same(h, n) ? null : h);

export function toNodes(d: string | null): SubPath[] {
  const subs: SubPath[] = [];
  let cur: SubPath | null = null;
  let start: P = { x: 0, y: 0 };
  const last = () => cur!.nodes[cur!.nodes.length - 1];
  for (const s of toCurves(parsePath(d))) {
    const v = s.v;
    if (s.c === 'M') {
      cur = { nodes: [{ x: v[0], y: v[1], hin: null, hout: null }], closed: false };
      subs.push(cur);
      start = { x: v[0], y: v[1] };
      continue;
    }
    if (!cur) { cur = { nodes: [{ ...start, hin: null, hout: null }], closed: false }; subs.push(cur); }
    if (s.c === 'L') cur.nodes.push({ x: v[0], y: v[1], hin: null, hout: null });
    else if (s.c === 'C') {
      const prev = last();
      prev.hout = handle({ x: v[0], y: v[1] }, prev);
      const n = { x: v[4], y: v[5] };
      cur.nodes.push({ ...n, hin: handle({ x: v[2], y: v[3] }, n), hout: null });
    } else if (s.c === 'Z') {
      cur.closed = true;
      const ns = cur.nodes;
      // explicit segment back onto the start point → merge the duplicate end node into the first
      if (ns.length > 1 && same(ns[ns.length - 1], ns[0])) {
        ns[0].hin = ns[ns.length - 1].hin;
        ns.pop();
      }
      cur = null;
    }
  }
  return subs;
}

export function fromNodes(subs: SubPath[], prec = 3): string {
  const f = (n: number) => fmt(n, prec);
  const pt = (p: P) => `${f(p.x)} ${f(p.y)}`;
  let out = '';
  const seg = (a: PNode, b: PNode) =>
    a.hout || b.hin ? `C${pt(a.hout ?? a)} ${pt(b.hin ?? b)} ${pt(b)}` : `L${pt(b)}`;
  for (const sp of subs) {
    const ns = sp.nodes;
    if (!ns.length) continue;
    out += `M${pt(ns[0])}`;
    for (let j = 1; j < ns.length; j++) out += seg(ns[j - 1], ns[j]);
    if (sp.closed) {
      const a = ns[ns.length - 1], b = ns[0];
      // a straight closing segment is drawn by Z alone
      if (ns.length > 1 && (a.hout || b.hin)) out += seg(a, b);
      out += 'Z';
    }
  }
  return out;
}

export const cloneSubs = (subs: SubPath[]): SubPath[] =>
  subs.map((s) => ({ closed: s.closed, nodes: s.nodes.map((n) => ({ x: n.x, y: n.y, hin: n.hin && { ...n.hin }, hout: n.hout && { ...n.hout } })) }));

/** Neighbour anchors of a node (wrapping around for closed subpaths) */
export function neighbours(sp: SubPath, j: number): { prev: PNode | null; next: PNode | null } {
  const n = sp.nodes.length;
  const prev = j > 0 ? sp.nodes[j - 1] : sp.closed && n > 1 ? sp.nodes[n - 1] : null;
  const next = j < n - 1 ? sp.nodes[j + 1] : sp.closed && n > 1 ? sp.nodes[0] : null;
  return { prev, next };
}

/** Derived from the geometry: both handles opposite → smooth, plus equal length → symmetric */
export function nodeKind(n: PNode): NodeKind {
  if (!n.hin || !n.hout) return 'corner';
  const ax = n.x - n.hin.x, ay = n.y - n.hin.y, bx = n.hout.x - n.x, by = n.hout.y - n.y;
  const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
  const cross = (ax * by - ay * bx) / (la * lb);
  const dot = ax * bx + ay * by;
  if (Math.abs(cross) > 0.02 || dot <= 0) return 'corner';
  return Math.abs(la - lb) < 1e-3 * Math.max(la, lb, 1) ? 'symmetric' : 'smooth';
}

export function setNodeKind(subs: SubPath[], ref: NodeRef, kind: NodeKind) {
  const sp = subs[ref.s];
  const n = sp?.nodes[ref.j];
  if (!n) return;
  if (kind === 'corner') { n.hin = null; n.hout = null; return; }
  const { prev, next } = neighbours(sp, ref.j);
  if (!prev && !next) return;
  // direction of the tangent through the anchor
  let dx: number, dy: number;
  if (n.hin && n.hout) { dx = n.hout.x - n.hin.x; dy = n.hout.y - n.hin.y; }
  else if (prev && next) { dx = next.x - prev.x; dy = next.y - prev.y; }
  else if (next) { dx = (n.hout ?? next).x - n.x; dy = (n.hout ?? next).y - n.y; }
  else { dx = n.x - (n.hin ?? prev!).x; dy = n.y - (n.hin ?? prev!).y; }
  const l = Math.hypot(dx, dy) || 1;
  dx /= l; dy /= l;
  let lin = prev ? (n.hin ? len(n, n.hin) : len(n, prev) / 3) : 0;
  let lout = next ? (n.hout ? len(n, n.hout) : len(n, next) / 3) : 0;
  if (kind === 'symmetric' && prev && next) lin = lout = (lin + lout) / 2;
  n.hin = prev ? { x: n.x - dx * lin, y: n.y - dy * lin } : null;
  n.hout = next ? { x: n.x + dx * lout, y: n.y + dy * lout } : null;
}

export function deleteNode(subs: SubPath[], ref: NodeRef) {
  const sp = subs[ref.s];
  if (!sp) return;
  sp.nodes.splice(ref.j, 1);
  if (sp.nodes.length < 2) subs.splice(ref.s, 1);
}

/** Closest point on any segment: returns where to split (segment after node j, parameter t) */
export function nearestOnPath(subs: SubPath[], p: P): { s: number; j: number; t: number; dist: number } | null {
  let best: { s: number; j: number; t: number; dist: number } | null = null;
  subs.forEach((sp, s) => {
    const n = sp.nodes.length;
    const count = sp.closed ? n : n - 1;
    for (let j = 0; j < count; j++) {
      const a = sp.nodes[j], b = sp.nodes[(j + 1) % n];
      for (let k = 0; k <= 64; k++) {
        const q = pointAt(a, b, k / 64);
        const dd = Math.hypot(q.x - p.x, q.y - p.y);
        if (!best || dd < best.dist) best = { s, j, t: k / 64, dist: dd };
      }
    }
  });
  return best;
}

function pointAt(a: PNode, b: PNode, t: number): P {
  const p1 = a.hout ?? a, p2 = b.hin ?? b, mt = 1 - t;
  return {
    x: mt * mt * mt * a.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * b.x,
    y: mt * mt * mt * a.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * b.y,
  };
}

/** Insert a node on the segment after node j at parameter t (shape stays identical) */
export function insertNode(subs: SubPath[], s: number, j: number, t: number): NodeRef {
  const sp = subs[s];
  const n = sp.nodes.length;
  const a = sp.nodes[j], b = sp.nodes[(j + 1) % n];
  const lerp = (p: P, q: P): P => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
  let node: PNode;
  if (!a.hout && !b.hin) {
    node = { ...lerp(a, b), hin: null, hout: null };
  } else {
    const p1 = a.hout ?? { x: a.x, y: a.y }, p2 = b.hin ?? { x: b.x, y: b.y };
    const q0 = lerp(a, p1), q1 = lerp(p1, p2), q2 = lerp(p2, b);
    const r0 = lerp(q0, q1), r1 = lerp(q1, q2);
    const m = lerp(r0, r1);
    a.hout = handle(q0, a);
    b.hin = handle(q2, b);
    node = { ...m, hin: handle(r0, m), hout: handle(r1, m) };
  }
  sp.nodes.splice(j + 1, 0, node);
  return { s, j: j + 1 };
}

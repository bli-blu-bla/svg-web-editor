import ClipperLib from 'clipper-lib';
import { fmt } from './matrix';
import { flatten, parsePath, polyArea, serializePath, toCurves, type P2, type Seg } from './path';

export type JoinKind = 'miter' | 'round' | 'bevel';
export type CapKind = 'butt' | 'round' | 'square';

const EPS = 1e-7;
const sub = (a: P2, b: P2): P2 => [a[0] - b[0], a[1] - b[1]];
const add = (a: P2, b: P2): P2 => [a[0] + b[0], a[1] + b[1]];
const mulS = (a: P2, s: number): P2 => [a[0] * s, a[1] * s];
const len = (a: P2) => Math.hypot(a[0], a[1]);
const cross = (a: P2, b: P2) => a[0] * b[1] - a[1] * b[0];
const dist = (a: P2, b: P2) => len(sub(a, b));
const normal = (t: P2): P2 => { const l = len(t) || 1; return [t[1] / l, -t[0] / l]; };

interface OSeg { type: 'L' | 'C'; p: P2[] }
interface Sub { segs: OSeg[]; closed: boolean }

function buildSubs(curves: Seg[]): Sub[] {
  const subs: Sub[] = [];
  let sub_: Sub | null = null;
  let cur: P2 = [0, 0], start: P2 = [0, 0];
  const ensure = () => { if (!sub_) { sub_ = { segs: [], closed: false }; subs.push(sub_); start = cur; } return sub_; };
  for (const s of curves) {
    const v = s.v;
    if (s.c === 'M') { sub_ = { segs: [], closed: false }; subs.push(sub_); cur = start = [v[0], v[1]]; }
    else if (s.c === 'L') {
      const p: P2 = [v[0], v[1]];
      const sb = ensure();
      if (dist(cur, p) > EPS) sb.segs.push({ type: 'L', p: [cur, p] });
      cur = p;
    } else if (s.c === 'C') {
      const pts: P2[] = [cur, [v[0], v[1]], [v[2], v[3]], [v[4], v[5]]];
      const sb = ensure();
      if (pts.some((q) => dist(q, cur) > EPS)) sb.segs.push({ type: 'C', p: pts });
      cur = pts[3];
    } else if (s.c === 'Z') {
      const sb = ensure();
      if (dist(cur, start) > EPS) sb.segs.push({ type: 'L', p: [cur, start] });
      sb.closed = true; cur = start; sub_ = null;
    }
  }
  return subs.filter((s) => s.segs.length);
}

function startTan(s: OSeg): P2 {
  const p = s.p;
  for (let i = 1; i < p.length; i++) { const t = sub(p[i], p[0]); if (len(t) > EPS) return t; }
  return [1, 0];
}
function endTan(s: OSeg): P2 {
  const p = s.p, n = p.length - 1;
  for (let i = n - 1; i >= 0; i--) { const t = sub(p[n], p[i]); if (len(t) > EPS) return t; }
  return [1, 0];
}

function splitCubic(p: P2[], t: number): [P2[], P2[]] {
  const lerp = (a: P2, b: P2): P2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const a = lerp(p[0], p[1]), b = lerp(p[1], p[2]), c = lerp(p[2], p[3]);
  const d = lerp(a, b), e = lerp(b, c), f = lerp(d, e);
  return [[p[0], a, d, f], [f, e, c, p[3]]];
}

function turning(p: P2[]): number {
  const edges = [sub(p[1], p[0]), sub(p[2], p[1]), sub(p[3], p[2])].filter((e) => len(e) > EPS);
  let t = 0;
  for (let i = 1; i < edges.length; i++) {
    const a = edges[i - 1], b = edges[i];
    t += Math.abs(Math.atan2(cross(a, b), a[0] * b[0] + a[1] * b[1]));
  }
  return t;
}

function subdivide(p: P2[]): P2[][] {
  const n = Math.max(1, Math.min(16, Math.ceil(turning(p) / (Math.PI / 4))));
  const out: P2[][] = [];
  let rest = p;
  for (let i = n; i > 1; i--) {
    const [l, r] = splitCubic(rest, 1 / i);
    out.push(l); rest = r;
  }
  out.push(rest);
  return out;
}

/** Offset one cubic piece by scaling the handles with the local curvature (exact for circular arcs) */
function offsetCubic(p: P2[], d: number): P2[] {
  const seg: OSeg = { type: 'C', p };
  const n0 = normal(startTan(seg)), n1 = normal(endTan(seg));
  const q0 = add(p[0], mulS(n0, d)), q3 = add(p[3], mulS(n1, d));
  const h0 = sub(p[1], p[0]), h1 = sub(p[2], p[3]);
  const l0 = len(h0), l1 = len(h1);
  const k0 = l0 > EPS ? Math.max(0, 1 + (d * (2 / 3) * cross(h0, sub(p[2], p[1]))) / (l0 * l0 * l0)) : 1;
  const k1 = l1 > EPS ? Math.max(0, 1 + (d * (2 / 3) * cross(sub(p[2], p[1]), sub(p[3], p[2]))) / (l1 * l1 * l1)) : 1;
  return [q0, add(q0, mulS(h0, k0)), add(q3, mulS(h1, k1)), q3];
}

function lineIntersect(p: P2, r: P2, q: P2, s: P2): { pt: P2; t: number; u: number } | null {
  const den = cross(r, s);
  if (Math.abs(den) < 1e-12) return null;
  const qp = sub(q, p);
  const t = cross(qp, s) / den, u = cross(qp, r) / den;
  return { pt: add(p, mulS(r, t)), t, u };
}

/**
 * Curve-preserving offset (parallel path). Positive distance grows closed shapes outward;
 * for open paths it shifts the line to its left side (relative to drawing direction).
 */
export function curveOffset(d: string, distance: number, join: JoinKind = 'miter', miterLimit = 4, prec = 3): string {
  const curves = toCurves(parsePath(d));
  const subs = buildSubs(curves);
  // Orientation: positive distance must expand the largest closed subpath
  let sign = 1, maxA = 0;
  for (const poly of flatten(curves, 0.5)) {
    if (!poly.closed) continue;
    const a = polyArea(poly.pts);
    if (Math.abs(a) > maxA) { maxA = Math.abs(a); sign = a >= 0 ? 1 : -1; }
  }
  const dd = distance * sign;
  const out: Seg[] = [];

  for (const sp of subs) {
    const orig: OSeg[] = [];
    for (const s of sp.segs) {
      if (s.type === 'L') orig.push(s);
      else for (const piece of subdivide(s.p)) orig.push({ type: 'C', p: piece });
    }
    const off: OSeg[] = orig.map((s) => {
      if (s.type === 'L') {
        const n = normal(sub(s.p[1], s.p[0]));
        return { type: 'L', p: [add(s.p[0], mulS(n, dd)), add(s.p[1], mulS(n, dd))] };
      }
      return { type: 'C', p: offsetCubic(s.p, dd) };
    });

    const connectors: Seg[][] = off.map(() => []);
    const count = sp.closed ? off.length : off.length - 1;
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % off.length;
      const a = off[i], b = off[j];
      const ea = a.p[a.p.length - 1], sb = b.p[0];
      if (dist(ea, sb) < 1e-6) continue;
      const ta = endTan(orig[i]), tb = startTan(orig[j]);
      const V = orig[i].p[orig[i].p.length - 1];
      const cr = cross(ta, tb);
      const outer = cr * dd > 0;
      if (!outer) {
        if (a.type === 'L' && b.type === 'L') {
          const x = lineIntersect(a.p[0], sub(a.p[1], a.p[0]), b.p[0], sub(b.p[1], b.p[0]));
          if (x && x.t >= 0 && x.t <= 1 && x.u >= 0 && x.u <= 1) {
            a.p[1] = x.pt; b.p[0] = x.pt;
            continue;
          }
        }
        connectors[i].push({ c: 'L', v: [...sb] });
        continue;
      }
      if (join === 'round') {
        const r = Math.abs(dd);
        connectors[i].push({ c: 'A', v: [r, r, 0, 0, cr > 0 ? 1 : 0, sb[0], sb[1]] });
      } else if (join === 'miter') {
        const x = lineIntersect(ea, ta, sb, tb);
        if (x && dist(x.pt, V) <= miterLimit * Math.abs(dd)) {
          if (a.type === 'L' && b.type === 'L') { a.p[1] = x.pt; b.p[0] = x.pt; continue; }
          connectors[i].push({ c: 'L', v: [...x.pt] });
        }
        connectors[i].push({ c: 'L', v: [...sb] });
      } else {
        connectors[i].push({ c: 'L', v: [...sb] });
      }
    }

    out.push({ c: 'M', v: [...off[0].p[0]] });
    off.forEach((s, i) => {
      const closingLine = sp.closed && i === off.length - 1 && s.type === 'L' && !connectors[i].length && dist(s.p[1], off[0].p[0]) < 1e-9;
      if (closingLine) return; // Z draws it
      if (s.type === 'L') out.push({ c: 'L', v: [...s.p[1]] });
      else out.push({ c: 'C', v: [...s.p[1], ...s.p[2], ...s.p[3]] });
      const last = sp.closed && i === off.length - 1;
      // the closing connector ends exactly at the start point → Z handles the last straight line
      const con = connectors[i];
      if (last && con.length && con[con.length - 1].c === 'L') out.push(...con.slice(0, -1));
      else out.push(...con);
    });
    if (sp.closed) out.push({ c: 'Z', v: [] });
  }
  return serializePath(out, prec);
}

// ---------- Clipper (robust polygon) based operations ----------
const SCALE = 1000;
type CPath = { X: number; Y: number }[];

function toClipper(pts: P2[]): CPath {
  return pts.map(([x, y]) => ({ X: Math.round(x * SCALE), Y: Math.round(y * SCALE) }));
}

function clipperToD(paths: CPath[], prec: number): string {
  return paths
    .filter((p) => p.length > 2)
    .map((p) => 'M' + p.map((q) => `${fmt(q.X / SCALE, prec)} ${fmt(q.Y / SCALE, prec)}`).join('L') + 'Z')
    .join('');
}

const JT: Record<JoinKind, number> = {
  miter: ClipperLib.JoinType.jtMiter,
  round: ClipperLib.JoinType.jtRound,
  bevel: ClipperLib.JoinType.jtSquare,
};

function union(paths: CPath[], evenOdd: boolean): CPath[] {
  const ft = evenOdd ? ClipperLib.PolyFillType.pftEvenOdd : ClipperLib.PolyFillType.pftNonZero;
  const c = new ClipperLib.Clipper();
  c.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
  const res = new ClipperLib.Paths();
  c.Execute(ClipperLib.ClipType.ctUnion, res, ft, ft);
  return res;
}

/** Convert a stroke into a filled outline */
export function strokeOutline(d: string, width: number, cap: CapKind = 'butt', join: JoinKind = 'miter', miterLimit = 4, prec = 3): string {
  const flat = flatten(toCurves(parsePath(d)), 0.02);
  const co = new ClipperLib.ClipperOffset(miterLimit, 0.02 * SCALE);
  const closed = flat.filter((p) => p.closed).map((p) => toClipper(p.pts));
  const open = flat.filter((p) => !p.closed).map((p) => toClipper(p.pts));
  const et = cap === 'round' ? ClipperLib.EndType.etOpenRound : cap === 'square' ? ClipperLib.EndType.etOpenSquare : ClipperLib.EndType.etOpenButt;
  if (closed.length) co.AddPaths(closed, JT[join], ClipperLib.EndType.etClosedLine);
  if (open.length) co.AddPaths(open, JT[join], et);
  const sol = new ClipperLib.Paths();
  co.Execute(sol, (width / 2) * SCALE);
  const u = union(sol, false);
  return clipperToD(ClipperLib.Clipper.CleanPolygons(u, 0.01 * SCALE), prec);
}

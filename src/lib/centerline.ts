// Centerline (medial axis) of an area: Voronoi vertices of a dense boundary sampling,
// connected along the triangles inside the shape, with short side branches pruned away.
import Delaunator from 'delaunator';
import type { P2 } from './path';

/** Fitted piece of a centerline; arcs run from a to b around c, dir 1 = increasing angle (SVG sweep-flag 1) */
export type Prim =
  | { kind: 'L'; a: P2; b: P2 }
  | { kind: 'A'; a: P2; b: P2; c: P2; r: number; dir: 1 | -1 };

export interface CenterLine { prims: Prim[]; closed: boolean }

export interface Centerline {
  lines: CenterLine[];
  /** Typical distance from the centerline to the outline (half the stroke width) */
  radius: number;
}

export interface CenterlineOpts {
  /** Side branches shorter than prune·(radius at their junction) are removed */
  prune?: number;
  /** Extend free ends along their direction up to the outline */
  extend?: boolean;
}

/** Arc length / chord ratio above which two outline samples face each other across the shape */
const GEO_RATIO = 1.25;
const dist = (a: P2, b: P2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Even-odd point-in-polygon over all contours (holes included) */
function inside(contours: P2[][], x: number, y: number): boolean {
  let c = false;
  for (const poly of contours) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
  }
  return c;
}

/** Distance along the ray o + t·dir (dir normalized) to the first contour crossing */
function rayHit(contours: P2[][], o: P2, dir: P2): number {
  let best = Infinity;
  for (const poly of contours) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[j], b = poly[i];
      const ex = b[0] - a[0], ey = b[1] - a[1];
      const den = dir[0] * ey - dir[1] * ex;
      if (Math.abs(den) < 1e-12) continue;
      const wx = a[0] - o[0], wy = a[1] - o[1];
      const t = (wx * ey - wy * ex) / den;
      const u = (wx * dir[1] - wy * dir[0]) / den;
      if (t > 1e-9 && u >= 0 && u <= 1 && t < best) best = t;
    }
  }
  return best;
}

/** Moving average that keeps the end points (and wraps around for closed lines) */
function smooth(pts: P2[], closed: boolean, passes = 2): P2[] {
  let r = pts;
  const n = closed ? pts.length - 1 : pts.length;
  for (let k = 0; k < passes; k++) {
    const src = r;
    r = src.map((p, i) => {
      if (closed) {
        if (i === n) return p;
        const a = src[(i - 1 + n) % n], b = src[(i + 1) % n];
        return [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4];
      }
      if (i === 0 || i === n - 1) return p;
      const a = src[i - 1], b = src[i + 1];
      return [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4];
    });
    if (closed) r[n] = r[0];
  }
  return r;
}

/** err: largest deviation, sse: sum of squared deviations */
interface LineFit { kind: 'L'; m: P2; d: P2; err: number; sse: number }
interface ArcFit { kind: 'A'; c: P2; r: number; dir: 1 | -1; err: number; sse: number }
type Fit = LineFit | ArcFit;

/** Total least squares line through pts[i..j] */
function fitLine(pts: P2[], i: number, j: number): LineFit {
  const n = j - i + 1;
  let mx = 0, my = 0;
  for (let k = i; k <= j; k++) { mx += pts[k][0]; my += pts[k][1]; }
  mx /= n; my /= n;
  let sxx = 0, sxy = 0, syy = 0;
  for (let k = i; k <= j; k++) { const x = pts[k][0] - mx, y = pts[k][1] - my; sxx += x * x; sxy += x * y; syy += y * y; }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const d: P2 = [Math.cos(th), Math.sin(th)];
  let err = 0, sse = 0;
  for (let k = i; k <= j; k++) {
    const e = Math.abs((pts[k][0] - mx) * d[1] - (pts[k][1] - my) * d[0]);
    err = Math.max(err, e); sse += e * e;
  }
  return { kind: 'L', m: [mx, my], d, err, sse };
}

/** Algebraic (Kåsa) circle fit through pts[i..j]; null if the points don't run along it in one direction */
function fitArc(pts: P2[], i: number, j: number, maxR: number): ArcFit | null {
  const n = j - i + 1;
  let mx = 0, my = 0;
  for (let k = i; k <= j; k++) { mx += pts[k][0]; my += pts[k][1]; }
  mx /= n; my /= n;
  let suu = 0, suv = 0, svv = 0, su = 0, sv = 0, suz = 0, svz = 0, sz = 0;
  for (let k = i; k <= j; k++) {
    const u = pts[k][0] - mx, v = pts[k][1] - my, z = u * u + v * v;
    suu += u * u; suv += u * v; svv += v * v; su += u; sv += v; suz += u * z; svz += v * z; sz += z;
  }
  // solve [suu suv su; suv svv sv; su sv n]·[D E F] = -[suz svz sz]
  const A = [[suu, suv, su], [suv, svv, sv], [su, sv, n]], B = [-suz, -svz, -sz];
  const det3 = (M: number[][]) => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  const D0 = det3(A);
  if (Math.abs(D0) < 1e-12) return null;
  const col = (c: number) => det3(A.map((row, r) => row.map((x, k) => (k === c ? B[r] : x)))) / D0;
  const D = col(0), E = col(1), F = col(2);
  const r2 = (D * D + E * E) / 4 - F;
  if (!(r2 > 0)) return null;
  let c: P2 = [mx - D / 2, my - E / 2], r = Math.sqrt(r2);
  // a few Gauss–Newton steps on the geometric distance remove the algebraic fit's bias on short arcs
  for (let it = 0; it < 5 && r < maxR; it++) {
    let a11 = 0, a12 = 0, a13 = 0, a22 = 0, a23 = 0, a33 = 0, b1 = 0, b2 = 0, b3 = 0;
    for (let k = i; k <= j; k++) {
      const dx = c[0] - pts[k][0], dy = c[1] - pts[k][1], l = Math.hypot(dx, dy) || 1e-12;
      const jx = dx / l, jy = dy / l, res = l - r;
      a11 += jx * jx; a12 += jx * jy; a13 -= jx; a22 += jy * jy; a23 -= jy; a33 += 1;
      b1 -= jx * res; b2 -= jy * res; b3 += res;
    }
    const M = [[a11, a12, a13], [a12, a22, a23], [a13, a23, a33]], R = [b1, b2, b3];
    const dM = det3(M);
    if (Math.abs(dM) < 1e-12) break;
    const sol = (cc: number) => det3(M.map((row, rr) => row.map((x, k) => (k === cc ? R[rr] : x)))) / dM;
    const s0 = sol(0), s1 = sol(1), s2 = sol(2);
    c = [c[0] + s0, c[1] + s1]; r += s2;
    if (Math.abs(s0) + Math.abs(s1) + Math.abs(s2) < 1e-9) break;
  }
  if (!(r > 0) || r > maxR) return null;
  let err = 0, sse = 0, span = 0, pos = 0, neg = 0;
  for (let k = i; k <= j; k++) {
    const e = Math.abs(dist(pts[k], c) - r);
    err = Math.max(err, e); sse += e * e;
    if (k > i) {
      const a0 = Math.atan2(pts[k - 1][1] - c[1], pts[k - 1][0] - c[0]);
      let da = Math.atan2(pts[k][1] - c[1], pts[k][0] - c[0]) - a0;
      if (da > Math.PI) da -= 2 * Math.PI; else if (da < -Math.PI) da += 2 * Math.PI;
      span += da;
      if (da > 0) pos += da; else neg -= da;
    }
  }
  // must turn consistently one way and stay clearly below a full circle
  if (Math.min(pos, neg) > 0.05 * Math.max(pos, neg) || Math.abs(span) > 1.8 * Math.PI) return null;
  return { kind: 'A', c, r, dir: span >= 0 ? 1 : -1, err, sse };
}

const projFit = (f: Fit, p: P2): P2 => {
  if (f.kind === 'L') {
    const t = (p[0] - f.m[0]) * f.d[0] + (p[1] - f.m[1]) * f.d[1];
    return [f.m[0] + f.d[0] * t, f.m[1] + f.d[1] * t];
  }
  const l = dist(p, f.c) || 1;
  return [f.c[0] + ((p[0] - f.c[0]) * f.r) / l, f.c[1] + ((p[1] - f.c[1]) * f.r) / l];
};

/** Split a dense polyline greedily into the longest fitting lines and circular arcs */
function fitPrims(pts: P2[], tol: number, maxR: number, fixStart: boolean, fixEnd: boolean): Prim[] {
  const n = pts.length;
  if (n < 2) return [];
  const pieces: { i: number; j: number; f: Fit }[] = [];
  let i = 0;
  while (i < n - 1) {
    let jl = i + 1, fl = fitLine(pts, i, jl);
    // the axis between parallel edges is nearly exact, so lines get a tighter tolerance than arcs;
    // otherwise a line would run on tangentially into the following arc
    while (jl + 1 < n) { const f = fitLine(pts, i, jl + 1); if (f.err > tol / 4) break; jl++; fl = f; }
    let ja = -1, fa: ArcFit | null = null;
    for (let j = i + 3; j < n; j++) {
      const f = fitArc(pts, i, j, maxR);
      if (!f || f.err > tol) { if (j > i + 6) break; continue; }
      ja = j; fa = f;
    }
    if (fa && ja > jl) { pieces.push({ i, j: ja, f: fa }); i = ja; } else { pieces.push({ i, j: jl, f: fl }); i = jl; }
  }
  // greedy pieces overshoot into their successor (an arc runs on into a tangent line within tolerance):
  // move every break to where both neighbours fit best
  const refit = (kind: 'L' | 'A', a: number, b: number): Fit | null => kind === 'L' ? fitLine(pts, a, b) : fitArc(pts, a, b, maxR);
  for (let it = 0; it < 3; it++) {
    let moved = false;
    for (let k = 0; k < pieces.length - 1; k++) {
      const p = pieces[k], q = pieces[k + 1];
      if (p.f.kind === 'L' && q.f.kind === 'L') continue; // corners are exact already
      const w = Math.min(60, Math.floor(Math.min(p.j - p.i, q.j - q.i) / 2));
      let best = p.f.sse + q.f.sse, bk = p.j, bp = p.f, bq = q.f;
      for (let m = Math.max(p.i + 3, p.j - w); m <= Math.min(q.j - 3, p.j + w); m++) {
        if (m === p.j) continue;
        const f1 = refit(p.f.kind, p.i, m), f2 = refit(q.f.kind, m, q.j);
        if (!f1 || !f2 || f1.err > tol || f2.err > tol) continue;
        if (f1.sse + f2.sse < best) { best = f1.sse + f2.sse; bk = m; bp = f1; bq = f2; }
      }
      if (bk !== p.j) { p.j = q.i = bk; p.f = bp; q.f = bq; moved = true; }
    }
    if (!moved) break;
  }
  // break points: corner of two lines, otherwise the mean of both projections
  const bp: P2[] = [];
  for (let k = 0; k <= pieces.length; k++) {
    const prev = pieces[k - 1], next = pieces[k];
    const raw = pts[next ? next.i : prev.j];
    if (!prev) { bp.push(fixStart ? raw : projFit(next.f, raw)); continue; }
    if (!next) { bp.push(fixEnd ? raw : projFit(prev.f, raw)); continue; }
    const f1 = prev.f, f2 = next.f;
    if (f1.kind === 'L' && f2.kind === 'L') {
      const cr = f1.d[0] * f2.d[1] - f1.d[1] * f2.d[0];
      if (Math.abs(cr) > Math.sin((5 * Math.PI) / 180)) {
        const t = ((f2.m[0] - f1.m[0]) * f2.d[1] - (f2.m[1] - f1.m[1]) * f2.d[0]) / cr;
        bp.push([f1.m[0] + f1.d[0] * t, f1.m[1] + f1.d[1] * t]);
        continue;
      }
    }
    const p1 = projFit(f1, raw), p2 = projFit(f2, raw);
    bp.push([(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2]);
  }
  return pieces.map(({ f }, k) => f.kind === 'L'
    ? { kind: 'L', a: bp[k], b: bp[k + 1] }
    : { kind: 'A', a: bp[k], b: bp[k + 1], c: f.c, r: f.r, dir: f.dir });
}

const reversePrims = (ps: Prim[]): Prim[] => ps.slice().reverse().map((p) => p.kind === 'L'
  ? { ...p, a: p.b, b: p.a }
  : { ...p, a: p.b, b: p.a, dir: (-p.dir) as 1 | -1 });

/** Unit tangent at the end of a primitive */
function endTangent(p: Prim): P2 {
  if (p.kind === 'L') { const l = dist(p.a, p.b) || 1; return [(p.b[0] - p.a[0]) / l, (p.b[1] - p.a[1]) / l]; }
  const rx = p.b[0] - p.c[0], ry = p.b[1] - p.c[1], l = Math.hypot(rx, ry) || 1;
  return [(-ry * p.dir) / l, (rx * p.dir) / l];
}

/** Lead the end of the line to T: an arc runs on until its tangent hits T, a line just gets longer */
function finishEnd(ps: Prim[], T: P2) {
  const last = ps[ps.length - 1];
  if (dist(last.b, T) < 1e-9) return;
  if (last.kind === 'A') {
    const q: P2 = [T[0] - last.c[0], T[1] - last.c[1]], D = Math.hypot(q[0], q[1]);
    if (D > last.r) {
      const base = Math.atan2(q[1], q[0]), al = Math.acos(last.r / D);
      const aEnd = Math.atan2(last.b[1] - last.c[1], last.b[0] - last.c[0]);
      let best: { tp: P2; da: number } | null = null;
      for (const s of [1, -1]) {
        const ang = base + s * al;
        const tp: P2 = [last.c[0] + last.r * Math.cos(ang), last.c[1] + last.r * Math.sin(ang)];
        let da = (ang - aEnd) * last.dir;
        while (da > Math.PI) da -= 2 * Math.PI;
        while (da <= -Math.PI) da += 2 * Math.PI;
        // the arc's direction of travel at tp must point at T
        const t: P2 = [-(tp[1] - last.c[1]) * last.dir, (tp[0] - last.c[0]) * last.dir];
        if (t[0] * (T[0] - tp[0]) + t[1] * (T[1] - tp[1]) <= 0) continue;
        if (!best || Math.abs(da) < Math.abs(best.da)) best = { tp, da };
      }
      if (best && best.da < Math.PI / 2 && best.da > -Math.PI / 2) {
        last.b = best.tp;
        if (dist(best.tp, T) > 1e-6) ps.push({ kind: 'L', a: best.tp, b: T });
        return;
      }
    }
  } else {
    // nearly collinear: lengthen the line instead of adding a kink
    const t = endTangent(last), l = dist(last.b, T);
    if (((T[0] - last.b[0]) * t[0] + (T[1] - last.b[1]) * t[1]) / l > Math.cos((3 * Math.PI) / 180)) { last.b = T; return; }
  }
  ps.push({ kind: 'L', a: last.b, b: T });
}

/** Closest point on the outline */
function nearestOnOutline(contours: P2[][], p: P2): P2 {
  let best: P2 = p, bd = Infinity;
  for (const poly of contours) for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i], ex = b[0] - a[0], ey = b[1] - a[1], l2 = ex * ex + ey * ey;
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / l2)) : 0;
    const q: P2 = [a[0] + ex * t, a[1] + ey * t], d = dist(p, q);
    if (d < bd) { bd = d; best = q; }
  }
  return best;
}

export function centerline(contours: P2[][], opts: CenterlineOpts = {}): Centerline {
  const prune = opts.prune ?? 1.5;
  contours = contours.filter((c) => c.length > 2);
  if (!contours.length) return { lines: [], radius: 0 };

  // 1. sample the outline densely (keeping the original corners)
  let perim = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of contours) for (let i = 0; i < c.length; i++) {
    perim += dist(c[i], c[(i + 1) % c.length]);
    minX = Math.min(minX, c[i][0]); maxX = Math.max(maxX, c[i][0]);
    minY = Math.min(minY, c[i][1]); maxY = Math.max(maxY, c[i][1]);
  }
  const diag = Math.hypot(maxX - minX, maxY - minY);
  const h = Math.max(perim / 5000, diag / 4000);
  // per sample: contour index and arc length position, used to filter noise edges below
  const pts: P2[] = [], cid: number[] = [], arc: number[] = [], clen: number[] = [];
  contours.forEach((c, ci) => {
    let s = 0;
    for (let i = 0; i < c.length; i++) {
      const a = c[i], b = c[(i + 1) % c.length], l = dist(a, b);
      const k = Math.max(1, Math.ceil(l / h));
      for (let j = 0; j < k; j++) {
        pts.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]);
        cid.push(ci); arc.push(s + (l * j) / k);
      }
      s += l;
    }
    clen.push(s);
  });
  // drop exact duplicates, Delaunator dislikes them
  const seen = new Set<string>();
  const keep = pts.map((p) => { const key = p[0].toFixed(9) + ',' + p[1].toFixed(9); if (seen.has(key)) return false; seen.add(key); return true; });
  const uniq = pts.filter((_, i) => keep[i]);
  const ucid = cid.filter((_, i) => keep[i]), uarc = arc.filter((_, i) => keep[i]);
  if (uniq.length < 3) return { lines: [], radius: 0 };
  /** Voronoi edges between samples that are neighbors along the outline only trace its curvature, not the axis */
  const significant = (i: number, j: number) => {
    if (ucid[i] !== ucid[j]) return true;
    const L = clen[ucid[i]], g = Math.abs(uarc[i] - uarc[j]);
    return Math.min(g, L - g) > GEO_RATIO * dist(uniq[i], uniq[j]) + h;
  };

  // 2. Delaunay triangulation; nodes = triangles inside the shape, positioned at their circumcenter
  const del = Delaunator.from(uniq);
  const { triangles, halfedges } = del;
  const nT = triangles.length / 3;
  const pos: P2[] = new Array(nT);
  const rad = new Float64Array(nT);
  const isIn = new Uint8Array(nT);
  for (let t = 0; t < nT; t++) {
    const a = uniq[triangles[3 * t]], b = uniq[triangles[3 * t + 1]], c = uniq[triangles[3 * t + 2]];
    const cx = (a[0] + b[0] + c[0]) / 3, cy = (a[1] + b[1] + c[1]) / 3;
    if (!inside(contours, cx, cy)) continue;
    isIn[t] = 1;
    const bx = b[0] - a[0], by = b[1] - a[1], qx = c[0] - a[0], qy = c[1] - a[1];
    const d = 2 * (bx * qy - by * qx);
    let p: P2 = [cx, cy];
    if (Math.abs(d) > 1e-12) {
      const b2 = bx * bx + by * by, c2 = qx * qx + qy * qy;
      const ux = a[0] + (qy * b2 - by * c2) / d, uy = a[1] + (bx * c2 - qx * b2) / d;
      // obtuse/degenerate triangles near the outline may have their circumcenter outside
      if (inside(contours, ux, uy)) p = [ux, uy];
    }
    pos[t] = p;
    rad[t] = Math.min(dist(p, a), dist(p, b), dist(p, c));
  }

  // 3. graph: triangles adjacent across a shared edge
  const adj = new Map<number, Set<number>>();
  for (let e = 0; e < triangles.length; e++) {
    const o = halfedges[e];
    if (o < e) continue;
    const t1 = Math.floor(e / 3), t2 = Math.floor(o / 3);
    if (!isIn[t1] || !isIn[t2]) continue;
    if (!significant(triangles[e], triangles[e % 3 === 2 ? e - 2 : e + 1])) continue;
    if (!adj.has(t1)) adj.set(t1, new Set());
    if (!adj.has(t2)) adj.set(t2, new Set());
    adj.get(t1)!.add(t2);
    adj.get(t2)!.add(t1);
  }
  const unlink = (a: number, b: number) => {
    adj.get(a)?.delete(b); adj.get(b)?.delete(a);
    if (adj.get(a)?.size === 0) adj.delete(a);
    if (adj.get(b)?.size === 0) adj.delete(b);
  };
  const deg = (t: number) => adj.get(t)?.size ?? 0;

  // corners whose branches were pruned away at a node: a bar end then points at their middle
  const tips = new Map<number, P2[]>();

  // 4. prune side branches: leaf → first junction, shorter than prune·radius(junction)
  for (let round = 0; round < 1000; round++) {
    const branches: { nodes: number[]; len: number; junction: number }[] = [];
    for (const [t, nb] of adj) {
      if (nb.size !== 1) continue;
      const nodes = [t];
      let prev = -1, cur = t, len = 0;
      while (true) {
        const next = [...adj.get(cur)!].find((x) => x !== prev);
        if (next === undefined) { cur = -1; break; }
        len += dist(pos[cur], pos[next]);
        prev = cur; cur = next;
        if (deg(cur) !== 2) break;
        nodes.push(cur);
      }
      // a simple path without junction is a finished line
      if (cur < 0 || deg(cur) < 3) continue;
      branches.push({ nodes, len, junction: cur });
    }
    // remove all short branches of a junction at once (both corner branches at the end of a bar),
    // but if every branch is short (a star, e.g. a square) keep the two longest as the line
    const byJunction = new Map<number, typeof branches>();
    for (const b of branches) {
      if (b.len >= prune * rad[b.junction]) continue;
      if (!byJunction.has(b.junction)) byJunction.set(b.junction, []);
      byJunction.get(b.junction)!.push(b);
    }
    let removed = 0;
    for (const [j, short] of byJunction) {
      short.sort((a, b) => a.len - b.len);
      const drop = short.length >= deg(j) ? short.slice(0, deg(j) - 2) : short;
      for (const b of drop) {
        if (!tips.has(j)) tips.set(j, []);
        tips.get(j)!.push(pos[b.nodes[0]]);
        const chain = [...b.nodes, j];
        for (let i = 0; i < chain.length - 1; i++) unlink(chain[i], chain[i + 1]);
        removed++;
      }
    }
    if (!removed) break;
  }

  // 5. walk chains between end points / junctions, and isolated loops
  const visited = new Set<string>();
  const ek = (a: number, b: number) => (a < b ? a + ':' + b : b + ':' + a);
  const chains: { ids: number[]; closed: boolean }[] = [];
  const walk = (start: number, first: number) => {
    const ids = [start];
    let prev = start, cur = first;
    visited.add(ek(start, first));
    while (true) {
      ids.push(cur);
      if (cur === start) return { ids, closed: true };
      if (deg(cur) !== 2) return { ids, closed: false };
      const next = [...adj.get(cur)!].find((x) => x !== prev)!;
      if (visited.has(ek(cur, next))) return { ids, closed: false };
      visited.add(ek(cur, next));
      prev = cur; cur = next;
    }
  };
  for (const [t, nb] of adj) {
    if (nb.size === 2) continue;
    for (const n of nb) if (!visited.has(ek(t, n))) chains.push(walk(t, n));
  }
  for (const [t, nb] of adj) {
    for (const n of nb) if (!visited.has(ek(t, n))) chains.push(walk(t, n));
  }

  // typical radius: length-weighted median along the remaining axis
  const rs: [number, number][] = [];
  for (const c of chains) for (let i = 1; i < c.ids.length; i++) rs.push([rad[c.ids[i]], dist(pos[c.ids[i - 1]], pos[c.ids[i]])]);
  rs.sort((a, b) => a[0] - b[0]);
  const total = rs.reduce((s, r) => s + r[1], 0);
  let acc = 0, radius = rs.length ? rs[rs.length - 1][0] : 0;
  for (const [r, w] of rs) { acc += w; if (acc >= total / 2) { radius = r; break; } }

  // 6. smooth, fit lines and arcs, lead free ends to the outline
  const tol = Math.max(h * 1.5, diag / 1000);
  const lines: CenterLine[] = [];
  for (const c of chains) {
    // fitting cost grows quadratically with the point count; points closer than the tolerance add nothing
    const dense = smooth(c.ids.map((t) => pos[t]), c.closed);
    const line = [dense[0]];
    for (let i = 1; i < dense.length - 1; i++) if (dist(dense[i], line[line.length - 1]) >= tol) line.push(dense[i]);
    line.push(dense[dense.length - 1]);
    const len = line.slice(1).reduce((s, p, i) => s + dist(p, line[i]), 0);
    if (len < h) continue;
    const first = c.ids[0], last = c.ids[c.ids.length - 1];
    const free = (node: number) => !c.closed && deg(node) === 1;
    let prims = fitPrims(line, tol, diag, !free(first), !free(last));
    if (!prims.length) continue;
    if (opts.extend !== false) {
      const target = (node: number, end: Prim): P2 | null => {
        if (!free(node)) return null;
        const t = tips.get(node);
        if (t && t.length >= 2) {
          const mid: P2 = [t.reduce((s, p) => s + p[0], 0) / t.length, t.reduce((s, p) => s + p[1], 0) / t.length];
          const T = nearestOnOutline(contours, mid);
          if (inside(contours, (T[0] + end.b[0]) / 2, (T[1] + end.b[1]) / 2)) return T;
        }
        const d = endTangent(end), r = rad[node];
        const hit = rayHit(contours, end.b, d);
        return hit <= 2 * r + h ? [end.b[0] + d[0] * hit, end.b[1] + d[1] * hit] : null;
      };
      const T1 = target(last, prims[prims.length - 1]);
      if (T1) finishEnd(prims, T1);
      prims = reversePrims(prims);
      const T0 = target(first, prims[prims.length - 1]);
      if (T0) finishEnd(prims, T0);
      prims = reversePrims(prims);
    }
    lines.push({ prims, closed: c.closed });
  }
  return { lines, radius };
}

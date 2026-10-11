import { apply, fmt, isAxisAligned, isSimilarity, det, type Mat } from './matrix';

export interface Seg { c: string; v: number[] }
export type P2 = [number, number];

const PARAMS: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
const NUM = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;

export function parsePath(d: string | null | undefined): Seg[] {
  const segs: Seg[] = [];
  if (!d) return segs;
  let i = 0;
  const n = d.length;
  let cmd: string | null = null;
  const skip = () => { while (i < n && /[\s,]/.test(d[i])) i++; };
  const readNum = (): number | null => {
    skip();
    NUM.lastIndex = i;
    const m = NUM.exec(d);
    if (!m) return null;
    i += m[0].length;
    return parseFloat(m[0]);
  };
  const readFlag = (): number | null => {
    skip();
    const ch = d[i];
    if (ch === '0' || ch === '1') { i++; return +ch; }
    return null;
  };
  while (i < n) {
    skip();
    if (i >= n) break;
    const ch = d[i];
    let explicit = false;
    if (/[a-zA-Z]/.test(ch)) {
      if (!(ch.toLowerCase() in PARAMS)) break;
      cmd = ch; i++; explicit = true;
      if (ch === 'z' || ch === 'Z') { segs.push({ c: ch, v: [] }); continue; }
    } else if (!cmd || cmd === 'z' || cmd === 'Z') break;
    const lc = cmd!.toLowerCase();
    const v: number[] = [];
    for (let k = 0; k < PARAMS[lc]; k++) {
      const x = lc === 'a' && (k === 3 || k === 4) ? readFlag() : readNum();
      if (x === null) return segs;
      v.push(x);
    }
    segs.push({ c: cmd!, v });
    if (cmd === 'm') cmd = 'l'; else if (cmd === 'M') cmd = 'L';
    void explicit;
  }
  return segs;
}

export function serializePath(segs: Seg[], p = 3): string {
  let out = '';
  for (const s of segs) {
    out += s.c;
    out += s.v.map((n, k) => (s.c.toLowerCase() === 'a' && (k === 3 || k === 4) ? String(n ? 1 : 0) : fmt(n, p))).join(' ');
  }
  return out;
}

export function toAbsolute(segs: Seg[]): Seg[] {
  let cx = 0, cy = 0, sx = 0, sy = 0;
  const out: Seg[] = [];
  for (const s of segs) {
    const up = s.c.toUpperCase();
    const rel = s.c !== up;
    const v = s.v.slice();
    if (rel) {
      switch (up) {
        case 'M': case 'L': case 'T': v[0] += cx; v[1] += cy; break;
        case 'H': v[0] += cx; break;
        case 'V': v[0] += cy; break;
        case 'C': for (let k = 0; k < 6; k += 2) { v[k] += cx; v[k + 1] += cy; } break;
        case 'S': case 'Q': for (let k = 0; k < 4; k += 2) { v[k] += cx; v[k + 1] += cy; } break;
        case 'A': v[5] += cx; v[6] += cy; break;
      }
    }
    switch (up) {
      case 'M': cx = sx = v[0]; cy = sy = v[1]; break;
      case 'H': cx = v[0]; break;
      case 'V': cy = v[0]; break;
      case 'Z': cx = sx; cy = sy; break;
      default: cx = v[v.length - 2]; cy = v[v.length - 1];
    }
    out.push({ c: up, v });
  }
  return out;
}

/** Absolute, H/V converted to L — the representation used for node editing */
export function toEditable(segs: Seg[]): Seg[] {
  const abs = toAbsolute(segs);
  let cx = 0, cy = 0, sx = 0, sy = 0;
  return abs.map((s) => {
    let r = s;
    if (s.c === 'H') r = { c: 'L', v: [s.v[0], cy] };
    else if (s.c === 'V') r = { c: 'L', v: [cx, s.v[0]] };
    if (r.c === 'M') { sx = r.v[0]; sy = r.v[1]; }
    if (r.c === 'Z') { cx = sx; cy = sy; } else { cx = r.v[r.v.length - 2]; cy = r.v[r.v.length - 1]; }
    return r;
  });
}

export function arcToCubic(
  x1: number, y1: number, x2: number, y2: number,
  fa: number, fs: number, rx: number, ry: number, phiDeg: number,
): number[][] {
  const phi = (phiDeg * Math.PI) / 180;
  const sinp = Math.sin(phi), cosp = Math.cos(phi);
  const x1p = (cosp * (x1 - x2)) / 2 + (sinp * (y1 - y2)) / 2;
  const y1p = (-sinp * (x1 - x2)) / 2 + (cosp * (y1 - y2)) / 2;
  if (x1p === 0 && y1p === 0) return [];
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (!rx || !ry) return [[x1, y1, x2, y2, x2, y2]];
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) { rx *= Math.sqrt(lambda); ry *= Math.sqrt(lambda); }
  const rxs = rx * rx, rys = ry * ry, x1ps = x1p * x1p, y1ps = y1p * y1p;
  let rad = (rxs * rys - rxs * y1ps - rys * x1ps) / (rxs * y1ps + rys * x1ps);
  if (rad < 0) rad = 0;
  rad = Math.sqrt(rad) * (fa === fs ? -1 : 1);
  const cxp = (rad * rx * y1p) / ry;
  const cyp = (-rad * ry * x1p) / rx;
  const cx = cosp * cxp - sinp * cyp + (x1 + x2) / 2;
  const cy = sinp * cxp + cosp * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const sign = ux * vy - uy * vx < 0 ? -1 : 1;
    let dot = (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy));
    dot = Math.max(-1, Math.min(1, dot));
    return sign * Math.acos(dot);
  };
  const v1x = (x1p - cxp) / rx, v1y = (y1p - cyp) / ry;
  const v2x = (-x1p - cxp) / rx, v2y = (-y1p - cyp) / ry;
  const th1 = ang(1, 0, v1x, v1y);
  let dth = ang(v1x, v1y, v2x, v2y);
  if (!fs && dth > 0) dth -= 2 * Math.PI;
  if (fs && dth < 0) dth += 2 * Math.PI;
  const n = Math.max(Math.ceil(Math.abs(dth) / (Math.PI / 2) - 1e-9), 1);
  const delta = dth / n;
  const t = (4 / 3) * Math.tan(delta / 4);
  const out: number[][] = [];
  for (let i = 0; i < n; i++) {
    const a1 = th1 + i * delta, a2 = a1 + delta;
    const c1 = Math.cos(a1), s1 = Math.sin(a1), c2 = Math.cos(a2), s2 = Math.sin(a2);
    const u = [c1 - t * s1, s1 + t * c1, c2 + t * s2, s2 - t * c2, c2, s2];
    const r: number[] = [];
    for (let k = 0; k < 6; k += 2) {
      const x = u[k] * rx, y = u[k + 1] * ry;
      r.push(cosp * x - sinp * y + cx, sinp * x + cosp * y + cy);
    }
    out.push(r);
  }
  out[out.length - 1][4] = x2;
  out[out.length - 1][5] = y2;
  return out;
}

/** Normalize to absolute M / L / C / Z only */
export function toCurves(segs: Seg[]): Seg[] {
  const abs = toAbsolute(segs);
  const out: Seg[] = [];
  let cx = 0, cy = 0, sx = 0, sy = 0;
  let lastC: P2 | null = null, lastQ: P2 | null = null;
  for (const s of abs) {
    const v = s.v;
    let nextC: P2 | null = null, nextQ: P2 | null = null;
    switch (s.c) {
      case 'M': out.push({ c: 'M', v: [v[0], v[1]] }); cx = sx = v[0]; cy = sy = v[1]; break;
      case 'L': out.push({ c: 'L', v: [v[0], v[1]] }); cx = v[0]; cy = v[1]; break;
      case 'H': out.push({ c: 'L', v: [v[0], cy] }); cx = v[0]; break;
      case 'V': out.push({ c: 'L', v: [cx, v[0]] }); cy = v[0]; break;
      case 'C': out.push({ c: 'C', v: v.slice() }); nextC = [v[2], v[3]]; cx = v[4]; cy = v[5]; break;
      case 'S': {
        const c1: P2 = lastC ? [2 * cx - lastC[0], 2 * cy - lastC[1]] : [cx, cy];
        out.push({ c: 'C', v: [c1[0], c1[1], v[0], v[1], v[2], v[3]] });
        nextC = [v[0], v[1]]; cx = v[2]; cy = v[3]; break;
      }
      case 'Q': case 'T': {
        const q: P2 = s.c === 'Q' ? [v[0], v[1]] : lastQ ? [2 * cx - lastQ[0], 2 * cy - lastQ[1]] : [cx, cy];
        const [ex, ey] = s.c === 'Q' ? [v[2], v[3]] : [v[0], v[1]];
        out.push({ c: 'C', v: [cx + (2 / 3) * (q[0] - cx), cy + (2 / 3) * (q[1] - cy), ex + (2 / 3) * (q[0] - ex), ey + (2 / 3) * (q[1] - ey), ex, ey] });
        nextQ = q; cx = ex; cy = ey; break;
      }
      case 'A': {
        const cs = arcToCubic(cx, cy, v[5], v[6], v[3], v[4], v[0], v[1], v[2]);
        for (const c of cs) out.push({ c: 'C', v: c });
        cx = v[5]; cy = v[6]; break;
      }
      case 'Z': out.push({ c: 'Z', v: [] }); cx = sx; cy = sy; break;
    }
    lastC = nextC; lastQ = nextQ;
  }
  return out;
}

export function transformPath(segs: Seg[], m: Mat): Seg[] {
  const abs = toAbsolute(segs);
  const axis = isAxisAligned(m);
  const sim = isSimilarity(m);
  const flip = det(m) < 0;
  const out: Seg[] = [];
  let cx = 0, cy = 0, sx = 0, sy = 0;
  const P = (x: number, y: number) => { const p = apply(m, x, y); return [p.x, p.y]; };
  for (const s of abs) {
    const v = s.v;
    switch (s.c) {
      case 'M': out.push({ c: 'M', v: P(v[0], v[1]) }); cx = sx = v[0]; cy = sy = v[1]; break;
      case 'L': case 'T': out.push({ c: s.c, v: P(v[0], v[1]) }); cx = v[0]; cy = v[1]; break;
      case 'H':
        out.push(axis ? { c: 'H', v: [m[0] * v[0] + m[4]] } : { c: 'L', v: P(v[0], cy) });
        cx = v[0]; break;
      case 'V':
        out.push(axis ? { c: 'V', v: [m[3] * v[0] + m[5]] } : { c: 'L', v: P(cx, v[0]) });
        cy = v[0]; break;
      case 'C': out.push({ c: 'C', v: [...P(v[0], v[1]), ...P(v[2], v[3]), ...P(v[4], v[5])] }); cx = v[4]; cy = v[5]; break;
      case 'S': case 'Q': out.push({ c: s.c, v: [...P(v[0], v[1]), ...P(v[2], v[3])] }); cx = v[2]; cy = v[3]; break;
      case 'A':
        if (sim) {
          const sc = Math.hypot(m[0], m[1]);
          const r = (v[2] * Math.PI) / 180;
          const ax = m[0] * Math.cos(r) + m[2] * Math.sin(r);
          const ay = m[1] * Math.cos(r) + m[3] * Math.sin(r);
          const rot = (Math.atan2(ay, ax) * 180) / Math.PI;
          out.push({ c: 'A', v: [v[0] * sc, v[1] * sc, rot, v[3], flip ? 1 - v[4] : v[4], ...P(v[5], v[6])] });
        } else {
          for (const c of arcToCubic(cx, cy, v[5], v[6], v[3], v[4], v[0], v[1], v[2])) {
            out.push({ c: 'C', v: [...P(c[0], c[1]), ...P(c[2], c[3]), ...P(c[4], c[5])] });
          }
        }
        cx = v[5]; cy = v[6]; break;
      case 'Z': out.push({ c: 'Z', v: [] }); cx = sx; cy = sy; break;
    }
  }
  return out;
}

export interface Poly { pts: P2[]; closed: boolean }

/** Flatten M/L/C/Z curves into polylines */
export function flatten(curves: Seg[], tol = 0.05): Poly[] {
  const res: Poly[] = [];
  let cur: Poly | null = null;
  let cx = 0, cy = 0, sx = 0, sy = 0;
  const ensure = () => { if (!cur) { cur = { pts: [[cx, cy]], closed: false }; res.push(cur); } return cur; };
  for (const s of curves) {
    const v = s.v;
    if (s.c === 'M') {
      cur = { pts: [[v[0], v[1]]], closed: false }; res.push(cur);
      cx = sx = v[0]; cy = sy = v[1];
    } else if (s.c === 'L') {
      ensure().pts.push([v[0], v[1]]); cx = v[0]; cy = v[1];
    } else if (s.c === 'C') {
      const poly = ensure();
      const len = Math.hypot(v[0] - cx, v[1] - cy) + Math.hypot(v[2] - v[0], v[3] - v[1]) + Math.hypot(v[4] - v[2], v[5] - v[3]);
      const n = Math.max(2, Math.min(200, Math.ceil(Math.sqrt(len / tol))));
      for (let i = 1; i <= n; i++) {
        const t = i / n, mt = 1 - t;
        const a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t;
        poly.pts.push([a * cx + b * v[0] + c * v[2] + d * v[4], a * cy + b * v[1] + c * v[3] + d * v[5]]);
      }
      cx = v[4]; cy = v[5];
    } else if (s.c === 'Z') {
      if (cur) (cur as Poly).closed = true;
      cur = null; cx = sx; cy = sy;
    }
  }
  return res.filter((p) => p.pts.length > 1);
}

export function polyArea(pts: P2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

const num = (el: Element, name: string, def = 0) => {
  const v = parseFloat(el.getAttribute(name) ?? '');
  return isFinite(v) ? v : def;
};

export function parsePoints(str: string | null): P2[] {
  const n = (str || '').trim().split(/[\s,]+/).filter(Boolean).map(Number);
  const out: P2[] = [];
  for (let i = 0; i + 1 < n.length; i += 2) out.push([n[i], n[i + 1]]);
  return out;
}

/** Path data for any basic shape element (or null if not a shape) */
export function elementPathData(el: Element): string | null {
  switch (el.localName) {
    case 'path': return el.getAttribute('d') || '';
    case 'rect': {
      const x = num(el, 'x'), y = num(el, 'y'), w = num(el, 'width'), h = num(el, 'height');
      let rx = el.hasAttribute('rx') ? num(el, 'rx') : NaN;
      let ry = el.hasAttribute('ry') ? num(el, 'ry') : NaN;
      if (isNaN(rx)) rx = isNaN(ry) ? 0 : ry;
      if (isNaN(ry)) ry = rx;
      rx = Math.min(Math.max(rx, 0), w / 2); ry = Math.min(Math.max(ry, 0), h / 2);
      const f = (n: number) => fmt(n, 4);
      if (!rx || !ry) return `M${f(x)} ${f(y)}H${f(x + w)}V${f(y + h)}H${f(x)}Z`;
      return `M${f(x + rx)} ${f(y)}H${f(x + w - rx)}A${f(rx)} ${f(ry)} 0 0 1 ${f(x + w)} ${f(y + ry)}V${f(y + h - ry)}A${f(rx)} ${f(ry)} 0 0 1 ${f(x + w - rx)} ${f(y + h)}H${f(x + rx)}A${f(rx)} ${f(ry)} 0 0 1 ${f(x)} ${f(y + h - ry)}V${f(y + ry)}A${f(rx)} ${f(ry)} 0 0 1 ${f(x + rx)} ${f(y)}Z`;
    }
    case 'circle': case 'ellipse': {
      const cx = num(el, 'cx'), cy = num(el, 'cy');
      const rx = el.localName === 'circle' ? num(el, 'r') : num(el, 'rx');
      const ry = el.localName === 'circle' ? rx : num(el, 'ry');
      const f = (n: number) => fmt(n, 4);
      return `M${f(cx - rx)} ${f(cy)}A${f(rx)} ${f(ry)} 0 1 0 ${f(cx + rx)} ${f(cy)}A${f(rx)} ${f(ry)} 0 1 0 ${f(cx - rx)} ${f(cy)}Z`;
    }
    case 'line':
      return `M${num(el, 'x1')} ${num(el, 'y1')}L${num(el, 'x2')} ${num(el, 'y2')}`;
    case 'polyline': case 'polygon': {
      const pts = parsePoints(el.getAttribute('points'));
      if (!pts.length) return '';
      return 'M' + pts.map((p) => `${p[0]} ${p[1]}`).join('L') + (el.localName === 'polygon' ? 'Z' : '');
    }
  }
  return null;
}

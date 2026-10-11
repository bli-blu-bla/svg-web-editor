// 2D affine matrix [a, b, c, d, e, f] as in SVG: x' = a*x + c*y + e, y' = b*x + d*y + f
export type Mat = [number, number, number, number, number, number];
export interface Pt { x: number; y: number }
export interface Box { x: number; y: number; w: number; h: number }

export const I: Mat = [1, 0, 0, 1, 0, 0];

/** m * n — applies n first, then m */
export function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function mulAll(...ms: Mat[]): Mat {
  return ms.reduce((acc, m) => mul(acc, m), I);
}

export function inv(m: Mat): Mat {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (!det) return I;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

export function apply(m: Mat, x: number, y: number): Pt {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

export const translate = (x: number, y: number): Mat => [1, 0, 0, 1, x, y];

export function scaleAt(sx: number, sy: number, cx = 0, cy = 0): Mat {
  return [sx, 0, 0, sy, cx - sx * cx, cy - sy * cy];
}

export function rotateAt(deg: number, cx = 0, cy = 0): Mat {
  const r = (deg * Math.PI) / 180;
  const cs = Math.cos(r), sn = Math.sin(r);
  return mulAll(translate(cx, cy), [cs, sn, -sn, cs, 0, 0], translate(-cx, -cy));
}

export const det = (m: Mat) => m[0] * m[3] - m[1] * m[2];

const EPS = 1e-9;
export const isIdentity = (m: Mat) =>
  Math.abs(m[0] - 1) < EPS && Math.abs(m[1]) < EPS && Math.abs(m[2]) < EPS &&
  Math.abs(m[3] - 1) < EPS && Math.abs(m[4]) < EPS && Math.abs(m[5]) < EPS;

export const isAxisAligned = (m: Mat) => Math.abs(m[1]) < EPS && Math.abs(m[2]) < EPS;

export function isSimilarity(m: Mat) {
  const s1 = m[0] * m[0] + m[1] * m[1];
  const s2 = m[2] * m[2] + m[3] * m[3];
  const dot = m[0] * m[2] + m[1] * m[3];
  return Math.abs(s1 - s2) < 1e-9 * Math.max(1, s1) && Math.abs(dot) < 1e-9 * Math.max(1, s1);
}

export function fromDOM(m: DOMMatrix | SVGMatrix): Mat {
  return [m.a, m.b, m.c, m.d, m.e, m.f];
}

/** Round a number and strip trailing zeros */
export function fmt(n: number, p = 3): string {
  if (!isFinite(n)) return '0';
  const f = Math.pow(10, p);
  let v = Math.round(n * f) / f;
  if (Object.is(v, -0)) v = 0;
  let s = String(v);
  if (s.includes('e')) s = v.toFixed(p).replace(/\.?0+$/, '');
  return s;
}

export function parseTransform(str: string | null | undefined): Mat {
  if (!str) return I;
  let m: Mat = I;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let r: RegExpExecArray | null;
  while ((r = re.exec(str))) {
    const v = r[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
    let t: Mat = I;
    switch (r[1]) {
      case 'matrix': if (v.length === 6) t = v as Mat; break;
      case 'translate': t = translate(v[0] || 0, v[1] || 0); break;
      case 'scale': t = scaleAt(v[0] ?? 1, v[1] ?? v[0] ?? 1); break;
      case 'rotate': t = rotateAt(v[0] || 0, v[1] || 0, v[2] || 0); break;
      case 'skewX': t = [1, 0, Math.tan(((v[0] || 0) * Math.PI) / 180), 1, 0, 0]; break;
      case 'skewY': t = [1, Math.tan(((v[0] || 0) * Math.PI) / 180), 0, 1, 0, 0]; break;
    }
    m = mul(m, t);
  }
  return m;
}

export function matrixToString(m: Mat, p = 3): string {
  if (isIdentity(m)) return '';
  const lin = (n: number) => fmt(n, 6);
  const pos = (n: number) => fmt(n, p);
  if (Math.abs(m[0] - 1) < EPS && Math.abs(m[1]) < EPS && Math.abs(m[2]) < EPS && Math.abs(m[3] - 1) < EPS) {
    return Math.abs(m[5]) < EPS ? `translate(${pos(m[4])})` : `translate(${pos(m[4])} ${pos(m[5])})`;
  }
  if (isAxisAligned(m) && Math.abs(m[4]) < EPS && Math.abs(m[5]) < EPS) {
    return Math.abs(m[0] - m[3]) < EPS ? `scale(${lin(m[0])})` : `scale(${lin(m[0])} ${lin(m[3])})`;
  }
  return `matrix(${lin(m[0])} ${lin(m[1])} ${lin(m[2])} ${lin(m[3])} ${pos(m[4])} ${pos(m[5])})`;
}

export function boxCorners(b: Box): Pt[] {
  return [
    { x: b.x, y: b.y }, { x: b.x + b.w, y: b.y },
    { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h },
  ];
}

export function boundsOf(pts: Pt[]): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function transformBox(m: Mat, b: Box): Box {
  return boundsOf(boxCorners(b).map((p) => apply(m, p.x, p.y)));
}

export function unionBoxes(boxes: Box[]): Box | null {
  if (!boxes.length) return null;
  return boundsOf(boxes.flatMap(boxCorners));
}

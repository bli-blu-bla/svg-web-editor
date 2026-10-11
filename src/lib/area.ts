// Area (polygon) geometry built on Clipper: visible shape of elements, offsets and boolean operations
import ClipperLib from 'clipper-lib';
import { apply, fmt, type Mat } from './matrix';
import { flatten, parsePath, toCurves } from './path';
import type { CapKind, JoinKind } from './offset';

const SCALE = 1000;
export type CPath = { X: number; Y: number }[];
export type CPaths = CPath[];
export type BoolOp = 'union' | 'subtract' | 'intersect' | 'exclude';

const JT: Record<JoinKind, number> = {
  miter: ClipperLib.JoinType.jtMiter,
  round: ClipperLib.JoinType.jtRound,
  bevel: ClipperLib.JoinType.jtSquare,
};
const ARC_TOL = 0.01 * SCALE;
const NZ = ClipperLib.PolyFillType.pftNonZero;
const EO = ClipperLib.PolyFillType.pftEvenOdd;

export interface ShapeStyle {
  fill: boolean;
  evenOdd: boolean;
  stroke: { width: number; cap: CapKind; join: JoinKind; miterLimit: number } | null;
}

function clip(op: number, subj: CPaths, clp: CPaths, subjFill = NZ, clipFill = NZ): CPaths {
  const c = new ClipperLib.Clipper();
  c.AddPaths(subj, ClipperLib.PolyType.ptSubject, true);
  if (clp.length) c.AddPaths(clp, ClipperLib.PolyType.ptClip, true);
  const res = new ClipperLib.Paths();
  c.Execute(op, res, subjFill, clipFill);
  return res;
}

export const unionAll = (paths: CPaths, evenOdd = false) => clip(ClipperLib.ClipType.ctUnion, paths, [], evenOdd ? EO : NZ, evenOdd ? EO : NZ);

/**
 * Visible area of a path in root coordinates: the fill (if any) united with the stroke outline (if any).
 * Geometry is flattened in local coordinates and mapped with m, so transforms and stroke widths stay correct.
 */
export function shapeArea(d: string, style: ShapeStyle, m: Mat): CPaths {
  const curves = toCurves(parsePath(d));
  const flat = flatten(curves, 0.01);
  const toC = (pts: [number, number][]) => pts.map(([x, y]) => { const p = apply(m, x, y); return { X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) }; });
  let area: CPaths = [];
  if (style.fill) area = unionAll(flat.map((p) => toC(p.pts)), style.evenOdd);
  if (style.stroke && style.stroke.width > 0) {
    // stroke outline is computed in local units (stroke-width is local), then mapped to root
    const s = style.stroke;
    const co = new ClipperLib.ClipperOffset(s.miterLimit, ARC_TOL);
    const local = (pts: [number, number][]) => pts.map(([x, y]) => ({ X: Math.round(x * SCALE), Y: Math.round(y * SCALE) }));
    const closed = flat.filter((p) => p.closed).map((p) => local(p.pts));
    const open = flat.filter((p) => !p.closed).map((p) => local(p.pts));
    const et = s.cap === 'round' ? ClipperLib.EndType.etOpenRound : s.cap === 'square' ? ClipperLib.EndType.etOpenSquare : ClipperLib.EndType.etOpenButt;
    if (closed.length) co.AddPaths(closed, JT[s.join], ClipperLib.EndType.etClosedLine);
    if (open.length) co.AddPaths(open, JT[s.join], et);
    const sol: CPaths = new ClipperLib.Paths();
    co.Execute(sol, (s.width / 2) * SCALE);
    const mapped = sol.map((p) => p.map((q) => { const r = apply(m, q.X / SCALE, q.Y / SCALE); return { X: Math.round(r.x * SCALE), Y: Math.round(r.y * SCALE) }; }));
    area = unionAll([...area, ...unionAll(mapped)]);
  }
  return area;
}

/**
 * Offset an area the "border" way: build a ring of width 2·|distance| along the outline,
 * then unite it with the shape (grow) or cut it away (shrink).
 */
export function offsetArea(area: CPaths, distance: number, join: JoinKind, miterLimit = 4): CPaths {
  if (!distance) return area;
  const co = new ClipperLib.ClipperOffset(miterLimit, ARC_TOL);
  co.AddPaths(area, JT[join], ClipperLib.EndType.etClosedLine);
  const ring: CPaths = new ClipperLib.Paths();
  co.Execute(ring, Math.abs(distance) * SCALE);
  const r = distance > 0
    ? clip(ClipperLib.ClipType.ctUnion, area, ring)
    : clip(ClipperLib.ClipType.ctDifference, area, ring);
  return ClipperLib.Clipper.CleanPolygons(r, 0.002 * SCALE);
}

/** Boolean operation over areas ordered bottom → top */
export function booleanAreas(areas: CPaths[], op: BoolOp): CPaths {
  if (!areas.length) return [];
  const T = ClipperLib.ClipType;
  let acc = areas[0];
  if (op === 'union') acc = unionAll(areas.flat());
  else if (op === 'subtract') acc = clip(T.ctDifference, acc, unionAll(areas.slice(1).flat()));
  else for (const a of areas.slice(1)) acc = clip(op === 'intersect' ? T.ctIntersection : T.ctXor, acc, a);
  return ClipperLib.Clipper.CleanPolygons(acc, 0.002 * SCALE);
}

/** Path data from Clipper polygons, mapped with m (root → target coordinates) */
export function areaToD(paths: CPaths, prec: number, m?: Mat): string {
  return paths
    .filter((p) => p.length > 2)
    .map((p) => 'M' + p.map((q) => {
      let x = q.X / SCALE, y = q.Y / SCALE;
      if (m) ({ x, y } = apply(m, x, y));
      return `${fmt(x, prec)} ${fmt(y, prec)}`;
    }).join('L') + 'Z')
    .join('');
}

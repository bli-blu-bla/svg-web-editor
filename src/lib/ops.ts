import { det, inv, isAxisAligned, isIdentity, isSimilarity, matrixToString, mul, mulAll, fmt, apply, transformBox, type Mat } from './matrix';
import { elementPathData, parsePath, parsePoints, serializePath, transformPath, type P2 } from './path';
import { curveOffset, strokeOutline, type CapKind, type JoinKind } from './offset';
import { roundCorners, type ShapeSpec } from './shapes';
import { areaToD, booleanAreas, offsetArea, SCALE, shapeArea, unionAll, type BoolOp, type CPaths, type ShapeStyle } from './area';
import { centerline, type CenterLine } from './centerline';
import { cutAt, fromNodes, insertNode, toNodes } from './nodes';
import {
  COLOR_PROPS, GRAPHIC, SHAPES, SVGNS, docSize, effProp, elsOf, getEl, idOf, kids, localMatrix, normalizeColor,
  ownProp, parentMatrix, parseSvg, setProp, topmost,
} from './svg';

export interface Ctx { prec: number; autoBake: boolean; scaleStrokes: boolean }

const n = (el: Element, a: string) => parseFloat(el.getAttribute(a) || '0') || 0;

export function setTransform(el: Element, m: Mat, prec: number) {
  const s = matrixToString(m, prec);
  if (s) el.setAttribute('transform', s); else el.removeAttribute('transform');
}

function hasRefs(el: Element): boolean {
  const check = (e: Element) =>
    ['clip-path', 'mask', 'filter'].some((a) => ownProp(e, a) && ownProp(e, a) !== 'none') ||
    ['fill', 'stroke'].some((a) => (ownProp(e, a) || '').includes('url('));
  if (check(el)) return true;
  return Array.from(el.querySelectorAll('*')).some(check);
}

export function replaceTag(el: Element, tag: string, drop: string[] = []): Element {
  const ne = el.ownerDocument.createElementNS(SVGNS, tag);
  for (const a of Array.from(el.attributes)) if (!drop.includes(a.name)) ne.setAttributeNS(a.namespaceURI, a.name, a.value);
  while (el.firstChild) ne.appendChild(el.firstChild);
  el.parentNode!.replaceChild(ne, el);
  return ne;
}

const GEOM_ATTRS = ['x', 'y', 'width', 'height', 'rx', 'ry', 'cx', 'cy', 'r', 'x1', 'y1', 'x2', 'y2', 'points'];

export function toPathElement(el: Element, prec = 3): Element {
  if (el.localName === 'path') return el;
  const d = elementPathData(el);
  if (d === null) return el;
  const p = replaceTag(el, 'path', GEOM_ATTRS);
  p.setAttribute('d', serializePath(parsePath(d), prec));
  return p;
}

function scaleStroke(el: Element, s: number, inherited: boolean) {
  const own = ownProp(el, 'stroke-width');
  if (own) {
    const v = parseFloat(own);
    if (isFinite(v)) setProp(el, 'stroke-width', fmt(v * s, 3));
  } else if (!inherited && el.localName !== 'g' && effProp(el, 'stroke', 'none') !== 'none') {
    setProp(el, 'stroke-width', fmt(parseFloat(effProp(el, 'stroke-width', '1')) * s, 3));
  }
}

/** Write matrix m into the element's geometry. Returns false if not possible (caller keeps a transform). */
export function bakeInto(el: Element, m: Mat, prec: number, ss: number | null, inherited = false): boolean {
  if (isIdentity(m)) return true;
  if (hasRefs(el)) return false;
  const axis = isAxisAligned(m);
  const swap = Math.abs(m[0]) < 1e-9 && Math.abs(m[3]) < 1e-9; // 90° rotations
  const f = (v: number) => fmt(v, prec);
  switch (el.localName) {
    case 'path':
      el.setAttribute('d', serializePath(transformPath(parsePath(el.getAttribute('d')), m), prec));
      break;
    case 'polyline': case 'polygon':
      el.setAttribute('points', parsePoints(el.getAttribute('points')).map(([x, y]) => { const p = apply(m, x, y); return `${f(p.x)} ${f(p.y)}`; }).join(' '));
      break;
    case 'line': {
      const a = apply(m, n(el, 'x1'), n(el, 'y1')), b = apply(m, n(el, 'x2'), n(el, 'y2'));
      el.setAttribute('x1', f(a.x)); el.setAttribute('y1', f(a.y)); el.setAttribute('x2', f(b.x)); el.setAttribute('y2', f(b.y));
      break;
    }
    case 'rect': {
      if (!axis && !swap) return false;
      const b = transformBox(m, { x: n(el, 'x'), y: n(el, 'y'), w: n(el, 'width'), h: n(el, 'height') });
      el.setAttribute('x', f(b.x)); el.setAttribute('y', f(b.y)); el.setAttribute('width', f(b.w)); el.setAttribute('height', f(b.h));
      const hasRx = el.hasAttribute('rx'), hasRy = el.hasAttribute('ry');
      if (hasRx || hasRy) {
        let rx = hasRx ? n(el, 'rx') : n(el, 'ry'), ry = hasRy ? n(el, 'ry') : n(el, 'rx');
        if (swap) [rx, ry] = [ry, rx];
        const nrx = rx * Math.hypot(m[0], m[1]), nry = ry * Math.hypot(m[2], m[3]);
        el.setAttribute('rx', f(nrx));
        if (Math.abs(nrx - nry) > 1e-9 || hasRy) el.setAttribute('ry', f(nry)); else el.removeAttribute('ry');
      }
      break;
    }
    case 'circle': case 'ellipse': {
      const circ = el.localName === 'circle' || n(el, 'rx') === n(el, 'ry');
      if (!axis && !swap && !(circ && isSimilarity(m))) return false;
      const c = apply(m, n(el, 'cx'), n(el, 'cy'));
      let rx0 = el.localName === 'circle' ? n(el, 'r') : n(el, 'rx');
      let ry0 = el.localName === 'circle' ? n(el, 'r') : n(el, 'ry');
      if (swap && !axis) [rx0, ry0] = [ry0, rx0];
      const rx = rx0 * Math.hypot(m[0], m[1]);
      const ry = ry0 * Math.hypot(m[2], m[3]);
      let t = el;
      if (Math.abs(rx - ry) < 1e-9) {
        if (t.localName !== 'circle') t = replaceTag(t, 'circle', ['rx', 'ry']);
        t.setAttribute('r', f(rx));
      } else {
        if (t.localName !== 'ellipse') t = replaceTag(t, 'ellipse', ['r']);
        t.setAttribute('rx', f(rx)); t.setAttribute('ry', f(ry));
      }
      t.setAttribute('cx', f(c.x)); t.setAttribute('cy', f(c.y));
      el = t;
      break;
    }
    case 'g': {
      for (const c of kids(el)) {
        const cm = mul(m, localMatrix(c));
        c.removeAttribute('transform');
        if (!bakeInto(c, cm, prec, ss, inherited || !!ownProp(el, 'stroke-width'))) setTransform(c, cm, prec);
      }
      if (ss) scaleStroke(el, ss, inherited);
      return true;
    }
    default:
      return false;
  }
  if (ss) scaleStroke(el, ss, inherited);
  return true;
}

function applyLocal(el: Element, newL: Mat, ctx: Ctx, delta: Mat) {
  if (ctx.autoBake) {
    const old = el.getAttribute('transform');
    el.removeAttribute('transform');
    const s = Math.sqrt(Math.abs(det(newL)));
    const clone = el.cloneNode(true) as Element;
    if (bakeInto(el, newL, ctx.prec, ctx.scaleStrokes && Math.abs(s - 1) > 1e-9 ? s : null)) return;
    // restore if bake failed (bakeInto may have partially modified)
    el.replaceWith(clone);
    if (old !== null) clone.setAttribute('transform', old);
    setTransform(clone, newL, ctx.prec);
    void delta;
    return;
  }
  setTransform(el, newL, ctx.prec);
}

/** Apply a root-space matrix to each element */
export function transformEach(doc: Document, items: { id: string; m: Mat }[], ctx: Ctx) {
  const map = new Map<Element, Mat>();
  for (const it of items) { const el = getEl(doc, it.id); if (el && el !== doc.documentElement) map.set(el, it.m); }
  for (const el of topmost([...map.keys()])) {
    const M = map.get(el)!;
    const P = parentMatrix(el);
    const newL = mulAll(inv(P), M, P, localMatrix(el));
    applyLocal(el, newL, ctx, M);
  }
}

export function transformAll(doc: Document, ids: string[], m: Mat, ctx: Ctx) {
  transformEach(doc, ids.map((id) => ({ id, m })), ctx);
}

export function bakeTransforms(doc: Document, ids: string[], ctx: Ctx): number {
  let count = 0;
  for (const el of topmost(elsOf(doc, ids))) {
    const L = localMatrix(el);
    if (isIdentity(L) && el.localName !== 'g') continue;
    el.removeAttribute('transform');
    const s = Math.sqrt(Math.abs(det(L)));
    if (bakeInto(el, L, ctx.prec, ctx.scaleStrokes && Math.abs(s - 1) > 1e-9 ? s : null)) count++;
    else {
      // try converting to path first
      const p = SHAPES.has(el.localName) ? toPathElement(el, ctx.prec) : null;
      if (p && p !== el && bakeInto(p, L, ctx.prec, null)) count++;
      else setTransform(p || el, L, ctx.prec);
    }
  }
  return count;
}

const track = (els: Element[]) => () => els.filter((e) => e.isConnected).map(idOf);

export function deleteEls(doc: Document, ids: string[]) {
  topmost(elsOf(doc, ids)).forEach((e) => {
    // drop the indentation text node in front, so the code view doesn't fill up with blank lines
    const prev = e.previousSibling;
    if (prev && prev.nodeType === Node.TEXT_NODE && !prev.textContent!.trim()) prev.remove();
    e.remove();
  });
}

export function duplicate(doc: Document, ids: string[]): string[] {
  const clones: Element[] = [];
  for (const el of topmost(elsOf(doc, ids))) {
    const c = el.cloneNode(true) as Element;
    c.removeAttribute('id');
    el.after(c);
    clones.push(c);
  }
  return track(clones)();
}

export function group(doc: Document, ids: string[], prec: number): string[] {
  const els = topmost(elsOf(doc, ids));
  if (!els.length) return ids;
  const last = els[els.length - 1];
  const parent = last.parentElement!;
  const g = doc.createElementNS(SVGNS, 'g');
  parent.insertBefore(g, last.nextSibling);
  const Pnew = parentMatrix(g);
  for (const el of els) {
    if (el.parentElement !== parent) {
      const nl = mulAll(inv(Pnew), parentMatrix(el), localMatrix(el));
      setTransform(el, nl, prec);
    }
    g.appendChild(el);
  }
  return [idOf(g)];
}

const PUSH_PROPS = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'fill-rule', 'fill-opacity', 'stroke-opacity', 'color', 'font-family', 'font-size', 'font-weight', 'clip-rule'];

export function ungroup(doc: Document, ids: string[], ctx: Ctx): string[] {
  const moved: Element[] = [];
  for (const g of topmost(elsOf(doc, ids))) {
    if (g.localName !== 'g') { moved.push(g); continue; }
    const T = localMatrix(g);
    const op = parseFloat(ownProp(g, 'opacity') || '1');
    for (const c of kids(g)) {
      for (const p of PUSH_PROPS) {
        const v = ownProp(g, p);
        if (v && !ownProp(c, p)) c.setAttribute(p, v);
      }
      if (op !== 1) c.setAttribute('opacity', fmt(op * parseFloat(ownProp(c, 'opacity') || '1'), 3));
      g.before(c);
      if (!isIdentity(T)) applyLocal(c, mul(T, localMatrix(c)), ctx, T);
      moved.push(c);
    }
    g.remove();
  }
  return track(moved)();
}

export type Arrange = 'front' | 'back' | 'forward' | 'backward';
export function reorder(doc: Document, ids: string[], dir: Arrange): string[] {
  const els = topmost(elsOf(doc, ids));
  const sel = new Set(els);
  if (dir === 'front') els.forEach((e) => e.parentElement!.appendChild(e));
  if (dir === 'back') [...els].reverse().forEach((e) => e.parentElement!.insertBefore(e, e.parentElement!.firstElementChild));
  if (dir === 'forward') [...els].reverse().forEach((e) => { const nx = e.nextElementSibling; if (nx && !sel.has(nx)) nx.after(e); });
  if (dir === 'backward') els.forEach((e) => { const pv = e.previousElementSibling; if (pv && !sel.has(pv)) pv.before(e); });
  return track(els)();
}

/** Where a layer is dropped, in panel terms: above/below a row (in front of / behind it) or into a group */
export type DropPos = 'above' | 'below' | 'inside';

/** Move elements next to or into a target; elements that change parent keep their position on the canvas */
export function moveEls(doc: Document, ids: string[], targetId: string, pos: DropPos, ctx: Ctx): string[] {
  const target = getEl(doc, targetId);
  if (!target) return ids;
  const els = topmost(elsOf(doc, ids)).filter((e) => e !== target && !e.contains(target));
  if (!els.length) return ids;
  const before = new Map(els.map((e) => [e, parentMatrix(e)]));
  if (pos === 'inside') els.forEach((e) => target.appendChild(e));
  else if (pos === 'above') [...els].reverse().forEach((e) => target.after(e));
  else els.forEach((e) => target.before(e));
  const moved = els.map((e) => {
    const P0 = before.get(e)!, P1 = parentMatrix(e);
    if (P0.every((v, i) => Math.abs(v - P1[i]) < 1e-9)) return e;
    const parent = e.parentNode!, next = e.nextSibling;
    applyLocal(e, mulAll(inv(P1), P0, localMatrix(e)), ctx, P0);
    // applyLocal may replace the element with a clone
    return (next ? next.previousSibling : parent.lastChild) as Element;
  });
  return track(moved)();
}

/**
 * Scissors: cut a path (shapes are converted first) on the segment after node j at parameter t
 * (t = 0 cuts at the node itself). The piece split off an open path becomes its own element.
 */
export function cutPathOp(doc: Document, id: string, s: number, j: number, t: number, prec: number): string[] | null {
  const el0 = getEl(doc, id);
  if (!el0) return null;
  const el = toPathElement(el0, prec);
  if (el.localName !== 'path') return null;
  const subs = toNodes(el.getAttribute('d'));
  const sp = subs[s];
  if (!sp) return null;
  const ref = t <= 1e-6 ? { s, j } : t >= 1 - 1e-6 ? { s, j: (j + 1) % sp.nodes.length } : insertNode(subs, s, j, t);
  const { ok, piece } = cutAt(subs, ref);
  if (!ok) return null;
  el.setAttribute('d', fromNodes(subs, prec));
  if (!piece) return [idOf(el)];
  const twin = el.cloneNode(false) as Element;
  twin.removeAttribute('id');
  twin.setAttribute('d', fromNodes([piece], prec));
  el.after(twin);
  return [idOf(el), idOf(twin)];
}

export function convertToPath(doc: Document, ids: string[], prec: number): string[] {
  const out: Element[] = [];
  for (const el of topmost(elsOf(doc, ids))) {
    if (SHAPES.has(el.localName)) out.push(toPathElement(el, prec));
    else if (el.localName === 'g') {
      el.querySelectorAll('rect,circle,ellipse,line,polyline,polygon').forEach((c) => toPathElement(c, prec));
      out.push(el);
    } else out.push(el);
  }
  return track(out)();
}

export function setProps(doc: Document, ids: string[], props: Record<string, string | null>, deep = true) {
  for (const el of topmost(elsOf(doc, ids))) {
    for (const [k, v] of Object.entries(props)) {
      setProp(el, k, v);
      if (deep && el.localName === 'g') {
        el.querySelectorAll('*').forEach((c) => {
          const own = ownProp(c, k);
          if (own && !((k === 'fill' || k === 'stroke') && (own === 'none' || own.startsWith('url(')))) setProp(c, k, v);
        });
      }
    }
  }
}

export function recolor(doc: Document, from: string, to: string) {
  doc.querySelectorAll('*').forEach((el) => {
    for (const p of COLOR_PROPS) {
      if (normalizeColor(ownProp(el, p)) === from) setProp(el, p, to);
    }
  });
}

export function insertFragments(doc: Document, frags: string[], targetId: string): string[] {
  const target = getEl(doc, targetId) || doc.documentElement;
  const added: Element[] = [];
  for (const f of frags) {
    let src: Document;
    try { src = parseSvg(f.trim().startsWith('<svg') ? f : `<svg xmlns="${SVGNS}">${f}</svg>`); } catch { continue; }
    for (const c of kids(src.documentElement)) {
      const node = doc.importNode(c, true) as Element;
      if (c.localName === 'defs') {
        let defs = doc.documentElement.querySelector(':scope > defs');
        if (!defs) { defs = doc.createElementNS(SVGNS, 'defs'); doc.documentElement.prepend(defs); }
        while (node.firstChild) defs.appendChild(node.firstChild);
        continue;
      }
      if (['title', 'desc', 'metadata', 'style'].includes(c.localName)) continue;
      target.appendChild(node);
      added.push(node);
    }
  }
  return track(added)();
}

export interface OffsetOpts { distance: number; mode: 'area' | 'parallel'; join: JoinKind; miterLimit: number; copy: boolean }

const SHAPE_SEL = 'path,rect,circle,ellipse,line,polyline,polygon';

/** Visible area (fill ∪ stroke) of an element or group in root coordinates */
export function elementArea(el: Element): CPaths {
  if (el.localName === 'g' || el.localName === 'a') {
    return unionAll(kids(el).flatMap((c) => elementArea(c)));
  }
  const d = elementPathData(el);
  if (!d || effProp(el, 'display', 'inline') === 'none') return [];
  const fill = effProp(el, 'fill', '#000');
  const stroke = effProp(el, 'stroke', 'none');
  const sw = parseFloat(effProp(el, 'stroke-width', '1')) || 0;
  const style: ShapeStyle = {
    fill: fill !== 'none' && el.localName !== 'line',
    evenOdd: effProp(el, 'fill-rule', 'nonzero') === 'evenodd',
    stroke: stroke !== 'none' && sw > 0 ? {
      width: sw,
      cap: effProp(el, 'stroke-linecap', 'butt') as CapKind,
      join: effProp(el, 'stroke-linejoin', 'miter').replace(/miter-clip|arcs/, 'miter') as JoinKind,
      miterLimit: parseFloat(effProp(el, 'stroke-miterlimit', '4')) || 4,
    } : null,
  };
  return shapeArea(d, style, mul(parentMatrix(el), localMatrix(el)));
}

/** Paint of the visible area: fill if present, otherwise the stroke color */
function areaPaint(el: Element): { color: string; opacity: string | null } {
  const leaf = el.localName === 'g' ? (el.querySelector(SHAPE_SEL) ?? el) : el;
  const fill = effProp(leaf, 'fill', '#000');
  if (fill !== 'none') return { color: fill, opacity: ownProp(leaf, 'fill-opacity') };
  return { color: effProp(leaf, 'stroke', '#000'), opacity: ownProp(leaf, 'stroke-opacity') };
}

/** New filled path for an area result, placed in the parent of `ref` */
function areaPath(doc: Document, ref: Element, area: CPaths, prec: number): Element | null {
  const d = areaToD(area, prec, inv(parentMatrix(ref)));
  if (!d) return null;
  const p = doc.createElementNS(SVGNS, 'path');
  p.setAttribute('d', d);
  const paint = areaPaint(ref);
  p.setAttribute('fill', paint.color);
  if (paint.opacity) p.setAttribute('fill-opacity', paint.opacity);
  const op = ownProp(ref, 'opacity');
  if (op) p.setAttribute('opacity', op);
  if (effProp(ref.parentElement ?? ref, 'stroke', 'none') !== 'none') p.setAttribute('stroke', 'none');
  return p;
}

export function offsetOp(doc: Document, ids: string[], o: OffsetOpts, prec: number): string[] {
  const res: Element[] = [];
  for (const el of topmost(elsOf(doc, ids))) {
    if (o.mode === 'parallel') {
      // curve-preserving parallel of the path itself (useful for lines)
      const shapes = el.localName === 'g' ? Array.from(el.querySelectorAll(SHAPE_SEL)) : [el];
      for (const s of shapes) {
        const d = elementPathData(s);
        if (!d) continue;
        const nd = curveOffset(d, o.distance, o.join, o.miterLimit, prec);
        if (!nd) continue;
        let target = s;
        if (o.copy) { target = s.cloneNode(true) as Element; target.removeAttribute('id'); s.after(target); }
        target = toPathElement(target, prec);
        target.setAttribute('d', nd);
        res.push(target);
      }
      continue;
    }
    // area offset: border of 2·d around the visible shape, united (grow) or subtracted (shrink)
    const area = elementArea(el);
    if (!area.length) continue;
    const p = areaPath(doc, el, offsetArea(area, o.distance, o.join, o.miterLimit), prec);
    if (!p) continue;
    if (o.copy) {
      // grown copy goes behind the original, shrunk copy in front
      if (o.distance > 0) el.before(p); else el.after(p);
    } else {
      const id = el.getAttribute('id');
      if (id) p.setAttribute('id', id);
      el.replaceWith(p);
    }
    res.push(p);
  }
  return track(res)();
}

/** Boolean combination of the selection (bottom-most element gives position and color) */
export function booleanOp(doc: Document, ids: string[], op: BoolOp, prec: number): string[] {
  const els = topmost(elsOf(doc, ids));
  if (els.length < 2) throw new Error('Mindestens 2 Elemente auswählen');
  const result = booleanAreas(els.map(elementArea), op);
  const bottom = els[0];
  const p = areaPath(doc, bottom, result, prec);
  const id = bottom.getAttribute('id');
  if (p) {
    if (id) p.setAttribute('id', id);
    bottom.before(p);
  }
  els.forEach((e) => e.remove());
  return p ? track([p])() : [];
}

export function expandStrokeOp(doc: Document, ids: string[], prec: number): string[] {
  const res: Element[] = [];
  for (const el of topmost(elsOf(doc, ids))) {
    const shapes = el.localName === 'g' ? Array.from(el.querySelectorAll('path,rect,circle,ellipse,line,polyline,polygon')) : [el];
    for (const s of shapes) {
      const stroke = effProp(s, 'stroke', 'none');
      if (stroke === 'none') continue;
      const d = elementPathData(s);
      if (!d) continue;
      const w = parseFloat(effProp(s, 'stroke-width', '1')) || 1;
      const outline = strokeOutline(
        d, w,
        effProp(s, 'stroke-linecap', 'butt') as CapKind,
        (effProp(s, 'stroke-linejoin', 'miter').replace('miter-clip', 'miter').replace('arcs', 'miter')) as JoinKind,
        parseFloat(effProp(s, 'stroke-miterlimit', '4')) || 4,
        prec,
      );
      const fill = effProp(s, 'fill', '#000');
      const sOpacity = ownProp(s, 'stroke-opacity');
      const strip = (e: Element) => {
        ['stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity'].forEach((p) => setProp(e, p, null));
        if (effProp(e, 'stroke', 'none') !== 'none') setProp(e, 'stroke', 'none');
      };
      if (fill === 'none') {
        const p = toPathElement(s, prec);
        p.setAttribute('d', outline);
        strip(p);
        setProp(p, 'fill', stroke);
        setProp(p, 'fill-rule', null);
        if (sOpacity) setProp(p, 'fill-opacity', sOpacity);
        res.push(p);
      } else {
        const p = doc.createElementNS(SVGNS, 'path');
        p.setAttribute('d', outline);
        p.setAttribute('fill', stroke);
        if (sOpacity) p.setAttribute('fill-opacity', sOpacity);
        const t = s.getAttribute('transform');
        if (t) p.setAttribute('transform', t);
        s.after(p);
        strip(s);
        res.push(s, p);
      }
    }
  }
  return track(res)();
}

/** Path data of fitted centerlines (root coordinates) mapped with m; arcs stay arcs under similarity transforms */
function centerlineD(lines: CenterLine[], m: Mat, prec: number): string {
  const pt = ([x, y]: P2) => { const r = apply(m, x, y); return `${fmt(r.x, prec)} ${fmt(r.y, prec)}`; };
  const sim = isSimilarity(m), scale = Math.sqrt(Math.abs(det(m))), flip = det(m) < 0;
  return lines.map(({ prims, closed }) => {
    let d = 'M' + pt(prims[0].a);
    for (const p of prims) {
      if (p.kind === 'L') { d += 'L' + pt(p.b); continue; }
      const a0 = Math.atan2(p.a[1] - p.c[1], p.a[0] - p.c[0]);
      let sw = (Math.atan2(p.b[1] - p.c[1], p.b[0] - p.c[0]) - a0) * p.dir;
      while (sw < 0) sw += 2 * Math.PI;
      if (sim) {
        const dir = flip ? -p.dir : p.dir;
        d += `A${fmt(p.r * scale, prec)} ${fmt(p.r * scale, prec)} 0 ${sw > Math.PI ? 1 : 0} ${dir > 0 ? 1 : 0} ${pt(p.b)}`;
      } else {
        const k = Math.max(2, Math.ceil(sw / (Math.PI / 32)));
        for (let i = 1; i <= k; i++) {
          const a = a0 + (sw * p.dir * i) / k;
          d += 'L' + (i === k ? pt(p.b) : pt([p.c[0] + p.r * Math.cos(a), p.c[1] + p.r * Math.sin(a)]));
        }
      }
    }
    return closed ? d + 'Z' : d;
  }).join('');
}

/** Centerline of each selected element's visible area as a new stroked path above it */
export function centerlineOp(doc: Document, ids: string[], prec: number): string[] {
  const res: Element[] = [];
  for (const el of topmost(elsOf(doc, ids))) {
    const area = elementArea(el);
    if (!area.length) continue;
    const { lines, radius } = centerline(area.map((p) => p.map((q): [number, number] => [q.X / SCALE, q.Y / SCALE])));
    if (!lines.length) continue;
    const m = inv(parentMatrix(el));
    const d = centerlineD(lines, m, prec);
    const p = doc.createElementNS(SVGNS, 'path');
    p.setAttribute('d', d);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', areaPaint(el).color);
    p.setAttribute('stroke-width', fmt(2 * radius * Math.sqrt(Math.abs(det(m))), prec));
    p.setAttribute('stroke-linejoin', 'round');
    el.after(p);
    res.push(p);
  }
  if (!res.length) throw new Error('Keine Mittellinie gefunden (Form zu klein oder ohne Fläche)');
  return track(res)();
}

export function setDocAttrs(doc: Document, attrs: Record<string, string | null>) {
  const r = doc.documentElement;
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === '') r.removeAttribute(k); else r.setAttribute(k, v);
  }
}

/**
 * Scale the whole drawing to a new document size: the viewBox becomes `0 0 w h` and every element's
 * geometry (and stroke width) is rewritten. Elements that can't be baked (text, use, gradients …) keep a transform.
 */
export function rescaleDocument(doc: Document, w: number, h: number, prec: number) {
  const root = doc.documentElement;
  const old = docSize(root);
  const sx = w / old.w, sy = h / old.h;
  const M: Mat = [sx, 0, 0, sy, -old.x * sx, -old.y * sy];
  const ss = Math.sqrt(Math.abs(sx * sy));
  const rootStroke = !!ownProp(root, 'stroke-width');
  for (const c of kids(root)) {
    if (!GRAPHIC.has(c.localName)) continue;
    const cm = mul(M, localMatrix(c));
    c.removeAttribute('transform');
    if (bakeInto(c, cm, prec, ss, rootStroke)) continue;
    const p = SHAPES.has(c.localName) ? toPathElement(c, prec) : c;
    if (p !== c && bakeInto(p, cm, prec, ss, rootStroke)) continue;
    if (p.localName === 'svg') {
      // nested <svg> doesn't reliably support transform → wrap it
      const g = doc.createElementNS(SVGNS, 'g');
      p.replaceWith(g);
      g.appendChild(p);
      setTransform(g, cm, prec);
    } else setTransform(p, cm, prec);
  }
  if (rootStroke) {
    const v = parseFloat(ownProp(root, 'stroke-width')!);
    if (isFinite(v)) setProp(root, 'stroke-width', fmt(v * ss, 3));
  }
  const f = (v: number) => fmt(v, prec);
  root.setAttribute('viewBox', `0 0 ${f(w)} ${f(h)}`);
  if (root.hasAttribute('width')) root.setAttribute('width', f(w));
  if (root.hasAttribute('height')) root.setAttribute('height', f(h));
}

export function insertShape(doc: Document, spec: ShapeSpec, style: Record<string, string>, scopeId: string, prec: number): string[] {
  const target = getEl(doc, scopeId) || doc.documentElement;
  const el = doc.createElementNS(SVGNS, spec.tag);
  for (const [k, v] of Object.entries(spec.attrs)) el.setAttribute(k, v);
  for (const [k, v] of Object.entries(style)) el.setAttribute(k, v);
  target.appendChild(el);
  // drawn in root coordinates → compensate transforms of the group we insert into
  const P = parentMatrix(el);
  if (!isIdentity(P)) {
    const m = inv(P);
    if (!bakeInto(el, m, prec, null)) setTransform(el, m, prec);
  }
  return [idOf(el)];
}

/** Round corners: rects get rx, polygons/polylines/paths get arcs between straight segments */
export function roundCornersOp(doc: Document, ids: string[], radius: number, prec: number): string[] {
  const res: Element[] = [];
  let changed = 0;
  for (const el of topmost(elsOf(doc, ids))) {
    const shapes = el.localName === 'g' ? Array.from(el.querySelectorAll(SHAPE_SEL)) : [el];
    for (const s of shapes) {
      if (s.localName === 'rect') {
        const w = n(s, 'width'), h = n(s, 'height');
        s.removeAttribute('ry');
        if (radius > 0) s.setAttribute('rx', fmt(Math.min(radius, w / 2, h / 2), prec)); else s.removeAttribute('rx');
        changed++;
        if (s === el) res.push(s);
      } else if (['polygon', 'polyline', 'path'].includes(s.localName) && radius > 0) {
        const d = elementPathData(s);
        if (!d) continue;
        const nd = roundCorners(d, radius, prec);
        const p = toPathElement(s, prec);
        if (p.getAttribute('d') !== nd) changed++;
        p.setAttribute('d', nd);
        if (s === el) res.push(p);
      }
    }
    if (el.localName === 'g') res.push(el);
  }
  if (!changed) throw new Error('Keine abrundbaren Ecken gefunden (Rechteck, Polygon oder Pfad mit geraden Kanten)');
  return track(res)();
}

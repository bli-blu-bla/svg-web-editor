import { createElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import {
  apply, boxCorners, inv, matrixToString, mulAll, rotateAt, scaleAt, transformBox, translate, unionBoxes,
  type Box, type Mat, type Pt,
} from '../lib/matrix';
import { transformEach } from '../lib/ops';
import { GRAPHIC, SHAPES, isUnder, parentId, renderMarkup, parentMatrix, localMatrix } from '../lib/svg';
import { elToRoot, liveEl, rootBBox, setLiveRoot, getLiveRoot } from '../lib/live';
import { parsePath, serializePath, toEditable, type Seg } from '../lib/path';
import * as A from '../actions';
import { shapeSpec, SQUARE_SHAPES } from '../lib/shapes';

type Item = { id: string; el: SVGGraphicsElement; orig: string | null; P: Mat; L: Mat };
type Drag =
  | { kind: 'pan'; sx: number; sy: number; pan0: { x: number; y: number } }
  | { kind: 'move' | 'scale' | 'rotate'; start: Pt; box: Box; items: Item[]; handle?: string; moved: boolean; m: Mat }
  | { kind: 'marquee'; start: Pt; add: boolean; base: string[] }
  | { kind: 'draw'; start: Pt; cx: number; cy: number; moved: boolean }
  | { kind: 'node'; el: SVGPathElement; segs: Seg[]; orig: Seg[]; i: number; k: number; start: Pt; inv: Mat; moved: boolean };

type TDrag = Extract<Drag, { items: Item[] }>;
interface NodePt { i: number; k: number; kind: 'anchor' | 'ctrl'; x: number; y: number; links: [number, number][] }

function nodePoints(segs: Seg[]): NodePt[] {
  const out: NodePt[] = [];
  let px = 0, py = 0, sx = 0, sy = 0;
  segs.forEach((s, i) => {
    const v = s.v;
    switch (s.c) {
      case 'M': out.push({ i, k: 0, kind: 'anchor', x: v[0], y: v[1], links: [] }); sx = v[0]; sy = v[1]; break;
      case 'L': case 'T': out.push({ i, k: 0, kind: 'anchor', x: v[0], y: v[1], links: [] }); break;
      case 'C':
        out.push({ i, k: 0, kind: 'ctrl', x: v[0], y: v[1], links: [[px, py]] });
        out.push({ i, k: 2, kind: 'ctrl', x: v[2], y: v[3], links: [[v[4], v[5]]] });
        out.push({ i, k: 4, kind: 'anchor', x: v[4], y: v[5], links: [] });
        break;
      case 'S':
        out.push({ i, k: 0, kind: 'ctrl', x: v[0], y: v[1], links: [[v[2], v[3]]] });
        out.push({ i, k: 2, kind: 'anchor', x: v[2], y: v[3], links: [] });
        break;
      case 'Q':
        out.push({ i, k: 0, kind: 'ctrl', x: v[0], y: v[1], links: [[px, py], [v[2], v[3]]] });
        out.push({ i, k: 2, kind: 'anchor', x: v[2], y: v[3], links: [] });
        break;
      case 'A': out.push({ i, k: 5, kind: 'anchor', x: v[5], y: v[6], links: [] }); break;
    }
    if (s.c === 'Z') { px = sx; py = sy; } else if (v.length) { px = v[v.length - 2]; py = v[v.length - 1]; }
  });
  return out;
}

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const CURSORS: Record<string, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };

function gridStep(zoom: number) {
  for (const s of [1, 2, 4, 5, 10, 20, 25, 50, 100, 200, 500, 1000]) if (s * zoom >= 8) return s;
  return 1000;
}

export function Canvas() {
  const svg = useStore((s) => s.svg);
  const zoom = useStore((s) => s.zoom);
  const pan = useStore((s) => s.pan);
  const selection = useStore((s) => s.selection);
  const scope = useStore((s) => s.scope);
  const nodeEdit = useStore((s) => s.nodeEdit);
  const hoverId = useStore((s) => s.hoverId);
  const tool = useStore((s) => s.tool);
  const fitReq = useStore((s) => s.fitReq);
  const settings = useStore((s) => s.settings);
  const set = useStore((s) => s.set);

  const vpRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const space = useRef(false);
  const [spaceDown, setSpaceDown] = useState(false);
  const [dragM, setDragM] = useState<Mat | null>(null);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [boxes, setBoxes] = useState<Record<string, Box>>({});
  const [hoverBox, setHoverBox] = useState<Box | null>(null);
  const [nodeMat, setNodeMat] = useState<Mat | null>(null);
  const [nodeSegs, setNodeSegs] = useState<Seg[] | null>(null);
  const [draw, setDraw] = useState<{ box: Box; line?: { a: Pt; b: Pt } } | null>(null);
  const [selNode, setSelNode] = useState<{ i: number; k: number } | null>(null);

  const markup = useMemo(() => renderMarkup(svg), [svg]);
  const size = markup.size;
  const V: Mat = useMemo(() => [zoom, 0, 0, zoom, pan.x - size.x * zoom, pan.y - size.y * zoom], [zoom, pan, size]);
  const Vi = useMemo(() => inv(V), [V]);

  // ---- geometry from live DOM ----
  useLayoutEffect(() => {
    setLiveRoot((docRef.current?.querySelector('svg') as SVGSVGElement) || null);
  }, [markup.html]);

  useLayoutEffect(() => {
    const b: Record<string, Box> = {};
    for (const id of selection) { const bb = rootBBox(id); if (bb) b[id] = bb; }
    setBoxes(b);
    set({ geo: { boxes: b, union: unionBoxes(Object.values(b)) } });
    if (nodeEdit) {
      const el = liveEl(nodeEdit);
      if (el && el.localName === 'path') {
        setNodeMat(elToRoot(el));
        setNodeSegs(toEditable(parsePath(el.getAttribute('d'))));
      } else set({ nodeEdit: null });
    } else { setNodeSegs(null); setSelNode(null); }
  }, [markup.html, selection, nodeEdit, set]);

  useLayoutEffect(() => {
    setHoverBox(hoverId !== null && !selection.includes(hoverId) ? rootBBox(hoverId) : null);
  }, [hoverId, markup.html, selection]);

  // ---- fit view ----
  useLayoutEffect(() => {
    const vp = vpRef.current;
    if (!vp) return;
    const r = vp.getBoundingClientRect();
    const z = Math.max(0.02, Math.min((r.width - 120) / size.w, (r.height - 120) / size.h, 64));
    set({ zoom: z, pan: { x: (r.width - size.w * z) / 2, y: (r.height - size.h * z) / 2 } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitReq]);

  // ---- wheel (non-passive) ----
  useEffect(() => {
    const vp = vpRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = vp.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        A.zoomBy(Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.01)), e.clientX - r.left, e.clientY - r.top);
      } else {
        const s = useStore.getState();
        const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
        const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
        s.set({ pan: { x: s.pan.x - dx, y: s.pan.y - dy } });
      }
    };
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => vp.removeEventListener('wheel', onWheel);
  }, []);

  // ---- space to pan ----
  useEffect(() => {
    const typing = (e: KeyboardEvent) => (e.target as HTMLElement)?.closest?.('input,textarea,select,[contenteditable="true"]');
    const down = (e: KeyboardEvent) => { if (e.code === 'Space' && !typing(e)) { e.preventDefault(); space.current = true; setSpaceDown(true); } };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') { space.current = false; setSpaceDown(false); } };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  const toRoot = useCallback((e: { clientX: number; clientY: number }): Pt => {
    const r = vpRef.current!.getBoundingClientRect();
    return apply(Vi, e.clientX - r.left, e.clientY - r.top);
  }, [Vi]);

  const snap = (v: number) => (settings.snap ? Math.round(v / settings.snapStep) * settings.snapStep : v);

  /** Box (and line endpoints) of a shape being drawn; Shift = proportional / 45°, Alt = from center */
  function drawGeom(start: Pt, raw: Pt, e: { shiftKey: boolean; altKey: boolean }): { box: Box; line?: { a: Pt; b: Pt } } {
    const p = settings.snap ? { x: snap(raw.x), y: snap(raw.y) } : raw;
    let dx = p.x - start.x, dy = p.y - start.y;
    if (settings.shape === 'line') {
      if (e.shiftKey) {
        const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), l = Math.hypot(dx, dy);
        dx = Math.cos(a) * l; dy = Math.sin(a) * l;
      }
      const a = e.altKey ? { x: start.x - dx, y: start.y - dy } : start;
      const b = { x: start.x + dx, y: start.y + dy };
      return { box: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }, line: { a, b } };
    }
    if (e.shiftKey || SQUARE_SHAPES.has(settings.shape)) {
      const m = Math.max(Math.abs(dx), Math.abs(dy));
      dx = Math.sign(dx || 1) * m; dy = Math.sign(dy || 1) * m;
    }
    if (e.altKey) return { box: { x: start.x - Math.abs(dx), y: start.y - Math.abs(dy), w: 2 * Math.abs(dx), h: 2 * Math.abs(dy) } };
    return { box: { x: Math.min(start.x, start.x + dx), y: Math.min(start.y, start.y + dy), w: Math.abs(dx), h: Math.abs(dy) } };
  }

  function pick(target: Element, deep: boolean, scopeId = useStore.getState().scope): string | null {
    const hit = target.closest('[data-eid]');
    if (!hit || !docRef.current?.contains(hit)) return null;
    let id = hit.getAttribute('data-eid')!;
    if (id === '') return null;
    if (deep) {
      let el: Element | null = hit;
      while (el && !GRAPHIC.has(el.localName)) el = el.parentElement;
      const r = el?.getAttribute('data-eid');
      return r ? r : null;
    }
    let sc = scopeId;
    if (!isUnder(id, sc)) { sc = ''; set({ scope: '' }); }
    while (parentId(id) !== sc) id = parentId(id);
    return id;
  }

  function startTransform(kind: 'move' | 'scale' | 'rotate', start: Pt, ids: string[], handle?: string) {
    const box = unionBoxes(ids.map(rootBBox).filter((b): b is Box => !!b));
    if (!box) return;
    const set_ = new Set(ids);
    const items: Item[] = [];
    for (const id of ids) {
      let p = parentId(id), nested = false;
      while (p) { if (set_.has(p)) { nested = true; break; } p = parentId(p); }
      if (nested) continue;
      const el = liveEl(id);
      if (!el) continue;
      items.push({ id, el, orig: el.getAttribute('transform'), P: parentMatrix(el), L: localMatrix(el) });
    }
    drag.current = { kind, start, box, items, handle, moved: false, m: [1, 0, 0, 1, 0, 0] };
  }

  function preview(d: TDrag, M: Mat) {
    d.m = M; d.moved = true;
    for (const it of d.items) {
      const s = matrixToString(mulAll(inv(it.P), M, it.P, it.L), 6);
      if (s) it.el.setAttribute('transform', s); else it.el.removeAttribute('transform');
    }
    setDragM(M);
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) return;
    const vp = vpRef.current!;
    vp.setPointerCapture(e.pointerId);
    const s = useStore.getState();
    const target = e.target as Element;
    if (e.button === 1 || tool === 'pan' || space.current) {
      drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, pan0: s.pan };
      return;
    }
    const p = toRoot(e);
    if (tool === 'shape') {
      const sp = settings.snap ? { x: snap(p.x), y: snap(p.y) } : p;
      drag.current = { kind: 'draw', start: sp, cx: e.clientX, cy: e.clientY, moved: false };
      return;
    }
    const handle = target.closest('[data-handle]')?.getAttribute('data-handle');
    if (handle?.startsWith('node:') && s.nodeEdit) {
      const [, i, k] = handle.split(':').map(Number);
      const el = liveEl(s.nodeEdit) as SVGPathElement;
      const m = elToRoot(el);
      if (el && m && nodeSegs) {
        setSelNode({ i, k });
        const iv = inv(m);
        drag.current = { kind: 'node', el, segs: nodeSegs.map((x) => ({ c: x.c, v: x.v.slice() })), orig: nodeSegs, i, k, start: apply(iv, p.x, p.y), inv: iv, moved: false };
      }
      return;
    }
    if (handle === 'rotate') { startTransform('rotate', p, s.selection); return; }
    if (handle && HANDLES.includes(handle)) { startTransform('scale', p, s.selection, handle); return; }

    const deep = e.metaKey || e.ctrlKey || tool === 'node';
    const id = pick(target, deep);
    if (s.nodeEdit && id !== s.nodeEdit) set({ nodeEdit: null });
    if (id !== null) {
      if (tool === 'node') {
        const el = liveEl(id);
        s.select([id]);
        if (el?.localName === 'path') set({ nodeEdit: id });
        return;
      }
      let sel = s.selection;
      if (e.shiftKey) {
        sel = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
        s.select(sel);
        if (!sel.includes(id)) return;
      } else if (!sel.includes(id)) {
        sel = [id];
        s.select(sel);
      }
      startTransform('move', p, sel);
      return;
    }
    // empty area: inside selection box → move, otherwise marquee
    const u = unionBoxes(Object.values(boxes));
    if (u && !e.shiftKey && p.x >= u.x && p.x <= u.x + u.w && p.y >= u.y && p.y <= u.y + u.h && s.selection.length && !s.nodeEdit) {
      startTransform('move', p, s.selection);
      return;
    }
    if (!e.shiftKey) s.select([]);
    setSelNode(null);
    drag.current = { kind: 'marquee', start: p, add: e.shiftKey, base: e.shiftKey ? s.selection : [] };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) {
      if (tool === 'pan' || tool === 'shape' || space.current) return;
      const id = pick(e.target as Element, e.metaKey || e.ctrlKey || tool === 'node');
      if (id !== useStore.getState().hoverId) set({ hoverId: id });
      return;
    }
    if (d.kind === 'pan') {
      set({ pan: { x: d.pan0.x + e.clientX - d.sx, y: d.pan0.y + e.clientY - d.sy } });
      return;
    }
    const p = toRoot(e);
    if (d.kind === 'draw') {
      if (Math.hypot(e.clientX - d.cx, e.clientY - d.cy) > 3) d.moved = true;
      if (d.moved) setDraw(drawGeom(d.start, p, e));
      return;
    }
    if (d.kind === 'marquee') {
      setMarquee({ x: Math.min(d.start.x, p.x), y: Math.min(d.start.y, p.y), w: Math.abs(p.x - d.start.x), h: Math.abs(p.y - d.start.y) });
      return;
    }
    if (d.kind === 'node') {
      const lp = apply(d.inv, p.x, p.y);
      let dx = lp.x - d.start.x, dy = lp.y - d.start.y;
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      const segs = d.orig.map((x) => ({ c: x.c, v: x.v.slice() }));
      const s = segs[d.i];
      const tx = snap(d.orig[d.i].v[d.k] + dx), ty = snap(d.orig[d.i].v[d.k + 1] + dy);
      const ddx = tx - d.orig[d.i].v[d.k], ddy = ty - d.orig[d.i].v[d.k + 1];
      const isAnchor = (s.c === 'C' && d.k === 4) || ((s.c === 'S' || s.c === 'Q') && d.k === 2) || ['M', 'L', 'T'].includes(s.c) || (s.c === 'A' && d.k === 5);
      if (isAnchor) {
        // move every anchor sharing this position (e.g. start + end of a closed subpath) with its handles
        const ox = d.orig[d.i].v[d.k], oy = d.orig[d.i].v[d.k + 1];
        nodePoints(d.orig).forEach((np) => {
          if (np.kind !== 'anchor' || Math.abs(np.x - ox) > 1e-6 || Math.abs(np.y - oy) > 1e-6) return;
          const sg = segs[np.i];
          sg.v[np.k] = np.x + ddx; sg.v[np.k + 1] = np.y + ddy;
          if (sg.c === 'C') { sg.v[2] += ddx; sg.v[3] += ddy; }
          if (sg.c === 'S') { sg.v[0] += ddx; sg.v[1] += ddy; }
          const nx = segs[np.i + 1];
          if (nx && nx.c === 'C') { nx.v[0] += ddx; nx.v[1] += ddy; }
        });
      } else {
        s.v[d.k] = tx; s.v[d.k + 1] = ty;
      }
      d.segs = segs; d.moved = true;
      d.el.setAttribute('d', serializePath(segs, 6));
      setNodeSegs(segs);
      return;
    }
    const b = d.box;
    if (d.kind === 'move') {
      let dx = p.x - d.start.x, dy = p.y - d.start.y;
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      if (settings.snap) { dx = snap(b.x + dx) - b.x; dy = snap(b.y + dy) - b.y; }
      preview(d as TDrag, translate(dx, dy));
    } else if (d.kind === 'scale') {
      const h = d.handle!;
      const hx = h.includes('w') ? -1 : h.includes('e') ? 1 : 0;
      const hy = h.includes('n') ? -1 : h.includes('s') ? 1 : 0;
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      const ax = e.altKey ? cx : hx === 1 ? b.x : b.x + b.w;
      const ay = e.altKey ? cy : hy === 1 ? b.y : b.y + b.h;
      const ex = hx === 1 ? b.x + b.w : b.x, ey = hy === 1 ? b.y + b.h : b.y;
      let sx = hx && b.w ? (snap(p.x) - ax) / (ex - ax) : 1;
      let sy = hy && b.h ? (snap(p.y) - ay) / (ey - ay) : 1;
      if (e.shiftKey) {
        if (hx && hy) { const s = Math.abs(sx) > Math.abs(sy) ? sx : sy; sx = sy = s; }
        else if (hx) sy = Math.abs(sx); else sx = Math.abs(sy);
      }
      if (!isFinite(sx) || Math.abs(sx) < 1e-6) sx = 1e-6 * Math.sign(sx || 1);
      if (!isFinite(sy) || Math.abs(sy) < 1e-6) sy = 1e-6 * Math.sign(sy || 1);
      preview(d as TDrag, scaleAt(sx, sy, ax, ay));
    } else if (d.kind === 'rotate') {
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      let deg = ((Math.atan2(p.y - cy, p.x - cx) - Math.atan2(d.start.y - cy, d.start.x - cx)) * 180) / Math.PI;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      preview(d as TDrag, rotateAt(deg, cx, cy));
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    vpRef.current?.releasePointerCapture(e.pointerId);
    if (!d) return;
    const s = useStore.getState();
    if (d.kind === 'draw') {
      setDraw(null);
      let g = d.moved ? drawGeom(d.start, toRoot(e), e) : null;
      if (!g || (g.box.w < 1e-6 && g.box.h < 1e-6)) {
        // simple click → default size centered on the click point
        const sz = Math.max(1, Math.round(Math.min(size.w, size.h) / 4));
        const box = { x: d.start.x - sz / 2, y: d.start.y - sz / 2, w: sz, h: sz };
        g = { box, line: { a: { x: box.x, y: d.start.y }, b: { x: box.x + sz, y: d.start.y } } };
      }
      const kind = settings.shape;
      if (kind !== 'line' && (g.box.w < 1e-6 || g.box.h < 1e-6)) return;
      A.insertShape(kind, g.box, g.line);
      set({ tool: 'select' });
      return;
    }
    if (d.kind === 'marquee') {
      const m = marquee;
      setMarquee(null);
      if (m && (m.w > 0 || m.h > 0)) {
        const root = getLiveRoot();
        const scopeEl = s.scope ? liveEl(s.scope) : root;
        const ids = Array.from(scopeEl?.children || [])
          .filter((c) => GRAPHIC.has(c.localName))
          .map((c) => c.getAttribute('data-eid')!)
          .filter((id) => {
            const b = rootBBox(id);
            return b && b.x <= m.x + m.w && b.x + b.w >= m.x && b.y <= m.y + m.h && b.y + b.h >= m.y;
          });
        s.select([...new Set([...d.base, ...ids])]);
      }
      return;
    }
    if (d.kind === 'node') {
      if (d.moved) {
        const before = s.svg;
        A.setAttr(s.nodeEdit!, 'd', serializePath(d.segs, s.settings.precision));
        if (useStore.getState().svg === before) d.el.setAttribute('d', serializePath(d.orig, 6));
      }
      return;
    }
    if (d.kind === 'move' || d.kind === 'scale' || d.kind === 'rotate') {
      setDragM(null);
      const restore = () => d.items.forEach((it) => { if (it.orig === null) it.el.removeAttribute('transform'); else it.el.setAttribute('transform', it.orig); });
      if (!d.moved) { restore(); return; }
      const before = s.svg;
      const label = d.kind === 'move' ? 'Verschieben' : d.kind === 'scale' ? 'Skalieren' : 'Drehen';
      const M = d.m;
      A.edit(label, (doc) => { transformEach(doc, d.items.map((it) => ({ id: it.id, m: M })), A.ctx()); });
      if (useStore.getState().svg === before) restore();
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const s = useStore.getState();
    // pointer capture retargets click events to the viewport → hit-test manually
    const target = document.elementFromPoint(e.clientX, e.clientY) ?? (e.target as Element);
    const id = pick(target, false);
    if (id === null) { set({ scope: '', nodeEdit: null }); return; }
    const el = liveEl(id);
    if (!el) return;
    if (el.localName === 'g' || el.localName === 'a') {
      set({ scope: id });
      const child = pick(target, false, id);
      s.select(child ? [child] : []);
      return;
    }
    if (el.localName === 'path') { s.select([id]); set({ nodeEdit: id }); return; }
    if (SHAPES.has(el.localName)) {
      s.select([id]);
      A.convertToPath();
      set({ nodeEdit: id });
    }
  };

  // ---- overlay rendering ----
  const toVp = (p: Pt) => apply(V, p.x, p.y);
  const poly = (b: Box, m: Mat | null) => boxCorners(b).map((c) => (m ? apply(m, c.x, c.y) : c)).map(toVp);
  const ptsStr = (ps: Pt[]) => ps.map((p) => `${p.x},${p.y}`).join(' ');

  const union = unionBoxes(Object.values(boxes));
  const showHandles = union && !nodeEdit && selection.length > 0 && (!dragM || drag.current?.kind === 'scale');
  let overlay: JSX.Element[] = [];
  if (hoverBox && !dragM) overlay.push(<polygon key="hover" className="ov-hover" points={ptsStr(poly(hoverBox, null))} />);
  if (selection.length > 1 || nodeEdit) {
    Object.entries(boxes).forEach(([id, b]) => overlay.push(<polygon key={'b' + id} className="ov-item" points={ptsStr(poly(b, dragM))} />));
  }
  if (union && !nodeEdit) {
    const c = poly(union, dragM);
    overlay.push(<polygon key="union" className="ov-sel" points={ptsStr(c)} />);
    if (showHandles && drag.current?.kind !== 'rotate') {
      const mid = (a: Pt, b: Pt) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      const hp: Record<string, Pt> = { nw: c[0], n: mid(c[0], c[1]), ne: c[1], e: mid(c[1], c[2]), se: c[2], s: mid(c[2], c[3]), sw: c[3], w: mid(c[3], c[0]) };
      const top = hp.n;
      overlay.push(<line key="rl" className="ov-sel" x1={top.x} y1={top.y} x2={top.x} y2={top.y - 22} />);
      overlay.push(<circle key="rot" data-handle="rotate" className="ov-rot" cx={top.x} cy={top.y - 22} r={5} />);
      const [ax, ay] = settings.anchor;
      const ap = toVp(apply(dragM ?? [1, 0, 0, 1, 0, 0], union.x + ax * union.w, union.y + ay * union.h));
      overlay.push(<circle key="anchor-ref" className="ov-ref" cx={ap.x} cy={ap.y} r={4.5} />);
      for (const h of HANDLES) {
        const p = hp[h];
        overlay.push(<rect key={h} data-handle={h} className="ov-handle" style={{ cursor: CURSORS[h] }} x={p.x - 4} y={p.y - 4} width={8} height={8} />);
      }
    }
    if (!dragM || drag.current?.kind !== 'rotate') {
      const bb = dragM ? transformBox(dragM, union) : union;
      const bottom = Math.max(...c.map((p) => p.y));
      const cx = (Math.min(...c.map((p) => p.x)) + Math.max(...c.map((p) => p.x))) / 2;
      const label = `${+bb.w.toFixed(2)} × ${+bb.h.toFixed(2)}`;
      overlay.push(
        <g key="size" className="ov-size">
          <rect x={cx - label.length * 3.4 - 6} y={bottom + 8} width={label.length * 6.8 + 12} height={18} rx={4} />
          <text x={cx} y={bottom + 21}>{label}</text>
        </g>,
      );
    }
  }
  if (nodeEdit && nodeSegs && nodeMat) {
    const M = mulAll(V, nodeMat);
    const pts = nodePoints(nodeSegs);
    const tp = (x: number, y: number) => apply(M, x, y);
    pts.filter((p) => p.kind === 'ctrl').forEach((p) => {
      const a = tp(p.x, p.y);
      p.links.forEach(([lx, ly], j) => {
        const b = tp(lx, ly);
        overlay.push(<line key={`l${p.i}-${p.k}-${j}`} className="ov-link" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />);
      });
    });
    pts.forEach((p) => {
      const a = tp(p.x, p.y);
      const sel = selNode && selNode.i === p.i && selNode.k === p.k;
      overlay.push(p.kind === 'anchor'
        ? <rect key={`n${p.i}-${p.k}`} data-handle={`node:${p.i}:${p.k}`} className={'ov-anchor' + (sel ? ' on' : '')} x={a.x - 4} y={a.y - 4} width={8} height={8} />
        : <circle key={`n${p.i}-${p.k}`} data-handle={`node:${p.i}:${p.k}`} className={'ov-ctrl' + (sel ? ' on' : '')} cx={a.x} cy={a.y} r={3.5} />);
    });
  }
  if (draw) {
    const spec = shapeSpec(settings.shape, draw.box, { starPoints: settings.starPoints, starInner: settings.starInner, polySides: settings.polySides, prec: 4 }, draw.line);
    overlay.push(
      <g key="draw" transform={`matrix(${V.join(' ')})`}>
        {createElement(spec.tag, { ...spec.attrs, className: 'ov-draw', vectorEffect: 'non-scaling-stroke' })}
      </g>,
    );
    const c = poly(draw.box, null);
    const label = `${+draw.box.w.toFixed(2)} × ${+draw.box.h.toFixed(2)}`;
    const bottom = Math.max(...c.map((q) => q.y)), cx = (c[0].x + c[1].x) / 2;
    overlay.push(
      <g key="draw-size" className="ov-size">
        <rect x={cx - label.length * 3.4 - 6} y={bottom + 8} width={label.length * 6.8 + 12} height={18} rx={4} />
        <text x={cx} y={bottom + 21}>{label}</text>
      </g>,
    );
  }
  if (marquee) overlay.push(<polygon key="mq" className="ov-marquee" points={ptsStr(poly(marquee, null))} />);
  if (scope) {
    const sb = rootBBox(scope);
    if (sb) overlay = [<polygon key="scope" className="ov-scope" points={ptsStr(poly(sb, null))} />, ...overlay];
  }

  const step = gridStep(zoom);
  const gs = step * zoom;
  const stageStyle: React.CSSProperties = {
    left: pan.x, top: pan.y, width: size.w * zoom, height: size.h * zoom,
    backgroundSize: settings.grid ? `${gs}px ${gs}px, ${gs}px ${gs}px` : undefined,
    backgroundPosition: settings.grid ? `${(-size.x % step) * zoom}px ${(-size.y % step) * zoom}px` : undefined,
  };

  return (
    <div
      ref={vpRef}
      className={`viewport ${tool === 'pan' || spaceDown ? 'panning' : ''} ${tool === 'node' || tool === 'shape' ? 'node-tool' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => !drag.current && set({ hoverId: null })}
      onDoubleClick={onDoubleClick}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files[0];
        if (f) f.text().then((t) => A.loadSvg(t, `Datei ${f.name}`));
      }}
    >
      <div className={`stage ${settings.grid ? 'grid' : ''}`} style={stageStyle}>
        <div className="doc" ref={docRef} dangerouslySetInnerHTML={{ __html: markup.html }} />
      </div>
      <svg className="overlay">{overlay}</svg>
      {markup.error && <div className="canvas-error">SVG-Fehler: {markup.error}</div>}
      <div className="pills">
        {scope && (
          <div className="scope-pill" onPointerDown={(e) => e.stopPropagation()}>
            In Gruppe <code>{scope}</code>
            <button onClick={() => set({ scope: '' })}>Verlassen</button>
          </div>
        )}
        {nodeEdit && <div className="scope-pill">Knoten bearbeiten – Punkte ziehen (⇧ = Achse) · Esc beendet</div>}
      </div>
    </div>
  );
}

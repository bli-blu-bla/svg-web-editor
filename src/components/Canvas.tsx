import { createElement, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { selectedNodes, useStore } from '../store';
import {
  apply, boxCorners, inv, matrixToString, mulAll, rotateAt, scaleAt, transformBox, translate, unionBoxes,
  type Box, type Mat, type Pt,
} from '../lib/matrix';
import { boolPreview, transformEach } from '../lib/ops';
import { GRAPHIC, SHAPES, isUnder, parentId, renderMarkup, parentMatrix, localMatrix, tryParse } from '../lib/svg';
import { elToRoot, liveEl, rootBBox, setLiveRoot, getLiveRoot } from '../lib/live';
import { cloneSubs, fromNodes, insertNode, nearestOnPath, nodeKind, pointAt, toNodes, type NodeKind, type NodeRef, type PNode, type SubPath } from '../lib/nodes';
import * as A from '../actions';
import { shapeSpec, SQUARE_SHAPES } from '../lib/shapes';
import { ContextBar, NodeBar } from './ContextBar';
import { layoutBoards } from '../lib/boards';
import { elementPathData } from '../lib/path';

type Item = { id: string; el: SVGGraphicsElement; orig: string | null; P: Mat; L: Mat };
type Drag =
  | { kind: 'pan'; sx: number; sy: number; pan0: { x: number; y: number } }
  | { kind: 'move' | 'scale' | 'rotate'; start: Pt; box: Box; items: Item[]; handle?: string; moved: boolean; m: Mat }
  | { kind: 'marquee'; start: Pt; add: boolean; base: string[] }
  /** marquee over the nodes of the path being edited; hadNodes: a plain click on empty space then leaves node editing */
  | { kind: 'node-marquee'; start: Pt; base: NodeRef[]; hadNodes: boolean }
  | { kind: 'draw'; start: Pt; cx: number; cy: number; moved: boolean }
  | { kind: 'pen'; cx: number; cy: number; moved: boolean }
  | { kind: 'node'; el: SVGPathElement; orig: SubPath[]; subs: SubPath[]; ref: NodeRef; refs: NodeRef[]; part: 'a' | 'in' | 'out'; start: Pt; inv: Mat; moved: boolean; kind0: NodeKind };

type TDrag = Extract<Drag, { items: Item[] }>;
/** A point on an outline: element, segment after node j of subpath s at parameter t, root position, element→root matrix */
type OutlineHit = { id: string; s: number; j: number; t: number; p: Pt; m: Mat; subs: SubPath[] };
const NON_RENDERED = 'defs,clipPath,mask,symbol,marker,pattern';
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const CURSORS: Record<string, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };

function gridStep(zoom: number) {
  for (const s of [1, 2, 4, 5, 10, 20, 25, 50, 100, 200, 500, 1000]) if (s * zoom >= 8) return s;
  return 1000;
}

/** An artboard that is not being edited: a static image, clicking it activates it */
const BoardPreview = memo(function BoardPreview({ id, src, style, grid }: { id: string; src: string; style: React.CSSProperties; grid: boolean }) {
  return (
    <div className={`stage board ${grid ? 'grid' : ''}`} data-board={id} style={style} title="Klicken zum Bearbeiten">
      <img src={src} alt="" draggable={false} />
    </div>
  );
});

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
  const boards = useStore((s) => s.boards);
  const docId = useStore((s) => s.docId);
  const docName = useStore((s) => s.docName);

  const vpRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const space = useRef(false);
  const [spaceDown, setSpaceDown] = useState(false);
  const [dragM, setDragM] = useState<Mat | null>(null);
  const [marquee, setMarquee] = useState<Box | null>(null);
  /** marquee dragged downwards: elements must lie completely inside; upwards: touching is enough */
  const [mqEnclose, setMqEnclose] = useState(true);
  const [boxes, setBoxes] = useState<Record<string, Box>>({});
  const [hoverBox, setHoverBox] = useState<Box | null>(null);
  const [nodeMat, setNodeMat] = useState<Mat | null>(null);
  const [nodeSubs, setNodeSubs] = useState<SubPath[] | null>(null);
  const [draw, setDraw] = useState<{ box: Box; line?: { a: Pt; b: Pt } } | null>(null);
  /** nodes of the path being drawn with the pen tool (root coordinates) */
  const [pen, setPenState] = useState<PNode[] | null>(null);
  const penRef = useRef<PNode[] | null>(null);
  const setPen = (n: PNode[] | null) => { penRef.current = n; setPenState(n); };
  const [penPt, setPenPt] = useState<Pt | null>(null);
  const penClick = useRef<{ t: number; x: number; y: number } | null>(null);
  /** scissors: where a click would cut */
  const [knife, setKnife] = useState<OutlineHit | null>(null);
  /** node editing: where a double-click would add a node */
  const [ghost, setGhost] = useState<Pt | null>(null);
  const selNode = useStore((s) => s.nodeSel);
  const nodeMulti = useStore((s) => s.nodeMulti);
  const selNodes = selectedNodes({ nodeSel: selNode, nodeMulti });
  const boolHover = useStore((s) => s.boolHover);
  const boolBase = useStore((s) => s.boolBase);
  const boolPv = useMemo(() => {
    if (!boolHover || selection.length < 2) return null;
    const { doc } = tryParse(svg);
    try { return doc ? boolPreview(doc, selection, boolHover, boolBase) : null; } catch { return null; }
  }, [boolHover, boolBase, selection, svg]);
  const setSelNode = (r: NodeRef | null) => set({ nodeSel: r, nodeMulti: r ? [r] : [] });
  const sameRef = (a: NodeRef, b: NodeRef) => a.s === b.s && a.j === b.j;

  const markup = useMemo(() => renderMarkup(svg), [svg]);
  const size = markup.size;
  // all artboards share one coordinate space; `pan` is where its origin sits in the viewport
  const layout = useMemo(() => layoutBoards(boards.map((b) => (b.id === docId ? { id: b.id, name: docName, svg } : b))), [boards, docId, docName, svg]);
  const ax = layout.rects.find((r) => r.id === docId)?.x ?? 0;
  const V: Mat = useMemo(() => [zoom, 0, 0, zoom, pan.x + (ax - size.x) * zoom, pan.y - size.y * zoom], [zoom, pan, size, ax]);
  const Vi = useMemo(() => inv(V), [V]);

  // ---- geometry from live DOM ----
  useLayoutEffect(() => {
    setLiveRoot((docRef.current?.querySelector('svg') as SVGSVGElement) || null);
  }, [markup.html, docId]);

  useLayoutEffect(() => {
    const b: Record<string, Box> = {};
    for (const id of selection) { const bb = rootBBox(id); if (bb) b[id] = bb; }
    setBoxes(b);
    set({ geo: { boxes: b, union: unionBoxes(Object.values(b)) } });
    if (nodeEdit) {
      const el = liveEl(nodeEdit);
      if (el && el.localName === 'path') {
        setNodeMat(elToRoot(el));
        setNodeSubs(toNodes(el.getAttribute('d')));
      } else set({ nodeEdit: null });
    } else { setNodeSubs(null); if (useStore.getState().nodeSel) set({ nodeSel: null }); A.resetSmoothNodes(); }
  }, [markup.html, docId, selection, nodeEdit, set]);

  useLayoutEffect(() => {
    setHoverBox(hoverId !== null && !selection.includes(hoverId) ? rootBBox(hoverId) : null);
  }, [hoverId, markup.html, docId, selection]);

  // ---- fit view ----
  useLayoutEffect(() => {
    const vp = vpRef.current;
    if (!vp) return;
    const r = vp.getBoundingClientRect();
    const z = Math.max(0.02, Math.min((r.width - 120) / size.w, (r.height - 120) / size.h, 64));
    set({ zoom: z, pan: { x: (r.width - size.w * z) / 2 - ax * z, y: (r.height - size.h * z) / 2 } });
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

  // ---- pen tool: finish on Enter/Esc/tool change, Backspace/⌘Z removes the last node ----
  const finishPen = useCallback((closed: boolean) => {
    const nodes = penRef.current;
    penRef.current = null;
    setPenState(null);
    if (nodes && nodes.length >= 2) A.insertPenPath(nodes, closed);
  }, []);

  useEffect(() => {
    if (tool !== 'pen') { finishPen(false); setPenPt(null); }
    if (tool !== 'knife') setKnife(null);
  }, [tool, finishPen]);

  useEffect(() => { setGhost(null); }, [nodeEdit, markup.html]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const nodes = penRef.current;
      if (!nodes) return;
      const k = e.key.toLowerCase();
      const undo = (e.metaKey || e.ctrlKey) && k === 'z' && !e.shiftKey;
      if (k === 'enter' || k === 'escape') finishPen(false);
      else if (k === 'backspace' || k === 'delete' || undo) setPen(nodes.length > 1 ? nodes.slice(0, -1) : null);
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [finishPen]);

  const toRoot = useCallback((e: { clientX: number; clientY: number }): Pt => {
    const r = vpRef.current!.getBoundingClientRect();
    return apply(Vi, e.clientX - r.left, e.clientY - r.top);
  }, [Vi]);

  const snap = (v: number) => (settings.snap ? Math.round(v / settings.snapStep) * settings.snapStep : v);

  /** Pen position: snapped, Shift locks the angle to the previous node in 45° steps */
  function penPoint(raw: Pt, shift: boolean, from?: Pt | null): Pt {
    const p = { x: snap(raw.x), y: snap(raw.y) };
    if (!shift || !from) return p;
    const dx = p.x - from.x, dy = p.y - from.y;
    const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), l = Math.hypot(dx, dy);
    return { x: from.x + Math.cos(a) * l, y: from.y + Math.sin(a) * l };
  }

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

  /**
   * Closest outline point within 8 px of the pointer, over all visible paths and shapes (inside the current group if any).
   * Snaps to an existing node when the pointer is close to it.
   */
  function outlineHit(p: Pt): OutlineHit | null {
    const root = getLiveRoot();
    if (!root) return null;
    const sc = useStore.getState().scope;
    const base = sc ? liveEl(sc) : root;
    let best: OutlineHit | null = null, bestD = 8;
    for (const el of Array.from(base?.querySelectorAll<SVGGraphicsElement>('path,rect,circle,ellipse,line,polyline,polygon') ?? [])) {
      if (el.closest(NON_RENDERED)) continue;
      const m = elToRoot(el);
      const id = el.getAttribute('data-eid');
      if (!m || !id) continue;
      const subs = toNodes(elementPathData(el));
      const lp = apply(inv(m), p.x, p.y);
      const h = nearestOnPath(subs, lp);
      if (!h) continue;
      const sp = subs[h.s], a = sp.nodes[h.j], b = sp.nodes[(h.j + 1) % sp.nodes.length];
      const lq = pointAt(a, b, h.t), q = apply(m, lq.x, lq.y);
      const d = Math.hypot(q.x - p.x, q.y - p.y) * zoom;
      if (d >= bestD) continue;
      bestD = d;
      // snap onto a node nearby
      const sa = apply(m, a.x, a.y), sb = apply(m, b.x, b.y);
      const da = Math.hypot(sa.x - p.x, sa.y - p.y) * zoom, db = Math.hypot(sb.x - p.x, sb.y - p.y) * zoom;
      const t = da < 6 && da <= db ? 0 : db < 6 ? 1 : h.t;
      best = { id, s: h.s, j: h.j, t, p: t === 0 ? sa : t === 1 ? sb : q, m, subs };
    }
    return best;
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
    const board = target.closest('[data-board]')?.getAttribute('data-board');
    if (board) {
      finishPen(false);
      s.activateBoard(board);
      return;
    }
    const p = toRoot(e);
    if (tool === 'pen') {
      const nodes = penRef.current;
      // the second click of a double-click ends the path (the first one already placed the node);
      // PointerEvent.detail is always 0, so detect it by time and distance
      const lc = penClick.current;
      penClick.current = { t: e.timeStamp, x: e.clientX, y: e.clientY };
      if (nodes && lc && e.timeStamp - lc.t < 400 && Math.hypot(e.clientX - lc.x, e.clientY - lc.y) < 5) { penClick.current = null; finishPen(false); return; }
      const last = nodes?.[nodes.length - 1];
      const q = penPoint(p, e.shiftKey, last);
      if (nodes && nodes.length >= 2) {
        const f = apply(V, nodes[0].x, nodes[0].y), c = apply(V, p.x, p.y);
        if (Math.hypot(f.x - c.x, f.y - c.y) < 8) { finishPen(true); return; }
      }
      setPen([...(nodes ?? []), { x: q.x, y: q.y, hin: null, hout: null }]);
      drag.current = { kind: 'pen', cx: e.clientX, cy: e.clientY, moved: false };
      return;
    }
    if (tool === 'knife') {
      const h = outlineHit(p);
      if (h) { A.cutPath(h.id, h.s, h.j, h.t); setKnife(null); }
      return;
    }
    if (tool === 'shape') {
      const sp = settings.snap ? { x: snap(p.x), y: snap(p.y) } : p;
      drag.current = { kind: 'draw', start: sp, cx: e.clientX, cy: e.clientY, moved: false };
      return;
    }
    const handle = target.closest('[data-handle]')?.getAttribute('data-handle');
    if (handle?.startsWith('node:') && s.nodeEdit) {
      const [, ss, jj, part] = handle.split(':');
      const ref = { s: +ss, j: +jj };
      const el = liveEl(s.nodeEdit) as SVGPathElement;
      const m = el && elToRoot(el);
      if (el && m && nodeSubs) {
        let refs = [ref];
        if (part === 'a') {
          // Shift toggles the node; clicking a selected node keeps the selection so all of them can be dragged
          const cur = selectedNodes(s);
          const inSel = cur.some((r) => sameRef(r, ref));
          if (e.shiftKey) {
            const next = inSel ? cur.filter((r) => !sameRef(r, ref)) : [...cur, ref];
            set({ nodeSel: next.length ? (inSel ? next[next.length - 1] : ref) : null, nodeMulti: next });
            if (inSel) return;
            refs = next;
          } else if (inSel) {
            set({ nodeSel: ref });
            refs = cur;
          } else setSelNode(ref);
        }
        const iv = inv(m);
        const node = nodeSubs[ref.s]?.nodes[ref.j];
        drag.current = {
          kind: 'node', el, orig: nodeSubs, subs: nodeSubs, ref, refs, part: part as 'a' | 'in' | 'out',
          start: apply(iv, p.x, p.y), inv: iv, moved: false, kind0: node ? A.effNodeKind(node, ref) : 'corner',
        };
      }
      return;
    }
    if (handle === 'rotate') { startTransform('rotate', p, s.selection); return; }
    if (handle && HANDLES.includes(handle)) { startTransform('scale', p, s.selection, handle); return; }

    const deep = e.metaKey || e.ctrlKey || tool === 'node';
    const id = pick(target, deep);
    // node editing: empty space (or the path itself with the node tool) starts a marquee over the nodes
    if (s.nodeEdit && (id === null || (id === s.nodeEdit && tool === 'node'))) {
      const cur = selectedNodes(s);
      if (!e.shiftKey) set({ nodeSel: null, nodeMulti: [] });
      drag.current = { kind: 'node-marquee', start: p, base: e.shiftKey ? cur : [], hadNodes: cur.length > 0 || id !== null };
      return;
    }
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
    if (!d || d.kind !== 'pan') set({ cursor: toRoot(e) });
    if (!d) {
      if (tool === 'pen') { const n = penRef.current; setPenPt(penPoint(toRoot(e), e.shiftKey, n?.[n.length - 1])); return; }
      if (tool === 'knife') { setKnife(outlineHit(toRoot(e))); return; }
      if (nodeEdit && nodeSubs && nodeMat) {
        // preview where a double-click adds a node, unless a node or handle is under the pointer
        const rp = toRoot(e);
        const h = (e.target as Element).closest('[data-handle]') ? null : nearestOnPath(nodeSubs, apply(inv(nodeMat), rp.x, rp.y));
        const scale = Math.sqrt(Math.abs(nodeMat[0] * nodeMat[3] - nodeMat[1] * nodeMat[2])) * zoom;
        if (h && h.dist * scale < 8) {
          const sp = nodeSubs[h.s];
          const q = pointAt(sp.nodes[h.j], sp.nodes[(h.j + 1) % sp.nodes.length], h.t);
          setGhost(apply(nodeMat, q.x, q.y));
        } else if (ghost) setGhost(null);
      }
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
    if (d.kind === 'pen') {
      // dragging pulls out symmetric handles → smooth curve node
      const nodes = penRef.current;
      if (!nodes) return;
      if (Math.hypot(e.clientX - d.cx, e.clientY - d.cy) > 3) d.moved = true;
      if (!d.moved) return;
      const n = nodes[nodes.length - 1];
      const h = penPoint(p, e.shiftKey, n);
      setPen([...nodes.slice(0, -1), { x: n.x, y: n.y, hout: h, hin: { x: 2 * n.x - h.x, y: 2 * n.y - h.y } }]);
      setPenPt(null);
      return;
    }
    if (d.kind === 'draw') {
      if (Math.hypot(e.clientX - d.cx, e.clientY - d.cy) > 3) d.moved = true;
      if (d.moved) setDraw(drawGeom(d.start, p, e));
      return;
    }
    if (d.kind === 'marquee' || d.kind === 'node-marquee') {
      setMqEnclose(p.y >= d.start.y);
      setMarquee({ x: Math.min(d.start.x, p.x), y: Math.min(d.start.y, p.y), w: Math.abs(p.x - d.start.x), h: Math.abs(p.y - d.start.y) });
      return;
    }
    if (d.kind === 'node') {
      const lp = apply(d.inv, p.x, p.y);
      let dx = lp.x - d.start.x, dy = lp.y - d.start.y;
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      const subs = cloneSubs(d.orig);
      const n = subs[d.ref.s]?.nodes[d.ref.j];
      const o = d.orig[d.ref.s]?.nodes[d.ref.j];
      if (!n || !o) return;
      if (d.part === 'a') {
        // anchors drag their handles along; all selected nodes move by the dragged node's (snapped) delta
        const tx = snap(o.x + dx) - o.x, ty = snap(o.y + dy) - o.y;
        A.moveNodes(subs, d.refs.some((r) => sameRef(r, d.ref)) ? d.refs : [d.ref], tx, ty);
      } else {
        const own = d.part === 'in' ? 'hin' : 'hout', other = d.part === 'in' ? 'hout' : 'hin';
        const h0 = o[own]!;
        const h = { x: snap(h0.x + dx), y: snap(h0.y + dy) };
        n[own] = h;
        // smooth / symmetric nodes keep the opposite handle in line (Alt breaks the link)
        const opp = o[other];
        if (opp && d.kind0 !== 'corner' && !e.altKey) {
          const vx = n.x - h.x, vy = n.y - h.y, l = Math.hypot(vx, vy) || 1;
          const ol = d.kind0 === 'symmetric' ? l : Math.hypot(opp.x - o.x, opp.y - o.y);
          n[other] = { x: n.x + (vx / l) * ol, y: n.y + (vy / l) * ol };
        }
      }
      d.subs = subs; d.moved = true;
      d.el.setAttribute('d', fromNodes(subs, 6));
      setNodeSubs(subs);
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
    if (d.kind === 'node-marquee') {
      const m = marquee;
      setMarquee(null);
      if (!m || (m.w === 0 && m.h === 0)) {
        // plain click on empty space with nothing selected → leave node editing
        if (!d.hadNodes) { set({ nodeEdit: null }); s.select([]); }
        return;
      }
      if (!nodeSubs || !nodeMat) return;
      const hits: NodeRef[] = [];
      nodeSubs.forEach((sp, si) => sp.nodes.forEach((n, j) => {
        const q = apply(nodeMat, n.x, n.y);
        if (q.x >= m.x && q.x <= m.x + m.w && q.y >= m.y && q.y <= m.y + m.h) hits.push({ s: si, j });
      }));
      const all = [...d.base, ...hits.filter((h) => !d.base.some((b) => sameRef(b, h)))];
      set({ nodeSel: all.length ? all[all.length - 1] : null, nodeMulti: all });
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
            if (!b) return false;
            return mqEnclose
              ? b.x >= m.x && b.x + b.w <= m.x + m.w && b.y >= m.y && b.y + b.h <= m.y + m.h
              : b.x <= m.x + m.w && b.x + b.w >= m.x && b.y <= m.y + m.h && b.y + b.h >= m.y;
          });
        s.select([...new Set([...d.base, ...ids])]);
      }
      return;
    }
    if (d.kind === 'node') {
      if (d.moved) {
        const before = s.svg;
        A.setAttr(s.nodeEdit!, 'd', fromNodes(d.subs, s.settings.precision));
        if (useStore.getState().svg === before) d.el.setAttribute('d', fromNodes(d.orig, 6));
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
    if (tool === 'pen') return;
    const s = useStore.getState();
    // pointer capture retargets click events to the viewport → hit-test manually
    const target = document.elementFromPoint(e.clientX, e.clientY) ?? (e.target as Element);
    if (s.nodeEdit && nodeSubs && nodeMat) {
      const h = target.closest('[data-handle]')?.getAttribute('data-handle');
      if (h?.startsWith('node:')) {
        // double-click on a node: corner ↔ smooth
        const [, ss, jj, part] = h.split(':');
        if (part === 'a') A.toggleNodeKind({ s: +ss, j: +jj });
        return;
      }
      // double-click on the outline: add a node there
      const rp = toRoot(e);
      const lp = apply(inv(nodeMat), rp.x, rp.y);
      const hit = nearestOnPath(nodeSubs, lp);
      const scale = Math.sqrt(Math.abs(nodeMat[0] * nodeMat[3] - nodeMat[1] * nodeMat[2])) * zoom;
      if (hit && hit.dist * scale < 8) {
        A.editNodes('Knoten hinzufügen', (subs) => insertNode(subs, hit.s, hit.j, hit.t)); A.resetSmoothNodes();
        return;
      }
    }
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
  if (nodeEdit && nodeSubs && nodeMat) {
    const M = mulAll(V, nodeMat);
    const tp = (q: { x: number; y: number }) => apply(M, q.x, q.y);
    const handles: JSX.Element[] = [], anchors: JSX.Element[] = [];
    nodeSubs.forEach((sp, si) => sp.nodes.forEach((n, j) => {
      const a = tp(n);
      const key = `${si}:${j}`;
      const isSel = selNodes.some((r) => r.s === si && r.j === j);
      (['hin', 'hout'] as const).forEach((hk) => {
        const hp = n[hk];
        if (!hp) return;
        const b = tp(hp);
        handles.push(<line key={`l${key}${hk}`} className="ov-link" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />);
        handles.push(<circle key={`h${key}${hk}`} data-handle={`node:${key}:${hk === 'hin' ? 'in' : 'out'}`} className="ov-ctrl" cx={b.x} cy={b.y} r={3.5} />);
      });
      const kind = nodeKind(n);
      const cls = 'ov-anchor' + (isSel ? ' on' : '');
      anchors.push(kind === 'corner'
        ? <rect key={`a${key}`} data-handle={`node:${key}:a`} className={cls} x={a.x - 4} y={a.y - 4} width={8} height={8} />
        : <circle key={`a${key}`} data-handle={`node:${key}:a`} className={cls + ' smooth'} cx={a.x} cy={a.y} r={4.5} />);
    }));
    overlay.push(...handles, ...anchors);
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
  if (pen && pen.length) {
    const M = V;
    const tp = (q: Pt) => apply(M, q.x, q.y);
    const last = pen[pen.length - 1];
    const f = tp(pen[0]);
    const closing = !!penPt && pen.length >= 2 && Math.hypot(tp(penPt).x - f.x, tp(penPt).y - f.y) < 8;
    const rubber = penPt && (() => {
      const a = tp(last), b = closing ? f : tp(penPt), h = last.hout ? tp(last.hout) : null;
      const hb = closing && pen[0].hin ? tp(pen[0].hin) : b;
      return h || hb !== b ? `M${a.x} ${a.y}C${(h ?? a).x} ${(h ?? a).y} ${hb.x} ${hb.y} ${b.x} ${b.y}` : `M${a.x} ${a.y}L${b.x} ${b.y}`;
    })();
    overlay.push(
      <g key="pen">
        <path className="ov-pen" d={fromNodes([{ nodes: pen, closed: false }], 6)} transform={`matrix(${M.join(' ')})`} vectorEffect="non-scaling-stroke" />
        {rubber && <path className="ov-pen rubber" d={rubber} />}
        {(['hin', 'hout'] as const).map((hk) => {
          const hp = last[hk];
          if (!hp) return null;
          const a = tp(last), b = tp(hp);
          return (
            <g key={hk}>
              <line className="ov-link" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
              <circle className="ov-ctrl" cx={b.x} cy={b.y} r={3.5} />
            </g>
          );
        })}
        {pen.map((n, j) => {
          const a = tp(n);
          const r = j === 0 && closing ? 6 : 4;
          return <rect key={j} className={`ov-anchor ${j === pen.length - 1 || (j === 0 && closing) ? 'on' : ''}`} x={a.x - r} y={a.y - r} width={2 * r} height={2 * r} />;
        })}
      </g>,
    );
  }
  if (boolPv && !dragM) {
    // boolean preview: base solid, cutters dashed red, result filled
    const cut = boolHover === 'subtract';
    const vm = `matrix(${V.join(' ')})`;
    const tag = (id: string, text: string, cls: string) => {
      const b = rootBBox(id);
      if (!b) return null;
      const p = toVp({ x: b.x, y: b.y });
      const w = text.length * 6.6 + 12;
      return (
        <g key={'t' + id} className={`ov-tag ${cls}`}>
          <rect x={p.x} y={p.y - 22} width={w} height={18} rx={4} />
          <text x={p.x + w / 2} y={p.y - 9}>{text}</text>
        </g>
      );
    };
    overlay.push(
      <g key="bool">
        <path className="ov-bool-result" d={boolPv.result} transform={vm} vectorEffect="non-scaling-stroke" />
        {boolPv.others.map((o) => <path key={o.id} className={cut ? 'ov-bool-cut' : 'ov-bool-op'} d={o.d} transform={vm} vectorEffect="non-scaling-stroke" />)}
        <path className="ov-bool-base" d={boolPv.base} transform={vm} vectorEffect="non-scaling-stroke" />
        {boolPv.others.map((o) => tag(o.id, cut ? 'Schneidet' : 'Operand', cut ? 'cut' : 'op'))}
        {tag(boolPv.baseId, 'Basis', 'base')}
      </g>,
    );
  }
  if (knife) {
    const c = toVp(knife.p);
    overlay.push(
      <g key="knife">
        <path className="ov-cut-path" d={fromNodes(knife.subs, 6)} transform={`matrix(${mulAll(V, knife.m).join(' ')})`} vectorEffect="non-scaling-stroke" />
        <circle className="ov-cut" cx={c.x} cy={c.y} r={knife.t === 0 || knife.t === 1 ? 6 : 4.5} />
      </g>,
    );
  }
  if (ghost && nodeEdit && !drag.current) {
    const c = toVp(ghost);
    overlay.push(<circle key="ghost" className="ov-ghost" cx={c.x} cy={c.y} r={4} />);
  }
  if (marquee) {
    const nodesMq = drag.current?.kind === 'node-marquee';
    overlay.push(<polygon key="mq" className={`ov-marquee ${nodesMq ? '' : mqEnclose ? 'enclose' : 'touch'}`} points={ptsStr(poly(marquee, null))} />);
    if (!nodesMq) {
      const c = toVp({ x: marquee.x, y: marquee.y + marquee.h });
      const label = mqEnclose ? 'Vollständig enthalten' : 'Berühren genügt';
      overlay.push(
        <g key="mq-label" className={`ov-tag ${mqEnclose ? 'base' : 'touch'}`}>
          <rect x={c.x} y={c.y + 4} width={label.length * 6.6 + 12} height={18} rx={4} />
          <text x={c.x + (label.length * 6.6 + 12) / 2} y={c.y + 17}>{label}</text>
        </g>,
      );
    }
  }
  if (scope) {
    const sb = rootBBox(scope);
    if (sb) overlay = [<polygon key="scope" className="ov-scope" points={ptsStr(poly(sb, null))} />, ...overlay];
  }

  const step = gridStep(zoom);
  const gs = step * zoom;
  const boardStyle = (x: number, sz: { x: number; y: number; w: number; h: number }): React.CSSProperties => ({
    left: pan.x + x * zoom, top: pan.y, width: sz.w * zoom, height: sz.h * zoom,
    backgroundSize: settings.grid ? `${gs}px ${gs}px, ${gs}px ${gs}px` : undefined,
    backgroundPosition: settings.grid ? `${(-sz.x % step) * zoom}px ${(-sz.y % step) * zoom}px` : undefined,
  });
  const multi = layout.rects.length > 1;

  return (
    <div
      ref={vpRef}
      className={`viewport ${tool === 'pan' || spaceDown ? 'panning' : ''} ${tool === 'node' || tool === 'shape' || tool === 'pen' || tool === 'knife' ? 'node-tool' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => { if (!drag.current) { set({ hoverId: null, cursor: null }); setKnife(null); setGhost(null); } }}
      onDoubleClick={onDoubleClick}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        A.openFiles(Array.from(e.dataTransfer.files));
      }}
    >
      {layout.rects.map((r) => (r.id === docId
        ? (
          <div key={r.id} className={`stage ${multi ? 'active' : ''} ${settings.grid ? 'grid' : ''}`} style={boardStyle(ax, size)}>
            <div className="doc" ref={docRef} dangerouslySetInnerHTML={{ __html: markup.html }} />
          </div>
        )
        : <BoardPreview key={r.id} id={r.id} src={r.src} grid={settings.grid} style={boardStyle(r.x, r.size)} />))}
      {multi && layout.rects.map((r) => (
        <div key={r.id} className={`board-label ${r.id === docId ? 'on' : ''}`}
          style={{ left: pan.x + r.x * zoom, top: pan.y - 26, maxWidth: Math.max(48, r.size.w * zoom) }}
          onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}
          onClick={() => { finishPen(false); useStore.getState().activateBoard(r.id); }}>
          <span>{r.name}</span>
          <button title="Zeichenfläche schließen" onClick={(e) => { e.stopPropagation(); useStore.getState().closeBoard(r.id); }}><X size={12} /></button>
        </div>
      ))}
      <svg className="overlay">{overlay}</svg>
      {markup.error && <div className="canvas-error">SVG-Fehler: {markup.error}</div>}
      {settings.contextBar && !dragM && !marquee && !draw && tool !== 'shape' && tool !== 'pan' && tool !== 'pen' && tool !== 'knife' && (() => {
        const vw = vpRef.current?.clientWidth ?? 800;
        const clampX = (x: number) => Math.max(170, Math.min(vw - 170, x));
        if (nodeEdit && selNode && nodeSubs && nodeMat) {
          const n = nodeSubs[selNode.s]?.nodes[selNode.j];
          if (!n) return null;
          const a = apply(mulAll(V, nodeMat), n.x, n.y);
          return <NodeBar x={clampX(a.x)} y={a.y + 20} node={n} />;
        }
        if (!union || nodeEdit) return null;
        const c = poly(union, null);
        const minY = Math.min(...c.map((q) => q.y)), maxY = Math.max(...c.map((q) => q.y));
        const cx = (Math.min(...c.map((q) => q.x)) + Math.max(...c.map((q) => q.x))) / 2;
        const above = minY - 84 > 4;
        return <ContextBar x={clampX(cx)} y={above ? minY - 84 : maxY + 36} count={selection.length} />;
      })()}
      {tool === 'pen' && (
        <div className="key-hints">
          <span><kbd>Klick</kbd> Eckpunkt</span>
          <span><kbd>Ziehen</kbd> Kurvenpunkt</span>
          <span><kbd>⇧</kbd> 45°-Winkel</span>
          <span><kbd>Klick auf Start</kbd> Schließen</span>
          <span><kbd>Enter</kbd> / <kbd>Doppelklick</kbd> Beenden</span>
          <span><kbd>⌫</kbd> Letzten Punkt entfernen</span>
        </div>
      )}
      {tool === 'knife' && (
        <div className="key-hints">
          <span><kbd>Klick auf Kontur</kbd> Pfad schneiden</span>
          <span>Offene Pfade zerfallen in zwei, geschlossene werden geöffnet</span>
          <span><kbd>Esc</kbd> Fertig</span>
        </div>
      )}
      {nodeEdit && tool !== 'knife' && (
        <div className="key-hints">
          <span><kbd>Doppelklick</kbd> Ecke ↔ Glatt</span>
          <span><kbd>Doppelklick Kontur</kbd> Knoten einfügen</span>
          <span><kbd>Rahmen ziehen</kbd> / <kbd>⇧ Klick</kbd> Mehrere Knoten</span>
          <span><kbd>⌥</kbd> Anfasser lösen</span>
          <span><kbd>⇧</kbd> Achse sperren</span>
          <span><kbd>⌫</kbd> Knoten löschen</span>
          <span><kbd>Esc</kbd> Fertig</span>
        </div>
      )}
    </div>
  );
}

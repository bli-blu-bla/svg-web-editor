import { useStore } from './store';
import { inv as invMat, mulAll, rotateAt, scaleAt, translate, unionBoxes, type Box, type Mat, type Pt } from './lib/matrix';
import * as ops from './lib/ops';
import { cleanSvgString, getEl, isSelectable, kids, parseSvg, serialize, idOf, docSize, prettyPrint, SVGNS } from './lib/svg';
import { minify } from './lib/minify';
import type { BoolOp } from './lib/area';
import { deleteNode, fromNodes, nodeKind, setNodeKind, toNodes, type NodeKind, type NodeRef, type PNode, type SubPath } from './lib/nodes';
import { shapeSpec, SHAPE_LABELS, type ShapeKind } from './lib/shapes';
import { elToRoot, liveEl, rootBBox } from './lib/live';

const st = () => useStore.getState();
export const ctx = (): ops.Ctx => {
  const s = st().settings;
  return { prec: s.precision, autoBake: s.autoBake, scaleStrokes: s.scaleStrokes };
};

/** Parse current doc, run fn, commit result */
export function edit(label: string, fn: (doc: Document) => string[] | void, opts: { key?: string } = {}) {
  const s = st();
  try {
    const doc = parseSvg(s.svg);
    const sel = fn(doc);
    s.commit(serialize(doc), label, { selection: sel ?? s.selection, key: opts.key });
  } catch (e) {
    console.error(e);
    s.notify('Fehler: ' + (e as Error).message);
  }
}

export function loadSvg(text: string, label = 'Importiert') {
  try {
    const clean = cleanSvgString(text);
    st().commit(clean, label, { selection: [] });
    st().set({ scope: '', nodeEdit: null, fitReq: st().fitReq + 1 });
  } catch (e) {
    st().notify('Ungültiges SVG: ' + (e as Error).message);
  }
}

export function newDocument() {
  const v = window.prompt('Größe des neuen Dokuments (Breite x Höhe)', '24 x 24');
  if (!v) return;
  const [w, h] = v.split(/[x×, ]+/).map(Number);
  if (!(w > 0 && h > 0)) return st().notify('Ungültige Größe');
  loadSvg(`<svg xmlns="${SVGNS}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"></svg>`, 'Neues Dokument');
}

// ---------- selection ----------
function scopeChildren(doc: Document, scope: string): string[] {
  const el = getEl(doc, scope) || doc.documentElement;
  return kids(el).filter(isSelectable).map(idOf);
}

export function selectAll() {
  const s = st();
  const doc = parseSvg(s.svg);
  s.select(scopeChildren(doc, s.scope));
}

export function selectionBox(ids = st().selection): Box | null {
  return unionBoxes(ids.map(rootBBox).filter((b): b is Box => !!b));
}

// ---------- transforms ----------
export function transformSelection(m: Mat, label: string, key?: string) {
  const ids = st().selection;
  if (!ids.length) return;
  edit(label, (doc) => { ops.transformAll(doc, ids, m, ctx()); }, { key });
}

export function nudge(dx: number, dy: number) {
  transformSelection(translate(dx, dy), 'Verschieben', 'nudge');
}

export function setBox(nb: Partial<Box>) {
  const b = selectionBox();
  if (!b) return;
  const t = { ...b, ...nb };
  const sx = b.w ? t.w / b.w : 1, sy = b.h ? t.h / b.h : 1;
  transformSelection(mulAll(translate(t.x, t.y), scaleAt(sx, sy), translate(-b.x, -b.y)), 'Größe/Position');
}

/** The selected reference point (anchor) of a box */
export function anchorPoint(b: Box) {
  const [ax, ay] = st().settings.anchor;
  return { x: b.x + ax * b.w, y: b.y + ay * b.h };
}

/** Set position/size relative to the reference point: x/y are the anchor's coordinates, size changes keep the anchor fixed */
export function setAnchored(p: { x?: number; y?: number; w?: number; h?: number }) {
  const b = selectionBox();
  if (!b) return;
  const [ax, ay] = st().settings.anchor;
  const ref = anchorPoint(b);
  const w = p.w ?? b.w, h = p.h ?? b.h;
  setBox({ x: (p.x ?? ref.x) - ax * w, y: (p.y ?? ref.y) - ay * h, w, h });
}

export function scaleSelection(sx: number, sy = sx) {
  const b = selectionBox();
  if (!b) return;
  const a = anchorPoint(b);
  transformSelection(scaleAt(sx, sy, a.x, a.y), 'Skalieren');
}

export function rotateSelection(deg: number) {
  const b = selectionBox();
  if (!b) return;
  const a = anchorPoint(b);
  transformSelection(rotateAt(deg, a.x, a.y), 'Drehen');
}

export function flip(axis: 'h' | 'v') {
  const b = selectionBox();
  if (!b) return;
  const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  transformSelection(axis === 'h' ? scaleAt(-1, 1, c.x, c.y) : scaleAt(1, -1, c.x, c.y), axis === 'h' ? 'Horizontal spiegeln' : 'Vertikal spiegeln');
}

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';
export function align(mode: AlignMode, toDocument: boolean) {
  const s = st();
  const ids = s.selection;
  const boxes = ids.map((id) => ({ id, b: rootBBox(id) })).filter((x): x is { id: string; b: Box } => !!x.b);
  if (!boxes.length) return;
  let T: Box | null;
  if (toDocument || boxes.length === 1) {
    const d = docSize(parseSvg(s.svg).documentElement);
    T = { x: d.x, y: d.y, w: d.w, h: d.h };
  } else T = unionBoxes(boxes.map((x) => x.b));
  if (!T) return;
  const items = boxes.map(({ id, b }) => {
    let dx = 0, dy = 0;
    if (mode === 'left') dx = T!.x - b.x;
    if (mode === 'hcenter') dx = T!.x + T!.w / 2 - (b.x + b.w / 2);
    if (mode === 'right') dx = T!.x + T!.w - (b.x + b.w);
    if (mode === 'top') dy = T!.y - b.y;
    if (mode === 'vcenter') dy = T!.y + T!.h / 2 - (b.y + b.h / 2);
    if (mode === 'bottom') dy = T!.y + T!.h - (b.y + b.h);
    return { id, m: translate(dx, dy) };
  });
  edit('Ausrichten', (doc) => { ops.transformEach(doc, items, ctx()); });
}

export function distribute(axis: 'h' | 'v') {
  const ids = st().selection;
  const boxes = ids.map((id) => ({ id, b: rootBBox(id) })).filter((x): x is { id: string; b: Box } => !!x.b);
  if (boxes.length < 3) return st().notify('Mindestens 3 Elemente zum Verteilen auswählen');
  const key = axis === 'h' ? 'x' : 'y', size = axis === 'h' ? 'w' : 'h';
  boxes.sort((a, b) => a.b[key] - b.b[key]);
  const first = boxes[0].b, last = boxes[boxes.length - 1].b;
  const total = boxes.reduce((s, x) => s + x.b[size], 0);
  const gap = (last[key] + last[size] - first[key] - total) / (boxes.length - 1);
  let pos = first[key];
  const items = boxes.map(({ id, b }) => {
    const d = pos - b[key];
    pos += b[size] + gap;
    return { id, m: axis === 'h' ? translate(d, 0) : translate(0, d) };
  });
  edit('Verteilen', (doc) => { ops.transformEach(doc, items, ctx()); });
}

// ---------- structure ----------
export function deleteSelection() {
  const ids = st().selection;
  if (!ids.length) return;
  edit('Löschen', (doc) => { ops.deleteEls(doc, ids); return []; });
}
export function duplicateSelection() {
  const ids = st().selection;
  if (!ids.length) return;
  edit('Duplizieren', (doc) => ops.duplicate(doc, ids));
}
export function groupSelection() {
  const ids = st().selection;
  if (!ids.length) return;
  edit('Gruppieren', (doc) => ops.group(doc, ids, ctx().prec));
}
export function ungroupSelection() {
  const ids = st().selection;
  if (!ids.length) return;
  edit('Gruppierung aufheben', (doc) => ops.ungroup(doc, ids, ctx()));
}
export function arrange(dir: ops.Arrange) {
  const ids = st().selection;
  if (!ids.length) return;
  edit('Anordnen', (doc) => ops.reorder(doc, ids, dir));
}
export function convertToPath() {
  const ids = st().selection;
  if (!ids.length) return;
  edit('In Pfad umwandeln', (doc) => ops.convertToPath(doc, ids, ctx().prec));
}
export function applyTransforms() {
  const ids = st().selection;
  if (!ids.length) return;
  edit('Transformation anwenden', (doc) => { ops.bakeTransforms(doc, ids, { ...ctx(), autoBake: true }); });
}
export function offsetSelection(distance?: number) {
  const s = st();
  const ids = s.selection;
  if (!ids.length) return s.notify('Zuerst Elemente auswählen');
  const o = s.settings;
  edit(`Offset ${distance ?? o.offsetDistance}`, (doc) =>
    ops.offsetOp(doc, ids, { distance: distance ?? o.offsetDistance, mode: o.offsetKind, join: o.offsetJoin, miterLimit: o.miterLimit, copy: o.offsetCopy }, o.precision));
}
export function booleanSelection(op: BoolOp) {
  const ids = st().selection;
  const labels: Record<BoolOp, string> = { union: 'Verbinden', subtract: 'Ausschneiden', intersect: 'Schnittmenge', exclude: 'Ausschließen' };
  if (ids.length < 2) return st().notify('Mindestens 2 Elemente auswählen');
  edit(labels[op], (doc) => ops.booleanOp(doc, ids, op, ctx().prec));
}
export function expandStroke() {
  const ids = st().selection;
  if (!ids.length) return st().notify('Zuerst Elemente auswählen');
  edit('Kontur in Fläche umwandeln', (doc) => ops.expandStrokeOp(doc, ids, ctx().prec));
}
export function setProps(props: Record<string, string | null>, label: string, key?: string) {
  const s = st();
  const ids = s.selection.length ? s.selection : [];
  if (!ids.length) return;
  edit(label, (doc) => { ops.setProps(doc, ids, props, s.settings.deepColor); }, { key });
}
export function setAttr(id: string, name: string, value: string | null, key?: string) {
  edit(`Attribut ${name}`, (doc) => {
    const el = getEl(doc, id);
    if (!el) return;
    if (value === null) el.removeAttribute(name); else el.setAttribute(name, value);
  }, { key });
}
export function recolor(from: string, to: string) {
  edit('Farbe ersetzen', (doc) => { ops.recolor(doc, from, to); }, { key: 'recolor-' + from });
}
export function setDocAttrs(attrs: Record<string, string | null>) {
  edit('Dokument', (doc) => { ops.setDocAttrs(doc, attrs); });
}

// ---------- clipboard ----------
function selectionFragments(): string[] {
  const s = st();
  const doc = parseSvg(s.svg);
  const ser = new XMLSerializer();
  return s.selection.map((id) => getEl(doc, id)).filter((e): e is Element => !!e).map((e) => ser.serializeToString(e));
}

export function copySelection(cut = false) {
  const s = st();
  if (!s.selection.length) return;
  const frags = selectionFragments();
  s.set({ clipboard: frags });
  const root = parseSvg(s.svg).documentElement;
  const vb = root.getAttribute('viewBox');
  const text = `<svg xmlns="${SVGNS}"${vb ? ` viewBox="${vb}"` : ''}>${frags.join('')}</svg>`;
  navigator.clipboard?.writeText(text).catch(() => {});
  if (cut) deleteSelection();
  else s.notify(`${frags.length} Element(e) kopiert`);
}

export function pasteText(text: string | null) {
  const s = st();
  const frags = text && /<svg[\s>]/.test(text) ? [cleanSvgString(text)] : s.clipboard;
  if (!frags.length) return;
  edit('Einfügen', (doc) => ops.insertFragments(doc, frags, s.scope));
}

// ---------- export ----------
export function download(name = 'image.svg', content = st().svg) {
  const blob = new Blob([content], { type: 'image/svg+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function copySvg() {
  navigator.clipboard?.writeText(st().svg).then(() => st().notify('SVG in Zwischenablage kopiert'));
}

export function minifyDocument() {
  const s = st();
  try {
    const out = minify(s.svg, { precision: s.settings.precision, multipass: s.settings.minMultipass, keepIds: s.settings.minKeepIds, pretty: s.settings.minPretty });
    s.commit(out, 'Minify', { selection: [] });
    s.set({ scope: '' });
  } catch (e) {
    s.notify('Minify fehlgeschlagen: ' + (e as Error).message);
  }
}

export function formatDocument() {
  const s = st();
  try { s.commit(prettyPrint(s.svg), 'Formatieren'); } catch (e) { s.notify((e as Error).message); }
}

// ---------- view ----------
export function zoomBy(f: number, cx?: number, cy?: number) {
  const s = st();
  const z = Math.min(256, Math.max(0.02, s.zoom * f));
  const vp = document.querySelector('.viewport')?.getBoundingClientRect();
  const px = cx ?? (vp ? vp.width / 2 : 0), py = cy ?? (vp ? vp.height / 2 : 0);
  const k = z / s.zoom;
  s.set({ zoom: z, pan: { x: px - (px - s.pan.x) * k, y: py - (py - s.pan.y) * k } });
}
export const fitView = () => st().set({ fitReq: st().fitReq + 1 });
export function zoomTo(z: number) { zoomBy(z / st().zoom); }

// ---------- shapes & corners ----------
export function insertShape(kind: ShapeKind, box: Box, line?: { a: Pt; b: Pt }) {
  const s = st();
  const o = s.settings;
  const spec = shapeSpec(kind, box, { starPoints: o.starPoints, starInner: o.starInner, polySides: o.polySides, prec: o.precision }, line);
  const style: Record<string, string> = {};
  if (kind === 'line') {
    style.fill = 'none';
    style.stroke = o.shapeStroke !== 'none' ? o.shapeStroke : o.shapeFill;
    style['stroke-width'] = String(o.shapeStrokeWidth);
    style['stroke-linecap'] = 'round';
  } else {
    style.fill = o.shapeFill;
    if (o.shapeStroke !== 'none') { style.stroke = o.shapeStroke; style['stroke-width'] = String(o.shapeStrokeWidth); }
  }
  edit(`${SHAPE_LABELS[kind]} einfügen`, (doc) => ops.insertShape(doc, spec, style, s.scope, o.precision));
}

export function roundSelectedCorners(radius = st().settings.cornerRadius) {
  const ids = st().selection;
  if (!ids.length) return st().notify('Zuerst Elemente auswählen');
  edit(radius > 0 ? `Ecken abrunden ${radius}` : 'Ecken eckig', (doc) => ops.roundCornersOp(doc, ids, radius, ctx().prec));
}

// ---------- path nodes ----------
/** Run fn on the node model of the path being edited and write it back */
export function editNodes(label: string, fn: (subs: SubPath[]) => NodeRef | null | undefined, key?: string) {
  const s = st();
  const id = s.nodeEdit;
  if (!id) return;
  let sel: NodeRef | null | undefined;
  let empty = false;
  edit(label, (doc) => {
    const el = getEl(doc, id);
    if (!el) return;
    const subs = toNodes(el.getAttribute('d'));
    sel = fn(subs);
    if (!subs.length) { el.remove(); empty = true; return []; }
    el.setAttribute('d', fromNodes(subs, s.settings.precision));
  }, { key });
  if (empty) st().set({ nodeEdit: null, nodeSel: null });
  else if (sel !== undefined) st().set({ nodeSel: sel });
}

export const NODE_LABELS: Record<NodeKind, string> = { corner: 'Ecke', smooth: 'Glatt', symmetric: 'Symmetrisch' };

const smoothKey = (ref: NodeRef) => `${st().nodeEdit}|${ref.s}:${ref.j}`;

/** Node kind as shown to the user: derived from the geometry, plus the explicit smooth flag */
export function effNodeKind(n: PNode, ref: NodeRef, smooth = st().smoothNodes): NodeKind {
  const k = nodeKind(n);
  return k === 'symmetric' && smooth.includes(smoothKey(ref)) ? 'smooth' : k;
}

function markSmooth(refs: NodeRef[], on: boolean) {
  const keys = refs.map(smoothKey);
  const rest = st().smoothNodes.filter((k) => !keys.includes(k));
  st().set({ smoothNodes: on ? [...rest, ...keys] : rest });
}

/** Node indices shift after inserting or deleting – drop the smooth flags */
export const resetSmoothNodes = () => { if (st().smoothNodes.length) st().set({ smoothNodes: [] }); };

export function setSelectedNodeKind(kind: NodeKind, ref = st().nodeSel) {
  if (!ref) return st().notify('Zuerst einen Knoten anklicken');
  editNodes(`Knoten: ${NODE_LABELS[kind]}`, (subs) => { setNodeKind(subs, ref, kind); return ref; });
  markSmooth([ref], kind === 'smooth');
}

/** Double-click on a node: corner ↔ smooth */
export function toggleNodeKind(ref: NodeRef) {
  let toSmooth = false;
  editNodes('Knotentyp', (subs) => {
    const n = subs[ref.s]?.nodes[ref.j];
    toSmooth = !!n && nodeKind(n) === 'corner';
    if (n) setNodeKind(subs, ref, toSmooth ? 'smooth' : 'corner');
    return ref;
  });
  markSmooth([ref], toSmooth);
}

export function deleteSelectedNode() {
  const ref = st().nodeSel;
  if (!ref) return;
  editNodes('Knoten löschen', (subs) => { deleteNode(subs, ref); return null; });
  resetSmoothNodes();
}

/** Move the selected node by a root-space delta */
export function nudgeNode(dx: number, dy: number) {
  const s = st();
  const ref = s.nodeSel;
  if (!ref || !s.nodeEdit) return;
  const el = liveEl(s.nodeEdit);
  const m = el && elToRoot(el);
  const iv = m ? invMat(m) : ([1, 0, 0, 1, 0, 0] as const);
  const lx = iv[0] * dx + iv[2] * dy, ly = iv[1] * dx + iv[3] * dy;
  editNodes('Knoten verschieben', (subs) => {
    const n = subs[ref.s]?.nodes[ref.j];
    if (!n) return ref;
    n.x += lx; n.y += ly;
    if (n.hin) { n.hin.x += lx; n.hin.y += ly; }
    if (n.hout) { n.hout.x += lx; n.hout.y += ly; }
    return ref;
  }, 'node-nudge');
}

export function setAllNodesKind(kind: NodeKind) {
  let refs: NodeRef[] = [];
  editNodes(`Alle Knoten: ${NODE_LABELS[kind]}`, (subs) => {
    refs = subs.flatMap((sp, s) => sp.nodes.map((_, j) => ({ s, j })));
    refs.forEach((r) => setNodeKind(subs, r, kind));
    return st().nodeSel;
  });
  resetSmoothNodes();
  if (kind === 'smooth') markSmooth(refs, true);
}

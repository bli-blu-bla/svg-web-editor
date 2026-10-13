import { currentBoards, selectedNodes, useStore } from './store';
import { inv as invMat, mulAll, rotateAt, scaleAt, translate, unionBoxes, type Box, type Mat, type Pt } from './lib/matrix';
import * as ops from './lib/ops';
import { parentId as parentIdOf, cleanSvgString, getEl, isSelectable, kids, parseSvg, serialize, idOf, docSize, prettyPrint, SHAPES, SVGNS } from './lib/svg';
import { minify } from './lib/minify';
import type { BoolOp } from './lib/area';
import { docName, isBlank } from './lib/recent';
import { layoutBoards } from './lib/boards';
import { newSnapshotId } from './lib/snapshots';
import { deleteNode, fromNodes, insertNode, nodeKind, reverseSub, setNodeKind, splitAt, subdivide, toNodes, type NodeKind, type NodeRef, type PNode, type SubPath } from './lib/nodes';
import { shapeSpec, SHAPE_LABELS, type ShapeKind } from './lib/shapes';
import { elToRoot, getLiveRoot, liveEl, rootBBox } from './lib/live';

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

/**
 * Open an SVG as a new document (own entry in the recent list, fresh undo history).
 * With `beside` it becomes a new artboard next to the active one – unless that one is still empty.
 */
export function loadSvg(text: string, label = 'Importiert', name?: string, beside = false) {
  try {
    const clean = cleanSvgString(text);
    st().openDoc(clean, docName(clean, name), undefined, label, beside && !isBlank(st().svg));
  } catch (e) {
    st().notify('Ungültiges SVG: ' + (e as Error).message);
  }
}

export function newDocument() {
  const v = window.prompt('Größe des neuen Dokuments (Breite x Höhe)', '24 x 24');
  if (!v) return;
  const [w, h] = v.split(/[x×, ]+/).map(Number);
  if (!(w > 0 && h > 0)) return st().notify('Ungültige Größe');
  loadSvg(`<svg xmlns="${SVGNS}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"></svg>`, 'Neues Dokument', `Neu ${w}×${h}`, true);
}

/** Open SVG files as artboards next to the active one */
export async function openFiles(files: File[]) {
  for (const f of files.filter((f) => f.type === 'image/svg+xml' || /\.svg$/i.test(f.name))) {
    loadSvg(await f.text(), `Datei ${f.name}`, f.name, true);
  }
}

// ---------- artboards ----------
/** Activate the artboard to the right (1) or left (-1) */
export function cycleBoard(dir: 1 | -1) {
  const s = st();
  if (s.boards.length < 2) return;
  const i = s.boards.findIndex((b) => b.id === s.docId);
  s.activateBoard(s.boards[(i + dir + s.boards.length) % s.boards.length].id);
}
export function closeBoard() {
  if (st().boards.length < 2) return st().notify('Die letzte Zeichenfläche bleibt offen');
  st().closeBoard(st().docId);
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
  edit(labels[op], (doc) => ops.booleanOp(doc, ids, op, ctx().prec, st().boolBase));
  st().set({ boolHover: null, boolBase: null });
}
export function expandStroke() {
  const ids = st().selection;
  if (!ids.length) return st().notify('Zuerst Elemente auswählen');
  edit('Kontur in Fläche umwandeln', (doc) => ops.expandStrokeOp(doc, ids, ctx().prec));
}
export function centerline() {
  const ids = st().selection;
  if (!ids.length) return st().notify('Zuerst Elemente auswählen');
  edit('Mittellinie erzeugen', (doc) => ops.centerlineOp(doc, ids, ctx().prec));
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

/** Reorder layers by drag and drop */
export function moveLayers(ids: string[], target: string, pos: ops.DropPos) {
  edit('Ebenen verschieben', (doc) => ops.moveEls(doc, ids, target, pos, ctx()));
  const s = st();
  if (s.selection.length) s.set({ scope: parentIdOf(s.selection[0]) });
}

/** Scale the document and everything in it to a new size */
export function rescaleDocument(w: number, h: number) {
  if (!(w > 0 && h > 0)) return st().notify('Ungültige Größe');
  edit(`Skalieren auf ${+w.toFixed(3)} × ${+h.toFixed(3)}`, (doc) => { ops.rescaleDocument(doc, w, h, st().settings.precision); });
  st().set({ fitReq: st().fitReq + 1 });
}

export function promptRescale() {
  const size = docSize(parseSvg(st().svg).documentElement);
  const v = window.prompt(`Dokument mit Inhalt skalieren auf (Breite x Höhe) – aktuell ${+size.w.toFixed(3)} × ${+size.h.toFixed(3)}`, `${+size.w.toFixed(3)} x ${+size.h.toFixed(3)}`);
  if (!v) return;
  const [w, h] = v.split(/[x×, ]+/).map(Number);
  rescaleDocument(w, h > 0 ? h : (w * size.h) / size.w);
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
export const fileName = (suffix = '') => (st().docName.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'image') + suffix + '.svg';

export function openRecent(id: string, beside = false) {
  const d = st().recent.find((r) => r.id === id);
  if (!d) return;
  if (id === st().docId) return st().set({ fitReq: st().fitReq + 1 });
  st().openDoc(d.svg, d.name, d.id, `Geöffnet: ${d.name}`, beside);
}

export function download(name = fileName(), content = st().svg) {
  const blob = new Blob([content], { type: 'image/svg+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- snapshots ----------

export function takeSnapshot() {
  const s = st();
  const last = s.snapshots[0];
  if (last && last.svg === s.svg) return s.notify(`Unverändert seit „${last.name}“`);
  const name = 'Snapshot ' + (s.snapshots.length + 1);
  const ok = s.setSnapshots([{ id: newSnapshotId(), name, svg: s.svg, time: Date.now() }, ...s.snapshots]);
  s.notify(ok ? `„${name}“ gespeichert` : 'Snapshot konnte nicht gespeichert werden – Browser-Speicher ist voll');
}

/** Bring a snapshot back as a normal edit, so it can be undone */
export function restoreSnapshot(id: string) {
  const s = st();
  const snap = s.snapshots.find((x) => x.id === id);
  if (!snap) return;
  if (snap.svg === s.svg) return s.notify('Dokument entspricht bereits diesem Snapshot');
  s.commit(snap.svg, `Snapshot: ${snap.name}`, { selection: [] });
  s.notify(`„${snap.name}“ wiederhergestellt`);
}

export function renameSnapshot(id: string, name: string) {
  const s = st();
  const n = name.trim();
  if (!n) return;
  s.setSnapshots(s.snapshots.map((x) => (x.id === id ? { ...x, name: n } : x)));
}

export function deleteSnapshot(id: string) {
  const s = st();
  s.setSnapshots(s.snapshots.filter((x) => x.id !== id));
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
/** Fit all artboards into the view */
export function fitAll() {
  const vp = document.querySelector('.viewport')?.getBoundingClientRect();
  if (!vp) return;
  const { w, h } = layoutBoards(currentBoards(st()));
  const z = Math.max(0.02, Math.min((vp.width - 120) / w, (vp.height - 160) / h, 64));
  st().set({ zoom: z, pan: { x: (vp.width - w * z) / 2, y: (vp.height - h * z) / 2 + 10 } });
}
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

/** Insert a path drawn with the pen tool (root coordinates); open paths get a stroke, closed ones a fill */
export function insertPenPath(nodes: PNode[], closed: boolean) {
  const s = st();
  const o = s.settings;
  const d = fromNodes([{ nodes, closed }], o.precision);
  const style: Record<string, string> = {};
  if (closed) {
    style.fill = o.shapeFill;
    if (o.shapeStroke !== 'none') { style.stroke = o.shapeStroke; style['stroke-width'] = String(o.shapeStrokeWidth); }
  } else {
    style.fill = 'none';
    style.stroke = o.shapeStroke !== 'none' ? o.shapeStroke : o.shapeFill;
    style['stroke-width'] = String(o.shapeStrokeWidth);
    style['stroke-linecap'] = 'round';
    style['stroke-linejoin'] = 'round';
  }
  edit('Pfad zeichnen', (doc) => ops.insertShape(doc, { tag: 'path', attrs: { d } }, style, s.scope, o.precision));
}

export function roundSelectedCorners(radius = st().settings.cornerRadius) {
  const ids = st().selection;
  if (!ids.length) return st().notify('Zuerst Elemente auswählen');
  edit(radius > 0 ? `Ecken abrunden ${radius}` : 'Ecken eckig', (doc) => ops.roundCornersOp(doc, ids, radius, ctx().prec));
}

// ---------- path nodes ----------
/**
 * Run fn on the node model of the path being edited and write it back.
 * keepMulti: the node indices stay the same, so a multi-selection survives.
 */
export function editNodes(label: string, fn: (subs: SubPath[]) => NodeRef | null | undefined, key?: string, keepMulti = false) {
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
  if (empty) st().set({ nodeEdit: null, nodeSel: null, nodeMulti: [] });
  else if (sel !== undefined) st().set({ nodeSel: sel, ...(keepMulti ? {} : { nodeMulti: [] }) });
}

/** Move nodes (with their handles) by a delta in path coordinates */
export function moveNodes(subs: SubPath[], refs: NodeRef[], dx: number, dy: number) {
  for (const r of refs) {
    const n = subs[r.s]?.nodes[r.j];
    if (!n) continue;
    n.x += dx; n.y += dy;
    if (n.hin) { n.hin.x += dx; n.hin.y += dy; }
    if (n.hout) { n.hout.x += dx; n.hout.y += dy; }
  }
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

export function setSelectedNodeKind(kind: NodeKind) {
  const ref = st().nodeSel, refs = selectedNodes(st());
  if (!ref) return st().notify('Zuerst einen Knoten anklicken');
  editNodes(`Knoten: ${NODE_LABELS[kind]}`, (subs) => { refs.forEach((r) => setNodeKind(subs, r, kind)); return ref; }, undefined, true);
  markSmooth(refs, kind === 'smooth');
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
  const refs = selectedNodes(st());
  if (!refs.length) return;
  // back to front, so deleting one doesn't shift the indices of the others
  const order = [...refs].sort((a, b) => b.s - a.s || b.j - a.j);
  editNodes(refs.length > 1 ? `${refs.length} Knoten löschen` : 'Knoten löschen', (subs) => { order.forEach((r) => deleteNode(subs, r)); return null; });
  resetSmoothNodes();
}

/** Move the selected node by a root-space delta */
export function nudgeNode(dx: number, dy: number) {
  const s = st();
  const ref = s.nodeSel, refs = selectedNodes(s);
  if (!ref || !s.nodeEdit) return;
  const el = liveEl(s.nodeEdit);
  const m = el && elToRoot(el);
  const iv = m ? invMat(m) : ([1, 0, 0, 1, 0, 0] as const);
  const lx = iv[0] * dx + iv[2] * dy, ly = iv[1] * dx + iv[3] * dy;
  editNodes('Knoten verschieben', (subs) => { moveNodes(subs, refs, lx, ly); return ref; }, 'node-nudge', true);
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

/** Subpaths the path commands act on: the one of the selected node, else all */
const targetSubs = (subs: SubPath[]) => {
  const ref = st().nodeSel;
  return ref && subs[ref.s] ? [subs[ref.s]] : subs;
};

export function reversePath() {
  editNodes('Pfadrichtung umkehren', (subs) => { targetSubs(subs).forEach(reverseSub); return null; });
  resetSmoothNodes();
}

export function setPathClosed(closed: boolean) {
  editNodes(closed ? 'Pfad schließen' : 'Pfad öffnen', (subs) => {
    targetSubs(subs).forEach((sp) => { if (sp.nodes.length > 2 || !closed) sp.closed = closed; });
    return st().nodeSel;
  });
}

/** Scissors tool: cut the path at a point of its outline */
export function cutPath(id: string, s: number, j: number, t: number) {
  const state = st();
  const doc = parseSvg(state.svg);
  const res = ops.cutPathOp(doc, id, s, j, t, state.settings.precision);
  // nothing cut → don't commit (a shape would otherwise be converted to a path for nothing)
  if (!res) return state.notify('Am Endpunkt eines offenen Pfads gibt es nichts zu schneiden');
  state.commit(serialize(doc), 'Pfad schneiden', { selection: res });
  st().set({ scope: parentIdOf(id) });
}

/** Add a node in the middle of the segment after the selected node (before it at the end of an open path) */
export function insertNodeAfterSelected() {
  const ref = st().nodeSel;
  if (!ref) return st().notify('Zuerst einen Knoten anklicken');
  editNodes('Knoten hinzufügen', (subs) => {
    const sp = subs[ref.s];
    if (!sp || sp.nodes.length < 2) return ref;
    const last = !sp.closed && ref.j === sp.nodes.length - 1;
    return insertNode(subs, ref.s, last ? ref.j - 1 : ref.j, 0.5);
  });
  resetSmoothNodes();
}

/** Double the nodes: a new one in the middle of every segment (of the selected subpath, or all) */
export function subdividePath() {
  const ref = st().nodeSel;
  editNodes('Knoten verdoppeln', (subs) => {
    const idx = ref && subs[ref.s] ? [ref.s] : subs.map((_, i) => i);
    idx.forEach((i) => subdivide(subs, i));
    return null;
  });
  resetSmoothNodes();
}

export function splitAtSelectedNode() {
  const ref = st().nodeSel;
  if (!ref) return st().notify('Zuerst einen Knoten anklicken');
  let ok = true;
  editNodes('Pfad auftrennen', (subs) => { ok = splitAt(subs, ref); return null; });
  if (!ok) st().notify('Am Endpunkt eines offenen Pfads gibt es nichts aufzutrennen');
  resetSmoothNodes();
}

/** Enter node editing for the single selected path (shapes are converted first) */
export function editSelectedNodes() {
  const s = st();
  if (s.selection.length !== 1) return s.notify('Genau ein Element auswählen');
  const id = s.selection[0];
  const el = getEl(parseSvg(s.svg), id);
  if (!el) return;
  if (el.localName === 'path') s.set({ nodeEdit: id });
  else if (SHAPES.has(el.localName)) { convertToPath(); st().set({ nodeEdit: id }); }
  else s.notify('Nur Pfade und Grundformen haben Knoten');
}

/** Shrink the viewBox to the drawing (plus optional padding) */
export function fitDocumentToContent(pad = 0) {
  const root = getLiveRoot();
  if (!root) return;
  const boxes = Array.from(root.children).map((c) => c.getAttribute('data-eid')).filter((id): id is string => !!id).map(rootBBox).filter((b): b is Box => !!b);
  const u = unionBoxes(boxes);
  if (!u || u.w <= 0 || u.h <= 0) return st().notify('Keine sichtbaren Elemente');
  const r = (v: number) => +v.toFixed(3);
  setDocAttrs({ viewBox: `${r(u.x - pad)} ${r(u.y - pad)} ${r(u.w + 2 * pad)} ${r(u.h + 2 * pad)}` });
  st().set({ fitReq: st().fitReq + 1 });
}

/** Move the selected node to a position in path coordinates (handles move along) */
export function setNodePos(p: { x?: number; y?: number }) {
  const ref = st().nodeSel;
  if (!ref) return;
  editNodes('Knoten verschieben', (subs) => {
    const n = subs[ref.s]?.nodes[ref.j];
    if (!n) return ref;
    const dx = (p.x ?? n.x) - n.x, dy = (p.y ?? n.y) - n.y;
    n.x += dx; n.y += dy;
    if (n.hin) { n.hin.x += dx; n.hin.y += dy; }
    if (n.hout) { n.hout.x += dx; n.hout.y += dy; }
    return ref;
  });
}

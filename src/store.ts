import { create } from 'zustand';
import type { Box } from './lib/matrix';
import { SAMPLE } from './lib/sample';
import { getEl, tryParse } from './lib/svg';
import type { JoinKind } from './lib/offset';
import type { ShapeKind } from './lib/shapes';
import type { NodeRef } from './lib/nodes';
import type { BoolOp } from './lib/area';
import { docName, loadRecent, newDocId, saveRecent, upsertRecent, type RecentDoc } from './lib/recent';
import { loadSnapshots, moveSnapshots, saveSnapshots, type Snapshot } from './lib/snapshots';

export interface Entry { svg: string; label: string; time: number; key?: string }
export type Tool = 'select' | 'node' | 'pan' | 'shape' | 'pen' | 'knife';
export type InspectorTab = 'design' | 'path' | 'node' | 'code' | 'history';

export interface Settings {
  precision: number;
  snap: boolean;
  snapStep: number;
  grid: boolean;
  autoBake: boolean;
  scaleStrokes: boolean;
  deepColor: boolean;
  keepRatio: boolean;
  /** reference point for X/Y, size and rotation: 0 = left/top, 0.5 = center, 1 = right/bottom */
  anchor: [number, number];
  shape: ShapeKind;
  shapeFill: string;
  shapeStroke: string;
  shapeStrokeWidth: number;
  starPoints: number;
  starInner: number;
  polySides: number;
  cornerRadius: number;
  offsetDistance: number;
  offsetKind: 'area' | 'parallel';
  offsetJoin: JoinKind;
  offsetCopy: boolean;
  miterLimit: number;
  minMultipass: boolean;
  minKeepIds: boolean;
  minPretty: boolean;
  /** floating action bar above the selection */
  contextBar: boolean;
}

export interface Geo { union: Box | null; boxes: Record<string, Box> }

/** An open document on the canvas; the active one's live state is kept in the top-level fields */
export interface Board { id: string; name: string; svg: string; history: Entry[]; index: number; selection: string[]; scope: string }

interface State {
  history: Entry[];
  index: number;
  svg: string;
  selection: string[];
  scope: string;
  nodeEdit: string | null;
  /** selected node while editing a path */
  nodeSel: NodeRef | null;
  /** all selected nodes when several are (marquee, Shift-click); only valid while it contains nodeSel – see selectedNodes() */
  nodeMulti: NodeRef[];
  /** node the others align to: the first one clicked (null after a marquee) – see nodeBaseOf() */
  nodeBase: NodeRef | null;
  /** nodes explicitly set to smooth ("pathId|s:j") – geometry alone reads equal-length handles as symmetric */
  smoothNodes: string[];
  hoverId: string | null;
  tool: Tool;
  zoom: number;
  pan: { x: number; y: number };
  fitReq: number;
  geo: Geo;
  settings: Settings;
  clipboard: string[];
  toast: string | null;
  inspectorTab: InspectorTab;
  /** pointer position in document coordinates */
  cursor: { x: number; y: number } | null;
  paletteOpen: boolean;
  helpOpen: boolean;
  /** id and name of the open document in the recent list */
  docId: string;
  docName: string;
  recent: RecentDoc[];
  /** saved states of the open document, newest first */
  snapshots: Snapshot[];
  /** boolean operation the pointer is over – the canvas previews it */
  boolHover: BoolOp | null;
  /** chosen base of boolean operations (null or not selected → bottommost selected element) */
  boolBase: string | null;
  /** documents side by side on the canvas, left to right (the entry of the active one is synced on switch) */
  boards: Board[];

  commit: (svg: string, label: string, opts?: { selection?: string[]; key?: string }) => void;
  undo: () => void;
  redo: () => void;
  jump: (i: number) => void;
  select: (ids: string[]) => void;
  set: (p: Partial<State>) => void;
  setSettings: (p: Partial<Settings>) => void;
  notify: (msg: string) => void;
  /** Replace the active document (or add it as a new artboard beside it) with a fresh undo history */
  openDoc: (svg: string, name: string, id?: string, label?: string, beside?: boolean) => void;
  /** Make another artboard the one being edited */
  activateBoard: (id: string) => void;
  closeBoard: (id: string) => void;
  renameRecent: (id: string, name: string) => void;
  removeRecent: (id: string) => void;
  /** Replace the open document's snapshots; returns false when they could not be stored */
  setSnapshots: (list: Snapshot[]) => boolean;
}

const LS_DOC = 'svg-editor-doc';
const LS_SET = 'svg-editor-settings';
const LS_CUR = 'svg-editor-doc-id';
const LS_BOARDS = 'svg-editor-boards';

const load = <T,>(k: string, def: T): T => {
  try { const v = localStorage.getItem(k); return v ? { ...def, ...JSON.parse(v) } : def; } catch { return def; }
};
const loadDoc = (): string => {
  try { const v = localStorage.getItem(LS_DOC); if (v && tryParse(v).doc) return v; } catch { /* ignore */ }
  return SAMPLE;
};

const defaultSettings: Settings = {
  precision: 3, snap: false, snapStep: 1, grid: true, autoBake: true, scaleStrokes: true, deepColor: true, keepRatio: true, anchor: [0, 0],
  shape: 'rect', shapeFill: '#8b7cf6', shapeStroke: 'none', shapeStrokeWidth: 2, starPoints: 5, starInner: 0.45, polySides: 6, cornerRadius: 4,
  offsetDistance: 4, offsetKind: 'area', offsetJoin: 'round', offsetCopy: true, miterLimit: 4,
  minMultipass: true, minKeepIds: false, minPretty: false, contextBar: true,
};

const initial = loadDoc();
const initialRecent = loadRecent();
const initialId = (() => { try { return localStorage.getItem(LS_CUR) || newDocId(); } catch { return newDocId(); } })();
const initialName = initialRecent.find((d) => d.id === initialId)?.name ?? (initial === SAMPLE ? 'Beispiel' : docName(initial));
const MAX = 300;

const freshBoard = (id: string, name: string, svg: string, label = 'Geöffnet'): Board => ({
  id, name, svg, history: [{ svg, label, time: Date.now() }], index: 0, selection: [], scope: '',
});
const initialBoards = ((): Board[] => {
  let saved: Board[] = [];
  try {
    const v = JSON.parse(localStorage.getItem(LS_BOARDS) || '[]');
    if (Array.isArray(v)) {
      saved = v.filter((b) => b && typeof b.id === 'string' && typeof b.name === 'string' && typeof b.svg === 'string' && tryParse(b.svg).doc)
        .map((b) => freshBoard(b.id, b.name, b.svg));
    }
  } catch { /* ignore */ }
  const cur = freshBoard(initialId, initialName, initial);
  const i = saved.findIndex((b) => b.id === initialId);
  if (i < 0) return [...saved, cur];
  saved[i] = cur;
  return saved;
})();

/** Selected nodes of the path being edited: the multi-selection if it belongs to the primary node, else just that */
export function selectedNodes(s: Pick<State, 'nodeSel' | 'nodeMulti'>): NodeRef[] {
  const p = s.nodeSel;
  if (!p) return [];
  return s.nodeMulti.some((r) => r.s === p.s && r.j === p.j) ? s.nodeMulti : [p];
}

/** The base node for aligning, if it is still among the selected nodes */
export function nodeBaseOf(s: Pick<State, 'nodeSel' | 'nodeMulti' | 'nodeBase'>): NodeRef | null {
  const b = s.nodeBase;
  return b && selectedNodes(s).some((r) => r.s === b.s && r.j === b.j) ? b : null;
}

/** All artboards with the active one's live state written back */
export function currentBoards(s: Pick<State, 'boards' | 'docId' | 'docName' | 'svg' | 'history' | 'index' | 'selection' | 'scope'>): Board[] {
  return s.boards.map((b) => (b.id === s.docId
    ? { ...b, name: s.docName, svg: s.svg, history: s.history, index: s.index, selection: s.selection, scope: s.scope }
    : b));
}

function validSelection(svg: string, sel: string[]): string[] {
  const { doc } = tryParse(svg);
  if (!doc) return [];
  return sel.filter((id) => !!getEl(doc, id));
}

let saveTimer: number | undefined;
let pending = false;
const persist = () => {
  pending = true;
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(flushSave, 300);
};
/** Write the open document and its entry in the recent list */
export function flushSave() {
  clearTimeout(saveTimer);
  if (!pending) return;
  pending = false;
  const s = useStore.getState();
  saveBoards();
  const recent = upsertRecent(s.recent, s.docId, s.docName, s.svg);
  if (recent !== s.recent) useStore.setState({ recent: saveRecent(recent) });
}
window.addEventListener('beforeunload', flushSave);

/** Write the open artboards and which one is active */
function saveBoards() {
  const s = useStore.getState();
  try {
    localStorage.setItem(LS_DOC, s.svg);
    localStorage.setItem(LS_CUR, s.docId);
    localStorage.setItem(LS_BOARDS, JSON.stringify(currentBoards(s).map(({ id, name, svg }) => ({ id, name, svg }))));
  } catch { /* ignore */ }
}

let toastTimer: number | undefined;

export const useStore = create<State>((set, get) => ({
  history: [{ svg: initial, label: 'Geöffnet', time: Date.now() }],
  index: 0,
  svg: initial,
  selection: [],
  scope: '',
  nodeEdit: null,
  nodeSel: null,
  nodeMulti: [],
  nodeBase: null,
  smoothNodes: [],
  hoverId: null,
  tool: 'select',
  zoom: 1,
  pan: { x: 0, y: 0 },
  fitReq: 1,
  geo: { union: null, boxes: {} },
  settings: load(LS_SET, defaultSettings),
  clipboard: [],
  toast: null,
  inspectorTab: 'design',
  cursor: null,
  paletteOpen: false,
  helpOpen: false,
  docId: initialId,
  docName: initialName,
  recent: initialRecent,
  snapshots: loadSnapshots(initialId),
  boards: initialBoards,
  boolHover: null,
  boolBase: null,

  commit: (svg, label, opts = {}) => {
    const s = get();
    const selection = opts.selection ?? s.selection;
    if (svg === s.svg) { set({ selection }); return; }
    const now = Date.now();
    const last = s.history[s.index];
    let history = s.history.slice(0, s.index + 1);
    if (opts.key && last.key === opts.key && now - last.time < 1200 && s.index > 0) {
      history[history.length - 1] = { ...last, svg, time: now };
    } else {
      history.push({ svg, label, time: now, key: opts.key });
      if (history.length > MAX) history = history.slice(history.length - MAX);
    }
    persist();
    const nodeEdit = s.nodeEdit && selection.includes(s.nodeEdit) ? s.nodeEdit : null;
    set({ history, index: history.length - 1, svg, selection, nodeEdit, nodeSel: nodeEdit ? s.nodeSel : null });
  },
  undo: () => { const s = get(); if (s.index > 0) get().jump(s.index - 1); },
  redo: () => { const s = get(); if (s.index < s.history.length - 1) get().jump(s.index + 1); },
  jump: (i) => {
    const s = get();
    const e = s.history[i];
    if (!e) return;
    persist();
    // stay in node editing when undoing node changes, as long as the path still exists
    const keepNode = s.nodeEdit && tryParse(e.svg).doc && getEl(tryParse(e.svg).doc!, s.nodeEdit)?.localName === 'path';
    set({ index: i, svg: e.svg, selection: validSelection(e.svg, s.selection), nodeEdit: keepNode ? s.nodeEdit : null, nodeSel: null });
  },
  select: (ids) => set((s) => {
    const nodeEdit = s.nodeEdit && ids.length === 1 && ids[0] === s.nodeEdit ? s.nodeEdit : null;
    // element ids are positions, so a chosen boolean base is only valid for the selection it was chosen in
    return { selection: ids, nodeEdit, nodeSel: nodeEdit ? s.nodeSel : null, boolBase: null };
  }),
  set: (p) => set(p),
  setSettings: (p) => {
    const settings = { ...get().settings, ...p };
    try { localStorage.setItem(LS_SET, JSON.stringify(settings)); } catch { /* ignore */ }
    set({ settings });
  },
  notify: (msg) => {
    clearTimeout(toastTimer);
    set({ toast: msg });
    toastTimer = window.setTimeout(() => set({ toast: null }), 2600);
  },
  openDoc: (svg, name, id = newDocId(), label = 'Geöffnet', beside = false) => {
    if (get().boards.some((b) => b.id === id)) { get().activateBoard(id); set({ fitReq: get().fitReq + 1 }); return; }
    flushSave();
    const s = get();
    const board = freshBoard(id, name, svg, label);
    const boards = currentBoards(s);
    const i = boards.findIndex((b) => b.id === s.docId);
    if (beside) boards.splice(i + 1, 0, board); else boards[i] = board;
    set({
      boards, svg, docId: id, docName: name, snapshots: loadSnapshots(id), history: board.history, index: 0,
      selection: [], scope: '', nodeEdit: null, nodeSel: null, smoothNodes: [], hoverId: null, fitReq: s.fitReq + 1,
    });
    persist();
    flushSave();
  },
  activateBoard: (id) => {
    if (id === get().docId) return;
    flushSave();
    const boards = currentBoards(get());
    const b = boards.find((x) => x.id === id);
    if (!b) return;
    set({
      boards, svg: b.svg, docId: b.id, docName: b.name, snapshots: loadSnapshots(b.id), history: b.history, index: b.index,
      selection: validSelection(b.svg, b.selection), scope: b.scope, nodeEdit: null, nodeSel: null, smoothNodes: [], hoverId: null,
    });
    saveBoards();
  },
  closeBoard: (id) => {
    const s = get();
    const i = s.boards.findIndex((b) => b.id === id);
    if (i < 0 || s.boards.length < 2) return;
    if (id === s.docId) get().activateBoard((s.boards[i + 1] ?? s.boards[i - 1]).id);
    set({ boards: get().boards.filter((b) => b.id !== id) });
    saveBoards();
  },
  renameRecent: (id, name) => {
    const s = get();
    set({
      recent: saveRecent(s.recent.map((d) => (d.id === id ? { ...d, name } : d))),
      boards: s.boards.map((b) => (b.id === id ? { ...b, name } : b)),
      ...(id === s.docId ? { docName: name } : {}),
    });
    saveBoards();
  },
  removeRecent: (id) => {
    const s = get();
    set({ recent: saveRecent(s.recent.filter((d) => d.id !== id)) });
    if (s.boards.some((b) => b.id === id)) {
      // an open document lives on as a new entry on its next change, and keeps its snapshots
      const docId = newDocId();
      moveSnapshots(id, docId);
      set({ boards: s.boards.map((b) => (b.id === id ? { ...b, id: docId } : b)), ...(id === s.docId ? { docId } : {}) });
      saveBoards();
    } else {
      try { saveSnapshots(id, []); } catch { /* ignore */ }
    }
  },
  setSnapshots: (list) => {
    try {
      set({ snapshots: saveSnapshots(get().docId, list) });
      return true;
    } catch {
      return false;
    }
  },
}));

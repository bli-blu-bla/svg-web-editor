import { create } from 'zustand';
import type { Box } from './lib/matrix';
import { SAMPLE } from './lib/sample';
import { getEl, tryParse } from './lib/svg';
import type { JoinKind } from './lib/offset';
import type { ShapeKind } from './lib/shapes';
import type { NodeRef } from './lib/nodes';
import { docName, loadRecent, newDocId, saveRecent, upsertRecent, type RecentDoc } from './lib/recent';

export interface Entry { svg: string; label: string; time: number; key?: string }
export type Tool = 'select' | 'node' | 'pan' | 'shape' | 'pen';
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

interface State {
  history: Entry[];
  index: number;
  svg: string;
  selection: string[];
  scope: string;
  nodeEdit: string | null;
  /** selected node while editing a path */
  nodeSel: NodeRef | null;
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

  commit: (svg: string, label: string, opts?: { selection?: string[]; key?: string }) => void;
  undo: () => void;
  redo: () => void;
  jump: (i: number) => void;
  select: (ids: string[]) => void;
  set: (p: Partial<State>) => void;
  setSettings: (p: Partial<Settings>) => void;
  notify: (msg: string) => void;
  /** Replace the document and start a fresh undo history */
  openDoc: (svg: string, name: string, id?: string, label?: string) => void;
  renameRecent: (id: string, name: string) => void;
  removeRecent: (id: string) => void;
}

const LS_DOC = 'svg-editor-doc';
const LS_SET = 'svg-editor-settings';
const LS_CUR = 'svg-editor-doc-id';

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
  try {
    localStorage.setItem(LS_DOC, s.svg);
    localStorage.setItem(LS_CUR, s.docId);
  } catch { /* ignore */ }
  const recent = upsertRecent(s.recent, s.docId, s.docName, s.svg);
  if (recent !== s.recent) useStore.setState({ recent: saveRecent(recent) });
}
window.addEventListener('beforeunload', flushSave);

let toastTimer: number | undefined;

export const useStore = create<State>((set, get) => ({
  history: [{ svg: initial, label: 'Geöffnet', time: Date.now() }],
  index: 0,
  svg: initial,
  selection: [],
  scope: '',
  nodeEdit: null,
  nodeSel: null,
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
    return { selection: ids, nodeEdit, nodeSel: nodeEdit ? s.nodeSel : null };
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
  openDoc: (svg, name, id = newDocId(), label = 'Geöffnet') => {
    flushSave();
    set({
      svg, docId: id, docName: name, history: [{ svg, label, time: Date.now() }], index: 0,
      selection: [], scope: '', nodeEdit: null, nodeSel: null, smoothNodes: [], fitReq: get().fitReq + 1,
    });
    persist();
    flushSave();
  },
  renameRecent: (id, name) => {
    const s = get();
    set({ recent: saveRecent(s.recent.map((d) => (d.id === id ? { ...d, name } : d))), ...(id === s.docId ? { docName: name } : {}) });
  },
  removeRecent: (id) => {
    const s = get();
    set({ recent: saveRecent(s.recent.filter((d) => d.id !== id)) });
    // the open document lives on as a new entry on its next change
    if (id === s.docId) set({ docId: newDocId() });
  },
}));

import { create } from 'zustand';
import type { Box } from './lib/matrix';
import { SAMPLE } from './lib/sample';
import { getEl, tryParse } from './lib/svg';
import type { JoinKind } from './lib/offset';
import type { ShapeKind } from './lib/shapes';

export interface Entry { svg: string; label: string; time: number; key?: string }
export type Tool = 'select' | 'node' | 'pan' | 'shape';

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
}

export interface Geo { union: Box | null; boxes: Record<string, Box> }

interface State {
  history: Entry[];
  index: number;
  svg: string;
  selection: string[];
  scope: string;
  nodeEdit: string | null;
  hoverId: string | null;
  tool: Tool;
  zoom: number;
  pan: { x: number; y: number };
  fitReq: number;
  geo: Geo;
  settings: Settings;
  clipboard: string[];
  toast: string | null;

  commit: (svg: string, label: string, opts?: { selection?: string[]; key?: string }) => void;
  undo: () => void;
  redo: () => void;
  jump: (i: number) => void;
  select: (ids: string[]) => void;
  set: (p: Partial<State>) => void;
  setSettings: (p: Partial<Settings>) => void;
  notify: (msg: string) => void;
}

const LS_DOC = 'svg-editor-doc';
const LS_SET = 'svg-editor-settings';

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
  minMultipass: true, minKeepIds: false, minPretty: false,
};

const initial = loadDoc();
const MAX = 300;

function validSelection(svg: string, sel: string[]): string[] {
  const { doc } = tryParse(svg);
  if (!doc) return [];
  return sel.filter((id) => !!getEl(doc, id));
}

let saveTimer: number | undefined;
const persist = (svg: string) => {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => { try { localStorage.setItem(LS_DOC, svg); } catch { /* ignore */ } }, 300);
};

let toastTimer: number | undefined;

export const useStore = create<State>((set, get) => ({
  history: [{ svg: initial, label: 'Geöffnet', time: Date.now() }],
  index: 0,
  svg: initial,
  selection: [],
  scope: '',
  nodeEdit: null,
  hoverId: null,
  tool: 'select',
  zoom: 1,
  pan: { x: 0, y: 0 },
  fitReq: 1,
  geo: { union: null, boxes: {} },
  settings: load(LS_SET, defaultSettings),
  clipboard: [],
  toast: null,

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
    persist(svg);
    const nodeEdit = s.nodeEdit && selection.includes(s.nodeEdit) ? s.nodeEdit : null;
    set({ history, index: history.length - 1, svg, selection, nodeEdit });
  },
  undo: () => { const s = get(); if (s.index > 0) get().jump(s.index - 1); },
  redo: () => { const s = get(); if (s.index < s.history.length - 1) get().jump(s.index + 1); },
  jump: (i) => {
    const s = get();
    const e = s.history[i];
    if (!e) return;
    persist(e.svg);
    set({ index: i, svg: e.svg, selection: validSelection(e.svg, s.selection), nodeEdit: null });
  },
  select: (ids) => set((s) => ({ selection: ids, nodeEdit: s.nodeEdit && ids.length === 1 && ids[0] === s.nodeEdit ? s.nodeEdit : null })),
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
}));

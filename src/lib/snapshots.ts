// Named snapshots of a document, kept in localStorage per document id
export interface Snapshot { id: string; name: string; svg: string; time: number }

const LS = 'svg-editor-snapshots';
const MAX_PER_DOC = 50;

type Store = Record<string, Snapshot[]>;

function loadAll(): Store {
  try {
    const v = JSON.parse(localStorage.getItem(LS) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}

/** Snapshots of one document, newest first */
export function loadSnapshots(docId: string): Snapshot[] {
  const l = loadAll()[docId];
  return Array.isArray(l) ? l.filter((s) => s && typeof s.svg === 'string') : [];
}

/**
 * Write the snapshots of one document (an empty list removes the entry).
 * Throws when localStorage is full, so the caller can tell the user instead of losing a snapshot silently.
 */
export function saveSnapshots(docId: string, list: Snapshot[]): Snapshot[] {
  const all = loadAll();
  const l = list.slice(0, MAX_PER_DOC);
  if (l.length) all[docId] = l; else delete all[docId];
  localStorage.setItem(LS, JSON.stringify(all));
  return l;
}

/** Move the snapshots to another document id (the open document gets a new id when removed from the recent list) */
export function moveSnapshots(from: string, to: string) {
  const all = loadAll();
  if (!all[from]) return;
  all[to] = all[from];
  delete all[from];
  try { localStorage.setItem(LS, JSON.stringify(all)); } catch { /* ignore */ }
}

export const newSnapshotId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

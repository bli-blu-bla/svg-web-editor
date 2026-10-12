// Recently edited documents, kept in localStorage
export interface RecentDoc { id: string; name: string; svg: string; created: number; updated: number }

const LS = 'svg-editor-recent';
const MAX = 40;
/** larger documents are not kept in the list (localStorage has ~5 MB in total) */
export const MAX_SVG = 400_000;

export const newDocId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export function loadRecent(): RecentDoc[] {
  try {
    const v = JSON.parse(localStorage.getItem(LS) || '[]');
    return Array.isArray(v) ? v.filter((d) => d && typeof d.id === 'string' && typeof d.svg === 'string') : [];
  } catch { return []; }
}

/** Writes the list; when the quota is exceeded the oldest entries are dropped until it fits */
export function saveRecent(list: RecentDoc[]): RecentDoc[] {
  let l = list.slice(0, MAX);
  while (true) {
    try { localStorage.setItem(LS, JSON.stringify(l)); return l; } catch {
      if (!l.length) return l;
      l = l.slice(0, -1);
    }
  }
}

/** Nothing worth keeping: no drawable content */
export const isBlank = (svg: string) => !/<(path|rect|circle|ellipse|line|polyline|polygon|text|use|image)\b/.test(svg);

export function upsertRecent(list: RecentDoc[], id: string, name: string, svg: string): RecentDoc[] {
  if (isBlank(svg) || svg.length > MAX_SVG) return list;
  const old = list.find((d) => d.id === id);
  const now = Date.now();
  const entry: RecentDoc = old ? { ...old, svg, updated: now } : { id, name, svg, created: now, updated: now };
  return [entry, ...list.filter((d) => d.id !== id)];
}

/** Name for a document: file name, <title>, or date */
export function docName(svg: string, fallback?: string): string {
  if (fallback) return fallback.replace(/\.svg$/i, '');
  const t = svg.match(/<title[^>]*>([^<]{1,60})<\/title>/i)?.[1]?.trim();
  if (t) return t;
  return 'Icon ' + new Date().toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export const thumbSrc = (svg: string) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, History, Plus, X } from 'lucide-react';
import { useStore } from '../store';
import * as A from '../actions';
import { thumbSrc } from '../lib/recent';

const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'gerade eben';
  if (m < 60) return `vor ${m} Min.`;
  const h = Math.round(m / 60);
  if (h < 24) return `vor ${h} Std.`;
  return new Date(t).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
};

/** Toolbar menu: name of the open document and the recently edited SVGs */
export function RecentMenu() {
  const recent = useStore((s) => s.recent);
  const docId = useStore((s) => s.docId);
  const boards = useStore((s) => s.boards);
  const name = useStore((s) => s.docName);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', esc); };
  }, [open]);

  const rename = (v: string) => {
    const n = v.trim();
    if (!n || n === name) return;
    const s = useStore.getState();
    if (s.recent.some((d) => d.id === docId)) s.renameRecent(docId, n);
    else s.set({ docName: n });
  };
  const q = query.trim().toLowerCase();
  const list = q ? recent.filter((d) => d.name.toLowerCase().includes(q)) : recent;

  return (
    <div className="recent" ref={ref}>
      <button className={`recent-btn ${open ? 'active' : ''}`} title="Zuletzt bearbeitete SVGs" onClick={() => setOpen(!open)}>
        <History size={15} /><span className="recent-name">{name}</span><ChevronDown size={13} />
      </button>
      {open && (
        <div className="recent-menu">
          <div className="recent-head">
            <span className="sub">Dateiname</span>
            <input key={name} className="textfield" defaultValue={name} spellCheck={false}
              onBlur={(e) => rename(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { e.currentTarget.value = name; e.currentTarget.blur(); } e.stopPropagation(); }} />
          </div>
          <div className="recent-bar">
            <span className="sub">Zuletzt bearbeitet · {recent.length}</span>
            {recent.length > 6 && <input className="textfield sm" placeholder="Suchen …" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />}
          </div>
          {!recent.length && <div className="hint recent-empty">Noch keine SVGs. Alles, was du öffnest oder bearbeitest, erscheint automatisch hier.</div>}
          <div className="recent-grid">
            {list.map((d) => (
              <div key={d.id} className={`recent-item ${d.id === docId ? 'on' : ''}`} title={d.name}
                onClick={() => { A.openRecent(d.id); setOpen(false); }}>
                <div className="recent-thumb"><img src={thumbSrc(d.svg)} alt="" draggable={false} /></div>
                <div className="recent-label">{d.name}</div>
                <div className="recent-time">{d.id === docId ? 'geöffnet' : boards.some((b) => b.id === d.id) ? 'auf der Fläche' : ago(d.updated)}</div>
                {!boards.some((b) => b.id === d.id) && (
                  <button className="recent-del recent-add" title="Als weitere Zeichenfläche daneben öffnen"
                    onClick={(e) => { e.stopPropagation(); A.openRecent(d.id, true); setOpen(false); }}><Plus size={12} /></button>
                )}
                <button className="recent-del" title="Aus der Liste entfernen"
                  onClick={(e) => { e.stopPropagation(); useStore.getState().removeRecent(d.id); }}><X size={12} /></button>
              </div>
            ))}
          </div>
          <div className="hint">Wird nur in diesem Browser gespeichert (localStorage).</div>
        </div>
      )}
    </div>
  );
}

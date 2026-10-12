import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useStore } from '../store';
import { commands, fuzzy, recentCommands, rememberCommand, type Command } from '../commands';

type Row = { c: Command; hits: number[] };

function Label({ text, hits }: { text: string; hits: number[] }) {
  if (!hits.length) return <>{text}</>;
  const set = new Set(hits);
  return <>{[...text].map((ch, i) => (set.has(i) ? <mark key={i}>{ch}</mark> : ch))}</>;
}

/** ⌘K: search and run any command */
export function CommandPalette() {
  const open = useStore((s) => s.paletteOpen);
  if (!open) return null;
  return <Palette />;
}

function Palette() {
  const close = () => useStore.getState().set({ paletteOpen: false });
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const selCount = useStore((s) => s.selection.length);
  const nodeEdit = useStore((s) => s.nodeEdit);

  const all = useMemo(() => commands().filter((c) => !c.when || c.when()), []);
  const groups = useMemo(() => {
    const out: { name: string; rows: Row[] }[] = [];
    if (!query.trim()) {
      const recent = recentCommands().map((id) => all.find((c) => c.id === id)).filter((c): c is Command => !!c);
      if (recent.length) out.push({ name: 'Zuletzt verwendet', rows: recent.map((c) => ({ c, hits: [] })) });
      const by = new Map<string, Row[]>();
      for (const c of all) { if (!by.has(c.group)) by.set(c.group, []); by.get(c.group)!.push({ c, hits: [] }); }
      by.forEach((rows, name) => out.push({ name, rows }));
      return out;
    }
    const scored = all
      .map((c) => {
        const m = fuzzy(c.label, query);
        const t = m ? null : fuzzy(`${c.group} ${c.terms ?? ''}`, query);
        return m ? { c, hits: m.hits, score: m.score + 10 } : t ? { c, hits: [], score: t.score } : null;
      })
      .filter((r): r is Row & { score: number } => !!r)
      .sort((a, b) => b.score - a.score)
      .slice(0, 40);
    if (scored.length) out.push({ name: 'Treffer', rows: scored });
    return out;
  }, [all, query]);
  const flat = groups.flatMap((g) => g.rows);

  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => {
    listRef.current?.querySelector('.pal-row.on')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const run = (c: Command) => {
    close();
    rememberCommand(c.id);
    // let the palette unmount before commands that open dialogs or move focus
    setTimeout(c.run);
  };

  const onKey = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(flat.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); const r = flat[active]; if (r) run(r.c); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  };

  let i = 0;
  return (
    <div className="pal-backdrop" onPointerDown={close}>
      <div className="pal" role="dialog" aria-label="Befehlspalette" onPointerDown={(e) => e.stopPropagation()}>
        <div className="pal-search">
          <Search size={18} />
          <input autoFocus value={query} placeholder="Befehl oder Werkzeug suchen …" aria-label="Befehl suchen" spellCheck={false}
            onChange={(e) => setQuery(e.target.value)} onKeyDown={onKey} />
          <span className="pal-ctx">{nodeEdit ? 'Knotenmodus' : selCount ? `Auswahl: ${selCount}` : 'Keine Auswahl'}</span>
        </div>
        <div className="pal-list" ref={listRef}>
          {groups.map((g) => (
            <div key={g.name}>
              <div className="pal-group">{g.name}</div>
              {g.rows.map(({ c, hits }) => {
                const idx = i++;
                const hint = c.hint?.();
                return (
                  <button key={g.name + c.id} className={`pal-row ${idx === active ? 'on' : ''}`}
                    onMouseMove={() => idx !== active && setActive(idx)} onClick={() => run(c)}>
                    <span className="pal-label"><Label text={c.label} hits={hits} /></span>
                    {hint && <span className="pal-hint">{hint}</span>}
                    {query && <span className="pal-hint">{c.group}</span>}
                    {c.keys && <kbd>{c.keys}</kbd>}
                  </button>
                );
              })}
            </div>
          ))}
          {!flat.length && <div className="pal-empty">Nichts gefunden für „{query}“</div>}
        </div>
        <div className="pal-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> wählen</span>
          <span><kbd>↵</kbd> ausführen</span>
          <span className="spacer" />
          <span><kbd>Esc</kbd> schließen</span>
        </div>
      </div>
    </div>
  );
}

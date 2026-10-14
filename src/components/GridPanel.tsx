import { useEffect, useMemo, useRef, useState } from 'react';
import { Dices } from 'lucide-react';
import { useStore } from '../store';
import * as A from '../actions';
import { autoCols, type ArrangeOpts, type CopyGridOpts, type ScatterOpts } from '../lib/grid';
import { NumField, Segmented, Toggle } from './ui';

const LS = 'svg-editor-grid';
type Layout = 'grid' | 'random';
type Area = 'doc' | 'base';
interface Prefs { arrange: Omit<ArrangeOpts, 'cols' | 'frame'>; layout: Layout; scatter: Omit<ScatterOpts, 'seed'>; area: Area }
const DEF: Prefs = {
  arrange: { padding: 18, gap: 10, fit: 'fit' },
  layout: 'grid',
  scatter: { count: 12, rotate: 0, scaleMin: 100, scaleMax: 100, avoidOverlap: true },
  area: 'doc',
};
function loadPrefs(): Prefs {
  try { const v = JSON.parse(localStorage.getItem(LS) || '{}'); return { ...DEF, ...v, arrange: { ...DEF.arrange, ...v.arrange }, scatter: { ...DEF.scatter, ...v.scatter } }; } catch { return DEF; }
}

/** Floating panel with live preview: arrange the selection into grid cells, or copy it into a grid / scatter it */
export function GridPanel() {
  const mode = useStore((s) => s.gridMode);
  if (!mode || !A.getGridBase()) return null;
  return <Panel mode={mode} />;
}

function Panel({ mode }: { mode: 'arrange' | 'copy' }) {
  const g = A.getGridBase()!;
  const set = useStore((s) => s.set);
  const [prefs] = useState(loadPrefs);
  const others = g.items.length - (g.base ? 1 : 0);

  const [arrange, setArrange] = useState<ArrangeOpts>(() => ({ ...prefs.arrange, frame: g.base ? 'base' : 'bounds', cols: autoCols(g.base ? others : g.items.length) }));
  const gap0 = +(Math.max(g.unit.w, g.unit.h) * 0.1).toPrecision(2);
  const [copy, setCopy] = useState<CopyGridOpts>({ cols: 3, rows: 2, gapX: gap0, gapY: gap0 });
  const [layout, setLayout] = useState<Layout>(prefs.layout);
  const [scat, setScat] = useState<ScatterOpts>({ ...prefs.scatter, seed: 1 });
  const [area, setArea] = useState<Area>(g.base ? prefs.area : 'doc');

  const params = useMemo<A.GridParams>(() => (mode === 'arrange' ? { mode, o: arrange }
    : layout === 'grid' ? { mode, layout, o: copy } : { mode, layout, o: scat, area }), [mode, arrange, copy, layout, scat, area]);
  useEffect(() => { A.previewGrid(params); }, [params]);

  const apply = () => {
    try { localStorage.setItem(LS, JSON.stringify({ arrange: { padding: arrange.padding, gap: arrange.gap, fit: arrange.fit }, layout, scatter: scat, area })); } catch { /* ignore */ }
    A.applyGrid(params);
  };
  const applyRef = useRef(apply);
  applyRef.current = apply;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input,textarea')) return;
      if (e.key === 'Escape') A.cancelGrid();
      else if (e.key === 'Enter') { e.preventDefault(); applyRef.current(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const n = mode === 'arrange' && arrange.frame === 'base' && g.base ? others : g.items.length;
  const cols = Math.max(1, Math.min(n, Math.round(arrange.cols)));
  const ar = (p: Partial<ArrangeOpts>) => setArrange({ ...arrange, ...p });
  const cp = (p: Partial<CopyGridOpts>) => setCopy({ ...copy, ...p });
  const sc = (p: Partial<ScatterOpts>) => setScat({ ...scat, ...p });
  const int = (v: number) => Math.max(1, Math.round(v));

  return (
    <>
      {/* keeps the canvas still while previewing, without hiding it */}
      <div className="grid-blocker" />
      <div className="sc-card grid-panel" role="dialog" aria-label="Raster">
        <div className="grid-head">
          <h3>Raster</h3>
          <Segmented value={mode} onChange={(m) => set({ gridMode: m })} options={[
            { value: 'arrange', label: 'Anordnen', title: 'Ausgewählte Elemente in Zellen verteilen' },
            { value: 'copy', label: 'Kopieren', title: 'Auswahl vervielfältigen' },
          ]} />
        </div>

        {mode === 'arrange' ? (
          <>
            <div className="row"><span className="lbl">Rahmen</span>
              <Segmented value={arrange.frame} onChange={(frame) => ar({ frame, cols: autoCols(frame === 'base' && g.base ? others : g.items.length) })} options={[
                ...(g.base ? [{ value: 'base' as const, label: 'Hintergrund', title: 'Das größte Element umschließt die anderen und bleibt stehen' }] : []),
                { value: 'doc', label: 'Dokument' },
                { value: 'bounds', label: 'Auswahl' },
              ]} />
            </div>
            <div className="row"><span className="lbl">Spalten</span>
              <NumField value={cols} onCommit={(v) => ar({ cols: int(v) })} />
              <span className="hint grid-count">{n} Elemente → {cols} × {Math.ceil(n / cols)}</span>
            </div>
            <div className="row"><span className="lbl">Rand / Abstand</span>
              <NumField value={arrange.padding} suffix="%" onCommit={(v) => ar({ padding: Math.max(0, v) })} title="Innenabstand zum Rahmen, in % der kürzeren Seite" />
              <NumField value={arrange.gap} suffix="%" onCommit={(v) => ar({ gap: Math.max(0, v) })} title="Abstand zwischen den Zellen" />
            </div>
            <div className="row"><span className="lbl">Größe</span>
              <Segmented value={arrange.fit} onChange={(fit) => ar({ fit })} options={[
                { value: 'fit', label: 'Zelle füllen', title: 'Jedes Element so groß wie seine Zelle' },
                { value: 'uniform', label: 'Einheitlich', title: 'Alle gleich skaliert – Größenverhältnisse bleiben' },
                { value: 'keep', label: 'Behalten', title: 'Nur zentrieren' },
              ]} />
            </div>
          </>
        ) : (
          <>
            <div className="row"><span className="lbl">Verteilung</span>
              <Segmented value={layout} onChange={setLayout} options={[{ value: 'grid', label: 'Geordnet' }, { value: 'random', label: 'Zufällig' }]} />
            </div>
            {layout === 'grid' ? (
              <>
                <div className="row"><span className="lbl">Spalten × Zeilen</span>
                  <NumField value={copy.cols} onCommit={(v) => cp({ cols: int(v) })} />
                  <NumField value={copy.rows} onCommit={(v) => cp({ rows: int(v) })} />
                </div>
                <div className="row"><span className="lbl">Abstand</span>
                  <NumField label="X" value={copy.gapX} onCommit={(gapX) => cp({ gapX })} />
                  <NumField label="Y" value={copy.gapY} onCommit={(gapY) => cp({ gapY })} />
                </div>
                <div className="hint">{copy.cols * copy.rows} Exemplare, das Original oben links</div>
              </>
            ) : (
              <>
                <div className="row"><span className="lbl">Anzahl</span>
                  <NumField value={scat.count} onCommit={(v) => sc({ count: int(v) })} />
                  <button className="btn" title="Neu würfeln" onClick={() => sc({ seed: (Math.random() * 1e9) | 0 })}><Dices size={15} /> Würfeln</button>
                </div>
                {g.base && (
                  <div className="row"><span className="lbl">Bereich</span>
                    <Segmented value={area} onChange={setArea} options={[{ value: 'doc', label: 'Dokument' }, { value: 'base', label: 'Hintergrund' }]} />
                  </div>
                )}
                <div className="row"><span className="lbl">Drehung ±</span>
                  <NumField value={scat.rotate} suffix="°" onCommit={(v) => sc({ rotate: Math.min(180, Math.abs(v)) })} />
                </div>
                <div className="row"><span className="lbl">Größe von / bis</span>
                  <NumField value={scat.scaleMin} suffix="%" onCommit={(v) => sc({ scaleMin: Math.max(1, v) })} />
                  <NumField value={scat.scaleMax} suffix="%" onCommit={(v) => sc({ scaleMax: Math.max(1, v) })} />
                </div>
                <Toggle label="Überlappung vermeiden" checked={scat.avoidOverlap} onChange={(avoidOverlap) => sc({ avoidOverlap })} />
              </>
            )}
          </>
        )}

        <div className="paste-foot">
          <span className="hint">Enter übernimmt, Esc bricht ab</span>
          <button className="btn" onClick={A.cancelGrid}>Abbrechen</button>
          <button className="btn primary" onClick={apply}>Anwenden</button>
        </div>
      </div>
    </>
  );
}

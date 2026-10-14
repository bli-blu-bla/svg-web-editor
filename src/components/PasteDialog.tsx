import { useEffect, useMemo, useRef, useState } from 'react';
import { Lock, Unlock } from 'lucide-react';
import { useStore } from '../store';
import * as A from '../actions';
import { naturalSize, sanitize, serialize, tryParse } from '../lib/svg';
import { isBlank } from '../lib/recent';
import { NumField, Segmented, Toggle } from './ui';

const LS = 'svg-editor-paste';
const PRESETS = [16, 24, 32, 48, 64, 128, 256, 512];

interface Prefs { scale: boolean; size: number; place: A.ImportOpts['place'] }
function loadPrefs(): Prefs {
  const def: Prefs = { scale: false, size: 256, place: 'center' };
  try { return { ...def, ...JSON.parse(localStorage.getItem(LS) || '{}') }; } catch { return def; }
}

/** Paste an SVG from elsewhere (icon sites …) – optionally scaled, into the document or as a new artboard */
export function PasteDialog() {
  const text = useStore((s) => s.pasteSvg);
  if (text === null) return null;
  return <Dialog initial={text} key={text} />;
}

function Dialog({ initial }: { initial: string }) {
  const svg = useStore((s) => s.svg);
  const close = () => useStore.getState().set({ pasteSvg: null });
  const [code, setCode] = useState(initial);
  const [prefs] = useState(loadPrefs);
  const [scale, setScale] = useState(prefs.scale);
  const [place, setPlace] = useState(prefs.place);
  const [target, setTarget] = useState<A.ImportOpts['target']>(() => (isBlank(svg) ? 'board' : 'doc'));
  const [lock, setLock] = useState(true);

  const parsed = useMemo(() => {
    if (!code.trim()) return null;
    const { doc, error } = tryParse(code);
    if (!doc) return { error };
    sanitize(doc);
    const out = serialize(doc);
    return { size: naturalSize(doc.documentElement), url: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(out) };
  }, [code]);
  const nat = parsed && 'size' in parsed ? parsed.size : null;

  // target size: the remembered long side, in the pasted SVG's proportions
  const fit = (side: number) => (nat ? (nat.w >= nat.h ? { w: side, h: (side * nat.h) / nat.w } : { w: (side * nat.w) / nat.h, h: side }) : { w: side, h: side });
  const [size, setSize] = useState(() => fit(prefs.size));
  useEffect(() => { setSize(fit(Math.max(size.w, size.h))); }, [nat?.w, nat?.h]); // eslint-disable-line react-hooks/exhaustive-deps

  const final = scale ? size : nat;
  const ok = !!final && final.w > 0 && final.h > 0;
  const submit = () => {
    if (!ok) return;
    try { localStorage.setItem(LS, JSON.stringify({ scale, size: Math.max(size.w, size.h), place })); } catch { /* ignore */ }
    A.importSvg(code, { ...final, target, place });
  };

  // Enter / Esc outside of the fields – the global shortcuts are off while the dialog is open
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('textarea,input')) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'Enter') { e.preventDefault(); submitRef.current(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const setW = (w: number) => setSize({ w, h: lock && nat ? (w * nat.h) / nat.w : size.h });
  const setH = (h: number) => setSize({ h, w: lock && nat ? (h * nat.w) / nat.h : size.w });
  const f = (v: number) => +v.toFixed(3);

  return (
    <div className="shortcuts" onClick={close}>
      <div className="sc-card paste-card" role="dialog" aria-label="SVG einfügen" onClick={(e) => e.stopPropagation()}>
        <h3>SVG einfügen</h3>
        <div className="paste-src">
          <div className="paste-preview">{parsed && 'url' in parsed && <img src={parsed.url} alt="" />}</div>
          <textarea className="textfield mono" value={code} spellCheck={false} autoFocus={!initial}
            placeholder="SVG-Code hier einfügen (z. B. von Phosphor, Font Awesome, Lucide)"
            onChange={(e) => setCode(e.target.value)} />
        </div>
        <div className="hint paste-info">
          {!parsed ? 'Noch kein SVG' : nat ? `Originalgröße ${f(nat.w)} × ${f(nat.h)}` : <span className="err">{parsed.error}</span>}
        </div>

        <Toggle label="Skalieren" checked={scale} onChange={setScale} />
        {scale && (
          <>
            <div className="dims paste-dims">
              <NumField label="B" value={size.w} onCommit={setW} />
              <button className={`iconbtn ${lock ? 'active' : ''}`} title="Proportionen beibehalten" onClick={() => setLock(!lock)}>
                {lock ? <Lock size={15} /> : <Unlock size={15} />}
              </button>
              <NumField label="H" value={size.h} onCommit={setH} />
            </div>
            <div className="paste-presets">
              {PRESETS.map((p) => (
                <button key={p} className={`btn sm ${Math.max(size.w, size.h) === p ? 'primary' : ''}`} onClick={() => setSize(fit(p))}>{p}</button>
              ))}
            </div>
          </>
        )}

        <div className="row"><span className="lbl">Ziel</span>
          <Segmented value={target} onChange={setTarget} options={[
            { value: 'doc', label: 'Ins Dokument' },
            { value: 'board', label: 'Neue Zeichenfläche' },
          ]} />
        </div>
        {target === 'doc' && (
          <div className="row"><span className="lbl">Position</span>
            <Segmented value={place} onChange={setPlace} options={[
              { value: 'center', label: 'Mitte' },
              { value: 'origin', label: 'Oben links' },
            ]} />
          </div>
        )}

        <div className="paste-foot">
          <span className="hint">{ok && `Wird eingefügt mit ${f(final!.w)} × ${f(final!.h)}`}</span>
          <button className="btn" onClick={close}>Abbrechen</button>
          <button className="btn primary" disabled={!ok} onClick={submit}>Einfügen</button>
        </div>
      </div>
    </div>
  );
}

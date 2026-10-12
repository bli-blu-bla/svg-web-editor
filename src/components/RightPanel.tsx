import { useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { xml } from '@codemirror/lang-xml';
import { EditorView } from '@codemirror/view';
import { Download, Copy, Wand2, AlignLeft, Check } from 'lucide-react';
import { useStore, type InspectorTab } from '../store';
import { DesignTab, NodeTab, PathTab } from './Properties';
import * as A from '../actions';
import { tryParse } from '../lib/svg';
import { byteSize, fmtBytes, minify } from '../lib/minify';
import { Section, Toggle } from './ui';

const TABS: { id: InspectorTab; label: string }[] = [
  { id: 'node', label: 'Knoten' },
  { id: 'design', label: 'Design' },
  { id: 'path', label: 'Pfad' },
  { id: 'code', label: 'Code' },
  { id: 'history', label: 'Verlauf' },
];

/** Right-hand inspector: Design · Pfad · Code · Verlauf (plus Knoten while editing nodes) */
export function Inspector() {
  const tab = useStore((s) => s.inspectorTab);
  const nodeEdit = useStore((s) => s.nodeEdit);
  const set = useStore((s) => s.set);

  // node editing brings its own tab to the front and takes it away again
  useEffect(() => {
    const s = useStore.getState();
    if (nodeEdit && s.inspectorTab !== 'code' && s.inspectorTab !== 'history') set({ inspectorTab: 'node' });
    if (!nodeEdit && s.inspectorTab === 'node') set({ inspectorTab: 'design' });
  }, [nodeEdit, set]);

  const shown = TABS.filter((t) => t.id !== 'node' || nodeEdit);
  const active = tab === 'node' && !nodeEdit ? 'design' : tab;
  return (
    <aside className="panel right" aria-label="Inspektor">
      <div className="tabs" role="tablist">
        {shown.map((t) => (
          <button key={t.id} role="tab" aria-selected={active === t.id} className={active === t.id ? 'on' : ''} onClick={() => set({ inspectorTab: t.id })}>{t.label}</button>
        ))}
      </div>
      <div className={`panel-body ${active === 'code' ? 'flush' : ''}`}>
        {active === 'node' && <NodeTab />}
        {active === 'design' && <DesignTab />}
        {active === 'path' && <PathTab />}
        {active === 'code' && <CodePane />}
        {active === 'history' && <HistoryPane />}
      </div>
    </aside>
  );
}

const cmExtensions = [xml(), EditorView.lineWrapping];

function CodePane() {
  const svg = useStore((s) => s.svg);
  const [text, setText] = useState(svg);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number>();
  const editing = useRef(false);

  useEffect(() => {
    if (!editing.current) { setText(svg); setError(null); }
  }, [svg]);

  const onChange = (v: string) => {
    setText(v);
    editing.current = true;
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const r = tryParse(v);
      if (r.error) { setError(r.error); return; }
      setError(null);
      try {
        useStore.getState().commit(v, 'Code bearbeitet', { key: 'code' });
      } catch (e) { setError((e as Error).message); }
      editing.current = false;
    }, 450);
  };

  return (
    <div className="code-pane">
      <div className="code-bar">
        <span className="muted">{fmtBytes(byteSize(svg))}</span>
        <span className="spacer" />
        <button className="btn sm" title="Einrücken / formatieren" onClick={A.formatDocument}><AlignLeft size={13} /> Format</button>
        <button className="btn sm" title="Mit SVGO minifizieren" onClick={A.minifyDocument}><Wand2 size={13} /> Minify</button>
        <button className="btn sm" title="In Zwischenablage" onClick={A.copySvg}><Copy size={13} /></button>
      </div>
      <div className="cm-wrap">
        <CodeMirror
          value={text}
          theme="dark"
          height="100%"
          extensions={cmExtensions}
          onChange={onChange}
          onBlur={() => { editing.current = false; }}
          basicSetup={{ foldGutter: true, highlightActiveLine: true }}
        />
      </div>
      {error && <div className="code-error">⚠ {error}</div>}
    </div>
  );
}

function HistoryPane() {
  const history = useStore((s) => s.history);
  const index = useStore((s) => s.index);
  const jump = useStore((s) => s.jump);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' }); }, [index]);
  return (
    <div className="history" ref={ref}>
      {history.map((h, i) => (
        <button key={i} className={`hist ${i === index ? 'on' : ''} ${i > index ? 'future' : ''}`} onClick={() => jump(i)}>
          <span>{h.label}</span>
          <time>{new Date(h.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
        </button>
      ))}
      <div className="hint">⌘Z rückgängig · ⇧⌘Z wiederholen</div>
    </div>
  );
}

export function ExportPane() {
  const svg = useStore((s) => s.svg);
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const [copied, setCopied] = useState(false);
  const min = useMemo(() => {
    try {
      return minify(svg, { precision: settings.precision, multipass: settings.minMultipass, keepIds: settings.minKeepIds, pretty: settings.minPretty });
    } catch { return null; }
  }, [svg, settings.precision, settings.minMultipass, settings.minKeepIds, settings.minPretty]);
  const before = byteSize(svg), after = min ? byteSize(min) : 0;
  const ok = !!tryParse(svg).doc;
  const url = useMemo(() => (ok ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) : ''), [svg, ok]);

  return (
    <div className="export">
      <Section title="Vorschau">
        <div className="previews">
          {[16, 24, 32, 48, 64].map((s) => (
            <div key={s} className="pv">
              <div className="pv-box dark"><img src={url} width={s} height={s} alt="" /></div>
              <div className="pv-box light"><img src={url} width={s} height={s} alt="" /></div>
              <span>{s}</span>
            </div>
          ))}
        </div>
      </Section>
      <Section title="Optimieren (SVGO)">
        <div className="row">
          <span className="lbl">Präzision</span>
          <input type="range" min={0} max={6} value={settings.precision} className="slider" onChange={(e) => setSettings({ precision: +e.target.value })} />
          <code className="val">{settings.precision}</code>
        </div>
        <Toggle label="Mehrfach-Durchlauf (multipass)" checked={settings.minMultipass} onChange={(v) => setSettings({ minMultipass: v })} />
        <Toggle label="IDs behalten" checked={settings.minKeepIds} onChange={(v) => setSettings({ minKeepIds: v })} />
        <Toggle label="Lesbar formatieren" checked={settings.minPretty} onChange={(v) => setSettings({ minPretty: v })} />
        <div className="sizes">
          <div><span>Aktuell</span><b>{fmtBytes(before)}</b></div>
          <div><span>Minifiziert</span><b>{min ? fmtBytes(after) : '—'}</b></div>
          <div><span>Ersparnis</span><b className="good">{min && before ? `${Math.max(0, Math.round((1 - after / before) * 100))} %` : '—'}</b></div>
        </div>
        <button className="btn primary wide" onClick={A.minifyDocument} disabled={!min}><Wand2 size={14} /> Minify auf Dokument anwenden</button>
      </Section>
      <Section title="Ausgabe">
        <div className="btn-col">
          <button className="btn" onClick={() => A.download()}><Download size={14} /> SVG herunterladen</button>
          <button className="btn" disabled={!min} onClick={() => min && A.download(A.fileName('.min'), min)}><Download size={14} /> Minifiziert herunterladen</button>
          <button className="btn" onClick={() => { navigator.clipboard?.writeText(min || svg); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
            {copied ? <Check size={14} /> : <Copy size={14} />} Minifiziertes SVG kopieren
          </button>
        </div>
      </Section>
    </div>
  );
}

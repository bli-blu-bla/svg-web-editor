import { useEffect, useRef, useState } from 'react';
import {
  MousePointer2, Spline, Hand, ZoomIn, ZoomOut, Scan, Undo2, Redo2, Grid3x3, Magnet, FilePlus2, FolderOpen, Download, Copy,
  Layers as LayersIcon, SlidersHorizontal, Keyboard,
} from 'lucide-react';
import { useStore } from './store';
import * as A from './actions';
import { Canvas } from './components/Canvas';
import { Properties } from './components/Properties';
import { Layers } from './components/Layers';
import { RightPanel } from './components/RightPanel';
import { IconBtn } from './components/ui';
import { ShapePicker } from './components/ShapePicker';
import { RecentMenu } from './components/RecentMenu';
import { getEl, parseSvg, SHAPES } from './lib/svg';

function useShortcuts() {
  useEffect(() => {
    const typing = (t: EventTarget | null) => !!(t as HTMLElement)?.closest?.('input,textarea,select,[contenteditable="true"],.cm-editor');
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target)) return;
      const s = useStore.getState();
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      const stop = () => e.preventDefault();
      if (mod && k === 'z') { stop(); if (e.shiftKey) s.redo(); else s.undo(); }
      else if (mod && k === 'y') { stop(); s.redo(); }
      else if (mod && k === 'a') { stop(); A.selectAll(); }
      else if (mod && k === 'd') { stop(); A.duplicateSelection(); }
      else if (mod && k === 'c') { stop(); A.copySelection(); }
      else if (mod && k === 'x') { stop(); A.copySelection(true); }
      else if (mod && k === 'g') { stop(); if (e.shiftKey) A.ungroupSelection(); else A.groupSelection(); }
      else if (mod && e.code === 'BracketRight') { stop(); A.arrange(e.shiftKey ? 'front' : 'forward'); }
      else if (mod && e.code === 'BracketLeft') { stop(); A.arrange(e.shiftKey ? 'back' : 'backward'); }
      else if (mod && k === 's') { stop(); A.download(); }
      else if (mod && k === 'o') { stop(); (document.getElementById('file-input') as HTMLInputElement)?.click(); }
      else if (mod && (k === '=' || k === '+')) { stop(); A.zoomBy(1.25); }
      else if (mod && k === '-') { stop(); A.zoomBy(0.8); }
      else if (mod && k === '0') { stop(); A.fitView(); }
      else if (mod && k === '1') { stop(); A.zoomTo(1); }
      else if (mod) return;
      else if (k === 'backspace' || k === 'delete') { stop(); if (s.nodeEdit && s.nodeSel) A.deleteSelectedNode(); else if (!s.nodeEdit) A.deleteSelection(); }
      else if (k.startsWith('arrow')) {
        stop();
        const d = e.shiftKey ? 10 : (e.altKey ? 0.1 : 1);
        const dx = k === 'arrowleft' ? -d : k === 'arrowright' ? d : 0, dy = k === 'arrowup' ? -d : k === 'arrowdown' ? d : 0;
        if (s.nodeEdit) { if (s.nodeSel) A.nudgeNode(dx, dy); } else A.nudge(dx, dy);
      } else if (k === 'escape') {
        if (s.nodeEdit && s.nodeSel) s.set({ nodeSel: null });
        else if (s.nodeEdit) s.set({ nodeEdit: null });
        else if (s.selection.length) s.select([]);
        else if (s.scope) s.set({ scope: '' });
        if (s.tool !== 'select') s.set({ tool: 'select' });
      } else if (k === 'enter') {
        if (s.selection.length !== 1) return;
        const id = s.selection[0];
        const el = getEl(parseSvg(s.svg), id);
        if (!el) return;
        if (el.localName === 'g' && el.children.length) { s.set({ scope: id }); s.select([`${id}.${el.children.length - 1}`]); }
        else if (el.localName === 'path') s.set({ nodeEdit: id });
        else if (SHAPES.has(el.localName)) { A.convertToPath(); s.set({ nodeEdit: id }); }
      } else if (k === 'v') s.set({ tool: 'select' });
      else if (k === 'a') s.set({ tool: 'node' });
      else if (k === 'h') s.set({ tool: 'pan' });
      else if (k === 'r' || k === 'o' || k === 'l' || k === 's') {
        s.setSettings({ shape: ({ r: 'rect', o: 'circle', l: 'line', s: 'star' } as const)[k] });
        s.set({ tool: 'shape' });
      }
      else if (k === '#' || k === "'") s.setSettings({ grid: !s.settings.grid });
    };
    const onPaste = (e: ClipboardEvent) => {
      if (typing(e.target)) return;
      const text = e.clipboardData?.getData('text/plain') ?? null;
      e.preventDefault();
      const s = useStore.getState();
      if (text && /<svg[\s>]/.test(text) && !s.svg.match(/<(path|rect|circle|ellipse|line|poly|g|text|use|image)\b/)) A.loadSvg(text, 'SVG eingefügt');
      else A.pasteText(text);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('paste', onPaste);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('paste', onPaste); };
  }, []);
}

function Toolbar() {
  const tool = useStore((s) => s.tool);
  const zoom = useStore((s) => s.zoom);
  const index = useStore((s) => s.index);
  const len = useStore((s) => s.history.length);
  const settings = useStore((s) => s.settings);
  const set = useStore((s) => s.set);
  const setSettings = useStore((s) => s.setSettings);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const fileRef = useRef<HTMLInputElement>(null);
  const [help, setHelp] = useState(false);

  return (
    <header className="topbar">
      <div className="brand"><img className="logo" src={`${import.meta.env.BASE_URL}logo.svg`} width={24} height={24} alt="" /> SVG Editor</div>
      <div className="tgroup">
        <IconBtn title="Neues Dokument" icon={<FilePlus2 size={17} />} onClick={A.newDocument} />
        <IconBtn title="SVG öffnen (⌘O) – oder Datei auf die Fläche ziehen" icon={<FolderOpen size={17} />} onClick={() => fileRef.current?.click()} />
        <IconBtn title="Herunterladen (⌘S)" icon={<Download size={17} />} onClick={() => A.download()} />
        <IconBtn title="SVG kopieren" icon={<Copy size={17} />} onClick={A.copySvg} />
        <input id="file-input" ref={fileRef} type="file" accept=".svg,image/svg+xml" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) f.text().then((t) => A.loadSvg(t, `Datei ${f.name}`, f.name)); e.target.value = ''; }} />
      </div>
      <RecentMenu />
      <div className="tgroup">
        <IconBtn title="Auswahl (V)" icon={<MousePointer2 size={17} />} active={tool === 'select'} onClick={() => set({ tool: 'select' })} />
        <IconBtn title="Knoten bearbeiten (A)" icon={<Spline size={17} />} active={tool === 'node'} onClick={() => set({ tool: 'node' })} />
        <IconBtn title="Hand (H / Leertaste)" icon={<Hand size={17} />} active={tool === 'pan'} onClick={() => set({ tool: 'pan' })} />
        <ShapePicker />
      </div>
      <div className="tgroup">
        <IconBtn title="Herauszoomen (⌘−)" icon={<ZoomOut size={17} />} onClick={() => A.zoomBy(0.8)} />
        <button className="zoomval" title="Auf 100 % (⌘1)" onClick={() => A.zoomTo(1)}>{Math.round(zoom * 100)}%</button>
        <IconBtn title="Hineinzoomen (⌘+)" icon={<ZoomIn size={17} />} onClick={() => A.zoomBy(1.25)} />
        <IconBtn title="Einpassen (⌘0)" icon={<Scan size={17} />} onClick={A.fitView} />
      </div>
      <div className="tgroup">
        <IconBtn title="Raster" icon={<Grid3x3 size={17} />} active={settings.grid} onClick={() => setSettings({ grid: !settings.grid })} />
        <IconBtn title={`Am Raster einrasten (${settings.snapStep})`} icon={<Magnet size={17} />} active={settings.snap} onClick={() => setSettings({ snap: !settings.snap })} />
        {settings.snap && (
          <select className="snapsel" value={settings.snapStep} onChange={(e) => setSettings({ snapStep: +e.target.value })} title="Rasterweite">
            {[0.5, 1, 2, 4, 8, 10, 16].map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        )}
      </div>
      <div className="spacer" />
      <div className="tgroup">
        <IconBtn title="Rückgängig (⌘Z)" icon={<Undo2 size={17} />} disabled={index === 0} onClick={undo} />
        <IconBtn title="Wiederholen (⇧⌘Z)" icon={<Redo2 size={17} />} disabled={index >= len - 1} onClick={redo} />
      </div>
      <div className="tgroup">
        <IconBtn title="Tastenkürzel" icon={<Keyboard size={17} />} active={help} onClick={() => setHelp(!help)} />
      </div>
      {help && <Shortcuts onClose={() => setHelp(false)} />}
    </header>
  );
}

const KEYS: [string, string][] = [
  ['⌘Z / ⇧⌘Z', 'Rückgängig / Wiederholen'], ['⌘A', 'Alles auswählen'], ['⌘C / ⌘X / ⌘V', 'Kopieren / Ausschneiden / Einfügen (auch SVG-Code)'],
  ['⌘D', 'Duplizieren'], ['⌫', 'Löschen'], ['⌘G / ⇧⌘G', 'Gruppieren / aufheben'], ['⌘] / ⌘[', 'Nach vorne / hinten (⇧ = ganz)'],
  ['Pfeiltasten', 'Verschieben 1 (⇧ 10, ⌥ 0.1)'], ['⇧ beim Ziehen', 'Achse sperren / proportional / 15°-Schritte'], ['⌥ beim Skalieren', 'Von der Mitte aus'],
  ['⌘ + Klick', 'Tiefes Auswählen (in Gruppen)'], ['Doppelklick / Enter', 'Gruppe betreten / Knoten bearbeiten'], ['Esc', 'Auswahl aufheben / Modus verlassen'],
  ['V / A / H', 'Auswahl / Knoten / Hand'], ['R / O / L / S', 'Rechteck / Kreis / Linie / Stern zeichnen'], ['Leertaste', 'Ansicht verschieben'], ['⌘ + Scroll', 'Zoomen'], ['⌘0 / ⌘1', 'Einpassen / 100 %'], ['⌘S / ⌘O', 'Speichern / Öffnen'],
];
function Shortcuts({ onClose }: { onClose: () => void }) {
  return (
    <div className="shortcuts" onClick={onClose}>
      <div className="sc-card" onClick={(e) => e.stopPropagation()}>
        <h3>Tastenkürzel</h3>
        {KEYS.map(([k, v]) => <div className="sc-row" key={k}><kbd>{k}</kbd><span>{v}</span></div>)}
      </div>
    </div>
  );
}

function LeftPanel() {
  const [tab, setTab] = useState<'props' | 'layers'>('props');
  return (
    <aside className="panel left">
      <div className="tabs">
        <button className={tab === 'props' ? 'on' : ''} onClick={() => setTab('props')}><SlidersHorizontal size={14} /> Eigenschaften</button>
        <button className={tab === 'layers' ? 'on' : ''} onClick={() => setTab('layers')}><LayersIcon size={14} /> Ebenen</button>
      </div>
      <div className="panel-body">{tab === 'props' ? <Properties /> : <Layers />}</div>
    </aside>
  );
}

function Toast() {
  const toast = useStore((s) => s.toast);
  return toast ? <div className="toast">{toast}</div> : null;
}

export default function App() {
  useShortcuts();
  return (
    <div className="app">
      <Toolbar />
      <main className="workspace">
        <LeftPanel />
        <div className="canvas-wrap"><Canvas /></div>
        <RightPanel />
      </main>
      <Toast />
    </div>
  );
}

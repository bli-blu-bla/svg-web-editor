import { useEffect, useRef } from 'react';
import { ChevronDown, Download, FilePlus2, FolderOpen, Redo2, Search, Spline, Undo2 } from 'lucide-react';
import { useStore } from './store';
import * as A from './actions';
import { Canvas } from './components/Canvas';
import { DocColors } from './components/Properties';
import { Layers } from './components/Layers';
import { ExportPane, Inspector } from './components/RightPanel';
import { ToolRail } from './components/ToolRail';
import { StatusBar } from './components/StatusBar';
import { CommandPalette } from './components/CommandPalette';
import { IconBtn, usePopover } from './components/ui';
import { RecentMenu } from './components/RecentMenu';
import { getEl, parseSvg, SHAPES, tryParse } from './lib/svg';

function useShortcuts() {
  useEffect(() => {
    const typing = (t: EventTarget | null) => !!(t as HTMLElement)?.closest?.('input,textarea,select,[contenteditable="true"],.cm-editor');
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target)) return;
      const s = useStore.getState();
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      const stop = () => e.preventDefault();
      if (mod && k === 'k') { stop(); s.set({ paletteOpen: !s.paletteOpen }); return; }
      if (s.paletteOpen) return;
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
        if (s.helpOpen) { s.set({ helpOpen: false }); return; }
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
      else if (k === 'p') s.set({ tool: 'pen' });
      else if (k === 'r' || k === 'o' || k === 'l' || k === 's') {
        s.setSettings({ shape: ({ r: 'rect', o: 'circle', l: 'line', s: 'star' } as const)[k] });
        s.set({ tool: 'shape' });
      }
      else if (k === '#' || k === "'") s.setSettings({ grid: !s.settings.grid });
      else if (k === '?') s.set({ helpOpen: !s.helpOpen });
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

function ZoomMenu() {
  const zoom = useStore((s) => s.zoom);
  const { open, setOpen, ref } = usePopover();
  const item = (label: string, keys: string, fn: () => void) => (
    <button onClick={() => { fn(); setOpen(false); }}><span>{label}</span>{keys && <kbd>{keys}</kbd>}</button>
  );
  return (
    <div className="pop-wrap" ref={ref}>
      <button className="top-btn mono" title="Zoom" aria-expanded={open} onClick={() => setOpen(!open)}>
        {Math.round(zoom * 100)} %<ChevronDown size={13} />
      </button>
      {open && (
        <div className="menu right">
          {item('Hineinzoomen', '⌘+', () => A.zoomBy(1.25))}
          {item('Herauszoomen', '⌘−', () => A.zoomBy(0.8))}
          {item('Einpassen', '⌘0', A.fitView)}
          <div className="menu-sep" />
          {[0.5, 1, 2, 4, 8].map((z) => <div key={z}>{item(`${z * 100} %`, z === 1 ? '⌘1' : '', () => A.zoomTo(z))}</div>)}
        </div>
      )}
    </div>
  );
}

function ExportMenu() {
  const { open, setOpen, ref } = usePopover();
  return (
    <div className="pop-wrap" ref={ref}>
      <button className="top-btn primary" aria-expanded={open} onClick={() => setOpen(!open)}><Download size={15} /> Exportieren</button>
      {open && <div className="menu right export-menu"><ExportPane /></div>}
    </div>
  );
}

/** Mode indicator in the top bar: node editing or inside a group */
function ModeChip() {
  const nodeEdit = useStore((s) => s.nodeEdit);
  const scope = useStore((s) => s.scope);
  const svg = useStore((s) => s.svg);
  const set = useStore((s) => s.set);
  if (!nodeEdit && !scope) return null;
  const id = nodeEdit || scope;
  const doc = tryParse(svg).doc;
  const el = doc ? getEl(doc, id) : null;
  const name = el?.getAttribute('id') || (nodeEdit ? 'Pfad' : 'Gruppe');
  return (
    <div className="mode-chip">
      {nodeEdit ? <Spline size={15} /> : <FolderOpen size={15} />}
      <span>{nodeEdit ? 'Knoten bearbeiten:' : 'In Gruppe:'} <b>{name}</b></span>
      <button onClick={() => set(nodeEdit ? { nodeEdit: null } : { scope: '' })}>{nodeEdit ? 'Fertig' : 'Verlassen'}</button>
    </div>
  );
}

function TopBar() {
  const index = useStore((s) => s.index);
  const len = useStore((s) => s.history.length);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const set = useStore((s) => s.set);
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <header className="topbar">
      <img className="logo" src={`${import.meta.env.BASE_URL}logo.svg`} width={26} height={26} alt="SVG Editor" title="SVG Editor" />
      <div className="tgroup">
        <IconBtn title="Neues Dokument" icon={<FilePlus2 size={17} />} onClick={A.newDocument} />
        <IconBtn title="SVG öffnen (⌘O) – oder Datei auf die Fläche ziehen" icon={<FolderOpen size={17} />} onClick={() => fileRef.current?.click()} />
        <input id="file-input" ref={fileRef} type="file" accept=".svg,image/svg+xml" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) f.text().then((t) => A.loadSvg(t, `Datei ${f.name}`, f.name)); e.target.value = ''; }} />
      </div>
      <RecentMenu />
      <ModeChip />
      <div className="spacer" />
      <div className="tgroup">
        <IconBtn title="Rückgängig (⌘Z)" icon={<Undo2 size={17} />} disabled={index === 0} onClick={undo} />
        <IconBtn title="Wiederholen (⇧⌘Z)" icon={<Redo2 size={17} />} disabled={index >= len - 1} onClick={redo} />
      </div>
      <button className="search-btn" onClick={() => set({ paletteOpen: true })}>
        <Search size={15} /><span>Befehl oder Werkzeug suchen …</span><kbd>⌘K</kbd>
      </button>
      <ZoomMenu />
      <ExportMenu />
    </header>
  );
}

const KEYS: [string, string][] = [
  ['⌘Z / ⇧⌘Z', 'Rückgängig / Wiederholen'], ['⌘A', 'Alles auswählen'], ['⌘C / ⌘X / ⌘V', 'Kopieren / Ausschneiden / Einfügen (auch SVG-Code)'],
  ['⌘D', 'Duplizieren'], ['⌫', 'Löschen'], ['⌘G / ⇧⌘G', 'Gruppieren / aufheben'], ['⌘] / ⌘[', 'Nach vorne / hinten (⇧ = ganz)'],
  ['Pfeiltasten', 'Verschieben 1 (⇧ 10, ⌥ 0.1)'], ['⇧ beim Ziehen', 'Achse sperren / proportional / 15°-Schritte'], ['⌥ beim Skalieren', 'Von der Mitte aus'],
  ['⌘ + Klick', 'Tiefes Auswählen (in Gruppen)'], ['Doppelklick / Enter', 'Gruppe betreten / Knoten bearbeiten'], ['Esc', 'Auswahl aufheben / Modus verlassen'],
  ['⌘K', 'Befehlspalette: jeden Befehl suchen'], ['V / A / P / H', 'Auswahl / Knoten / Zeichenstift / Hand'], ['P: Klick / Ziehen', 'Eckpunkt / Kurvenpunkt setzen; Enter beendet, Klick auf Start schließt'], ['R / O / L / S', 'Rechteck / Kreis / Linie / Stern zeichnen'], ['Leertaste', 'Ansicht verschieben'], ['⌘ + Scroll', 'Zoomen'], ['⌘0 / ⌘1', 'Einpassen / 100 %'], ['⌘S / ⌘O', 'Speichern / Öffnen'],
];
function Shortcuts() {
  const open = useStore((s) => s.helpOpen);
  if (!open) return null;
  const onClose = () => useStore.getState().set({ helpOpen: false });
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
  return (
    <aside className="panel left" aria-label="Ebenen">
      <div className="panel-head"><span className="sub">Ebenen</span></div>
      <div className="panel-body"><Layers /></div>
      <DocColors />
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
      <TopBar />
      <main className="workspace">
        <ToolRail />
        <LeftPanel />
        <div className="canvas-wrap"><Canvas /></div>
        <Inspector />
      </main>
      <StatusBar />
      <Toast />
      <CommandPalette />
      <Shortcuts />
    </div>
  );
}

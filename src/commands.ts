// Every editor command in one list — used by the command palette (⌘K)
import { useStore } from './store';
import * as A from './actions';
import { SHAPE_LABELS, type ShapeKind } from './lib/shapes';
import { SHAPE_ORDER } from './components/ShapePicker';

export interface Command {
  id: string;
  label: string;
  group: string;
  keys?: string;
  /** extra words that should find this command */
  terms?: string;
  hint?: () => string | undefined;
  when?: () => boolean;
  run: () => void;
}

const st = () => useStore.getState();
const sel = () => st().selection.length > 0;
const multi = () => st().selection.length > 1;
const node = () => !!st().nodeEdit;
const tool = (t: 'select' | 'node' | 'pan' | 'pen') => () => st().set({ tool: t });
const shape = (k: ShapeKind) => () => { st().setSettings({ shape: k }); st().set({ tool: 'shape' }); };
const toggle = (k: 'grid' | 'snap' | 'contextBar' | 'autoBake' | 'scaleStrokes') => () => st().setSettings({ [k]: !st().settings[k] });
const onOff = (k: 'grid' | 'snap' | 'contextBar') => () => (st().settings[k] ? 'an' : 'aus');
const off = () => {
  const s = st().settings;
  return `${s.offsetDistance} · ${s.offsetKind === 'area' ? 'Fläche' : 'Parallele'}`;
};

const SHAPE_KEYS: Partial<Record<ShapeKind, string>> = { rect: 'R', circle: 'O', line: 'L', star: 'S' };

export function commands(): Command[] {
  const list: Command[] = [
    // Datei
    { id: 'new', group: 'Datei', label: 'Neue Zeichenfläche', terms: 'neues dokument artboard', run: A.newDocument },
    { id: 'open', group: 'Datei', label: 'SVG öffnen …', keys: '⌘O', terms: 'datei laden import', run: () => document.getElementById('file-input')?.click() },
    { id: 'download', group: 'Datei', label: 'SVG herunterladen', keys: '⌘S', terms: 'speichern export', run: () => A.download() },
    { id: 'snapshot', group: 'Datei', label: 'Snapshot speichern', keys: '⇧⌘S', terms: 'zwischenspeichern stand sichern version', run: A.takeSnapshot },
    { id: 'snapshots', group: 'Datei', label: 'Snapshots anzeigen', terms: 'wiederherstellen stand version', run: () => st().set({ inspectorTab: 'history' }) },
    { id: 'paste-svg', group: 'Datei', label: 'SVG einfügen …', keys: '⌘V', terms: 'icon importieren zwischenablage skalieren rescale phosphor font awesome lucide', run: A.promptPasteSvg },
    { id: 'copy-svg', group: 'Datei', label: 'SVG-Code kopieren', terms: 'zwischenablage', run: A.copySvg },
    { id: 'minify', group: 'Datei', label: 'Minify auf Dokument anwenden', terms: 'svgo optimieren verkleinern', run: A.minifyDocument },
    { id: 'format', group: 'Datei', label: 'Code formatieren', terms: 'einrücken pretty', run: A.formatDocument },
    { id: 'rescale', group: 'Datei', label: 'Dokument skalieren …', terms: 'größe ändern resize rescale pfade anpassen', run: A.promptRescale },
    { id: 'fit-doc', group: 'Datei', label: 'Dokument an Inhalt anpassen', terms: 'viewbox zuschneiden crop', run: () => A.fitDocumentToContent() },

    // Bearbeiten
    { id: 'undo', group: 'Bearbeiten', label: 'Rückgängig', keys: '⌘Z', run: () => st().undo() },
    { id: 'redo', group: 'Bearbeiten', label: 'Wiederholen', keys: '⇧⌘Z', run: () => st().redo() },
    { id: 'select-all', group: 'Bearbeiten', label: 'Alles auswählen', keys: '⌘A', run: A.selectAll },
    { id: 'duplicate', group: 'Bearbeiten', label: 'Duplizieren', keys: '⌘D', when: sel, run: A.duplicateSelection },
    { id: 'delete', group: 'Bearbeiten', label: 'Löschen', keys: '⌫', when: sel, run: A.deleteSelection },
    { id: 'copy', group: 'Bearbeiten', label: 'Kopieren', keys: '⌘C', when: sel, run: () => A.copySelection() },
    { id: 'cut', group: 'Bearbeiten', label: 'Ausschneiden (Zwischenablage)', keys: '⌘X', when: sel, run: () => A.copySelection(true) },
    { id: 'group', group: 'Bearbeiten', label: 'Gruppieren', keys: '⌘G', when: sel, run: A.groupSelection },
    { id: 'ungroup', group: 'Bearbeiten', label: 'Gruppierung aufheben', keys: '⇧⌘G', when: sel, run: A.ungroupSelection },

    // Werkzeuge
    { id: 'tool-select', group: 'Werkzeuge', label: 'Auswahlwerkzeug', keys: 'V', run: tool('select') },
    { id: 'tool-node', group: 'Werkzeuge', label: 'Knotenwerkzeug', keys: 'A', run: tool('node') },
    { id: 'tool-pen', group: 'Werkzeuge', label: 'Zeichenstift', keys: 'P', terms: 'pen pfad zeichnen bezier kurve klicken', run: tool('pen') },
    { id: 'tool-pan', group: 'Werkzeuge', label: 'Hand', keys: 'H', terms: 'verschieben ansicht', run: tool('pan') },
    ...SHAPE_ORDER.map((k): Command => ({ id: 'shape-' + k, group: 'Werkzeuge', label: `${SHAPE_LABELS[k]} zeichnen`, keys: SHAPE_KEYS[k], terms: 'form', run: shape(k) })),

    // Pfad
    { id: 'offset-out', group: 'Pfad', label: 'Offset nach außen', terms: 'vergrößern rand kontur', hint: off, when: sel, run: () => A.offsetSelection(st().settings.offsetDistance) },
    { id: 'offset-in', group: 'Pfad', label: 'Offset nach innen', terms: 'verkleinern', hint: off, when: sel, run: () => A.offsetSelection(-st().settings.offsetDistance) },
    { id: 'expand-stroke', group: 'Pfad', label: 'Kontur in Fläche umwandeln', terms: 'stroke outline', when: sel, run: A.expandStroke },
    { id: 'centerline', group: 'Pfad', label: 'Mittellinie erzeugen', terms: 'centerline skelett achse mitte linie medial', when: sel, run: A.centerline },
    { id: 'to-path', group: 'Pfad', label: 'In Pfad umwandeln', when: sel, run: A.convertToPath },
    { id: 'apply-transforms', group: 'Pfad', label: 'Transformationen anwenden', when: sel, run: A.applyTransforms },
    { id: 'round', group: 'Pfad', label: 'Ecken abrunden', hint: () => `Radius ${st().settings.cornerRadius}`, when: sel, run: () => A.roundSelectedCorners() },
    { id: 'union', group: 'Kombinieren', label: 'Verbinden', terms: 'vereinigen union or boolean', when: multi, run: () => A.booleanSelection('union') },
    { id: 'subtract', group: 'Kombinieren', label: 'Ausschneiden (Boolesch)', terms: 'abziehen subtract minus', when: multi, run: () => A.booleanSelection('subtract') },
    { id: 'intersect', group: 'Kombinieren', label: 'Schnittmenge', terms: 'and intersect', when: multi, run: () => A.booleanSelection('intersect') },
    { id: 'exclude', group: 'Kombinieren', label: 'Ausschluss', terms: 'xor exclude', when: multi, run: () => A.booleanSelection('exclude') },

    // Knoten
    { id: 'edit-nodes', group: 'Knoten', label: 'Knoten bearbeiten', keys: 'Enter', when: () => st().selection.length === 1 && !node(), run: A.editSelectedNodes },
    { id: 'reverse', group: 'Knoten', label: 'Pfadrichtung umkehren', when: node, run: A.reversePath },
    { id: 'close', group: 'Knoten', label: 'Pfad schließen', when: node, run: () => A.setPathClosed(true) },
    { id: 'open-path', group: 'Knoten', label: 'Pfad öffnen', when: node, run: () => A.setPathClosed(false) },
    { id: 'node-insert', group: 'Knoten', label: 'Knoten danach einfügen', terms: 'punkt hinzufügen ergänzen', when: () => !!st().nodeSel, run: A.insertNodeAfterSelected },
    { id: 'subdivide', group: 'Knoten', label: 'Knoten verdoppeln', terms: 'punkte hinzufügen unterteilen subdivide', when: node, run: A.subdividePath },
    { id: 'knife', group: 'Werkzeuge', label: 'Schere: Pfad schneiden', keys: 'C', terms: 'messer cut knife trennen', run: () => st().set({ tool: 'knife' }) },
    { id: 'split', group: 'Knoten', label: 'Pfad am Knoten auftrennen', when: () => !!st().nodeSel, run: A.splitAtSelectedNode },
    { id: 'node-delete', group: 'Knoten', label: 'Knoten löschen', keys: '⌫', when: () => !!st().nodeSel, run: A.deleteSelectedNode },
    ...(['corner', 'smooth', 'symmetric'] as const).map((k): Command => ({
      id: 'node-' + k, group: 'Knoten', label: `Knoten: ${A.NODE_LABELS[k]}`, when: () => !!st().nodeSel, run: () => A.setSelectedNodeKind(k),
    })),
    ...(['corner', 'smooth', 'symmetric'] as const).map((k): Command => ({
      id: 'nodes-all-' + k, group: 'Knoten', label: `Alle Knoten: ${A.NODE_LABELS[k]}`, when: node, run: () => A.setAllNodesKind(k),
    })),
    { id: 'node-done', group: 'Knoten', label: 'Knotenbearbeitung beenden', keys: 'Esc', when: node, run: () => st().set({ nodeEdit: null }) },

    // Anordnen
    { id: 'align-left', group: 'Anordnen', label: 'Links ausrichten', when: sel, run: () => A.align('left', !multi()) },
    { id: 'align-hcenter', group: 'Anordnen', label: 'Horizontal zentrieren', when: sel, run: () => A.align('hcenter', !multi()) },
    { id: 'align-right', group: 'Anordnen', label: 'Rechts ausrichten', when: sel, run: () => A.align('right', !multi()) },
    { id: 'align-top', group: 'Anordnen', label: 'Oben ausrichten', when: sel, run: () => A.align('top', !multi()) },
    { id: 'align-vcenter', group: 'Anordnen', label: 'Vertikal zentrieren', when: sel, run: () => A.align('vcenter', !multi()) },
    { id: 'align-bottom', group: 'Anordnen', label: 'Unten ausrichten', when: sel, run: () => A.align('bottom', !multi()) },
    { id: 'dist-h', group: 'Anordnen', label: 'Horizontal verteilen', when: () => st().selection.length > 2, run: () => A.distribute('h') },
    { id: 'dist-v', group: 'Anordnen', label: 'Vertikal verteilen', when: () => st().selection.length > 2, run: () => A.distribute('v') },
    { id: 'flip-h', group: 'Anordnen', label: 'Horizontal spiegeln', when: sel, run: () => A.flip('h') },
    { id: 'flip-v', group: 'Anordnen', label: 'Vertikal spiegeln', when: sel, run: () => A.flip('v') },
    { id: 'rot-cw', group: 'Anordnen', label: '90° im Uhrzeigersinn drehen', when: sel, run: () => A.rotateSelection(90) },
    { id: 'rot-ccw', group: 'Anordnen', label: '90° gegen den Uhrzeigersinn drehen', when: sel, run: () => A.rotateSelection(-90) },
    { id: 'front', group: 'Anordnen', label: 'Ganz nach vorne', keys: '⇧⌘]', when: sel, run: () => A.arrange('front') },
    { id: 'forward', group: 'Anordnen', label: 'Eine Ebene nach vorne', keys: '⌘]', when: sel, run: () => A.arrange('forward') },
    { id: 'backward', group: 'Anordnen', label: 'Eine Ebene nach hinten', keys: '⌘[', when: sel, run: () => A.arrange('backward') },
    { id: 'back', group: 'Anordnen', label: 'Ganz nach hinten', keys: '⇧⌘[', when: sel, run: () => A.arrange('back') },

    // Ansicht
    { id: 'fit', group: 'Ansicht', label: 'Einpassen', keys: '⌘0', run: A.fitView },
    { id: 'fit-all', group: 'Ansicht', label: 'Alle Zeichenflächen einpassen', keys: '⇧⌘0', terms: 'artboards übersicht', run: A.fitAll },
    { id: 'board-next', group: 'Ansicht', label: 'Nächste Zeichenfläche', terms: 'artboard dokument wechseln rechts', run: () => A.cycleBoard(1) },
    { id: 'board-prev', group: 'Ansicht', label: 'Vorherige Zeichenfläche', terms: 'artboard dokument wechseln links', run: () => A.cycleBoard(-1) },
    { id: 'board-close', group: 'Datei', label: 'Zeichenfläche schließen', terms: 'artboard dokument entfernen', run: A.closeBoard },
    { id: 'zoom-100', group: 'Ansicht', label: 'Zoom 100 %', keys: '⌘1', run: () => A.zoomTo(1) },
    { id: 'zoom-in', group: 'Ansicht', label: 'Hineinzoomen', keys: '⌘+', run: () => A.zoomBy(1.25) },
    { id: 'zoom-out', group: 'Ansicht', label: 'Herauszoomen', keys: '⌘−', run: () => A.zoomBy(0.8) },
    { id: 'grid', group: 'Ansicht', label: 'Raster ein/aus', keys: '#', hint: onOff('grid'), run: toggle('grid') },
    { id: 'snap', group: 'Ansicht', label: 'Am Raster einrasten ein/aus', hint: onOff('snap'), run: toggle('snap') },
    { id: 'context-bar', group: 'Ansicht', label: 'Kontextleiste ein/aus', terms: 'schwebend toolbar', hint: onOff('contextBar'), run: toggle('contextBar') },
    { id: 'shortcuts', group: 'Ansicht', label: 'Tastenkürzel anzeigen', keys: '?', terms: 'hilfe', run: () => st().set({ helpOpen: true }) },

    // Einstellungen
    { id: 'auto-bake', group: 'Einstellungen', label: 'Transformationen direkt in Geometrie schreiben', hint: () => (st().settings.autoBake ? 'an' : 'aus'), run: toggle('autoBake') },
    { id: 'scale-strokes', group: 'Einstellungen', label: 'Konturbreite mitskalieren', hint: () => (st().settings.scaleStrokes ? 'an' : 'aus'), run: toggle('scaleStrokes') },
  ];

  // recent documents
  const { recent, docId } = st();
  for (const d of recent) {
    if (d.id === docId) continue;
    list.push({ id: 'recent-' + d.id, group: 'Zuletzt bearbeitet', label: `Öffnen: ${d.name}`, terms: 'datei icon', run: () => A.openRecent(d.id) });
    list.push({ id: 'recent-beside-' + d.id, group: 'Zuletzt bearbeitet', label: `Daneben öffnen: ${d.name}`, terms: 'zeichenfläche artboard', run: () => A.openRecent(d.id, true) });
  }
  return list;
}

/** Subsequence match: returns a score (higher is better) and the matched character positions, or null */
export function fuzzy(text: string, query: string): { score: number; hits: number[] } | null {
  const t = text.toLowerCase(), q = query.toLowerCase().trim();
  if (!q) return { score: 0, hits: [] };
  const word = t.indexOf(q);
  if (word >= 0) {
    const start = word === 0 || /[\s:(-]/.test(t[word - 1]);
    return { score: 100 - word + (start ? 50 : 0), hits: Array.from({ length: q.length }, (_, i) => word + i) };
  }
  const hits: number[] = [];
  let i = 0, score = 0, prev = -2;
  for (const ch of q) {
    if (ch === ' ') continue;
    i = t.indexOf(ch, i);
    if (i < 0) return null;
    score += i === prev + 1 ? 5 : 1;
    hits.push(i);
    prev = i++;
  }
  return { score, hits };
}

const LS = 'svg-editor-cmd-recent';
export function recentCommands(): string[] {
  try { const v = JSON.parse(localStorage.getItem(LS) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
export function rememberCommand(id: string) {
  try { localStorage.setItem(LS, JSON.stringify([id, ...recentCommands().filter((x) => x !== id)].slice(0, 6))); } catch { /* ignore */ }
}

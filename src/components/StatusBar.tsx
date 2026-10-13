import { useEffect, useState } from 'react';
import { selectedNodes, useStore } from '../store';
import * as A from '../actions';
import { byteSize, fmtBytes, minify } from '../lib/minify';
import { tryParse, getEl } from '../lib/svg';
import { toNodes } from '../lib/nodes';

const n = (v: number) => (+v.toFixed(2)).toLocaleString('de-DE');

/** Bottom bar: pointer position, selection, file size, grid */
export function StatusBar() {
  const cursor = useStore((s) => s.cursor);
  const svg = useStore((s) => s.svg);
  const count = useStore((s) => s.selection.length);
  const union = useStore((s) => s.geo.union);
  const nodeEdit = useStore((s) => s.nodeEdit);
  const nodeSel = useStore((s) => s.nodeSel);
  const nodeMulti = useStore((s) => s.nodeMulti);
  const smoothNodes = useStore((s) => s.smoothNodes);
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const [min, setMin] = useState<number | null>(null);

  // minified size, computed once editing pauses
  useEffect(() => {
    setMin(null);
    const t = window.setTimeout(() => {
      try { setMin(byteSize(minify(svg, { precision: settings.precision, multipass: settings.minMultipass, keepIds: settings.minKeepIds, pretty: false }))); } catch { setMin(null); }
    }, 700);
    return () => clearTimeout(t);
  }, [svg, settings.precision, settings.minMultipass, settings.minKeepIds]);

  let sel = 'Keine Auswahl';
  if (nodeEdit) {
    const doc = tryParse(svg).doc;
    const subs = doc ? toNodes(getEl(doc, nodeEdit)?.getAttribute('d') ?? '') : [];
    const node = nodeSel ? subs[nodeSel.s]?.nodes[nodeSel.j] : null;
    const total = subs.reduce((a, sp) => a + sp.nodes.length, 0);
    const count = selectedNodes({ nodeSel, nodeMulti }).length;
    sel = count > 1 ? `${count} Knoten ausgewählt` : node ? `Knoten ${nodeSel!.j + 1} · ${A.NODE_LABELS[A.effNodeKind(node, nodeSel!, smoothNodes)]} · X ${n(node.x)} Y ${n(node.y)}` : `Knotenmodus · ${total} Knoten`;
  } else if (count) {
    sel = `${count === 1 ? '1 Element' : `${count} Elemente`}${union ? ` · ${n(union.w)} × ${n(union.h)}` : ''}`;
  }
  const size = byteSize(svg);

  return (
    <footer className="statusbar">
      <span className="sb-pos">{cursor ? `X ${n(cursor.x)} · Y ${n(cursor.y)}` : 'X – · Y –'}</span>
      <span>{sel}</span>
      <span className="spacer" />
      <button className="sb-btn" title="Minify auf Dokument anwenden" onClick={A.minifyDocument} disabled={min === null || min >= size}>
        {fmtBytes(size)}{min !== null && min < size ? ` → ${fmtBytes(min)} minifiziert` : ''}
      </button>
      <label className="sb-snap" title="Rasterweite fürs Einrasten">
        <input type="checkbox" checked={settings.snap} onChange={(e) => setSettings({ snap: e.target.checked })} /> Einrasten
        <select value={settings.snapStep} onChange={(e) => setSettings({ snapStep: +e.target.value })} aria-label="Rasterweite">
          {[0.5, 1, 2, 4, 8, 10, 16].map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      </label>
      <span className="sb-saved">Im Browser gespeichert</span>
    </footer>
  );
}

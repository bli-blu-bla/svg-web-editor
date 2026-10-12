import { AlignCenterHorizontal, AlignCenterVertical, Copy, Scissors, Spline, Trash2 } from 'lucide-react';
import { useStore } from '../store';
import * as A from '../actions';
import { getEl, parseSvg, SHAPES } from '../lib/svg';
import type { PNode } from '../lib/nodes';
import { BOOL_OPS, BoolIcon, NodeKindIcon } from './Properties';

const stop = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation();

function Bar({ x, y, label, children }: { x: number; y: number; label: string; children: React.ReactNode }) {
  return (
    <div className="ctx-bar" role="toolbar" aria-label={label} style={{ left: x, top: y }}
      onPointerDown={stop} onPointerUp={stop} onDoubleClick={stop} onWheel={stop}>
      {children}
    </div>
  );
}

function Btn({ title, onClick, children, on, text, danger }: { title: string; onClick: () => void; children: React.ReactNode; on?: boolean; text?: boolean; danger?: boolean }) {
  return (
    <button className={`ctx-btn ${text ? 'text' : ''} ${on ? 'on' : ''} ${danger ? 'danger' : ''}`} title={title} aria-label={text ? undefined : title} aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  );
}

const Sep = () => <span className="ctx-sep" />;

/** Floating actions above the selection */
export function ContextBar({ x, y, count }: { x: number; y: number; count: number }) {
  const set = useStore((s) => s.set);
  const svg = useStore((s) => s.svg);
  const selection = useStore((s) => s.selection);
  const multi = count > 1;
  let canNodes = false;
  if (count === 1) {
    try { const el = getEl(parseSvg(svg), selection[0]); canNodes = !!el && (el.localName === 'path' || SHAPES.has(el.localName)); } catch { /* ignore */ }
  }
  const where = multi ? '' : ' (am Dokument)';
  return (
    <Bar x={x} y={y} label="Aktionen für die Auswahl">
      {multi && (
        <>
          {BOOL_OPS.map(([op, label, title]) => (
            <Btn key={op} title={`${label} – ${title}`} onClick={() => A.booleanSelection(op)}><BoolIcon op={op} /></Btn>
          ))}
          <Sep />
        </>
      )}
      <Btn title={`Horizontal zentrieren${where}`} onClick={() => A.align('hcenter', !multi)}><AlignCenterVertical size={17} /></Btn>
      <Btn title={`Vertikal zentrieren${where}`} onClick={() => A.align('vcenter', !multi)}><AlignCenterHorizontal size={17} /></Btn>
      <Sep />
      <Btn text title="Offset, Ecken abrunden und weitere Pfad-Werkzeuge" onClick={() => set({ inspectorTab: 'path' })}><OffsetIcon /> Offset</Btn>
      {canNodes && <Btn text title="Knoten bearbeiten (Enter)" onClick={A.editSelectedNodes}><Spline size={16} /> Knoten</Btn>}
      <Sep />
      <Btn title="Duplizieren (⌘D)" onClick={A.duplicateSelection}><Copy size={16} /></Btn>
      <Btn title="Löschen (⌫)" danger onClick={A.deleteSelection}><Trash2 size={16} /></Btn>
    </Bar>
  );
}

/** Floating actions below the selected node */
export function NodeBar({ x, y, node }: { x: number; y: number; node: PNode }) {
  const nodeSel = useStore((s) => s.nodeSel);
  const smoothNodes = useStore((s) => s.smoothNodes);
  const kind = nodeSel ? A.effNodeKind(node, nodeSel, smoothNodes) : null;
  return (
    <Bar x={x} y={y} label="Aktionen für den Knoten">
      {(['corner', 'smooth', 'symmetric'] as const).map((k) => (
        <Btn key={k} text on={kind === k} title={`Knotentyp: ${A.NODE_LABELS[k]}`} onClick={() => A.setSelectedNodeKind(k)}>
          <NodeKindIcon kind={k} /> {A.NODE_LABELS[k]}
        </Btn>
      ))}
      <Sep />
      <Btn title="Pfad an diesem Knoten auftrennen" onClick={A.splitAtSelectedNode}><Scissors size={16} /></Btn>
      <Btn title="Knoten löschen (⌫)" danger onClick={A.deleteSelectedNode}><Trash2 size={16} /></Btn>
    </Bar>
  );
}

function OffsetIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <rect x="7.5" y="7.5" width="9" height="9" rx="1" />
      <rect x="3" y="3" width="18" height="18" rx="5" strokeDasharray="3 3" />
    </svg>
  );
}

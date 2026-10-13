import { Grid3x3, Hand, Keyboard, Magnet, MousePointer2, PenTool, Scissors, Spline } from 'lucide-react';
import { useStore } from '../store';
import { SHAPE_LABELS, type ShapeKind } from '../lib/shapes';
import { RAIL_SHAPES, ShapeIcon, ShapePicker } from './ShapePicker';

const SHAPE_KEYS: Partial<Record<ShapeKind, string>> = { rect: 'R', circle: 'O', star: 'S', line: 'L' };

function RailBtn({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className={`iconbtn rail-btn ${active ? 'active' : ''}`} aria-label={label} title={label} aria-pressed={active} onClick={onClick}>
      {children}
    </button>
  );
}

/** Vertical tool bar on the left edge */
export function ToolRail() {
  const tool = useStore((s) => s.tool);
  const shape = useStore((s) => s.settings.shape);
  const grid = useStore((s) => s.settings.grid);
  const snap = useStore((s) => s.settings.snap);
  const snapStep = useStore((s) => s.settings.snapStep);
  const set = useStore((s) => s.set);
  const setSettings = useStore((s) => s.setSettings);

  return (
    <nav className="rail" aria-label="Werkzeuge">
      <RailBtn label="Auswahl (V)" active={tool === 'select'} onClick={() => set({ tool: 'select' })}><MousePointer2 size={18} /></RailBtn>
      <RailBtn label="Knoten bearbeiten (A)" active={tool === 'node'} onClick={() => set({ tool: 'node' })}><Spline size={18} /></RailBtn>
      <RailBtn label="Zeichenstift (P)" active={tool === 'pen'} onClick={() => set({ tool: tool === 'pen' ? 'select' : 'pen' })}><PenTool size={18} /></RailBtn>
      <RailBtn label="Schere: Pfad schneiden (C)" active={tool === 'knife'} onClick={() => set({ tool: tool === 'knife' ? 'select' : 'knife' })}><Scissors size={18} /></RailBtn>
      <div className="rail-sep" />
      {RAIL_SHAPES.map((k) => (
        <RailBtn key={k} label={`${SHAPE_LABELS[k]} (${SHAPE_KEYS[k]})`} active={tool === 'shape' && shape === k}
          onClick={() => { setSettings({ shape: k }); set({ tool: tool === 'shape' && shape === k ? 'select' : 'shape' }); }}>
          <ShapeIcon kind={k} size={19} />
        </RailBtn>
      ))}
      <ShapePicker />
      <div className="rail-sep" />
      <RailBtn label="Hand (H / Leertaste)" active={tool === 'pan'} onClick={() => set({ tool: 'pan' })}><Hand size={18} /></RailBtn>
      <div className="spacer" />
      <RailBtn label="Raster (#)" active={grid} onClick={() => setSettings({ grid: !grid })}><Grid3x3 size={18} /></RailBtn>
      <RailBtn label={`Am Raster einrasten (${snapStep})`} active={snap} onClick={() => setSettings({ snap: !snap })}><Magnet size={18} /></RailBtn>
      <RailBtn label="Tastenkürzel (?)" onClick={() => set({ helpOpen: true })}><Keyboard size={18} /></RailBtn>
    </nav>
  );
}

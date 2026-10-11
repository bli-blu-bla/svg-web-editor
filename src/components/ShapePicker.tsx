import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useStore } from '../store';
import { SHAPE_LABELS, shapeSpec, type ShapeKind } from '../lib/shapes';
import { createElement } from 'react';

export const SHAPE_ORDER: ShapeKind[] = ['rect', 'square', 'circle', 'ellipse', 'triangle', 'polygon', 'star', 'arrow', 'line', 'cross', 'heart'];
const KEYS: Partial<Record<ShapeKind, string>> = { rect: 'R', circle: 'O', line: 'L', star: 'S' };

/** Icon rendered from the real shape generator, so it always matches what gets inserted */
export function ShapeIcon({ kind, size = 17 }: { kind: ShapeKind; size?: number }) {
  const s = useStore((st) => st.settings);
  const box = kind === 'rect' || kind === 'ellipse' || kind === 'arrow' ? { x: 2, y: 5, w: 16, h: 10 } : { x: 3, y: 3, w: 14, h: 14 };
  const spec = shapeSpec(kind, box, { starPoints: s.starPoints, starInner: s.starInner, polySides: s.polySides, prec: 2 },
    kind === 'line' ? { a: { x: 3, y: 17 }, b: { x: 17, y: 3 } } : undefined);
  return (
    <svg width={size} height={size} viewBox="0 0 20 20">
      {createElement(spec.tag, { ...spec.attrs, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round', strokeLinecap: 'round' })}
    </svg>
  );
}

export function ShapePicker() {
  const tool = useStore((s) => s.tool);
  const shape = useStore((s) => s.settings.shape);
  const set = useStore((s) => s.set);
  const setSettings = useStore((s) => s.setSettings);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  const choose = (k: ShapeKind) => { setSettings({ shape: k }); set({ tool: 'shape' }); setOpen(false); };

  return (
    <div className="shape-picker" ref={ref}>
      <button className={`iconbtn ${tool === 'shape' ? 'active' : ''}`} title={`${SHAPE_LABELS[shape]} zeichnen`} onClick={() => set({ tool: tool === 'shape' ? 'select' : 'shape' })}>
        <ShapeIcon kind={shape} />
      </button>
      <button className="iconbtn caret" title="Form wählen" onClick={() => setOpen(!open)}><ChevronDown size={13} /></button>
      {open && (
        <div className="shape-menu">
          {SHAPE_ORDER.map((k) => (
            <button key={k} className={k === shape ? 'on' : ''} onClick={() => choose(k)} title={SHAPE_LABELS[k]}>
              <ShapeIcon kind={k} size={22} />
              <span>{SHAPE_LABELS[k]}</span>
              {KEYS[k] && <kbd>{KEYS[k]}</kbd>}
            </button>
          ))}
          <div className="shape-hint">Ziehen = aufziehen · ⇧ proportional · ⌥ von der Mitte · Klick = Standardgröße</div>
        </div>
      )}
    </div>
  );
}

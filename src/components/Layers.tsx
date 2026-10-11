import { useState } from 'react';
import { ChevronRight, Folder, Spline, Square, Circle, Minus, Type, Image, Shapes, Link2, Hexagon } from 'lucide-react';
import { useStore } from '../store';
import { effProp, idOf, isSelectable, kids, parentId } from '../lib/svg';
import { useDoc } from './Properties';

const ICONS: Record<string, JSX.Element> = {
  g: <Folder size={14} />, path: <Spline size={14} />, rect: <Square size={14} />, circle: <Circle size={14} />, ellipse: <Circle size={14} />,
  line: <Minus size={14} />, polyline: <Spline size={14} />, polygon: <Hexagon size={14} />, text: <Type size={14} />, image: <Image size={14} />, use: <Link2 size={14} />,
};

export function Layers() {
  const doc = useDoc();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const selection = useStore((s) => s.selection);
  const hoverId = useStore((s) => s.hoverId);
  if (!doc) return <div className="panel-empty">SVG kann nicht geparst werden.</div>;

  const onClick = (id: string, e: React.MouseEvent) => {
    const s = useStore.getState();
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      s.select(s.selection.includes(id) ? s.selection.filter((x) => x !== id) : [...s.selection, id]);
    } else s.select([id]);
    s.set({ scope: parentId(id) });
  };

  const rows: JSX.Element[] = [];
  const walk = (el: Element, depth: number) => {
    // topmost layers first, like design tools
    for (const c of kids(el).reverse()) {
      if (!isSelectable(c)) continue;
      const id = idOf(c);
      const hasKids = kids(c).some(isSelectable);
      const open = !collapsed.has(id);
      const fill = effProp(c, 'fill', '#000');
      const stroke = effProp(c, 'stroke', 'none');
      rows.push(
        <div
          key={id}
          className={`layer ${selection.includes(id) ? 'sel' : ''} ${hoverId === id ? 'hover' : ''}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={(e) => onClick(id, e)}
          onMouseEnter={() => useStore.getState().set({ hoverId: id })}
          onMouseLeave={() => useStore.getState().set({ hoverId: null })}
        >
          <span className={`tw ${hasKids ? '' : 'hidden'} ${open ? 'open' : ''}`}
            onClick={(e) => { e.stopPropagation(); const n = new Set(collapsed); if (open) n.add(id); else n.delete(id); setCollapsed(n); }}>
            <ChevronRight size={12} />
          </span>
          <span className="licon">{ICONS[c.localName] || <Shapes size={14} />}</span>
          <span className="lname">{c.getAttribute('id') || c.localName}</span>
          <span className="ldots">
            {fill !== 'none' && !fill.startsWith('url') && <i style={{ background: fill }} />}
            {stroke !== 'none' && !stroke.startsWith('url') && <i className="ring" style={{ borderColor: stroke }} />}
          </span>
        </div>,
      );
      if (hasKids && open) walk(c, depth + 1);
    }
  };
  walk(doc.documentElement, 0);

  return (
    <div className="layers">
      {rows.length ? rows : <div className="panel-empty">Keine Elemente</div>}
    </div>
  );
}

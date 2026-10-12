import { useMemo, useState } from 'react';
import {
  AlignStartVertical, AlignCenterVertical, AlignEndVertical, AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
  AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter, FlipHorizontal2, FlipVertical2, RotateCcw, RotateCw,
  Lock, Unlock, Copy, Trash2, Group, Ungroup, BringToFront, SendToBack, ArrowUp, ArrowDown, Ban, Plus, X,
} from 'lucide-react';
import { useStore } from '../store';
import { SHAPE_LABELS } from '../lib/shapes';
import { toNodes, type NodeKind } from '../lib/nodes';
import { ShapeIcon, SHAPE_ORDER } from './ShapePicker';
import * as A from '../actions';
import { docSize, effProp, getEl, idOf, isSelectable, kids, listColors, ownProp, toHex, tryParse } from '../lib/svg';
import { IconBtn, NumField, Section, Segmented, TextField, Toggle } from './ui';

export function useDoc() {
  const svg = useStore((s) => s.svg);
  return useMemo(() => tryParse(svg).doc ?? null, [svg]);
}

function common(vals: string[]): string | null {
  return vals.length && vals.every((v) => v === vals[0]) ? vals[0] : null;
}

export function Properties() {
  const doc = useDoc();
  const selection = useStore((s) => s.selection);
  const scope = useStore((s) => s.scope);
  const union = useStore((s) => s.geo.union);
  const settings = useStore((s) => s.settings);
  const tool = useStore((s) => s.tool);
  const nodeEdit = useStore((s) => s.nodeEdit);
  const setSettings = useStore((s) => s.setSettings);
  const [scalePct, setScalePct] = useState(100);
  const [rot, setRot] = useState(15);
  const [toDoc, setToDoc] = useState(false);

  const els = useMemo(() => (doc ? selection.map((id) => getEl(doc, id)).filter((e): e is Element => !!e) : []), [doc, selection]);
  if (!doc) return <div className="panel-empty">SVG kann nicht geparst werden – Code prüfen.</div>;

  const scopeEl = getEl(doc, scope) || doc.documentElement;
  const all = kids(scopeEl).filter(isSelectable).map(idOf);
  const isAll = selection.length > 1 && all.length === selection.length && all.every((id) => selection.includes(id));
  const has = els.length > 0;

  const eff = (p: string, def: string) => common(els.map((e) => effProp(e, p, def)));

  const selLabel = !has ? 'Keine' : isAll ? 'Alle' : els.length === 1
    ? `<${els[0].localName}>${els[0].getAttribute('id') ? ' #' + els[0].getAttribute('id') : ''}`
    : `${els.length} Elemente`;

  return (
    <div className="props">
      <div className="sel-info">
        <span>Auswahl:</span> <code>{selLabel}</code>
      </div>

      {tool === 'shape' && <ShapeSection />}
      {nodeEdit && <NodeSection doc={doc} id={nodeEdit} />}

      {has && union && (
        <Section title="Dimensionen">
          <div className="dims">
            <AnchorPicker value={settings.anchor} onChange={(anchor) => setSettings({ anchor })} />
            <div className="grid2">
            <NumField label="X" value={union.x + settings.anchor[0] * union.w} onCommit={(x) => A.setAnchored({ x })} />
            <NumField label="Y" value={union.y + settings.anchor[1] * union.h} onCommit={(y) => A.setAnchored({ y })} />
            <NumField label="B" value={union.w} onCommit={(w) => A.setAnchored(settings.keepRatio && union.w ? { w, h: (union.h * w) / union.w } : { w })} />
            <div className="with-btn">
              <NumField label="H" value={union.h} onCommit={(h) => A.setAnchored(settings.keepRatio && union.h ? { h, w: (union.w * h) / union.h } : { h })} />
              <IconBtn title="Seitenverhältnis sperren" icon={settings.keepRatio ? <Lock size={14} /> : <Unlock size={14} />} active={settings.keepRatio} onClick={() => setSettings({ keepRatio: !settings.keepRatio })} />
            </div>
            </div>
          </div>
          <div className="row gap">
            <NumField label="Skal." value={scalePct} suffix="%" onCommit={setScalePct} />
            <button className="btn" onClick={() => A.scaleSelection(scalePct / 100)}>Anwenden</button>
            <button className="btn sm" title="Verkleinern 10 %" onClick={() => A.scaleSelection(1 / 1.1)}>−</button>
            <button className="btn sm" title="Vergrößern 10 %" onClick={() => A.scaleSelection(1.1)}>+</button>
          </div>
          <div className="row gap">
            <NumField label="∠" value={rot} suffix="°" onCommit={setRot} />
            <IconBtn title={`−${rot}° drehen`} icon={<RotateCcw size={15} />} onClick={() => A.rotateSelection(-rot)} />
            <IconBtn title={`+${rot}° drehen`} icon={<RotateCw size={15} />} onClick={() => A.rotateSelection(rot)} />
            <IconBtn title="Horizontal spiegeln" icon={<FlipHorizontal2 size={15} />} onClick={() => A.flip('h')} />
            <IconBtn title="Vertikal spiegeln" icon={<FlipVertical2 size={15} />} onClick={() => A.flip('v')} />
          </div>
        </Section>
      )}

      {has && (
        <Section title="Ausrichten & Anordnen" defaultOpen={false}>
          <div className="row icons">
            <IconBtn title="Links" icon={<AlignStartVertical size={15} />} onClick={() => A.align('left', toDoc)} />
            <IconBtn title="Horizontal zentriert" icon={<AlignCenterVertical size={15} />} onClick={() => A.align('hcenter', toDoc)} />
            <IconBtn title="Rechts" icon={<AlignEndVertical size={15} />} onClick={() => A.align('right', toDoc)} />
            <IconBtn title="Oben" icon={<AlignStartHorizontal size={15} />} onClick={() => A.align('top', toDoc)} />
            <IconBtn title="Vertikal zentriert" icon={<AlignCenterHorizontal size={15} />} onClick={() => A.align('vcenter', toDoc)} />
            <IconBtn title="Unten" icon={<AlignEndHorizontal size={15} />} onClick={() => A.align('bottom', toDoc)} />
            <IconBtn title="Horizontal verteilen" icon={<AlignHorizontalDistributeCenter size={15} />} onClick={() => A.distribute('h')} />
            <IconBtn title="Vertikal verteilen" icon={<AlignVerticalDistributeCenter size={15} />} onClick={() => A.distribute('v')} />
          </div>
          <Toggle label="Am Dokument ausrichten" checked={toDoc || els.length === 1} onChange={setToDoc} />
          <div className="row icons">
            <IconBtn title="Ganz nach vorne (⇧⌘])" icon={<BringToFront size={15} />} onClick={() => A.arrange('front')} />
            <IconBtn title="Eine Ebene nach vorne (⌘])" icon={<ArrowUp size={15} />} onClick={() => A.arrange('forward')} />
            <IconBtn title="Eine Ebene nach hinten (⌘[)" icon={<ArrowDown size={15} />} onClick={() => A.arrange('backward')} />
            <IconBtn title="Ganz nach hinten (⇧⌘[)" icon={<SendToBack size={15} />} onClick={() => A.arrange('back')} />
            <IconBtn title="Gruppieren (⌘G)" icon={<Group size={15} />} onClick={A.groupSelection} />
            <IconBtn title="Gruppierung aufheben (⇧⌘G)" icon={<Ungroup size={15} />} onClick={A.ungroupSelection} />
            <IconBtn title="Duplizieren (⌘D)" icon={<Copy size={15} />} onClick={A.duplicateSelection} />
            <IconBtn title="Löschen (⌫)" icon={<Trash2 size={15} />} onClick={A.deleteSelection} />
          </div>
        </Section>
      )}

      {has && (
        <Section title="Erscheinungsbild">
          <OpacityRow value={eff('opacity', '1')} />
          <ColorRow label="Füllung" prop="fill" value={eff('fill', '#000000')} />
          <ColorRow label="Kontur" prop="stroke" value={eff('stroke', 'none')} />
          <div className="row">
            <span className="lbl">Konturbreite</span>
            <NumField value={eff('stroke-width', '1') !== null ? parseFloat(eff('stroke-width', '1')!) : null} step={0.5} onCommit={(v) => A.setProps({ 'stroke-width': String(v) }, 'Konturbreite')} />
          </div>
          <div className="row">
            <span className="lbl">Linienende</span>
            <Segmented value={eff('stroke-linecap', 'butt')} onChange={(v) => A.setProps({ 'stroke-linecap': v }, 'Linienende')}
              options={[{ value: 'butt', label: <CapIcon t="butt" />, title: 'Butt' }, { value: 'round', label: <CapIcon t="round" />, title: 'Rund' }, { value: 'square', label: <CapIcon t="square" />, title: 'Quadratisch' }]} />
          </div>
          <div className="row">
            <span className="lbl">Ecken</span>
            <Segmented value={eff('stroke-linejoin', 'miter')} onChange={(v) => A.setProps({ 'stroke-linejoin': v }, 'Ecken')}
              options={[{ value: 'miter', label: <JoinIcon t="miter" />, title: 'Spitz (Miter)' }, { value: 'round', label: <JoinIcon t="round" />, title: 'Rund' }, { value: 'bevel', label: <JoinIcon t="bevel" />, title: 'Abgeflacht (Bevel)' }]} />
          </div>
          <div className="row">
            <span className="lbl">Füllregel</span>
            <Segmented value={eff('fill-rule', 'nonzero')} onChange={(v) => A.setProps({ 'fill-rule': v }, 'Füllregel')}
              options={[{ value: 'nonzero', label: 'nonzero' }, { value: 'evenodd', label: 'evenodd' }]} />
          </div>
          <div className="row">
            <span className="lbl">Strichelung</span>
            <TextField value={eff('stroke-dasharray', '') ?? ''} placeholder="z. B. 4 2" mono onCommit={(v) => A.setProps({ 'stroke-dasharray': v.trim() || null }, 'Strichelung')} />
          </div>
          <Toggle label="Farben auf Gruppeninhalt anwenden" checked={settings.deepColor} onChange={(v) => setSettings({ deepColor: v })} />
        </Section>
      )}

      {has && (
        <Section title="Pfad-Werkzeuge">
          <div className="row gap">
            <NumField label="Offset" value={settings.offsetDistance} step={0.5} onCommit={(v) => setSettings({ offsetDistance: Math.abs(v) })} />
            <button className="btn primary" title="Nach außen vergrößern" onClick={() => A.offsetSelection(settings.offsetDistance)}>Außen</button>
            <button className="btn" title="Nach innen verkleinern" onClick={() => A.offsetSelection(-settings.offsetDistance)}>Innen</button>
          </div>
          <div className="row">
            <span className="lbl">Modus</span>
            <Segmented value={settings.offsetKind} onChange={(v) => setSettings({ offsetKind: v })}
              options={[
                { value: 'area', label: 'Fläche', title: 'Sichtbare Form (Füllung + Kontur) wachsen/schrumpfen lassen' },
                { value: 'parallel', label: 'Parallele', title: 'Parallele Linie zum Pfad (Kurven bleiben erhalten)' },
              ]} />
          </div>
          <div className="row">
            <span className="lbl">Ecken</span>
            <Segmented value={settings.offsetJoin} onChange={(v) => setSettings({ offsetJoin: v })}
              options={[{ value: 'miter', label: <JoinIcon t="miter" />, title: 'Spitz' }, { value: 'round', label: <JoinIcon t="round" />, title: 'Rund' }, { value: 'bevel', label: <JoinIcon t="bevel" />, title: 'Abgeflacht' }]} />
          </div>
          <Toggle label="Als Kopie erzeugen" checked={settings.offsetCopy} onChange={(v) => setSettings({ offsetCopy: v })} />
          <div className="sub">Ecken abrunden</div>
          <div className="row gap">
            <NumField label="Radius" value={els.length === 1 && els[0].localName === 'rect' ? parseFloat(els[0].getAttribute('rx') || els[0].getAttribute('ry') || '0') : settings.cornerRadius}
              step={1} onCommit={(v) => { setSettings({ cornerRadius: Math.max(0, v) }); A.roundSelectedCorners(Math.max(0, v)); }} />
            <button className="btn" title="Ecken mit dem Radius abrunden" onClick={() => A.roundSelectedCorners()}><CornerIcon /> Abrunden</button>
          </div>
          <div className="sub">Kombinieren</div>
          <div className="bool-row">
            <button className="btn" title="Verbinden (Vereinigung, OR)" onClick={() => A.booleanSelection('union')}><BoolIcon op="union" /> Verbinden</button>
            <button className="btn" title="Ausschneiden: obere Elemente vom untersten abziehen" onClick={() => A.booleanSelection('subtract')}><BoolIcon op="subtract" /> Ausschneiden</button>
            <button className="btn" title="Schnittmenge (AND)" onClick={() => A.booleanSelection('intersect')}><BoolIcon op="intersect" /> Schnittmenge</button>
            <button className="btn" title="Überlappung ausschließen (XOR)" onClick={() => A.booleanSelection('exclude')}><BoolIcon op="exclude" /> Ausschließen</button>
          </div>
          <div className="btn-col">
            <button className="btn" onClick={A.expandStroke}>Kontur in Fläche umwandeln</button>
            <button className="btn" onClick={A.convertToPath}>In Pfad umwandeln</button>
            <button className="btn" onClick={A.applyTransforms}>Transformationen anwenden</button>
          </div>
          <Toggle label="Transformationen direkt in Geometrie schreiben" checked={settings.autoBake} onChange={(v) => setSettings({ autoBake: v })} />
          <Toggle label="Konturbreite mitskalieren" checked={settings.scaleStrokes} onChange={(v) => setSettings({ scaleStrokes: v })} />
        </Section>
      )}

      {els.length === 1 && <Attributes el={els[0]} id={selection[0]} />}

      {!has && <DocumentSection doc={doc} />}
      <ColorsSection doc={doc} />
    </div>
  );
}

const ANCHOR_NAMES = [['oben links', 'oben mittig', 'oben rechts'], ['mitte links', 'Mitte', 'mitte rechts'], ['unten links', 'unten mittig', 'unten rechts']];

function AnchorPicker({ value, onChange }: { value: [number, number]; onChange: (v: [number, number]) => void }) {
  const steps = [0, 0.5, 1];
  return (
    <div className="anchor-picker" title="Bezugspunkt für X/Y, Größe, Skalieren und Drehen">
      {steps.map((ay, r) => steps.map((ax, c) => (
        <button
          key={`${r}${c}`}
          className={value[0] === ax && value[1] === ay ? 'on' : ''}
          title={`Bezugspunkt: ${ANCHOR_NAMES[r][c]}`}
          onClick={() => onChange([ax, ay])}
        ><i /></button>
      )))}
    </div>
  );
}

function OpacityRow({ value }: { value: string | null }) {
  const v = value === null ? null : Math.round(parseFloat(value) * 100);
  return (
    <div className="row gap">
      <span className="lbl">Deckkraft</span>
      <input type="range" min={0} max={100} value={v ?? 100} className="slider"
        onChange={(e) => A.setProps({ opacity: e.target.value === '100' ? null : String(+e.target.value / 100) }, 'Deckkraft', 'opacity')} />
      <NumField value={v} suffix="%" onCommit={(n) => A.setProps({ opacity: n >= 100 ? null : String(Math.max(0, n) / 100) }, 'Deckkraft')} />
    </div>
  );
}

function ColorRow({ label, prop, value }: { label: string; prop: string; value: string | null }) {
  const none = value === 'none';
  return (
    <div className="row gap">
      <span className="lbl">{label}</span>
      <label className={`swatch ${none ? 'none' : ''}`} style={{ background: none || value === null ? undefined : value }}>
        <input type="color" value={toHex(value)} onChange={(e) => A.setProps({ [prop]: e.target.value }, label, 'color-' + prop)} />
      </label>
      <TextField value={value ?? ''} placeholder="gemischt" mono onCommit={(v) => A.setProps({ [prop]: v.trim() || null }, label)} />
      <IconBtn title="Keine" icon={<Ban size={14} />} active={none} onClick={() => A.setProps({ [prop]: 'none' }, label)} />
    </div>
  );
}

function Attributes({ el, id }: { el: Element; id: string }) {
  const [name, setName] = useState('');
  const attrs = Array.from(el.attributes);
  return (
    <Section title={`Attribute <${el.localName}>`}>
      <div className="attrs">
        {attrs.map((a) => (
          <div className="attr" key={a.name}>
            <span className="attr-name" title={a.name}>{a.name}</span>
            {a.name === 'd' || a.value.length > 40
              ? <AttrArea value={a.value} onCommit={(v) => A.setAttr(id, a.name, v)} />
              : <TextField value={a.value} mono onCommit={(v) => A.setAttr(id, a.name, v)} />}
            <IconBtn title="Entfernen" icon={<X size={13} />} onClick={() => A.setAttr(id, a.name, null)} />
          </div>
        ))}
        <div className="attr add">
          <input className="textfield mono" placeholder="neues-attribut" value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) { A.setAttr(id, name.trim(), ''); setName(''); } }} />
          <IconBtn title="Hinzufügen" icon={<Plus size={14} />} onClick={() => { if (name.trim()) { A.setAttr(id, name.trim(), ''); setName(''); } }} />
        </div>
      </div>
      {ownProp(el, 'transform') !== null && <div className="hint">Hat eine Transformation – „Transformationen anwenden“ schreibt sie in die Geometrie.</div>}
    </Section>
  );
}

function AttrArea({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  const [focus, setFocus] = useState(false);
  if (!focus && text !== value) setText(value);
  return (
    <textarea className="textfield mono area" value={text} spellCheck={false} rows={3}
      onFocus={() => setFocus(true)}
      onBlur={() => { setFocus(false); if (text !== value) onCommit(text); }}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.target as HTMLTextAreaElement).blur(); }} />
  );
}

function DocumentSection({ doc }: { doc: Document }) {
  const root = doc.documentElement;
  const size = docSize(root);
  const setVB = (p: Partial<typeof size>) => {
    const s = { ...size, ...p };
    A.setDocAttrs({ viewBox: `${s.x} ${s.y} ${s.w} ${s.h}` });
  };
  return (
    <Section title="Dokument">
      <div className="sub">viewBox</div>
      <div className="grid2">
        <NumField label="X" value={size.x} onCommit={(x) => setVB({ x })} />
        <NumField label="Y" value={size.y} onCommit={(y) => setVB({ y })} />
        <NumField label="B" value={size.w} onCommit={(w) => setVB({ w })} />
        <NumField label="H" value={size.h} onCommit={(h) => setVB({ h })} />
      </div>
      <div className="sub">Ausgabegröße (width / height)</div>
      <div className="grid2">
        <TextField value={root.getAttribute('width') ?? ''} placeholder="auto" mono onCommit={(v) => A.setDocAttrs({ width: v.trim() || null })} />
        <TextField value={root.getAttribute('height') ?? ''} placeholder="auto" mono onCommit={(v) => A.setDocAttrs({ height: v.trim() || null })} />
      </div>
      <div className="hint">Tipp: ⌘A wählt alles, Doppelklick betritt Gruppen bzw. bearbeitet Pfad-Knoten.</div>
    </Section>
  );
}

function ColorsSection({ doc }: { doc: Document }) {
  const colors = listColors(doc);
  return (
    <Section title="Farben im Dokument">
      {!colors.length && <div className="hint">Keine expliziten Farben gefunden.</div>}
      <div className="palette">
        {colors.map((c, i) => (
          <label key={i} className="swatch big" style={{ background: c.color }} title={`${c.color} · ${c.count}× – klicken zum Ersetzen`}>
            <input type="color" value={toHex(c.color)} onChange={(e) => A.recolor(c.color, e.target.value)} />
            <span className="count">{c.count}</span>
          </label>
        ))}
      </div>
    </Section>
  );
}

function NodeSection({ doc, id }: { doc: Document; id: string }) {
  const nodeSel = useStore((s) => s.nodeSel);
  const smoothNodes = useStore((s) => s.smoothNodes);
  const el = getEl(doc, id);
  const subs = useMemo(() => toNodes(el?.getAttribute('d') ?? ''), [el]);
  const node = nodeSel ? subs[nodeSel.s]?.nodes[nodeSel.j] : null;
  const kind = node ? A.effNodeKind(node, nodeSel!, smoothNodes) : null;
  const total = subs.reduce((n, sp) => n + sp.nodes.length, 0);
  const opts = (['corner', 'smooth', 'symmetric'] as const).map((k) => ({
    value: k, label: <span className="nk"><NodeKindIcon kind={k} /><span className="nk-t">{A.NODE_LABELS[k]}</span></span>, title: A.NODE_LABELS[k],
  }));
  return (
    <Section title="Knoten">
      <div className="hint">
        {node ? `Knoten ${nodeSel!.j + 1}${subs.length > 1 ? ` (Teilpfad ${nodeSel!.s + 1})` : ''} · x ${+node.x.toFixed(2)}, y ${+node.y.toFixed(2)}` : `${total} Knoten – einen Knoten anklicken`}
      </div>
      <div className="sub">Ausgewählter Knoten</div>
      <div className={node ? '' : 'inactive'}>
        <Segmented value={kind} options={opts} onChange={(k) => node && A.setSelectedNodeKind(k)} />
      </div>
      <button className="btn wide danger" disabled={!node} title="Knoten löschen (Entf)" onClick={A.deleteSelectedNode}><Trash2 size={14} /> Knoten löschen</button>
      <div className="sub sep">Ganzer Pfad</div>
      <select className="select" value="" title="Typ aller Knoten des Pfads auf einmal ändern"
        onChange={(e) => { const k = e.target.value as NodeKind; if (k) A.setAllNodesKind(k); e.target.value = ''; }}>
        <option value="" disabled>Alle {total} Knoten umwandeln in …</option>
        {(['corner', 'smooth', 'symmetric'] as const).map((k) => <option key={k} value={k}>{A.NODE_LABELS[k]}</option>)}
      </select>
      <div className="hint">Doppelklick auf Knoten = Ecke ↔ Glatt · Doppelklick auf die Kontur = Knoten einfügen · ⌥ beim Ziehen eines Anfassers löst ihn vom Gegenstück</div>
    </Section>
  );
}

function NodeKindIcon({ kind }: { kind: 'corner' | 'smooth' | 'symmetric' }) {
  return (
    <svg width="18" height="16" viewBox="0 0 18 16">
      {kind === 'corner'
        ? <><path d="M2 14L9 4L16 14" fill="none" stroke="currentColor" strokeWidth="1.5" /><rect x="7" y="2" width="4" height="4" fill="currentColor" /></>
        : <>
          <path d="M2 14C3 7 6 5 9 5S15 7 16 14" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <line x1={kind === 'symmetric' ? 4 : 5.5} y1="5" x2={kind === 'symmetric' ? 14 : 16} y2="5" stroke="currentColor" strokeWidth="1" opacity=".7" />
          <circle cx="9" cy="5" r="2.2" fill="currentColor" />
          <circle cx={kind === 'symmetric' ? 4 : 5.5} cy="5" r="1.4" fill="currentColor" /><circle cx={kind === 'symmetric' ? 14 : 16} cy="5" r="1.4" fill="currentColor" />
        </>}
    </svg>
  );
}

function ShapeSection() {
  const s = useStore((st) => st.settings);
  const setSettings = useStore((st) => st.setSettings);
  const paint = (label: string, key: 'shapeFill' | 'shapeStroke') => {
    const v = s[key];
    const none = v === 'none';
    return (
      <div className="row gap">
        <span className="lbl">{label}</span>
        <label className={`swatch ${none ? 'none' : ''}`} style={{ background: none ? undefined : v }}>
          <input type="color" value={toHex(v)} onChange={(e) => setSettings({ [key]: e.target.value })} />
        </label>
        <TextField value={v} mono onCommit={(t) => setSettings({ [key]: t.trim() || 'none' })} />
        <IconBtn title="Keine" icon={<Ban size={14} />} active={none} onClick={() => setSettings({ [key]: 'none' })} />
      </div>
    );
  };
  return (
    <Section title={`Neue Form: ${SHAPE_LABELS[s.shape]}`}>
      <div className="shape-grid">
        {SHAPE_ORDER.map((k) => (
          <IconBtn key={k} title={SHAPE_LABELS[k]} active={s.shape === k} icon={<ShapeIcon kind={k} />} onClick={() => setSettings({ shape: k })} />
        ))}
      </div>
      {s.shape === 'star' && (
        <div className="grid2">
          <NumField label="Zacken" value={s.starPoints} precision={0} onCommit={(v) => setSettings({ starPoints: Math.min(64, Math.max(3, Math.round(v))) })} />
          <NumField label="Innen" value={Math.round(s.starInner * 100)} suffix="%" precision={0} onCommit={(v) => setSettings({ starInner: Math.min(95, Math.max(5, v)) / 100 })} />
        </div>
      )}
      {s.shape === 'polygon' && (
        <NumField label="Ecken" value={s.polySides} precision={0} onCommit={(v) => setSettings({ polySides: Math.min(64, Math.max(3, Math.round(v))) })} />
      )}
      {paint('Füllung', 'shapeFill')}
      {paint('Kontur', 'shapeStroke')}
      <div className="row">
        <span className="lbl">Konturbreite</span>
        <NumField value={s.shapeStrokeWidth} step={0.5} onCommit={(v) => setSettings({ shapeStrokeWidth: Math.max(0, v) })} />
      </div>
      <div className="hint">Auf der Fläche ziehen zum Aufziehen (⇧ proportional, ⌥ von der Mitte) oder klicken für Standardgröße.</div>
    </Section>
  );
}

function CornerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16"><path d="M2 14V8a6 6 0 0 1 6-6h6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
  );
}

function BoolIcon({ op }: { op: 'union' | 'subtract' | 'intersect' | 'exclude' }) {
  const a = 'M2 2h9v9H2z', b = 'M7 7h9v9H7z';
  const on = 'var(--accent-2)', off = 'none';
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" className="bool-ico">
      {op === 'union' && <path d="M2 2h9v5h5v9H7v-5H2z" fill={on} />}
      {op === 'subtract' && <><path d="M2 2h9v5H7v4H2z" fill={on} /><path d={b} fill={off} stroke="currentColor" strokeDasharray="2 1.5" /></>}
      {op === 'intersect' && <><path d={a} fill={off} stroke="currentColor" strokeDasharray="2 1.5" /><path d={b} fill={off} stroke="currentColor" strokeDasharray="2 1.5" /><path d="M7 7h4v4H7z" fill={on} /></>}
      {op === 'exclude' && <path d="M2 2h9v5H7v4H2zM11 7h5v9H7v-5h4z" fill={on} />}
      {op !== 'subtract' && op !== 'intersect' && <><path d={a} fill="none" stroke="currentColor" strokeOpacity=".35" /><path d={b} fill="none" stroke="currentColor" strokeOpacity=".35" /></>}
    </svg>
  );
}

function CapIcon({ t }: { t: 'butt' | 'round' | 'square' }) {
  return (
    <svg width="22" height="14" viewBox="0 0 22 14">
      <line x1="4" y1="7" x2="22" y2="7" stroke="currentColor" strokeWidth="7" strokeLinecap={t} opacity={0.85} />
      <line x1="4" y1="7" x2="22" y2="7" stroke="var(--bg)" strokeWidth="1.2" />
      <line x1="4" y1="2" x2="4" y2="12" stroke="var(--accent)" strokeWidth="1" />
    </svg>
  );
}
function JoinIcon({ t }: { t: 'miter' | 'round' | 'bevel' }) {
  return (
    <svg width="18" height="16" viewBox="0 0 18 16">
      <polyline points="5,16 5,5 18,5" fill="none" stroke="currentColor" strokeWidth="5" strokeLinejoin={t} opacity={0.85} />
    </svg>
  );
}

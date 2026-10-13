import { useMemo, useState } from 'react';
import {
  AlignStartVertical, AlignCenterVertical, AlignEndVertical, AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
  AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter, FlipHorizontal2, FlipVertical2, RotateCcw, RotateCw,
  Lock, Unlock, Maximize2, Copy, Trash2, Group, Ungroup, BringToFront, SendToBack, ArrowUp, ArrowDown, Ban, Plus, X, Scissors, ArrowLeftRight,
} from 'lucide-react';
import { useStore } from '../store';
import { SHAPE_LABELS } from '../lib/shapes';
import { toNodes, type NodeKind } from '../lib/nodes';
import { ShapeIcon, SHAPE_ORDER } from './ShapePicker';
import * as A from '../actions';
import { docSize, effProp, getEl, listColors, ownProp, toHex, tryParse } from '../lib/svg';
import { IconBtn, NumField, Section, Segmented, TextField, Toggle } from './ui';

export function useDoc() {
  const svg = useStore((s) => s.svg);
  return useMemo(() => tryParse(svg).doc ?? null, [svg]);
}

function common(vals: string[]): string | null {
  return vals.length && vals.every((v) => v === vals[0]) ? vals[0] : null;
}

function useSelection() {
  const doc = useDoc();
  const selection = useStore((s) => s.selection);
  const els = useMemo(() => (doc ? selection.map((id) => getEl(doc, id)).filter((e): e is Element => !!e) : []), [doc, selection]);
  return { doc, selection, els };
}

const TAG_NAMES: Record<string, string> = { path: 'Pfad', rect: 'Rechteck', circle: 'Kreis', ellipse: 'Ellipse', line: 'Linie', polyline: 'Polylinie', polygon: 'Polygon', g: 'Gruppe', text: 'Text', image: 'Bild', use: 'Verweis' };

function SelHeader({ els }: { els: Element[] }) {
  const scope = useStore((s) => s.scope);
  if (!els.length) return null;
  const one = els.length === 1 ? els[0] : null;
  const counts = new Map<string, number>();
  els.forEach((e) => counts.set(e.localName, (counts.get(e.localName) ?? 0) + 1));
  return (
    <div className="sel-head">
      {one ? <span className="tag">{one.localName}</span> : <span className="tag">{els.length}</span>}
      <span className="sel-name">{one ? one.getAttribute('id') || TAG_NAMES[one.localName] || one.localName : 'Elemente'}</span>
      <span className="sel-sub">
        {one ? (scope ? `in Gruppe ${scope}` : '') : [...counts].map(([t, n]) => `${n} ${TAG_NAMES[t] ?? t}`).join(', ')}
      </span>
    </div>
  );
}

/** Inspector tab "Design": position, appearance, arrangement — or the document when nothing is selected */
export function DesignTab() {
  const { doc, selection, els } = useSelection();
  const union = useStore((s) => s.geo.union);
  const settings = useStore((s) => s.settings);
  const tool = useStore((s) => s.tool);
  const setSettings = useStore((s) => s.setSettings);
  const [scalePct, setScalePct] = useState(100);
  const [rot, setRot] = useState(15);
  const [more, setMore] = useState(false);
  if (!doc) return <div className="panel-empty">SVG kann nicht geparst werden – Code prüfen.</div>;

  const has = els.length > 0;
  const eff = (p: string, def: string) => common(els.map((e) => effProp(e, p, def)));

  return (
    <div className="props">
      <SelHeader els={els} />
      {tool === 'shape' && <ShapeSection />}
      {!has && tool !== 'shape' && <DocumentSection doc={doc} />}

      {has && union && (
        <Section title="Position und Größe">
          <div className="dims">
            <AnchorPicker value={settings.anchor} onChange={(anchor) => setSettings({ anchor })} />
            <div className="grid2">
              <NumField label="X" value={union.x + settings.anchor[0] * union.w} onCommit={(x) => A.setAnchored({ x })} />
              <NumField label="Y" value={union.y + settings.anchor[1] * union.h} onCommit={(y) => A.setAnchored({ y })} />
              <NumField label="B" value={union.w} onCommit={(w) => A.setAnchored(settings.keepRatio && union.w ? { w, h: (union.h * w) / union.w } : { w })} />
              <NumField label="H" value={union.h} onCommit={(h) => A.setAnchored(settings.keepRatio && union.h ? { h, w: (union.w * h) / union.h } : { h })} />
            </div>
          </div>
          <div className="row gap">
            <IconBtn title="Seitenverhältnis sperren" className="field-btn" icon={settings.keepRatio ? <Lock size={14} /> : <Unlock size={14} />} active={settings.keepRatio} onClick={() => setSettings({ keepRatio: !settings.keepRatio })} />
            <NumField label="Skal." value={scalePct} suffix="%" onCommit={(v) => { setScalePct(v); A.scaleSelection(v / 100); }} title="Enter skaliert um diesen Wert" />
            <button className="btn sm" title="Verkleinern 10 %" onClick={() => A.scaleSelection(1 / 1.1)}>−</button>
            <button className="btn sm" title="Vergrößern 10 %" onClick={() => A.scaleSelection(1.1)}>+</button>
          </div>
          <div className="row gap">
            <NumField label="∠" value={rot} suffix="°" onCommit={setRot} />
            <IconBtn title={`−${rot}° drehen`} className="field-btn" icon={<RotateCcw size={15} />} onClick={() => A.rotateSelection(-rot)} />
            <IconBtn title={`+${rot}° drehen`} className="field-btn" icon={<RotateCw size={15} />} onClick={() => A.rotateSelection(rot)} />
            {/* lucide's FlipHorizontal2 draws a horizontal mirror line (= vertical flip), so the icons are swapped on purpose */}
            <IconBtn title="Horizontal spiegeln (links ↔ rechts)" className="field-btn" icon={<FlipVertical2 size={15} />} onClick={() => A.flip('h')} />
            <IconBtn title="Vertikal spiegeln (oben ↔ unten)" className="field-btn" icon={<FlipHorizontal2 size={15} />} onClick={() => A.flip('v')} />
          </div>
        </Section>
      )}

      {has && <AlignSection count={els.length} />}

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
              options={[{ value: 'butt', label: <CapIcon t="butt" />, title: 'Flach' }, { value: 'round', label: <CapIcon t="round" />, title: 'Rund' }, { value: 'square', label: <CapIcon t="square" />, title: 'Quadratisch' }]} />
          </div>
          {more && (
            <>
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
            </>
          )}
          <button className="link-btn" onClick={() => setMore(!more)}>{more ? 'Weniger Optionen' : 'Ecken, Füllregel, Strichelung …'}</button>
        </Section>
      )}

      {has && (
        <Section title="Anordnen" defaultOpen={false}>
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

      {els.length === 1 && <Attributes el={els[0]} id={selection[0]} />}
    </div>
  );
}

function AlignSection({ count }: { count: number }) {
  const [target, setTarget] = useState<'sel' | 'doc'>('sel');
  const toDoc = target === 'doc' || count === 1;
  return (
    <Section title="Ausrichten">
      <div className="align-grid">
        <IconBtn title="Links" icon={<AlignStartVertical size={15} />} onClick={() => A.align('left', toDoc)} />
        <IconBtn title="Horizontal zentriert" icon={<AlignCenterVertical size={15} />} onClick={() => A.align('hcenter', toDoc)} />
        <IconBtn title="Rechts" icon={<AlignEndVertical size={15} />} onClick={() => A.align('right', toDoc)} />
        <IconBtn title="Oben" icon={<AlignStartHorizontal size={15} />} onClick={() => A.align('top', toDoc)} />
        <IconBtn title="Vertikal zentriert" icon={<AlignCenterHorizontal size={15} />} onClick={() => A.align('vcenter', toDoc)} />
        <IconBtn title="Unten" icon={<AlignEndHorizontal size={15} />} onClick={() => A.align('bottom', toDoc)} />
      </div>
      {count > 1 && (
        <Segmented value={target} onChange={setTarget}
          options={[{ value: 'sel', label: 'An Auswahl' }, { value: 'doc', label: 'An Dokument' }]} />
      )}
      {count === 1 && <div className="hint">Ein Element wird am Dokument ausgerichtet.</div>}
      {count > 2 && (
        <div className="grid2">
          <button className="btn" onClick={() => A.distribute('h')}><AlignHorizontalDistributeCenter size={15} /> Horizontal</button>
          <button className="btn" onClick={() => A.distribute('v')}><AlignVerticalDistributeCenter size={15} /> Vertikal</button>
        </div>
      )}
    </Section>
  );
}

/** Inspector tab "Pfad": offset, corners, booleans, conversions */
export function PathTab() {
  const { els } = useSelection();
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  if (!els.length) return <div className="panel-empty">Ein oder mehrere Elemente auswählen, um Pfad-Werkzeuge zu nutzen.</div>;
  const rectR = els.length === 1 && els[0].localName === 'rect' ? parseFloat(els[0].getAttribute('rx') || els[0].getAttribute('ry') || '0') : null;
  const radius = rectR ?? settings.cornerRadius;
  return (
    <div className="props cards">
      <div className="card">
        <div className="sub">Offset</div>
        <div className="row gap">
          <button className="btn sm" title="Abstand verringern" onClick={() => setSettings({ offsetDistance: Math.max(0, +(settings.offsetDistance - 0.5).toFixed(3)) })}>−</button>
          <NumField label="Abstand" value={settings.offsetDistance} step={0.5} onCommit={(v) => setSettings({ offsetDistance: Math.abs(v) })} />
          <button className="btn sm" title="Abstand erhöhen" onClick={() => setSettings({ offsetDistance: +(settings.offsetDistance + 0.5).toFixed(3) })}>+</button>
        </div>
        <Segmented value={settings.offsetKind} onChange={(v) => setSettings({ offsetKind: v })}
          options={[
            { value: 'area', label: 'Fläche', title: 'Sichtbare Form (Füllung + Kontur) wachsen/schrumpfen lassen' },
            { value: 'parallel', label: 'Parallele', title: 'Parallele Linie zum Pfad (Kurven bleiben erhalten)' },
          ]} />
        <Segmented value={settings.offsetJoin} onChange={(v) => setSettings({ offsetJoin: v })}
          options={[{ value: 'round', label: <><JoinIcon t="round" /> Rund</>, title: 'Rund' }, { value: 'miter', label: <><JoinIcon t="miter" /> Spitz</>, title: 'Spitz' }, { value: 'bevel', label: <><JoinIcon t="bevel" /> Flach</>, title: 'Abgeflacht' }]} />
        <Toggle label="Als Kopie erzeugen" checked={settings.offsetCopy} onChange={(v) => setSettings({ offsetCopy: v })} />
        <div className="grid2">
          <button className="btn" title="Nach innen verkleinern" onClick={() => A.offsetSelection(-settings.offsetDistance)}>Nach innen</button>
          <button className="btn primary" title="Nach außen vergrößern" onClick={() => A.offsetSelection(settings.offsetDistance)}>Nach außen</button>
        </div>
      </div>

      <div className="card">
        <div className="sub">Ecken abrunden</div>
        <div className="row gap">
          <input type="range" min={0} max={Math.max(50, radius)} step={0.5} value={radius} className="slider" aria-label="Radius"
            onChange={(e) => setSettings({ cornerRadius: +e.target.value })}
            onPointerUp={(e) => A.roundSelectedCorners(+(e.target as HTMLInputElement).value)} />
          <div className="w72"><NumField value={radius} step={1} onCommit={(v) => { setSettings({ cornerRadius: Math.max(0, v) }); A.roundSelectedCorners(Math.max(0, v)); }} /></div>
        </div>
        <button className="btn" onClick={() => A.roundSelectedCorners()}><CornerIcon /> Abrunden</button>
      </div>

      <div className="card">
        <div className="sub">Kombinieren</div>
        <div className="bool-row">
          {BOOL_OPS.map(([op, label, title]) => (
            <button key={op} className="btn" title={title} disabled={els.length < 2} onClick={() => A.booleanSelection(op)}><BoolIcon op={op} /> {label}</button>
          ))}
        </div>
        <div className="hint">{els.length < 2 ? 'Mindestens zwei Elemente auswählen.' : 'Das unterste Element bestimmt Farbe und Position.'}</div>
      </div>

      <div className="card plain">
        <div className="sub">Umwandeln</div>
        <button className="btn list" onClick={A.expandStroke}>Kontur in Fläche</button>
        <button className="btn list" title="Mittellinie der Form als neuen Pfad erzeugen" onClick={A.centerline}>Mittellinie erzeugen</button>
        <button className="btn list" onClick={A.convertToPath}>In Pfad umwandeln</button>
        <button className="btn list" onClick={A.applyTransforms}>Transformationen anwenden</button>
        <button className="btn list" disabled={els.length !== 1} onClick={A.editSelectedNodes}>Knoten bearbeiten<kbd>Enter</kbd></button>
        <Toggle label="Transformationen direkt in Geometrie schreiben" checked={settings.autoBake} onChange={(v) => setSettings({ autoBake: v })} />
        <Toggle label="Konturbreite mitskalieren" checked={settings.scaleStrokes} onChange={(v) => setSettings({ scaleStrokes: v })} />
      </div>
    </div>
  );
}

export const BOOL_OPS = [
  ['union', 'Verbinden', 'Verbinden (Vereinigung, OR)'],
  ['subtract', 'Ausschneiden', 'Ausschneiden: obere Elemente vom untersten abziehen'],
  ['intersect', 'Schnittmenge', 'Schnittmenge (AND)'],
  ['exclude', 'Ausschluss', 'Überlappung ausschließen (XOR)'],
] as const;

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
    <Section title="Attribute" defaultOpen={false}>
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

const SIZE_PRESETS = [16, 20, 24, 32, 48, 64, 128, 256];

/** Scale the document together with all paths, e.g. 412×412 → 32×32 */
function RescaleSection({ size }: { size: { w: number; h: number } }) {
  const keepRatio = useStore((s) => s.settings.keepRatio);
  const setSettings = useStore((s) => s.setSettings);
  const [target, setTarget] = useState({ w: size.w, h: size.h });
  // follow the document when it changes (undo, other artboard …)
  const [base, setBase] = useState(size);
  if (base.w !== size.w || base.h !== size.h) { setBase(size); setTarget({ w: size.w, h: size.h }); }
  const r = size.h / size.w;
  const setW = (w: number) => setTarget({ w, h: keepRatio ? +(w * r).toFixed(3) : target.h });
  const setH = (h: number) => setTarget({ h, w: keepRatio ? +(h / r).toFixed(3) : target.w });
  const same = target.w === size.w && target.h === size.h;
  return (
    <Section title="Skalieren">
      <div className="dims">
        <div className="grid2">
          <NumField label="B" value={target.w} onCommit={(w) => w > 0 && setW(w)} />
          <NumField label="H" value={target.h} onCommit={(h) => h > 0 && setH(h)} />
        </div>
        <IconBtn title="Seitenverhältnis sperren" className="field-btn" icon={keepRatio ? <Lock size={14} /> : <Unlock size={14} />} active={keepRatio} onClick={() => setSettings({ keepRatio: !keepRatio })} />
      </div>
      <div className="chips">
        {SIZE_PRESETS.map((n) => (
          <button key={n} className={`chip ${target.w === n ? 'on' : ''}`} title={`Breite ${n}`} onClick={() => setW(n)}>{n}</button>
        ))}
      </div>
      <button className="btn primary wide" disabled={same || !(target.w > 0 && target.h > 0)} onClick={() => A.rescaleDocument(target.w, target.h)}
        title="viewBox, width/height, alle Pfade, Formen und Konturbreiten auf die neue Größe umrechnen">
        <Maximize2 size={14} /> {same ? 'Skalieren' : `${+size.w.toFixed(3)} × ${+size.h.toFixed(3)} → ${target.w} × ${target.h}`}
      </button>
    </Section>
  );
}

function DocumentSection({ doc }: { doc: Document }) {
  const root = doc.documentElement;
  const size = docSize(root);
  const setVB = (p: Partial<typeof size>) => {
    const s = { ...size, ...p };
    A.setDocAttrs({ viewBox: `${s.x} ${s.y} ${s.w} ${s.h}` });
  };
  const w = root.getAttribute('width'), h = root.getAttribute('height');
  const square = size.w === size.h;
  return (
    <>
      <div className="sel-head"><span className="tag">svg</span><span className="sel-name">Dokument</span></div>
      <Section title="Zeichenfläche (viewBox)">
        <div className="grid2">
          <NumField label="X" value={size.x} onCommit={(x) => setVB({ x })} />
          <NumField label="Y" value={size.y} onCommit={(y) => setVB({ y })} />
          <NumField label="B" value={size.w} onCommit={(w) => setVB({ w })} />
          <NumField label="H" value={size.h} onCommit={(h) => setVB({ h })} />
        </div>
        <button className="btn" onClick={() => A.fitDocumentToContent()} title="viewBox genau um die Zeichnung legen">An Inhalt anpassen</button>
      </Section>
      <RescaleSection size={size} />
      <Section title="Ausgabegröße">
        <div className="grid2">
          <TextField value={w ?? ''} placeholder="auto" mono onCommit={(v) => A.setDocAttrs({ width: v.trim() || null })} />
          <TextField value={h ?? ''} placeholder="auto" mono onCommit={(v) => A.setDocAttrs({ height: v.trim() || null })} />
        </div>
        <div className="chips">
          {SIZE_PRESETS.map((n) => {
            const on = w === String(n) && (square ? h === String(n) : true);
            return (
              <button key={n} className={`chip ${on ? 'on' : ''}`} title={`width/height auf ${n} px (Seitenverhältnis der viewBox)`}
                onClick={() => A.setDocAttrs({ width: String(n), height: String(+(n * size.h / size.w).toFixed(3)) })}>{n}</button>
            );
          })}
          <button className={`chip ${!w && !h ? 'on' : ''}`} title="width/height entfernen – skaliert frei" onClick={() => A.setDocAttrs({ width: null, height: null })}>auto</button>
        </div>
      </Section>
      <div className="hint pad">Tipp: ⌘K öffnet die Befehlssuche, ⌘A wählt alles, Doppelklick betritt Gruppen bzw. bearbeitet Pfad-Knoten.</div>
    </>
  );
}

/** Colors used in the document – click one to replace it everywhere */
export function DocColors() {
  const doc = useDoc();
  if (!doc) return null;
  const colors = listColors(doc);
  return (
    <div className="doc-colors">
      <div className="sub">Farben im Dokument</div>
      {!colors.length && <div className="hint">Keine expliziten Farben.</div>}
      <div className="palette">
        {colors.map((c, i) => (
          <label key={i} className="swatch big" style={{ background: c.color }} title={`${c.color} · ${c.count}× – klicken zum Ersetzen`}>
            <input type="color" value={toHex(c.color)} onChange={(e) => A.recolor(c.color, e.target.value)} />
            <span className="count">{c.count}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

/** Inspector tab "Knoten" while a path is in node editing */
export function NodeTab() {
  const doc = useDoc();
  const id = useStore((s) => s.nodeEdit);
  const nodeSel = useStore((s) => s.nodeSel);
  const smoothNodes = useStore((s) => s.smoothNodes);
  const el = doc && id ? getEl(doc, id) : null;
  const subs = useMemo(() => toNodes(el?.getAttribute('d') ?? ''), [el]);
  if (!el) return <div className="panel-empty">Kein Pfad in Bearbeitung.</div>;
  const node = nodeSel ? subs[nodeSel.s]?.nodes[nodeSel.j] : null;
  const kind = node ? A.effNodeKind(node, nodeSel!, smoothNodes) : null;
  const total = subs.reduce((n, sp) => n + sp.nodes.length, 0);
  const index = nodeSel ? subs.slice(0, nodeSel.s).reduce((n, sp) => n + sp.nodes.length, 0) + nodeSel.j + 1 : 0;
  const sp = nodeSel ? subs[nodeSel.s] : subs.length === 1 ? subs[0] : null;
  const closed = sp ? sp.closed : subs.every((x) => x.closed);
  const opts = (['corner', 'smooth', 'symmetric'] as const).map((k) => ({
    value: k, label: <span className="nk"><NodeKindIcon kind={k} /><span className="nk-t">{A.NODE_LABELS[k]}</span></span>, title: A.NODE_LABELS[k],
  }));
  const len = (h: { x: number; y: number } | null) => (h && node ? +Math.hypot(h.x - node.x, h.y - node.y).toFixed(2) : null);
  return (
    <div className="props cards">
      <div className="sel-head">
        <span className="tag">path</span>
        <span className="sel-name">{el.getAttribute('id') || 'Pfad'}</span>
        <button className="btn sm primary" onClick={() => useStore.getState().set({ nodeEdit: null })}>Fertig</button>
      </div>
      <div className={`card ${node ? '' : 'muted-card'}`}>
        <div className="row">
          <span className="sub grow">Ausgewählter Knoten</span>
          <span className="hint">{node ? `${index} von ${total}` : `${total} Knoten`}</span>
        </div>
        {node ? (
          <>
            <div className="grid2">
              <NumField label="X" value={node.x} onCommit={(x) => A.setNodePos({ x })} />
              <NumField label="Y" value={node.y} onCommit={(y) => A.setNodePos({ y })} />
            </div>
            <Segmented value={kind} options={opts} onChange={(k) => A.setSelectedNodeKind(k)} />
            {(node.hin || node.hout) && <div className="hint">Anfasser: ein {len(node.hin) ?? '–'} · aus {len(node.hout) ?? '–'}</div>}
            <div className="grid2">
              <button className="btn" title="Geschlossenen Pfad hier öffnen bzw. offenen Pfad hier teilen" onClick={A.splitAtSelectedNode}><Scissors size={14} /> Auftrennen</button>
              <button className="btn danger" title="Knoten löschen (Entf)" onClick={A.deleteSelectedNode}><Trash2 size={14} /> Löschen</button>
            </div>
            <button className="btn" title="Neuen Knoten in der Mitte des nächsten Segments einfügen – die Form bleibt gleich" onClick={A.insertNodeAfterSelected}><Plus size={14} /> Knoten danach einfügen</button>
          </>
        ) : <div className="hint">Einen Knoten auf der Fläche anklicken.</div>}
      </div>

      <div className="card dashed">
        <div className="sub">{nodeSel && subs.length > 1 ? `Teilpfad ${nodeSel.s + 1} von ${subs.length}` : `Ganzer Pfad · ${total} Knoten`}</div>
        <div className="grid2">
          <button className="btn" onClick={() => A.setPathClosed(!closed)}>{closed ? 'Pfad öffnen' : 'Pfad schließen'}</button>
          <button className="btn" onClick={A.reversePath}><ArrowLeftRight size={14} /> Umkehren</button>
        </div>
        <button className="btn" title="In jedes Segment einen Knoten einfügen – die Form bleibt gleich" onClick={A.subdividePath}><Plus size={14} /> Knoten verdoppeln</button>
        <div className="hint">Doppelklick auf die Kontur fügt dort einen Knoten ein. Schere (C) schneidet Pfade.</div>
        <select className="select" value="" title="Typ aller Knoten des Pfads auf einmal ändern"
          onChange={(e) => { const k = e.target.value as NodeKind; if (k) A.setAllNodesKind(k); e.target.value = ''; }}>
          <option value="" disabled>Alle {total} Knoten umwandeln in …</option>
          {(['corner', 'smooth', 'symmetric'] as const).map((k) => <option key={k} value={k}>{A.NODE_LABELS[k]}</option>)}
        </select>
      </div>
      <div className="hint pad">Doppelklick auf Knoten = Ecke ↔ Glatt · Doppelklick auf die Kontur = Knoten einfügen · ⌥ beim Ziehen löst den Anfasser · Pfeiltasten verschieben</div>
    </div>
  );
}

export function NodeKindIcon({ kind }: { kind: 'corner' | 'smooth' | 'symmetric' }) {
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

export function CornerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16"><path d="M2 14V8a6 6 0 0 1 6-6h6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
  );
}

export function BoolIcon({ op }: { op: 'union' | 'subtract' | 'intersect' | 'exclude' }) {
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

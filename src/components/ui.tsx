import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { fmt } from '../lib/matrix';

export function Section({ title, children, defaultOpen = true, right }: { title: string; children: ReactNode; defaultOpen?: boolean; right?: ReactNode }) {
  const key = 'sec-' + title;
  const [open, setOpen] = useState(() => {
    try { const v = localStorage.getItem(key); return v === null ? defaultOpen : v === '1'; } catch { return defaultOpen; }
  });
  const toggle = () => { setOpen(!open); try { localStorage.setItem(key, open ? '0' : '1'); } catch { /* ignore */ } };
  return (
    <section className={`section ${open ? 'open' : ''}`}>
      <header onClick={toggle}>
        <span>{title}</span>
        <span className="sec-right" onClick={(e) => e.stopPropagation()}>{right}</span>
        <ChevronDown size={15} className="chev" />
      </header>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}

export function NumField({ value, onCommit, label, step = 1, suffix, disabled, title, precision = 3 }: {
  value: number | null; onCommit: (v: number) => void; label?: string; step?: number; suffix?: string; disabled?: boolean; title?: string; precision?: number;
}) {
  const shown = value === null || !isFinite(value) ? '' : fmt(value, precision);
  const [text, setText] = useState(shown);
  const [focus, setFocus] = useState(false);
  const cancel = useRef(false);
  useEffect(() => { if (!focus) setText(shown); }, [shown, focus]);
  const commit = (t = text) => {
    let v: number;
    try {
      // allow simple arithmetic like "24*2" or "10+5"
      if (!/^[\d\s+\-*/().,e]+$/i.test(t)) throw 0;
      v = Function(`"use strict";return (${t.replace(/,/g, '.')})`)();
    } catch { v = NaN; }
    if (isFinite(v) && fmt(v, precision) !== shown) onCommit(v);
    else setText(shown);
  };
  return (
    <label className={`numfield ${disabled ? 'disabled' : ''}`} title={title}>
      {label && <span className="nf-label">{label}</span>}
      <input
        value={text}
        disabled={disabled}
        placeholder={value === null ? '—' : ''}
        onFocus={(e) => { setFocus(true); e.target.select(); }}
        onBlur={() => { setFocus(false); if (cancel.current) { cancel.current = false; setText(shown); } else commit(); }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // blur commits — committing here as well would apply the change twice
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') { cancel.current = true; (e.target as HTMLInputElement).blur(); }
          if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && value !== null) {
            e.preventDefault();
            const d = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
            onCommit(+(value + d).toFixed(6));
          }
        }}
      />
      {suffix && <span className="nf-suffix">{suffix}</span>}
    </label>
  );
}

export function TextField({ value, onCommit, placeholder, mono, className }: { value: string; onCommit: (v: string) => void; placeholder?: string; mono?: boolean; className?: string }) {
  const [text, setText] = useState(value);
  const [focus, setFocus] = useState(false);
  useEffect(() => { if (!focus) setText(value); }, [value, focus]);
  return (
    <input
      className={`textfield ${mono ? 'mono' : ''} ${className || ''}`}
      value={text}
      placeholder={placeholder}
      spellCheck={false}
      onFocus={() => setFocus(true)}
      onBlur={() => { setFocus(false); if (text !== value) onCommit(text); }}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') { setText(value); setTimeout(() => (e.target as HTMLInputElement).blur()); }
      }}
    />
  );
}

export function IconBtn({ icon, title, onClick, active, disabled, children, className }: {
  icon?: ReactNode; title: string; onClick?: () => void; active?: boolean; disabled?: boolean; children?: ReactNode; className?: string;
}) {
  return (
    <button className={`iconbtn ${active ? 'active' : ''} ${className || ''}`} title={title} onClick={onClick} disabled={disabled}>
      {icon}{children}
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T | null; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={o.value} title={o.title} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="toggle">
      <span>{label}</span>
      <button className={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)} role="switch" aria-checked={checked}><i /></button>
    </label>
  );
}

/** Open state for a dropdown that closes on outside click or Escape */
export function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', esc); };
  }, [open]);
  return { open, setOpen, ref };
}

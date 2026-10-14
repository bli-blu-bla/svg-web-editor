import { I, mul, parseTransform, type Mat } from './matrix';

export const SVGNS = 'http://www.w3.org/2000/svg';
export const GRAPHIC = new Set(['g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'use', 'image', 'svg', 'a', 'switch', 'foreignObject']);
export const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
const NON_RENDERED = new Set(['defs', 'clipPath', 'mask', 'symbol', 'pattern', 'marker', 'linearGradient', 'radialGradient', 'filter']);

/** Add a missing xmlns so DOMParser creates real SVG elements */
export function normalizeInput(str: string): string {
  let s = str.trim().replace(/^﻿/, '');
  const m = /<svg\b[^>]*>/i.exec(s);
  if (m && !/\sxmlns\s*=/.test(m[0])) {
    s = s.slice(0, m.index) + m[0].replace(/<svg\b/i, `<svg xmlns="${SVGNS}"`) + s.slice(m.index + m[0].length);
  }
  if (m && /xlink:/.test(s) && !/xmlns:xlink\s*=/.test(s)) {
    s = s.replace(/<svg\b/i, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
  }
  return s;
}

export function parseSvg(str: string): Document {
  const doc = new DOMParser().parseFromString(normalizeInput(str), 'image/svg+xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error((err.textContent || 'Parse-Fehler').split('\n').filter(Boolean).slice(0, 2).join(' '));
  if (doc.documentElement.localName !== 'svg') throw new Error('Wurzelelement ist kein <svg>');
  return doc;
}

export function tryParse(str: string): { doc?: Document; error?: string } {
  try { return { doc: parseSvg(str) }; } catch (e) { return { error: (e as Error).message }; }
}

export function serialize(doc: Document): string {
  return new XMLSerializer().serializeToString(doc.documentElement);
}

/** Remove scripts and event handlers */
export function sanitize(doc: Document) {
  doc.querySelectorAll('script').forEach((s) => s.remove());
  doc.querySelectorAll('*').forEach((el) => {
    for (const a of Array.from(el.attributes)) {
      if (/^on/i.test(a.name)) el.removeAttribute(a.name);
      if (/href$/i.test(a.name) && /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
    }
  });
}

export function cleanSvgString(str: string): string {
  const doc = parseSvg(str);
  sanitize(doc);
  return serialize(doc);
}

export const kids = (el: Element) => Array.from(el.children);

export function idOf(el: Element): string {
  const parts: number[] = [];
  let cur: Element = el;
  while (cur.parentElement && cur !== cur.ownerDocument.documentElement) {
    parts.unshift(kids(cur.parentElement).indexOf(cur));
    cur = cur.parentElement;
  }
  return parts.join('.');
}

export function getEl(doc: Document, id: string): Element | null {
  let el: Element | null = doc.documentElement;
  if (id === '') return el;
  for (const part of id.split('.')) {
    el = el ? el.children[+part] ?? null : null;
  }
  return el;
}

export const parentId = (id: string) => id.split('.').slice(0, -1).join('.');
export const isUnder = (id: string, scope: string) => scope === '' ? id !== '' : id.startsWith(scope + '.');

export function isRendered(el: Element): boolean {
  let p: Element | null = el;
  while (p) {
    if (NON_RENDERED.has(p.localName)) return false;
    p = p.parentElement;
  }
  return true;
}

export const isSelectable = (el: Element) => GRAPHIC.has(el.localName) && isRendered(el) && el !== el.ownerDocument.documentElement;

export function isRoot(el: Element) {
  return el.localName === 'svg' && (!el.parentElement || el.parentElement.namespaceURI !== SVGNS);
}

export const localMatrix = (el: Element): Mat => parseTransform(el.getAttribute('transform'));

/** Accumulated transforms of all ancestors (root svg excluded) */
export function parentMatrix(el: Element): Mat {
  let m = I;
  let p = el.parentElement;
  while (p && !isRoot(p)) {
    m = mul(localMatrix(p), m);
    p = p.parentElement;
  }
  return m;
}

/** Remove elements whose ancestor is also in the list; return in document order */
export function topmost(els: Element[]): Element[] {
  const set = new Set(els);
  const res = els.filter((el) => {
    let p = el.parentElement;
    while (p) { if (set.has(p)) return false; p = p.parentElement; }
    return true;
  });
  return res.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
}

export function elsOf(doc: Document, ids: string[]): Element[] {
  return ids.map((id) => getEl(doc, id)).filter((e): e is Element => !!e && e !== doc.documentElement);
}

export interface DocSize { x: number; y: number; w: number; h: number }

export function docSize(root: Element): DocSize {
  const vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  if (vb.length === 4 && vb.every(isFinite) && vb[2] > 0 && vb[3] > 0) return { x: vb[0], y: vb[1], w: vb[2], h: vb[3] };
  const w = parseFloat(root.getAttribute('width') || '');
  const h = parseFloat(root.getAttribute('height') || '');
  return { x: 0, y: 0, w: w > 0 ? w : 300, h: h > 0 ? h : 150 };
}

/** Size an SVG is shown at on its own: width/height in px (as icon sites set them), otherwise the viewBox */
export function naturalSize(root: Element): { w: number; h: number } {
  const vb = docSize(root);
  const px = (a: string) => { const m = /^\s*([\d.]+)\s*(px)?\s*$/.exec(root.getAttribute(a) || ''); return m ? parseFloat(m[1]) : NaN; };
  let w = px('width'), h = px('height');
  if (!(w > 0) && h > 0) w = (h * vb.w) / vb.h;
  if (!(h > 0) && w > 0) h = (w * vb.h) / vb.w;
  return w > 0 && h > 0 ? { w, h } : { w: vb.w, h: vb.h };
}

// ---------- presentation properties ----------
const styleOf = (el: Element) => (el as SVGElement).style as CSSStyleDeclaration | undefined;

export function ownProp(el: Element, name: string): string | null {
  const s = styleOf(el)?.getPropertyValue(name);
  if (s) return s.trim();
  return el.getAttribute(name);
}

const INHERITED = new Set(['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'fill-rule', 'fill-opacity', 'stroke-opacity', 'color', 'font-family', 'font-size', 'font-weight']);

export function effProp(el: Element, name: string, def: string): string {
  let p: Element | null = el;
  while (p) {
    const v = ownProp(p, name);
    if (v && v !== 'inherit') return v;
    if (!INHERITED.has(name)) break;
    p = p.parentElement;
  }
  return def;
}

export function setProp(el: Element, name: string, value: string | null) {
  const st = styleOf(el);
  if (st && st.getPropertyValue(name)) {
    st.removeProperty(name);
    if (!el.getAttribute('style')?.trim()) el.removeAttribute('style');
  }
  if (value === null || value === '') el.removeAttribute(name);
  else el.setAttribute(name, value);
}

// ---------- colors ----------
let ctx: CanvasRenderingContext2D | null = null;
export function normalizeColor(c: string | null | undefined): string | null {
  if (!c) return null;
  const v = c.trim().toLowerCase();
  if (!v || v === 'none' || v === 'transparent' || v.startsWith('url(') || v === 'currentcolor' || v === 'inherit') return null;
  if (!ctx) ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return v;
  ctx.fillStyle = '#000001';
  ctx.fillStyle = v;
  const out = ctx.fillStyle as string;
  if (out === '#000001' && v !== '#000001') return null;
  return out;
}

export function toHex(c: string | null | undefined): string {
  const n = normalizeColor(c);
  if (n && n.startsWith('#')) return n;
  if (n) {
    const m = /rgba?\(([^)]+)\)/.exec(n);
    if (m) {
      const [r, g, b] = m[1].split(',').map((x) => parseInt(x));
      return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
    }
  }
  return '#000000';
}

export const COLOR_PROPS = ['fill', 'stroke', 'stop-color', 'color', 'flood-color', 'lighting-color'];

export function listColors(doc: Document): { color: string; count: number }[] {
  const map = new Map<string, number>();
  doc.querySelectorAll('*').forEach((el) => {
    for (const p of COLOR_PROPS) {
      const n = normalizeColor(ownProp(el, p));
      if (n) map.set(n, (map.get(n) || 0) + 1);
    }
  });
  return [...map.entries()].map(([color, count]) => ({ color, count })).sort((a, b) => b.count - a.count);
}

export function prettyPrint(svg: string): string {
  const doc = parseSvg(svg);
  const out: string[] = [];
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const attrs = (el: Element) =>
    Array.from(el.attributes).map((a) => ` ${a.name}="${a.value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`).join('');
  const walk = (el: Element, depth: number) => {
    const ind = '  '.repeat(depth);
    const children = Array.from(el.childNodes).filter((n) => !(n.nodeType === 3 && !n.textContent!.trim()));
    if (!children.length) { out.push(`${ind}<${el.tagName}${attrs(el)}/>`); return; }
    if (children.every((n) => n.nodeType === 3 || n.nodeType === 4)) {
      out.push(`${ind}<${el.tagName}${attrs(el)}>${esc(el.textContent || '')}</${el.tagName}>`);
      return;
    }
    out.push(`${ind}<${el.tagName}${attrs(el)}>`);
    for (const c of children) {
      if (c.nodeType === 1) walk(c as Element, depth + 1);
      else if (c.nodeType === 3) out.push(`${ind}  ${esc(c.textContent!.trim())}`);
      else if (c.nodeType === 8) out.push(`${ind}  <!--${c.textContent}-->`);
      else if (c.nodeType === 4) out.push(`${ind}  <![CDATA[${c.textContent}]]>`);
    }
    out.push(`${ind}</${el.tagName}>`);
  };
  walk(doc.documentElement, 0);
  return out.join('\n');
}

const renderCache = new Map<string, { html: string; size: DocSize }>();
/** Markup for the canvas: every element gets a data-eid, root fills its container */
export function renderMarkup(svg: string): { html: string; size: DocSize; error?: string } {
  const hit = renderCache.get(svg);
  if (hit) return hit;
  const { doc, error } = tryParse(svg);
  if (!doc) return { html: '', size: { x: 0, y: 0, w: 100, h: 100 }, error };
  sanitize(doc);
  const root = doc.documentElement;
  const size = docSize(root);
  const tag = (el: Element, id: string) => {
    el.setAttribute('data-eid', id);
    kids(el).forEach((c, i) => tag(c, id === '' ? String(i) : `${id}.${i}`));
  };
  tag(root, '');
  root.setAttribute('viewBox', `${size.x} ${size.y} ${size.w} ${size.h}`);
  root.setAttribute('width', '100%');
  root.setAttribute('height', '100%');
  root.setAttribute('preserveAspectRatio', 'none');
  root.setAttribute('overflow', 'visible');
  const res = { html: serialize(doc), size };
  if (renderCache.size > 50) renderCache.clear();
  renderCache.set(svg, res);
  return res;
}

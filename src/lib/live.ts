// Access to the rendered (live) SVG in the canvas for geometry queries
import { fromDOM, inv, mul, transformBox, type Box, type Mat } from './matrix';

let liveRoot: SVGSVGElement | null = null;
export const setLiveRoot = (r: SVGSVGElement | null) => { liveRoot = r; };
export const getLiveRoot = () => liveRoot;

export function liveEl(id: string): SVGGraphicsElement | null {
  if (!liveRoot) return null;
  if (id === '') return liveRoot;
  return liveRoot.querySelector(`[data-eid="${id}"]`);
}

/** Matrix from element-local coordinates to root user (viewBox) coordinates */
export function elToRoot(el: SVGGraphicsElement): Mat | null {
  if (!liveRoot) return null;
  const r = liveRoot.getScreenCTM(), e = el.getScreenCTM();
  if (!r || !e) return null;
  return mul(inv(fromDOM(r)), fromDOM(e));
}

export function rootBBox(id: string): Box | null {
  const el = liveEl(id);
  if (!el || typeof el.getBBox !== 'function') return null;
  try {
    const b = el.getBBox();
    const m = elToRoot(el);
    if (!m) return null;
    return transformBox(m, { x: b.x, y: b.y, w: b.width, h: b.height });
  } catch {
    return null;
  }
}

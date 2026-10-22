// Pure geometry for the onboarding tour: spotlight holes and tooltip placement.
// No DOM access — rects come in, rects go out.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Size {
  w: number;
  h: number;
}

export function unionRect(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Grow `r` by `pad`, then clip it to the viewport (minus `margin`). Null when nothing is left on screen. */
export function spotlightRect(r: Rect, pad: number, view: Size, margin: number): Rect | null {
  const x0 = Math.max(margin, r.x - pad);
  const y0 = Math.max(margin, r.y - pad);
  const x1 = Math.min(view.w - margin, r.x + r.w + pad);
  const y1 = Math.min(view.h - margin, r.y + r.h + pad);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export type Side = 'bottom' | 'top' | 'right' | 'left' | 'center';

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(v, hi));

/**
 * Tooltip position beside `target`: the first side (below, above, right, left)
 * with room for the whole tooltip, else over the target at the bottom of the screen. Always
 * clamped inside the viewport (`margin` from every edge); no target = centred.
 */
export function placeTooltip(
  target: Rect | null,
  tip: Size,
  view: Size,
  gap: number,
  margin: number,
): { x: number; y: number; side: Side } {
  const maxX = Math.max(margin, view.w - margin - tip.w);
  const maxY = Math.max(margin, view.h - margin - tip.h);
  if (!target) {
    return {
      x: clamp((view.w - tip.w) / 2, margin, maxX),
      y: clamp((view.h - tip.h) / 2, margin, maxY),
      side: 'center',
    };
  }
  const cx = clamp(target.x + target.w / 2 - tip.w / 2, margin, maxX);
  const cy = clamp(target.y + target.h / 2 - tip.h / 2, margin, maxY);
  const below = target.y + target.h + gap;
  const above = target.y - gap - tip.h;
  const right = target.x + target.w + gap;
  const left = target.x - gap - tip.w;
  if (below + tip.h <= view.h - margin) return { x: cx, y: below, side: 'bottom' };
  if (above >= margin) return { x: cx, y: above, side: 'top' };
  if (right + tip.w <= view.w - margin) return { x: right, y: cy, side: 'right' };
  if (left >= margin) return { x: left, y: cy, side: 'left' };
  // Covers (nearly) the whole screen, like the map: sit at the bottom, out of the way.
  return { x: cx, y: maxY, side: 'center' };
}

/** Holes that touch or overlap become one (even-odd fill would re-dim the overlap). */
export function mergeOverlapping(rects: Rect[]): Rect[] {
  const out = [...rects];
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      const a = out[i];
      const b = out[j];
      if (a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h) {
        out[i] = unionRect([a, b])!;
        out.splice(j, 1);
        j = i; // re-check the grown rect against everything after it
      }
    }
  }
  return out;
}

/** One animation step of `cur` towards `target` (fraction `k` per frame); snaps when within 0.5 px. */
export function approachRect(cur: Rect, target: Rect, k: number): Rect {
  const step = (a: number, b: number) => (Math.abs(b - a) < 0.5 ? b : a + (b - a) * k);
  return {
    x: step(cur.x, target.x),
    y: step(cur.y, target.y),
    w: step(cur.w, target.w),
    h: step(cur.h, target.h),
  };
}

/** World-px bounding box of the tiles labelled `label` (null when the layout has none). */
export function areaWorldRect(
  areaTiles: ReadonlyArray<string | null> | undefined,
  cols: number,
  label: string,
  tileSize: number,
): Rect | null {
  if (!areaTiles) return null;
  let c0 = Infinity;
  let r0 = Infinity;
  let c1 = -Infinity;
  let r1 = -Infinity;
  areaTiles.forEach((l, i) => {
    if (l !== label) return;
    const c = i % cols;
    const r = Math.floor(i / cols);
    c0 = Math.min(c0, c);
    r0 = Math.min(r0, r);
    c1 = Math.max(c1, c);
    r1 = Math.max(r1, r);
  });
  if (c0 === Infinity) return null;
  return {
    x: c0 * tileSize,
    y: r0 * tileSize,
    w: (c1 - c0 + 1) * tileSize,
    h: (r1 - r0 + 1) * tileSize,
  };
}

/** Zoom that shows the whole `map` (world px) in `view` (device px), scaled by `fill` and clamped. */
export function fitZoom(map: Size, view: Size, fill: number, min: number, max: number): number {
  return clamp(Math.min(view.w / map.w, view.h / map.h) * fill, min, max);
}

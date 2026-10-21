import { describe, expect, it } from 'vitest';

import { ZOOM_MAX, ZOOM_MIN } from '../src/constants';
import { mapOffset, renderScale } from '../src/office/projection';
import { clampPanToMap, wheelZoom, zoomAtPoint } from '../src/office/zoomAtPoint';

const view = { w: 1200, h: 800 };
const cols = 20;
const rows = 11;
const pan = { x: 37, y: -52 };

function worldAt(cursor: { x: number; y: number }, zoom: number, p: { x: number; y: number }) {
  const { offsetX, offsetY } = mapOffset(view.w, view.h, cols, rows, zoom, p.x, p.y);
  return { x: (cursor.x - offsetX) / zoom, y: (cursor.y - offsetY) / zoom };
}

describe('zoomAtPoint', () => {
  const cursors = {
    center: { x: 600, y: 400 },
    topLeft: { x: 0, y: 0 },
    bottomRight: { x: 1199, y: 799 },
  };
  for (const [name, cursor] of Object.entries(cursors)) {
    for (const [from, to] of [
      [2, 3],
      [3, 2],
      [2.0, 2.3],
      [1.7, 1.2],
      [0.6, 0.9],
      [7.4, 9.9],
    ]) {
      it(`keeps world point under ${name} cursor, zoom ${from}->${to}`, () => {
        const before = worldAt(cursor, from, pan);
        const after = worldAt(cursor, to, zoomAtPoint(pan, from, to, cursor, view));
        // 1 screen px at the new zoom, in world units
        expect(Math.abs(after.x - before.x) * to).toBeLessThan(1.5);
        expect(Math.abs(after.y - before.y) * to).toBeLessThan(1.5);
      });
    }
  }
});

describe('clampPanToMap', () => {
  it('pan after a corner zoom-in stays within bounds', () => {
    const mapW = cols * 16;
    const mapH = rows * 16;
    const edge = clampPanToMap({ x: -1e6, y: 1e6 }, 2, mapW, mapH, view, 0.25);
    const cursor = { x: 1199, y: 799 };
    const zoomed = zoomAtPoint(edge, 2, 3, cursor, view);
    const out = clampPanToMap(zoomed, 3, mapW, mapH, view, 0.25);
    const maxX = (mapW * 3) / 2 + view.w / 2 - view.w * 0.25;
    expect(Math.abs(out.x)).toBeLessThanOrEqual(maxX);
    expect(Math.abs(zoomed.x)).toBeGreaterThan(maxX); // unclamped overshoots
  });
});

describe('clampPanToMap with fractional zoom', () => {
  it('bounds scale with the float zoom', () => {
    const mapW = cols * 16;
    const z = 2.37;
    const out = clampPanToMap({ x: 1e6, y: 0 }, z, mapW, rows * 16, view, 0.25);
    expect(out.x).toBeCloseTo((mapW * z) / 2 + view.w / 2 - view.w * 0.25, 6);
  });
});

describe('renderScale', () => {
  it('integer zooms draw unscaled', () => {
    for (const z of [1, 2, 3, 10]) expect(renderScale(z)).toEqual({ renderZoom: z, scale: 1 });
  });
  it('fractional zooms ≥ 1 draw at floor and upscale by < 2', () => {
    for (const z of [1.2, 2.3, 2.999, 9.5]) {
      const { renderZoom, scale } = renderScale(z);
      expect(renderZoom).toBe(Math.floor(z));
      expect(scale).toBeGreaterThan(1);
      expect(scale).toBeLessThan(2);
      expect(renderZoom * scale).toBeCloseTo(z, 9);
    }
  });
  it('zooms below 1 draw at 1 and shrink', () => {
    expect(renderScale(0.5)).toEqual({ renderZoom: 1, scale: 0.5 });
  });
  it('screen offset = render offset × scale (overlays match the scaled frame)', () => {
    const v = mapOffset(view.w, view.h, cols, rows, 2.3, pan.x, pan.y);
    expect(Number.isInteger(v.renderOffsetX)).toBe(true);
    expect(v.offsetX).toBeCloseTo(v.renderOffsetX * v.scale, 9);
    expect(v.offsetY).toBeCloseTo(v.renderOffsetY * v.scale, 9);
    // integer zoom: identical to the old integer math
    const i = mapOffset(view.w, view.h, cols, rows, 2, pan.x, pan.y);
    expect(i.offsetX).toBe(Math.floor((view.w - cols * 16 * 2) / 2) + Math.round(pan.x));
  });
});

describe('wheelZoom', () => {
  it('one mouse notch is a small multiplicative step, symmetric in and out', () => {
    const zin = wheelZoom(2, -100);
    expect(zin).toBeGreaterThan(2.2);
    expect(zin).toBeLessThan(2.4);
    expect(wheelZoom(zin, 100)).toBeCloseTo(2, 9);
  });
  it('trackpad deltas give fine steps; line mode is converted', () => {
    expect(wheelZoom(2, -4)).toBeCloseTo(2 * Math.exp(0.006), 9);
    expect(wheelZoom(2, -3, 1)).toBeCloseTo(wheelZoom(2, -120), 9);
  });
  it('clamps to the zoom range', () => {
    expect(wheelZoom(ZOOM_MAX, -1000)).toBe(ZOOM_MAX);
    expect(wheelZoom(ZOOM_MIN, 1000)).toBe(ZOOM_MIN);
  });
});

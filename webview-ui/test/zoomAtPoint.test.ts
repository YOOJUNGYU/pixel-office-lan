import { describe, expect, it } from 'vitest';

import { mapOffset } from '../src/office/projection';
import { clampPanToMap, zoomAtPoint } from '../src/office/zoomAtPoint';

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

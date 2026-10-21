import { describe, expect, it } from 'vitest';

import { mapOffset } from '../src/office/projection';
import { zoomAtPoint } from '../src/office/zoomAtPoint';

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

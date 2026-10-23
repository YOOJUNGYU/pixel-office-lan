/**
 * Floor tool fill: a click paints a whole room (or the connected corridor) in one undo entry.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import { floorFillRegion, paintTiles } from '../src/office/editor/editorActions.js';
import { EditorState } from '../src/office/editor/editorState.js';
import type { OfficeLayout } from '../src/office/types.js';
import { TileType } from '../src/office/types.js';

const F = TileType.FLOOR_1;
const W = TileType.WALL;
const V = TileType.VOID;
// A=코딩실 (2 floor tiles + wall inside), B=자료실; '.' corridor; two separate corridor pockets
const MAP = ['WWWWWWWW', 'WAA.WBBW', 'WAWAW.BW', 'WWWWW.WW', 'V..W..VV'];
const cols = 8;
function layout(): OfficeLayout {
  const cells = MAP.join('');
  return {
    version: 1,
    cols,
    rows: MAP.length,
    tiles: [...cells].map((c) => (c === 'W' ? W : c === 'V' ? V : F)),
    tileColors: [...cells].map(() => null),
    furniture: [],
    areaTiles: [...cells].map((c) => (c === 'A' ? '코딩실' : c === 'B' ? '자료실' : null)),
  } as unknown as OfficeLayout;
}
const at = (c: number, r: number) => r * cols + c;

test('room click fills exactly that room floor tiles', () => {
  assert.deepEqual(floorFillRegion(layout(), 1, 1), [at(1, 1), at(2, 1), at(1, 2), at(3, 2)]);
  assert.deepEqual(floorFillRegion(layout(), 6, 2), [at(5, 1), at(6, 1), at(6, 2)]);
});

test('corridor click fills the connected unlabelled floor only', () => {
  assert.deepEqual(floorFillRegion(layout(), 3, 1), [at(3, 1)]);
  assert.deepEqual(floorFillRegion(layout(), 4, 4), [at(5, 2), at(5, 3), at(4, 4), at(5, 4)]);
  assert.deepEqual(floorFillRegion(layout(), 1, 4), [at(1, 4), at(2, 4)]);
});

test('wall, VOID and out-of-grid clicks fill nothing', () => {
  assert.deepEqual(floorFillRegion(layout(), 0, 0), []);
  assert.deepEqual(floorFillRegion(layout(), 0, 4), []);
  assert.deepEqual(floorFillRegion(layout(), -1, 2), []);
});

test('paintTiles never touches walls and one undo restores the layout', () => {
  const before = layout();
  const color = { h: 10, s: 20, b: 30, c: 40 };
  const region = floorFillRegion(before, 1, 1);
  const after = paintTiles(before, region, TileType.FLOOR_2, color);
  assert.notEqual(after, before);
  for (let i = 0; i < before.tiles.length; i++) {
    assert.equal(after.tiles[i], region.includes(i) ? TileType.FLOOR_2 : before.tiles[i]);
  }
  assert.equal(paintTiles(after, region, TileType.FLOOR_2, color), after); // idempotent
  const ed = new EditorState();
  assert.ok(ed.beginEdit(null)); // a discrete edit opens its own undo entry
  ed.pushUndo(before);
  assert.equal(ed.undoStack.length, 1);
  assert.equal(ed.undoStack[0], before);
});

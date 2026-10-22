/**
 * Floor chunk cache: a layout edit invalidates only the chunks around the
 * changed tiles (the edit-flicker fix rebuilds one chunk, not the whole floor).
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import { changedFloorChunks } from '../src/office/engine/renderer.js';
import { TileType } from '../src/office/types.js';

const F = TileType.FLOOR_1;

function floor(cols: number, rows: number) {
  return {
    tileMap: Array.from({ length: rows }, () => new Array(cols).fill(F)),
    tileColors: new Array(cols * rows).fill(null),
    carpetTiles: new Array(cols * rows).fill(null),
  };
}

test('one painted tile dirties its chunk (and a neighbour when on the edge)', () => {
  const a = floor(16, 16);
  const b = { ...a, tileMap: a.tileMap.map((r) => [...r]) };
  b.tileMap[2][2] = TileType.WALL;
  assert.deepEqual([...changedFloorChunks(a, b, 16, 16, 8)], ['0,0']);
  b.tileMap[2][7] = TileType.WALL; // carpet junctions reach one tile across the chunk edge
  assert.deepEqual([...changedFloorChunks(a, b, 16, 16, 8)].sort(), ['0,0', '1,0']);
});

test('equal colors in new objects and an unchanged floor dirty nothing', () => {
  const a = floor(8, 8);
  a.tileColors[3] = { h: 1, s: 2, b: 3, c: 4 };
  const b = { ...a, tileColors: a.tileColors.map((c) => (c ? { ...c } : c)) };
  assert.equal(changedFloorChunks(a, b, 8, 8, 4).size, 0);
  b.carpetTiles = [...a.carpetTiles];
  b.carpetTiles[63] = { variant: 0 };
  assert.deepEqual([...changedFloorChunks(a, b, 8, 8, 4)], ['1,1']);
});

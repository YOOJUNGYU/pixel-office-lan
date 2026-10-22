/**
 * A character whose seat can't be reached gives it up and stands still
 * (it never sits or types on the wrong tile); a reachable one walks there.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import { createCharacter, updateCharacter } from '../src/office/engine/characters.js';
import type { Seat, TileType as TileTypeVal } from '../src/office/types.js';
import { CharacterState, Direction, TILE_SIZE, TileType } from '../src/office/types.js';

const F = TileType.FLOOR_1 as TileTypeVal;
const W = TileType.WALL as TileTypeVal;

function setup(walled: boolean) {
  // 7×7 floor; the seat at (5,5) is boxed in by walls when `walled`.
  const tileMap = Array.from({ length: 7 }, (_, r) =>
    Array.from({ length: 7 }, (_, c) =>
      walled && Math.abs(c - 5) <= 1 && Math.abs(r - 5) <= 1 && !(c === 5 && r === 5) ? W : F,
    ),
  );
  const seat: Seat = {
    uid: 'chair',
    seatCol: 5,
    seatRow: 5,
    facingDir: Direction.UP,
    assigned: true,
  };
  const seats = new Map([['chair', seat]]);
  const ch = createCharacter(1, 0, 'chair', seat);
  Object.assign(ch, {
    tileCol: 1,
    tileRow: 1,
    x: 1.5 * TILE_SIZE,
    y: 1.5 * TILE_SIZE,
    state: CharacterState.IDLE,
    isActive: false,
  });
  return { ch, seat, seats, tileMap };
}

test('an unreachable seat is released and the character stands still', () => {
  const { ch, seat, seats, tileMap } = setup(true);
  for (let i = 0; i < 100; i++) updateCharacter(ch, 0.05, seats, tileMap, new Set());
  assert.equal(ch.state, CharacterState.IDLE);
  assert.equal(ch.seatId, null);
  assert.equal(seat.assigned, false);
  assert.deepEqual([ch.tileCol, ch.tileRow], [1, 1]);
});

test('a reachable seat is walked to and sat on', () => {
  const { ch, seats, tileMap } = setup(false);
  for (let i = 0; i < 400; i++) updateCharacter(ch, 0.05, seats, tileMap, new Set());
  assert.equal(ch.state, CharacterState.TYPE);
  assert.deepEqual([ch.tileCol, ch.tileRow], [5, 5]);
});

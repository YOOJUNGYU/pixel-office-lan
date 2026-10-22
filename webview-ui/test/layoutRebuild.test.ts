/**
 * Editing the layout (every editor click → OfficeState.rebuildFromLayout) must
 * not move characters: walkers keep walking, sitters keep sitting, and only a
 * character whose tile or seat the edit took away moves — on foot, nearby.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { test } from 'vitest';

import { buildFurnitureCatalog } from '../../core/src/assets/build.ts';
import { decodeAllFurniture } from '../../core/src/assets/loader.ts';
import { placeFurniture, removeFurniture } from '../src/office/editor/editorActions.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import { buildDynamicCatalog } from '../src/office/layout/furnitureCatalog.js';
import { isWalkable } from '../src/office/layout/tileMap.js';
import type { Character, OfficeLayout } from '../src/office/types.js';
import { CharacterState, TILE_SIZE } from '../src/office/types.js';

const assetsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/assets');
const layout = JSON.parse(
  fs.readFileSync(path.join(assetsDir, 'default-layout-1.json'), 'utf-8'),
) as OfficeLayout;
const catalog = buildFurnitureCatalog(assetsDir);
buildDynamicCatalog({ catalog, sprites: decodeAllFurniture(assetsDir, catalog) });

const ID = 1;
const DT = 0.05;

type Tile = { col: number; row: number };
const key = (t: Tile) => `${t.col},${t.row}`;

function snapshot(ch: Character) {
  return {
    x: ch.x,
    y: ch.y,
    tileCol: ch.tileCol,
    tileRow: ch.tileRow,
    state: ch.state,
    seatId: ch.seatId,
    path: ch.path.map((t) => ({ ...t })),
    moveProgress: ch.moveProgress,
  };
}

function areaAt(os: OfficeState, t: Tile): string | null {
  return os.layout.areaTiles?.[t.row * os.layout.cols + t.col] ?? null;
}

/** A seated agent in 코딩실 (no spawn effect). */
function seated(): { os: OfficeState; ch: Character } {
  const os = new OfficeState(structuredClone(layout));
  os.addAgent(ID, 0, 0, undefined, true);
  os.moveToArea(ID, '코딩실');
  const ch = os.characters.get(ID)!;
  for (let i = 0; i < 4000 && ch.state === CharacterState.WALK; i++) os.update(DT);
  const seat = os.seats.get(ch.seatId!)!;
  assert.equal(ch.state, CharacterState.TYPE);
  assert.deepEqual([ch.tileCol, ch.tileRow], [seat.seatCol, seat.seatRow]);
  return { os, ch };
}

/** The seated agent sent to 대기실 and stopped part-way, mid-step. */
function walking(): { os: OfficeState; ch: Character } {
  const { os, ch } = seated();
  os.moveToArea(ID, '대기실');
  assert.ok(ch.path.length > 12, 'long walk');
  for (let i = 0; i < 1000 && ch.path.length > 8; i++) os.update(DT);
  // stop mid-step so a reset of moveProgress would show
  while (ch.moveProgress === 0) os.update(DT);
  assert.equal(ch.state, CharacterState.WALK);
  return { os, ch };
}

/** Tick until the walk ends; returns the tiles stood on, in order. */
function walkOut(os: OfficeState, ch: Character): Tile[] {
  const visited: Tile[] = [{ col: ch.tileCol, row: ch.tileRow }];
  for (let i = 0; i < 4000 && ch.state === CharacterState.WALK; i++) {
    os.update(DT);
    const last = visited[visited.length - 1];
    if (last.col !== ch.tileCol || last.row !== ch.tileRow) {
      visited.push({ col: ch.tileCol, row: ch.tileRow });
    }
  }
  return visited;
}

/** A free floor tile in `area`, at least `minDist` from `away`, not on `avoid`. */
function freeTileIn(os: OfficeState, area: string, avoid: Tile[], away?: Tile, minDist = 0): Tile {
  const taken = new Set(avoid.map(key));
  const t = os.walkableTiles.find(
    (w) =>
      areaAt(os, w) === area &&
      !taken.has(key(w)) &&
      !taken.has(key({ col: w.col, row: w.row + 1 })) &&
      (!away || Math.abs(w.col - away.col) + Math.abs(w.row - away.row) >= minDist),
  );
  assert.ok(t, `free tile in ${area}`);
  return t;
}

/** Put a 1-tile plant (CACTUS: top row walkable, bottom row blocks) so it blocks `t`. */
function plantOn(l: OfficeLayout, t: Tile): OfficeLayout {
  return placeFurniture(l, { uid: 'test-plant', type: 'CACTUS', col: t.col, row: t.row - 1 });
}

test('a walking character keeps position, path and destination across an identical rebuild', () => {
  const { os, ch } = walking();
  const before = snapshot(ch);
  const dest = before.path[before.path.length - 1];
  os.rebuildFromLayout(structuredClone(os.layout));
  assert.deepEqual(snapshot(ch), before);

  const visited = walkOut(os, ch);
  assert.deepEqual(visited[visited.length - 1], dest, 'reaches its seat');
  const seen = new Set(visited.map(key));
  assert.equal(seen.size, visited.length, 'never walks back over a tile');
});

test('an edit in another room does not touch a walking character', () => {
  const { os, ch } = walking();
  const before = snapshot(ch);
  const spot = freeTileIn(os, '자료실', [...ch.path, { col: ch.tileCol, row: ch.tileRow }]);
  os.rebuildFromLayout(plantOn(os.layout, spot));
  assert.deepEqual(snapshot(ch), before);
  const visited = walkOut(os, ch);
  assert.equal(new Set(visited.map(key)).size, visited.length);
});

test('a seated character stays put on an unrelated edit', () => {
  const { os, ch } = seated();
  const before = snapshot(ch);
  const spot = freeTileIn(os, '자료실', []);
  os.rebuildFromLayout(plantOn(os.layout, spot));
  assert.deepEqual(snapshot(ch), before);
});

test('moving its chair makes a seated character walk to the new seat, not teleport', () => {
  const { os, ch } = seated();
  const before = snapshot(ch);
  const chairUid = ch.seatId!;
  const here = { col: ch.tileCol, row: ch.tileRow };
  const to = freeTileIn(os, '코딩실', [here], here, 4);
  const next = structuredClone(os.layout);
  const chair = next.furniture.find((f) => f.uid === chairUid)!;
  chair.col = to.col;
  chair.row = to.row;
  os.rebuildFromLayout(next);

  assert.equal(ch.seatId, chairUid);
  const seat = os.seats.get(chairUid)!;
  assert.deepEqual([ch.x, ch.y], [before.x, before.y], 'not teleported');
  assert.equal(ch.state, CharacterState.WALK);
  assert.deepEqual(ch.path[ch.path.length - 1], { col: seat.seatCol, row: seat.seatRow });
  walkOut(os, ch);
  assert.deepEqual([ch.tileCol, ch.tileRow], [seat.seatCol, seat.seatRow]);
});

test('removing its chair sends a character to another seat in its room on foot', () => {
  const { os, ch } = seated();
  const before = snapshot(ch);
  const oldSeat = ch.seatId!;
  os.rebuildFromLayout(removeFurniture(os.layout, oldSeat));

  assert.deepEqual([ch.x, ch.y], [before.x, before.y], 'not teleported');
  assert.notEqual(ch.seatId, oldSeat);
  assert.ok(ch.seatId, 'got another seat');
  assert.equal(os.seatZone(ch.seatId), '코딩실');
  assert.equal(ch.state, CharacterState.WALK);
  const seat = os.seats.get(ch.seatId)!;
  assert.deepEqual(ch.path[ch.path.length - 1], { col: seat.seatCol, row: seat.seatRow });
});

test('furniture dropped on a standing character moves it to the nearest free tile', () => {
  const { os, ch } = seated();
  os.moveToArea(ID, '자료실', true);
  walkOut(os, ch);
  assert.equal(ch.seatId, null);
  const here = { col: ch.tileCol, row: ch.tileRow };
  const next = plantOn(os.layout, here);
  os.rebuildFromLayout(next);
  assert.ok(os.blockedTiles.has(key(here)), 'the plant blocks the tile');

  const now = { col: ch.tileCol, row: ch.tileRow };
  assert.ok(isWalkable(now.col, now.row, os.tileMap, os.blockedTiles));
  assert.ok(Math.abs(now.col - here.col) + Math.abs(now.row - here.row) <= 2, 'nearby');
  assert.equal(areaAt(os, now), '자료실');
  assert.deepEqual(
    [ch.x, ch.y],
    [now.col * TILE_SIZE + TILE_SIZE / 2, now.row * TILE_SIZE + TILE_SIZE / 2],
  );
});

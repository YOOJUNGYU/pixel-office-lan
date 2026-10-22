/**
 * The four fixed rooms: normalizeRoomAreas (shared with the server) and the
 * webview's layout migration, which applies it on layoutLoaded and on import.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import type { RoomAreasLayout } from '../../core/src/lan.js';
import { normalizeRoomAreas, ROOM_LABELS } from '../../core/src/lan.js';
import { ROOM_AREA_COLORS } from '../src/constants.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import { migrateLayoutColors } from '../src/office/layout/layoutSerializer.js';
import type { OfficeLayout } from '../src/office/types.js';
import { TileType } from '../src/office/types.js';

const ROOMS = Object.values(ROOM_LABELS);
const F = TileType.FLOOR_1;

function grid(cols: number, rows: number, extra: Partial<OfficeLayout> = {}): OfficeLayout {
  return {
    version: 1,
    cols,
    rows,
    tiles: new Array(cols * rows).fill(F),
    furniture: [],
    tileColors: new Array(cols * rows).fill(null),
    ...extra,
  };
}

test('adds the missing rooms with default colors, keeps existing colors, drops unknown areas', () => {
  const out = normalizeRoomAreas(
    {
      cols: 2,
      rows: 2,
      areas: [
        { label: 'Lab', color: ROOM_AREA_COLORS.coding },
        { label: ROOM_LABELS.server, color: ROOM_AREA_COLORS.lounge },
      ],
      areaTiles: ['Lab', ROOM_LABELS.server, null, ROOM_LABELS.lounge],
    },
    ROOM_AREA_COLORS,
  );
  assert.deepEqual(
    out.areas?.map((a) => a.label),
    ROOMS,
  );
  assert.equal(out.areas?.[2].color, ROOM_AREA_COLORS.lounge, 'server keeps its own color');
  assert.equal(out.areas?.[0].color, ROOM_AREA_COLORS.coding);
  assert.deepEqual(out.areaTiles, [null, ROOM_LABELS.server, null, ROOM_LABELS.lounge]);
});

test('odd areas/areaTiles never throw: wrong types and sizes become empty rooms', () => {
  for (const odd of [
    { areas: 'x', areaTiles: 'y' },
    { areas: [null, 1, { label: 3 }], areaTiles: [1, 2] },
    { areas: [{ label: ROOM_LABELS.coding, color: 'red' }], areaTiles: undefined },
  ]) {
    const out = normalizeRoomAreas(
      { cols: 1, rows: 2, ...(odd as object) } as RoomAreasLayout,
      ROOM_AREA_COLORS,
    );
    assert.equal(out.areas?.length, 4);
    assert.equal(out.areas?.[0].color, ROOM_AREA_COLORS.coding, 'invalid color → default');
    assert.deepEqual(out.areaTiles, [null, null]);
  }
});

test('migration (layoutLoaded / import) normalizes rooms', () => {
  const migrated = migrateLayoutColors(
    grid(2, 1, {
      areas: [{ label: 'Custom', color: ROOM_AREA_COLORS.coding }],
      areaTiles: ['Custom', null],
    }),
  );
  assert.deepEqual(
    migrated.areas?.map((a) => a.label),
    ROOMS,
  );
  assert.deepEqual(migrated.areaTiles, [null, null]);
});

test('emptyRooms lists the rooms with no walkable tile', () => {
  const layout = migrateLayoutColors(
    grid(2, 1, { areaTiles: [ROOM_LABELS.coding, ROOM_LABELS.lounge] }),
  );
  const os = new OfficeState(layout);
  assert.deepEqual(os.emptyRooms(), [ROOM_LABELS.library, ROOM_LABELS.server]);
});

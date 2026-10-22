/**
 * Tests for the `migrateLayoutColors` migration path (which wraps
 * the internal `migrateLayout` function — the only public migration entrypoint).
 *
 * Decorative pets are gone (pets are player characters now): a legacy `pets`
 * roster in a saved or imported layout is dropped.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import type { ColorValue } from '../src/components/ui/types.js';
import { migrateLayoutColors } from '../src/office/layout/layoutSerializer.js';
import type { OfficeLayout, PlacedFurniture } from '../src/office/types.js';
import { TileType } from '../src/office/types.js';

// ── Helpers ────────────────────────────────────────────────────

function baseLayout(overrides: Partial<OfficeLayout> = {}): OfficeLayout {
  // 4×3 minimum layout. layoutRevision = 1 to skip the OLD_VOID branch and
  // tileColors length-match to skip the tileColors-generation early return.
  const cols = 4;
  const rows = 3;
  const tiles = new Array(cols * rows).fill(TileType.FLOOR_1);
  const tileColors: Array<ColorValue | null> = new Array(cols * rows).fill(null);
  return {
    version: 1,
    cols,
    rows,
    tiles,
    furniture: [],
    tileColors,
    layoutRevision: 1,
    ...overrides,
  };
}

/** A layout as an older build saved it, with decorative pets. */
const withPets = (pets: unknown, l: OfficeLayout = baseLayout()): OfficeLayout =>
  ({ ...l, pets }) as OfficeLayout;
const hasPets = (l: OfficeLayout): boolean => 'pets' in l;

// ── Migration: legacy pets dropped ────────────────────────────

test('migrateLayoutColors drops a legacy pets roster (any shape)', () => {
  for (const pets of [[{ id: 'pet-1', petType: 0 }], [], null, 'x']) {
    assert.equal(hasPets(migrateLayoutColors(withPets(pets))), false);
  }
});

test('migrateLayoutColors leaves a pet-free layout pet-free', () => {
  assert.equal(hasPets(migrateLayoutColors(baseLayout())), false);
});

// ── Migration: pets + tileColors regeneration interaction ─────

test('migrateLayoutColors drops pets AND regenerates tileColors when missing', () => {
  // Force the tileColors path by stripping tileColors entirely.
  const layout = withPets([{ id: 'p', petType: 0 }], {
    version: 1,
    cols: 4,
    rows: 3,
    tiles: new Array(12).fill(TileType.FLOOR_1),
    furniture: [],
    layoutRevision: 1,
  });
  const migrated = migrateLayoutColors(layout);
  assert.equal(hasPets(migrated), false);
  assert.ok(Array.isArray(migrated.tileColors));
  assert.equal(migrated.tileColors!.length, 12);
});

// ── Migration: OLD_VOID + pets interaction ────────────────────

test('migrateLayoutColors handles OLD_VOID tile migration on a legacy layout', () => {
  // Mark as legacy: no layoutRevision, contains OLD_VOID=8.
  const cols = 4;
  const rows = 3;
  const tiles: number[] = new Array(cols * rows).fill(TileType.FLOOR_1);
  tiles[0] = 8; // OLD_VOID literal
  const layout: OfficeLayout = {
    version: 1,
    cols,
    rows,
    tiles: tiles as OfficeLayout['tiles'],
    furniture: [],
  };
  const migrated = migrateLayoutColors(layout);
  assert.equal(migrated.tiles[0], TileType.VOID);
  assert.equal(hasPets(migrated), false);
});

// ── Migration: returned layout retains other fields ───────────

test('migrateLayoutColors preserves furniture and other fields untouched', () => {
  const furniture: PlacedFurniture[] = [{ uid: 'f-1', type: 'desk_basic', col: 1, row: 1 }];
  const layout = withPets([{ id: 'p1', petType: 0 }], baseLayout({ furniture }));
  const migrated = migrateLayoutColors(layout);
  assert.equal(migrated.furniture.length, 1);
  // The migrator may rewrite furniture types, so compare uid/col/row, not the
  // raw type string.
  assert.equal(migrated.furniture[0].uid, 'f-1');
  assert.equal(migrated.furniture[0].col, 1);
  assert.equal(migrated.furniture[0].row, 1);
  assert.equal(hasPets(migrated), false);
  assert.equal(migrated.cols, 4);
  assert.equal(migrated.rows, 3);
  assert.equal(migrated.version, 1);
});

// ── Migration: idempotency ────────────────────────────────────

test('migrateLayoutColors is idempotent (running twice produces equivalent output)', () => {
  const layout = baseLayout();
  const once = migrateLayoutColors(layout);
  const twice = migrateLayoutColors(once);
  assert.deepEqual(twice.areas, once.areas);
  assert.deepEqual(twice.tiles, once.tiles);
  assert.deepEqual(twice.tileColors, once.tileColors);
});

/* eslint-disable pixel-agents/no-inline-colors -- test fixtures */
import assert from 'node:assert/strict';

import { test } from 'vitest';

import {
  BACKGROUND_DEFAULT_COLOR,
  BACKGROUND_DEFAULT_FLOOR_COLOR,
  CARPET_DEFAULT_ACCENT_COLOR,
} from '../src/constants.js';
import { resolveBackground } from '../src/office/background.js';
import { colorValueToHex } from '../src/office/colorize.js';
import { deserializeLayout, serializeLayout } from '../src/office/layout/layoutSerializer.js';
import { getCarpetPatchSprite, setCarpetSprites } from '../src/office/sprites/carpetTiles.js';
import type { OfficeBackground, OfficeLayout } from '../src/office/types.js';
import { TileType } from '../src/office/types.js';

function layout(background?: OfficeBackground): OfficeLayout {
  return {
    version: 1,
    cols: 2,
    rows: 1,
    tiles: [TileType.FLOOR_1, TileType.VOID],
    tileColors: [{ h: 0, s: 0, b: 0, c: 0 }, null],
    furniture: [],
    ...(background ? { background } : {}),
  };
}

test('layout serializer round-trips background', () => {
  const bg: OfficeBackground = {
    kind: 'carpet',
    pattern: 2,
    color: { h: 10, s: 20, b: 30, c: 0, colorize: true },
    accent: '#aabbcc',
  };
  const back = deserializeLayout(serializeLayout(layout(bg)));
  assert.deepEqual(back?.background, bg);
});

test('missing background stays missing and resolves to the default (none)', () => {
  const back = deserializeLayout(serializeLayout(layout()));
  assert.equal(back?.background, undefined);
  assert.deepEqual(resolveBackground(back?.background), { kind: 'none' });
});

test('color background: hex string kept, ColorValue converted', () => {
  assert.deepEqual(resolveBackground({ kind: 'color', color: '#123456' }), {
    kind: 'color',
    css: '#123456',
  });
  assert.deepEqual(resolveBackground({ kind: 'color' }), {
    kind: 'color',
    css: colorValueToHex(BACKGROUND_DEFAULT_COLOR),
  });
  assert.deepEqual(resolveBackground({ kind: 'color', color: 'red; background:url(x)' }), {
    kind: 'color',
    css: colorValueToHex(BACKGROUND_DEFAULT_COLOR),
  });
});

test('floor/carpet backgrounds validate pattern and colors', () => {
  assert.deepEqual(resolveBackground({ kind: 'floor', pattern: 0 }), {
    kind: 'floor',
    pattern: 1,
    color: BACKGROUND_DEFAULT_FLOOR_COLOR,
  });
  const c = resolveBackground({ kind: 'carpet', pattern: 1, color: '#ff0000' });
  assert.equal(c.kind, 'carpet');
  if (c.kind !== 'carpet') return;
  assert.equal(c.variant, 1);
  assert.equal(c.color.h, 0);
  assert.equal(c.color.s, 100);
  assert.deepEqual(c.accent, CARPET_DEFAULT_ACCENT_COLOR);
});

test('unknown kind or junk resolves to none', () => {
  assert.deepEqual(resolveBackground({ kind: 'plaid' } as unknown as OfficeBackground), {
    kind: 'none',
  });
  assert.deepEqual(resolveBackground(null), { kind: 'none' });
});

test('carpet background patch: (tiles+1)² tiles, main-colour margin, rug drawn', () => {
  const T = 16;
  const blank = () => Array.from({ length: T }, () => new Array<string>(T).fill(''));
  // 16 cases; every non-empty case paints one dark and one light pixel.
  const sets = [
    Array.from({ length: 16 }, (_, ms) => {
      const s = blank();
      if (ms) {
        s[8][8] = '#202020';
        s[9][9] = '#e0e0e0';
      }
      return s;
    }),
  ];
  setCarpetSprites(sets);
  const color = { h: 0, s: 50, b: 0, c: 0, colorize: true };
  const accent = { h: 120, s: 50, b: 0, c: 0, colorize: true };
  const patch = getCarpetPatchSprite(0, color, accent, 2);
  assert.ok(patch);
  assert.equal(patch.length, 3 * T);
  assert.equal(patch[0][0], colorValueToHex(color));
  // Junction (1,1) sprite sits at (16,16); its pixel (8,8) → (24,24).
  assert.notEqual(patch[24][24], '');
  assert.equal(getCarpetPatchSprite(5, color, accent, 2), null);
});

test('pattern index past the loaded assets falls back to the default', () => {
  const limits = { floorPatterns: 7, carpetVariants: 3 };
  const f = resolveBackground({ kind: 'floor', pattern: 9 }, limits);
  assert.equal(f.kind === 'floor' && f.pattern, 1);
  assert.equal(resolveBackground({ kind: 'floor', pattern: 7 }, limits).kind === 'floor', true);
  const c = resolveBackground({ kind: 'carpet', pattern: 3 }, limits);
  assert.equal(c.kind === 'carpet' && c.variant, 0);
  // Carpets not loaded yet (0): keep the stored index.
  const c0 = resolveBackground(
    { kind: 'carpet', pattern: 2 },
    { floorPatterns: 7, carpetVariants: 0 },
  );
  assert.equal(c0.kind === 'carpet' && c0.variant, 2);
});

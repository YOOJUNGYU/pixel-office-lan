/* eslint-disable pixel-agents/no-inline-colors -- test fixtures */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { test, vi } from 'vitest';

import { rgbToHsl } from '../src/office/colorize.js';
import { themeColor, themeFloorColor, themeSprite } from '../src/office/themeColors.js';
import { parseThemePref, resolveTheme } from '../src/theme.js';

const hsl = (hex: string) =>
  rgbToHsl(
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  );

// Floor colors of the default office: 코딩실, 자료실, 서버실, 대기실, corridor.
const ROOM_FLOORS = ['#2B3A55', '#6B4A2A', '#5A5F63', '#8A5634', '#3D4247'];

test('dark is the identity (same strings, same sprite objects)', () => {
  for (const c of ROOM_FLOORS) assert.equal(themeFloorColor(c, 'dark'), c);
  const sprite = [
    ['#123456', ''],
    ['', '#ABCDEF80'],
  ];
  assert.equal(themeSprite(sprite, 'furniture', 'dark'), sprite);
});

test('light floors are lighter and less saturated, hue kept, rooms stay distinct', () => {
  const out = ROOM_FLOORS.map((c) => themeFloorColor(c, 'light'));
  for (let i = 0; i < ROOM_FLOORS.length; i++) {
    const [h0, s0, l0] = hsl(ROOM_FLOORS[i]);
    const [h1, s1, l1] = hsl(out[i]);
    assert.ok(l1 > l0 && l1 >= 0.75, `${out[i]} clearly light`);
    assert.ok(s1 <= s0 + 0.01, `${out[i]} not more saturated`);
    if (s0 > 0.1) assert.ok(Math.abs(h1 - h0) < 3, `${out[i]} hue kept`);
  }
  assert.equal(new Set(out).size, out.length);
});

test('light keeps alpha, ignores non-hex, keeps dark outlines darker than mid-tones', () => {
  assert.match(themeColor('#20304080', 'floor', 'light'), /^#[0-9A-F]{6}80$/);
  assert.equal(themeColor('transparent', 'floor', 'light'), 'transparent');
  const outline = hsl(themeColor('#101010', 'furniture', 'light'))[2];
  const mid = hsl(themeColor('#808080', 'furniture', 'light'))[2];
  assert.ok(outline < 0.2 && mid > 0.55, `${outline} ${mid}`);
});

test('pixel-crisp: themed sprites are per-pixel copies (same grid, hex only), cached', () => {
  const sprite = [
    ['#112233', '', '#445566FF'],
    ['', '#778899', ''],
  ];
  const a = themeSprite(sprite, 'wall', 'light');
  assert.notEqual(a, sprite);
  assert.equal(themeSprite(sprite, 'wall', 'light'), a);
  assert.deepEqual(
    a.map((r) => r.length),
    [3, 3],
  );
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < 3; c++) {
      assert.equal(a[r][c] === '', sprite[r][c] === '');
      if (a[r][c]) assert.match(a[r][c], /^#[0-9A-F]{6}([0-9A-F]{2})?$/);
    }
});

test('pixel-crisp: no CSS/canvas filter anywhere in the webview source', () => {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = path.join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|css)$/.test(f)) files.push(p);
    }
  };
  walk(path.resolve(__dirname, '../src'));
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /\.filter\s*=|\bfilter\s*:|\bfilter-|backdrop-blur|\bblur-/, f);
  }
});

test('theme preference: parse, resolve, persist', async () => {
  assert.equal(parseThemePref(null), 'dark');
  assert.equal(parseThemePref('nope'), 'dark');
  assert.equal(parseThemePref('light'), 'light');
  assert.equal(parseThemePref('system'), 'system');
  assert.equal(resolveTheme('system', true), 'light');
  assert.equal(resolveTheme('system', false), 'dark');
  assert.equal(resolveTheme('dark', true), 'dark');

  const store = new Map<string, string>([['pixel-office.theme', 'light']]);
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  });
  vi.resetModules();
  const mod = await import('../src/theme.js');
  assert.equal(mod.getThemePref(), 'light');
  assert.equal(mod.getTheme(), 'light');
  mod.setThemePref('dark');
  assert.equal(store.get('pixel-office.theme'), 'dark');
  assert.equal(mod.getTheme(), 'dark');
  // Storage that throws: falls back to dark and still applies in-page.
  vi.stubGlobal('localStorage', {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  });
  vi.resetModules();
  const blocked = await import('../src/theme.js');
  assert.equal(blocked.getTheme(), 'dark');
  blocked.setThemePref('light');
  assert.equal(blocked.getTheme(), 'light');
  vi.unstubAllGlobals();
});

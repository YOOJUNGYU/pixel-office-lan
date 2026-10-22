/**
 * Onboarding tour: geometry, step filtering, demo agents, state reducer.
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
import { TOUR_DEMO_PREFIX } from '../src/constants.js';
import { LanAgents } from '../src/lan/lanAgents.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import { buildDynamicCatalog } from '../src/office/layout/furnitureCatalog.js';
import type { OfficeLayout } from '../src/office/types.js';
import { DEMO_KEYS, demoAgents, isDemoKey, needsDemo, roleAgents } from '../src/tour/demoAgents.js';
import {
  approachRect,
  areaWorldRect,
  fitZoom,
  mergeOverlapping,
  placeTooltip,
  spotlightRect,
  unionRect,
} from '../src/tour/geometry.js';
import { bodyKey, type Capability, STEPS, visibleSteps } from '../src/tour/steps.js';
import { tourReducer, type TourState } from '../src/tour/useTour.js';

const view = { w: 800, h: 600 };
const tip = { w: 200, h: 100 };

test('unionRect spans every rect; empty → null', () => {
  assert.equal(unionRect([]), null);
  assert.deepEqual(
    unionRect([
      { x: 10, y: 10, w: 10, h: 10 },
      { x: 50, y: 0, w: 5, h: 40 },
    ]),
    { x: 10, y: 0, w: 45, h: 40 },
  );
});

test('spotlightRect pads, clips to the viewport margin, and drops off-screen targets', () => {
  assert.deepEqual(spotlightRect({ x: 100, y: 100, w: 50, h: 20 }, 6, view, 8), {
    x: 94,
    y: 94,
    w: 62,
    h: 32,
  });
  assert.deepEqual(spotlightRect({ x: 0, y: 0, w: 900, h: 700 }, 6, view, 8), {
    x: 8,
    y: 8,
    w: 784,
    h: 584,
  });
  assert.equal(spotlightRect({ x: 1000, y: 100, w: 50, h: 20 }, 6, view, 8), null);
});

test('placeTooltip: below, above, right, left, then over the target; never off-screen', () => {
  const inside = (p: { x: number; y: number }) =>
    p.x >= 8 && p.y >= 8 && p.x + tip.w <= view.w - 8 && p.y + tip.h <= view.h - 8;
  const below = placeTooltip({ x: 300, y: 50, w: 100, h: 40 }, tip, view, 12, 8);
  assert.equal(below.side, 'bottom');
  assert.equal(below.y, 102);
  assert.equal(below.x, 250);
  assert.equal(placeTooltip({ x: 300, y: 480, w: 100, h: 40 }, tip, view, 12, 8).side, 'top');
  assert.equal(placeTooltip({ x: 10, y: 50, w: 100, h: 500 }, tip, view, 12, 8).side, 'right');
  assert.equal(placeTooltip({ x: 590, y: 50, w: 200, h: 500 }, tip, view, 12, 8).side, 'left');
  const over = placeTooltip({ x: 0, y: 0, w: 800, h: 600 }, tip, view, 12, 8);
  assert.equal(over.side, 'center');
  assert.equal(over.y, 600 - 8 - 100); // bottom of the screen, out of the way
  // A target hugging the left edge still keeps the tooltip on screen.
  for (const p of [
    over,
    below,
    placeTooltip({ x: 0, y: 50, w: 20, h: 20 }, tip, view, 12, 8),
    placeTooltip(null, tip, view, 12, 8),
  ]) {
    assert.ok(inside(p), JSON.stringify(p));
  }
  // Narrow phone: a tooltip wider than the screen sticks to the left margin.
  assert.equal(placeTooltip(null, { w: 400, h: 100 }, { w: 360, h: 640 }, 12, 8).x, 8);
});

test('mergeOverlapping joins touching holes, keeps separate ones', () => {
  const a = { x: 0, y: 0, w: 10, h: 10 };
  const b = { x: 5, y: 5, w: 10, h: 10 };
  const c = { x: 100, y: 100, w: 5, h: 5 };
  const d = { x: 14, y: 0, w: 90, h: 101 }; // touches b, then c
  assert.deepEqual(mergeOverlapping([a, c]), [a, c]);
  assert.deepEqual(mergeOverlapping([a, b, c]), [{ x: 0, y: 0, w: 15, h: 15 }, c]);
  assert.deepEqual(mergeOverlapping([a, c, b, d]), [{ x: 0, y: 0, w: 105, h: 105 }]);
});

test('approachRect moves a fraction per frame and snaps when close', () => {
  const r = approachRect({ x: 0, y: 0, w: 10, h: 10 }, { x: 100, y: 0, w: 10, h: 10.3 }, 0.25);
  assert.deepEqual(r, { x: 25, y: 0, w: 10, h: 10.3 });
});

test('fitZoom shows the whole map, clamped', () => {
  assert.equal(fitZoom({ w: 100, h: 50 }, { w: 1000, h: 1000 }, 0.9, 0.5, 10), 9);
  assert.equal(fitZoom({ w: 100, h: 50 }, { w: 100000, h: 100000 }, 1, 0.5, 10), 10);
  assert.equal(fitZoom({ w: 1000, h: 1000 }, { w: 100, h: 100 }, 1, 0.5, 10), 0.5);
});

test('areaWorldRect bounds the tiles of a room label', () => {
  const tiles = [null, 'A', 'A', null, null, 'A', null, 'B'];
  assert.deepEqual(areaWorldRect(tiles, 4, 'A', 16), { x: 16, y: 0, w: 32, h: 32 });
  assert.equal(areaWorldRect(tiles, 4, 'C', 16), null);
  assert.equal(areaWorldRect(undefined, 4, 'A', 16), null);
});

test('visibleSteps: full tour on a desktop owner, fewer steps on smaller screens', () => {
  const all = new Set<Capability>(['edit', 'switcher', 'profile', 'offices', 'family']);
  assert.deepEqual(
    visibleSteps(all),
    STEPS.map((s) => s.id),
  );
  // The people step is always there, right after the switcher.
  const full = visibleSteps(all);
  assert.equal(full[full.indexOf('switcher') + 1], 'people');
  assert.ok(visibleSteps(new Set()).includes('people'));
  // Phone (no editor) without team offices: no editor, switcher or office steps.
  const phone = visibleSteps(new Set<Capability>(['profile']));
  for (const id of [
    'layoutButton',
    'floor',
    'editorMore',
    'save',
    'switcher',
    'offices',
    'family',
  ]) {
    assert.ok(!phone.includes(id as never), id);
  }
  assert.ok(phone.includes('profile') && phone.includes('settingsButton'));
  // No area-painting step any more (rooms are fixed); the editor goes floor → walls → furniture → background.
  const editor = visibleSteps(new Set<Capability>(['edit']));
  assert.deepEqual(editor.slice(editor.indexOf('floor'), editor.indexOf('background') + 1), [
    'floor',
    'walls',
    'furniture',
    'background',
  ]);
});

const texts = {
  accounts: ['a', 'b', 'c', 'd'] as [string, string, string, string],
  editReason: 'e',
  readReason: 'r',
  waitReason: 'w',
};

test('demoAgents: prefixed keys, rooms, a same-room child, a ghost-led child, a ❗ agent', () => {
  const agents = demoAgents(texts);
  assert.ok(agents.every((a) => isDemoKey(a.key) && a.peer.id.startsWith(TOUR_DEMO_PREFIX)));
  assert.equal(new Set(agents.map((a) => a.key)).size, agents.length);
  const byKey = new Map(agents.map((a) => [a.key, a]));
  for (const key of Object.values(DEMO_KEYS)) assert.ok(byKey.has(key), key);
  assert.equal(byKey.get(DEMO_KEYS.coder)!.room, 'coding');
  assert.equal(byKey.get(DEMO_KEYS.coder)!.reason, 'e');
  assert.equal(byKey.get(DEMO_KEYS.readerSub)!.room, byKey.get(DEMO_KEYS.reader)!.room);
  assert.notEqual(byKey.get(DEMO_KEYS.runnerSub)!.room, byKey.get(DEMO_KEYS.runner)!.room);
  assert.equal(byKey.get(DEMO_KEYS.waiter)!.room, 'lounge');
  assert.ok(byKey.get(DEMO_KEYS.waiter)!.permission);
  // The coder stands alone in 코딩실 (the name-tag step's target).
  assert.deepEqual(
    agents.filter((a) => a.room === 'coding').map((a) => a.key),
    [DEMO_KEYS.coder],
  );
  // The rooms steps walk the waiter around; ❗ only once it is back in 대기실.
  const walked = demoAgents(texts, 'server').find((a) => a.key === DEMO_KEYS.waiter)!;
  assert.equal(walked.room, 'server');
  assert.equal(walked.permission, false);
  // Only main agents count: two mains plus subagents still need demos.
  const mains = agents.filter((a) => a.kind === 'main');
  assert.ok(needsDemo([...mains.slice(0, 2), ...agents.filter((a) => a.kind !== 'main')]));
  assert.ok(!needsDemo(mains.slice(0, 3)));
});

test('roleAgents prefers demos and falls back to matching real agents', () => {
  const demo = demoAgents(texts);
  assert.equal(roleAgents('tag', demo)!.focus.key, DEMO_KEYS.coder);
  assert.equal(roleAgents('bubble', demo)!.focus.key, DEMO_KEYS.waiter);
  assert.equal(roleAgents('child', demo)!.parent!.key, DEMO_KEYS.reader);
  assert.equal(roleAgents('ghost', demo)!.focus.key, DEMO_KEYS.runnerSub);
  const real = demo.map((a) => ({
    ...a,
    key: a.key.replace(TOUR_DEMO_PREFIX, 'p'),
    parentKey: a.parentKey?.replace(TOUR_DEMO_PREFIX, 'p'),
  }));
  assert.equal(roleAgents('bubble', real)!.focus.key, 'pd:main');
  assert.equal(roleAgents('child', real)!.focus.key, 'pb:main/sub/explore');
  assert.equal(roleAgents('ghost', real)!.focus.key, 'pc:main/sub/test');
  assert.equal(
    roleAgents(
      'child',
      real.filter((a) => a.kind === 'main'),
    ),
    null,
  );
  assert.equal(roleAgents('tag', []), null);
});

test('bodyKey picks the text matching what is on screen', () => {
  const ctx = { demo: false, autostart: true, touch: false };
  assert.equal(bodyKey('welcome', ctx), 'tour.welcome.body');
  assert.equal(bodyKey('welcome', { ...ctx, demo: true }), 'tour.welcome.bodyDemo');
  assert.equal(bodyKey('done', { ...ctx, demo: true }), 'tour.done.bodyDemo');
  assert.equal(bodyKey('map', { ...ctx, touch: true }), 'tour.map.bodyTouch');
  assert.equal(bodyKey('system', { ...ctx, autostart: false }), 'tour.system.bodyNoAutostart');
  assert.equal(bodyKey('save', ctx), 'tour.save.body');
  assert.equal(bodyKey('floor', { demo: true, autostart: false, touch: true }), 'tour.floor.body');
});

test('tourReducer: start, next, prev, skip, finish', () => {
  const idle: TourState = { ids: [], index: 0, done: false };
  const s1 = tourReducer(idle, { type: 'start', ids: ['welcome', 'map', 'done'] });
  assert.deepEqual(s1, { ids: ['welcome', 'map', 'done'], index: 0, done: false });
  assert.equal(tourReducer(s1, { type: 'prev' }).index, 0);
  const s2 = tourReducer(tourReducer(s1, { type: 'next' }), { type: 'next' });
  assert.equal(s2.index, 2);
  assert.equal(tourReducer(s2, { type: 'prev' }).index, 1);
  assert.deepEqual(tourReducer(s2, { type: 'next' }), { ids: [], index: 0, done: true });
  assert.deepEqual(tourReducer(s1, { type: 'skip' }), { ids: [], index: 0, done: true });
  // Not running: next/skip change nothing; a replay restarts a done tour.
  assert.equal(tourReducer(idle, { type: 'next' }), idle);
  assert.equal(tourReducer(idle, { type: 'skip' }), idle);
  const replay = tourReducer({ ids: [], index: 0, done: true }, { type: 'start', ids: ['done'] });
  assert.deepEqual(replay, { ids: ['done'], index: 0, done: true });
});

test('LanAgents.setDemo adds client-only characters and removes them all', () => {
  const assetsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/assets');
  const layout = JSON.parse(
    fs.readFileSync(path.join(assetsDir, 'default-layout-1.json'), 'utf-8'),
  ) as OfficeLayout;
  const catalog = buildFurnitureCatalog(assetsDir);
  buildDynamicCatalog({ catalog, sprites: decodeAllFurniture(assetsDir, catalog) });
  const os = new OfficeState(layout);
  const lan = new LanAgents(os);
  const realAgent = {
    ...demoAgents(texts)[0],
    key: 'p1:s',
    peer: { ...demoAgents(texts)[0].peer, id: 'p1' },
  };
  // A peer sending a demo-prefixed key is dropped.
  lan.apply([realAgent, { ...realAgent, key: `${TOUR_DEMO_PREFIX}x:main` }]);
  assert.deepEqual(lan.realAgents(), [realAgent]);
  lan.setDemo(demoAgents(texts));
  assert.equal(lan.all().length, 7);
  assert.deepEqual(lan.realAgents(), [realAgent]);
  const runnerSub = lan.all().find((a) => a.key === DEMO_KEYS.runnerSub)!;
  assert.ok(lan.ghostIdFor(DEMO_KEYS.runner, runnerSub.room) !== undefined);
  // A snapshot while the tour runs keeps the demos.
  lan.apply([realAgent]);
  assert.equal(lan.all().length, 7);
  lan.setDemo([]);
  assert.deepEqual(lan.all(), [realAgent]);
  // Every demo and ghost character despawns; only the real agent's stays.
  const staying = [...os.characters.values()].filter((c) => c.matrixEffect !== 'despawn');
  assert.equal(staying.length, 1);
});

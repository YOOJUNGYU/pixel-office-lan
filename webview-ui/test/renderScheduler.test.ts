/**
 * On-demand rendering: the game loop draws only when asked (requestRender) or
 * when the scene animates (OfficeState.nextFrameIn), sleeping in between.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { test } from 'vitest';

import { TYPE_FRAME_DURATION_SEC } from '../src/constants.js';
import type { LoopClock } from '../src/office/engine/gameLoop.js';
import { onFrame, requestRender, startGameLoop } from '../src/office/engine/gameLoop.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import type { OfficeLayout } from '../src/office/types.js';
import { CharacterState } from '../src/office/types.js';

/** Manual clock: rAF callbacks and timers run only when the test says so. */
function fakeClock() {
  let now = 0;
  let nextId = 1;
  const rafs = new Map<number, (t: number) => void>();
  const timers = new Map<number, { at: number; cb: () => void }>();
  const clock: LoopClock = {
    requestAnimationFrame: (cb) => (rafs.set(nextId, cb), nextId++),
    cancelAnimationFrame: (id) => void rafs.delete(id),
    setTimeout: (cb, ms) => (timers.set(nextId, { at: now + ms, cb }), nextId++),
    clearTimeout: (id) => void timers.delete(id as number),
  };
  return {
    clock,
    pendingRafs: () => rafs.size,
    pendingTimers: () => [...timers.values()].map((t) => t.at - now),
    /** Advance time by `ms`, firing due timers, then run one vsync. */
    tick(ms = 16) {
      now += ms;
      for (const [id, t] of [...timers]) {
        if (t.at <= now) {
          timers.delete(id);
          t.cb();
        }
      }
      const due = [...rafs];
      rafs.clear();
      for (const [, cb] of due) cb(now);
    },
  };
}

function loop(nextFrameIn: () => number) {
  const c = fakeClock();
  const dts: number[] = [];
  let frames = 0;
  const stop = startGameLoop(
    { imageSmoothingEnabled: false },
    { update: (dt) => dts.push(dt), render: () => frames++, nextFrameIn },
    c.clock,
  );
  return { ...c, dts, frames: () => frames, stop };
}

test('idle: one first frame, then no rAF and no timer until requestRender', () => {
  const l = loop(() => Infinity);
  l.tick();
  assert.equal(l.frames(), 1);
  for (let i = 0; i < 10; i++) l.tick();
  assert.equal(l.frames(), 1, 'nothing animates → no frames');
  assert.equal(l.pendingRafs(), 0);
  assert.deepEqual(l.pendingTimers(), []);
  l.stop();
});

test('dirty → exactly one frame, however many requests', () => {
  const l = loop(() => Infinity);
  l.tick();
  requestRender('test');
  requestRender('test');
  requestRender('test');
  l.tick();
  l.tick();
  assert.equal(l.frames(), 2);
  l.stop();
});

test('animation boundary: sleeps until it with a timer, then draws once', () => {
  const l = loop(() => 0.3);
  l.tick();
  assert.equal(l.pendingRafs(), 0);
  assert.deepEqual(l.pendingTimers(), [300]);
  l.tick(100);
  assert.equal(l.frames(), 1, 'no frame before the boundary');
  l.tick(200);
  assert.equal(l.frames(), 2, 'one frame at the boundary');
  assert.ok(Math.abs(l.dts[1] - 0.3) < 1e-9, `timer wake gets the slept time, got ${l.dts[1]}`);
  let heard = 0;
  const off = onFrame(() => heard++);
  l.tick(300);
  assert.equal(heard, 0, 'a boundary wake leaves the DOM overlays alone');
  off();
  l.stop();
});

test('animating (0): a frame every rAF with the usual clamped dt', () => {
  const l = loop(() => 0);
  for (let i = 0; i < 5; i++) l.tick();
  assert.equal(l.frames(), 5);
  l.tick(5000);
  assert.equal(l.dts.at(-1), 0.1, 'a long gap while walking is clamped');
  l.stop();
});

test('requestRender cancels the boundary timer; onFrame follows frames; stop is final', () => {
  const l = loop(() => 0.3);
  let heard = 0;
  const off = onFrame(() => heard++);
  l.tick();
  requestRender('test');
  assert.deepEqual(l.pendingTimers(), []);
  l.tick();
  assert.equal(heard, 2);
  off();
  l.stop();
  requestRender('test');
  l.tick(1000);
  assert.equal(l.frames(), 2);
  assert.equal(l.pendingRafs(), 0);
});

// ── OfficeState.nextFrameIn ────────────────────────────────────

const assetsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/assets');
const layout = JSON.parse(
  fs.readFileSync(path.join(assetsDir, 'default-layout-1.json'), 'utf-8'),
) as OfficeLayout;

test('nextFrameIn: empty office sleeps; a walker or spawn effect animates', () => {
  const os = new OfficeState(structuredClone(layout));
  assert.equal(os.nextFrameIn(0), Infinity);
  os.addAgent(1, 0, 0); // with the matrix spawn effect
  assert.equal(os.nextFrameIn(0), 0);
});

test('nextFrameIn: seated typist wakes at its next typing frame; idle sitter sleeps', () => {
  const os = new OfficeState(structuredClone(layout));
  os.addAgent(1, 0, 0, undefined, true);
  os.moveToArea(1, '코딩실');
  const ch = os.characters.get(1)!;
  for (let i = 0; i < 20000 && os.nextFrameIn(0) === 0; i++) os.update(0.05);
  assert.equal(ch.state, CharacterState.TYPE, 'arrived and typing');
  const next = os.nextFrameIn(0);
  assert.ok(next > 0 && next <= TYPE_FRAME_DURATION_SEC, `typing boundary, got ${next}`);
  const frame = ch.frame;
  os.update(next);
  assert.notEqual(ch.frame, frame, 'the frame flips exactly at the boundary');
  os.setAgentActive(1, false);
  os.update(0.05);
  assert.equal(os.nextFrameIn(0), Infinity, 'seated and idle → still');
});

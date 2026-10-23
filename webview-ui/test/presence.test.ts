/**
 * Join/leave notices of the public office (lan/presence.ts).
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import {
  PRESENCE_LEAVE_GRACE_MS as GRACE,
  PRESENCE_SETTLE_MS as SETTLE,
} from '../src/constants.js';
import { PresenceWatcher } from '../src/lan/presence.js';

const me = { peerId: 'me', account: 'me', nickname: '', self: true };
const p = (id: string, nickname = '') => ({ peerId: id, account: id, nickname, self: false });
const none = { joined: [], left: [] };

function watcher(view = 'public') {
  const w = new PresenceWatcher();
  w.reset(view);
  return w;
}

test('first snapshot is the baseline; a newcomer joins (account (nickname)); self ignored', () => {
  const w = watcher();
  assert.deepEqual(w.apply([me, p('a')], 0), none);
  assert.deepEqual(w.apply([me, p('a'), p('z')], SETTLE - 1), none); // still settling: part of the baseline
  const t = SETTLE;
  assert.deepEqual(w.apply([me, p('a'), p('z'), p('b', 'Bee')], t), {
    joined: ['b (Bee)'],
    left: [],
  });
  assert.deepEqual(w.apply([p('a'), p('z'), p('b', 'Bee')], t + 1000), none); // me gone: nothing
  assert.deepEqual(w.apply([me, p('a'), p('z'), p('b', 'Bee')], t + 2000), none); // me back: nothing
});

test('a leave is reported only after the grace', () => {
  const w = watcher();
  w.apply([me, p('a'), p('b')], 0);
  assert.deepEqual(w.apply([me, p('a')], 1000), none);
  assert.deepEqual(w.apply([me, p('a')], 1000 + GRACE - 1), none);
  assert.deepEqual(w.apply([me, p('a')], 1000 + GRACE), { joined: [], left: ['b'] });
  assert.deepEqual(w.apply([me, p('a')], 1000 + GRACE * 2), none);
});

test('back within the grace: neither leave nor join', () => {
  const w = watcher();
  w.apply([me, p('a')], 0);
  assert.deepEqual(w.apply([me], SETTLE + 1000), none);
  assert.deepEqual(w.apply([me, p('a')], SETTLE + 5000), none);
  assert.deepEqual(w.apply([me, p('a')], SETTLE + GRACE * 2), none);
});

test('view switch / reconnect re-baselines; personal and team views say nothing', () => {
  const w = watcher();
  w.apply([me, p('a')], 0);
  assert.deepEqual(w.apply([me], 1000), none);
  w.reset('personal');
  assert.deepEqual(w.apply([me], 2000), none);
  w.reset('Tabcdefghij');
  assert.deepEqual(w.apply([me, p('x')], 3000), none);
  assert.deepEqual(w.apply([me, p('x'), p('y')], 4000), none);
  w.reset('public');
  assert.deepEqual(w.apply([me, p('b'), p('c')], 5000), none); // baseline, no pending leave of a
  assert.deepEqual(w.apply([me, p('b'), p('c')], 5000 + GRACE * 2), none);
  assert.deepEqual(w.apply([me, p('b'), p('c'), p('d'), p('e')], 6000 + GRACE * 2 + SETTLE), {
    joined: ['d', 'e'],
    left: [],
  });
});

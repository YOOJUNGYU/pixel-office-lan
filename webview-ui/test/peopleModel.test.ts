/**
 * People panel model: counts, status, order, agentless people.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import type { OfficeAgent, PeerInfo } from '../../core/src/lan.js';
import type { OfficePersonMessage } from '../../core/src/messages.js';
import { focusHintKey, inFrozenOrder, peopleRows } from '../src/lan/peopleModel.js';

const person = (peerId: string, nickname: string, self = false): OfficePersonMessage => ({
  peerId,
  nickname,
  palette: 0,
  hueShift: 0,
  self,
});
const peer = (id: string, nickname = id): PeerInfo => ({ id, nickname, palette: 1, hueShift: 0 });
const agent = (p: PeerInfo, id: string, o: Partial<OfficeAgent> = {}): OfficeAgent => ({
  key: `${p.id}:${id}`,
  peer: p,
  id,
  provider: 'claude',
  kind: 'main',
  num: 1,
  room: 'lounge',
  permission: false,
  act: 'idle',
  target: '',
  reason: '',
  ...o,
});

test('counts main agents per provider only; agentless people get a row', () => {
  const k = peer('k');
  const rows = peopleRows(
    [person('me', '나', true), person('k', 'kim'), person('z', 'zed')],
    [
      agent(k, 'a', { room: 'coding' }),
      agent(k, 'b', { provider: 'codex' }),
      agent(k, 'a/sub', { kind: 'subagent', num: 0, parentKey: 'k:a' }),
      agent(k, 'a/sh', { kind: 'shell', num: 0, parentKey: 'k:a' }),
      agent(k, 'c'),
    ],
  );
  const kim = rows.find((r) => r.person.peerId === 'k')!;
  assert.equal(kim.claude, 2);
  assert.equal(kim.codex, 1);
  assert.equal(kim.status, 'working');
  assert.equal(kim.focusKey, 'k:a');
  const zed = rows.find((r) => r.person.peerId === 'z')!;
  assert.deepEqual([zed.claude, zed.codex, zed.status, zed.focusKey], [0, 0, 'idle', null]);
  assert.equal(rows.length, 3);
});

test('status: any permission = attention (focus prefers it); lounge only = idle', () => {
  const a = peer('a');
  const rows = peopleRows(
    [person('a', 'a')],
    [agent(a, 'w', { room: 'coding' }), agent(a, 'p', { permission: true })],
  );
  assert.equal(rows[0].status, 'attention');
  assert.equal(rows[0].focusKey, 'a:p');
  const b = peer('b');
  const sub = peopleRows(
    [person('b', 'b')],
    [agent(b, 'm'), agent(b, 'm/s', { kind: 'subagent', num: 0, room: 'coding' })],
  );
  assert.equal(sub[0].status, 'idle'); // a working subagent does not make its PC "working"
  assert.equal(sub[0].focusKey, 'b:m');
});

test('order: me first, then attention, working, idle, then nickname', () => {
  const [w, x, y] = [peer('w'), peer('x'), peer('y')];
  const rows = peopleRows(
    [
      person('i2', 'b-idle'),
      person('i1', 'a-idle'),
      person('w', 'working'),
      person('me', 'zz', true),
      person('x', 'attention'),
      person('y', 'idle-with-agent'),
    ],
    [agent(w, 'm', { room: 'server' }), agent(x, 'm', { permission: true }), agent(y, 'm')],
  );
  assert.deepEqual(
    rows.map((r) => r.person.peerId),
    ['me', 'x', 'w', 'i1', 'i2', 'y'],
  );
});

test('a PC known only through its agents (tour demos) still gets a row', () => {
  const d = peer('tour-demo:a', 'Demo');
  const rows = peopleRows([person('me', '나', true)], [agent(d, 'main')]);
  assert.deepEqual(
    rows.map((r) => [r.person.peerId, r.person.nickname, r.person.self, r.claude]),
    [
      ['me', '나', true, 0],
      ['tour-demo:a', 'Demo', false, 1],
    ],
  );
  assert.deepEqual(peopleRows([person('me', '나', true)], []).length, 1);
});

test('❗ from a subagent focuses its parent main agent', () => {
  const a = peer('a');
  const rows = peopleRows(
    [person('a', 'a')],
    [
      agent(a, 'w', { room: 'coding' }),
      agent(a, 'm'),
      agent(a, 'm/s', { kind: 'subagent', num: 0, parentKey: 'a:m', permission: true }),
    ],
  );
  assert.equal(rows[0].status, 'attention');
  assert.equal(rows[0].focusKey, 'a:m');
});

test('unnamed people sort by the displayed name, not first', () => {
  const rows = peopleRows(
    [person('u', ''), person('a', 'alpha'), person('z', 'zed')],
    [],
    'unnamed',
  );
  assert.deepEqual(
    rows.map((r) => r.person.peerId),
    ['a', 'u', 'z'],
  );
});

test('a spoofed duplicate peerId yields one row (self, else first, wins)', () => {
  const rows = peopleRows(
    [person('x', 'fake'), person('me', 'me', true), person('me', 'evil')],
    [],
  );
  assert.deepEqual(
    rows.map((r) => [r.person.peerId, r.person.nickname]),
    [
      ['me', 'me'],
      ['x', 'fake'],
    ],
  );
  const first = peopleRows([person('d', 'one'), person('d', 'two')], []);
  assert.deepEqual(
    first.map((r) => r.person.nickname),
    ['one'],
  );
});

test('hint: no agents vs character not spawned yet', () => {
  const k = peer('k');
  assert.equal(focusHintKey(rowOf('n', [])), 'people.noAgents');
  assert.equal(focusHintKey(rowOf('k', [agent(k, 'a')])), 'people.retry');
});

test('frozen order keeps rows put; new rows go last, gone rows drop', () => {
  const rows = peopleRows([person('a', 'a'), person('b', 'b'), person('c', 'c')], []);
  assert.deepEqual(
    inFrozenOrder(rows, ['c', 'a', 'gone']).map((r) => r.person.peerId),
    ['c', 'a', 'b'],
  );
});

function rowOf(id: string, agents: OfficeAgent[]) {
  return peopleRows([person(id, id)], agents)[0];
}

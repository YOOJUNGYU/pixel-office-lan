import assert from 'node:assert/strict';

import { test } from 'vitest';

import type { OfficeAgent } from '../../core/src/lan.js';
import type { OfficePersonMessage } from '../../core/src/messages.js';
import { disambiguate, peerLabel, tieBreak } from '../src/lan/nicknames.js';

const person = (
  peerId: string,
  account: string,
  nickname = '',
  self = false,
): OfficePersonMessage => ({ peerId, account, nickname, palette: 0, hueShift: 0, self });

test('peerLabel: account first, nickname in parentheses when set and not a repeat', () => {
  assert.equal(peerLabel({ account: 'yoojungyu', nickname: '' }), 'yoojungyu');
  assert.equal(peerLabel({ account: 'yoojungyu', nickname: '지민' }), 'yoojungyu (지민)');
  assert.equal(peerLabel({ account: 'kim', nickname: ' KIM ' }), 'kim');
});

test('tieBreak: whoever set the nickname first keeps it; missing time loses; equal time → smaller peerId', () => {
  const at = (peerId: string, nickSince?: number) => ({
    peerId,
    account: peerId,
    nickname: '지민',
    ...(nickSince !== undefined && { nickSince }),
  });
  // The long-time user (older nickSince) keeps it even with a larger peerId.
  let shown = tieBreak([at('aaa', 200), at('zzz', 100)]);
  assert.equal(shown.has('zzz'), false);
  assert.equal(shown.get('aaa')?.nickname, '지민 · aaa');
  // Unknown time (0.3.x peer) loses to any known time.
  shown = tieBreak([at('aaa'), at('zzz', 5)]);
  assert.equal(shown.get('aaa')?.nickname, '지민 · aaa');
  // Equal or both unknown: smaller peerId.
  assert.equal(tieBreak([at('b', 7), at('a', 7)]).get('b')?.nickname, '지민 · b');
  assert.equal(tieBreak([at('b'), at('a')]).get('b')?.nickname, '지민 · b');
});

test('tieBreak: same nickname → smallest peerId keeps it, others get a suffix on the nickname only', () => {
  const shown = tieBreak([
    person('b2c3d4', 'kim', '지민'),
    person('a1b2c3', 'lee', ' 지민 '),
    person('c9', 'park', 'JI  min'),
    person('d0', 'choi', 'ji min'),
    person('e1', 'han'),
    person('f2', 'oh'),
  ]);
  assert.equal(shown.has('a1b2c3'), false);
  assert.deepEqual(shown.get('b2c3d4'), { account: 'kim', nickname: '지민 · b2c3' });
  assert.equal(shown.has('c9'), false);
  assert.deepEqual(shown.get('d0'), { account: 'choi', nickname: 'ji min · d0' });
  assert.equal(shown.has('e1') || shown.has('f2'), false); // no nickname: exempt
  // Order-independent.
  const rev = tieBreak([person('a1b2c3', 'lee', '지민'), person('b2c3d4', 'kim', '지민')]);
  assert.deepEqual(rev.get('b2c3d4'), { account: 'kim', nickname: '지민 · b2c3' });
});

test('tieBreak: identical labels (same account, no nickname) suffix the later account', () => {
  const shown = tieBreak([person('bb', 'kim'), person('aa', 'kim'), person('cc', 'kim', 'x')]);
  assert.equal(shown.has('aa'), false);
  assert.deepEqual(shown.get('bb'), { account: 'kim · bb', nickname: '' });
  assert.equal(shown.has('cc'), false); // "kim (x)" is already distinct
});

test('disambiguate: renames people and agents, reports taken names and a lost self', () => {
  const agent = {
    key: 'b:1',
    peer: { id: 'b', account: 'kim', nickname: 'Kim', palette: 0, hueShift: 0 },
  };
  const snap = disambiguate(
    [person('b', 'kim', 'Kim', true), person('a', 'lee', 'kim'), person('c', 'park', 'Lee')],
    [agent as unknown as OfficeAgent],
  );
  assert.deepEqual(
    snap.people.map((p) => peerLabel(p)),
    ['kim (Kim · b)', 'lee (kim)', 'park (Lee)'],
  );
  assert.equal(snap.agents[0].peer.nickname, 'Kim · b');
  assert.equal(snap.selfLost, 'kim');
  assert.deepEqual([...snap.taken].sort(), ['kim', 'lee']);
  const alone = disambiguate([person('a', 'kim', '', true), person('b', 'kim')], []);
  assert.equal(alone.selfLost, null); // same account, no nickname: display suffix only
  assert.deepEqual(
    alone.people.map((p) => p.account),
    ['kim', 'kim · b'],
  );
});

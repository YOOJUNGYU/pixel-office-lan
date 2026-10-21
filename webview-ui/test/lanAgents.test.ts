/**
 * LanAgents: officeSnapshot → characters on the bundled four-room layout.
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
import type { OfficeAgent, Room } from '../../core/src/lan.ts';
import { setLang } from '../src/i18n.js';
import { LanAgents, tagText } from '../src/lan/lanAgents.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import { buildDynamicCatalog } from '../src/office/layout/furnitureCatalog.js';
import type { Character, OfficeLayout } from '../src/office/types.js';

const assetsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/assets');
const layout = JSON.parse(
  fs.readFileSync(path.join(assetsDir, 'default-layout-1.json'), 'utf-8'),
) as OfficeLayout;
const catalog = buildFurnitureCatalog(assetsDir);
buildDynamicCatalog({ catalog, sprites: decodeAllFurniture(assetsDir, catalog) });

const peer = { id: 'p1', nickname: 'kim', palette: 2, hueShift: 30 };

function agent(id: string, room: Room, extra: Partial<OfficeAgent> = {}): OfficeAgent {
  return {
    key: `p1:${id}`,
    peer,
    id,
    provider: 'claude',
    kind: 'main',
    num: 1,
    room,
    permission: false,
    act: 'idle',
    target: '',
    reason: '',
    ...extra,
  };
}

function child(id: string, parent: string, room: Room): OfficeAgent {
  return agent(id, room, { kind: 'subagent', num: 0, parentId: parent, parentKey: `p1:${parent}` });
}

/** Where the character is headed: its seat, else the end of its path, else where it stands. */
function target(os: OfficeState, ch: Character): { col: number; row: number } {
  const seat = ch.seatId ? os.seats.get(ch.seatId) : undefined;
  if (seat) return { col: seat.seatCol, row: seat.seatRow };
  return ch.path[ch.path.length - 1] ?? { col: ch.tileCol, row: ch.tileRow };
}

function areaOf(t: { col: number; row: number }): string | undefined {
  return layout.areaTiles?.[t.row * layout.cols + t.col] ?? undefined;
}

function setup() {
  const os = new OfficeState(structuredClone(layout));
  return { os, lan: new LanAgents(os) };
}

test('a main agent in coding is headed into 코딩실, then 대기실 when it moves', () => {
  const { os, lan } = setup();
  lan.apply([agent('a', 'coding')]);
  assert.equal(os.characters.size, 1);
  const id = lan.idFor('p1:a')!;
  const ch = os.characters.get(id)!;
  assert.equal(ch.homeArea, '코딩실');
  assert.equal(areaOf(target(os, ch)), '코딩실');
  if (ch.seatId) assert.equal(os.seatZone(ch.seatId), '코딩실');
  assert.equal(ch.palette, 2);
  assert.equal(ch.hueShift, 30);

  lan.apply([agent('a', 'lounge')]);
  assert.equal(lan.idFor('p1:a'), id);
  assert.equal(ch.homeArea, '대기실');
  assert.equal(areaOf(target(os, ch)), '대기실');
});

test('a changed peer look is applied to existing characters and ghosts', () => {
  const { os, lan } = setup();
  lan.apply([agent('a', 'coding'), child('c', 'a', 'server')]);
  const next = { ...peer, palette: 4, hueShift: 90 };
  lan.apply([agent('a', 'coding', { peer: next }), { ...child('c', 'a', 'server'), peer: next }]);
  const main = os.characters.get(lan.idFor('p1:a')!)!;
  assert.equal(main.palette, 4);
  assert.equal(main.hueShift, 90);
  const sub = os.characters.get(lan.idFor('p1:c')!)!;
  assert.equal(sub.palette, 4);
  assert.equal(sub.hueShift, (90 + 120) % 360);
  for (const g of ghosts(os)) assert.equal(g.palette, 4);
});

test('more lounge agents than lounge seats all land inside 대기실', () => {
  const { os, lan } = setup();
  let seats = 0;
  for (const uid of os.seats.keys()) if (os.seatZone(uid) === '대기실') seats++;
  const agents = Array.from({ length: seats + 5 }, (_, i) => agent(`m${i}`, 'lounge'));
  lan.apply(agents);
  assert.equal(os.characters.size, seats + 5);
  const standing = [...os.characters.values()].filter((c) => !c.seatId).length;
  assert.equal(standing, 5);
  for (const ch of os.characters.values()) {
    assert.equal(areaOf({ col: ch.tileCol, row: ch.tileRow }), '대기실');
    assert.equal(areaOf(target(os, ch)), '대기실');
  }
});

const ghosts = (os: OfficeState) =>
  [...os.characters.values()].filter(
    (c) => c.ghostOf !== undefined && c.matrixEffect !== 'despawn',
  );
const cheb = (a: Character, b: Character) =>
  Math.max(Math.abs(a.tileCol - b.tileCol), Math.abs(a.tileRow - b.tileRow));

test("a child in the parent's room follows the parent, with no ghost", () => {
  const { os, lan } = setup();
  lan.apply([agent('a', 'coding'), child('s1', 'a', 'coding')]);
  const s1 = os.characters.get(lan.idFor('p1:s1')!)!;
  assert.equal(s1.followId, lan.idFor('p1:a'));
  assert.equal(s1.seatId, null);
  assert.equal(
    areaOf({ col: s1.tileCol, row: s1.tileRow }),
    '코딩실',
    'materializes by the parent',
  );
  assert.equal(ghosts(os).length, 0);
});

test('a child in another room follows a ghost of the parent there; the ghost goes when it returns', () => {
  const { os, lan } = setup();
  lan.apply([agent('a', 'coding'), child('s1', 'a', 'library'), child('s2', 'a', 'library')]);
  const parent = os.characters.get(lan.idFor('p1:a')!)!;
  const s1 = os.characters.get(lan.idFor('p1:s1')!)!;
  const s2 = os.characters.get(lan.idFor('p1:s2')!)!;
  const [ghost, ...more] = ghosts(os);
  assert.equal(more.length, 0, 'one ghost per parent per room');
  assert.equal(ghost.ghostOf, parent.id);
  assert.equal(parent.ghostOf, undefined, 'the real parent stays opaque');
  assert.equal(areaOf(target(os, parent)), '코딩실');
  assert.equal(ghost.seatId, null);
  assert.equal(areaOf({ col: ghost.tileCol, row: ghost.tileRow }), '자료실');
  assert.equal([ghost.palette, ghost.hueShift].join(), [parent.palette, parent.hueShift].join());
  assert.equal(lan.agentFor(ghost.id)?.key, 'p1:a', 'hovering the ghost means the parent');
  assert.equal(s1.followId, ghost.id);
  assert.equal(s2.followId, ghost.id);

  for (let i = 0; i < 600; i++) os.update(0.05);
  assert.ok(cheb(s1, ghost) <= 1, `s1 holds the ghost's hand (${cheb(s1, ghost)})`);
  assert.ok(cheb(s2, s1) <= 1, `s2 holds s1's hand (${cheb(s2, s1)})`);
  assert.equal(areaOf({ col: s1.tileCol, row: s1.tileRow }), '자료실');

  lan.apply([agent('a', 'coding'), child('s1', 'a', 'coding'), child('s2', 'a', 'coding')]);
  assert.equal(ghosts(os).length, 0);
  assert.equal(s1.followId, parent.id);
});

test('followers line up beside a wandering parent, and its wander stays in the room', () => {
  const { os, lan } = setup();
  lan.apply([agent('a', 'lounge'), child('s1', 'a', 'lounge'), child('s2', 'a', 'lounge')]);
  for (let i = 0; i < 2000; i++) os.update(0.05);
  const p = os.characters.get(lan.idFor('p1:a')!)!;
  const s1 = os.characters.get(lan.idFor('p1:s1')!)!;
  const s2 = os.characters.get(lan.idFor('p1:s2')!)!;
  // Settle: let the parent stop, then let the line catch up.
  const wandered = new Set<string | undefined>();
  for (let i = 0; i < 400; i++) {
    if (i === 200) p.path = [];
    if (i >= 200) p.wanderTimer = 1;
    os.update(0.05);
    wandered.add(areaOf({ col: p.tileCol, row: p.tileRow }));
  }
  assert.deepEqual([...wandered], ['대기실']);
  assert.ok(cheb(s1, p) <= 1, `s1 next to parent (${cheb(s1, p)})`);
  assert.ok(cheb(s2, s1) <= 1, `s2 next to s1 (${cheb(s2, s1)})`);
  assert.equal(s1.seatId, null);
});

test('a vanished parent is removed; a ghost of it leads the child', () => {
  const { os, lan } = setup();
  lan.apply([agent('a', 'coding'), child('s1', 'a', 'coding')]);
  const parentId = lan.idFor('p1:a')!;
  lan.apply([child('s1', 'a', 'coding')]);
  assert.equal(lan.idFor('p1:a'), undefined);
  assert.equal(os.characters.get(parentId)!.matrixEffect, 'despawn');
  const s1 = os.characters.get(lan.idFor('p1:s1')!)!;
  const [ghost] = ghosts(os);
  assert.equal(ghost.ghostOf, ghost.id, 'no real parent to point at');
  assert.equal(s1.followId, ghost.id);
  assert.equal(areaOf({ col: ghost.tileCol, row: ghost.tileRow }), '코딩실');
  assert.equal(lan.agentFor(ghost.id), undefined);
  assert.equal(lan.all().length, 1);
});

test('re-applying the same snapshot keeps ids; a returning key gets a new id', () => {
  const { lan } = setup();
  const snap = [agent('a', 'coding'), agent('b', 'server', { permission: true })];
  lan.apply(snap);
  const ids = [lan.idFor('p1:a'), lan.idFor('p1:b')];
  lan.apply(snap);
  assert.deepEqual([lan.idFor('p1:a'), lan.idFor('p1:b')], ids);
  assert.equal(lan.agentFor(ids[1]!)?.key, 'p1:b');
  lan.apply([agent('a', 'coding')]);
  lan.apply(snap);
  assert.notEqual(lan.idFor('p1:b'), ids[1]);
});

test('permission toggles the bubble; subagent and shell looks', () => {
  const { os, lan } = setup();
  lan.apply([
    agent('a', 'server', { permission: true }),
    child('s', 'a', 'server'),
    agent('h', 'server', { kind: 'shell', num: 0, parentId: 'a', parentKey: 'p1:a' }),
  ]);
  const a = os.characters.get(lan.idFor('p1:a')!)!;
  assert.equal(a.bubbleType, 'permission');
  const s = os.characters.get(lan.idFor('p1:s')!)!;
  assert.equal(s.palette, 2);
  assert.equal(s.hueShift, 150);
  const h = os.characters.get(lan.idFor('p1:h')!)!;
  assert.equal(h.palette, 3);
  assert.equal(h.hueShift, 0);
  lan.apply([agent('a', 'server')]);
  assert.equal(a.bubbleType, null);
});

test('name tags: nickname · provider #n for mains, kind for children', () => {
  setLang('ko');
  assert.equal(tagText(agent('s1', 'coding', { num: 2 })), 'kim · Claude #2');
  assert.equal(tagText(agent('s2', 'coding', { provider: 'codex', num: 1 })), 'kim · Codex #1');
  assert.equal(tagText(child('s1/sub/a', 's1', 'coding')), '↳ 서브에이전트');
  assert.equal(tagText({ ...child('s1/sh/1', 's1', 'server'), kind: 'shell' }), '↳ 셸');
  const unnamed = agent('s3', 'coding', { num: 1 });
  assert.equal(
    tagText({ ...unnamed, peer: { ...unnamed.peer, nickname: '' } }),
    '이름없음 · Claude #1',
  );
});

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
import {
  LanAgents,
  plateText,
  roomCounts,
  tagBadge,
  tagText,
  wantedRoom,
} from '../src/lan/lanAgents.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import { buildDynamicCatalog } from '../src/office/layout/furnitureCatalog.js';
import type { Character, OfficeLayout } from '../src/office/types.js';

const assetsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/assets');
const layout = JSON.parse(
  fs.readFileSync(path.join(assetsDir, 'default-layout-1.json'), 'utf-8'),
) as OfficeLayout;
const catalog = buildFurnitureCatalog(assetsDir);
buildDynamicCatalog({ catalog, sprites: decodeAllFurniture(assetsDir, catalog) });

const peer = { id: 'p1', account: 'yoo', nickname: 'kim', palette: 2, hueShift: 30 };

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
  const clock = { now: 0 };
  return { os, lan: new LanAgents(os, () => clock.now), clock };
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

test('a pet profile: main, subagent (hue-offset) and ghost wear the pet; the shell stays human; switching back to the human', () => {
  const { os, lan } = setup();
  const pet = { ...peer, pet: 'gitcat' as const };
  const shell = (p: typeof peer) => ({
    ...agent('h', 'server', { kind: 'shell', num: 0, parentId: 'a', parentKey: 'p1:a' }),
    peer: p,
  });
  const snap = (p: typeof peer) => [
    agent('a', 'coding', { peer: p }),
    { ...child('c', 'a', 'server'), peer: p },
    shell(p),
  ];
  lan.apply(snap(pet));
  const main = os.characters.get(lan.idFor('p1:a')!)!;
  const sub = os.characters.get(lan.idFor('p1:c')!)!;
  const sh = os.characters.get(lan.idFor('p1:h')!)!;
  assert.equal(main.pet, 'gitcat');
  assert.equal(main.hueShift, 30);
  assert.equal(sub.pet, 'gitcat');
  assert.equal(sub.hueShift, 150);
  assert.equal(sh.pet, undefined, 'shells keep the shell look');
  const [ghost] = ghosts(os);
  assert.equal(ghost.pet, 'gitcat', 'the ghost parent is the pet too');

  lan.apply(snap(peer)); // profile switched back to the human
  assert.equal(main.pet, undefined);
  assert.equal(sub.pet, undefined);
  for (const g of ghosts(os)) assert.equal(g.pet, undefined);
  assert.equal(main.palette, 2);
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

test('nobody wanders: a parked lounge agent stays put, its followers line up beside it', () => {
  const { os, lan } = setup();
  lan.apply([agent('a', 'lounge'), child('s1', 'a', 'lounge'), child('s2', 'a', 'lounge')]);
  for (let i = 0; i < 2000; i++) os.update(0.05);
  const p = os.characters.get(lan.idFor('p1:a')!)!;
  const s1 = os.characters.get(lan.idFor('p1:s1')!)!;
  const s2 = os.characters.get(lan.idFor('p1:s2')!)!;
  const at = (c: { tileCol: number; tileRow: number }) => `${c.tileCol},${c.tileRow}`;
  const before = [p, s1, s2].map(at);
  // Five more simulated minutes: no stroll, nobody moves.
  for (let i = 0; i < 6000; i++) os.update(0.05);
  assert.deepEqual([p, s1, s2].map(at), before);
  assert.equal(p.path.length, 0);
  assert.equal(areaOf({ col: p.tileCol, row: p.tileRow }), '대기실');
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

test('name tags: account (nickname) · provider #n for mains, kind for children', () => {
  setLang('ko');
  assert.equal(tagText(agent('s1', 'coding', { num: 2 })), 'yoo (kim) · Claude #2');
  assert.equal(
    tagText(agent('s2', 'coding', { provider: 'codex', num: 1 })),
    'yoo (kim) · Codex #1',
  );
  // Children: the parent's full label, then a SUB / SHELL badge (no i18n).
  const parent = agent('s1', 'coding', { num: 3 });
  const sub = child('s1/sub/a', 's1', 'coding');
  const shell = { ...child('s1/sh/1', 's1', 'server'), kind: 'shell' as const };
  assert.equal(tagText(sub, parent), 'yoo (kim) · Claude #3');
  assert.equal(tagText(shell, parent), 'yoo (kim) · Claude #3');
  assert.equal(tagText(sub), 'yoo (kim) · Claude', 'parent not in view: no number');
  assert.equal(tagBadge(sub), 'SUB');
  assert.equal(tagBadge(shell), 'SHELL');
  assert.equal(tagBadge(parent), null);
  setLang('en');
  assert.equal(tagBadge(sub), 'SUB');
  assert.equal(tagText(sub, parent), 'yoo (kim) · Claude #3');
  setLang('ko');
  const unnamed = agent('s3', 'coding', { num: 1 });
  assert.equal(tagText({ ...unnamed, peer: { ...unnamed.peer, nickname: '' } }), 'yoo · Claude #1');
});

// ── A parent free to follow joins its children ──────────────────────────

const shell = (id: string, parent: string, room: Room): OfficeAgent => ({
  ...child(id, parent, room),
  kind: 'shell',
});
const delegating = (extra: Partial<OfficeAgent> = {}) =>
  agent('a', 'lounge', { act: 'delegate', target: 'x', ...extra });

test('wantedRoom: most children, then subagents before shells, then the earliest entry', () => {
  const since = (order: string[]) => (c: OfficeAgent) => order.indexOf(c.id);
  const p = delegating();
  assert.equal(wantedRoom(p, [], since([])), 'lounge');
  assert.equal(wantedRoom(p, [child('s', 'a', 'server')], since([])), 'server');
  const two = [shell('h1', 'a', 'coding'), shell('h2', 'a', 'coding'), child('s', 'a', 'server')];
  assert.equal(wantedRoom(p, two, since([])), 'coding', 'majority');
  const tie = [shell('h', 'a', 'coding'), child('s', 'a', 'server')];
  assert.equal(wantedRoom(p, tie, since(['h', 's'])), 'server', 'subagent beats shell');
  const subs = [child('s1', 'a', 'coding'), child('s2', 'a', 'server')];
  assert.equal(wantedRoom(p, subs, since(['s2', 's1'])), 'server', 'earliest entry');
  assert.equal(wantedRoom(p, subs, since(['s1', 's2'])), 'coding');
  assert.equal(
    wantedRoom(agent('a', 'lounge'), subs, since(['s1', 's2'])),
    'coding',
    'idle follows',
  );
  for (const busy of [
    agent('a', 'coding', { act: 'edit' }),
    agent('a', 'lounge', { act: 'ask' }),
    delegating({ permission: true }),
  ]) {
    assert.equal(wantedRoom(busy, subs, since([])), busy.room, `${busy.act} stays`);
  }
});

test('an idle/delegating parent walks to its children and leads them; no ghost there', () => {
  const { os, lan } = setup();
  lan.apply([delegating(), child('s1', 'a', 'server'), child('s2', 'a', 'server')]);
  const p = os.characters.get(lan.idFor('p1:a')!)!;
  const s1 = os.characters.get(lan.idFor('p1:s1')!)!;
  assert.equal(lan.displayRoom(lan.agentFor(p.id)!), 'server');
  assert.equal(p.homeArea, '서버실');
  assert.equal(p.seatId, null, 'stands with them, like a ghost would');
  assert.equal(p.ghostOf, undefined, 'opaque');
  assert.equal(ghosts(os).length, 0);
  assert.equal(s1.followId, p.id);
  assert.equal(lan.agentFor(p.id)!.act, 'delegate', 'hover shows its real state');
  for (let i = 0; i < 800; i++) os.update(0.05);
  assert.equal(areaOf({ col: p.tileCol, row: p.tileRow }), '서버실');
  assert.ok(cheb(s1, p) <= 1, `s1 holds the parent's hand (${cheb(s1, p)})`);
  // Room plates count it in 서버실, not 대기실.
  assert.deepEqual(os.roomCounts?.get('서버실'), { main: 1, extra: 2 });
  assert.deepEqual(os.roomCounts?.get('대기실'), { main: 0, extra: 0 });
});

test('children split: the parent joins the majority, a ghost leads the rest', () => {
  const { os, lan } = setup();
  lan.apply([
    delegating(),
    child('s1', 'a', 'library'),
    child('s2', 'a', 'library'),
    shell('h', 'a', 'server'),
  ]);
  const p = os.characters.get(lan.idFor('p1:a')!)!;
  assert.equal(p.homeArea, '자료실');
  const [ghost, ...more] = ghosts(os);
  assert.equal(more.length, 0);
  assert.equal(ghost.id, lan.ghostIdFor('p1:a', 'server'));
  assert.equal(os.characters.get(lan.idFor('p1:h')!)!.followId, ghost.id);
  assert.equal(os.characters.get(lan.idFor('p1:s1')!)!.followId, p.id);
});

test('a working or asking parent stays in its room; a ghost leads the children', () => {
  for (const parent of [
    agent('a', 'coding', { act: 'edit' }),
    agent('a', 'lounge', { act: 'ask' }),
    delegating({ permission: true }),
  ]) {
    const { os, lan } = setup();
    lan.apply([parent, child('s1', 'a', 'server')]);
    const p = os.characters.get(lan.idFor('p1:a')!)!;
    assert.equal(lan.displayRoom(parent), parent.room, parent.act);
    assert.equal(p.homeArea, ROOM_NAMES[parent.room]);
    assert.ok(lan.ghostIdFor('p1:a', 'server') !== undefined);
  }
});

const ROOM_NAMES: Record<Room, string> = {
  coding: '코딩실',
  library: '자료실',
  server: '서버실',
  lounge: '대기실',
};

test('display room changes are debounced: no flip-flop, back home once the children are gone', () => {
  const { os, lan, clock } = setup();
  lan.apply([delegating()]);
  const p = os.characters.get(lan.idFor('p1:a')!)!;
  assert.equal(p.homeArea, '대기실');
  // A subagent starts in 서버실: the parent goes only after the wish held 3 s.
  const snap = [delegating(), child('s1', 'a', 'server')];
  for (clock.now = 0; clock.now < 3000; clock.now += 1000) {
    lan.apply(snap);
    assert.equal(p.homeArea, '대기실', `still waiting at ${clock.now}`);
  }
  lan.apply(snap);
  assert.equal(p.homeArea, '서버실');
  // The child flickers away for a second and back: the parent stays put.
  clock.now += 1000;
  lan.apply([delegating()]);
  clock.now += 1000;
  lan.apply([delegating(), child('s1', 'a', 'server')]);
  assert.equal(p.homeArea, '서버실');
  // Gone for good: back to 대기실 3 s later.
  const t0 = clock.now + 1000;
  for (clock.now = t0; clock.now < t0 + 3000; clock.now += 1000) {
    lan.apply([delegating()]);
    assert.equal(p.homeArea, '서버실');
  }
  lan.apply([delegating()]);
  assert.equal(p.homeArea, '대기실');
  assert.equal(ghosts(os).length, 0);
});

test('starting own work or needing attention takes the parent back at once', () => {
  for (const next of [agent('a', 'coding', { act: 'edit' }), delegating({ permission: true })]) {
    const { os, lan, clock } = setup();
    lan.apply([delegating(), child('s1', 'a', 'server')]);
    const p = os.characters.get(lan.idFor('p1:a')!)!;
    assert.equal(p.homeArea, '서버실');
    clock.now += 100;
    lan.apply([next, child('s1', 'a', 'server')]);
    assert.equal(p.homeArea, ROOM_NAMES[next.room]);
    assert.ok(lan.ghostIdFor('p1:a', 'server') !== undefined, 'a ghost takes over');
  }
});

test('roomCounts and plateText: display rooms, children as +N, zero rooms shown', () => {
  const agents = [
    delegating(),
    agent('b', 'coding'),
    child('s1', 'a', 'server'),
    shell('h', 'a', 'server'),
    child('s2', 'b', 'coding'),
  ];
  const counts = roomCounts(agents, (a) => (a.id === 'a' ? 'server' : a.room));
  assert.deepEqual(Object.fromEntries(counts), {
    코딩실: { main: 1, extra: 1 },
    자료실: { main: 0, extra: 0 },
    서버실: { main: 1, extra: 2 },
    대기실: { main: 0, extra: 0 },
  });
  setLang('ko');
  assert.equal(plateText('코딩실', { main: 5, extra: 3 }), '코딩실 5 · +3');
  assert.equal(plateText('자료실', { main: 0, extra: 0 }), '자료실 0');
  assert.equal(plateText('서버실', undefined), '서버실');
  setLang('en');
  assert.equal(plateText('코딩실', { main: 5, extra: 3 }), 'Coding Room 5 · +3');
  setLang('ko');
});

test('a parent walking over takes the lead from its ghost on arrival (children wait, no back-and-forth)', () => {
  const { os, lan, clock } = setup();
  lan.apply([delegating()]);
  for (let i = 0; i < 40; i++) os.update(0.05);
  const snap = [delegating(), child('s1', 'a', 'server')];
  lan.apply(snap);
  const p = os.characters.get(lan.idFor('p1:a')!)!;
  const s1 = os.characters.get(lan.idFor('p1:s1')!)!;
  const ghostId = lan.ghostIdFor('p1:a', 'server')!;
  assert.equal(s1.followId, ghostId);
  let arrivedAt = -1;
  for (let sec = 1; sec <= 90 && arrivedAt < 0; sec++) {
    clock.now = sec * 1000;
    lan.apply(snap);
    for (let i = 0; i < 20; i++) os.update(0.05);
    if (p.homeArea === '서버실' && areaOf({ col: p.tileCol, row: p.tileRow }) !== '서버실') {
      assert.equal(s1.followId, ghostId, 'the ghost leads while the parent is on its way');
      assert.equal(
        areaOf({ col: s1.tileCol, row: s1.tileRow }),
        '서버실',
        'the child waits in its room',
      );
    }
    if (s1.followId === p.id) arrivedAt = sec;
  }
  assert.ok(arrivedAt > 0, 'the parent arrived and leads');
  assert.equal(ghosts(os).length, 0);
  // The parent walks on to its spot in the room (anywhere in it); the child follows.
  for (let i = 0; i < 1600; i++) os.update(0.05);
  assert.equal(p.path.length, 0);
  assert.ok(cheb(s1, p) <= 1, `hand in hand (${cheb(s1, p)})`);
  assert.equal(areaOf({ col: s1.tileCol, row: s1.tileRow }), '서버실');
});

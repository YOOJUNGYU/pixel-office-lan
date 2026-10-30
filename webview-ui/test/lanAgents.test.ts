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
import { LanAgents, plateText, roomCounts, tagBadge, tagLines } from '../src/lan/lanAgents.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import { buildDynamicCatalog } from '../src/office/layout/furnitureCatalog.js';
import type { Character, OfficeLayout } from '../src/office/types.js';
import { CharacterState, Direction } from '../src/office/types.js';

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

test('a changed peer look is applied to existing characters', () => {
  const { os, lan } = setup();
  lan.apply([agent('a', 'coding'), child('c', 'a', 'server')]);
  const next = { ...peer, palette: 4, hueShift: 90 };
  lan.apply([agent('a', 'coding', { peer: next }), { ...child('c', 'a', 'server'), peer: next }]);
  const main = os.characters.get(lan.idFor('p1:a')!)!;
  assert.equal(main.palette, 4);
  assert.equal(main.hueShift, 90);
  const sub = os.characters.get(lan.idFor('p1:c')!)!;
  assert.equal(sub.palette, 4);
  assert.equal(sub.hueShift, 90);
});

test('a pet profile: main, subagent and shell all wear the same pet; switching back to the human', () => {
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
  assert.equal(sub.hueShift, 30);
  assert.equal(sh.pet, 'gitcat', 'shells look like their main character');
  assert.equal(sh.hueShift, 30);

  lan.apply(snap(peer)); // profile switched back to the human
  assert.equal(main.pet, undefined);
  assert.equal(sub.pet, undefined);
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

const cheb = (a: Character, b: Character) =>
  Math.max(Math.abs(a.tileCol - b.tileCol), Math.abs(a.tileRow - b.tileRow));

test("a child in the parent's room follows the parent", () => {
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
});

test('a child in another room has no leader and no ghost exists; it follows once it joins the parent', () => {
  const { os, lan } = setup();
  lan.apply([agent('a', 'coding'), child('s1', 'a', 'library'), child('s2', 'a', 'library')]);
  const parent = os.characters.get(lan.idFor('p1:a')!)!;
  const s1 = os.characters.get(lan.idFor('p1:s1')!)!;
  const s2 = os.characters.get(lan.idFor('p1:s2')!)!;
  assert.equal(os.characters.size, 3, 'no ghost character');
  assert.equal(s1.followId, undefined);
  assert.equal(s2.followId, undefined);
  assert.equal(s1.homeArea, '자료실');
  assert.equal(areaOf(target(os, s1)), '자료실');
  assert.equal(areaOf(target(os, parent)), '코딩실');

  lan.apply([agent('a', 'coding'), child('s1', 'a', 'coding'), child('s2', 'a', 'library')]);
  assert.equal(s1.followId, parent.id);
  assert.equal(s2.followId, undefined);
  // And back: leaving the parent's room, the child takes a place in its own.
  lan.apply([agent('a', 'coding'), child('s1', 'a', 'server'), child('s2', 'a', 'library')]);
  assert.equal(s1.followId, undefined);
  assert.equal(s1.homeArea, '서버실');
  assert.equal(os.characters.size, 3);
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

test('a vanished parent is removed; the orphan acts on its own in its room', () => {
  const { os, lan } = setup();
  lan.apply([agent('a', 'coding'), child('s1', 'a', 'coding')]);
  const parentId = lan.idFor('p1:a')!;
  lan.apply([child('s1', 'a', 'coding')]);
  assert.equal(lan.idFor('p1:a'), undefined);
  assert.equal(os.characters.get(parentId)!.matrixEffect, 'despawn');
  const s1 = os.characters.get(lan.idFor('p1:s1')!)!;
  assert.equal(s1.followId, undefined);
  assert.equal(s1.homeArea, '코딩실');
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
  assert.equal(s.hueShift, 30, 'a subagent looks like its main character');
  const h = os.characters.get(lan.idFor('p1:h')!)!;
  assert.equal(h.palette, 2, 'a shell looks like its main character');
  assert.equal(h.hueShift, 30);
  lan.apply([agent('a', 'server')]);
  assert.equal(a.bubbleType, null);
});

test('name tags: two lines (nickname, else account / provider #n) for mains, kind for children (MAIN / SUB / SHELL badge)', () => {
  setLang('ko');
  assert.deepEqual(tagLines(agent('s1', 'coding', { num: 2 })), ['kim', 'Claude #2']);
  assert.deepEqual(tagLines(agent('s2', 'coding', { provider: 'codex', num: 1 })), [
    'kim',
    'Codex #1',
  ]);
  // Children: the parent's name, then a SUB / SHELL badge (no i18n).
  const parent = agent('s1', 'coding', { num: 3 });
  const sub = child('s1/sub/a', 's1', 'coding');
  const shell = { ...child('s1/sh/1', 's1', 'server'), kind: 'shell' as const };
  assert.deepEqual(tagLines(sub, parent), ['kim', 'Claude #3']);
  assert.deepEqual(tagLines(shell, parent), ['kim', 'Claude #3']);
  assert.deepEqual(tagLines(sub), ['kim', 'Claude'], 'parent not in view: no number');
  assert.equal(tagBadge(sub), 'SUB');
  assert.equal(tagBadge(shell), 'SHELL');
  assert.equal(tagBadge(parent), 'MAIN');
  setLang('en');
  assert.equal(tagBadge(sub), 'SUB');
  assert.deepEqual(tagLines(sub, parent), ['kim', 'Claude #3']);
  setLang('ko');
  const unnamed = agent('s3', 'coding', { num: 1 });
  assert.deepEqual(tagLines({ ...unnamed, peer: { ...unnamed.peer, nickname: '' } }), [
    'yoo',
    'Claude #1',
  ]);
});

// ── Room plates ─────────────────────────────────────────────────────────

const shell = (id: string, parent: string, room: Room): OfficeAgent => ({
  ...child(id, parent, room),
  kind: 'shell',
});

test('roomCounts and plateText: mains by their own room, children as +N, zero rooms shown', () => {
  const agents = [
    agent('a', 'lounge'),
    agent('b', 'coding'),
    child('s1', 'a', 'server'),
    shell('h', 'a', 'server'),
    child('s2', 'b', 'coding'),
  ];
  const counts = roomCounts(agents);
  assert.deepEqual(Object.fromEntries(counts), {
    코딩실: { main: 1, extra: 1 },
    자료실: { main: 0, extra: 0 },
    서버실: { main: 0, extra: 2 },
    대기실: { main: 1, extra: 0 },
  });
  setLang('ko');
  assert.equal(plateText('코딩실', { main: 5, extra: 3 }), '코딩실 5 · +3');
  assert.equal(plateText('자료실', { main: 0, extra: 0 }), '자료실 0');
  assert.equal(plateText('서버실', undefined), '서버실');
  setLang('en');
  assert.equal(plateText('코딩실', { main: 5, extra: 3 }), 'Coding Room 5 · +3');
  setLang('ko');
});

test('with its PC avatar present: lounge agents fold into it, "!" on the avatar, a working one steps out and merges back', () => {
  const os = new OfficeState(layout);
  const lan = new LanAgents(os);
  const me = {
    peerId: 'p1',
    account: 'yoo',
    nickname: 'kim',
    palette: 2,
    hueShift: 30,
    self: true,
  };
  const step = (secs: number) => {
    for (let t = 0; t < secs; t += 0.05) os.update(0.05);
  };
  lan.applyPeople([me]);
  step(2);
  const av = os.characters.get(os.myAvatarId!)!;

  lan.apply([agent('a', 'lounge', { act: 'ask', permission: true })]);
  const id = lan.idFor('p1:a')!;
  assert.equal(os.characters.has(id), false, 'a lounge agent has no character');
  assert.deepEqual([...lan.waitingPeers()], ['p1']);

  lan.apply([agent('a', 'coding', { act: 'edit', target: 'x.ts' })]);
  const ch = os.characters.get(id)!;
  assert.equal(ch.matrixEffect, null, 'steps out without the spawn effect');
  assert.deepEqual([ch.tileCol, ch.tileRow], [av.tileCol, av.tileRow], 'starts on the avatar');
  assert.equal(areaOf(target(os, ch)), '코딩실');
  assert.equal(lan.waitingPeers().size, 0);
  step(20);

  lan.apply([agent('a', 'lounge')]);
  assert.equal(ch.mergeInto, av.id);
  step(90); // the default office is 90 tiles wide
  assert.equal(os.characters.has(id), false, 'merged back into the avatar');
});

test('without an avatar (tour demos, older peers) lounge agents still show in the lounge', () => {
  const os = new OfficeState(layout);
  const lan = new LanAgents(os);
  lan.apply([agent('a', 'lounge')]);
  const ch = os.characters.get(lan.idFor('p1:a')!)!;
  assert.equal(areaOf(target(os, ch)), '대기실');
});

test('my avatar sits on a lounge chair it steps onto and stands up with the next step off it', () => {
  const os = new OfficeState(layout);
  const lan = new LanAgents(os);
  const moves: Array<[number, number, Direction]> = [];
  os.onAvatarMove = (c, r, d) => moves.push([c, r, d]);
  const steps: Array<[Direction, number, number]> = [
    [Direction.DOWN, 0, -1],
    [Direction.UP, 0, 1],
    [Direction.RIGHT, -1, 0],
    [Direction.LEFT, 1, 0],
  ];
  // A lounge chair with an open lounge floor tile next to it, and the key that steps onto it.
  let found:
    | {
        seat: { seatCol: number; seatRow: number; facingDir: Direction };
        from: { col: number; row: number };
        dir: Direction;
      }
    | undefined;
  for (const seat of os.seats.values()) {
    if (areaOf({ col: seat.seatCol, row: seat.seatRow }) !== '대기실') continue;
    const lounge = os.areaWalkable.get('대기실')!;
    for (const [dir, dc, dr] of steps) {
      const from = { col: seat.seatCol + dc, row: seat.seatRow + dr };
      if (lounge.some((t) => t.col === from.col && t.row === from.row)) found = { seat, from, dir };
    }
    if (found) break;
  }
  assert.ok(found, 'the default layout has a lounge chair beside open floor');
  const { seat, from, dir } = found;
  lan.applyPeople([
    {
      peerId: 'me',
      account: 'me',
      nickname: '',
      palette: 0,
      hueShift: 0,
      self: true,
      avatar: { ...from, dir: 'down' },
    },
  ]);
  const step = (secs: number) => {
    for (let t = 0; t < secs; t += 0.05) os.update(0.05);
  };
  step(2);
  const me = os.characters.get(os.myAvatarId!)!;
  assert.deepEqual([me.tileCol, me.tileRow], [from.col, from.row]);

  os.pressAvatar(dir);
  step(1); // still held: never stands up again by itself
  os.releaseAvatar();
  assert.deepEqual([me.tileCol, me.tileRow], [seat.seatCol, seat.seatRow]);
  assert.equal(me.state, CharacterState.TYPE, 'seated');
  assert.equal(me.dir, seat.facingDir);
  assert.deepEqual(moves.at(-1), [seat.seatCol, seat.seatRow, seat.facingDir]);
  assert.equal(os.nextFrameIn(0), Infinity, 'a seated avatar sleeps');

  const back = steps.find(([d]) => stepBack(d, dir))![0];
  os.pressAvatar(back);
  os.releaseAvatar();
  step(1);
  assert.deepEqual([me.tileCol, me.tileRow], [from.col, from.row], 'stood up back onto the floor');
  assert.equal(me.state, CharacterState.IDLE);
  assert.equal(me.seatId, null);

  // Someone else's spot on that chair: their avatar is shown seated there.
  lan.applyPeople([
    { peerId: 'me', account: 'me', nickname: '', palette: 0, hueShift: 0, self: true },
    {
      peerId: 'p',
      account: 'p',
      nickname: '',
      palette: 1,
      hueShift: 0,
      self: false,
      avatar: { col: seat.seatCol, row: seat.seatRow, dir: 'down' },
    },
  ]);
  const p = os.characters.get(lan.avatars().find((a) => a.peerId === 'p')!.id)!;
  assert.deepEqual(
    [p.tileCol, p.tileRow, p.state],
    [seat.seatCol, seat.seatRow, CharacterState.TYPE],
  );
});

/** `a` is the opposite of `b`. */
function stepBack(a: Direction, b: Direction): boolean {
  const opposite: Record<number, Direction> = {
    [Direction.UP]: Direction.DOWN,
    [Direction.DOWN]: Direction.UP,
    [Direction.LEFT]: Direction.RIGHT,
    [Direction.RIGHT]: Direction.LEFT,
  };
  return opposite[b] === a;
}

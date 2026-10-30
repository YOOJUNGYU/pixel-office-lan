import { describe, expect, it, vi } from 'vitest';

import { ROOM_DEFAULT_COLORS } from '../../core/src/lan.js';
import type { OfficePersonMessage } from '../../core/src/messages.js';
import { arrowDir, avatarDirName, LanAgents } from '../src/lan/lanAgents.js';
import { avatarLabel, disambiguate } from '../src/lan/nicknames.js';
import { tagVisible } from '../src/lan/tagVisibility.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import type { OfficeLayout } from '../src/office/types.js';
import { CharacterState, Direction, TileType } from '../src/office/types.js';

// 5×3, all floor but a wall at (2,1); the lounge but (3,0) and (4,0) (코딩실).
const W = TileType.WALL;
const F = TileType.FLOOR_1;
const layout = (): OfficeLayout =>
  ({
    version: 1,
    cols: 5,
    rows: 3,
    tiles: [F, F, F, F, F, F, F, W, F, F, F, F, F, F, F],
    furniture: [],
    areas: [
      { label: '코딩실', color: ROOM_DEFAULT_COLORS.coding },
      { label: '대기실', color: ROOM_DEFAULT_COLORS.lounge },
    ],
    areaTiles: ['대기실', '대기실', '대기실', '코딩실', '코딩실', ...Array(10).fill('대기실')],
  }) as unknown as OfficeLayout;

const person = (peerId: string, o: Partial<OfficePersonMessage> = {}): OfficePersonMessage => ({
  peerId,
  account: peerId,
  nickname: '',
  palette: 0,
  hueShift: 0,
  self: false,
  ...o,
});

/** Run the engine until nothing walks (spawn effect included). */
function settle(os: OfficeState, secs = 3): void {
  for (let t = 0; t < secs; t += 0.05) os.update(0.05);
}

describe('my avatar: arrow keys', () => {
  function mine(at: OfficePersonMessage['avatar'] = { col: 1, row: 1, dir: 'down' }) {
    const os = new OfficeState(layout());
    const lan = new LanAgents(os);
    const moves: Array<[number, number, string]> = [];
    os.onAvatarMove = (c, r, d) => moves.push([c, r, avatarDirName(d)]);
    lan.applyPeople([person('me', { self: true, avatar: at })]);
    settle(os);
    return { os, lan, ch: os.characters.get(os.myAvatarId!)!, moves };
  }

  it('one tile per tap with facing; walls block (turn only); reported for the server', () => {
    const { os, ch, moves } = mine();
    os.pressAvatar(Direction.UP);
    os.releaseAvatar(Direction.UP);
    expect(ch.state).toBe(CharacterState.WALK);
    settle(os);
    expect([ch.tileCol, ch.tileRow, ch.dir]).toEqual([1, 0, Direction.UP]);
    os.pressAvatar(Direction.DOWN);
    os.releaseAvatar();
    settle(os);
    expect([ch.tileCol, ch.tileRow]).toEqual([1, 1]);
    os.pressAvatar(Direction.RIGHT); // (2,1) is a wall: turn in place
    os.releaseAvatar();
    settle(os);
    expect([ch.tileCol, ch.tileRow, ch.dir]).toEqual([1, 1, Direction.RIGHT]);
    os.pressAvatar(Direction.RIGHT); // already facing it: nothing to report
    os.releaseAvatar();
    expect(moves).toEqual([
      [1, 0, 'up'],
      [1, 1, 'down'],
      [1, 1, 'right'],
    ]);
  });

  it('holding keeps walking at walk speed until the edge; other characters never block', () => {
    const { os, lan, ch } = mine({ col: 0, row: 2, dir: 'right' });
    lan.applyPeople([
      person('me', { self: true, avatar: { col: 0, row: 2, dir: 'right' } }),
      person('p', { avatar: { col: 2, row: 2, dir: 'down' } }),
    ]);
    settle(os);
    os.pressAvatar(Direction.RIGHT);
    expect(os.nextFrameIn(0)).toBe(0);
    settle(os, 0.5); // 48 px/s = 3 tiles/s
    expect(ch.tileCol).toBeLessThanOrEqual(2);
    settle(os, 3);
    expect([ch.tileCol, ch.tileRow]).toEqual([4, 2]); // walked through p, stopped at the edge
    os.releaseAvatar(Direction.RIGHT);
    settle(os);
    expect(ch.state).toBe(CharacterState.IDLE);
    expect(os.nextFrameIn(0)).toBe(Infinity);
  });

  it('walks into other rooms too', () => {
    const { os, ch, moves } = mine({ col: 2, row: 0, dir: 'down' });
    os.pressAvatar(Direction.RIGHT);
    os.releaseAvatar();
    settle(os);
    expect([ch.tileCol, ch.tileRow, ch.dir]).toEqual([3, 0, Direction.RIGHT]);
    expect(moves).toEqual([[3, 0, 'right']]);
  });

  it('avatars are not hit-testable (clicks pass to agents/floor)', () => {
    const { os, ch } = mine();
    expect(os.getCharacterAt(ch.x, ch.y - 4)).toBeNull();
  });

  it('arrow keys map to facings; other keys do not', () => {
    expect(arrowDir('ArrowUp')).toBe(Direction.UP);
    expect(arrowDir('ArrowLeft')).toBe(Direction.LEFT);
    expect(arrowDir('Enter')).toBeUndefined();
    expect(arrowDir('constructor')).toBeUndefined();
  });
});

describe('avatars from the snapshot', () => {
  it('no spot → a free lounge tile, saved back; an unwalkable spot → the closest walkable one', () => {
    const os = new OfficeState(layout());
    const lan = new LanAgents(os);
    const placed = vi.fn();
    lan.onSelfPlaced = placed;
    lan.applyPeople([
      person('me', { self: true }),
      person('p', { avatar: { col: 2, row: 1, dir: 'up' } }),
    ]);
    const me = os.characters.get(os.myAvatarId!)!;
    expect(me.tileCol < 3 || me.tileRow > 0).toBe(true); // in the lounge
    expect(placed).toHaveBeenCalledWith(me.tileCol, me.tileRow, Direction.DOWN);
    const p = os.characters.get(lan.avatars().find((a) => a.peerId === 'p')!.id)!;
    expect(Math.abs(p.tileCol - 2) + Math.abs(p.tileRow - 1)).toBe(1);
  });

  it('a remote avatar walks to its latest spot, faces its dir; far → teleport; peer coords clamped', () => {
    const os = new OfficeState(layout());
    const lan = new LanAgents(os);
    lan.applyPeople([person('p', { avatar: { col: 0, row: 0, dir: 'down' } })]);
    settle(os);
    const ch = os.characters.get(lan.avatars()[0].id)!;
    lan.applyPeople([person('p', { avatar: { col: 4, row: 1, dir: 'left' } })]);
    expect(ch.state).toBe(CharacterState.WALK);
    settle(os);
    expect([ch.tileCol, ch.tileRow, ch.dir]).toEqual([4, 1, Direction.LEFT]);
    // Hostile coords: clamped into the grid limits, then onto this layout's closest walkable tile.
    lan.applyPeople([person('p', { avatar: { col: 1e9, row: -5, dir: 'up' } as never })]);
    settle(os);
    expect([ch.tileCol, ch.tileRow]).toEqual([4, 0]);
    lan.applyPeople([person('p', { avatar: { col: 0, row: 2, dir: 'sideways' } as never })]);
    settle(os);
    expect([ch.tileCol, ch.tileRow]).toEqual([4, 0]); // a bad dir = no avatar info: stays
  });

  it('my own spot is not pulled back by later snapshots; a gone person loses the avatar', () => {
    const os = new OfficeState(layout());
    const lan = new LanAgents(os);
    lan.applyPeople([person('me', { self: true, avatar: { col: 0, row: 0, dir: 'down' } })]);
    settle(os);
    os.pressAvatar(Direction.RIGHT);
    os.releaseAvatar();
    settle(os);
    lan.applyPeople([person('me', { self: true, avatar: { col: 0, row: 0, dir: 'down' } })]);
    settle(os);
    const me = os.characters.get(os.myAvatarId!)!;
    expect(me.tileCol).toBe(1);
    lan.applyPeople([]);
    expect(lan.avatars()).toEqual([]);
    expect(os.myAvatarId).toBeNull();
  });
});

describe('name tags', () => {
  it('avatar tag: nickname alone when set, else the account (tie-broken nickname kept)', () => {
    expect(avatarLabel({ account: 'yoojungyu', nickname: '' })).toBe('yoojungyu');
    expect(avatarLabel({ account: 'yoojungyu', nickname: '정규' })).toBe('정규');
    const { people } = disambiguate(
      [
        person('aaaa1', { nickname: 'kim', nickSince: 1, self: true }),
        person('bbbb2', { nickname: 'kim', nickSince: 2 }),
      ],
      [],
    );
    expect(people.map(avatarLabel)).toEqual(['kim', 'kim · bbbb']);
  });

  it('the toggle hides agent tags only; avatar tags always show', () => {
    expect(tagVisible(true, 1, null, null)).toBe(false);
    expect(tagVisible(true, 1, null, null, true)).toBe(true);
    expect(tagVisible(false, 1, null, null, true)).toBe(true);
  });
});

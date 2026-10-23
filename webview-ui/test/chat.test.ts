import { describe, expect, it } from 'vitest';

import type { OfficePersonMessage } from '../../core/src/messages.js';
import { ChatBubbles, isTextEntry, pointerTile, stackBubbles, wrapLines } from '../src/lan/chat.js';
import { overlayProjection } from '../src/office/projection.js';
import { TILE_SIZE } from '../src/office/types.js';

const person = (
  peerId: string,
  chat?: OfficePersonMessage['chat'],
  self = false,
): OfficePersonMessage => ({
  peerId,
  account: peerId,
  nickname: 'nick',
  palette: 0,
  hueShift: 0,
  self,
  ...(chat && { chat }),
});
const msg = (o: Partial<NonNullable<OfficePersonMessage['chat']>> = {}) => ({
  id: 'abcd1234',
  text: 'hello',
  col: 5,
  row: 6.5,
  ...o,
});

describe('ChatBubbles', () => {
  it('one bubble per person from the snapshot; no expiry; a new id replaces, a missing chat removes', () => {
    const c = new ChatBubbles();
    c.apply([person('me', msg({ text: 'mine' }), true), person('p', msg())]);
    expect(c.active()).toMatchObject([
      { peerId: 'me', text: 'mine', self: true },
      {
        peerId: 'p',
        id: 'abcd1234',
        text: 'hello',
        label: 'p (nick)',
        col: 5,
        row: 6.5,
        self: false,
      },
    ]);
    c.apply([person('p', msg())]); // later snapshots: still there (no timer)
    expect(c.active()).toHaveLength(1);
    c.apply([person('p', msg({ id: 'next0001', text: 'moved', col: 9 }))]);
    expect(c.active()).toMatchObject([{ id: 'next0001', text: 'moved', col: 9 }]);
    c.apply([person('p')]); // deleted
    expect(c.active()).toEqual([]);
    c.apply([person('p', msg())]);
    c.apply([]); // went offline
    expect(c.active()).toEqual([]);
  });

  it('sanitises received text and clamps the spot; drops unusable chats', () => {
    const c = new ChatBubbles();
    c.apply([
      person('a', msg({ text: 'x‮y\nz', col: -3, row: 1e9 })),
      person('b', msg({ text: '​' })),
      person('c', msg({ col: Number.NaN })),
    ]);
    expect(c.active()).toMatchObject([{ peerId: 'a', text: 'xy z', col: 0, row: 127 }]);
  });

  it('say: cleaned text, nothing shown locally; 1 per 2 s', () => {
    const c = new ChatBubbles();
    expect(c.say('  hi ', 0)).toBe('hi');
    expect(c.active()).toEqual([]);
    expect(c.say('again', 1999)).toBeNull();
    expect(c.say('\u0007', 5000)).toBeNull();
    expect(c.say('ok', 2000)).toBe('ok');
  });
});

describe('chat geometry', () => {
  const layout = { cols: 20, rows: 10 };
  const rect = { width: 800, height: 600 };

  it('pointerTile inverts the projection (any pan/zoom/dpr) and clamps to the grid', () => {
    for (const [zoom, pan, dpr] of [
      [1, { x: 0, y: 0 }, 1],
      [2.5, { x: 37, y: -12 }, 2],
      [0.5, { x: -100, y: 40 }, 1.25],
    ] as const) {
      const p = overlayProjection(layout, rect, zoom, pan, dpr);
      const t = pointerTile(p, p.toScreenX(3.25 * TILE_SIZE), p.toScreenY(7.5 * TILE_SIZE), layout);
      expect(t.col).toBeCloseTo(3.25);
      expect(t.row).toBeCloseTo(7.5);
      expect(pointerTile(p, -1e6, 1e6, layout)).toEqual({ col: 0, row: 10 });
    }
  });

  it('a spot keeps its world tile across pan/zoom: only its screen point moves', () => {
    const a = overlayProjection(layout, rect, 2, { x: 0, y: 0 }, 1);
    const spot = pointerTile(a, 300, 200, layout);
    const b = overlayProjection(layout, rect, 3, { x: 70, y: -20 }, 1);
    const sx = b.toScreenX(spot.col * TILE_SIZE);
    const sy = b.toScreenY(spot.row * TILE_SIZE);
    expect(sx).not.toBeCloseTo(300);
    const back = pointerTile(b, sx, sy, layout);
    expect(back.col).toBeCloseTo(spot.col);
    expect(back.row).toBeCloseTo(spot.row);
  });

  it('wrapLines: greedy by word, long words broken anywhere', () => {
    const m = (s: string) => s.length * 10;
    expect(wrapLines('aa bb cc', 50, m)).toEqual(['aa bb', 'cc']);
    expect(wrapLines('abcdefghij', 40, m)).toEqual(['abcd', 'efgh', 'ij']);
    expect(wrapLines('', 40, m)).toEqual(['']);
  });

  it('stackBubbles: separate ones stay; overlapping ones move up, never overlap', () => {
    expect(
      stackBubbles(
        [
          { x: 0, bottom: 100, w: 50, h: 30 },
          { x: 200, bottom: 100, w: 50, h: 30 },
        ],
        4,
      ),
    ).toEqual([100, 100]);
    const boxes = [
      { x: 0, bottom: 100, w: 80, h: 30 },
      { x: 10, bottom: 105, w: 80, h: 30 },
      { x: 20, bottom: 95, w: 80, h: 40 },
    ];
    const b = stackBubbles(boxes, 4);
    expect(b[1]).toBe(105); // lowest keeps its place
    const spans = b.map((bottom, i) => [bottom - boxes[i].h, bottom]).sort((x, y) => x[0] - y[0]);
    for (let i = 1; i < spans.length; i++)
      expect(spans[i][0]).toBeGreaterThanOrEqual(spans[i - 1][1] + 4);
  });

  it('isTextEntry: inputs, textareas, selects, contenteditable', () => {
    expect(isTextEntry({ tagName: 'INPUT' })).toBe(true);
    expect(isTextEntry({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isTextEntry({ tagName: 'BUTTON' })).toBe(false);
    expect(isTextEntry(null)).toBe(false);
  });
});

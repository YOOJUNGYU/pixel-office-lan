/* eslint-disable pixel-agents/no-inline-colors -- test fixtures */
import { describe, expect, it } from 'vitest';

import type { AgentView, PeerPacket } from '../../../core/src/lan.js';
import { MAX_PACKET_BYTES, parsePeerPacket } from '../../../core/src/lan.js';

const view = (over: Partial<AgentView> = {}): AgentView => ({
  id: 's1',
  provider: 'claude',
  kind: 'main',
  num: 1,
  room: 'coding',
  permission: false,
  act: 'edit',
  target: 'a.ts',
  reason: '',
  ...over,
});
const packet = (over: Partial<PeerPacket> = {}): PeerPacket => ({
  v: 1,
  peer: { id: 'peer-1', account: 'kim.j', nickname: 'kim', palette: 2, hueShift: 90 },
  views: [view(), view({ id: 's1/sub/a', kind: 'subagent', num: 0, parentId: 's1' })],
  ...over,
});
const parse = (p: unknown) => parsePeerPacket(JSON.stringify(p));

describe('parsePeerPacket', () => {
  it('hidden: only true survives', () => {
    expect(parse(packet({ views: [{ ...view(), hidden: true }] }))?.views[0].hidden).toBe(true);
    const bad = { ...view(), hidden: 'yes' };
    expect(
      parse(packet({ views: [bad as unknown as AgentView] }))?.views[0].hidden,
    ).toBeUndefined();
  });

  it('account: validated; a 0.3.x packet without one: nickname (or short id) becomes the account, nickname cleared', () => {
    const { account: _, ...old } = packet().peer;
    expect(parse(packet({ peer: old as never }))?.peer).toMatchObject({
      account: 'kim',
      nickname: '',
    });
    expect(parse(packet({ peer: { ...old, nickname: '' } as never }))?.peer.account).toBe('peer');
    expect(
      parse(packet({ peer: { ...old, account: '😀'.repeat(32) } as never }))?.peer.account,
    ).toBe('😀'.repeat(32)); // 32 code points fit
    expect(
      parse(packet({ peer: { ...old, account: 'x'.repeat(33) } as never }))?.peer.account,
    ).toBe('kim');
    expect(parse(packet({ peer: { ...old, account: 'a\nb' } as never }))?.peer.account).toBe('kim');
    expect(parse(packet({ peer: { ...old, account: ' yoo ' } as never }))?.peer.account).toBe(
      'yoo',
    );
  });

  it('nickname: control/bidi/format chars stripped; nickSince kept only when a safe integer >= 0', () => {
    const peer = packet().peer;
    expect(parse(packet({ peer: { ...peer, nickname: ' k\u202eim\u0007 ' } }))?.peer.nickname).toBe(
      'kim',
    );
    expect(parse(packet({ peer: { ...peer, nickSince: 5 } }))?.peer.nickSince).toBe(5);
    for (const bad of [-1, 1.5, 'x', Number.MAX_SAFE_INTEGER + 2, null]) {
      expect(
        parse(packet({ peer: { ...peer, nickSince: bad as never } }))?.peer,
      ).not.toHaveProperty('nickSince');
    }
  });

  it('pet: optional, one of the bundled ids; anything else is dropped (the palette human shows)', () => {
    const peer = packet().peer;
    expect(parse(packet())?.peer).not.toHaveProperty('pet');
    expect(parse(packet({ peer: { ...peer, pet: 'gitcat' } }))?.peer.pet).toBe('gitcat');
    expect(parse(packet({ peer: { ...peer, pet: 'claudio' } }))?.peer.pet).toBe('claudio');
    for (const bad of ['dragon', '', 1, null, { id: 'gitcat' }]) {
      const out = parse(packet({ peer: { ...peer, pet: bad as never } }));
      expect(out?.peer).not.toHaveProperty('pet');
      expect(out?.peer.palette).toBe(2);
    }
  });

  it('tagColors: optional pair of hex colours; anything else is dropped', () => {
    const peer = packet().peer;
    expect(parse(packet())?.peer).not.toHaveProperty('tagColors');
    expect(
      parse(packet({ peer: { ...peer, tagColors: { bg: '#abcdef', fg: '#000000' } } }))?.peer
        .tagColors,
    ).toEqual({ bg: '#ABCDEF', fg: '#000000' });
    for (const bad of [{ bg: 'url(x)', fg: '#000000' }, { bg: '#abcdef' }, 'x', 1]) {
      expect(
        parse(packet({ peer: { ...peer, tagColors: bad as never } }))?.peer,
      ).not.toHaveProperty('tagColors');
    }
  });

  it('round-trips a valid packet', () => {
    const p = packet();
    expect(parse(p)).toEqual(p);
  });

  it('rejects invalid structure and values', () => {
    expect(parse({ ...packet(), v: 2 })).toBeNull();
    expect(parse({ ...packet(), views: 'x' })).toBeNull();
    expect(parse(packet({ views: [view({ room: 'kitchen' as never })] }))).toBeNull();
    expect(parse(packet({ views: [view({ act: 'dance' as never })] }))).toBeNull();
    expect(parse(packet({ views: [view({ target: 5 as never })] }))).toBeNull();
    expect(parse(packet({ peer: { ...packet().peer, palette: 9 } }))).toBeNull();
    expect(parse(packet({ peer: { ...packet().peer, hueShift: 400 } }))).toBeNull();
    expect(parse(packet({ peer: { ...packet().peer, palette: 1.5 } }))).toBeNull();
    expect(parse(packet({ peer: { ...packet().peer, id: '' } }))).toBeNull();
    expect(parse(null)).toBeNull();
    expect(parse([])).toBeNull();
    expect(parse(5)).toBeNull();
    expect(parsePeerPacket('x'.repeat(MAX_PACKET_BYTES + 1))).toBeNull();
  });

  it('truncates strings and caps views', () => {
    const p = parse(
      packet({
        peer: { ...packet().peer, nickname: 'n'.repeat(30) },
        views: [view({ target: 's'.repeat(500), reason: 'r'.repeat(500) })],
      }),
    )!;
    expect(p.peer.nickname).toHaveLength(20);
    expect(p.views[0].target).toHaveLength(120);
    expect(p.views[0].reason).toHaveLength(200);
    const many = parse(
      packet({ views: Array.from({ length: 80 }, (_, i) => view({ id: `s${i}` })) }),
    )!;
    expect(many.views.map((v) => v.id)).toEqual(Array.from({ length: 50 }, (_, i) => `s${i}`));
  });

  it('keeps html-looking nickname verbatim and drops unknown fields', () => {
    const nick = '<b onload=alert(1)>';
    const raw = packet({ peer: { ...packet().peer, nickname: nick } }) as unknown as {
      views: Record<string, unknown>[];
    };
    raw.views[0].evil = 1;
    const p = parse(raw)!;
    expect(p.peer.nickname).toBe(nick);
    expect(p.views[0]).not.toHaveProperty('evil');
  });

  it('never throws on garbage', () => {
    expect(parsePeerPacket('{nope')).toBeNull();
    expect(parsePeerPacket('')).toBeNull();
  });
});

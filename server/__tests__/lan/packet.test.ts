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
  summary: 'working',
  reason: '',
  ...over,
});
const packet = (over: Partial<PeerPacket> = {}): PeerPacket => ({
  v: 1,
  peer: { id: 'peer-1', nickname: 'kim', palette: 2, hueShift: 90 },
  views: [view(), view({ id: 's1/sub/a', kind: 'subagent', num: 0, parentId: 's1' })],
  ...over,
});
const parse = (p: unknown) => parsePeerPacket(JSON.stringify(p));

describe('parsePeerPacket', () => {
  it('round-trips a valid packet', () => {
    const p = packet();
    expect(parse(p)).toEqual(p);
  });

  it('rejects invalid structure and values', () => {
    expect(parse({ ...packet(), v: 2 })).toBeNull();
    expect(parse({ ...packet(), views: 'x' })).toBeNull();
    expect(parse(packet({ views: [view({ room: 'kitchen' as never })] }))).toBeNull();
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
        views: [view({ summary: 's'.repeat(500), reason: 'r'.repeat(500) })],
      }),
    )!;
    expect(p.peer.nickname).toHaveLength(20);
    expect(p.views[0].summary).toHaveLength(120);
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

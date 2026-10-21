import * as dgram from 'dgram';
import { afterEach, describe, expect, it } from 'vitest';

import type { PeerPacket } from '../../../core/src/lan.js';
import { MAX_PACKET_BYTES } from '../../../core/src/lan.js';
import { broadcastAddresses, fitPacket, PEER_TTL_MS, PeerNet } from '../../src/lan/peerNet.js';

const pkt = (id: string): PeerPacket => ({
  v: 1,
  peer: { id, nickname: id, palette: 0, hueShift: 0 },
  views: [],
});
const freePort = (): Promise<number> =>
  new Promise((res) => {
    const s = dgram.createSocket('udp4');
    s.bind(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
const until = async (f: () => boolean) => {
  for (let i = 0; i < 100 && !f(); i++) await new Promise((r) => setTimeout(r, 20));
};

const nets: PeerNet[] = [];
afterEach(() => nets.splice(0).forEach((n) => n.stop()));

describe('PeerNet', () => {
  it('exchanges packets, ignores self, garbage and expires', async () => {
    const [pa, pb] = [await freePort(), await freePort()];
    let t = 1000;
    const mk = (id: string, port: number, other: number, clock?: () => number) => {
      const n = new PeerNet({
        port,
        selfId: id,
        getPacket: () => pkt(id),
        manualPeers: () => [],
        targets: () => [`127.0.0.1:${other}`, `127.0.0.1:${port}`], // second = self, must be ignored
        now: clock,
      });
      nets.push(n);
      return n;
    };
    const a = mk('A', pa, pb, () => t);
    const b = mk('B', pb, pa);
    await a.start();
    await b.start();
    a.sendNow();
    b.sendNow();
    await until(() => a.peers().length > 0 && b.peers().length > 0);
    expect(a.peers().map((p) => p.peer.id)).toEqual(['B']);
    expect(b.peers().map((p) => p.peer.id)).toEqual(['A']);

    const raw = dgram.createSocket('udp4');
    raw.send(Buffer.from([0xff, 0xfe, 0x00, 0x7b]), pa, '127.0.0.1');
    await new Promise((r) => setTimeout(r, 50));
    raw.close();
    expect(a.peers()).toHaveLength(1);

    t += PEER_TTL_MS + 1;
    expect(a.peers()).toEqual([]);
  });
});

describe('broadcastAddresses', () => {
  it('computes directed broadcast and skips internal', () => {
    const r = broadcastAddresses({
      eth0: [
        {
          family: 'IPv4',
          address: '192.168.0.10',
          netmask: '255.255.255.0',
          mac: '00:00:00:00:00:00',
          cidr: null,
          internal: false,
        },
      ],
      lo: [
        {
          family: 'IPv4',
          address: '127.0.0.1',
          netmask: '255.0.0.0',
          mac: '00:00:00:00:00:00',
          cidr: null,
          internal: true,
        },
      ],
    } as ReturnType<typeof import('os').networkInterfaces>);
    expect(r).toContain('192.168.0.255');
    expect(r).toContain('255.255.255.255');
    expect(r).not.toContain('127.255.255.255');
  });
});

describe('fitPacket', () => {
  const view = (i: number) => ({
    id: `s${i}`,
    provider: 'claude' as const,
    kind: 'main' as const,
    num: i,
    room: 'coding' as const,
    permission: false,
    summary: 'x'.repeat(120),
    reason: 'y'.repeat(200),
  });
  it('drops trailing views to fit, leaves small packets alone', () => {
    const small = { ...pkt('A'), views: [view(1)] };
    expect(fitPacket(small)).toEqual(small);
    const big = { ...pkt('A'), views: Array.from({ length: 300 }, (_, i) => view(i)) };
    const r = fitPacket(big);
    expect(r.views.length).toBeLessThan(300);
    expect(r.views[0].id).toBe('s0');
    expect(Buffer.byteLength(JSON.stringify(r))).toBeLessThanOrEqual(MAX_PACKET_BYTES);
  });
});

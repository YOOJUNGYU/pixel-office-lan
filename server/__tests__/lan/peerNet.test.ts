import * as dgram from 'dgram';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PeerPacket } from '../../../core/src/lan.js';
import { MAX_PACKET_BYTES, PUBLIC_VIEW } from '../../../core/src/lan.js';
import { PACKET_PLAINTEXT_BUDGET } from '../../src/constants.js';
import type { Identity } from '../../src/lan/crypto.js';
import {
  createIdentity,
  newInviteCode,
  pairKey,
  parseWire,
  pubAad,
  seal,
  teamAad,
  teamKey,
  teamTag,
} from '../../src/lan/crypto.js';
import type { TeamChannel } from '../../src/lan/peerNet.js';
import { broadcastAddresses, fitPacket, PEER_TTL_MS, PeerNet } from '../../src/lan/peerNet.js';

const pkt = (id: string, nickname = id): PeerPacket => ({
  v: 1,
  peer: { id, nickname, palette: 0, hueShift: 0 },
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (f: () => boolean) => {
  for (let i = 0; i < 100 && !f(); i++) await sleep(20);
};
const ids = (ps: PeerPacket[]) => ps.map((p) => p.peer.id).sort();
const nick = (ps: PeerPacket[], id: string) => ps.find((p) => p.peer.id === id)?.peer.nickname;
const channel = (secret: Buffer, name = 'team'): TeamChannel => {
  const key = teamKey(secret);
  return { tag: teamTag(key), key, name };
};

const nets: PeerNet[] = [];
const raws: dgram.Socket[] = [];
afterEach(() => {
  nets.splice(0).forEach((n) => n.stop());
  raws.splice(0).forEach((r) => r.close());
  vi.restoreAllMocks();
});

/** All instances "broadcast" to every port in `ports` (loopback stand-in for the LAN). */
interface Node {
  net: PeerNet;
  id: Identity;
  offices: TeamChannel[];
  t: number;
  nickname: string;
  port: number;
}
async function mkNodes(names: string[], extraTargets: string[] = []): Promise<Node[]> {
  const ports = await Promise.all(names.map(() => freePort()));
  const targets = [...ports.map((p) => `127.0.0.1:${p}`), ...extraTargets];
  const nodes: Node[] = [];
  for (const [i, name] of names.entries()) {
    const node = {
      id: createIdentity(name),
      offices: [],
      t: 1000,
      nickname: name,
      port: ports[i],
    } as Partial<Node> as Node;
    node.net = new PeerNet({
      port: ports[i],
      identity: node.id,
      getPacket: () => pkt(node.id.id, node.nickname),
      manualPeers: () => [],
      offices: () => node.offices,
      pins: new Map<string, string>(),
      targets: () => targets,
      now: () => node.t,
    });
    nets.push(node.net);
    await node.net.start();
    nodes.push(node);
  }
  return nodes;
}
/** Send rounds from every node until f() holds (or ~2 s). */
const pump = async (nodes: Node[], f: () => boolean = () => false, rounds = 100) => {
  for (let i = 0; i < rounds && !f(); i++) {
    nodes.forEach((n) => n.net.sendNow());
    await sleep(20);
  }
};
/** A raw UDP socket that records what it receives. */
async function rawSocket(): Promise<{ sock: dgram.Socket; port: number; got: string[] }> {
  const sock = dgram.createSocket('udp4');
  raws.push(sock);
  const got: string[] = [];
  sock.on('message', (m) => got.push(m.toString('utf8')));
  await new Promise<void>((r) => sock.bind(0, '127.0.0.1', () => r()));
  return { sock, port: sock.address().port, got };
}

describe('PeerNet public office', () => {
  it('exchanges hello + encrypted pub and sees each other; expires after TTL', async () => {
    const [a, b] = await mkNodes(['A', 'B']);
    await pump(
      [a, b],
      () => a.net.peers(PUBLIC_VIEW).length > 0 && b.net.peers(PUBLIC_VIEW).length > 0,
    );
    expect(ids(a.net.peers(PUBLIC_VIEW))).toEqual(['B']);
    expect(ids(b.net.peers(PUBLIC_VIEW))).toEqual(['A']);
    a.t += PEER_TTL_MS + 1;
    expect(a.net.peers(PUBLIC_VIEW)).toEqual([]);
  });

  it('pins the first key per id: an impostor claiming A is dropped and warned once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const [a, b, c] = await mkNodes(['A', 'B', 'C']);
    a.nickname = 'real';
    await pump([a, b], () => nick(b.net.peers(PUBLIC_VIEW), 'A') === 'real');
    // C now claims to be A with its own key pair
    c.id.id = 'A';
    c.nickname = 'fake';
    await pump([a, b, c], () => false, 15);
    expect(nick(b.net.peers(PUBLIC_VIEW), 'A')).toBe('real');
    const pinWarnings = warn.mock.calls.filter((x) => String(x[0]).includes('PC A '));
    expect(pinWarnings.length).toBeGreaterThan(0);
    expect(new Set(pinWarnings.map((x) => x[0])).size).toBe(1);
    // one warning per receiver (B and C both pinned A), never per datagram
    expect(pinWarnings.length).toBeLessThanOrEqual(2);
  });

  it('drops replayed, forged and malformed datagrams without state change', async () => {
    const [a] = await mkNodes(['A']);
    const x = createIdentity('X');
    const raw = await rawSocket();
    const { port } = a;
    const send = (o: unknown) =>
      new Promise<void>((r) =>
        raw.sock.send(typeof o === 'string' ? o : JSON.stringify(o), port, '127.0.0.1', () => r()),
      );
    const key = pairKey(x.privateKeyPem, a.id.publicKey, 'X', 'A')!;
    const pub = (seq: number, nickname: string, peerId = 'X', from = 'X', to = 'A', k = key) => ({
      v: 2,
      t: 'pub',
      from,
      to,
      ...seal(k, pubAad(from, to), JSON.stringify({ seq, packet: pkt(peerId, nickname) })),
    });
    const seen = () => nick(a.net.peers(PUBLIC_VIEW), 'X');

    await send({ v: 2, t: 'hello', id: 'X', pk: x.publicKey });
    const d1 = pub(5, 'one');
    await send(d1);
    await until(() => seen() === 'one');
    expect(seen()).toBe('one');
    await send(pub(6, 'two'));
    await until(() => seen() === 'two');
    expect(seen()).toBe('two');

    const flipped = pub(7, 'evil');
    const c = Buffer.from(flipped.c, 'base64');
    c[3] ^= 1;
    const other = createIdentity('Y');
    const forged = [
      d1, // replay of a captured datagram
      pub(6, 'evil'), // same seq again
      { ...flipped, c: c.toString('base64') },
      pub(8, 'evil', 'Y'), // inner id ≠ from
      pub(9, 'evil', 'X', 'X', 'B'), // not addressed to A
      pub(10, 'evil', 'X', 'X', 'A', pairKey(other.privateKeyPem, a.id.publicKey, 'X', 'A')!), // wrong key
      { ...pub(11, 'evil'), n: '!!' },
      { v: 1, peer: { id: 'X', nickname: 'evil', palette: 0, hueShift: 0 }, views: [] },
      { v: 2, t: 'team', tag: 'AAAAAAAAAAA', n: flipped.n, c: flipped.c },
      { v: 2, t: 'hello', id: 'X', pk: other.publicKey }, // key substitution for a known id
      'x'.repeat(MAX_PACKET_BYTES + 1),
      '{',
    ];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const f of forged) await send(f);
    await send(Buffer.from([0xff, 0xfe, 0x00]).toString('latin1'));
    await sleep(100);
    expect(seen()).toBe('two');
    expect(ids(a.net.peers(PUBLIC_VIEW))).toEqual(['X']);
    expect(warn.mock.calls.some((m) => String(m[0]).includes('구버전'))).toBe(true);
  });

  it('a max-size packet still fits one datagram that parseWire accepts', () => {
    const view = (i: number) => ({
      id: `s${i}`.padEnd(200, 'x'),
      provider: 'claude' as const,
      kind: 'main' as const,
      num: i,
      room: 'coding' as const,
      permission: false,
      act: 'run' as const,
      target: '"'.repeat(120),
      reason: '가'.repeat(200),
    });
    const id = 'i'.repeat(64);
    const packet = fitPacket({
      v: 1,
      peer: { id, nickname: '가'.repeat(20), palette: 0, hueShift: 0 },
      views: Array.from({ length: 300 }, (_, i) => view(i)),
    });
    const inner = JSON.stringify({
      seq: Number.MAX_SAFE_INTEGER,
      packet,
      office: { name: '가'.repeat(20) },
    });
    const key = Buffer.alloc(32, 1);
    for (const wire of [
      { v: 2, t: 'pub', from: id, to: id, ...seal(key, pubAad(id, id), inner) },
      { v: 2, t: 'team', tag: 'AAAAAAAAAAA', ...seal(key, teamAad('AAAAAAAAAAA'), inner) },
    ]) {
      const text = JSON.stringify(wire);
      expect(Buffer.byteLength(text)).toBeLessThanOrEqual(MAX_PACKET_BYTES);
      expect(parseWire(text)).not.toBeNull();
    }
  });
});

describe('PeerNet team offices', () => {
  it('members see each other by code; outsiders see nothing; public is closed to members', async () => {
    const [a, b, c] = await mkNodes(['A', 'B', 'C']);
    const secret = newInviteCode().secret;
    a.offices = [channel(secret)];
    b.offices = [channel(Buffer.from(secret))];
    await pump(
      [a, b, c],
      () => a.net.peers(a.offices[0].tag).length > 0 && b.net.peers(a.offices[0].tag).length > 0,
    );
    const { tag } = a.offices[0];
    expect(ids(a.net.peers(tag))).toEqual(['B']);
    expect(ids(b.net.peers(tag))).toEqual(['A']);
    expect(a.net.peers(PUBLIC_VIEW)).toEqual([]);
    expect(c.net.peers(PUBLIC_VIEW)).toEqual([]);
    expect(c.net.peers(tag)).toEqual([]);
    expect(b.net.teamName(tag)).toBe('team');
  });

  it('joining stops hello at once; leaving sends hello again right away', async () => {
    const raw = await rawSocket();
    const helloFromA = (g: string) => {
      const w = JSON.parse(g) as { t: string; id?: string };
      return w.t === 'hello' && w.id === 'A';
    };
    const [a, c] = await mkNodes(['A', 'C'], [`127.0.0.1:${raw.port}`]);
    await pump([a, c], () => c.net.peers(PUBLIC_VIEW).length > 0);
    expect(ids(c.net.peers(PUBLIC_VIEW))).toEqual(['A']);

    a.offices = [channel(newInviteCode().secret)];
    raw.got.length = 0;
    await pump([a, c], () => false, 5);
    expect(raw.got.length).toBeGreaterThan(0);
    expect(raw.got.filter(helloFromA)).toEqual([]);
    expect(raw.got.some((g) => (JSON.parse(g) as { t: string }).t === 'team')).toBe(true);
    expect(a.net.peers(PUBLIC_VIEW)).toEqual([]);
    c.t += PEER_TTL_MS + 1;
    await pump([a, c], () => false, 5);
    expect(c.net.peers(PUBLIC_VIEW)).toEqual([]);

    a.offices = [];
    raw.got.length = 0;
    a.net.sendNow();
    await until(() => raw.got.some(helloFromA));
    expect(raw.got.some(helloFromA)).toBe(true);
    await pump([a, c], () => c.net.peers(PUBLIC_VIEW).length > 0);
    expect(ids(c.net.peers(PUBLIC_VIEW))).toEqual(['A']);
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
    act: 'run' as const,
    target: 'x'.repeat(120),
    reason: 'y'.repeat(200),
  });
  it('drops trailing views to fit, leaves small packets alone', () => {
    const small = { ...pkt('A'), views: [view(1)] };
    expect(fitPacket(small)).toEqual(small);
    const big = { ...pkt('A'), views: Array.from({ length: 300 }, (_, i) => view(i)) };
    const r = fitPacket(big);
    expect(r.views.length).toBeLessThan(300);
    expect(r.views[0].id).toBe('s0');
    expect(Buffer.byteLength(JSON.stringify(r))).toBeLessThanOrEqual(PACKET_PLAINTEXT_BUDGET);
  });
});

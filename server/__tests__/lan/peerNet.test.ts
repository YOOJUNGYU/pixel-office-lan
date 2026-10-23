import { randomUUID } from 'crypto';
import * as dgram from 'dgram';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as zlib from 'zlib';

import type { PeerPacket } from '../../../core/src/lan.js';
import { MAX_PACKET_BYTES, PUBLIC_VIEW } from '../../../core/src/lan.js';
import {
  MAX_DATAGRAM_BYTES,
  MAX_PRESENCE_ASSEMBLIES,
  MAX_PRESENCE_PARTS,
  MAX_WARN_KEYS,
  PRESENCE_MAX_COMPRESSED,
} from '../../src/constants.js';
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
import type { Inner, TeamChannel } from '../../src/lan/peerNet.js';
import {
  broadcastAddresses,
  fitPacket,
  PEER_TTL_MS,
  PeerNet,
  presencePlains,
} from '../../src/lan/peerNet.js';

const pkt = (id: string, nickname = id): PeerPacket => ({
  v: 1,
  peer: { id, account: id, nickname, palette: 0, hueShift: 0 },
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
/** Poll until f() holds or a generous deadline passes (the caller's expect reports it). */
const until = async (f: () => boolean, ms = 5_000) => {
  for (const end = Date.now() + ms; !f() && Date.now() < end;) await sleep(20);
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

  it('manual peer on one side only: both still see each other (hello reply)', async () => {
    const [pa, pb] = await Promise.all([freePort(), freePort()]);
    const mk = (name: string, port: number, targets: string[]) => {
      const id = createIdentity(name);
      const net = new PeerNet({
        port,
        identity: id,
        getPacket: () => pkt(id.id),
        manualPeers: () => [],
        offices: () => [],
        pins: new Map<string, string>(),
        targets: () => targets,
        now: () => 1000,
      });
      nets.push(net);
      return net;
    };
    const a = mk('A', pa, [`127.0.0.1:${pb}`]); // A lists B
    const b = mk('B', pb, []); // B lists nobody, and B's broadcast never reaches A
    await Promise.all([a.start(), b.start()]);
    await pump(
      [{ net: a }, { net: b }] as Node[],
      () => a.peers(PUBLIC_VIEW).length > 0 && b.peers(PUBLIC_VIEW).length > 0,
    );
    expect(ids(a.peers(PUBLIC_VIEW))).toEqual(['B']);
    expect(ids(b.peers(PUBLIC_VIEW))).toEqual(['A']);
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
      { v: 2, t: 'team', tag: 'AAAAAAAAAAA', n: flipped.n, c: flipped.c },
      { v: 2, t: 'hello', id: 'X', pk: other.publicKey }, // key substitution for a known id
      'x'.repeat(MAX_PACKET_BYTES + 1),
      '{',
    ];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const f of forged) await send(f);
    await send(Buffer.from([0xff, 0xfe, 0x00]).toString('latin1'));
    // Sent last: one socket → one socket on loopback is FIFO, so once its warning shows,
    // every forged datagram above has been handled — no fixed sleep.
    await send({ v: 1, peer: { id: 'X', nickname: 'evil', palette: 0, hueShift: 0 }, views: [] });
    const warnedV1 = () => warn.mock.calls.some((m) => String(m[0]).includes('구버전'));
    await until(warnedV1);
    expect(warnedV1()).toBe(true);
    expect(seen()).toBe('two');
    expect(ids(a.net.peers(PUBLIC_VIEW))).toEqual(['X']);
  });

  it('a max-size presence splits into ≤ MAX_PRESENCE_PARTS datagrams of ≤ MAX_DATAGRAM_BYTES', () => {
    const view = (i: number) => ({
      id: `s${i}`.padEnd(200, 'x'),
      provider: 'claude' as const,
      kind: 'main' as const,
      num: i,
      room: 'coding' as const,
      permission: false,
      act: 'run' as const,
      target: '"'.repeat(120),
      reason: randomUUID().repeat(5).slice(0, 180) + '가'.repeat(20),
    });
    const id = 'i'.repeat(64);
    const packet = fitPacket({
      v: 1,
      peer: { id, account: '가'.repeat(32), nickname: '가'.repeat(20), palette: 0, hueShift: 0 },
      views: Array.from({ length: 300 }, (_, i) => view(i)),
    });
    expect(packet.views.length).toBeGreaterThan(10);
    const inner: Inner = {
      seq: Number.MAX_SAFE_INTEGER,
      packet,
      office: { name: '가'.repeat(20) },
    };
    const key = Buffer.alloc(32, 1);
    const around = (w: object) =>
      Buffer.byteLength(JSON.stringify({ ...w, n: 'x'.repeat(16), c: '' }));
    const forms = [
      { wire: { v: 2, t: 'pub', from: id, to: id }, aad: pubAad(id, id) },
      { wire: { v: 2, t: 'team', tag: 'AAAAAAAAAAA' }, aad: teamAad('AAAAAAAAAAA') },
    ];
    for (const { wire, aad } of forms) {
      const plains = presencePlains(inner, id, around(wire));
      expect(plains.length).toBeGreaterThan(1);
      expect(plains.length).toBeLessThanOrEqual(MAX_PRESENCE_PARTS);
      for (const plain of plains) {
        const text = JSON.stringify({ ...wire, ...seal(key, aad, plain) });
        expect(Buffer.byteLength(text)).toBeLessThanOrEqual(MAX_DATAGRAM_BYTES);
        expect(parseWire(text)).not.toBeNull();
      }
    }
  });
});

describe('PeerNet bounded state', () => {
  type Internals = {
    receive(text: string, rinfo: { address: string; port: number }): void;
    seen: Map<string, Map<string, unknown>>;
    warned: Set<string>;
  };
  const rinfo = { address: '127.0.0.1', port: 9 };

  it('expires peers on the send tick even when no one views the office', async () => {
    const [a] = await mkNodes(['A']);
    const net = a.net as unknown as Internals;
    const x = createIdentity('X');
    for (let i = 0; i < 40; i++) {
      const id = `X${i}`;
      net.receive(JSON.stringify({ v: 2, t: 'hello', id, pk: x.publicKey }), rinfo);
      const key = pairKey(x.privateKeyPem, a.id.publicKey, id, 'A')!;
      const inner = JSON.stringify({ seq: 1, packet: pkt(id) });
      net.receive(
        JSON.stringify({ v: 2, t: 'pub', from: id, to: 'A', ...seal(key, pubAad(id, 'A'), inner) }),
        rinfo,
      );
    }
    expect(net.seen.get(PUBLIC_VIEW)?.size).toBe(40);
    a.t += PEER_TTL_MS + 1;
    a.net.sendNow();
    expect(net.seen.get(PUBLIC_VIEW)?.size ?? 0).toBe(0);

    // same for a joined team office nobody is looking at
    const ch = channel(newInviteCode().secret);
    a.offices = [ch];
    for (let i = 0; i < 40; i++) {
      const inner = JSON.stringify({ seq: 1, packet: pkt(`M${i}`) });
      net.receive(
        JSON.stringify({ v: 2, t: 'team', tag: ch.tag, ...seal(ch.key, teamAad(ch.tag), inner) }),
        rinfo,
      );
    }
    expect(net.seen.get(ch.tag)?.size).toBe(40);
    a.t += PEER_TTL_MS + 1;
    a.net.sendNow();
    expect(net.seen.get(ch.tag)?.size ?? 0).toBe(0);
  });

  it('caps once-only warnings: 10k key mismatches → bounded set and log', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const [a] = await mkNodes(['A']);
    const net = a.net as unknown as Internals;
    const [k1, k2] = [createIdentity('k1').publicKey, createIdentity('k2').publicKey];
    for (let i = 0; i < 10_000; i++) {
      net.receive(JSON.stringify({ v: 2, t: 'hello', id: `Z${i}`, pk: k1 }), rinfo);
      net.receive(JSON.stringify({ v: 2, t: 'hello', id: `Z${i}`, pk: k2 }), rinfo);
    }
    expect(net.warned.size).toBeLessThanOrEqual(MAX_WARN_KEYS + 1);
    expect(warn.mock.calls.length).toBeLessThanOrEqual(MAX_WARN_KEYS + 1);
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
    // A hello sent before the switch (pump's last round or PeerNet's own 1 s tick) may still
    // be in flight. A → raw is FIFO, so A's first team datagram means it has landed.
    const isTeam = (g: string) => (JSON.parse(g) as { t: string }).t === 'team';
    a.net.sendNow();
    await until(() => raw.got.some(isTeam));
    raw.got.length = 0;
    await pump([a, c], () => false, 5);
    expect(raw.got.length).toBeGreaterThan(0);
    expect(raw.got.filter(helloFromA)).toEqual([]);
    expect(raw.got.some(isTeam)).toBe(true);
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
    expect(zlib.deflateSync(JSON.stringify(r)).length).toBeLessThanOrEqual(PRESENCE_MAX_COMPRESSED);
  });
});

describe('PeerNet split presence', () => {
  /** 40 agents with long, distinct reasons: far more than one datagram. */
  const busy = (id: string, tag = ''): PeerPacket => ({
    ...pkt(id),
    views: Array.from({ length: 40 }, (_, i) => ({
      id: `${tag}session-${i}-${randomUUID()}`,
      provider: 'claude' as const,
      kind: 'main' as const,
      num: i + 1,
      room: 'coding' as const,
      permission: false,
      act: 'run' as const,
      target: `npm run build -- --filter ${randomUUID()}`,
      reason: `${randomUUID()} 긴 설명 `.repeat(4).slice(0, 200),
    })),
  });

  it('a 40-agent presence reaches team and public peers; every datagram ≤ MAX_DATAGRAM_BYTES', async () => {
    const raw = await rawSocket();
    const sizes: number[] = [];
    const [a, b, c, d] = await mkNodes(['A', 'B', 'C', 'D'], [`127.0.0.1:${raw.port}`]);
    const secret = newInviteCode().secret;
    a.offices = [channel(secret)];
    b.offices = [channel(Buffer.from(secret))];
    const big = busy('A');
    const bigC = busy('C');
    (a.net as unknown as { opts: { getPacket: () => PeerPacket } }).opts.getPacket = () => big;
    (c.net as unknown as { opts: { getPacket: () => PeerPacket } }).opts.getPacket = () => bigC;
    const spy = vi.spyOn(dgram.Socket.prototype, 'send');
    const { tag } = a.offices[0];
    await pump(
      [a, b, c, d],
      () =>
        (b.net.peers(tag)[0]?.views.length ?? 0) === 40 &&
        (d.net.peers(PUBLIC_VIEW).find((p) => p.peer.id === 'C')?.views.length ?? 0) === 40,
    );
    expect(b.net.peers(tag)[0].views).toEqual(big.views);
    expect(d.net.peers(PUBLIC_VIEW).find((p) => p.peer.id === 'C')!.views).toEqual(bigC.views);
    for (const call of spy.mock.calls) sizes.push((call[0] as Buffer).length);
    expect(Buffer.byteLength(JSON.stringify(big))).toBeGreaterThan(10 * MAX_DATAGRAM_BYTES);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(MAX_DATAGRAM_BYTES);
    expect(raw.got.every((g) => Buffer.byteLength(g) <= MAX_DATAGRAM_BYTES)).toBe(true);
  });

  describe('assembly (team channel, crafted parts)', () => {
    const secret = newInviteCode().secret;
    const ch = channel(secret);
    const around = Buffer.byteLength(
      JSON.stringify({ v: 2, t: 'team', tag: ch.tag, n: 'x'.repeat(16), c: '' }),
    );
    const wires = (seq: number, packet: PeerPacket, from = 'X') =>
      presencePlains({ seq, packet }, from, around).map((plain) =>
        JSON.stringify({ v: 2, t: 'team', tag: ch.tag, ...seal(ch.key, teamAad(ch.tag), plain) }),
      );
    type Internals = {
      receive(text: string, rinfo: { address: string; port: number }): void;
      assemblies: Map<string, unknown>;
    };
    const rinfo = { address: '127.0.0.1', port: 9 };
    const setup = async () => {
      const [a] = await mkNodes(['A']);
      a.offices = [channel(Buffer.from(secret))];
      const net = a.net as unknown as Internals;
      const views = () => a.net.peers(ch.tag)[0]?.views.map((v) => v.id);
      return { a, net, views, rx: (w: string) => net.receive(w, rinfo) };
    };

    it('single-part (0.4.x) and split forms are both accepted', async () => {
      const { a, rx } = await setup();
      const small = wires(1, pkt('X', 'small'));
      expect(small).toHaveLength(1);
      // The single form is the 0.4.x Inner itself: no part fields.
      expect(presencePlains({ seq: 1, packet: pkt('X') }, 'X', around)[0]).not.toContain('"parts"');
      small.forEach(rx);
      expect(nick(a.net.peers(ch.tag), 'X')).toBe('small');
      const big = busy('X');
      const split = wires(2, big);
      expect(split.length).toBeGreaterThan(1);
      split.forEach(rx);
      expect(a.net.peers(ch.tag)[0].views).toEqual(big.views);
    });

    it('a lost part keeps the previous state; the next seq still lands', async () => {
      const { a, net, views, rx } = await setup();
      const first = busy('X', 'one-');
      wires(1, first).forEach(rx);
      const second = wires(2, busy('X', 'two-'));
      second.slice(1).forEach(rx); // part 0 lost
      expect(views()).toEqual(first.views.map((v) => v.id));
      a.t += 3_000; // past PRESENCE_ASSEMBLY_MS: the half-built seq 2 is dropped
      const third = busy('X', 'three-');
      wires(3, third).reverse().forEach(rx); // reordered
      expect(views()).toEqual(third.views.map((v) => v.id));
      expect(net.assemblies.size).toBe(0);
    });

    it('drops duplicates, replays, forged parts and a sender mismatch', async () => {
      const { a, views, rx } = await setup();
      const p1 = busy('X', 'one-');
      const w1 = wires(5, p1);
      rx(w1[0]);
      rx(w1[0]); // duplicate
      w1.slice(1).forEach(rx);
      expect(views()).toEqual(p1.views.map((v) => v.id));
      w1.forEach(rx); // replay of a complete seq: no new assembly
      // A part forged with another key, or claiming another sender, never completes anything.
      const evil = presencePlains({ seq: 9, packet: busy('X', 'evil-') }, 'X', around);
      const bad = Buffer.alloc(32, 3);
      evil.forEach((plain) =>
        rx(JSON.stringify({ v: 2, t: 'team', tag: ch.tag, ...seal(bad, teamAad(ch.tag), plain) })),
      );
      wires(10, busy('X', 'liar-'), 'Y').forEach(rx); // parts say Y, packet says X
      expect(views()).toEqual(p1.views.map((v) => v.id));
      expect(a.net.peers(ch.tag).map((p) => p.peer.id)).toEqual(['X']);
    });

    it('caps assemblies: one per sender, MAX_PRESENCE_ASSEMBLIES in all', async () => {
      const { net, rx } = await setup();
      for (let i = 0; i < MAX_PRESENCE_ASSEMBLIES + 50; i++) {
        const id = `P${i}`;
        rx(wires(1, busy(id), id)[0]); // first part only
        rx(wires(2, busy(id), id)[0]); // newer seq replaces, never adds
      }
      expect(net.assemblies.size).toBe(MAX_PRESENCE_ASSEMBLIES);
    });
  });
});

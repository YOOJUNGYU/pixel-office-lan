import * as dgram from 'dgram';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import * as zlib from 'zlib';

import type { LayoutRev, PeerPacket } from '../../../core/src/lan.js';
import { DEFAULT_LAYOUT_REV, newerLayout, PUBLIC_VIEW } from '../../../core/src/lan.js';
import { LAYOUT_PUSH_MS, MAX_DATAGRAM_BYTES } from '../../src/constants.js';
import {
  createIdentity,
  newInviteCode,
  parseWire,
  pubAad,
  seal,
  teamAad,
  teamKey,
  teamTag,
} from '../../src/lan/crypto.js';
import type { TeamChannel } from '../../src/lan/peerNet.js';
import { layoutPlains, PeerNet } from '../../src/lan/peerNet.js';
import { layoutHash, SharedLayouts } from '../../src/lan/sharedLayout.js';

const freePort = (): Promise<number> =>
  new Promise((res) => {
    const s = dgram.createSocket('udp4');
    s.bind(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A layout big enough to need many parts (random-ish so deflate cannot shrink it away). */
const bigLayout = (seed: number) => ({
  version: 1,
  cols: 100,
  rows: 100,
  tiles: Array.from({ length: 10_000 }, (_, i) => (i * 7919 + seed) % 251),
  furniture: [],
});

interface Node {
  net: PeerNet;
  offices: TeamChannel[];
  t: number;
  /** This PC's layout per channel, and what it received. */
  mine: Map<string, { rev: LayoutRev; blob: Buffer }>;
  got: { channel: string; rev: LayoutRev; text: string }[];
  /** false = an older PC that says nothing about layouts. */
  advertises: boolean;
}

const nets: PeerNet[] = [];
afterEach(() => nets.splice(0).forEach((n) => n.stop()));

async function mkNodes(n: number): Promise<Node[]> {
  const ports = await Promise.all(Array.from({ length: n }, () => freePort()));
  const targets = ports.map((p) => `127.0.0.1:${p.toString()}`);
  const nodes: Node[] = [];
  for (const [i, port] of ports.entries()) {
    const id = createIdentity(`N${i.toString()}`);
    const node = {
      offices: [],
      t: 1000,
      mine: new Map(),
      got: [],
      advertises: true,
    } as Partial<Node> as Node;
    const rev = (ch: string) => node.mine.get(ch)?.rev ?? DEFAULT_LAYOUT_REV;
    node.net = new PeerNet({
      port,
      identity: id,
      getPacket: (ch): PeerPacket => ({
        v: 1,
        peer: { id: id.id, account: id.id, nickname: '', palette: 0, hueShift: 0 },
        views: [],
        ...(node.advertises && { layout: rev(ch) }),
      }),
      manualPeers: () => [],
      offices: () => node.offices,
      pins: new Map<string, string>(),
      targets: () => targets,
      now: () => node.t,
      layouts: {
        rev,
        blob: (ch) => node.mine.get(ch)?.blob ?? null,
        receive: (channel, r, text) => {
          node.got.push({ channel, rev: r, text });
          if (newerLayout(r, rev(channel))) {
            node.mine.set(channel, { rev: r, blob: zlib.deflateSync(text) });
          }
        },
      },
    });
    nets.push(node.net);
    await node.net.start();
    nodes.push(node);
  }
  return nodes;
}

const setLayout = (node: Node, ch: string, rev: number, by: string, layout: object) => {
  const text = JSON.stringify(layout);
  node.mine.set(ch, { rev: { rev, by, h: layoutHash(text) }, blob: zlib.deflateSync(text) });
};

/** Send rounds (the clock moves past LAYOUT_PUSH_MS now and then, so pushes repeat). */
const pump = async (nodes: Node[], f: () => boolean, rounds = 150) => {
  for (let i = 0; i < rounds && !f(); i++) {
    nodes.forEach((n) => n.net.sendNow());
    if (i % 10 === 9) nodes.forEach((n) => (n.t += LAYOUT_PUSH_MS));
    await sleep(20);
  }
};

describe('shared layout sync (PeerNet)', () => {
  it('public: a newer layout reaches a lagging peer, hash-checked, and spreads no further back', async () => {
    const [a, b] = await mkNodes(2);
    const layout = bigLayout(1);
    setLayout(a, PUBLIC_VIEW, 3, 'A', layout);
    await pump([a, b], () => b.got.length > 0);
    expect(b.got[0].channel).toBe(PUBLIC_VIEW);
    expect(b.got[0].rev.rev).toBe(3);
    expect(JSON.parse(b.got[0].text)).toEqual(layout);
    // Same version on both sides now: nothing more is pushed or received.
    const n = b.got.length;
    await pump([a, b], () => false, 30);
    expect(b.got.length).toBe(n);
    expect(a.got).toEqual([]);
  });

  it('team: members get the newest layout over the team channel; outsiders get nothing', async () => {
    const [a, b, c] = await mkNodes(3);
    const key = teamKey(newInviteCode().secret);
    const team = { tag: teamTag(key), key, name: 't' };
    a.offices = [team];
    b.offices = [team];
    setLayout(a, team.tag, 1, 'A', bigLayout(2));
    await pump([a, b, c], () => b.got.length > 0);
    expect(b.got[0].channel).toBe(team.tag);
    expect(c.got).toEqual([]);
  });

  it('older PCs (no layout in their presence) are never pushed to', async () => {
    const [a, b] = await mkNodes(2);
    b.advertises = false;
    setLayout(a, PUBLIC_VIEW, 1, 'A', bigLayout(3));
    await pump([a, b], () => false, 40);
    expect(b.got).toEqual([]);
  });

  it('a version with a wrong hash is dropped', async () => {
    const [a, b] = await mkNodes(2);
    const text = JSON.stringify(bigLayout(4));
    a.mine.set(PUBLIC_VIEW, {
      rev: { rev: 1, by: 'A', h: '0'.repeat(16) },
      blob: zlib.deflateSync(text),
    });
    await pump([a, b], () => false, 40);
    expect(b.got).toEqual([]);
  });

  it('every layout datagram fits MAX_DATAGRAM_BYTES (64-char ids, the longest author)', () => {
    const id = 'i'.repeat(64);
    const rev = { rev: Number.MAX_SAFE_INTEGER, by: id, h: 'f'.repeat(16) };
    const plains = layoutPlains(rev, zlib.deflateSync(JSON.stringify(bigLayout(5))));
    expect(plains.length).toBeGreaterThan(1);
    const key = Buffer.alloc(32, 1);
    for (const { wire, aad } of [
      { wire: { v: 2, t: 'pub', from: id, to: id }, aad: pubAad(id, id) },
      { wire: { v: 2, t: 'team', tag: 'AAAAAAAAAAA' }, aad: teamAad('AAAAAAAAAAA') },
    ]) {
      for (const plain of plains) {
        const text = JSON.stringify({ ...wire, ...seal(key, aad, plain) });
        expect(Buffer.byteLength(text)).toBeLessThanOrEqual(MAX_DATAGRAM_BYTES);
        expect(parseWire(text)).not.toBeNull();
      }
    }
  });
});

describe('SharedLayouts store', () => {
  it('keeps only newer versions per channel and survives a restart', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-shared-'));
    try {
      const s = new SharedLayouts(dir);
      expect(s.rev(PUBLIC_VIEW)).toEqual(DEFAULT_LAYOUT_REV);
      expect(s.offer(PUBLIC_VIEW, 2, 'B', { m: 'b' })).toBe(true);
      expect(s.offer(PUBLIC_VIEW, 2, 'A', { m: 'a' })).toBe(false); // same rev: larger author wins
      expect(s.offer(PUBLIC_VIEW, 1, 'Z', { m: 'z' })).toBe(false);
      expect(s.offer('TEAMTAG0001', 1, 'A', { m: 't' })).toBe(true);
      const again = new SharedLayouts(dir);
      expect(again.layout(PUBLIC_VIEW)).toEqual({ m: 'b' });
      expect(again.rev(PUBLIC_VIEW)).toEqual({ rev: 2, by: 'B', h: layoutHash('{"m":"b"}') });
      expect(again.layout('TEAMTAG0001')).toEqual({ m: 't' });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

import * as dgram from 'dgram';
import * as os from 'os';

import type { PeerPacket } from '../../../core/src/lan.js';
import { parsePeerPacket, PUBLIC_VIEW } from '../../../core/src/lan.js';
import {
  MAX_HELLO_PEERS,
  MAX_OFFICE_NAME,
  MAX_WARN_KEYS,
  PACKET_PLAINTEXT_BUDGET,
  SEQ_MEMORY_MS,
} from '../constants.js';
import type { Identity, Wire } from './crypto.js';
import { open, pairKey, parseWire, pubAad, seal, teamAad } from './crypto.js';

export const PEER_TTL_MS = 5_000;
export const SEND_INTERVAL_MS = 1_000;
const WARN_OVERFLOW = '*';

/** A joined team office as PeerNet needs it (key = teamKey(secret)). */
export interface TeamChannel {
  tag: string;
  key: Buffer;
  name: string;
}

/** Encrypted payload of `pub` and `team` datagrams. */
interface Inner {
  seq: number;
  packet: PeerPacket;
  office?: { name: string };
}

const ipToInt = (ip: string): number =>
  ip.split('.').reduce((a, n) => ((a << 8) | Number(n)) >>> 0, 0);
const intToIp = (n: number): string => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.');

/** Directed broadcast of each non-internal IPv4 interface, plus the limited broadcast. */
export function broadcastAddresses(
  ifaces: ReturnType<typeof os.networkInterfaces> = os.networkInterfaces(),
): string[] {
  const out = new Set<string>();
  for (const list of Object.values(ifaces)) {
    for (const i of list ?? []) {
      if (i.family !== 'IPv4' || i.internal) continue;
      const mask = ipToInt(i.netmask);
      out.add(intToIp(((ipToInt(i.address) & mask) | ~mask) >>> 0));
    }
  }
  out.add('255.255.255.255');
  return [...out];
}

/** Drops trailing views until the serialized packet fits the encrypted-plaintext budget. */
export function fitPacket(p: PeerPacket): PeerPacket {
  const views = [...p.views];
  while (
    views.length &&
    Buffer.byteLength(JSON.stringify({ ...p, views })) > PACKET_PLAINTEXT_BUDGET
  ) {
    views.pop();
  }
  return { ...p, views };
}

/** Decrypted text → validated inner payload, else null. */
function parseInner(text: string | null): Inner | null {
  if (text === null) return null;
  try {
    const o = JSON.parse(text) as Record<string, unknown> | null;
    if (!o || typeof o !== 'object' || !Number.isSafeInteger(o.seq)) return null;
    const packet = parsePeerPacket(JSON.stringify(o.packet));
    if (!packet) return null;
    const name = (o.office as { name?: unknown } | undefined)?.name;
    return {
      seq: o.seq as number,
      packet,
      ...(typeof name === 'string' && { office: { name: name.slice(0, MAX_OFFICE_NAME) } }),
    };
  } catch {
    return null;
  }
}

/**
 * v2 LAN protocol. Public office (no team joined): plaintext `hello {id, pk}`
 * broadcast, encrypted pairwise `pub` unicast to every live hello'd peer.
 * Team offices: one encrypted `team` broadcast per joined office, nothing else.
 */
export class PeerNet {
  private sock: dgram.Socket | null = null;
  private timer: NodeJS.Timeout | null = null;
  /** Public-office peers from their hello: key cached per pk, reply address from rinfo. */
  private readonly hellos = new Map<
    string,
    { pk: string; key: Buffer | null; address: string; port: number; at: number }
  >();
  /** channel (PUBLIC_VIEW | tag) → sender id → last packet. */
  private readonly seen = new Map<string, Map<string, { packet: PeerPacket; at: number }>>();
  /** `${channel}|${sender}` → last accepted seq. */
  private readonly lastSeq = new Map<string, { seq: number; at: number }>();
  /** Team names as members announce them (shown when joined without a name). */
  private readonly names = new Map<string, string>();
  private readonly warned = new Set<string>();
  /** Per process, seeded with the clock so a restart still counts upward. */
  private seq = Date.now();
  private readonly now: () => number;

  constructor(
    private readonly opts: {
      port: number;
      identity: Identity;
      getPacket: () => PeerPacket;
      manualPeers: () => string[];
      offices: () => TeamChannel[];
      /** TOFU: first public key seen per peer id. */
      pins: { get(id: string): string | undefined; set(id: string, pk: string): void };
      /** Broadcast targets override ("host:port"), for tests. */
      targets?: () => string[];
      now?: () => number;
    },
  ) {
    this.now = opts.now ?? Date.now;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      sock.on('message', (msg, rinfo) => this.receive(msg.toString('utf8'), rinfo));
      sock.once('error', reject);
      sock.bind(this.opts.port, '0.0.0.0', () => {
        sock.removeListener('error', reject);
        sock.on('error', (err) => console.error('[Pixel Office] UDP socket error:', err.message));
        sock.setBroadcast(true);
        this.sock = sock;
        this.timer = setInterval(() => this.sendNow(), SEND_INTERVAL_MS);
        this.timer.unref();
        resolve();
      });
    });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.sock?.close();
    this.sock = null;
  }

  /** Send this PC's state now; called every SEND_INTERVAL_MS and after any change. */
  sendNow(): void {
    const sock = this.sock;
    if (!sock) return;
    this.prune();
    const { identity } = this.opts;
    const offices = this.opts.offices();
    const packet = this.opts.getPacket();
    const broadcast = this.opts.targets?.() ?? [
      ...broadcastAddresses(),
      ...this.opts.manualPeers(),
    ];
    if (offices.length) {
      for (const o of offices) {
        const inner: Inner = {
          seq: ++this.seq,
          packet,
          ...(o.name && { office: { name: o.name } }),
        };
        const sealed = seal(o.key, teamAad(o.tag), JSON.stringify(inner));
        const wire: Wire = { v: 2, t: 'team', tag: o.tag, ...sealed };
        for (const t of broadcast) this.send(sock, wire, t);
      }
      return;
    }
    const hello: Wire = { v: 2, t: 'hello', id: identity.id, pk: identity.publicKey };
    for (const t of broadcast) this.send(sock, hello, t);
    for (const [id, h] of this.hellos) {
      h.key ??= pairKey(identity.privateKeyPem, h.pk, identity.id, id);
      if (!h.key) continue;
      const inner: Inner = { seq: ++this.seq, packet };
      const sealed = seal(h.key, pubAad(identity.id, id), JSON.stringify(inner));
      const wire: Wire = { v: 2, t: 'pub', from: identity.id, to: id, ...sealed };
      this.send(sock, wire, `${h.address}:${h.port.toString()}`);
    }
  }

  /** Live packets of one office; the public office is empty while in any team. */
  peers(view: string): PeerPacket[] {
    if (view === PUBLIC_VIEW ? this.opts.offices().length > 0 : !this.isJoined(view)) return [];
    const t = this.now();
    const out: PeerPacket[] = [];
    for (const e of this.seen.get(view)?.values() ?? [])
      if (t - e.at <= PEER_TTL_MS) out.push(e.packet);
    return out;
  }

  /** The name a member last announced for a team office. */
  teamName(tag: string): string | undefined {
    return this.names.get(tag);
  }

  private isJoined(tag: string): boolean {
    return this.opts.offices().some((o) => o.tag === tag);
  }

  private send(sock: dgram.Socket, wire: Wire, target: string): void {
    const buf = Buffer.from(JSON.stringify(wire), 'utf8');
    // "host:port" overrides the port (tests, rinfo replies; hostnames/IPv4 never contain ':')
    const [host, port] = target.split(':');
    sock.send(buf, port ? Number(port) : this.opts.port, host, (err) => {
      if (!err) return;
      this.warnOnce(
        `send:${target}`,
        `[Pixel Office] UDP send to ${target} failed: ${err.message}`,
      );
    });
  }

  /** Once per key; keys come from the network, so past MAX_WARN_KEYS the rest go unlogged. */
  private warnOnce(key: string, message: string): void {
    if (this.warned.has(key) || this.warned.has(WARN_OVERFLOW)) return;
    if (this.warned.size >= MAX_WARN_KEYS) {
      this.warned.add(WARN_OVERFLOW);
      console.warn('[Pixel Office] Too many UDP warnings; further ones are not logged.');
      return;
    }
    this.warned.add(key);
    console.warn(message);
  }

  /** Untrusted datagram: anything off is dropped silently, never throws. */
  private receive(text: string, rinfo: { address: string; port: number }): void {
    const w = parseWire(text);
    if (!w) {
      if (text.startsWith('{"v":1,'))
        this.warnOnce('v1', '[Pixel Office] 구버전 PC 감지 (v0.1.x): 업데이트해야 서로 보입니다.');
      return;
    }
    const me = this.opts.identity.id;
    const inTeam = this.opts.offices().length > 0;
    if (w.t === 'hello') {
      if (inTeam || w.id === me) return;
      const pinned = this.opts.pins.get(w.id);
      if (pinned !== undefined && pinned !== w.pk) {
        this.warnOnce(
          `pin:${w.id}`,
          `[Pixel Office] PC ${w.id} 의 키가 바뀌어 무시합니다 (사칭 의심).`,
        );
        return;
      }
      const prev = this.hellos.get(w.id);
      if (!prev && this.hellos.size >= MAX_HELLO_PEERS) return;
      if (pinned === undefined) this.opts.pins.set(w.id, w.pk);
      this.hellos.set(w.id, {
        pk: w.pk,
        key: prev?.pk === w.pk ? prev.key : null,
        address: rinfo.address,
        port: rinfo.port,
        at: this.now(),
      });
      return;
    }
    if (w.t === 'pub') {
      const h = this.hellos.get(w.from);
      if (inTeam || w.to !== me || !h) return;
      h.key ??= pairKey(this.opts.identity.privateKeyPem, h.pk, me, w.from);
      if (!h.key) return;
      const inner = parseInner(open(h.key, pubAad(w.from, w.to), w.n, w.c));
      if (inner?.packet.peer.id === w.from) this.accept(PUBLIC_VIEW, inner);
      return;
    }
    const office = this.opts.offices().find((o) => o.tag === w.tag);
    if (!office) return;
    const inner = parseInner(open(office.key, teamAad(w.tag), w.n, w.c));
    if (!inner || inner.packet.peer.id === me) return;
    if (this.accept(w.tag, inner) && inner.office?.name) this.names.set(w.tag, inner.office.name);
  }

  /** Stores the packet unless its seq is not newer than the sender's last on this channel. */
  private accept(channel: string, inner: Inner): boolean {
    const id = inner.packet.peer.id;
    const key = `${channel}|${id}`;
    const at = this.now();
    const last = this.lastSeq.get(key);
    if (last && inner.seq <= last.seq) return false;
    this.lastSeq.set(key, { seq: inner.seq, at });
    let ch = this.seen.get(channel);
    if (!ch) this.seen.set(channel, (ch = new Map()));
    ch.set(id, { packet: inner.packet, at });
    return true;
  }

  /** Drops expired peers, and all public-office state while in a team or of left teams. */
  private prune(): void {
    const t = this.now();
    const offices = this.opts.offices();
    const live = new Set(offices.length ? offices.map((o) => o.tag) : [PUBLIC_VIEW]);
    if (offices.length) this.hellos.clear();
    for (const [id, h] of this.hellos) if (t - h.at > PEER_TTL_MS) this.hellos.delete(id);
    for (const [ch, peers] of this.seen) {
      if (!live.has(ch)) this.seen.delete(ch);
      else for (const [id, e] of peers) if (t - e.at > PEER_TTL_MS) peers.delete(id);
    }
    for (const tag of this.names.keys()) if (!live.has(tag)) this.names.delete(tag);
    // ponytail: a sender silent past SEQ_MEMORY_MS can be replayed once more; add a time window to seq if that matters
    for (const [k, s] of this.lastSeq) if (t - s.at > SEQ_MEMORY_MS) this.lastSeq.delete(k);
  }
}

import * as dgram from 'dgram';
import * as os from 'os';

import type { PeerPacket } from '../../../core/src/lan.js';
import { MAX_PACKET_BYTES, parsePeerPacket } from '../../../core/src/lan.js';

export const PEER_TTL_MS = 5_000;
export const SEND_INTERVAL_MS = 1_000;

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

/** Drops trailing views until the serialized packet fits one datagram. */
export function fitPacket(p: PeerPacket): PeerPacket {
  const views = [...p.views];
  while (views.length && Buffer.byteLength(JSON.stringify({ ...p, views })) > MAX_PACKET_BYTES) {
    views.pop();
  }
  return { ...p, views };
}

export class PeerNet {
  private sock: dgram.Socket | null = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly seen = new Map<string, { packet: PeerPacket; receivedAt: number }>();
  private readonly warned = new Set<string>();
  private readonly now: () => number;

  constructor(
    private readonly opts: {
      port: number;
      selfId: string;
      getPacket: () => PeerPacket;
      manualPeers: () => string[];
      targets?: () => string[];
      now?: () => number;
    },
  ) {
    this.now = opts.now ?? Date.now;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      sock.on('message', (msg) => {
        const p = parsePeerPacket(msg.toString('utf8'));
        if (!p || p.peer.id === this.opts.selfId) return;
        this.seen.set(p.peer.id, { packet: p, receivedAt: this.now() });
      });
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

  sendNow(): void {
    const sock = this.sock;
    if (!sock) return;
    // ponytail: 단일 데이터그램(IP 단편화 의존), 손실이 보이면 분할 전송
    const buf = Buffer.from(JSON.stringify(this.opts.getPacket()), 'utf8');
    const targets = this.opts.targets?.() ?? [...broadcastAddresses(), ...this.opts.manualPeers()];
    for (const t of targets) {
      // "host:port" overrides the port (used by tests; hostnames/IPv4 never contain ':')
      const [host, port] = t.split(':');
      sock.send(buf, port ? Number(port) : this.opts.port, host, (err) => {
        if (!err || this.warned.has(t)) return;
        this.warned.add(t); // log once per target, not every second
        console.warn(`[Pixel Office] UDP send to ${t} failed: ${err.message}`);
      });
    }
  }

  peers(): PeerPacket[] {
    const t = this.now();
    const out: PeerPacket[] = [];
    for (const [id, e] of this.seen) {
      if (t - e.receivedAt > PEER_TTL_MS) this.seen.delete(id);
      else out.push(e.packet);
    }
    return out;
  }
}

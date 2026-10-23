// Join/leave notices for the public office: diff consecutive snapshots' people
// (by peerId). Pure — no timers: a leave is reported by the first snapshot that
// arrives after PRESENCE_LEAVE_GRACE_MS (snapshots come every second), and is
// dropped when the peer is back by then (a presence blip, TTL ~5 s). After a
// reset, people who show up within PRESENCE_SETTLE_MS of the baseline are part
// of it (peers are rediscovered over a few seconds after a switch or restart).
import { PUBLIC_VIEW } from '../../../core/src/lan.js';
import { PRESENCE_LEAVE_GRACE_MS, PRESENCE_SETTLE_MS } from '../constants.js';
import { peerLabel } from './nicknames.js';

interface Person {
  peerId: string;
  account: string;
  nickname: string;
  self: boolean;
}

export interface PresenceChange {
  joined: string[];
  left: string[];
}

export class PresenceWatcher {
  private view: string | null = null;
  /** peerId → label of the last snapshot; null = take the next one as the baseline. */
  private known: Map<string, string> | null = null;
  /** When the baseline was taken (ms). */
  private since = 0;
  /** Gone but not reported yet: peerId → {label, since}. */
  private gone = new Map<string, { label: string; since: number }>();

  get currentView(): string | null {
    return this.view;
  }

  /** A new view, or a reconnect: forget everything, the next snapshot is the baseline. */
  reset(view: string | null): void {
    this.view = view;
    this.known = null;
    this.gone.clear();
  }

  apply(people: Person[], now: number): PresenceChange {
    const out: PresenceChange = { joined: [], left: [] };
    if (this.view !== PUBLIC_VIEW) return out;
    const cur = new Map(people.filter((p) => !p.self).map((p) => [p.peerId, peerLabel(p)]));
    const known = this.known;
    this.known = cur;
    if (!known) {
      this.since = now;
      return out;
    }
    const settling = now - this.since < PRESENCE_SETTLE_MS;
    for (const [id, label] of cur) {
      if (known.has(id) || settling) continue;
      if (!this.gone.delete(id)) out.joined.push(label);
    }
    for (const [id, label] of known) if (!cur.has(id)) this.gone.set(id, { label, since: now });
    for (const [id, g] of this.gone) {
      if (cur.has(id)) this.gone.delete(id);
      else if (now - g.since >= PRESENCE_LEAVE_GRACE_MS) {
        out.left.push(g.label);
        this.gone.delete(id);
      }
    }
    return out;
  }
}

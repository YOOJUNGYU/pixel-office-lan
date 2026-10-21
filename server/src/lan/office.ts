// Merges this PC's and peers' agents into one office; single-instance probe.
import type { AgentView, OfficeAgent, PeerInfo, PeerPacket } from '../../../core/src/lan.js';
import { PING_APP, PING_TIMEOUT_MS, UNNAMED_NICKNAME } from '../constants.js';
import { fitPacket } from './peerNet.js';
import type { Profile } from './profile.js';
import { saveProfile } from './profile.js';
import { redactView } from './redact.js';

const toAgents = (peer: PeerInfo, views: AgentView[]): OfficeAgent[] =>
  views.map((v) => ({
    ...v,
    key: `${peer.id}:${v.id}`,
    ...(v.parentId !== undefined && { parentKey: `${peer.id}:${v.parentId}` }),
    peer,
  }));

/** redactLocal applies to this PC's views only; peers redact before sending. */
export function buildOffice(
  self: PeerInfo,
  local: AgentView[],
  peers: PeerPacket[],
  redactLocal: boolean,
): OfficeAgent[] {
  return [
    ...toAgents(self, redactLocal ? local.map(redactView) : local),
    ...peers.flatMap((p) => toAgents(p.peer, p.views)),
  ];
}

/** True when a Pixel Office already answers on this port. */
export async function checkExisting(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port.toString()}/api/ping`, {
      signal: AbortSignal.timeout(PING_TIMEOUT_MS),
    });
    const body = (await res.json()) as { app?: unknown };
    return body.app === PING_APP;
  } catch {
    return false;
  }
}

export type EditableProfile = Omit<Profile, 'peerId'>;

/** This PC's live LAN state: profile, local agents, peers. */
export class LanService {
  /** Set once PeerNet is up; until then (or if UDP bind failed) there are no peers. */
  net: { peers(): PeerPacket[]; sendNow(): void } = { peers: () => [], sendNow: () => {} };

  constructor(
    public profile: Profile,
    private readonly local: { views(): AgentView[] },
    /** profile.json directory; undefined = ~/.pixel-office */
    private readonly dir?: string,
  ) {}

  self(): PeerInfo {
    const { peerId, nickname, palette, hueShift } = this.profile;
    return { id: peerId, nickname: nickname || UNNAMED_NICKNAME, palette, hueShift };
  }

  /** What PeerNet broadcasts. Never throws: a failing scan sends no views. */
  packet(): PeerPacket {
    let views: AgentView[] = [];
    try {
      views = this.local.views();
      if (this.profile.hideDetails) views = views.map(redactView);
    } catch (err) {
      console.error('[Pixel Office] Building peer packet failed:', err);
      views = [];
    }
    return fitPacket({ v: 1, peer: this.self(), views });
  }

  office(redactLocal: boolean): OfficeAgent[] {
    return buildOffice(this.self(), this.local.views(), this.net.peers(), redactLocal);
  }

  /** Persist a validated update and announce it to peers right away. */
  saveProfile(update: EditableProfile): void {
    const next: Profile = { ...update, peerId: this.profile.peerId };
    saveProfile(next, this.dir);
    this.profile = next;
    this.net.sendNow();
  }
}

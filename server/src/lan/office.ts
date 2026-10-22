// Merges this PC's and peers' agents into one office; single-instance probe.
import type { AgentView, OfficeAgent, PeerInfo, PeerPacket } from '../../../core/src/lan.js';
import { nicknameKey, PUBLIC_VIEW } from '../../../core/src/lan.js';
import type { OfficeErrorReason, OfficePersonMessage } from '../../../core/src/messages.js';
import { MAX_OFFICES, PING_APP, PING_TIMEOUT_MS } from '../constants.js';
import { inviteText, newInviteCode, parseInviteCode, teamKey } from './crypto.js';
import type { TeamChannel } from './peerNet.js';
import { fitPacket } from './peerNet.js';
import type { EditableProfile, Profile, TeamOffice } from './profile.js';
import { officeFromSecret, osAccount, saveProfile, validateOfficeName } from './profile.js';
import { redactView } from './redact.js';

const toAgents = (peer: PeerInfo, views: AgentView[]): OfficeAgent[] =>
  views.map((v) => ({
    ...v,
    key: `${peer.id}:${v.id}`,
    ...(v.parentId !== undefined && { parentKey: `${peer.id}:${v.parentId}` }),
    peer,
  }));

/** This PC's views as-is (its own browser); peers redact before sending. */
export function buildOffice(
  self: PeerInfo,
  local: AgentView[],
  peers: PeerPacket[],
): OfficeAgent[] {
  return [...toAgents(self, local), ...peers.flatMap((p) => toAgents(p.peer, p.views))];
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

export interface CreatedOffice {
  tag: string;
  name: string;
  code: string;
}

/** This PC's live LAN state: profile, local agents, peers, offices. */
export class LanService {
  /** Set once PeerNet is up; until then (or if UDP bind failed) there are no peers. */
  net: {
    peers(view: string): PeerPacket[];
    sendNow(): void;
    teamName(tag: string): string | undefined;
  } = { peers: () => [], sendNow: () => {}, teamName: () => undefined };
  private channels: { src: TeamOffice[]; list: TeamChannel[] } | null = null;
  /** This PC's OS account name: fixed, read at start, never from a client. */
  readonly account = osAccount();

  constructor(
    public profile: Profile,
    /** brief=true: commands as program name / description only (hideDetails) */
    private readonly local: { views(brief?: boolean): AgentView[] },
    /** profile.json directory; undefined = ~/.pixel-office */
    private readonly dir?: string,
  ) {}

  self(): PeerInfo {
    const { peerId, nickname, palette, hueShift, nicknameSince } = this.profile;
    return {
      id: peerId,
      account: this.account,
      nickname,
      palette,
      hueShift,
      ...(nickname !== '' && { nickSince: nicknameSince }),
    };
  }

  /** What PeerNet sends (encrypted). Never throws: a failing scan sends no views. */
  packet(): PeerPacket {
    let views: AgentView[] = [];
    try {
      const hide = this.profile.hideDetails;
      views = this.local.views(hide);
      if (hide) views = views.map(redactView);
    } catch (err) {
      console.error('[Pixel Office] Building peer packet failed:', err);
      views = [];
    }
    return fitPacket({ v: 1, peer: this.self(), views });
  }

  /** Joined team offices with their keys, for PeerNet (derived once per offices change). */
  teamChannels(): TeamChannel[] {
    const src = this.profile.offices;
    if (this.channels?.src !== src) {
      this.channels = {
        src,
        list: src.map((o) => ({
          tag: o.tag,
          name: o.name,
          key: teamKey(Buffer.from(o.secret, 'base64')),
        })),
      };
    }
    return this.channels.list;
  }

  /** One office's agents. The public office is empty while this PC is in any team. */
  office(view: string): OfficeAgent[] {
    if (!this.isOpen(view)) return [];
    return buildOffice(this.self(), this.local.views(), this.net.peers(view));
  }

  /** Everyone in one office (this PC first, then live peers, agents or not); same gate as office(). */
  people(view: string): OfficePersonMessage[] {
    if (!this.isOpen(view)) return [];
    return [this.self(), ...this.net.peers(view).map((p) => p.peer)].map((p, i) => ({
      peerId: p.id,
      account: p.account,
      nickname: p.nickname,
      ...(p.nickSince !== undefined && { nickSince: p.nickSince }),
      palette: p.palette,
      hueShift: p.hueShift,
      self: i === 0,
    }));
  }

  /** Another live PC in any office this PC can see (public while in it, every
   *  joined team) already uses this nickname. Unset ('') and keeping the
   *  current nickname are never taken. */
  nicknameTaken(nickname: string): boolean {
    const key = nicknameKey(nickname);
    if (key === '' || key === nicknameKey(this.profile.nickname)) return false;
    const { offices, peerId } = this.profile;
    const views = [...(offices.length === 0 ? [PUBLIC_VIEW] : []), ...offices.map((o) => o.tag)];
    return views.some((v) =>
      this.net.peers(v).some((p) => p.peer.id !== peerId && nicknameKey(p.peer.nickname) === key),
    );
  }

  /** The public office only while in no team; a team office only once joined. */
  private isOpen(view: string): boolean {
    const { offices } = this.profile;
    return view === PUBLIC_VIEW ? offices.length === 0 : offices.some((o) => o.tag === view);
  }

  /** Offices for this PC's browser: names only, never secrets. */
  officeList(): { tag: string; name: string }[] {
    return this.profile.offices.map((o) => ({
      tag: o.tag,
      name: o.name || this.net.teamName(o.tag) || '',
    }));
  }

  /** New team office with a fresh invite code; it becomes the active view. */
  createOffice(name: unknown): CreatedOffice | OfficeErrorReason {
    const n = validateOfficeName(name);
    if (n === null) return 'nameInvalid';
    if (this.profile.offices.length >= MAX_OFFICES) return 'full';
    const code = newInviteCode();
    const office = officeFromSecret(code.secret, n);
    this.update({ offices: [...this.profile.offices, office], activeView: office.tag });
    return { tag: office.tag, name: n, code: code.text };
  }

  /** Join by invite code (name optional: members announce theirs). null = joined.
   *  Already joined → switches to it and still reports 'alreadyJoined'. */
  joinOffice(code: unknown, name?: unknown): OfficeErrorReason | null {
    const secret = typeof code === 'string' ? parseInviteCode(code) : null;
    if (!secret) return 'invalidCode';
    const n = name === undefined || name === '' ? '' : validateOfficeName(name);
    if (n === null) return 'nameInvalid';
    const office = officeFromSecret(secret, n);
    const { offices } = this.profile;
    if (offices.some((o) => o.tag === office.tag)) {
      this.setActiveView(office.tag);
      return 'alreadyJoined';
    }
    if (offices.length >= MAX_OFFICES) return 'full';
    this.update({ offices: [...offices, office], activeView: office.tag });
    return null;
  }

  leaveOffice(tag: unknown): boolean {
    const offices = this.profile.offices.filter((o) => o.tag !== tag);
    if (offices.length === this.profile.offices.length) return false;
    const { activeView } = this.profile;
    this.update({
      offices,
      activeView: offices.some((o) => o.tag === activeView)
        ? activeView
        : (offices[0]?.tag ?? PUBLIC_VIEW),
    });
    return true;
  }

  /** PUBLIC_VIEW only while in no team; otherwise a joined tag. */
  setActiveView(view: unknown): boolean {
    const { offices } = this.profile;
    const ok = view === PUBLIC_VIEW ? offices.length === 0 : offices.some((o) => o.tag === view);
    if (!ok) return false;
    if (view !== this.profile.activeView) this.update({ activeView: view as string });
    return true;
  }

  /** Invite code of a joined office, for re-copying. */
  officeCode(tag: unknown): string | null {
    const o = this.profile.offices.find((x) => x.tag === tag);
    return o ? inviteText(Buffer.from(o.secret, 'base64')) : null;
  }

  /** Persist a validated update and announce it to peers right away. */
  saveProfile(update: EditableProfile): void {
    const changed = nicknameKey(update.nickname) !== nicknameKey(this.profile.nickname);
    this.update({
      ...update,
      setUp: true,
      nicknameSince: !changed
        ? this.profile.nicknameSince
        : update.nickname === ''
          ? 0
          : Date.now(),
    });
  }

  private update(patch: Partial<Profile>): void {
    const next: Profile = { ...this.profile, ...patch };
    saveProfile(next, this.dir);
    this.profile = next;
    this.net.sendNow();
  }
}

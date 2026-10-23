// Merges this PC's and peers' agents into one office; single-instance probe.
import { randomBytes } from 'crypto';

import type {
  AgentView,
  AvatarPos,
  OfficeAgent,
  PeerChat,
  PeerInfo,
  PeerPacket,
} from '../../../core/src/lan.js';
import {
  CHAT_ID_LENGTH,
  CHAT_MIN_INTERVAL_MS,
  nicknameKey,
  parseAvatar,
  parseChat,
  PERSONAL_VIEW,
  PUBLIC_VIEW,
} from '../../../core/src/lan.js';
import type {
  ChatMessage,
  OfficeErrorReason,
  OfficePersonMessage,
} from '../../../core/src/messages.js';
import {
  AVATAR_SAVE_DELAY_MS,
  AVATAR_SEND_DELAY_MS,
  MAX_OFFICES,
  PING_APP,
  PING_TIMEOUT_MS,
} from '../constants.js';
import { inviteText, newInviteCode, parseInviteCode, teamKey } from './crypto.js';
import type { TeamChannel } from './peerNet.js';
import { fitPacket } from './peerNet.js';
import type { EditableProfile, Profile, TeamOffice } from './profile.js';
import {
  isViewOpen,
  officeFromSecret,
  osAccount,
  saveProfile,
  validateOfficeName,
} from './profile.js';
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

const toChatMessage = (c: PeerChat): ChatMessage => ({ id: c.id, text: c.text });

const toPeerChat = ({ id, text, ts }: PeerChat): PeerChat => ({ id, text, ts });

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
  /** When this PC last sent a chat (rate limit; deleting doesn't reset it). */
  private lastChatAt = -Infinity;
  /** Pending coalesced presence send / profile write after avatar moves. */
  private moveSend: NodeJS.Timeout | null = null;
  private moveSave: NodeJS.Timeout | null = null;
  /** A peer's avatar moved (PeerNet); the UI server pushes a snapshot. */
  peerMoved: () => void = () => {};

  constructor(
    public profile: Profile,
    /** brief=true: commands as program name / description only (hideDetails) */
    private readonly local: { views(brief?: boolean): AgentView[] },
    /** profile.json directory; undefined = ~/.pixel-office */
    private readonly dir?: string,
  ) {}

  /** Personal mode: offline (PeerNet sends and accepts nothing), this PC alone. */
  get personal(): boolean {
    return this.profile.activeView === PERSONAL_VIEW;
  }

  self(): PeerInfo {
    const { peerId, nickname, palette, hueShift, pet, nicknameSince } = this.profile;
    return {
      id: peerId,
      account: this.account,
      nickname,
      palette,
      hueShift,
      ...(pet && { pet }),
      ...(nickname !== '' && { nickSince: nicknameSince }),
    };
  }

  /** What PeerNet sends (encrypted) on `channel` (PUBLIC_VIEW or a team tag). Never
   *  throws: a failing scan sends no views. The chat goes only to the view it was said in. */
  packet(channel: string = PUBLIC_VIEW): PeerPacket {
    let views: AgentView[] = [];
    try {
      const hide = this.profile.hideDetails;
      views = this.local.views(hide);
      if (hide) views = views.map(redactView);
    } catch (err) {
      console.error('[Pixel Office] Building peer packet failed:', err);
      views = [];
    }
    const chat = this.ownChat(channel);
    const avatar = this.ownAvatar(channel);
    return fitPacket({
      v: 1,
      peer: this.self(),
      views,
      ...(chat && { chat }),
      ...(avatar && { avatar }),
    });
  }

  /** My avatar in `view`'s layout (personal has its own). */
  private ownAvatar(view: string): AvatarPos | undefined {
    const a = this.profile.avatar?.[view === PERSONAL_VIEW ? 'personal' : 'office'];
    return a && { ...a };
  }

  /** My avatar moved in the active view's layout (strictly validated). Peers hear
   *  it within AVATAR_SEND_DELAY_MS (coalesced), the file within AVATAR_SAVE_DELAY_MS. */
  moveAvatar(raw: unknown): boolean {
    const pos = parseAvatar(raw, true);
    if (!pos) return false;
    const key = this.personal ? 'personal' : 'office';
    this.profile = { ...this.profile, avatar: { ...this.profile.avatar, [key]: pos } };
    this.moveSend ??= setTimeout(() => {
      this.moveSend = null;
      this.net.sendNow();
    }, AVATAR_SEND_DELAY_MS).unref();
    // ponytail: a move in the last AVATAR_SAVE_DELAY_MS before a crash is lost; fine for a position.
    this.moveSave ??= setTimeout(() => {
      this.moveSave = null;
      try {
        saveProfile(this.profile, this.dir);
      } catch (err) {
        console.error('[Pixel Office] Failed to write profile:', err);
      }
    }, AVATAR_SAVE_DELAY_MS).unref();
    return true;
  }

  /** Say `text` as my avatar in the active view, replacing this PC's previous
   *  bubble (saved in profile.json). null = refused (empty, or less than
   *  CHAT_MIN_INTERVAL_MS after the last one). */
  sendChat(text: unknown, now = Date.now()): PeerChat | null {
    if (now - this.lastChatAt < CHAT_MIN_INTERVAL_MS) return null;
    const id = randomBytes(CHAT_ID_LENGTH)
      .toString('base64')
      .replace(/[^0-9a-z]/gi, '')
      .padEnd(CHAT_ID_LENGTH, '0')
      .slice(0, CHAT_ID_LENGTH);
    const chat = parseChat({ id, text, ts: now });
    if (!chat) return null;
    this.lastChatAt = now;
    this.update({ chat: { ...chat, view: this.profile.activeView } });
    return chat;
  }

  /** Remove this PC's bubble. */
  deleteChat(): void {
    if (this.profile.chat) this.update({ chat: undefined });
  }

  private ownChat(view: string): PeerChat | undefined {
    const c = this.profile.chat;
    return c?.view === view ? toPeerChat(c) : undefined;
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
    return buildOffice(this.self(), this.local.views(), this.peersIn(view));
  }

  /** Everyone in one office (this PC first, then live peers, agents or not); same gate as office(). */
  people(view: string): OfficePersonMessage[] {
    if (!this.isOpen(view)) return [];
    const rows = [
      { peer: this.self(), chat: this.ownChat(view), avatar: this.ownAvatar(view) },
      ...this.peersIn(view),
    ];
    return rows.map(({ peer: p, chat, avatar }, i) => ({
      peerId: p.id,
      account: p.account,
      nickname: p.nickname,
      ...(p.nickSince !== undefined && { nickSince: p.nickSince }),
      palette: p.palette,
      hueShift: p.hueShift,
      ...(p.pet && { pet: p.pet }),
      self: i === 0,
      ...(chat && { chat: toChatMessage(chat) }),
      ...(avatar && { avatar: { ...avatar } }),
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

  /** Live peers of a view; none at all in personal mode (PeerNet is offline too). */
  private peersIn(view: string): PeerPacket[] {
    return this.personal ? [] : this.net.peers(view);
  }

  /** The public office only while in no team; a team office only once joined. */
  private isOpen(view: string): boolean {
    return isViewOpen(this.profile.offices, view);
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
      activeView: isViewOpen(offices, activeView) ? activeView : (offices[0]?.tag ?? PUBLIC_VIEW),
    });
    return true;
  }

  /** PUBLIC_VIEW only while in no team, a joined tag, or PERSONAL_VIEW (always). */
  setActiveView(view: unknown): boolean {
    if (!isViewOpen(this.profile.offices, view)) return false;
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
      pet: update.pet, // absent in the update = back to the human
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
    // A bubble lives in its office: leaving it (or joining a team, for public) drops it.
    if (!next.chat || !isViewOpen(next.offices, next.chat.view)) delete next.chat;
    saveProfile(next, this.dir);
    this.profile = next;
    this.net.sendNow();
  }
}

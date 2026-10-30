import type { AvatarDir, OfficeAgent, Room } from '../../../core/src/lan.js';
import { parseAvatar, ROOM_LABELS } from '../../../core/src/lan.js';
import type { OfficePersonMessage, TagColors } from '../../../core/src/messages.js';
import { LAN_KIND_BADGES, LAN_ROOM_TOOL } from '../constants.js';
import { actText, t } from '../i18n.js';
import { requestRender } from '../office/engine/gameLoop.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { Direction } from '../office/types.js';
import { isDemoKey } from '../tour/demoAgents.js';
import { avatarLabel } from './nicknames.js';

const DIRS: Record<AvatarDir, Direction> = {
  down: Direction.DOWN,
  up: Direction.UP,
  left: Direction.LEFT,
  right: Direction.RIGHT,
};
/** Protocol name of a facing. */
export const avatarDirName = (d: Direction): AvatarDir =>
  (Object.keys(DIRS) as AvatarDir[]).find((k) => DIRS[k] === d) ?? 'down';

const ARROWS: Readonly<Record<string, Direction>> = {
  ArrowUp: Direction.UP,
  ArrowDown: Direction.DOWN,
  ArrowLeft: Direction.LEFT,
  ArrowRight: Direction.RIGHT,
};

/** The facing an arrow key asks for; undefined for any other key. */
export const arrowDir = (key: string): Direction | undefined =>
  Object.hasOwn(ARROWS, key) ? ARROWS[key] : undefined;

/** A person's avatar on screen (name tag, chat bubble anchor). */
export interface AvatarRef {
  peerId: string;
  id: number;
  /** Nickname if set, else the account. */
  label: string;
  self: boolean;
  /** Their chosen tag colours; absent = the default tag. */
  tagColors?: TagColors;
}

/** The provider badge before an agent's activity line (i18n-neutral). */
export const providerName = (a: OfficeAgent): string =>
  a.provider === 'claude' ? 'Claude' : 'Codex';

/**
 * An agent's one-line name tag after its MAIN/SUB/SHELL badge (drawn separately): `#n` and the
 * nickname (else the account). A subagent or shell shows its parent's number (`parent` = the
 * parent's agent; without it, no number).
 */
export function tagText(a: OfficeAgent, parent?: OfficeAgent): string {
  const main = a.kind === 'main' ? a : parent;
  const name = avatarLabel((main ?? a).peer);
  return main ? `#${main.num} ${name}` : name;
}

/**
 * What an agent does, for its bubble and room card: the command alone for a run (its room,
 * 서버실, already says "running a command"), else the full activity text.
 */
export const activityText = (a: OfficeAgent): string =>
  a.hidden ? t('act.hidden') : a.act === 'run' && a.target ? a.target : actText(a.act, a.target);

/** The badge at the front of a tag (i18n-neutral): MAIN / SUB / SHELL. */
export const tagBadge = (a: OfficeAgent): string => LAN_KIND_BADGES[a.kind].text;

/** A character's look: the palette human, or a pet (`pet` set). */
export interface Look {
  palette: number;
  hueShift: number;
  pet?: string;
}

/** The PC's own look (main agents). */
const peerLook = (p: OfficeAgent['peer']): Look => ({
  palette: p.palette,
  hueShift: p.hueShift,
  pet: p.pet,
});

/** Look of an agent's character: its PC's (human or pet) for main, subagent and shell
 *  alike — the MAIN / SUB / SHELL badge tells them apart. */
export const looks = (a: OfficeAgent): Look => peerLook(a.peer);

/** Agents per room: main agents by room, `extra` = subagents + shells. */
export interface RoomCount {
  main: number;
  extra: number;
}

export function roomCounts(agents: readonly OfficeAgent[]): Map<string, RoomCount> {
  const counts = new Map<string, RoomCount>(
    Object.values(ROOM_LABELS).map((label) => [label, { main: 0, extra: 0 }]),
  );
  for (const a of agents) {
    const c = counts.get(ROOM_LABELS[a.room])!;
    if (a.kind === 'main') c.main++;
    else c.extra++;
  }
  return counts;
}

/** The count chip beside a room plate ("에이전트 5": mains and children together); null when empty. */
export function plateCount(c: RoomCount | undefined): string | null {
  const n = c ? c.main + c.extra : 0;
  return n > 0 ? t('plate.agents', { n: String(n) }) : null;
}

/** Agents in a room for its plate's cards: by PC, each main followed by its children. */
export function roomAgents(agents: readonly OfficeAgent[], room: Room): OfficeAgent[] {
  const here = agents.filter((a) => a.room === room);
  const order = (a: OfficeAgent) => {
    const main = a.kind === 'main' ? a : here.find((m) => m.key === a.parentKey);
    return [a.peer.id, main?.num ?? Infinity, a.kind === 'main' ? 0 : 1, a.key] as const;
  };
  return here.sort((x, y) => {
    const a = order(x);
    const b = order(y);
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
    return 0;
  });
}

/**
 * Reconciles `officeSnapshot` agents into OfficeState characters: stable ids
 * per key (never reused in a page session), room moves, permission bubbles,
 * and children holding hands with their parent when they share its room.
 * O(n) per snapshot; seat searches only on a room change.
 */
export class LanAgents {
  private readonly ids = new Map<string, number>();
  private readonly byId = new Map<number, OfficeAgent>();
  private agents: OfficeAgent[] = [];
  /** Latest snapshot agents and client-only tour demos; shown together. */
  private real: OfficeAgent[] = [];
  private demo: OfficeAgent[] = [];
  private nextId = 1;
  /** A real snapshot was reconciled: agents that start working later step out of their avatar. */
  private primed = false;
  private readonly os: OfficeState;
  private highlight: string | null = null;
  /** Peer whose name tags are emphasized (people panel hover); null = none. */
  get highlightPeer(): string | null {
    return this.highlight;
  }
  set highlightPeer(peerId: string | null) {
    if (this.highlight === peerId) return;
    this.highlight = peerId;
    requestRender('highlight');
  }

  /** peerId → avatar character id (one per live person of the viewed office). */
  private readonly avatarIds = new Map<string, number>();
  private people: OfficePersonMessage[] = [];
  /** My avatar was placed where the server had no (usable) spot: save it there. */
  onSelfPlaced: (col: number, row: number, dir: Direction) => void = () => {};

  constructor(os: OfficeState) {
    this.os = os;
  }

  /**
   * The snapshot's people → one avatar each (their look, their spot). Mine is
   * placed once from the server's spot (then the arrow keys own it); others
   * walk to their latest spot. Peer coords are re-validated (clamped).
   */
  applyPeople(people: OfficePersonMessage[]): void {
    this.people = people;
    const os = this.os;
    const seen = new Set<string>();
    for (const p of people) {
      seen.add(p.peerId);
      const look: Look = { palette: p.palette, hueShift: p.hueShift, pet: p.pet };
      const a = parseAvatar(p.avatar);
      const at = a && { col: a.col, row: a.row, dir: DIRS[a.dir] };
      let id = this.avatarIds.get(p.peerId);
      if (id === undefined) {
        id = this.nextId++;
        this.avatarIds.set(p.peerId, id);
        const t = os.addAvatar(id, p.peerId, look, at);
        if (p.self) {
          os.myAvatarId = id;
          if (!at || t.col !== at.col || t.row !== at.row) {
            this.onSelfPlaced(t.col, t.row, at?.dir ?? Direction.DOWN);
          }
        }
        continue;
      }
      this.restyle(id, look);
      if (!p.self && at) os.walkAvatarTo(id, at);
    }
    for (const [peerId, id] of this.avatarIds) {
      if (seen.has(peerId)) continue;
      os.removeAgent(id);
      this.avatarIds.delete(peerId);
      if (os.myAvatarId === id) os.myAvatarId = null;
    }
    requestRender('snapshot');
  }

  /** A new layout (mode switch, reset): my avatar is placed again from the next snapshot. */
  resetSelfAvatar(): void {
    const id = this.os.myAvatarId;
    if (id === null) return;
    for (const [peerId, v] of this.avatarIds) if (v === id) this.avatarIds.delete(peerId);
    this.os.removeAgent(id);
    this.os.myAvatarId = null;
  }

  /** Every live person's avatar (characters still spawning included). */
  avatars(): AvatarRef[] {
    const out: AvatarRef[] = [];
    for (const p of this.people) {
      const id = this.avatarIds.get(p.peerId);
      if (id === undefined) continue;
      const { peerId, self, tagColors } = p;
      out.push({ peerId, id, label: avatarLabel(p), self, tagColors });
    }
    return out;
  }

  /** A fresh `officeSnapshot`. */
  apply(agents: OfficeAgent[]): void {
    // A peer can never impersonate a tour demo (their keys are client-only).
    this.real = agents.filter((a) => !isDemoKey(a.key));
    this.reconcile();
    this.primed = true;
  }

  /** Client-only tour demo agents (never sent anywhere); [] removes them. */
  setDemo(agents: OfficeAgent[]): void {
    this.demo = agents;
    this.reconcile();
  }

  /** Snapshot agents only (no tour demos). */
  realAgents(): OfficeAgent[] {
    return this.real;
  }

  private reconcile(): void {
    const agents = this.demo.length ? [...this.real, ...this.demo] : this.real;
    const os = this.os;
    const prevByKey = new Map<string, OfficeAgent>();
    for (const a of this.agents) prevByKey.set(a.key, a);
    const seen = new Set<string>();
    /** Keys shown as characters (an agent in the lounge is folded into its PC's avatar). */
    const shown = new Set<string>();

    for (const a of agents) {
      seen.add(a.key);
      let id = this.ids.get(a.key);
      if (id === undefined) {
        id = this.nextId++;
        this.ids.set(a.key, id);
      }
      this.byId.set(id, a);
      const avatarId = this.avatarIds.get(a.peer.id);
      const ch = os.characters.get(id);
      if (a.room === 'lounge' && avatarId !== undefined) {
        if (ch) os.mergeAgent(id, avatarId);
        continue;
      }
      shown.add(a.key);
      const look = looks(a);
      if (!ch || ch.matrixEffect === 'despawn') {
        if (ch) os.characters.delete(id); // merged away mid-despawn: start over
        const depart = this.primed && avatarId !== undefined;
        os.addAgent(id, look.palette, look.hueShift, undefined, depart);
        if (depart) os.departFrom(id, avatarId);
      } else if (ch.mergeInto !== undefined) {
        os.cancelMerge(id); // homeArea is unset: re-homed below
      }
      this.restyle(id, look);
      if (a.permission) os.showPermissionBubble(id);
      else os.clearPermissionBubble(id);
    }

    for (const [key, id] of this.ids) {
      if (seen.has(key)) continue;
      os.removeAgent(id);
      this.ids.delete(key);
      this.byId.delete(id);
    }
    this.agents = agents;

    // Everyone sits in the room of its own state; a child in the same room as
    // its parent walks hand in hand with it, a child elsewhere acts on its own.
    const byKey = new Map<string, OfficeAgent>();
    for (const a of agents) byKey.set(a.key, a);
    os.roomCounts = roomCounts(agents);
    for (const a of agents) {
      if (!shown.has(a.key)) continue;
      const id = this.ids.get(a.key)!;
      const parent = a.parentKey !== undefined ? byKey.get(a.parentKey) : undefined;
      if (parent?.room === a.room && shown.has(parent.key)) {
        os.setFollowTarget(id, this.ids.get(parent.key)!);
        continue;
      }
      os.setFollowTarget(id, null);
      const ch = os.characters.get(id);
      if (ch && (prevByKey.get(a.key)?.room !== a.room || ch.homeArea === undefined)) {
        this.enterRoom(id, a.room);
      }
    }
    requestRender('snapshot');
  }

  /** A PC edited its profile: existing characters take the new look. */
  private restyle(id: number, look: Look): void {
    const ch = this.os.characters.get(id);
    if (!ch) return;
    ch.palette = look.palette;
    ch.hueShift = look.hueShift;
    ch.pet = look.pet;
  }

  /** Lounge idles (seated, or standing still when the room is full); every other room works at a desk. */
  private enterRoom(id: number, room: Room): void {
    const tool = LAN_ROOM_TOOL[room];
    // Before moveToArea: deactivating clears the path it is about to set.
    this.os.setAgentActive(id, tool !== null);
    this.os.setAgentTool(id, tool);
    this.os.moveToArea(id, ROOM_LABELS[room]);
  }

  /** PCs (peerId) with an agent folded into their avatar that waits for an answer. */
  waitingPeers(): Set<string> {
    const out = new Set<string>();
    for (const a of this.agents) {
      if (a.room === 'lounge' && (a.permission || a.act === 'ask') && this.avatarIds.has(a.peer.id))
        out.add(a.peer.id);
    }
    return out;
  }

  idFor(key: string): number | undefined {
    return this.ids.get(key);
  }

  agentFor(id: number): OfficeAgent | undefined {
    return this.byId.get(id);
  }

  all(): OfficeAgent[] {
    return this.agents;
  }
}

import type { OfficeAgent, Room } from '../../../core/src/lan.js';
import { ROOM_LABELS } from '../../../core/src/lan.js';
import {
  LAN_KIND_BADGES,
  LAN_ROOM_TOOL,
  LAN_SHELL_PALETTE,
  LAN_SUBAGENT_HUE_OFFSET,
  MAX_HUE_DEG,
  PARENT_FOLLOW_DEBOUNCE_MS,
} from '../constants.js';
import { areaName } from '../i18n.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { isDemoKey } from '../tour/demoAgents.js';
import { peerLabel } from './nicknames.js';

const providerName = (a: OfficeAgent): string => (a.provider === 'claude' ? 'Claude' : 'Codex');

/**
 * Text of an agent's name tag (the provider dot and the SUB/SHELL badge are
 * drawn separately): `account (nickname) · Provider #n`. A subagent or shell
 * shows its parent's label (`parent` = the parent's agent; without it, the
 * same PC and provider, no number).
 */
export function tagText(a: OfficeAgent, parent?: OfficeAgent): string {
  const main = a.kind === 'main' ? a : parent;
  if (!main) return `${peerLabel(a.peer)} · ${providerName(a)}`;
  return `${peerLabel(main.peer)} · ${providerName(main)} #${main.num}`;
}

/** The badge after a child's tag (i18n-neutral), null for a main agent. */
export const tagBadge = (a: OfficeAgent): string | null =>
  a.kind === 'main' ? null : LAN_KIND_BADGES[a.kind].text;

/** A character's look: the palette human, or a pet (`pet` set). */
export interface Look {
  palette: number;
  hueShift: number;
  pet?: string;
}

/** The PC's own look (main agents and ghost parents). */
const peerLook = (p: OfficeAgent['peer']): Look => ({
  palette: p.palette,
  hueShift: p.hueShift,
  pet: p.pet,
});

/** Look of an agent's character: main = its PC's (human or pet), subagent = the
 *  same, hue-rotated, shell = fixed human. */
export function looks(a: OfficeAgent): Look {
  if (a.kind === 'shell') return { palette: LAN_SHELL_PALETTE, hueShift: 0 };
  const look = peerLook(a.peer);
  if (a.kind === 'subagent') {
    look.hueShift = (look.hueShift + LAN_SUBAGENT_HUE_OFFSET) % MAX_HUE_DEG;
  }
  return look;
}

/** A parent with nothing of its own to do (resting or delegating in 대기실, no ❗) joins its children. */
const freeToFollow = (a: OfficeAgent): boolean =>
  a.room === 'lounge' && !a.permission && (a.act === 'idle' || a.act === 'delegate');

/**
 * The room a main agent wants to be shown in: its own, unless it is free to
 * follow (see freeToFollow) and has children — then the room with the most
 * of them (tie → one with a subagent beats shells only → the room whose
 * child entered it first; `since` = when a child entered its room, smaller =
 * earlier).
 */
export function wantedRoom(
  parent: OfficeAgent,
  children: readonly OfficeAgent[],
  since: (child: OfficeAgent) => number,
): Room {
  if (children.length === 0 || !freeToFollow(parent)) return parent.room;
  const rooms = new Map<Room, { n: number; sub: boolean; first: number }>();
  for (const c of children) {
    const r = rooms.get(c.room) ?? { n: 0, sub: false, first: Infinity };
    r.n++;
    r.sub ||= c.kind === 'subagent';
    r.first = Math.min(r.first, since(c));
    rooms.set(c.room, r);
  }
  type Tally = { n: number; sub: boolean; first: number };
  const better = (r: Tally, b: Tally): boolean =>
    r.n !== b.n ? r.n > b.n : r.sub !== b.sub ? r.sub : r.first < b.first;
  let best: [Room, Tally] | null = null;
  for (const e of rooms) if (!best || better(e[1], best[1])) best = e;
  return best![0];
}

/** Agents per room: main agents by display room, `extra` = subagents + shells (ghosts are not agents). */
export interface RoomCount {
  main: number;
  extra: number;
}

export function roomCounts(
  agents: readonly OfficeAgent[],
  displayRoom: (a: OfficeAgent) => Room,
): Map<string, RoomCount> {
  const counts = new Map<string, RoomCount>(
    Object.values(ROOM_LABELS).map((label) => [label, { main: 0, extra: 0 }]),
  );
  for (const a of agents) {
    const c = counts.get(ROOM_LABELS[a.kind === 'main' ? displayRoom(a) : a.room])!;
    if (a.kind === 'main') c.main++;
    else c.extra++;
  }
  return counts;
}

/** A room name plate (same format in every language): "코딩실 5", with children "코딩실 5 · +3". */
export function plateText(label: string, c: RoomCount | undefined): string {
  const name = areaName(label);
  if (!c) return name;
  return c.extra > 0 ? `${name} ${c.main} · +${c.extra}` : `${name} ${c.main}`;
}

/**
 * Reconciles `officeSnapshot` agents into OfficeState characters: stable ids
 * per key (never reused in a page session), room moves, permission bubbles,
 * and children holding hands with their parent — or with a translucent ghost
 * of it in a room the parent is not in. A parent free to follow (wantedRoom)
 * walks to its children's room and leads them itself (its *display room*;
 * a change waits PARENT_FOLLOW_DEBOUNCE_MS, except when the parent's own
 * state takes it back). O(n) per snapshot; seat searches only on a room
 * change. `agentFor(ghostId)` is the real parent's agent.
 */
export class LanAgents {
  private readonly ids = new Map<string, number>();
  private readonly byId = new Map<number, OfficeAgent>();
  /** `${parentKey}@${room}` → ghost character id */
  private readonly ghosts = new Map<string, number>();
  private agents: OfficeAgent[] = [];
  /** Latest snapshot agents and client-only tour demos; shown together. */
  private real: OfficeAgent[] = [];
  private demo: OfficeAgent[] = [];
  private nextId = 1;
  /** main key → shown room (`following` = with its children, not its own room) and the latest wish with its start time */
  private readonly shown = new Map<
    string,
    { room: Room; following: boolean; wish: Room; wishSince: number }
  >();
  /** child key → [room, order it entered that room] (tie-break of wantedRoom) */
  private readonly entered = new Map<string, [Room, number]>();
  private enterSeq = 0;
  private readonly os: OfficeState;
  private readonly now: () => number;
  /** Peer whose name tags are emphasized (people panel hover); null = none. */
  highlightPeer: string | null = null;

  constructor(os: OfficeState, now: () => number = Date.now) {
    this.os = os;
    this.now = now;
  }

  /** Where an agent is shown: a main agent's display room, a child's own room. */
  displayRoom(a: OfficeAgent): Room {
    return this.shown.get(a.key)?.room ?? a.room;
  }

  /** The display room a main agent moves to now: joining its children or
   *  leaving them waits until the wish held PARENT_FOLLOW_DEBOUNCE_MS; its own
   *  room (first sighting, own work, ❗/ask, a real room change) is immediate. */
  private nextRoom(a: OfficeAgent, children: readonly OfficeAgent[]): Room {
    const wish = wantedRoom(a, children, (c) => this.entered.get(c.key)?.[1] ?? 0);
    const now = this.now();
    let st = this.shown.get(a.key);
    if (!st || !freeToFollow(a)) {
      st = { room: wish, following: wish !== a.room, wish, wishSince: now };
      this.shown.set(a.key, st);
      return wish;
    }
    // Not with its children: it simply is in its own room.
    if (!st.following) st.room = a.room;
    if (wish !== st.wish) {
      st.wish = wish;
      st.wishSince = now;
    }
    if (st.wish !== st.room && now - st.wishSince >= PARENT_FOLLOW_DEBOUNCE_MS) st.room = st.wish;
    st.following = st.room !== a.room;
    return st.room;
  }

  /** A fresh `officeSnapshot`. */
  apply(agents: OfficeAgent[]): void {
    // A peer can never impersonate a tour demo (their keys are client-only).
    this.real = agents.filter((a) => !isDemoKey(a.key));
    this.reconcile();
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

    for (const a of agents) {
      seen.add(a.key);
      let id = this.ids.get(a.key);
      if (id === undefined) {
        id = this.nextId++;
        this.ids.set(a.key, id);
        const look = looks(a);
        os.addAgent(id, look.palette, look.hueShift);
        this.restyle(id, look);
      } else {
        this.restyle(id, looks(a));
      }
      this.byId.set(id, a);
      const prev = prevByKey.get(a.key);
      if (prev?.permission !== a.permission) {
        if (a.permission) os.showPermissionBubble(id);
        else os.clearPermissionBubble(id);
      }
    }

    for (const [key, id] of this.ids) {
      if (seen.has(key)) continue;
      os.removeAgent(id);
      this.ids.delete(key);
      this.byId.delete(id);
      this.shown.delete(key);
      this.entered.delete(key);
    }
    this.agents = agents;

    // Parents first (at their display room); then every child walks hand in
    // hand with a leader: its parent shown in the same room, else the
    // parent's ghost in the child's room.
    const byKey = new Map<string, OfficeAgent>();
    const kids = new Map<string, OfficeAgent[]>();
    for (const a of agents) {
      byKey.set(a.key, a);
      if (a.parentKey === undefined) continue;
      if (this.entered.get(a.key)?.[0] !== a.room)
        this.entered.set(a.key, [a.room, this.enterSeq++]);
      const list = kids.get(a.parentKey);
      if (list) list.push(a);
      else kids.set(a.parentKey, [a]);
    }
    for (const a of agents) {
      if (a.parentKey !== undefined) continue;
      const before = this.shown.get(a.key)?.room;
      const room = a.kind === 'main' ? this.nextRoom(a, kids.get(a.key) ?? []) : a.room;
      const id = this.ids.get(a.key)!;
      const ch = os.characters.get(id);
      const moved = before !== room || prevByKey.get(a.key)?.room !== a.room;
      if (ch && (moved || ch.homeArea === undefined)) this.enterRoom(id, room, room !== a.room);
    }
    os.roomCounts = roomCounts(agents, (a) => this.displayRoom(a));
    const liveGhosts = new Set<string>();
    for (const a of agents) {
      if (a.parentKey === undefined) continue;
      const parent = byKey.get(a.parentKey);
      // The parent leads once it is shown in this room AND has arrived; on its
      // way in, the ghost keeps the children where they are.
      const parentId = this.ids.get(a.parentKey);
      let leader =
        parent &&
        parentId !== undefined &&
        this.displayRoom(parent) === a.room &&
        os.characterArea(parentId) === ROOM_LABELS[a.room]
          ? parentId
          : undefined;
      if (leader === undefined) {
        const ghostKey = `${a.parentKey}@${a.room}`;
        liveGhosts.add(ghostKey);
        leader = this.ghost(ghostKey, a, parent);
      }
      os.setFollowTarget(this.ids.get(a.key)!, leader);
    }
    for (const [ghostKey, id] of this.ghosts) {
      if (liveGhosts.has(ghostKey)) continue;
      os.removeAgent(id);
      this.ghosts.delete(ghostKey);
      this.byId.delete(id);
    }
  }

  /** The parent's ghost standing in `child`'s room (created on first need). Hovering it means the parent. */
  private ghost(ghostKey: string, child: OfficeAgent, parent: OfficeAgent | undefined): number {
    let id = this.ghosts.get(ghostKey);
    if (id === undefined) {
      id = this.nextId++;
      this.ghosts.set(ghostKey, id);
      // A parent wears its PC's look, which every child of that PC carries in `peer`.
      this.os.addAgent(id, child.peer.palette, child.peer.hueShift);
      this.os.moveToArea(id, ROOM_LABELS[child.room], true);
    }
    this.restyle(id, peerLook(child.peer));
    const parentId = child.parentKey !== undefined ? this.ids.get(child.parentKey) : undefined;
    const ch = this.os.characters.get(id);
    if (ch) ch.ghostOf = parentId ?? id;
    if (parent) this.byId.set(id, parent);
    else this.byId.delete(id);
    return id;
  }

  /** A PC edited its profile: existing characters take the new look. */
  private restyle(id: number, look: Look): void {
    const ch = this.os.characters.get(id);
    if (!ch) return;
    ch.palette = look.palette;
    ch.hueShift = look.hueShift;
    ch.pet = look.pet;
  }

  /** Lounge idles (seated, or standing still when the room is full); every other room works at a
   *  desk. A parent joining its children (`leading`) stands there, idle, like a ghost. */
  private enterRoom(id: number, room: Room, leading = false): void {
    const tool = leading ? null : LAN_ROOM_TOOL[room];
    // Before moveToArea: deactivating clears the path it is about to set.
    this.os.setAgentActive(id, tool !== null);
    this.os.setAgentTool(id, tool);
    this.os.moveToArea(id, ROOM_LABELS[room], leading);
  }

  /** The ghost of `parentKey` leading its children in `room`, if any. */
  ghostIdFor(parentKey: string, room: Room): number | undefined {
    return this.ghosts.get(`${parentKey}@${room}`);
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

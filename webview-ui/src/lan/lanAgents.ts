import type { OfficeAgent, Room } from '../../../core/src/lan.js';
import { ROOM_LABELS } from '../../../core/src/lan.js';
import {
  LAN_KIND_BADGES,
  LAN_ROOM_TOOL,
  LAN_SHELL_PALETTE,
  LAN_SUBAGENT_HUE_OFFSET,
  MAX_HUE_DEG,
} from '../constants.js';
import { areaName } from '../i18n.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { isDemoKey } from '../tour/demoAgents.js';
import { peerLabel } from './nicknames.js';

const providerName = (a: OfficeAgent): string => (a.provider === 'claude' ? 'Claude' : 'Codex');

/**
 * The two lines of an agent's name tag (the provider dot before line 2 and the
 * MAIN/SUB/SHELL badge after it are drawn separately): `account (nickname)` and
 * `Provider #n`. A subagent or shell shows its parent's provider and number
 * (`parent` = the parent's agent; without it, the same PC and provider, no number).
 */
export function tagLines(a: OfficeAgent, parent?: OfficeAgent): [string, string] {
  const main = a.kind === 'main' ? a : parent;
  if (!main) return [peerLabel(a.peer), providerName(a)];
  return [peerLabel(main.peer), `${providerName(main)} #${main.num}`];
}

/** The badge after a tag (i18n-neutral): MAIN / SUB / SHELL. */
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

/** A room name plate (same format in every language): "코딩실 5", with children "코딩실 5 · +3". */
export function plateText(label: string, c: RoomCount | undefined): string {
  const name = areaName(label);
  if (!c) return name;
  return c.extra > 0 ? `${name} ${c.main} · +${c.extra}` : `${name} ${c.main}`;
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
  private readonly os: OfficeState;
  /** Peer whose name tags are emphasized (people panel hover); null = none. */
  highlightPeer: string | null = null;

  constructor(os: OfficeState) {
    this.os = os;
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
    }
    this.agents = agents;

    // Everyone sits in the room of its own state; a child in the same room as
    // its parent walks hand in hand with it, a child elsewhere acts on its own.
    const byKey = new Map<string, OfficeAgent>();
    for (const a of agents) byKey.set(a.key, a);
    os.roomCounts = roomCounts(agents);
    for (const a of agents) {
      const id = this.ids.get(a.key)!;
      const parent = a.parentKey !== undefined ? byKey.get(a.parentKey) : undefined;
      if (parent?.room === a.room) {
        os.setFollowTarget(id, this.ids.get(parent.key)!);
        continue;
      }
      os.setFollowTarget(id, null);
      const ch = os.characters.get(id);
      if (ch && (prevByKey.get(a.key)?.room !== a.room || ch.homeArea === undefined)) {
        this.enterRoom(id, a.room);
      }
    }
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

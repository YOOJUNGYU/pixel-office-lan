import type { OfficeAgent, Room } from '../../../core/src/lan.js';
import { ROOM_LABELS } from '../../../core/src/lan.js';
import {
  LAN_ROOM_TOOL,
  LAN_SHELL_PALETTE,
  LAN_SUBAGENT_HUE_OFFSET,
  MAX_HUE_DEG,
} from '../constants.js';
import { t } from '../i18n.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { isDemoKey } from '../tour/demoAgents.js';
import { peerLabel } from './nicknames.js';

/** Text of an agent's name tag (the provider dot is drawn separately). */
export function tagText(a: OfficeAgent): string {
  if (a.kind === 'subagent') return t('tag.subagent');
  if (a.kind === 'shell') return t('tag.shell');
  return `${peerLabel(a.peer)} · ${a.provider === 'claude' ? 'Claude' : 'Codex'} #${a.num}`;
}

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

/**
 * Reconciles `officeSnapshot` agents into OfficeState characters: stable ids
 * per key (never reused in a page session), room moves, permission bubbles,
 * and children holding hands with their parent — or with a translucent ghost
 * of it in a room the parent is not in. O(n) per snapshot; seat searches only
 * on a room change. `agentFor(ghostId)` is the real parent's agent.
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

    // Parents first; then every child walks hand in hand with a leader: its
    // parent in the same room, else the parent's ghost in the child's room.
    const byKey = new Map<string, OfficeAgent>();
    for (const a of agents) byKey.set(a.key, a);
    for (const a of agents) {
      if (a.parentKey !== undefined) continue;
      const id = this.ids.get(a.key)!;
      const ch = os.characters.get(id);
      if (ch && (prevByKey.get(a.key)?.room !== a.room || ch.homeArea === undefined)) {
        this.enterRoom(id, a.room);
      }
    }
    const liveGhosts = new Set<string>();
    for (const a of agents) {
      if (a.parentKey === undefined) continue;
      const parent = byKey.get(a.parentKey);
      let leader = parent?.room === a.room ? this.ids.get(a.parentKey) : undefined;
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

  /** Lounge idles (wanders in the room); every other room works at a desk. */
  private enterRoom(id: number, room: Room): void {
    const tool = LAN_ROOM_TOOL[room];
    // Before moveToArea: deactivating clears the path it is about to set.
    this.os.setAgentActive(id, tool !== null);
    this.os.setAgentTool(id, tool);
    this.os.moveToArea(id, ROOM_LABELS[room]);
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

// People panel model: who is in the viewed office, what their agents are up to.

import type { OfficeAgent } from '../../../core/src/lan.js';
import type { OfficePersonMessage } from '../../../core/src/messages.js';

export type PersonStatus = 'attention' | 'working' | 'idle';

export interface PersonRow {
  person: OfficePersonMessage;
  /** Main agents per provider (subagents and shells are not counted). */
  claude: number;
  codex: number;
  status: PersonStatus;
  /** The agent a click follows: ❗ first, then working, then any main; null = no agents. */
  focusKey: string | null;
}

/** The name the panel shows (unnamed people get the i18n placeholder). */
export const displayName = (p: OfficePersonMessage, unset: string): string => p.nickname || unset;

/** Why a click did nothing: no agents at all, or the character has not spawned yet. */
export const focusHintKey = (r: PersonRow): 'people.noAgents' | 'people.retry' =>
  r.focusKey === null ? 'people.noAgents' : 'people.retry';

/** `rows` in the order of `frozen` peerIds (unknown rows last, in their own order). */
export function inFrozenOrder(rows: PersonRow[], frozen: string[]): PersonRow[] {
  const at = (r: PersonRow) => {
    const i = frozen.indexOf(r.person.peerId);
    return i < 0 ? frozen.length : i;
  };
  return [...rows].sort((a, b) => at(a) - at(b));
}

const RANK: Record<PersonStatus, number> = { attention: 0, working: 1, idle: 2 };
const working = (a: OfficeAgent): boolean => a.room !== 'lounge';

/**
 * Snapshot people + agents → panel rows. A PC that only appears through its
 * agents (the tour's demo characters) still gets a row. Order: me, then ❗,
 * working, idle, then by nickname.
 */
export function peopleRows(
  people: OfficePersonMessage[],
  agents: OfficeAgent[],
  unset = '',
): PersonRow[] {
  const byPeer = new Map<string, OfficeAgent[]>();
  for (const a of agents) {
    const list = byPeer.get(a.peer.id);
    if (list) list.push(a);
    else byPeer.set(a.peer.id, [a]);
  }
  // A peer spoofing another's id must not duplicate a row (React key): self, then first, wins.
  const uniq = new Map<string, OfficePersonMessage>();
  for (const p of people) {
    const prev = uniq.get(p.peerId);
    if (!prev || (p.self && !prev.self)) uniq.set(p.peerId, p);
  }
  const all = [...uniq.values()];
  const known = new Set(uniq.keys());
  for (const [id, list] of byPeer) {
    if (known.has(id)) continue;
    const { nickname, palette, hueShift } = list[0].peer;
    all.push({ peerId: id, nickname, palette, hueShift, self: false });
  }
  const rows = all.map((person): PersonRow => {
    const mine = byPeer.get(person.peerId) ?? [];
    const mains = mine.filter((a) => a.kind === 'main');
    const status: PersonStatus = mine.some((a) => a.permission)
      ? 'attention'
      : mains.some(working)
        ? 'working'
        : 'idle';
    // A ❗ subagent focuses its parent main agent (the subagent has no character of its own to follow).
    const asking = mine.find((a) => a.permission);
    const askMain =
      asking?.kind === 'main' ? asking : mains.find((a) => a.key === asking?.parentKey);
    const focus = askMain ?? mains.find(working) ?? mains[0];
    return {
      person,
      claude: mains.filter((a) => a.provider === 'claude').length,
      codex: mains.filter((a) => a.provider === 'codex').length,
      status,
      focusKey: focus?.key ?? null,
    };
  });
  return rows.sort(
    (a, b) =>
      Number(b.person.self) - Number(a.person.self) ||
      RANK[a.status] - RANK[b.status] ||
      displayName(a.person, unset).localeCompare(displayName(b.person, unset)) ||
      a.person.peerId.localeCompare(b.person.peerId),
  );
}

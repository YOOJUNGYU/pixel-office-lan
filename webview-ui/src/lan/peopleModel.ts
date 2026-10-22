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

const RANK: Record<PersonStatus, number> = { attention: 0, working: 1, idle: 2 };
const working = (a: OfficeAgent): boolean => a.room !== 'lounge';

/**
 * Snapshot people + agents → panel rows. A PC that only appears through its
 * agents (the tour's demo characters) still gets a row. Order: me, then ❗,
 * working, idle, then by nickname.
 */
export function peopleRows(people: OfficePersonMessage[], agents: OfficeAgent[]): PersonRow[] {
  const byPeer = new Map<string, OfficeAgent[]>();
  for (const a of agents) {
    const list = byPeer.get(a.peer.id);
    if (list) list.push(a);
    else byPeer.set(a.peer.id, [a]);
  }
  const all = [...people];
  const known = new Set(people.map((p) => p.peerId));
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
    const focus = mains.find((a) => a.permission) ?? mains.find(working) ?? mains[0];
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
      a.person.nickname.localeCompare(b.person.nickname) ||
      a.person.peerId.localeCompare(b.person.peerId),
  );
}

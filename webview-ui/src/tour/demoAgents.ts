// Client-only demo characters for the onboarding tour. They go through
// LanAgents like snapshot agents but are never sent anywhere.

import type { OfficeAgent, PeerInfo, Room } from '../../../core/src/lan.js';
import { TOUR_DEMO_MIN_AGENTS, TOUR_DEMO_PREFIX } from '../constants.js';
import type { AgentRole } from './steps.js';

export interface DemoTexts {
  /** Nicknames of the demo PCs (4). */
  nicknames: [string, string, string, string];
  /** Reasons shown in hover bubbles. */
  editReason: string;
  readReason: string;
  waitReason: string;
}

/** Whether the office is too empty to show the tour's character steps without demos. */
export const needsDemo = (realAgents: OfficeAgent[]): boolean =>
  realAgents.length < TOUR_DEMO_MIN_AGENTS;

export const isDemoKey = (key: string): boolean => key.startsWith(TOUR_DEMO_PREFIX);

/** Stable keys the tour targets. */
export const DEMO_KEYS = {
  coder: `${TOUR_DEMO_PREFIX}a:main`,
  reader: `${TOUR_DEMO_PREFIX}b:main`,
  readerSub: `${TOUR_DEMO_PREFIX}b:main/sub/explore`,
  runner: `${TOUR_DEMO_PREFIX}c:main`,
  runnerSub: `${TOUR_DEMO_PREFIX}c:main/sub/test`,
  waiter: `${TOUR_DEMO_PREFIX}d:main`,
} as const;

/**
 * The demo office: a coder in `coderRoom` (코딩실 except while the rooms steps
 * walk it around), a reader in 자료실 with a subagent beside it, a runner in
 * 서버실 whose subagent works in 자료실 (so it holds a ghost's hand), and a
 * Codex agent in 대기실 waiting for approval (❗).
 */
export function demoAgents(texts: DemoTexts, coderRoom: Room = 'coding'): OfficeAgent[] {
  const peer = (n: number, palette: number, hueShift: number): PeerInfo => ({
    id: `${TOUR_DEMO_PREFIX}${'abcd'[n]}`,
    nickname: texts.nicknames[n],
    palette,
    hueShift,
  });
  const a = peer(0, 0, 0);
  const b = peer(1, 1, 0);
  const c = peer(2, 4, 0);
  const d = peer(3, 5, 0);
  const main = (p: PeerInfo, room: Room, extra: Partial<OfficeAgent> = {}): OfficeAgent => ({
    key: `${p.id}:main`,
    peer: p,
    id: 'main',
    provider: 'claude',
    kind: 'main',
    num: 1,
    room,
    permission: false,
    act: 'idle',
    target: '',
    reason: '',
    ...extra,
  });
  const child = (
    parent: OfficeAgent,
    name: string,
    room: Room,
    act: OfficeAgent['act'],
    target: string,
  ): OfficeAgent => ({
    ...main(parent.peer, room),
    key: `${parent.key}/sub/${name}`,
    id: `main/sub/${name}`,
    kind: 'subagent',
    num: 0,
    parentId: 'main',
    parentKey: parent.key,
    act,
    target,
  });
  const coder = main(a, coderRoom, {
    act: 'edit',
    target: 'src/login.ts',
    reason: texts.editReason,
  });
  const reader = main(b, 'library', {
    act: 'read',
    target: 'docs/api.md',
    reason: texts.readReason,
  });
  const runner = main(c, 'server', { provider: 'codex', act: 'run', target: 'npm test' });
  const waiter = main(d, 'lounge', {
    num: 2,
    permission: true,
    act: 'ask',
    reason: texts.waitReason,
  });
  return [
    coder,
    reader,
    child(reader, 'explore', 'library', 'search', 'TODO'),
    runner,
    child(runner, 'test', 'library', 'read', 'test/login.test.ts'),
    waiter,
  ];
}

/** The agents a character step points at; demos first, else matching real agents. */
export function roleAgents(
  role: AgentRole,
  agents: OfficeAgent[],
): { focus: OfficeAgent; parent?: OfficeAgent } | null {
  const byKey = new Map(agents.map((a) => [a.key, a]));
  const mains = agents.filter((a) => a.kind === 'main');
  if (role === 'tag') {
    const focus = byKey.get(DEMO_KEYS.reader) ?? mains[0];
    return focus ? { focus } : null;
  }
  if (role === 'bubble') {
    const focus =
      byKey.get(DEMO_KEYS.waiter) ??
      mains.find((a) => a.permission) ??
      mains.find((a) => a.reason) ??
      mains[0];
    return focus ? { focus } : null;
  }
  const sameRoom = role === 'child';
  const focus =
    byKey.get(sameRoom ? DEMO_KEYS.readerSub : DEMO_KEYS.runnerSub) ??
    agents.find((a) => {
      if (a.parentKey === undefined) return false;
      return (byKey.get(a.parentKey)?.room === a.room) === sameRoom;
    });
  if (!focus) return null;
  return { focus, parent: focus.parentKey ? byKey.get(focus.parentKey) : undefined };
}

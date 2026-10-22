// Client-only demo characters for the onboarding tour. They go through
// LanAgents like snapshot agents but are never sent anywhere.

import type { OfficeAgent, PeerInfo, PetId, Room } from '../../../core/src/lan.js';
import { TOUR_DEMO_MIN_AGENTS, TOUR_DEMO_PREFIX } from '../constants.js';
import type { AgentRole } from './steps.js';

export interface DemoTexts {
  /** Nicknames of the demo PCs (4). */
  accounts: [string, string, string, string];
  /** Reasons shown in hover bubbles. */
  editReason: string;
  readReason: string;
  waitReason: string;
}

/** Whether the office is too empty (fewer than 3 main agents) to show the character steps without demos. */
export const needsDemo = (realAgents: OfficeAgent[]): boolean =>
  realAgents.filter((a) => a.kind === 'main').length < TOUR_DEMO_MIN_AGENTS;

export const isDemoKey = (key: string): boolean => key.startsWith(TOUR_DEMO_PREFIX);

/** Stable keys the tour targets. */
export const DEMO_KEYS = {
  coder: `${TOUR_DEMO_PREFIX}a:main`,
  reader: `${TOUR_DEMO_PREFIX}b:main`,
  readerSub: `${TOUR_DEMO_PREFIX}b:main/sub/explore`,
  runner: `${TOUR_DEMO_PREFIX}c:main`,
  runnerSub: `${TOUR_DEMO_PREFIX}c:main/sub/test`,
  runnerShell: `${TOUR_DEMO_PREFIX}c:main/sh/build`,
  waiter: `${TOUR_DEMO_PREFIX}d:main`,
} as const;

/** What the walker does in each room it visits during the rooms steps. */
const WALK_ACT: Record<Room, { act: OfficeAgent['act']; target: string }> = {
  coding: { act: 'edit', target: 'src/app.ts' },
  library: { act: 'read', target: 'README.md' },
  server: { act: 'run', target: 'npm run build' },
  lounge: { act: 'ask', target: '' },
};

/**
 * The demo office: a lone coder in 코딩실 (editing, with a reason), a reader (a
 * pet) in 자료실 with a subagent beside it, a delegating Codex agent whose
 * subagent runs tests in 서버실 (the parent walks there and leads it) and whose
 * shell builds in 자료실 (a ghost of the parent holds its hand), and a walker
 * that the rooms steps send to `walkerRoom`; back home in 대기실 it waits for
 * approval (the red "!").
 */
export function demoAgents(texts: DemoTexts, walkerRoom: Room = 'lounge'): OfficeAgent[] {
  const peer = (n: number, palette: number, hueShift: number, pet?: PetId): PeerInfo => ({
    id: `${TOUR_DEMO_PREFIX}${'abcd'[n]}`,
    account: texts.accounts[n],
    nickname: '',
    palette,
    hueShift,
    ...(pet && { pet }),
  });
  const a = peer(0, 0, 0);
  const b = peer(1, 1, 0, 'claudio'); // a pet, with its subagent pet beside it
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
    kind: 'subagent' | 'shell' = 'subagent',
  ): OfficeAgent => ({
    ...main(parent.peer, room),
    key: `${parent.key}/${kind === 'shell' ? 'sh' : 'sub'}/${name}`,
    id: `main/${kind === 'shell' ? 'sh' : 'sub'}/${name}`,
    kind,
    num: 0,
    parentId: 'main',
    parentKey: parent.key,
    act,
    target,
  });
  const coder = main(a, 'coding', {
    act: 'edit',
    target: 'src/login.ts',
    reason: texts.editReason,
  });
  const reader = main(b, 'library', {
    act: 'read',
    target: 'docs/api.md',
    reason: texts.readReason,
  });
  // Resting in 대기실 while its children work: shown with the subagent (tie 1:1 → subagent first).
  const runner = main(c, 'lounge', { provider: 'codex', act: 'delegate', target: 'test' });
  const waiting = walkerRoom === 'lounge';
  const waiter = main(d, walkerRoom, {
    num: 2,
    permission: waiting,
    ...WALK_ACT[walkerRoom],
    reason: waiting ? texts.waitReason : '',
  });
  return [
    coder,
    reader,
    child(reader, 'explore', 'library', 'search', 'TODO'),
    runner,
    child(runner, 'test', 'server', 'run', 'npm test'),
    child(runner, 'build', 'library', 'run', 'npm run build', 'shell'),
    waiter,
  ];
}

/** The agents a character step points at; demos first, else matching real agents
 *  (`shownIn` = where a parent is shown, LanAgents.displayRoom). */
export function roleAgents(
  role: AgentRole,
  agents: OfficeAgent[],
  shownIn: (a: OfficeAgent) => Room = (a) => a.room,
): { focus: OfficeAgent; parent?: OfficeAgent } | null {
  const byKey = new Map(agents.map((a) => [a.key, a]));
  const mains = agents.filter((a) => a.kind === 'main');
  if (role === 'tag') {
    const focus = byKey.get(DEMO_KEYS.coder) ?? mains[0];
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
    byKey.get(sameRoom ? DEMO_KEYS.runnerSub : DEMO_KEYS.runnerShell) ??
    agents.find((a) => {
      if (a.parentKey === undefined) return false;
      const parent = byKey.get(a.parentKey);
      return (parent !== undefined && shownIn(parent) === a.room) === sameRoom;
    });
  if (!focus) return null;
  return { focus, parent: focus.parentKey ? byKey.get(focus.parentKey) : undefined };
}

import type { Act, AgentView, Provider, Room } from '../../../core/src/lan.js';
import { PERMISSION_DELAY_MS, ROOM_DEBOUNCE_MS, TEXT_IDLE_DELAY_MS } from '../constants.js';

export { PERMISSION_DELAY_MS, ROOM_DEBOUNCE_MS, TEXT_IDLE_DELAY_MS };

export interface SessionState {
  provider: Provider;
  id: string;
  kind: 'main' | 'subagent';
  num: number;
  parentId?: string;
  /** displayed room */
  room: Room;
  candidate: Room;
  candidateSince: number;
  act: Act;
  target: string;
  /** target to share when hideDetails is on: a command becomes its program name or description */
  brief: string;
  reason: string;
  permission: boolean;
  /** Claude permission mode is bypassPermissions: approval prompts cannot happen */
  bypass: boolean;
  lastLineAt: number;
  pendingTool: { name: string; since: number; exempt: boolean } | null;
  textOnlyAt: number | null;
  turnEnded: boolean;
  /** shellId -> target (command or its description) and its brief */
  shells: Map<string, { target: string; brief: string }>;
}

export function newSession(
  provider: Provider,
  id: string,
  kind: 'main' | 'subagent',
  now: number,
  parentId?: string,
): SessionState {
  return {
    provider,
    id,
    kind,
    num: 0,
    parentId,
    room: 'lounge',
    candidate: 'lounge',
    candidateSince: now,
    act: 'idle',
    target: '',
    brief: '',
    reason: '',
    permission: false,
    bypass: false,
    lastLineAt: now,
    pendingTool: null,
    textOnlyAt: null,
    turnEnded: false,
    shells: new Map(),
  };
}

function setCandidate(s: SessionState, room: Room, now: number): void {
  if (room !== s.candidate) {
    s.candidate = room;
    s.candidateSince = now;
  }
}

/** Program name of a shell command: first token after `KEY=value` assignments, basename. */
export function programName(cmd: string): string {
  const tok = cmd
    .trim()
    .split(/\s+/)
    .find((t) => !/^\w+=/.test(t));
  return (
    (tok ?? '')
      .replace(/^["'`(]+|["'`;)&|]+$/g, '')
      .split(/[\\/]/)
      .pop() ?? ''
  );
}

/** room=null keeps the current room. brief defaults to target. */
export function setActivity(
  s: SessionState,
  room: Room | null,
  act: Act,
  target: string,
  now: number,
  brief: string = target,
): void {
  if (room) setCandidate(s, room, now);
  s.act = act;
  s.target = target;
  s.brief = brief;
  s.permission = false;
  s.turnEnded = false;
  s.textOnlyAt = null;
}

export function setIdle(s: SessionState, now: number): void {
  setCandidate(s, 'lounge', now);
  s.act = 'idle';
  s.target = '';
  s.brief = '';
  s.pendingTool = null;
  s.permission = false;
  s.turnEnded = true;
}

export function tick(s: SessionState, now: number): void {
  const p = s.pendingTool;
  // A silent tool is only a guess at an approval prompt (a long command looks the same):
  // show ❗ in place, never under bypassPermissions.
  if (p && !p.exempt && !s.bypass && now - s.lastLineAt >= PERMISSION_DELAY_MS) {
    s.permission = true;
  }
  if (s.textOnlyAt !== null && !s.pendingTool && now - s.textOnlyAt >= TEXT_IDLE_DELAY_MS) {
    setIdle(s, now);
    s.textOnlyAt = null;
  }
  if (s.candidate !== s.room && now - s.candidateSince >= ROOM_DEBOUNCE_MS) s.room = s.candidate;
}

/** brief=true (hideDetails) shares commands as program name / description only. */
export function toViews(s: SessionState, brief = false): AgentView[] {
  const self: AgentView = {
    id: s.id,
    provider: s.provider,
    kind: s.kind,
    num: s.kind === 'main' ? s.num : 0,
    room: s.room,
    permission: s.permission,
    act: s.act,
    target: brief ? s.brief : s.target,
    reason: s.reason,
  };
  if (s.kind === 'subagent') self.parentId = s.parentId;
  const shells = [...s.shells].map(([shellId, sh]): AgentView => ({
    id: `${s.id}/sh/${shellId}`,
    provider: s.provider,
    kind: 'shell',
    num: 0,
    parentId: s.id,
    room: 'server',
    permission: false,
    act: 'run',
    target: brief ? sh.brief : sh.target,
    reason: '',
  }));
  return [self, ...shells];
}

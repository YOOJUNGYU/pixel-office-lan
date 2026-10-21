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
  reason: string;
  permission: boolean;
  lastLineAt: number;
  pendingTool: { name: string; since: number; exempt: boolean } | null;
  textOnlyAt: number | null;
  turnEnded: boolean;
  /** shellId -> target (command or its description) */
  shells: Map<string, string>;
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
    reason: '',
    permission: false,
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

/** room=null keeps the current room. */
export function setActivity(
  s: SessionState,
  room: Room | null,
  act: Act,
  target: string,
  now: number,
): void {
  if (room) setCandidate(s, room, now);
  s.act = act;
  s.target = target;
  s.permission = false;
  s.turnEnded = false;
  s.textOnlyAt = null;
}

export function setIdle(s: SessionState, now: number): void {
  setCandidate(s, 'lounge', now);
  s.act = 'idle';
  s.target = '';
  s.pendingTool = null;
  s.permission = false;
  s.turnEnded = true;
}

export function tick(s: SessionState, now: number): void {
  const p = s.pendingTool;
  if (p && !p.exempt && now - s.lastLineAt >= PERMISSION_DELAY_MS) {
    s.permission = true;
    setCandidate(s, 'lounge', now);
    s.room = 'lounge'; // immediate, no debounce
  }
  if (s.textOnlyAt !== null && !s.pendingTool && now - s.textOnlyAt >= TEXT_IDLE_DELAY_MS) {
    setIdle(s, now);
    s.textOnlyAt = null;
  }
  if (s.candidate !== s.room && now - s.candidateSince >= ROOM_DEBOUNCE_MS) s.room = s.candidate;
}

export function toViews(s: SessionState): AgentView[] {
  const self: AgentView = {
    id: s.id,
    provider: s.provider,
    kind: s.kind,
    num: s.kind === 'main' ? s.num : 0,
    room: s.room,
    permission: s.permission,
    act: s.act,
    target: s.target,
    reason: s.reason,
  };
  if (s.kind === 'subagent') self.parentId = s.parentId;
  const shells = [...s.shells].map(([shellId, target]): AgentView => ({
    id: `${s.id}/sh/${shellId}`,
    provider: s.provider,
    kind: 'shell',
    num: 0,
    parentId: s.id,
    room: 'server',
    permission: false,
    act: 'run',
    target,
    reason: '',
  }));
  return [self, ...shells];
}

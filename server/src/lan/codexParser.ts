import type { Act, Room } from '../../../core/src/lan.js';
import type { SessionState } from './session.js';
import { programName, setActivity, setIdle } from './session.js';

type Obj = Record<string, unknown>;

/** per-session call_id -> target after the call, and write_stdin's session_id */
const calls = new WeakMap<
  SessionState,
  Map<string, { target: string; brief: string; stdinId?: string }>
>();
const callsOf = (s: SessionState) => {
  let m = calls.get(s);
  if (!m) calls.set(s, (m = new Map()));
  return m;
};

const FN_RE = /tools\.(\w+)\(/;
const CMD_RE = /\bcmd"?\s*:\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/s;
const PATCH_RE = /\*\*\* (?:Update|Add|Delete) File: (.+?)(?:\\n|\n|$)/;
const SID_RE = /"session_id"\s*:\s*(\d+)/;
const STDIN_SID_RE = /\bsession_id"?\s*:\s*(\d+)/;
const EXIT_RE = /"exit_code"/;
const LIBRARY_CMD =
  /^(?:(?:rg|grep|cat|head|tail|ls|find|fd|wc|nl|tree|less)\b|sed\s+-n\b|git\s+(?:log|show|diff|status|grep|blame)\b)/;
const SHELLS = /(^|[\\/])(?:ba|z)?sh(?:\.exe)?$/;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const clip = (v: string, n: number): string => v.replace(/\s+/g, ' ').trim().slice(0, n);
const basename = (p: string): string => p.split(/[\\/]/).pop() ?? '';
const unescape = (v: string): string =>
  v.replace(/\\(.)/g, (_, c: string) => (c === 'n' ? '\n' : c));
const textOf = (c: unknown): string =>
  typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => str(obj(b).text)).join('\n') : '';

export function classifyShell(cmd: string): Room {
  return LIBRARY_CMD.test(cmd.split('|')[0].trim()) ? 'library' : 'server';
}

/** [room, act, target, brief (default target)] */
type Activity = [Room, Act, string, string?];

function shellActivity(cmd: string): Activity {
  const room = classifyShell(cmd);
  return [room, room === 'library' ? 'read' : 'run', clip(cmd, 80), programName(cmd)];
}

/** [room, act, target] or null = keep room and activity */
function describe(fn: string, input: string): Activity | null {
  if (fn === 'apply_patch') return ['coding', 'edit', basename(PATCH_RE.exec(input)?.[1] ?? '')];
  if (fn === 'exec_command') return shellActivity(unescape(CMD_RE.exec(input)?.[2] ?? ''));
  if (fn === 'web__run' || fn === 'web_search') return ['library', 'web', ''];
  if (fn === 'view_image') return ['library', 'image', ''];
  if (fn.startsWith('request_user_input')) return ['lounge', 'ask', ''];
  return null;
}

/** legacy function_call / local_shell_call: command array or cmd string */
function legacyShell(args: Obj): string {
  const c = args.command ?? args.cmd;
  if (!Array.isArray(c)) return str(c);
  const parts = c.map(str);
  return SHELLS.test(parts[0] ?? '') ? (parts.at(-1) ?? '') : parts.join(' ');
}

function onToolCall(
  s: SessionState,
  name: string,
  callId: string,
  d: Activity | null,
  now: number,
  stdinId?: string,
): void {
  if (d) setActivity(s, d[0], d[1], clip(d[2], 120), now, clip(d[3] ?? d[2], 120));
  if (name.startsWith('request_user_input')) s.permission = true;
  // ponytail: Codex 승인 대기 미감지, 기록에 승인 이벤트가 생기면 추가
  s.pendingTool = { name, since: now, exempt: true };
  if (callId) callsOf(s).set(callId, { target: s.target, brief: s.brief, stdinId });
}

function onItem(s: SessionState, p: Obj, now: number): void {
  const callId = str(p.call_id);
  switch (p.type) {
    case 'custom_tool_call': {
      const input = str(p.input);
      const fn = p.name === 'exec' ? (FN_RE.exec(input)?.[1] ?? '') : str(p.name);
      const d = describe(fn, input);
      const stdinId = fn === 'write_stdin' ? STDIN_SID_RE.exec(input)?.[1] : undefined;
      return onToolCall(s, fn || str(p.name), callId, d, now, stdinId);
    }
    case 'function_call':
    case 'local_shell_call': {
      const name = str(p.name) || str(p.type);
      let args: Obj = obj(p.action);
      try {
        if (typeof p.arguments === 'string') args = obj(JSON.parse(p.arguments));
      } catch {
        /* keep {} */
      }
      const d = ['shell', 'exec_command', 'local_shell_call'].includes(name)
        ? shellActivity(legacyShell(args))
        : describe(name, '');
      return onToolCall(s, name, callId, d, now);
    }
    case 'web_search_call':
      return onToolCall(s, 'web_search', callId, ['library', 'web', ''], now);
    case 'custom_tool_call_output':
    case 'function_call_output': {
      s.pendingTool = null;
      s.permission = false;
      const call = callsOf(s).get(callId);
      const outs = Array.isArray(p.output)
        ? p.output.map((b) => str(obj(b).text))
        : [textOf(p.output)];
      for (const t of outs) {
        const sid = SID_RE.exec(t)?.[1];
        if (EXIT_RE.test(t)) {
          const id = sid ?? call?.stdinId;
          if (id) s.shells.delete(id);
        } else if (sid && !s.shells.has(sid)) {
          // only a "still running" exec output starts a shell; write_stdin errors never do
          s.shells.set(sid, { target: call?.target ?? s.target, brief: call?.brief ?? s.brief });
        }
      }
      return;
    }
    case 'message':
      if (p.role === 'assistant') setReason(s, textOf(p.content));
  }
}

function setReason(s: SessionState, text: string): void {
  if (text.trim()) s.reason = clip(text, 200);
}

function newTurn(s: SessionState): void {
  s.turnEnded = false;
  s.permission = false;
  s.textOnlyAt = null;
  s.reason = '';
  callsOf(s).clear();
}

function onEvent(s: SessionState, p: Obj, now: number): void {
  if (p.type === 'task_complete' || p.type === 'turn_aborted') setIdle(s, now);
  else if (p.type === 'task_started') newTurn(s);
  else if (p.type === 'item_completed') {
    const it = obj(p.item);
    if (it.type === 'AgentMessage') setReason(s, textOf(it.content));
    else if (it.type === 'UserMessage') s.reason = '';
  }
}

/** Apply one line of a Codex rollout JSONL to the session state. */
export function applyCodexLine(s: SessionState, line: string, now: number): void {
  let rec: unknown;
  try {
    rec = JSON.parse(line);
  } catch {
    return;
  }
  if (!rec || typeof rec !== 'object') return;
  s.lastLineAt = now;
  const { type, payload } = rec as Obj;
  if (type === 'response_item') onItem(s, obj(payload), now);
  else if (type === 'event_msg') onEvent(s, obj(payload), now);
}

export function codexSessionMeta(firstLine: string): { id: string; parentId?: string } | null {
  try {
    const rec = obj(JSON.parse(firstLine));
    const p = obj(rec.payload);
    if (rec.type !== 'session_meta' || typeof p.id !== 'string') return null;
    // ponytail: Codex 서브에이전트 포맷 미검증(로컬 표본 없음), 실제 표본 확보 시 픽스처로 고정
    const parentId = obj(obj(obj(p.source).subagent).thread_spawn).parent_thread_id;
    return typeof parentId === 'string' ? { id: p.id, parentId } : { id: p.id };
  } catch {
    return null;
  }
}

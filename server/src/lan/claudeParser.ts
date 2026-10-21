import type { Act, Room } from '../../../core/src/lan.js';
import type { SessionState } from './session.js';
import { setActivity, setIdle } from './session.js';

type Input = Record<string, unknown>;
interface Block {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Input;
  tool_use_id?: string;
  content?: unknown;
}

interface Turn {
  tools: Map<string, { name: string; input: Input; target: string }>;
}
/** per-session turn memory (tool_use ids of the current turn) */
const turns = new WeakMap<SessionState, Turn>();
const turnOf = (s: SessionState): Turn => {
  let t = turns.get(s);
  if (!t) turns.set(s, (t = { tools: new Map() }));
  return t;
};

const BG_RE = /Command running in background with ID: ([\w-]+)/;
const TASK_ID_RE = /<task-id>([^<]+)<\/task-id>/;
const DONE_RE = /<status>(completed|failed|killed)<\/status>/;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const clip = (v: string, n: number): string => v.replace(/\s+/g, ' ').trim().slice(0, n);
const basename = (p: unknown): string => str(p).split(/[\\/]/).pop() ?? '';
const textOf = (c: unknown): string =>
  typeof c === 'string'
    ? c
    : Array.isArray(c)
      ? c.map((b: Block) => (b?.type === 'text' ? str(b.text) : '')).join('\n')
      : '';

/** [room (null = keep), act, target, exempt] */
function describe(name: string, i: Input): [Room | null, Act, string, boolean] {
  switch (name) {
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'NotebookEdit':
      return ['coding', 'edit', basename(i.file_path ?? i.notebook_path), false];
    case 'Read':
      return ['library', 'read', basename(i.file_path), false];
    case 'Grep':
      return ['library', 'search', str(i.pattern), false];
    case 'Glob':
      return ['library', 'find', str(i.pattern), false];
    case 'WebSearch':
      return ['library', 'web', str(i.query), false];
    case 'WebFetch':
      return ['library', 'fetch', str(i.url), false];
    case 'Bash':
    case 'PowerShell':
      return ['server', 'run', str(i.description) || str(i.command).slice(0, 80), false];
    case 'Task':
    case 'Agent':
      return ['lounge', 'delegate', str(i.description), true];
    case 'AskUserQuestion':
    case 'ExitPlanMode':
      return ['lounge', 'ask', '', true];
  }
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  if (mcp) return ['library', 'mcp', `${mcp[1]}:${mcp[2]}`, false];
  return [null, 'tool', name, false];
}

function onAssistant(s: SessionState, content: Block[], now: number): void {
  let sawTool = false;
  for (const b of content) {
    if (b?.type === 'text' && str(b.text).trim()) {
      s.reason = clip(str(b.text), 200);
    } else if (b?.type === 'tool_use' && typeof b.name === 'string') {
      sawTool = true;
      const input = b.input && typeof b.input === 'object' ? b.input : {};
      if (b.name === 'KillShell' || b.name === 'TaskStop') {
        s.shells.delete(str(input.shell_id ?? input.task_id));
        continue;
      }
      const [room, act, target, exempt] = describe(b.name, input);
      const clipped = clip(target, 120);
      setActivity(s, room, act, clipped, now);
      if (b.name === 'AskUserQuestion' || b.name === 'ExitPlanMode') s.permission = true;
      s.pendingTool = { name: b.name, since: now, exempt };
      if (b.id) turnOf(s).tools.set(b.id, { name: b.name, input, target: clipped });
    }
  }
  if (!sawTool && content.some((b) => b?.type === 'text')) s.textOnlyAt = now;
}

function onUser(s: SessionState, content: unknown): void {
  const results = Array.isArray(content)
    ? (content as Block[]).filter((b) => b?.type === 'tool_result')
    : [];
  if (results.length) {
    s.pendingTool = null;
    s.permission = false;
    for (const r of results) {
      const id = BG_RE.exec(textOf(r.content))?.[1];
      const call = turnOf(s).tools.get(str(r.tool_use_id));
      if (id && call?.input.run_in_background === true) s.shells.set(id, call.target);
    }
    return;
  }
  const text = textOf(content);
  const taskId = TASK_ID_RE.exec(text)?.[1];
  if (taskId && DONE_RE.test(text)) s.shells.delete(taskId);
  // new turn
  s.turnEnded = false;
  s.permission = false;
  s.textOnlyAt = null;
  s.reason = '';
  turnOf(s).tools.clear();
}

/** Apply one line of a Claude Code session JSONL to the session state. */
export function applyClaudeLine(s: SessionState, line: string, now: number): void {
  let rec: { type?: string; subtype?: string; message?: { content?: unknown } };
  try {
    rec = JSON.parse(line);
  } catch {
    return;
  }
  if (!rec || typeof rec !== 'object') return;
  s.lastLineAt = now;
  const content = rec.message?.content;
  if (rec.type === 'assistant' && Array.isArray(content)) onAssistant(s, content, now);
  else if (rec.type === 'user') onUser(s, content);
  else if (rec.type === 'system' && rec.subtype === 'turn_duration') setIdle(s, now);
}

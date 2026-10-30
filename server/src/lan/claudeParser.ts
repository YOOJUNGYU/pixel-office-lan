import type { Act, Room } from '../../../core/src/lan.js';
import type { SessionState } from './session.js';
import { isPrompt, notePrompt, programName, setActivity, setIdle, setThinking } from './session.js';

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
  tools: Map<string, { name: string; input: Input; target: string; brief: string }>;
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

/** [room, act, target, exempt, brief (default target)] */
function describe(name: string, i: Input): [Room, Act, string, boolean, string?] {
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
      return [
        'server',
        'run',
        str(i.description) || str(i.command).slice(0, 80),
        false,
        str(i.description) || programName(str(i.command)),
      ];
    case 'Task':
    case 'Agent':
      return ['lounge', 'delegate', str(i.description), true];
    case 'AskUserQuestion':
    case 'ExitPlanMode':
      return ['lounge', 'ask', '', true];
    // Keeping the plan / task list: part of the coding work.
    case 'TodoWrite':
    case 'TaskCreate':
    case 'TaskUpdate':
      return ['coding', 'tool', name, false];
  }
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  if (mcp) return ['library', 'mcp', `${mcp[1]}:${mcp[2]}`, false];
  // Everything else (Skill, ToolSearch, LSP, BashOutput, Monitor, EnterPlanMode, new tools):
  // looking things up — never left in the room of the previous step.
  return ['library', 'tool', name, false];
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
      const [room, act, target, exempt, brief = target] = describe(b.name, input);
      const clipped = clip(target, 120);
      const briefClipped = clip(brief, 120);
      setActivity(s, room, act, clipped, now, briefClipped);
      if (b.name === 'AskUserQuestion' || b.name === 'ExitPlanMode') s.permission = true;
      s.pendingTool = { name: b.name, since: now, exempt };
      if (b.id)
        turnOf(s).tools.set(b.id, { name: b.name, input, target: clipped, brief: briefClipped });
    }
  }
  if (!sawTool && content.some((b) => b?.type === 'text')) s.textOnlyAt = now;
}

function onUser(s: SessionState, content: unknown, now: number, meta: boolean): void {
  const results = Array.isArray(content)
    ? (content as Block[]).filter((b) => b?.type === 'tool_result')
    : [];
  if (results.length) {
    s.pendingTool = null;
    s.permission = false;
    for (const r of results) {
      const id = BG_RE.exec(textOf(r.content))?.[1];
      const call = turnOf(s).tools.get(str(r.tool_use_id));
      if (id && call?.input.run_in_background === true) {
        s.shells.set(id, { target: call.target, brief: call.brief });
      }
    }
    return;
  }
  const text = textOf(content);
  if (!meta) notePrompt(s, text);
  const taskId = TASK_ID_RE.exec(text)?.[1];
  if (taskId && DONE_RE.test(text)) s.shells.delete(taskId);
  // Esc: no turn_duration follows
  if (text.trimStart().startsWith('[Request interrupted')) return setIdle(s, now);
  // new turn
  s.turnEnded = false;
  s.permission = false;
  s.textOnlyAt = null;
  s.reason = '';
  turnOf(s).tools.clear();
  // A prompt from the user: thinking until the first tool (or the reply) shows up.
  if (!meta && isPrompt(text)) setThinking(s, now);
}

/** Apply one line of a Claude Code session JSONL to the session state. */
export function applyClaudeLine(s: SessionState, line: string, now: number): void {
  let rec: {
    type?: string;
    subtype?: string;
    message?: { content?: unknown };
    permissionMode?: unknown;
    isMeta?: unknown;
    cwd?: unknown;
    customTitle?: unknown;
    aiTitle?: unknown;
  };
  try {
    rec = JSON.parse(line);
  } catch {
    return;
  }
  if (!rec || typeof rec !== 'object') return;
  s.lastLineAt = now;
  // `permission-mode` records and user records carry the current mode
  if (typeof rec.permissionMode === 'string') {
    s.bypass = rec.permissionMode === 'bypassPermissions';
  }
  // local only (notifications): cwd, titles — see SessionState.local
  if (typeof rec.cwd === 'string') s.local.cwd = rec.cwd;
  if (rec.type === 'custom-title' && typeof rec.customTitle === 'string') {
    s.local.customTitle = rec.customTitle.trim();
  } else if (rec.type === 'ai-title' && typeof rec.aiTitle === 'string') {
    s.local.aiTitle = rec.aiTitle.trim();
  }
  const content = rec.message?.content;
  if (rec.type === 'assistant' && Array.isArray(content)) onAssistant(s, content, now);
  else if (rec.type === 'user') onUser(s, content, now, rec.isMeta === true);
  else if (rec.type === 'system' && rec.subtype === 'turn_duration') setIdle(s, now);
}

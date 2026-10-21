import type { Room } from '../../../core/src/lan.js';
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
  tools: Map<string, { name: string; input: Input; summary: string }>;
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

/** [room (null = keep), summary, exempt] */
function describe(name: string, i: Input): [Room | null, string, boolean] {
  switch (name) {
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'NotebookEdit':
      return ['coding', `${basename(i.file_path ?? i.notebook_path)} 수정 중`, false];
    case 'Read':
      return ['library', `${basename(i.file_path)} 읽는 중`, false];
    case 'Grep':
      return ['library', `"${str(i.pattern)}" 검색 중`, false];
    case 'Glob':
      return ['library', `"${str(i.pattern)}" 파일 찾는 중`, false];
    case 'WebSearch':
      return ['library', `웹 검색: ${str(i.query)}`, false];
    case 'WebFetch':
      return ['library', `${str(i.url)} 보는 중`, false];
    case 'Bash':
    case 'PowerShell':
      return ['server', `명령 실행: ${str(i.description) || str(i.command).slice(0, 80)}`, false];
    case 'Task':
    case 'Agent':
      return ['lounge', `서브에이전트에게 맡김: ${str(i.description)}`, true];
    case 'AskUserQuestion':
    case 'ExitPlanMode':
      return ['lounge', '답변 기다리는 중', true];
  }
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  if (mcp) return ['library', `${mcp[1]}:${mcp[2]} 사용 중`, false];
  return [null, `${name} 사용 중`, false];
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
      const [room, summary, exempt] = describe(b.name, input);
      const clipped = clip(summary, 120);
      setActivity(s, room, clipped, now);
      if (b.name === 'AskUserQuestion' || b.name === 'ExitPlanMode') s.permission = true;
      s.pendingTool = { name: b.name, since: now, exempt };
      if (b.id) turnOf(s).tools.set(b.id, { name: b.name, input, summary: clipped });
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
      if (id && call?.input.run_in_background === true) s.shells.set(id, call.summary);
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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { applyClaudeLine } from '../../src/lan/claudeParser.js';
import { newSession, tick, toViews } from '../../src/lan/session.js';

const fixture = (name: string) =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf8')
    .split('\n')
    .filter(Boolean);
const mk = () => newSession('claude', 's1', 'main', 0);
const assistant = (...content: unknown[]) =>
  JSON.stringify({ type: 'assistant', message: { content } });
const toolUse = (name: string, input: unknown, id = 'tu_x') => ({
  type: 'tool_use',
  id,
  name,
  input,
});

describe('applyClaudeLine', () => {
  it('Edit with preceding text -> coding, basename summary, reason', () => {
    const s = mk();
    for (const l of fixture('claude-edit.jsonl')) applyClaudeLine(s, l, 1_000);
    tick(s, 1_000 + 3_000);
    expect(s.room).toBe('coding');
    expect(s.summary).toBe('login.ts 수정 중');
    expect(s.reason).toBe('토큰 만료 시 재로그인 문제를 고치겠습니다');
    expect(s.lastLineAt).toBe(1_000);
  });

  it('Grep -> library, quoted pattern', () => {
    const s = mk();
    applyClaudeLine(s, assistant(toolUse('Grep', { pattern: 'refreshToken' })), 0);
    tick(s, 3_000);
    expect(s.room).toBe('library');
    expect(s.summary).toBe('"refreshToken" 검색 중');
  });

  it('summaries for other tools', () => {
    const cases: [string, unknown, string | null, string][] = [
      ['Write', { file_path: 'C:\\w\\a.ts' }, 'coding', 'a.ts 수정 중'],
      ['NotebookEdit', { notebook_path: '/n/x.ipynb' }, 'coding', 'x.ipynb 수정 중'],
      ['Read', { file_path: '/r/y.md' }, 'library', 'y.md 읽는 중'],
      ['Glob', { pattern: '**/*.ts' }, 'library', '"**/*.ts" 파일 찾는 중'],
      ['WebSearch', { query: 'vitest' }, 'library', '웹 검색: vitest'],
      ['WebFetch', { url: 'https://x.dev/a' }, 'library', 'https://x.dev/a 보는 중'],
      ['mcp__github__get_issue', {}, 'library', 'github:get_issue 사용 중'],
      ['Bash', { command: 'a'.repeat(100) }, 'server', `명령 실행: ${'a'.repeat(80)}`],
      ['Agent', { description: '조사' }, 'lounge', '서브에이전트에게 맡김: 조사'],
      ['Skill', {}, null, 'Skill 사용 중'],
    ];
    for (const [name, input, room, summary] of cases) {
      const s = mk();
      s.candidate = 'server';
      applyClaudeLine(s, assistant(toolUse(name, input)), 0);
      expect(s.summary).toBe(summary);
      expect(s.candidate).toBe(room ?? 'server');
    }
  });

  it('Task/Agent are exempt, others pending', () => {
    const s = mk();
    applyClaudeLine(s, assistant(toolUse('Task', { description: 'd' })), 0);
    tick(s, 60_000);
    expect(s.permission).toBe(false);
    expect(s.pendingTool).toMatchObject({ name: 'Task', exempt: true });
    applyClaudeLine(s, assistant(toolUse('Bash', { command: 'ls' })), 0);
    expect(s.pendingTool).toMatchObject({ name: 'Bash', exempt: false });
  });

  it('background Bash becomes a shell view, removed on task-notification', () => {
    const s = mk();
    for (const l of fixture('claude-bg-shell.jsonl')) applyClaudeLine(s, l, 0);
    expect(s.pendingTool).toBeNull();
    expect(toViews(s)).toContainEqual(
      expect.objectContaining({ id: 's1/sh/bash_1', summary: '명령 실행: 개발 서버 실행' }),
    );
    applyClaudeLine(
      s,
      JSON.stringify({
        type: 'user',
        message: {
          content:
            '<task-notification>\n<task-id>bash_1</task-id>\n<status>completed</status>\n</task-notification>',
        },
      }),
      1,
    );
    expect(toViews(s)).toHaveLength(1);
  });

  it('KillShell / TaskStop remove the shell, keep summary', () => {
    const s = mk();
    s.shells.set('b1', 'x').set('b2', 'y');
    s.summary = 'keep';
    applyClaudeLine(s, assistant(toolUse('KillShell', { shell_id: 'b1' })), 0);
    applyClaudeLine(s, assistant(toolUse('TaskStop', { task_id: 'b2' })), 0);
    expect(s.shells.size).toBe(0);
    expect(s.summary).toBe('keep');
  });

  it('AskUserQuestion -> immediate permission', () => {
    const s = mk();
    applyClaudeLine(s, assistant(toolUse('AskUserQuestion', { questions: [] })), 0);
    expect(s.permission).toBe(true);
    expect(s.summary).toBe('답변 기다리는 중');
  });

  it('reason carries across messages in a turn, resets on new user text', () => {
    const s = mk();
    applyClaudeLine(s, assistant({ type: 'text', text: '먼저 확인' }), 0);
    expect(s.textOnlyAt).toBe(0);
    applyClaudeLine(s, assistant(toolUse('Read', { file_path: '/a' })), 1);
    expect(s.reason).toBe('먼저 확인');
    expect(s.textOnlyAt).toBeNull();
    applyClaudeLine(
      s,
      JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: '다음' }] } }),
      2,
    );
    expect(s.reason).toBe('');
  });

  it('turn_duration -> lounge / 대기 중 after 3s', () => {
    const s = mk();
    s.room = s.candidate = 'coding';
    applyClaudeLine(s, '{"type":"system","subtype":"turn_duration"}', 0);
    tick(s, 3_000);
    expect(s.room).toBe('lounge');
    expect(s.summary).toBe('대기 중');
  });

  it('ignores garbage entirely', () => {
    const s = mk();
    expect(() => applyClaudeLine(s, '{not json', 5)).not.toThrow();
    expect(() => applyClaudeLine(s, 'null', 5)).not.toThrow();
    expect(s.lastLineAt).toBe(0);
  });

  it.skipIf(!process.env.REAL_CLAUDE_JSONL)('real transcript smoke', () => {
    const s = mk();
    const lines = readFileSync(process.env.REAL_CLAUDE_JSONL!, 'utf8').split('\n');
    lines.forEach((l, i) => {
      applyClaudeLine(s, l, i);
      tick(s, i);
    });
    toViews(s);
  });
});

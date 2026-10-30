import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { Act } from '../../../core/src/lan.js';
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
  it('Edit with preceding text -> coding, basename target, reason', () => {
    const s = mk();
    for (const l of fixture('claude-edit.jsonl')) applyClaudeLine(s, l, 1_000);
    tick(s, 1_000 + 3_000);
    expect(s.room).toBe('coding');
    expect(s).toMatchObject({ act: 'edit', target: 'login.ts' });
    expect(s.reason).toBe('토큰 만료 시 재로그인 문제를 고치겠습니다');
    expect(s.lastLineAt).toBe(1_000);
  });

  it('Grep -> library, quoted pattern', () => {
    const s = mk();
    applyClaudeLine(s, assistant(toolUse('Grep', { pattern: 'refreshToken' })), 0);
    tick(s, 3_000);
    expect(s.room).toBe('library');
    expect(s).toMatchObject({ act: 'search', target: 'refreshToken' });
  });

  it('act/target for other tools', () => {
    const cases: [string, unknown, string | null, Act, string][] = [
      ['Write', { file_path: 'C:\\w\\a.ts' }, 'coding', 'edit', 'a.ts'],
      ['NotebookEdit', { notebook_path: '/n/x.ipynb' }, 'coding', 'edit', 'x.ipynb'],
      ['Read', { file_path: '/r/y.md' }, 'library', 'read', 'y.md'],
      ['Glob', { pattern: '**/*.ts' }, 'library', 'find', '**/*.ts'],
      ['WebSearch', { query: 'vitest' }, 'library', 'web', 'vitest'],
      ['WebFetch', { url: 'https://x.dev/a' }, 'library', 'fetch', 'https://x.dev/a'],
      ['mcp__github__get_issue', {}, 'library', 'mcp', 'github:get_issue'],
      ['Bash', { command: 'a'.repeat(100) }, 'server', 'run', 'a'.repeat(80)],
      ['Bash', { command: 'ls', description: '목록' }, 'server', 'run', '목록'],
      ['Agent', { description: '조사' }, 'lounge', 'delegate', '조사'],
      ['Skill', {}, 'library', 'tool', 'Skill'],
      ['ToolSearch', {}, 'library', 'tool', 'ToolSearch'],
      ['SomeNewTool', {}, 'library', 'tool', 'SomeNewTool'],
      ['TodoWrite', {}, 'coding', 'tool', 'TodoWrite'],
    ];
    for (const [name, input, room, act, target] of cases) {
      const s = mk();
      s.candidate = 'server';
      applyClaudeLine(s, assistant(toolUse(name, input)), 0);
      expect(s).toMatchObject({ act, target });
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
      expect.objectContaining({ id: 's1/sh/bash_1', act: 'run', target: '개발 서버 실행' }),
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

  it('KillShell / TaskStop remove the shell, keep activity', () => {
    const s = mk();
    s.shells.set('b1', { target: 'x', brief: 'x' }).set('b2', { target: 'y', brief: 'y' });
    s.target = 'keep';
    applyClaudeLine(s, assistant(toolUse('KillShell', { shell_id: 'b1' })), 0);
    applyClaudeLine(s, assistant(toolUse('TaskStop', { task_id: 'b2' })), 0);
    expect(s.shells.size).toBe(0);
    expect(s).toMatchObject({ act: 'idle', target: 'keep' });
  });

  it('Bash brief is the description, else the program name', () => {
    const s = mk();
    applyClaudeLine(s, assistant(toolUse('Bash', { command: 'ssh dev@db01.acme.local' })), 0);
    expect(s).toMatchObject({ target: 'ssh dev@db01.acme.local', brief: 'ssh' });
    applyClaudeLine(
      s,
      assistant(toolUse('Bash', { command: 'npm test', description: '테스트 실행' })),
      0,
    );
    expect(s).toMatchObject({ target: '테스트 실행', brief: '테스트 실행' });
  });

  it('bypassPermissions (real format): a 30 s Bash stays in 서버실 without ❗', () => {
    const s = mk();
    applyClaudeLine(
      s,
      '{"type":"permission-mode","permissionMode":"bypassPermissions","sessionId":"s1"}',
      0,
    );
    applyClaudeLine(s, assistant(toolUse('Bash', { command: 'npm test' })), 0);
    tick(s, 3_000);
    tick(s, 30_000);
    expect(s).toMatchObject({ room: 'server', permission: false, act: 'run' });
  });

  it('default mode: a silent Bash shows ❗ in place', () => {
    const s = mk();
    applyClaudeLine(
      s,
      JSON.stringify({ type: 'user', permissionMode: 'default', message: { content: 'go' } }),
      0,
    );
    applyClaudeLine(s, assistant(toolUse('Bash', { command: 'npm test' })), 0);
    tick(s, 3_000);
    tick(s, 30_000);
    expect(s).toMatchObject({ room: 'server', permission: true });
  });

  it('interrupt (Esc) ends the turn', () => {
    const s = mk();
    applyClaudeLine(s, assistant(toolUse('Bash', { command: 'npm test' })), 0);
    applyClaudeLine(
      s,
      JSON.stringify({
        type: 'user',
        message: {
          content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }],
        },
      }),
      1,
    );
    tick(s, 3_001);
    expect(s).toMatchObject({ room: 'lounge', act: 'idle', turnEnded: true, pendingTool: null });
  });

  it('AskUserQuestion -> immediate permission', () => {
    const s = mk();
    applyClaudeLine(s, assistant(toolUse('AskUserQuestion', { questions: [] })), 0);
    expect(s.permission).toBe(true);
    expect(s).toMatchObject({ act: 'ask', target: '' });
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

  it('a user prompt -> 자료실, thinking (act tool, no target) until the first tool', () => {
    const s = mk();
    const user = (text: string, extra = {}) =>
      JSON.stringify({ type: 'user', message: { content: text }, ...extra });
    applyClaudeLine(s, user('<command-name>/login</command-name>'), 0);
    expect(s.candidate).toBe('lounge'); // a local command: no turn
    applyClaudeLine(s, user('hook context', { isMeta: true }), 0);
    expect(s.candidate).toBe('lounge');
    applyClaudeLine(s, user('버그 고쳐줘'), 0);
    expect(s).toMatchObject({ candidate: 'library', act: 'tool', target: '' });
    applyClaudeLine(s, assistant(toolUse('Edit', { file_path: '/a.ts' })), 1);
    expect(s).toMatchObject({ candidate: 'coding', act: 'edit' });
  });

  it('turn_duration -> lounge / idle after 3s', () => {
    const s = mk();
    s.room = s.candidate = 'coding';
    applyClaudeLine(s, '{"type":"system","subtype":"turn_duration"}', 0);
    tick(s, 3_000);
    expect(s.room).toBe('lounge');
    expect(s).toMatchObject({ act: 'idle', target: '' });
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

describe('local title (notifications only)', () => {
  const line = (o: unknown) => JSON.stringify(o);
  const user = (content: unknown, extra = {}) =>
    line({ type: 'user', message: { content }, ...extra });

  it('custom-title beats ai-title; the latest ai-title wins; first real prompt is the fallback', () => {
    const s = mk();
    applyClaudeLine(s, user('<command-name>/clear</command-name>'), 0);
    applyClaudeLine(s, user('Caveat: meta', { isMeta: true }), 0);
    applyClaudeLine(s, user([{ type: 'tool_result', tool_use_id: 'x', content: 'out' }]), 0);
    applyClaudeLine(
      s,
      user([{ type: 'text', text: '  검색 index\n설정해 줘 ' }], { cwd: '/w/repo' }),
      0,
    );
    applyClaudeLine(s, user('second prompt'), 0);
    expect(s.local).toEqual({
      customTitle: '',
      aiTitle: '',
      prompt: '검색 index 설정해 줘',
      cwd: '/w/repo',
    });
    applyClaudeLine(s, line({ type: 'ai-title', aiTitle: 'Old' }), 0);
    applyClaudeLine(s, line({ type: 'ai-title', aiTitle: 'New' }), 0);
    expect(s.local.aiTitle).toBe('New');
    applyClaudeLine(s, line({ type: 'custom-title', customTitle: 'Mine' }), 0);
    applyClaudeLine(s, line({ type: 'ai-title', aiTitle: 'Newer' }), 0);
    expect(s.local).toMatchObject({ customTitle: 'Mine', aiTitle: 'Newer' });
    expect(JSON.stringify(toViews(s))).not.toMatch(/Mine|Newer|검색|repo/);
  });
});

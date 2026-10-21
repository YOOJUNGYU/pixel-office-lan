import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { Act } from '../../../core/src/lan.js';
import { applyCodexLine, classifyShell, codexSessionMeta } from '../../src/lan/codexParser.js';
import { newSession, tick, toViews } from '../../src/lan/session.js';

const fixture = (name: string) =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf8')
    .split('\n')
    .filter(Boolean);
const mk = () => newSession('codex', 'c1', 'main', 0);
const item = (payload: unknown) => JSON.stringify({ type: 'response_item', payload });
const event = (payload: unknown) => JSON.stringify({ type: 'event_msg', payload });
const exec = (input: string, call_id = 'call_x') =>
  item({ type: 'custom_tool_call', name: 'exec', call_id, input });
const output = (text: string, call_id = 'call_x') =>
  item({ type: 'custom_tool_call_output', call_id, output: [{ type: 'input_text', text }] });

describe('applyCodexLine', () => {
  it('exec_command rg -> library, reason from AgentMessage', () => {
    const s = mk();
    for (const l of fixture('codex-exec.jsonl')) applyCodexLine(s, l, 1_000);
    tick(s, 4_000);
    expect(s.room).toBe('library');
    expect(s).toMatchObject({ act: 'read', target: "rg -n 'refresh' src" });
    expect(s.reason).toBe('검색 배치를 확인해 수정하겠습니다');
    expect(s.pendingTool).toBeNull();
    expect(s.lastLineAt).toBe(1_000);
  });

  it('apply_patch -> coding, basename', () => {
    const s = mk();
    applyCodexLine(
      s,
      exec(
        'const p = "*** Begin Patch\\n*** Update File: /x/y/login.ts\\n@@\\n-a\\n+b\\n*** End Patch";\ntext(await tools.apply_patch(p));',
      ),
      0,
    );
    expect(s.candidate).toBe('coding');
    expect(s).toMatchObject({ act: 'edit', target: 'login.ts' });
  });

  it('exec_command pnpm build -> server', () => {
    const s = mk();
    applyCodexLine(s, exec('text(await tools.exec_command({cmd:"pnpm build"}));'), 0);
    expect(s.candidate).toBe('server');
    expect(s).toMatchObject({ act: 'run', target: 'pnpm build' });
  });

  it('other tools', () => {
    const cases: [string, string | null, Act, string][] = [
      ['text(await tools.web__run({q:"x"}))', 'library', 'web', ''],
      ['text(await tools.view_image({path:"/a.png"}))', 'library', 'image', ''],
      [
        'text(await tools.exec_command({cmd:"cat \\"a b\\".ts | head"}))',
        'library',
        'read',
        'cat "a b".ts | head',
      ],
      ['text(await tools.write_stdin({session_id:1,chars:""}))', null, 'idle', 'keep'],
      ['text(await tools.update_plan({plan:[]}))', null, 'idle', 'keep'],
    ];
    for (const [input, room, act, target] of cases) {
      const s = mk();
      s.candidate = 'server';
      s.target = 'keep';
      applyCodexLine(s, exec(input), 0);
      expect(s).toMatchObject({ act, target });
      expect(s.candidate).toBe(room ?? 'server');
      expect(s.pendingTool).toMatchObject({ exempt: true });
    }
  });

  it('running exec becomes a shell view; removed when it exits', () => {
    const s = mk();
    const lines = fixture('codex-shell.jsonl');
    lines.slice(0, 2).forEach((l) => applyCodexLine(s, l, 0));
    expect(s.pendingTool).toBeNull();
    expect(toViews(s)).toContainEqual(
      expect.objectContaining({ id: 'c1/sh/7933', act: 'run', target: 'pnpm build' }),
    );
    lines.slice(2).forEach((l) => applyCodexLine(s, l, 1));
    expect(s.shells.size).toBe(0);
  });

  it('exit output carrying session_id removes the shell', () => {
    const s = mk();
    applyCodexLine(s, exec('tools.exec_command({cmd:"pnpm dev"})'), 0);
    applyCodexLine(s, output('{"session_id":7933,"output":""}'), 0);
    expect(s.shells.get('7933')).toBe('pnpm dev');
    applyCodexLine(s, output('{"session_id":7933,"exit_code":0}'), 0);
    expect(s.shells.size).toBe(0);
  });

  it('request_user_input -> lounge, immediate permission', () => {
    const s = mk();
    applyCodexLine(
      s,
      item({
        type: 'function_call',
        name: 'request_user_input_async',
        arguments: '{}',
        call_id: 'f1',
      }),
      0,
    );
    expect(s.permission).toBe(true);
    expect(s.candidate).toBe('lounge');
    expect(s).toMatchObject({ act: 'ask', target: '' });
  });

  it('assistant message sets reason; task_started resets it', () => {
    const s = mk();
    applyCodexLine(
      s,
      item({
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: '끝났습니다' }],
      }),
      0,
    );
    expect(s.reason).toBe('끝났습니다');
    applyCodexLine(s, event({ type: 'task_started' }), 1);
    expect(s.reason).toBe('');
  });

  it('task_complete -> lounge after 3s', () => {
    const s = mk();
    s.room = s.candidate = 'coding';
    applyCodexLine(s, event({ type: 'task_complete' }), 0);
    tick(s, 3_000);
    expect(s.room).toBe('lounge');
    expect(s).toMatchObject({ act: 'idle', target: '' });
  });

  it('legacy formats', () => {
    const cases: [unknown, string, Act, string][] = [
      [
        {
          type: 'function_call',
          name: 'shell',
          arguments: '{"command":["bash","-lc","cat a.ts"]}',
        },
        'library',
        'read',
        'cat a.ts',
      ],
      [
        { type: 'function_call', name: 'exec_command', arguments: '{"cmd":"make"}' },
        'server',
        'run',
        'make',
      ],
      [
        {
          type: 'custom_tool_call',
          name: 'apply_patch',
          input: '*** Begin Patch\n*** Add File: src/b.ts\n+x\n',
        },
        'coding',
        'edit',
        'b.ts',
      ],
      [{ type: 'web_search_call', action: { query: 'x' } }, 'library', 'web', ''],
    ];
    for (const [payload, room, act, target] of cases) {
      const s = mk();
      applyCodexLine(s, item(payload), 0);
      expect(s.candidate).toBe(room);
      expect(s).toMatchObject({ act, target });
    }
  });

  it('ignores garbage entirely', () => {
    const s = mk();
    expect(() => applyCodexLine(s, '{not json', 5)).not.toThrow();
    expect(() => applyCodexLine(s, 'null', 5)).not.toThrow();
    expect(() => applyCodexLine(s, item(null), 5)).not.toThrow();
    expect(s.act).toBe('idle');
  });

  it.skipIf(!process.env.REAL_CODEX_JSONL)('real transcript smoke', () => {
    const s = mk();
    const lines = readFileSync(process.env.REAL_CODEX_JSONL!, 'utf8').split('\n');
    codexSessionMeta(lines[0]);
    lines.forEach((l, i) => {
      applyCodexLine(s, l, i);
      tick(s, i);
    });
    toViews(s);
  });
});

describe('classifyShell', () => {
  it('read-ish commands -> library, others -> server', () => {
    for (const c of [
      'rg x',
      'ls -la',
      'sed -n 1,5p a',
      'git log -3',
      'git diff',
      'nl a | head',
      'tree',
    ])
      expect(classifyShell(c)).toBe('library');
    for (const c of ['pnpm build', 'sed -i s/a/b/ f', 'git commit -m x', 'cd a && rg x', ''])
      expect(classifyShell(c)).toBe('server');
  });
});

describe('codexSessionMeta', () => {
  it('reads id and subagent parent', () => {
    expect(
      codexSessionMeta(
        '{"type":"session_meta","payload":{"id":"c1","source":{"subagent":{"thread_spawn":{"parent_thread_id":"p1","depth":1}}}}}',
      ),
    ).toEqual({ id: 'c1', parentId: 'p1' });
    expect(
      codexSessionMeta('{"type":"session_meta","payload":{"id":"c1","source":"cli"}}'),
    ).toEqual({
      id: 'c1',
    });
    expect(codexSessionMeta('{"type":"event_msg","payload":{}}')).toBeNull();
    expect(codexSessionMeta('nope')).toBeNull();
  });
});

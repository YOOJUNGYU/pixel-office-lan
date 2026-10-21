import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

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
    expect(s.summary).toBe("읽는 중: rg -n 'refresh' src");
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
    expect(s.summary).toBe('login.ts 수정 중');
  });

  it('exec_command pnpm build -> server', () => {
    const s = mk();
    applyCodexLine(s, exec('text(await tools.exec_command({cmd:"pnpm build"}));'), 0);
    expect(s.candidate).toBe('server');
    expect(s.summary).toBe('명령 실행: pnpm build');
  });

  it('other tools', () => {
    const cases: [string, string | null, string][] = [
      ['text(await tools.web__run({q:"x"}))', 'library', '웹 검색 중'],
      ['text(await tools.view_image({path:"/a.png"}))', 'library', '이미지 보는 중'],
      [
        'text(await tools.exec_command({cmd:"cat \\"a b\\".ts | head"}))',
        'library',
        '읽는 중: cat "a b".ts | head',
      ],
      ['text(await tools.write_stdin({session_id:1,chars:""}))', null, 'keep'],
      ['text(await tools.update_plan({plan:[]}))', null, 'keep'],
    ];
    for (const [input, room, summary] of cases) {
      const s = mk();
      s.candidate = 'server';
      s.summary = 'keep';
      applyCodexLine(s, exec(input), 0);
      expect(s.summary).toBe(summary);
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
      expect.objectContaining({ id: 'c1/sh/7933', summary: '명령 실행: pnpm build' }),
    );
    lines.slice(2).forEach((l) => applyCodexLine(s, l, 1));
    expect(s.shells.size).toBe(0);
  });

  it('exit output carrying session_id removes the shell', () => {
    const s = mk();
    applyCodexLine(s, exec('tools.exec_command({cmd:"pnpm dev"})'), 0);
    applyCodexLine(s, output('{"session_id":7933,"output":""}'), 0);
    expect(s.shells.get('7933')).toBe('명령 실행: pnpm dev');
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
    expect(s.summary).toBe('답변 기다리는 중');
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
    expect(s.summary).toBe('대기 중');
  });

  it('legacy formats', () => {
    const cases: [unknown, string, string][] = [
      [
        {
          type: 'function_call',
          name: 'shell',
          arguments: '{"command":["bash","-lc","cat a.ts"]}',
        },
        'library',
        '읽는 중: cat a.ts',
      ],
      [
        { type: 'function_call', name: 'exec_command', arguments: '{"cmd":"make"}' },
        'server',
        '명령 실행: make',
      ],
      [
        {
          type: 'custom_tool_call',
          name: 'apply_patch',
          input: '*** Begin Patch\n*** Add File: src/b.ts\n+x\n',
        },
        'coding',
        'b.ts 수정 중',
      ],
      [{ type: 'web_search_call', action: { query: 'x' } }, 'library', '웹 검색 중'],
    ];
    for (const [payload, room, summary] of cases) {
      const s = mk();
      applyCodexLine(s, item(payload), 0);
      expect(s.candidate).toBe(room);
      expect(s.summary).toBe(summary);
    }
  });

  it('ignores garbage entirely', () => {
    const s = mk();
    expect(() => applyCodexLine(s, '{not json', 5)).not.toThrow();
    expect(() => applyCodexLine(s, 'null', 5)).not.toThrow();
    expect(() => applyCodexLine(s, item(null), 5)).not.toThrow();
    expect(s.summary).toBe('대기 중');
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

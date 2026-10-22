import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CheckPids, PidState } from '../../src/lan/liveness.js';
import { checkPids, domainOf, parseWslProc, statStart } from '../../src/lan/liveness.js';
import { discoverRoots, Scanner } from '../../src/lan/scanner.js';

const assistant = (content: unknown[]) =>
  JSON.stringify({ type: 'assistant', message: { content } }) + '\n';
const edit = (file: string) =>
  assistant([{ type: 'tool_use', id: 'e1', name: 'Edit', input: { file_path: `/x/${file}` } }]);

let dir: string;
let proj: string;
let t: number;
let scanner: Scanner;
const ago = (p: string, ms: number) => utimesSync(p, (t - ms) / 1000, (t - ms) / 1000);
const advance = async (ms: number) => {
  t += ms;
  await scanner.poll();
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'scan-'));
  proj = join(dir, 'claude', 'proj-a');
  mkdirSync(proj, { recursive: true });
  t = Date.now();
  scanner = new Scanner({ claude: [join(dir, 'claude')], codex: [join(dir, 'codex')] }, () => t);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('Scanner', () => {
  it('ignores files older than TTL, numbers fresh ones from 1', async () => {
    writeFileSync(join(proj, 'old.jsonl'), edit('a.ts'));
    ago(join(proj, 'old.jsonl'), 40 * 60_000);
    writeFileSync(join(proj, 'new.jsonl'), edit('a.ts'));
    await scanner.discover();
    expect(scanner.views().map((v) => [v.id, v.num])).toEqual([['new', 1]]);
  });

  it('reads only the tail of a large file', async () => {
    const grep = assistant([
      { type: 'text', text: 'OLD reason' },
      { type: 'tool_use', id: 'g', name: 'Grep', input: { pattern: 'x' } },
    ]);
    const p = join(proj, 'big.jsonl');
    const noise = JSON.stringify({ type: 'progress', pad: 'x'.repeat(1000) }) + '\n';
    const head = grep.repeat(Math.ceil((2 * 1024 * 1024) / grep.length));
    // the tail window holds only noise + Edit: a full parse would leave reason 'OLD reason'
    writeFileSync(p, head + noise.repeat(100) + edit('login.ts'));
    await scanner.discover();
    await advance(3_000);
    const [v] = scanner.views();
    expect(v).toMatchObject({ room: 'coding', act: 'edit', target: 'login.ts', reason: '' });
  });

  it('buffers a line split across polls (incl. split multibyte char)', async () => {
    const p = join(proj, 's.jsonl');
    writeFileSync(p, '');
    await scanner.discover();
    const line = Buffer.from(edit('한글.ts'));
    const cut = line.indexOf(Buffer.from('한')) + 1; // mid-character
    appendFileSync(p, line.subarray(0, cut));
    await scanner.poll();
    appendFileSync(p, line.subarray(cut));
    await scanner.poll();
    await advance(3_000);
    expect(scanner.views()[0]).toMatchObject({ room: 'coding', act: 'edit', target: '한글.ts' });
  });

  it('registers subagents with parentId', async () => {
    mkdirSync(join(proj, 'sid', 'subagents'), { recursive: true });
    writeFileSync(join(proj, 'sid', 'subagents', 'agent-x.jsonl'), edit('a.ts'));
    await scanner.discover();
    expect(scanner.views()).toMatchObject([
      { id: 'sid/sub/agent-x', kind: 'subagent', parentId: 'sid', num: 0 },
    ]);
  });

  it('hides a subagent 10s after its turn ended', async () => {
    mkdirSync(join(proj, 'sid', 'subagents'), { recursive: true });
    const p = join(proj, 'sid', 'subagents', 'agent-x.jsonl');
    writeFileSync(p, edit('a.ts'));
    await scanner.discover();
    appendFileSync(p, JSON.stringify({ type: 'system', subtype: 'turn_duration' }) + '\n');
    await advance(1_000);
    expect(scanner.views()).toHaveLength(1);
    await advance(10_000);
    expect(scanner.views()).toHaveLength(0);
  });

  it('reuses the smallest free num', async () => {
    writeFileSync(join(proj, 'a.jsonl'), edit('a.ts'));
    await scanner.discover();
    writeFileSync(join(proj, 'b.jsonl'), edit('b.ts'));
    await scanner.discover();
    ago(join(proj, 'a.jsonl'), 40 * 60_000);
    await scanner.poll();
    writeFileSync(join(proj, 'c.jsonl'), edit('c.ts'));
    await scanner.discover();
    const nums = Object.fromEntries(scanner.views().map((v) => [v.id, v.num]));
    expect(nums).toEqual({ b: 2, c: 1 });
  });

  it('finds codex rollouts in today dir, subagent id from meta', async () => {
    const d = new Date(t);
    const day = join(
      dir,
      'codex',
      String(d.getFullYear()),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0'),
    );
    mkdirSync(day, { recursive: true });
    const meta = (id: string, parent?: string) =>
      JSON.stringify({
        type: 'session_meta',
        payload: {
          id,
          source: parent ? { subagent: { thread_spawn: { parent_thread_id: parent } } } : 'cli',
        },
      }) + '\n';
    writeFileSync(join(day, 'rollout-a.jsonl'), meta('m1'));
    writeFileSync(join(day, 'rollout-b.jsonl'), meta('c1', 'm1'));
    await scanner.discover();
    const views = scanner.views().sort((a, b) => a.id.localeCompare(b.id));
    expect(views).toMatchObject([
      { id: 'm1', provider: 'codex', kind: 'main', num: 1 },
      { id: 'm1/sub/c1', kind: 'subagent', parentId: 'm1' },
    ]);
  });

  it('subagents inherit the parent session bypassPermissions mode', async () => {
    writeFileSync(
      join(proj, 'm.jsonl'),
      '{"type":"permission-mode","permissionMode":"bypassPermissions","sessionId":"m"}\n',
    );
    mkdirSync(join(proj, 'm', 'subagents'), { recursive: true });
    writeFileSync(
      join(proj, 'm', 'subagents', 'agent-x.jsonl'),
      assistant([{ type: 'tool_use', id: 'b', name: 'Bash', input: { command: 'npm test' } }]),
    );
    await scanner.discover();
    await advance(30_000);
    const sub = scanner.views().find((v) => v.kind === 'subagent');
    expect(sub).toMatchObject({ room: 'server', permission: false });
  });

  it('re-reads roots each discover and drops files under a vanished root', async () => {
    writeFileSync(join(proj, 'a.jsonl'), edit('a.ts'));
    let roots = { claude: [join(dir, 'claude')], codex: [] as string[] };
    const s = new Scanner(
      async () => roots,
      () => t,
    );
    await s.discover();
    expect(s.views()).toHaveLength(1);
    roots = { claude: [], codex: [] };
    await s.discover();
    expect(s.views()).toEqual([]);
  });

  it('never throws when a root is missing', async () => {
    const s = new Scanner({ claude: ['/nonexistent/x'], codex: ['/nonexistent/y'] });
    await s.discover();
    await s.poll();
    expect(s.views()).toEqual([]);
  });
});

describe('discoverRoots', () => {
  it('uses CLAUDE_CONFIG_DIR / CODEX_HOME', async () => {
    expect(
      await discoverRoots({ CLAUDE_CONFIG_DIR: '/c', CODEX_HOME: '/x' }, 'linux', '/h'),
    ).toEqual({ claude: ['/c/projects'], codex: ['/x/sessions'] });
  });

  it('adds existing WSL roots on win32', async () => {
    const dirs: Record<string, string[]> = {
      '\\\\wsl.localhost\\Ubuntu\\home': ['me'],
      '\\\\wsl.localhost\\Ubuntu\\home\\me\\.claude\\projects': [],
    };
    const readdir = async (p: string) => {
      if (!dirs[p]) throw new Error('ENOENT');
      return dirs[p];
    };
    const roots = await discoverRoots({}, 'win32', 'C:\\Users\\me', {
      listDistros: async () => ['Ubuntu'],
      readdir,
    });
    expect(roots).toEqual({
      claude: [
        'C:\\Users\\me\\.claude\\projects',
        '\\\\wsl.localhost\\Ubuntu\\home\\me\\.claude\\projects',
      ],
      codex: ['C:\\Users\\me\\.codex\\sessions'],
    });
  });

  it('skips docker-desktop distros (only running distros are listed)', async () => {
    const seen: string[] = [];
    const roots = await discoverRoots({}, 'win32', 'C:\\Users\\me', {
      listDistros: async () => ['docker-desktop', 'docker-desktop-data', 'Ubuntu'],
      readdir: async (p: string) => {
        seen.push(p);
        throw new Error('ENOENT');
      },
    });
    expect(roots.claude).toEqual(['C:\\Users\\me\\.claude\\projects']);
    expect(seen.some((p) => p.includes('docker-desktop'))).toBe(false);
    expect(seen.some((p) => p.includes('Ubuntu'))).toBe(true);
  });

  it('parses wsl.exe -l -q UTF-16LE output', async () => {
    const { parseWslList } = await import('../../src/lan/scanner.js');
    expect(parseWslList(Buffer.from('\uFEFFUbuntu\r\nDebian\r\n', 'utf16le'))).toEqual([
      'Ubuntu',
      'Debian',
    ]);
  });
});

describe('closed sessions (Claude sessions/<pid>.json registry)', () => {
  const reg = (pid: number, sessionId: string, procStart?: string) => {
    mkdirSync(join(dir, 'sessions'), { recursive: true });
    writeFileSync(
      join(dir, 'sessions', `${pid}.json`),
      JSON.stringify({ pid, sessionId, procStart }),
    );
  };
  let state: PidState | 'throw';
  const pids: CheckPids = async (_domain, entries) => {
    if (state === 'throw') throw new Error('wsl.exe timed out');
    return new Map(entries.map((e) => [e.pid, state as PidState]));
  };
  beforeEach(() => {
    state = 'alive';
    scanner = new Scanner(
      { claude: [join(dir, 'claude')], codex: [join(dir, 'codex')] },
      () => t,
      pids,
    );
  });

  it('a live session stays; once its pid is dead it leaves on the next poll, with its subagents', async () => {
    writeFileSync(join(proj, 's1.jsonl'), edit('a.ts'));
    mkdirSync(join(proj, 's1', 'subagents'), { recursive: true });
    writeFileSync(join(proj, 's1', 'subagents', 'agent-x.jsonl'), edit('b.ts'));
    writeFileSync(join(proj, 'other.jsonl'), edit('c.ts')); // no registry entry: TTL as before
    reg(100, 's1');
    await scanner.discover();
    await advance(1_000);
    expect(
      scanner
        .views()
        .map((v) => v.id)
        .sort(),
    ).toEqual(['other', 's1', 's1/sub/agent-x']);
    state = 'dead';
    await scanner.discover();
    await advance(1_000);
    expect(scanner.views().map((v) => v.id)).toEqual(['other']);
  });

  it('a failed check never closes anything (falls back to the TTL)', async () => {
    writeFileSync(join(proj, 's1.jsonl'), edit('a.ts'));
    reg(100, 's1');
    for (const s of ['throw', 'unknown'] as const) {
      state = s;
      await scanner.discover();
      await advance(1_000);
      expect(scanner.views().map((v) => v.id)).toEqual(['s1']);
    }
  });

  it('one live process of a resumed session keeps it open', async () => {
    writeFileSync(join(proj, 's1.jsonl'), edit('a.ts'));
    reg(100, 's1');
    reg(200, 's1');
    const mixed: CheckPids = async (_d, entries) =>
      new Map(entries.map((e) => [e.pid, e.pid === 200 ? 'alive' : 'dead']));
    scanner = new Scanner({ claude: [join(dir, 'claude')], codex: [] }, () => t, mixed);
    await scanner.discover();
    expect(scanner.views().map((v) => v.id)).toEqual(['s1']);
  });

  it('a finished Codex turn leaves after 10 minutes, a running one after 30', async () => {
    const d = new Date(t);
    const day = join(
      dir,
      'codex',
      String(d.getFullYear()),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0'),
    );
    mkdirSync(day, { recursive: true });
    const meta = (id: string) =>
      JSON.stringify({ type: 'session_meta', payload: { id, source: 'cli' } }) + '\n';
    const done = JSON.stringify({ type: 'event_msg', payload: { type: 'task_complete' } }) + '\n';
    writeFileSync(join(day, 'rollout-done.jsonl'), meta('done') + done);
    writeFileSync(join(day, 'rollout-busy.jsonl'), meta('busy'));
    ago(join(day, 'rollout-done.jsonl'), 11 * 60_000);
    ago(join(day, 'rollout-busy.jsonl'), 11 * 60_000);
    await scanner.discover();
    expect(scanner.views().map((v) => v.id)).toEqual(['busy']);
  });
});

describe('liveness', () => {
  it('statStart/parseWslProc read field 22, even with spaces and parens in comm', () => {
    const fields = Array.from({ length: 50 }, (_, i) => String(i + 3)); // field 3 = '3'
    expect(statStart(`42 (a) b (c)) ${fields.join(' ')}`)).toBe('22');
    const out = `10 ${fields.join(' ')}\r\n11 -\nnot a line\n`;
    expect([...parseWslProc(out)]).toEqual([
      [10, '22'],
      [11, null],
    ]);
  });

  it('a reused pid with another start time is dead; this process is alive', async () => {
    const entry = { pid: process.pid, sessionId: 's' };
    expect((await checkPids('local', [entry])).get(process.pid)).toBe('alive');
    if (process.platform === 'linux') {
      const real = statStart(readFileSync(`/proc/${process.pid}/stat`, 'utf8'))!;
      const st = await checkPids('local', [{ ...entry, procStart: real }]);
      expect(st.get(process.pid)).toBe('alive');
      const reused = await checkPids('local', [{ ...entry, procStart: `${real}9` }]);
      expect(reused.get(process.pid)).toBe('dead');
    }
    expect(
      (await checkPids('local', [{ pid: 999_999_999, sessionId: 's' }])).get(999_999_999),
    ).toBe('dead');
  });

  it('domainOf: WSL roots by distro, everything else local', () => {
    expect(domainOf('\\\\wsl.localhost\\Ubuntu\\home\\me\\.claude\\projects')).toBe('Ubuntu');
    expect(domainOf('\\\\wsl$\\Debian\\root\\.claude\\projects')).toBe('Debian');
    expect(domainOf('/home/me/.claude/projects')).toBe('local');
  });
});

import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PUBLIC_VIEW } from '../../../core/src/lan.js';
import { createIdentity } from '../../src/lan/crypto.js';
import type { CheckPids, PidState } from '../../src/lan/liveness.js';
import {
  checkLocal,
  domainOf,
  judgeWsl,
  parseWslProc,
  sameDomain,
  statStart,
} from '../../src/lan/liveness.js';
import { LanService } from '../../src/lan/office.js';
import { discoverRoots, Scanner, wslSessionsToCheck } from '../../src/lan/scanner.js';
import { newSession } from '../../src/lan/session.js';

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

  it('a subagent talks with its parent: just started, reporting back, and on a SendMessage', async () => {
    const talk = (id = 'agent-a1') => scanner.views().find((v) => v.id === `m/sub/${id}`)?.talk;
    writeFileSync(join(proj, 'm.jsonl'), edit('a.ts'));
    mkdirSync(join(proj, 'm', 'subagents'), { recursive: true });
    const old = join(proj, 'm', 'subagents', 'agent-old.jsonl');
    writeFileSync(old, edit('a.ts'));
    await scanner.discover(); // first scan: already running before we looked, no talk
    expect(talk('agent-old')).toBeUndefined();

    const p = join(proj, 'm', 'subagents', 'agent-a1.jsonl');
    writeFileSync(p, edit('b.ts'));
    await scanner.discover(); // task just handed over
    expect(talk()).toBe(true);
    await advance(5_000);
    expect(talk()).toBeUndefined();

    appendFileSync(p, JSON.stringify({ type: 'system', subtype: 'turn_duration' }) + '\n');
    await advance(1_000); // done: reports back
    expect(talk()).toBe(true);
    await advance(5_000);
    expect(talk()).toBeUndefined();

    appendFileSync(
      join(proj, 'm.jsonl'),
      assistant([
        { type: 'tool_use', id: 's', name: 'SendMessage', input: { to: 'a1', message: 'hi' } },
      ]),
    );
    await advance(1_000);
    expect(talk()).toBe(true);
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

  it('session titles stay local: Scanner.info has them, the peer packet never does', async () => {
    const line = (o: unknown) => JSON.stringify(o) + '\n';
    writeFileSync(
      join(proj, 'cl.jsonl'),
      line({ type: 'user', cwd: '/w/secret-repo', message: { content: 'SECRET prompt text' } }) +
        line({ type: 'ai-title', aiTitle: 'AUTO title' }) +
        line({ type: 'custom-title', customTitle: 'MY secret title' }) +
        edit('a.ts'),
    );
    const d = new Date(t);
    const day = join(
      dir,
      'codex',
      String(d.getFullYear()),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0'),
    );
    mkdirSync(day, { recursive: true });
    writeFileSync(
      join(day, 'rollout-x.jsonl'),
      line({ type: 'session_meta', payload: { id: 'cx', cwd: '/w/codex-repo' } }) +
        line({
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'CODEX prompt' }],
          },
        }),
    );
    await scanner.discover();
    expect(scanner.info('cl')).toEqual({ title: 'MY secret title', folder: 'secret-repo' });
    expect(scanner.info('cx')).toEqual({ title: 'CODEX prompt', folder: 'codex-repo' });
    // the index appears / is renamed (appended): re-read on change, last line wins
    const idx = join(dir, 'session_index.jsonl');
    writeFileSync(idx, line({ id: 'cx', thread_name: 'Old name' }));
    await scanner.discover();
    appendFileSync(idx, line({ id: 'cx', thread_name: 'CODEX thread' }));
    ago(idx, -5_000); // a different mtime, as a real append gives
    await scanner.discover();
    expect(scanner.info('cx')?.title).toBe('CODEX thread');

    for (const hideWork of [false, true]) {
      const lan = new LanService(
        {
          peerId: 'me',
          nickname: '',
          palette: 0,
          hueShift: 0,
          hideWork,
          manualPeers: [],
          identity: (({ publicKey, privateKeyPem }) => ({ publicKey, privateKeyPem }))(
            createIdentity('me'),
          ),
          offices: [],
          activeView: PUBLIC_VIEW,
          setUp: false,
          nicknameSince: 0,
        },
        scanner,
      );
      const sent = JSON.stringify(lan.packet(PUBLIC_VIEW));
      expect(sent).toContain('"provider":"codex"'); // the views are there
      expect(sent).not.toMatch(/SECRET|secret|AUTO title|CODEX|codex-repo|Old name/);
    }
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

  it('closed transcripts are not re-read every cycle; a changed one is looked at again', async () => {
    const p = join(proj, 's1.jsonl');
    writeFileSync(p, edit('a.ts'));
    reg(100, 's1');
    state = 'dead';
    await scanner.discover();
    expect(scanner.views()).toEqual([]);
    rmSync(p); // gone: a later cycle must not even need it
    writeFileSync(p, edit('a.ts'));
    ago(p, 0);
    state = 'alive'; // resumed by a new process
    await scanner.discover();
    expect(scanner.views().map((v) => v.id)).toEqual(['s1']);
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
  const NS = 'pid:[4026532223]';
  const self = { ns: NS, machine: '975a0eb4-24d3-43f9-98183fb66dd8a2bb' };
  const dom = (ns = NS) => `linux:975a0eb424d343f998183fb66dd8a2bb:${ns}`;

  it('sameDomain: same namespace (and machine) only; other formats are unknown', () => {
    expect(sameDomain(dom(), self)).toBe(true);
    expect(sameDomain(dom('pid:[4026532222]'), self)).toBe(false); // Claude Desktop's namespace
    expect(sameDomain('linux:ffff:' + NS, self)).toBe(false); // another machine
    expect(sameDomain(undefined, self)).toBe(false); // older Claude: no domain
    expect(sameDomain('win32:1234', self)).toBe(false);
    expect(sameDomain(dom(), null)).toBe(false); // checker's domain unknown (macOS/Windows)
  });

  it('statStart/parseWslProc read field 22, even with spaces and parens in comm', () => {
    const fields = Array.from({ length: 50 }, (_, i) => String(i + 3)); // field 3 = '3'
    expect(statStart(`42 (a) b (c)) ${fields.join(' ')}`)).toBe('22');
    const out = `self ${NS} 975a0eb424d343f998183fb66dd8a2bb\n10 ${fields.join(' ')}\r\n11 -\nnot a line\n`;
    const r = parseWslProc(out);
    expect(r.self).toEqual({ ns: NS, machine: '975a0eb424d343f998183fb66dd8a2bb' });
    expect([...r.procs]).toEqual([
      [10, '22'],
      [11, null],
    ]);
  });

  it('judgeWsl: only same-namespace pids are judged; a failed call keeps everything', () => {
    const fields = Array.from({ length: 50 }, (_, i) => String(i + 3));
    const out = `self ${NS} 975a0eb424d343f998183fb66dd8a2bb\n10 ${fields.join(' ')}\n11 -\n12 -\n`;
    const entries = [
      { pid: 10, sessionId: 'a', pidDomain: dom(), procStart: '22' },
      { pid: 11, sessionId: 'b', pidDomain: dom() },
      { pid: 12, sessionId: 'desktop', pidDomain: dom('pid:[4026532222]') },
      { pid: 10, sessionId: 'reused', pidDomain: dom(), procStart: '99' },
    ];
    const st = judgeWsl(entries.slice(0, 3), out);
    expect([...st]).toEqual([
      [10, 'alive'],
      [11, 'dead'],
      [12, 'unknown'],
    ]);
    expect(judgeWsl([entries[3]], out).get(10)).toBe('dead'); // reused pid: other start time
    expect([...judgeWsl(entries.slice(0, 2), null).values()]).toEqual(['unknown', 'unknown']);
  });

  it('checkLocal: a reused pid with another start time is dead; this process is alive', async () => {
    if (process.platform !== 'linux') return;
    const ns = readlinkSync('/proc/self/ns/pid');
    const me = { ns };
    const domain = `linux::${ns}`;
    const real = statStart(readFileSync(`/proc/${process.pid}/stat`, 'utf8'))!;
    const entry = { pid: process.pid, sessionId: 's', pidDomain: domain };
    expect((await checkLocal([{ ...entry, procStart: real }], me)).get(process.pid)).toBe('alive');
    expect((await checkLocal([{ ...entry, procStart: `${real}9` }], me)).get(process.pid)).toBe(
      'dead',
    );
    expect((await checkLocal([{ ...entry, pid: 999_999_999 }], me)).get(999_999_999)).toBe('dead');
    // another namespace (or no pidDomain): never judged
    const other = { ...entry, pidDomain: 'linux::pid:[1]' };
    expect((await checkLocal([other], me)).get(process.pid)).toBe('unknown');
    expect((await checkLocal([{ pid: process.pid, sessionId: 's' }], me)).get(process.pid)).toBe(
      'unknown',
    );
  });

  it('domainOf: WSL roots by distro, everything else local', () => {
    expect(domainOf('\\\\wsl.localhost\\Ubuntu\\home\\me\\.claude\\projects')).toBe('Ubuntu');
    expect(domainOf('\\\\wsl$\\Debian\\root\\.claude\\projects')).toBe('Debian');
    expect(domainOf('/home/me/.claude/projects')).toBe('local');
  });
});

describe('WSL liveness checks only for shown sessions', () => {
  it('no WSL session shown: no wsl.exe (the injected checker is never called)', async () => {
    const calls: string[] = [];
    const pids: CheckPids = async (domain, entries) => {
      calls.push(domain);
      return new Map(entries.map((e) => [e.pid, 'alive' as const]));
    };
    const root = '\\\\wsl.localhost\\Ubuntu\\home\\me\\.claude\\projects';
    const s = new Scanner({ claude: [root], codex: [] }, () => t, pids);
    await s.discover();
    await s.discover();
    expect(calls).toEqual([]);
  });

  it('wslSessionsToCheck: shown Claude sessions (and parents of subagents) per distro only', () => {
    const w = (d: string, f: string) =>
      `\\\\wsl.localhost\\${d}\\home\\me\\.claude\\projects\\p\\${f}`;
    const m = wslSessionsToCheck([
      [w('Ubuntu', 'a.jsonl'), newSession('claude', 'a', 'main', 0)],
      [w('Ubuntu', 'a/subagents/x.jsonl'), newSession('claude', 'b/sub/x', 'subagent', 0, 'b')],
      [w('Debian', 'c.jsonl'), newSession('codex', 'c', 'main', 0)],
      ['/home/me/.claude/projects/p/d.jsonl', newSession('claude', 'd', 'main', 0)],
    ]);
    expect([...m].map(([d, ids]) => [d, [...ids]])).toEqual([['Ubuntu', ['a', 'b']]]);
  });
});

import { appendFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
    expect(v).toMatchObject({ room: 'coding', summary: 'login.ts 수정 중', reason: '' });
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
    expect(scanner.views()[0]).toMatchObject({ room: 'coding', summary: '한글.ts 수정 중' });
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

  it('parses wsl.exe -l -q UTF-16LE output', async () => {
    const { parseWslList } = await import('../../src/lan/scanner.js');
    expect(parseWslList(Buffer.from('\uFEFFUbuntu\r\nDebian\r\n', 'utf16le'))).toEqual([
      'Ubuntu',
      'Debian',
    ]);
  });
});

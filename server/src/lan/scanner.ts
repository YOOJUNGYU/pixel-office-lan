// Finds live Claude/Codex transcripts on this PC, tails them into session state.
import type { FileHandle } from 'node:fs/promises';
import { open, readdir, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { StringDecoder } from 'node:string_decoder';

import type { AgentView, Provider } from '../../../core/src/lan.js';
import {
  CHILD_ENDED_HIDE_MS,
  CHILD_IDLE_TTL_MS,
  CODEX_META_MAX_BYTES,
  DISCOVER_INTERVAL_MS,
  POLL_INTERVAL_MS,
  SESSION_TTL_MS,
  TAIL_BYTES,
} from '../constants.js';
import { applyClaudeLine } from './claudeParser.js';
import { applyCodexLine, codexSessionMeta } from './codexParser.js';
import type { Roots } from './roots.js';
import type { SessionState } from './session.js';
import { newSession, tick, toViews } from './session.js';

export { CHILD_IDLE_TTL_MS, SESSION_TTL_MS, TAIL_BYTES };
export type { Roots } from './roots.js';
export { discoverRoots, parseWslList } from './roots.js';

// ── Scanner ────────────────────────────────────────────────

interface Tracked {
  s: SessionState;
  apply: (s: SessionState, line: string, now: number) => void;
  offset: number;
  buf: string;
  decoder: StringDecoder;
  /** first complete line is a fragment (tail started mid-file) */
  dropFirst: boolean;
  mtimeMs: number;
  /** when a subagent's turn ended, null while running */
  endedAt: number | null;
}

interface Candidate {
  file: string;
  provider: Provider;
  /** Claude subagent: parent session id */
  parentId?: string;
}

const dirents = (d: string) => readdir(d, { withFileTypes: true }).catch(() => []);
const jsonlBase = (f: string) => path.basename(f, '.jsonl');
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\.jsonl$)/i;
const pad = (n: number) => String(n).padStart(2, '0');

/** Reads [from, to) of an open file. */
async function readRange(fh: FileHandle, from: number, to: number): Promise<Buffer> {
  const buf = Buffer.alloc(to - from);
  const { bytesRead } = await fh.read(buf, 0, buf.length, from);
  return buf.subarray(0, bytesRead);
}

async function firstLine(file: string): Promise<string> {
  const fh = await open(file, 'r');
  try {
    const head = await readRange(fh, 0, CODEX_META_MAX_BYTES);
    const nl = head.indexOf(0x0a);
    return nl < 0 ? '' : head.subarray(0, nl).toString('utf8');
  } finally {
    await fh.close();
  }
}

// ponytail: 폴링 기반, WSL 9P 위 수천 파일에서 느리면 루트별 간격 조정
export class Scanner {
  private files = new Map<string, Tracked>();
  private timers: NodeJS.Timeout[] = [];
  private discovering = false;
  private polling = false;

  constructor(
    private roots: Roots,
    private now: () => number = Date.now,
  ) {}

  async discover(): Promise<void> {
    for (const c of await this.candidates()) {
      if (this.files.has(c.file)) continue;
      try {
        await this.register(c);
      } catch {
        // vanished / unreadable: retry next cycle
      }
    }
  }

  async poll(): Promise<void> {
    const now = this.now();
    for (const [file, t] of this.files) {
      try {
        const st = await stat(file);
        t.mtimeMs = st.mtimeMs;
        if (st.size < t.offset) {
          t.offset = 0;
          t.buf = '';
          t.decoder = new StringDecoder('utf8');
        }
        if (st.size > t.offset) await this.readNew(file, t, st.size, now);
      } catch {
        // ENOENT/EACCES/UNC hiccup: keep last mtime, TTL removes it eventually
      }
      tick(t.s, now);
      if (t.s.kind === 'subagent') {
        if (!t.s.turnEnded) t.endedAt = null;
        else t.endedAt ??= now;
      }
      if (now - t.mtimeMs > (t.s.kind === 'main' ? SESSION_TTL_MS : CHILD_IDLE_TTL_MS)) {
        this.files.delete(file);
      }
    }
  }

  views(): AgentView[] {
    const now = this.now();
    return [...this.files.values()]
      .filter((t) => t.endedAt === null || now - t.endedAt < CHILD_ENDED_HIDE_MS)
      .flatMap((t) => toViews(t.s));
  }

  start(): void {
    if (this.timers.length) return;
    const guard = (key: 'discovering' | 'polling', fn: () => Promise<void>) => async () => {
      if (this[key]) return;
      this[key] = true;
      try {
        await fn();
      } finally {
        this[key] = false;
      }
    };
    const disc = guard('discovering', () => this.discover());
    void disc();
    this.timers = [
      setInterval(disc, DISCOVER_INTERVAL_MS),
      setInterval(
        guard('polling', () => this.poll()),
        POLL_INTERVAL_MS,
      ),
    ];
    for (const t of this.timers) t.unref();
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  private async candidates(): Promise<Candidate[]> {
    const out: Candidate[] = [];
    for (const root of this.roots.claude) {
      for (const proj of await dirents(root)) {
        if (!proj.isDirectory()) continue;
        const projDir = path.join(root, proj.name);
        for (const e of await dirents(projDir)) {
          if (e.isFile() && e.name.endsWith('.jsonl')) {
            out.push({ file: path.join(projDir, e.name), provider: 'claude' });
          } else if (e.isDirectory()) {
            const subDir = path.join(projDir, e.name, 'subagents');
            for (const s of await dirents(subDir)) {
              if (s.isFile() && s.name.endsWith('.jsonl')) {
                out.push({ file: path.join(subDir, s.name), provider: 'claude', parentId: e.name });
              }
            }
          }
        }
      }
    }
    const d = new Date(this.now());
    const days = [0, 1].map((back) => {
      const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() - back);
      return [String(x.getFullYear()), pad(x.getMonth() + 1), pad(x.getDate())];
    });
    for (const root of this.roots.codex) {
      for (const day of days) {
        const dayDir = path.join(root, ...day);
        for (const e of await dirents(dayDir)) {
          if (e.isFile() && e.name.endsWith('.jsonl')) {
            out.push({ file: path.join(dayDir, e.name), provider: 'codex' });
          }
        }
      }
    }
    return out;
  }

  private async register(c: Candidate): Promise<void> {
    const now = this.now();
    const st = await stat(c.file);
    let parentId = c.parentId;
    let id = parentId ? `${parentId}/sub/${jsonlBase(c.file)}` : jsonlBase(c.file);
    if (now - st.mtimeMs > (parentId ? CHILD_IDLE_TTL_MS : SESSION_TTL_MS)) return;
    if (c.provider === 'codex') {
      const meta = codexSessionMeta(await firstLine(c.file));
      parentId = meta?.parentId;
      const metaId = meta?.id ?? UUID_RE.exec(c.file)?.[0] ?? jsonlBase(c.file);
      id = parentId ? `${parentId}/sub/${metaId}` : metaId;
      if (parentId && now - st.mtimeMs > CHILD_IDLE_TTL_MS) return;
    }
    const s = newSession(c.provider, id, parentId ? 'subagent' : 'main', now, parentId);
    if (s.kind === 'main') s.num = this.freeNum();
    const start = Math.max(0, st.size - TAIL_BYTES);
    const t: Tracked = {
      s,
      apply: c.provider === 'claude' ? applyClaudeLine : applyCodexLine,
      offset: start,
      buf: '',
      decoder: new StringDecoder('utf8'),
      dropFirst: start > 0,
      mtimeMs: st.mtimeMs,
      endedAt: null,
    };
    await this.readNew(c.file, t, st.size, now);
    // already-finished subagent: count from its last write, not from now
    if (s.kind === 'subagent' && s.turnEnded) t.endedAt = st.mtimeMs;
    this.files.set(c.file, t);
  }

  private async readNew(file: string, t: Tracked, size: number, now: number): Promise<void> {
    const fh = await open(file, 'r');
    let chunk: Buffer;
    try {
      chunk = await readRange(fh, t.offset, size);
    } finally {
      await fh.close();
    }
    t.offset += chunk.length;
    const lines = (t.buf + t.decoder.write(chunk)).split('\n');
    t.buf = lines.pop() ?? '';
    for (const line of lines) {
      if (t.dropFirst) {
        t.dropFirst = false;
        continue;
      }
      if (line.trim()) t.apply(t.s, line, now);
    }
  }

  private freeNum(): number {
    const used = new Set([...this.files.values()].map((t) => t.s.num));
    let n = 1;
    while (used.has(n)) n++;
    return n;
  }
}

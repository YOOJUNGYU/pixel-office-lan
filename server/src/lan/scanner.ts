// Finds live Claude/Codex transcripts on this PC, tails them into session state.
import type { FileHandle } from 'node:fs/promises';
import { open, readdir, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { StringDecoder } from 'node:string_decoder';

import type { AgentView, Provider } from '../../../core/src/lan.js';
import {
  CHILD_ENDED_HIDE_MS,
  CHILD_IDLE_TTL_MS,
  CODEX_ENDED_TTL_MS,
  CODEX_INDEX_MAX_BYTES,
  CODEX_META_MAX_BYTES,
  DISCOVER_INTERVAL_MS,
  POLL_INTERVAL_MS,
  SESSION_TTL_MS,
  TAIL_BYTES,
} from '../constants.js';
import { applyClaudeLine } from './claudeParser.js';
import { applyCodexLine, codexSessionMeta, parseCodexIndex } from './codexParser.js';
import type { CheckPids, RegEntry } from './liveness.js';
import { checkPids, domainOf, readRegistry } from './liveness.js';
import type { Roots } from './roots.js';
import type { SessionState } from './session.js';
import { folderOf, newSession, tick, toViews } from './session.js';

export { CHILD_IDLE_TTL_MS, SESSION_TTL_MS, TAIL_BYTES };
export type { Roots } from './roots.js';
export { discoverRoots, parseWslList } from './roots.js';

/** What a main session is about, for this PC's own notifications. LOCAL ONLY. */
export interface AgentInfo {
  /** user rename > auto title (Claude) / thread name (Codex) > first prompt; '' unknown */
  title: string;
  /** project folder (basename of the session cwd); '' unknown */
  folder: string;
}

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

/**
 * Claude session ids shown from each WSL distro, by distro. Only these are
 * checked there, so a distro none of whose sessions is shown is never woken
 * (no wsl.exe at all).
 */
export function wslSessionsToCheck(files: Array<[string, SessionState]>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [file, s] of files) {
    const domain = domainOf(file);
    if (domain === 'local' || s.provider !== 'claude') continue;
    const ids = out.get(domain) ?? new Set<string>();
    ids.add(s.kind === 'main' ? s.id : (s.parentId ?? ''));
    out.set(domain, ids);
  }
  return out;
}

/** How long after its last line a transcript stays: a finished Codex turn leaves sooner. */
function ttl(s: SessionState): number {
  if (s.kind !== 'main') return CHILD_IDLE_TTL_MS;
  return s.provider === 'codex' && s.turnEnded ? CODEX_ENDED_TTL_MS : SESSION_TTL_MS;
}

// ponytail: 폴링 기반, WSL 9P 위 수천 파일에서 느리면 루트별 간격 조정
export class Scanner {
  private files = new Map<string, Tracked>();
  private timers: NodeJS.Timeout[] = [];
  private discovering = false;
  private polling = false;

  private roots: Roots = { claude: [], codex: [] };
  /** Claude session ids whose registry pids are all dead (closed): dropped at once, not after the TTL. */
  private closed = new Set<string>();
  /** file → mtime when it was turned away (closed / expired): skipped until it changes. */
  private rejected = new Map<string, number>();
  /** Codex session_index.jsonl per path: `mtime:size` read last + id → thread name. */
  private codexIndex = new Map<string, { key: string; names: Map<string, string> }>();

  /** A function is re-run every discover cycle (running WSL distros come and go). */
  constructor(
    private readonly rootsSource: Roots | (() => Promise<Roots>),
    private now: () => number = Date.now,
    private readonly pids: CheckPids = checkPids,
  ) {
    if (typeof rootsSource !== 'function') this.roots = rootsSource;
  }

  /**
   * Claude's `sessions/<pid>.json` registry: a session with a live pid is open,
   * one whose pids are all dead is closed. No entry, or a check that failed
   * (WSL unreachable): unknown, the transcript TTL decides as before.
   */
  private async refreshClosed(): Promise<void> {
    const trackedWsl = wslSessionsToCheck(
      [...this.files].map(([file, t]) => [file, t.s] as [string, SessionState]),
    );
    const byDomain = new Map<string, RegEntry[]>();
    for (const root of this.roots.claude) {
      const domain = domainOf(root);
      if (domain !== 'local' && !trackedWsl.has(domain)) continue;
      const wanted = trackedWsl.get(domain);
      const entries = (await readRegistry(root)).filter((e) => !wanted || wanted.has(e.sessionId));
      byDomain.set(domain, [...(byDomain.get(domain) ?? []), ...entries]);
    }
    const alive = new Set<string>();
    const dead = new Set<string>();
    for (const [domain, entries] of byDomain) {
      if (entries.length === 0) continue;
      const state = await this.pids(domain, entries).catch(() => new Map());
      for (const e of entries) {
        const st = state.get(e.pid) ?? 'unknown';
        if (st === 'alive') alive.add(e.sessionId);
        else if (st === 'dead') dead.add(e.sessionId);
        else alive.add(e.sessionId); // unknown: never close on a failed check
      }
    }
    // WSL sessions not checked this cycle keep their last verdict.
    const kept = [...this.closed].filter((id) => !dead.has(id) && !alive.has(id));
    this.closed = new Set([...kept, ...[...dead].filter((id) => !alive.has(id))]);
  }

  /** A Claude main session, or a child of one, that the registry says is closed. */
  private isClosed(s: SessionState): boolean {
    if (s.provider !== 'claude') return false;
    return this.closed.has(s.kind === 'main' ? s.id : (s.parentId ?? ''));
  }

  async discover(): Promise<void> {
    if (typeof this.rootsSource === 'function') {
      this.roots = await this.rootsSource();
      // stop touching roots that went away (a stopped WSL distro would boot again)
      const all = [...this.roots.claude, ...this.roots.codex];
      for (const file of this.files.keys()) {
        if (!all.some((r) => file.startsWith(r))) this.files.delete(file);
      }
    }
    await this.refreshClosed();
    await this.refreshCodexIndex();
    const candidates = await this.candidates();
    const present = new Set(candidates.map((c) => c.file));
    for (const f of this.rejected.keys()) if (!present.has(f)) this.rejected.delete(f);
    for (const c of candidates) {
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
    // Claude subagent transcripts carry no permission mode: inherit the parent's
    const bypass = new Map([...this.files.values()].map((t) => [t.s.id, t.s.bypass]));
    for (const [file, t] of this.files) {
      if (t.s.kind === 'subagent' && t.s.parentId !== undefined) {
        t.s.bypass = bypass.get(t.s.parentId) ?? t.s.bypass;
      }
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
      if (now - t.mtimeMs > ttl(t.s) || this.isClosed(t.s)) {
        this.files.delete(file);
        this.rejected.set(file, t.mtimeMs);
      }
    }
  }

  /** Codex thread names: re-read (its last CODEX_INDEX_MAX_BYTES) only when it changed. */
  private async refreshCodexIndex(): Promise<void> {
    const seen = new Set<string>();
    for (const root of this.roots.codex) {
      const file = path.join(path.dirname(root), 'session_index.jsonl');
      seen.add(file);
      try {
        const st = await stat(file);
        const key = `${st.mtimeMs.toString()}:${st.size.toString()}`;
        if (this.codexIndex.get(file)?.key === key) continue;
        const fh = await open(file, 'r');
        let text: string;
        try {
          text = (
            await readRange(fh, Math.max(0, st.size - CODEX_INDEX_MAX_BYTES), st.size)
          ).toString('utf8');
        } finally {
          await fh.close();
        }
        this.codexIndex.set(file, { key, names: parseCodexIndex(text) });
      } catch {
        this.codexIndex.delete(file); // no index (older Codex) / unreadable
      }
    }
    for (const f of this.codexIndex.keys()) if (!seen.has(f)) this.codexIndex.delete(f);
  }

  /** This PC's main session `id`: title + folder for its notifications. LOCAL ONLY —
   *  never put into views()/packets. */
  info(id: string): AgentInfo | undefined {
    for (const { s } of this.files.values()) {
      if (s.id !== id || s.kind !== 'main') continue;
      const l = s.local;
      let named = l.customTitle || l.aiTitle;
      if (s.provider === 'codex') {
        for (const idx of this.codexIndex.values()) named ||= idx.names.get(id) ?? '';
      }
      return { title: named || l.prompt, folder: folderOf(l.cwd) };
    }
    return undefined;
  }

  /** brief=true: commands as program name / description only (hideDetails) */
  views(brief = false): AgentView[] {
    const now = this.now();
    return [...this.files.values()]
      .filter((t) => t.endedAt === null || now - t.endedAt < CHILD_ENDED_HIDE_MS)
      .flatMap((t) => toViews(t.s, brief));
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
    // Turned away before (closed, or a finished Codex turn past its TTL) and unchanged
    // since: don't read its tail again every cycle.
    if (this.rejected.get(c.file) === st.mtimeMs) return;
    let parentId = c.parentId;
    let id = parentId ? `${parentId}/sub/${jsonlBase(c.file)}` : jsonlBase(c.file);
    let codexCwd = '';
    if (now - st.mtimeMs > (parentId ? CHILD_IDLE_TTL_MS : SESSION_TTL_MS)) return;
    if (c.provider === 'claude' && this.closed.has(parentId ?? id)) {
      if (domainOf(c.file) === 'local') {
        this.rejected.set(c.file, st.mtimeMs); // checked this cycle: really closed
        return;
      }
      // A WSL verdict may be stale (only shown sessions are checked there): the file
      // changed, so show it and let the next cycle check it (resumed session).
      this.closed.delete(parentId ?? id);
    }
    if (c.provider === 'codex') {
      const meta = codexSessionMeta(await firstLine(c.file));
      parentId = meta?.parentId;
      codexCwd = meta?.cwd ?? '';
      const metaId = meta?.id ?? UUID_RE.exec(c.file)?.[0] ?? jsonlBase(c.file);
      id = parentId ? `${parentId}/sub/${metaId}` : metaId;
      if (parentId && now - st.mtimeMs > CHILD_IDLE_TTL_MS) return;
    }
    const s = newSession(c.provider, id, parentId ? 'subagent' : 'main', now, parentId);
    if (c.provider === 'codex') s.local.cwd = codexCwd;
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
    if (this.isClosed(s) || now - st.mtimeMs > ttl(s)) {
      this.rejected.set(c.file, st.mtimeMs);
      return;
    }
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

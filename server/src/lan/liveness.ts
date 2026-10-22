// Is a Claude session still open? Claude writes `sessions/<pid>.json` per running
// process but never removes it, so the pid (and its start time) is checked.
import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import * as path from 'node:path';

import { CLAUDE_SESSIONS_DIR_NAME, WSL_PROC_TIMEOUT_MS } from '../constants.js';

export interface RegEntry {
  pid: number;
  sessionId: string;
  /** Linux /proc/<pid>/stat field 22 when the process started (absent: not checked). */
  procStart?: string;
}

export type PidState = 'alive' | 'dead' | 'unknown';
/** `domain` = 'local' or a WSL distro name (checked from Windows through wsl.exe). */
export type CheckPids = (domain: string, entries: RegEntry[]) => Promise<Map<number, PidState>>;

const PID_RE = /^\d{1,10}$/;
const START_RE = /^\d{1,20}$/;
const WSL_ROOT_RE = /^\\\\wsl(?:\.localhost|\$)\\([^\\]+)\\/i;

/** The WSL distro of a `\\wsl.localhost\<distro>\…` root, else 'local'. */
export function domainOf(root: string): string {
  return WSL_ROOT_RE.exec(root)?.[1] ?? 'local';
}

/** Registry entries next to a Claude `projects` root (unreadable or odd files are skipped). */
export async function readRegistry(projectsRoot: string): Promise<RegEntry[]> {
  const dir = path.join(path.dirname(projectsRoot), CLAUDE_SESSIONS_DIR_NAME);
  const names = await readdir(dir).catch(() => [] as string[]);
  const out: RegEntry[] = [];
  for (const name of names) {
    if (!/^\d{1,10}\.json$/.test(name)) continue;
    try {
      const j = JSON.parse(await readFile(path.join(dir, name), 'utf8')) as Record<string, unknown>;
      const pid = String(j.pid);
      if (!PID_RE.test(pid) || typeof j.sessionId !== 'string') continue;
      const start =
        typeof j.procStart === 'string' && START_RE.test(j.procStart) ? j.procStart : undefined;
      out.push({ pid: Number(pid), sessionId: j.sessionId, procStart: start });
    } catch {
      // half-written or foreign file
    }
  }
  return out;
}

/** Field 22 (starttime) of a /proc/<pid>/stat line; `comm` may hold spaces and parens. */
export function statStart(stat: string): string | null {
  const rest = stat
    .slice(stat.lastIndexOf(')') + 2)
    .trim()
    .split(' ');
  return rest[19] ?? null; // fields from 3 on
}

/** Output of the WSL check script: "<pid> <stat after comm>" or "<pid> -" per line. */
export function parseWslProc(out: string): Map<number, string | null> {
  const m = new Map<number, string | null>();
  for (const line of out.split(/\r?\n/)) {
    const sp = line.indexOf(' ');
    const pid = line.slice(0, sp);
    if (sp < 0 || !PID_RE.test(pid)) continue;
    const rest = line.slice(sp + 1).trim();
    m.set(Number(pid), rest === '-' ? null : (rest.split(' ')[19] ?? null));
  }
  return m;
}

const judge = (e: RegEntry, start: string | null | undefined): PidState =>
  start === null
    ? 'dead'
    : e.procStart !== undefined && start !== undefined && start !== e.procStart
      ? 'dead'
      : 'alive';

async function checkLocal(
  entries: RegEntry[],
  platform: NodeJS.Platform,
): Promise<Map<number, PidState>> {
  const out = new Map<number, PidState>();
  for (const e of entries) {
    try {
      process.kill(e.pid, 0);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EPERM') {
        out.set(e.pid, 'dead');
        continue;
      }
    }
    if (platform !== 'linux') {
      out.set(e.pid, 'alive'); // macOS / Windows: no start-time check
      continue;
    }
    const stat = await readFile(`/proc/${String(e.pid)}/stat`, 'utf8').catch(() => null);
    out.set(e.pid, judge(e, stat === null ? null : statStart(stat)));
  }
  return out;
}

// Pids arrive as arguments ("$@"), never inside the script text.
const WSL_SCRIPT =
  'for p in "$@"; do s=$(cat /proc/$p/stat 2>/dev/null) && echo "$p ${s##*) }" || echo "$p -"; done';

function checkWsl(distro: string, entries: RegEntry[]): Promise<Map<number, PidState>> {
  const pids = [...new Set(entries.map((e) => String(e.pid)))].filter((p) => PID_RE.test(p));
  return new Promise((resolve) => {
    execFile(
      'wsl.exe',
      ['-d', distro, '-e', 'sh', '-c', WSL_SCRIPT, 'sh', ...pids],
      { timeout: WSL_PROC_TIMEOUT_MS, windowsHide: true },
      (err, stdout) => {
        const out = new Map<number, PidState>();
        if (err) {
          for (const e of entries) out.set(e.pid, 'unknown');
        } else {
          const seen = parseWslProc(String(stdout));
          for (const e of entries)
            out.set(e.pid, seen.has(e.pid) ? judge(e, seen.get(e.pid)) : 'unknown');
        }
        resolve(out);
      },
    );
  });
}

export const checkPids: CheckPids = (domain, entries) =>
  domain === 'local' ? checkLocal(entries, process.platform) : checkWsl(domain, entries);

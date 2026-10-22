// Is a Claude session still open? Claude writes `sessions/<pid>.json` per running
// process but never removes it, so the pid (and its start time) is checked — only
// when the pid lives in the checker's own pid namespace (`pidDomain`).
import { execFile } from 'node:child_process';
import { readdir, readFile, readlink } from 'node:fs/promises';
import * as path from 'node:path';

import { CLAUDE_SESSIONS_DIR_NAME, WSL_PROC_TIMEOUT_MS } from '../constants.js';

export interface RegEntry {
  pid: number;
  sessionId: string;
  /** Linux /proc/<pid>/stat field 22 when the process started (absent: not checked). */
  procStart?: string;
  /** Where the pid lives, e.g. `linux:<machine-id>:pid:[4026532223]`. Claude Desktop runs in
   *  another pid namespace than the terminal, so the same number there is another process. */
  pidDomain?: string;
}

export type PidState = 'alive' | 'dead' | 'unknown';
/** `domain` = 'local' or a WSL distro name (checked from Windows through wsl.exe). */
export type CheckPids = (domain: string, entries: RegEntry[]) => Promise<Map<number, PidState>>;

/** The checker's own pid domain: Linux pid namespace (`pid:[…]`) + machine id. */
export interface SelfDomain {
  ns: string;
  machine?: string;
}

const PID_RE = /^\d{1,10}$/;
const START_RE = /^\d{1,20}$/;
const WSL_ROOT_RE = /^\\\\wsl(?:\.localhost|\$)\\([^\\]+)\\/i;
const LINUX_DOMAIN_RE = /^linux:([0-9a-f-]*):(pid:\[\d+\])$/i;
const normId = (x: string) => x.replace(/-/g, '').toLowerCase();

/** The WSL distro of a `\\wsl.localhost\<distro>\…` root, else 'local'. */
export function domainOf(root: string): string {
  return WSL_ROOT_RE.exec(root)?.[1] ?? 'local';
}

/**
 * Whether a registry pid can be judged from `self`: a `linux:<machine>:pid:[ns]`
 * domain in the same namespace (and machine, when both are known). No domain,
 * another format (Windows/macOS-native) or another namespace: no — unknown.
 */
export function sameDomain(pidDomain: string | undefined, self: SelfDomain | null): boolean {
  const m = pidDomain ? LINUX_DOMAIN_RE.exec(pidDomain) : null;
  if (!m || !self || m[2] !== self.ns) return false;
  return !m[1] || !self.machine || normId(m[1]) === normId(self.machine);
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
      out.push({
        pid: Number(pid),
        sessionId: j.sessionId,
        procStart:
          typeof j.procStart === 'string' && START_RE.test(j.procStart) ? j.procStart : undefined,
        pidDomain: typeof j.pidDomain === 'string' ? j.pidDomain : undefined,
      });
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

/**
 * Output of the WSL check script: first "self <pid ns> <machine id>", then
 * "<pid> <stat after comm>" or "<pid> -" per line.
 */
export function parseWslProc(out: string): {
  self: SelfDomain | null;
  procs: Map<number, string | null>;
} {
  const procs = new Map<number, string | null>();
  let self: SelfDomain | null = null;
  for (const line of out.split(/\r?\n/)) {
    if (line.startsWith('self ')) {
      const [, ns, machine] = line.trim().split(' ');
      if (ns?.startsWith('pid:[')) self = { ns, machine: machine || undefined };
      continue;
    }
    const sp = line.indexOf(' ');
    const pid = line.slice(0, sp);
    if (sp < 0 || !PID_RE.test(pid)) continue;
    const rest = line.slice(sp + 1).trim();
    procs.set(Number(pid), rest === '-' ? null : (rest.split(' ')[19] ?? null));
  }
  return { self, procs };
}

/** A pid that exists: dead when its start time differs from the registry's (a reused pid). */
const judge = (e: RegEntry, start: string | null | undefined): PidState =>
  start === null
    ? 'dead'
    : e.procStart !== undefined && start !== undefined && start !== e.procStart
      ? 'dead'
      : 'alive';

/** This process's pid domain (Linux only; elsewhere the registry's format is unknown). */
async function localDomain(): Promise<SelfDomain | null> {
  const ns = await readlink('/proc/self/ns/pid').catch(() => null);
  if (!ns) return null;
  const machine = (await readFile('/etc/machine-id', 'utf8').catch(() => '')).trim();
  return { ns, machine: machine || undefined };
}

export async function checkLocal(
  entries: RegEntry[],
  self: SelfDomain | null,
): Promise<Map<number, PidState>> {
  const out = new Map<number, PidState>();
  for (const e of entries) {
    if (!sameDomain(e.pidDomain, self)) {
      out.set(e.pid, 'unknown'); // another pid namespace (Claude Desktop) or format: TTL
      continue;
    }
    try {
      process.kill(e.pid, 0);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EPERM') {
        out.set(e.pid, 'dead');
        continue;
      }
    }
    const stat = await readFile(`/proc/${String(e.pid)}/stat`, 'utf8').catch(() => null);
    out.set(e.pid, judge(e, stat === null ? null : statStart(stat)));
  }
  return out;
}

// Pids arrive as arguments ("$@"), never inside the script text.
const WSL_SCRIPT =
  'echo "self $(readlink /proc/self/ns/pid) $(cat /etc/machine-id 2>/dev/null)"; ' +
  'for p in "$@"; do s=$(cat /proc/$p/stat 2>/dev/null) && echo "$p ${s##*) }" || echo "$p -"; done';

/** Judge the entries from a WSL check's output (unknown for anything it can't vouch for). */
export function judgeWsl(entries: RegEntry[], stdout: string | null): Map<number, PidState> {
  const out = new Map<number, PidState>();
  const { self, procs } = stdout === null ? { self: null, procs: new Map() } : parseWslProc(stdout);
  for (const e of entries) {
    const known = sameDomain(e.pidDomain, self) && procs.has(e.pid);
    out.set(e.pid, known ? judge(e, procs.get(e.pid) as string | null) : 'unknown');
  }
  return out;
}

function checkWsl(distro: string, entries: RegEntry[]): Promise<Map<number, PidState>> {
  const pids = [...new Set(entries.map((e) => String(e.pid)))].filter((p) => PID_RE.test(p));
  return new Promise((resolve) => {
    execFile(
      'wsl.exe',
      ['-d', distro, '-e', 'sh', '-c', WSL_SCRIPT, 'sh', ...pids],
      { timeout: WSL_PROC_TIMEOUT_MS, windowsHide: true },
      (err, stdout) => resolve(judgeWsl(entries, err ? null : String(stdout))),
    );
  });
}

export const checkPids: CheckPids = async (domain, entries) => {
  if (domain !== 'local') return checkWsl(domain, entries);
  return checkLocal(entries, process.platform === 'linux' ? await localDomain() : null);
};

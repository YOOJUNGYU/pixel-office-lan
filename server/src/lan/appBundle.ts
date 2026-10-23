// Silent app updates, the local half: ~/.pixel-office/app/<version>/ holds a
// release's dist/ (cli.js + webview + assets, from PixelOffice-<ver>-node-<node>-app.tgz).
// The installed cli.js boots the newest valid one (bootUpdated), rolls back a
// version that fails to start, and never boots a bad one again.
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';

import {
  ALLOW_PRERELEASE_ENV,
  APP_BAD_PREFIX,
  APP_BOOT_TIMEOUT_MS,
  APP_BUNDLE_MAX_UNPACKED_BYTES,
  APP_DIR_NAME,
  APP_HEALTHY_MS,
  APP_KEEP_VERSIONS,
  APP_MANIFEST_NAME,
  APP_MAX_STRIKES,
  APP_STRIKES_PREFIX,
  LAYOUT_FILE_DIR,
  MAC_AGENT_LABEL,
  UPDATE_RESPAWN_ENV,
  UPDATE_RESTART_EXIT_CODE,
} from '../constants.js';

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([\w.]+))?$/;
/** A version dir name: plain semver, no `v` (also a safe path segment). */
const VERSION_DIR = /^\d+\.\d+\.\d+(?:-[\w.]+)?$/;

/** 'v0.2.0' > '0.1.9'. A prerelease `latest` never counts unless allowPrerelease. */
export function isNewer(latest: string, current: string, allowPrerelease = false): boolean {
  const a = SEMVER.exec(latest);
  const b = SEMVER.exec(current);
  if (!a || !b) return false;
  if (a[4] !== undefined && !allowPrerelease) return false;
  for (let i = 1; i <= 3; i++) {
    const d = Number(a[i]) - Number(b[i]);
    if (d !== 0) return d > 0;
  }
  // Same core: a release beats its prereleases; rc2 beats rc1.
  if (a[4] === undefined) return b[4] !== undefined;
  if (b[4] === undefined) return false;
  return a[4].localeCompare(b[4], 'en', { numeric: true }) > 0;
}

export const appRoot = (): string => path.join(os.homedir(), LAYOUT_FILE_DIR, APP_DIR_NAME);

export const isBad = (root: string, version: string): boolean =>
  fs.existsSync(path.join(root, APP_BAD_PREFIX + version));

export function markBad(root: string, version: string): void {
  try {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, APP_BAD_PREFIX + version), new Date().toISOString());
  } catch (err) {
    console.error('[Pixel Office] bad-version marker not written:', err);
  }
}

/** `dir` holds a complete bundle of `version` built for this exact Node. */
export function isValidBundle(dir: string, version: string, nodeVersion: string): boolean {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(dir, APP_MANIFEST_NAME), 'utf-8')) as {
      version?: unknown;
      node?: unknown;
    };
    return (
      m.version === version && m.node === nodeVersion && fs.existsSync(path.join(dir, 'cli.js'))
    );
  } catch {
    return false;
  }
}

/** Version dirs in `root`, newest first. */
function versionDirs(root: string): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(root);
  } catch {
    return [];
  }
  return names.filter((n) => VERSION_DIR.test(n)).sort((a, b) => (isNewer(a, b, true) ? -1 : 1));
}

/** The version to boot: newest valid, not bad, newer than the installed one; else null. */
export function pickVersion(
  root: string,
  installed: string,
  nodeVersion: string,
  allowPrerelease = false,
): string | null {
  return (
    versionDirs(root).find(
      (v) =>
        isNewer(v, installed, allowPrerelease) &&
        !isBad(root, v) &&
        isValidBundle(path.join(root, v), v, nodeVersion),
    ) ?? null
  );
}

/** Keep the newest APP_KEEP_VERSIONS newer than `installed` (and `keep`, the running one). */
export function pruneVersions(root: string, installed: string, keep?: string): void {
  let kept = 0;
  for (const v of versionDirs(root)) {
    if (v === keep || (isNewer(v, installed, true) && kept++ < APP_KEEP_VERSIONS)) continue;
    fs.rmSync(path.join(root, v), { recursive: true, force: true });
  }
}

// ── .tgz (ustar) ──────────────────────────────────────────────

export interface TarEntry {
  /** Relative, '/'-separated, checked safe. */
  name: string;
  /** null = directory. */
  data: Buffer | null;
}

/** Relative path inside the bundle, or throw: absolute, drive, `..`, backslash, NUL. */
function safeName(raw: string): string {
  const name = raw.replace(/^(\.\/)+/, '').replace(/\/+$/, '');
  if (
    /^[/\\]|^[a-zA-Z]:|\\|\0/.test(name) ||
    name.split('/').some((s) => s === '..' || s === '.' || s === '')
  ) {
    throw new Error(`unsafe path in bundle: ${JSON.stringify(raw)}`);
  }
  return name;
}

/** Plain ustar (`tar --format=ustar`): regular files and directories only — links, pax/GNU headers rejected. */
export function readTar(buf: Buffer): TarEntry[] {
  const out: TarEntry[] = [];
  const field = (h: Buffer, at: number, len: number): string => {
    const s = h.toString('utf-8', at, at + len);
    const nul = s.indexOf('\0');
    return nul < 0 ? s : s.slice(0, nul);
  };
  let off = 0;
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break; // end-of-archive
    const size = parseInt(field(h, 124, 12).trim() || '0', 8);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('bad tar size');
    const type = field(h, 156, 1) || '0';
    const prefix = h.toString('latin1', 257, 262) === 'ustar' ? field(h, 345, 155) : '';
    const raw = prefix ? `${prefix}/${field(h, 0, 100)}` : field(h, 0, 100);
    off += 512;
    if (off + size > buf.length) throw new Error('truncated tar');
    const data = buf.subarray(off, off + size);
    off += Math.ceil(size / 512) * 512;
    if (type !== '0' && type !== '5') throw new Error(`tar entry type ${type} refused (${raw})`);
    if (raw.replace(/^(\.\/)+/, '') === '' || raw === '.') continue; // the root "./"
    out.push({ name: safeName(raw), data: type === '5' ? null : data });
  }
  return out;
}

/** Unpack a .tgz into `dest` (created; every path stays inside it). */
export function extractTgz(tgz: Buffer, dest: string): void {
  const entries = readTar(zlib.gunzipSync(tgz, { maxOutputLength: APP_BUNDLE_MAX_UNPACKED_BYTES }));
  const root = path.resolve(dest);
  fs.mkdirSync(root, { recursive: true });
  for (const e of entries) {
    const target = path.resolve(root, ...e.name.split('/'));
    if (!target.startsWith(root + path.sep)) throw new Error(`path escapes bundle: ${e.name}`);
    if (e.data === null) {
      fs.mkdirSync(target, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, e.data);
    }
  }
}

// ── Restart + boot ────────────────────────────────────────────

/**
 * How to come back after quitting into an update or out of a failed one:
 * - launchd: our LaunchAgent (KeepAlive SuccessfulExit=false) respawns a non-zero exit;
 * - respawn: start the installed cli.js detached (Windows launch.vbs / Startup shortcut, the Mac app);
 * - none: Linux/dev — the next start applies it.
 */
export function restartMode(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): 'launchd' | 'respawn' | 'none' {
  if (platform === 'darwin' && env.XPC_SERVICE_NAME === MAC_AGENT_LABEL) return 'launchd';
  if (platform === 'win32' || platform === 'darwin' || env[UPDATE_RESPAWN_ENV] === '1') {
    return 'respawn';
  }
  return 'none';
}

/** Start this program again (installed cli.js = argv[1]), detached; `--open` dropped. */
export function respawnSelf(): void {
  const args = process.argv.slice(1).filter((a) => a !== '--open');
  spawn(process.execPath, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

/** Set by bootUpdated, called by the booted bundle's main once its server listens. */
interface BootHook {
  pixelOfficeListening?: () => void;
}

/** The booted bundle reports "listening" (no-op when not booted by a bootstrap). */
export function reportListening(): void {
  (globalThis as BootHook).pixelOfficeListening?.();
}

/**
 * One strike against `version` (a failure the bundle itself caused); the
 * APP_MAX_STRIKES-th marks it bad. Returns the new count, or null when it could
 * not be recorded (then a restart could loop on the same version).
 */
export function addStrike(root: string, version: string): number | null {
  const file = path.join(root, APP_STRIKES_PREFIX + version);
  let n = 1;
  try {
    n = (Number(fs.readFileSync(file, 'utf-8')) || 0) + 1;
  } catch {
    /* none yet */
  }
  try {
    fs.writeFileSync(file, String(n));
    if (n >= APP_MAX_STRIKES) {
      fs.writeFileSync(path.join(root, APP_BAD_PREFIX + version), new Date().toISOString());
    }
    return n;
  } catch {
    return null;
  }
}

/**
 * Called first by the installed cli.js: run the newest staged version in this
 * process instead (its main), true = it took over. Strikes (APP_MAX_STRIKES in a
 * row → bad, never booted again) only for what the bundle itself causes: a throw
 * while loading (→ the installed main continues here), an uncaught exception
 * before it has run APP_HEALTHY_MS after listening, or no listen within
 * APP_BOOT_TIMEOUT_MS — those restart (respawn / launchd). A clean or explicit
 * exit (already running, port busy, EACCES bind…) is the environment: no strike.
 * A version that runs APP_HEALTHY_MS has its strikes cleared. When the strike
 * file can't be written, no update is booted at all (a failure could loop).
 */
export function bootUpdated(
  installed: string,
  root = appRoot(),
  allowPrerelease = process.env[ALLOW_PRERELEASE_ENV] === '1',
): boolean {
  const v = pickVersion(root, installed, process.version, allowPrerelease);
  if (!v) {
    try {
      pruneVersions(root, installed);
    } catch {
      /* best effort */
    }
    return false;
  }
  const strikesFile = path.join(root, APP_STRIKES_PREFIX + v);
  try {
    fs.appendFileSync(strikesFile, ''); // writable? (creates an empty = 0 strikes)
  } catch (err) {
    console.error(`[Pixel Office] ${root} 에 쓸 수 없어 설치된 버전으로 시작합니다:`, err);
    return false;
  }
  console.log(`[Pixel Office] 업데이트된 버전 v${v} 로 시작합니다 (설치본 v${installed})`);
  const g = globalThis as BootHook;
  let healthy = false;
  /** A strike recorded in this process: restart on exit (respawn; launchd does it itself). */
  let struck = false;
  const strike = (why: string): boolean => {
    const n = addStrike(root, v);
    console.error(
      `[Pixel Office] v${v} 실패 (${why}) — ${n === null ? '기록 못 함' : `${n.toString()}/${APP_MAX_STRIKES.toString()}`}`,
    );
    struck = n !== null;
    return struck;
  };
  const timer = setTimeout(() => {
    // Not recorded → exit 0: launchd must not respawn into the same hang forever.
    process.exit(strike('시간 안에 시작하지 않음') ? UPDATE_RESTART_EXIT_CODE : 0);
  }, APP_BOOT_TIMEOUT_MS);
  const onCrash = (err: unknown): void => {
    if (!healthy) strike(`오류: ${err instanceof Error ? err.message : String(err)}`);
  };
  const onExit = (code: number): void => {
    if (struck && code !== 0 && restartMode() === 'respawn') respawnSelf();
  };
  g.pixelOfficeListening = () => {
    clearTimeout(timer);
    setTimeout(() => {
      healthy = true;
      fs.rmSync(strikesFile, { force: true });
    }, APP_HEALTHY_MS).unref();
  };
  process.on('uncaughtExceptionMonitor', onCrash);
  process.on('exit', onExit);
  try {
    const mod = require(path.join(root, v, 'cli.js')) as { main?: unknown };
    if (typeof mod.main !== 'function') throw new Error('no main export');
    // false = no bootstrap of its own (it is the booted version)
    void (mod.main as (boot: boolean) => Promise<void>)(false).catch((err: unknown) => {
      console.error(err);
      onCrash(err);
      process.exit(1);
    });
    return true;
  } catch (err) {
    clearTimeout(timer);
    process.off('uncaughtExceptionMonitor', onCrash);
    process.off('exit', onExit);
    delete g.pixelOfficeListening;
    addStrike(root, v);
    console.error(`[Pixel Office] v${v} 를 불러오지 못해 설치된 버전으로 시작합니다:`, err);
    return false;
  }
}

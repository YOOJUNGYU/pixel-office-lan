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
  APP_BAD_PREFIX,
  APP_BOOT_TIMEOUT_MS,
  APP_BUNDLE_MAX_UNPACKED_BYTES,
  APP_DIR_NAME,
  APP_KEEP_VERSIONS,
  APP_MANIFEST_NAME,
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
export function pickVersion(root: string, installed: string, nodeVersion: string): string | null {
  return (
    versionDirs(root).find(
      (v) =>
        isNewer(v, installed, true) &&
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
 * Called first by the installed cli.js: run the newest staged version in this
 * process instead (its main), true = it took over. A throw while loading it
 * falls back here at once; a non-zero exit or no "listening" within
 * APP_BOOT_TIMEOUT_MS marks it bad and restarts into the installed version.
 */
export function bootUpdated(installed: string, root = appRoot()): boolean {
  const v = pickVersion(root, installed, process.version);
  if (!v) {
    try {
      pruneVersions(root, installed);
    } catch {
      /* best effort */
    }
    return false;
  }
  console.log(`[Pixel Office] 업데이트된 버전 v${v} 로 시작합니다 (설치본 v${installed})`);
  const g = globalThis as BootHook;
  let up = false;
  const timer = setTimeout(() => {
    console.error(`[Pixel Office] v${v} 가 시간 안에 시작하지 않았습니다`);
    process.exit(UPDATE_RESTART_EXIT_CODE);
  }, APP_BOOT_TIMEOUT_MS);
  const onExit = (code: number): void => {
    if (up || code === 0) return; // 0 = already running / port busy: not the bundle's fault
    markBad(root, v);
    console.error(
      `[Pixel Office] v${v} 시작 실패 (exit ${code.toString()}): 이전 버전으로 돌아갑니다`,
    );
    if (restartMode() === 'respawn') respawnSelf(); // launchd respawns a non-zero exit itself
  };
  g.pixelOfficeListening = () => {
    up = true;
    clearTimeout(timer);
  };
  process.on('exit', onExit);
  try {
    const mod = require(path.join(root, v, 'cli.js')) as { main?: unknown };
    if (typeof mod.main !== 'function') throw new Error('no main export');
    // false = no bootstrap of its own (it is the booted version)
    void (mod.main as (boot: boolean) => Promise<void>)(false).catch((err: unknown) => {
      console.error(err);
      process.exit(1);
    });
    return true;
  } catch (err) {
    clearTimeout(timer);
    process.off('exit', onExit);
    delete g.pixelOfficeListening;
    markBad(root, v);
    console.error(`[Pixel Office] v${v} 를 불러오지 못해 설치된 버전으로 시작합니다:`, err);
    return false;
  }
}

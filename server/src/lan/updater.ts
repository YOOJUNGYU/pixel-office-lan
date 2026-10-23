// Update check via GitHub Releases, and download + launch of the installer.
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  ALLOW_PRERELEASE_ENV,
  INSTALL_RELAUNCH_GUARD_MS,
  LAYOUT_FILE_DIR,
  REOPEN_MARKER_NAME,
  REOPEN_MARKER_TTL_MS,
  UPDATE_API_TIMEOUT_MS,
  UPDATE_DOWNLOAD_TIMEOUT_MS,
  UPDATE_FIRST_CHECK_MS,
  UPDATES_DIR_NAME,
} from '../constants.js';

declare const __APP_VERSION__: string | undefined;
/** Inlined by esbuild from package.json. Unbuilt (tests) it is 0.0.0; callers pass their own. */
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';

export const RELEASES_API =
  'https://api.github.com/repos/YOOJUNGYU/pixel-office-lan/releases/latest';
/** With PIXEL_OFFICE_ALLOW_PRERELEASE=1 (`releases/latest` skips prereleases). */
export const RELEASES_LIST_API =
  'https://api.github.com/repos/YOOJUNGYU/pixel-office-lan/releases?per_page=5';
const GITHUB_ORIGIN = 'https://github.com';
/** The only place an installer is ever downloaded from (github.com + this path). */
const DOWNLOAD_PATH = '/YOOJUNGYU/pixel-office-lan/releases/download/';
const NOTES_PATH = '/YOOJUNGYU/pixel-office-lan/releases/';
const RELEASES_PAGE = 'https://github.com/YOOJUNGYU/pixel-office-lan/releases';

/**
 * Installer names from scripts/package (Release assets): `-Windows.exe` / `-Mac.pkg`.
 */
const ASSET_NAME = /^PixelOffice-[\w.-]+-(Windows\.exe|Mac\.pkg)$/;

export interface UpdateInfo {
  version: string;
  assetUrl: string;
  assetName: string;
  /** Bytes, from the Releases API; the download must match. */
  assetSize: number;
  notesUrl: string;
}

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size?: number;
}

interface Release {
  tag_name?: unknown;
  html_url?: unknown;
  draft?: unknown;
  assets?: unknown;
}

/**
 * Normalized href when `raw` is on github.com under `pathPrefix`, else null.
 * Parsed, not startsWith: `PREFIX/../../evil/...` normalizes out of the repo.
 */
export function repoUrl(raw: string, pathPrefix: string): string | null {
  if (/\.\.|%2e/i.test(raw)) return null; // dot segments, raw or encoded
  try {
    const u = new URL(raw);
    return u.origin === GITHUB_ORIGIN && u.pathname.startsWith(pathPrefix) ? u.href : null;
  } catch {
    return null;
  }
}

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([\w.]+))?$/;

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

export function pickAsset(
  assets: ReleaseAsset[],
  platform: NodeJS.Platform,
): { name: string; url: string; size: number } | null {
  const suffix = platform === 'win32' ? '-Windows.exe' : platform === 'darwin' ? '-Mac.pkg' : null;
  if (!suffix) return null;
  const a = assets.find((x) => ASSET_NAME.test(x.name) && x.name.endsWith(suffix));
  return a ? { name: a.name, url: a.browser_download_url, size: a.size ?? 0 } : null;
}

let warnedCheck = false;

/** Newest release for this platform when newer than `current`; null otherwise or on any failure. */
export async function checkForUpdate(
  current: string,
  fetchFn: typeof fetch = fetch,
  platform: NodeJS.Platform = process.platform,
): Promise<UpdateInfo | null> {
  const allowPre = process.env[ALLOW_PRERELEASE_ENV] === '1';
  try {
    const res = await fetchFn(allowPre ? RELEASES_LIST_API : RELEASES_API, {
      headers: {
        'User-Agent': `pixel-office/${current}`,
        Accept: 'application/vnd.github+json',
      },
      signal: AbortSignal.timeout(UPDATE_API_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status.toString()}`); // 403 = rate limit
    const body = (await res.json()) as unknown;
    const release: Release | undefined = allowPre
      ? (Array.isArray(body) ? (body as Release[]) : []).find((r) => r.draft !== true)
      : (body as Release);
    if (!release || typeof release.tag_name !== 'string' || !Array.isArray(release.assets)) {
      return null;
    }
    if (!isNewer(release.tag_name, current, allowPre)) return null;
    const asset = pickAsset(release.assets as ReleaseAsset[], platform);
    if (!asset) return null;
    const notes = release.html_url;
    return {
      version: release.tag_name.replace(/^v/, ''),
      assetUrl: asset.url,
      assetName: asset.name,
      assetSize: asset.size,
      notesUrl: (typeof notes === 'string' && repoUrl(notes, NOTES_PATH)) || RELEASES_PAGE,
    };
  } catch (err) {
    if (!warnedCheck) {
      warnedCheck = true;
      console.warn(
        `[Pixel Office] 업데이트를 확인하지 못했습니다: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return null;
  }
}

/** Run the installer detached (it outlives us). Windows: `start` so UAC can elevate it. */
function launchInstaller(file: string): Promise<void> {
  const [cmd, args] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '', file, '/SILENT']] : ['open', [file]];
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: false });
    // spawn failures (ENOENT…) arrive async: report them, not "installing"
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

export interface DownloadOptions {
  fetchFn?: typeof fetch;
  /** Whole percent, on change. */
  onProgress?: (percent: number) => void;
  launch?: (file: string) => void | Promise<void>;
}

/**
 * Download the installer into `dir` (tmp + rename) and launch it. Windows: the
 * installer quits this server via /api/quit and relaunches it; Mac: the user
 * finishes the pkg and its postinstall reloads the LaunchAgent.
 */
export async function downloadAndRun(
  info: UpdateInfo,
  dir: string = path.join(os.homedir(), LAYOUT_FILE_DIR, UPDATES_DIR_NAME),
  opts: DownloadOptions = {},
): Promise<void> {
  const url = repoUrl(info.assetUrl, DOWNLOAD_PATH);
  if (!url) throw new Error(`refusing download from ${info.assetUrl}`);
  if (!ASSET_NAME.test(info.assetName)) throw new Error(`bad asset name ${info.assetName}`);
  const { fetchFn = fetch, onProgress, launch = launchInstaller } = opts;

  // Already downloaded (exact size only: a .part or short file never matches): just launch it.
  const cached = path.join(dir, info.assetName);
  try {
    if (info.assetSize > 0 && fs.statSync(cached).size === info.assetSize) {
      await launch(cached);
      return;
    }
  } catch {
    /* not cached */
  }

  // Validated above: redirects (to objects.githubusercontent.com) are followed.
  const res = await fetchFn(url, {
    signal: AbortSignal.timeout(UPDATE_DOWNLOAD_TIMEOUT_MS),
  });
  if (res.status !== 200 || !res.body) throw new Error(`download ${res.status.toString()}`);

  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, info.assetName);
  const tmp = `${file}.part`;
  let bytes = 0;
  let lastPercent = -1;
  try {
    const out = await fs.promises.open(tmp, 'w');
    try {
      for await (const chunk of res.body) {
        await out.write(chunk);
        bytes += chunk.length;
        if (info.assetSize > 0) {
          const percent = Math.min(100, Math.floor((bytes * 100) / info.assetSize));
          if (percent !== lastPercent) onProgress?.((lastPercent = percent));
        }
      }
    } finally {
      await out.close();
    }
    if (bytes === 0 || (info.assetSize > 0 && bytes !== info.assetSize)) {
      throw new Error(`download size ${bytes.toString()} != ${info.assetSize.toString()}`);
    }
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  await launch(file);
}

const updatesDir = (): string => path.join(os.homedir(), LAYOUT_FILE_DIR, UPDATES_DIR_NAME);

/**
 * Written when the launched installer quits this server (POST /api/quit after
 * an in-app [Update]): whether a UI window is open at that moment. The new
 * version's first start reads it (consumeReopenMarker): an open window
 * reloads itself into the new version (officeAccess.version), so the start
 * must not open a second one; with none open (closed since the click) it opens
 * the office once. A failed download or a cancelled UAC prompt never quits
 * us, so no marker is left behind.
 */
export function writeReopenMarker(windowOpen: boolean, dir = updatesDir(), now = Date.now()): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, REOPEN_MARKER_NAME), JSON.stringify({ at: now, windowOpen }));
  } catch (err) {
    console.warn('[Pixel Office] reopen marker not written:', err);
  }
}

/**
 * At start: 'open' = open the office once (no window was open at the update),
 * 'stay' = open nothing (the open window reloads itself), null = no fresh
 * marker (a normal start: `--open` decides). The marker is deleted either way.
 */
export function consumeReopenMarker(dir = updatesDir(), now = Date.now()): 'open' | 'stay' | null {
  const file = path.join(dir, REOPEN_MARKER_NAME);
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf-8');
  } catch {
    return null;
  }
  fs.rmSync(file, { force: true });
  try {
    const m = JSON.parse(raw) as { at?: unknown; windowOpen?: unknown };
    if (typeof m.at !== 'number' || now - m.at > REOPEN_MARKER_TTL_MS || now < m.at) return null;
    return m.windowOpen === true ? 'stay' : 'open';
  } catch {
    return null;
  }
}

/** Startup check + the one install in flight; messages go to privileged sockets. */
export class Updater {
  info: UpdateInfo | null = null;
  /** Last updateStatus of an install, re-sent on handshake. */
  status: Record<string, unknown> | null = null;
  /** Set by the HTTP server: send to every privileged socket. */
  broadcast: (msg: Record<string, unknown>) => void = () => {};
  /** Set by the HTTP server: whether a UI page is connected right now. */
  uiConnected: () => boolean = () => false;
  private busy = false;
  /** An installer we launched may quit us (POST /api/quit) to install itself. */
  private installerLaunched = false;
  private launchedAt = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly current: string,
    private readonly deps: {
      check: (current: string) => Promise<UpdateInfo | null>;
      install: typeof downloadAndRun;
      markReopen?: (windowOpen: boolean) => void;
    } = { check: (c) => checkForUpdate(c), install: downloadAndRun, markReopen: writeReopenMarker },
  ) {}

  /** One check right after the server listens; later checks only via Settings (manual). */
  start(): void {
    this.timer = setTimeout(() => void this.check(), UPDATE_FIRST_CHECK_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  availableMessage(): Record<string, unknown> | null {
    return this.info
      ? { type: 'updateAvailable', version: this.info.version, notesUrl: this.info.notesUrl }
      : null;
  }

  // ponytail: a failed manual check also reads "up to date"; add an error state if users get confused.
  async check(manual = false): Promise<void> {
    const info = await this.deps.check(this.current);
    if (info) {
      this.info = info;
      this.broadcast(this.availableMessage()!);
    } else if (manual) {
      this.broadcast({ type: 'updateStatus', state: 'upToDate' });
    }
  }

  async install(): Promise<void> {
    if (!this.info || this.busy) return;
    if (Date.now() - this.launchedAt < INSTALL_RELAUNCH_GUARD_MS) {
      this.broadcast({ type: 'updateStatus', state: 'installing' });
      return;
    }
    this.busy = true;
    this.setStatus({ type: 'updateStatus', state: 'downloading', percent: 0 });
    try {
      await this.deps.install(this.info, undefined, {
        onProgress: (percent) =>
          this.setStatus({ type: 'updateStatus', state: 'downloading', percent }),
      });
      // Not kept for later handshakes: a cancelled UAC prompt must not leave a reloaded
      // page stuck on "installing" (the update banner offers the install again instead).
      this.status = null;
      this.installerLaunched = true;
      this.launchedAt = Date.now();
      this.broadcast({ type: 'updateStatus', state: 'installing' });
    } catch (err) {
      console.error('[Pixel Office] 업데이트 실패:', err);
      this.setStatus({ type: 'updateStatus', state: 'error' });
    } finally {
      this.busy = false;
    }
  }

  /** POST /api/quit: an installer we launched is replacing us — leave the reopen marker. */
  onQuit(): void {
    if (this.installerLaunched) this.deps.markReopen?.(this.uiConnected());
  }

  private setStatus(msg: Record<string, unknown>): void {
    this.status = msg;
    this.broadcast(msg);
  }
}

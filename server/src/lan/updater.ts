// Update check via GitHub Releases, and download + launch of the installer.
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  ALLOW_PRERELEASE_ENV,
  LAYOUT_FILE_DIR,
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
/** The only place an installer is ever downloaded from. */
export const DOWNLOAD_PREFIX = 'https://github.com/YOOJUNGYU/pixel-office-lan/releases/download/';
const NOTES_PREFIX = 'https://github.com/YOOJUNGYU/pixel-office-lan/releases/';
const RELEASES_PAGE = 'https://github.com/YOOJUNGYU/pixel-office-lan/releases';
export const UPDATE_CHECK_MS = 6 * 60 * 60_000;

/** Installer names from scripts/package (Release assets). */
const ASSET_NAME = /^PixelOffice-(Setup-[\w.-]+\.exe|[\w.-]+-(arm64|x64)\.pkg)$/;

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
  arch: string,
): { name: string; url: string; size: number } | null {
  const suffix =
    platform === 'win32'
      ? '.exe'
      : platform === 'darwin' && (arch === 'arm64' || arch === 'x64')
        ? `-${arch}.pkg`
        : null;
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
  arch: string = process.arch,
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
    const asset = pickAsset(release.assets as ReleaseAsset[], platform, arch);
    if (!asset) return null;
    const notes = release.html_url;
    return {
      version: release.tag_name.replace(/^v/, ''),
      assetUrl: asset.url,
      assetName: asset.name,
      assetSize: asset.size,
      notesUrl: typeof notes === 'string' && notes.startsWith(NOTES_PREFIX) ? notes : RELEASES_PAGE,
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
function launchInstaller(file: string): void {
  const [cmd, args] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '', file, '/SILENT']] : ['open', [file]];
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: false });
  child.on('error', (err) => console.error('[Pixel Office] 설치 프로그램 실행 실패:', err));
  child.unref();
}

export interface DownloadOptions {
  fetchFn?: typeof fetch;
  /** Whole percent, on change. */
  onProgress?: (percent: number) => void;
  launch?: (file: string) => void;
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
  if (!info.assetUrl.startsWith(DOWNLOAD_PREFIX)) {
    throw new Error(`refusing download from ${info.assetUrl}`);
  }
  if (!ASSET_NAME.test(info.assetName)) throw new Error(`bad asset name ${info.assetName}`);
  const { fetchFn = fetch, onProgress, launch = launchInstaller } = opts;

  // Validated above: redirects (to objects.githubusercontent.com) are followed.
  const res = await fetchFn(info.assetUrl, {
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
  launch(file);
}

/** Periodic check + the one install in flight; messages go to privileged sockets. */
export class Updater {
  info: UpdateInfo | null = null;
  /** Last updateStatus of an install, re-sent on handshake. */
  status: Record<string, unknown> | null = null;
  /** Set by the HTTP server: send to every privileged socket. */
  broadcast: (msg: Record<string, unknown>) => void = () => {};
  private busy = false;
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly current: string,
    private readonly deps: {
      check: (current: string) => Promise<UpdateInfo | null>;
      install: typeof downloadAndRun;
    } = { check: (c) => checkForUpdate(c), install: downloadAndRun },
  ) {}

  start(): void {
    const first = setTimeout(() => void this.check(), UPDATE_FIRST_CHECK_MS);
    const every = setInterval(() => void this.check(), UPDATE_CHECK_MS);
    first.unref();
    every.unref();
    this.timers = [first, every];
  }

  stop(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
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
    this.busy = true;
    this.setStatus({ type: 'updateStatus', state: 'downloading', percent: 0 });
    try {
      await this.deps.install(this.info, undefined, {
        onProgress: (percent) =>
          this.setStatus({ type: 'updateStatus', state: 'downloading', percent }),
      });
      this.setStatus({ type: 'updateStatus', state: 'installing' });
    } catch (err) {
      console.error('[Pixel Office] 업데이트 실패:', err);
      this.setStatus({ type: 'updateStatus', state: 'error' });
    } finally {
      this.busy = false;
    }
  }

  private setStatus(msg: Record<string, unknown>): void {
    this.status = msg;
    this.broadcast(msg);
  }
}

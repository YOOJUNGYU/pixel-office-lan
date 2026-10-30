// Update check via GitHub Releases, and download + launch of the installer.
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  ALLOW_PRERELEASE_ENV,
  APP_BUNDLE_MAX_BYTES,
  APP_RENAME_RETRY_MS,
  APP_RENAME_TRIES,
  INSTALL_RELAUNCH_GUARD_MS,
  LAYOUT_FILE_DIR,
  REOPEN_MARKER_NAME,
  REOPEN_MARKER_TTL_MS,
  UPDATE_API_ENV,
  UPDATE_API_TIMEOUT_MS,
  UPDATE_DOWNLOAD_TIMEOUT_MS,
  UPDATE_FIRST_CHECK_MS,
  UPDATE_RECHECK_MS,
  UPDATE_STAGE_BACKOFF_MS,
  UPDATES_DIR_NAME,
} from '../constants.js';
import { appRoot, extractTgz, isBad, isNewer, isValidBundle, pruneVersions } from './appBundle.js';

declare const __APP_VERSION__: string | undefined;
/** Inlined by esbuild from package.json. Unbuilt (tests) it is 0.0.0; callers pass their own. */
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';

export const RELEASES_API =
  'https://api.github.com/repos/YOOJUNGYU/pixel-office-lan/releases/latest';
/** With PIXEL_OFFICE_ALLOW_PRERELEASE=1 (`releases/latest` skips prereleases). */
export const RELEASES_LIST_API =
  'https://api.github.com/repos/YOOJUNGYU/pixel-office-lan/releases?per_page=5';
const GITHUB_ORIGIN = 'https://github.com';

/**
 * Tests only: a releases API on this machine (PIXEL_OFFICE_UPDATE_API); downloads
 * are then allowed from that origin instead of github.com. Anything else is ignored.
 */
function testApi(): string | null {
  const raw = process.env[UPDATE_API_ENV];
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost')
      ? raw
      : null;
  } catch {
    return null;
  }
}
const downloadOrigin = (): string => {
  const api = testApi();
  return api ? new URL(api).origin : GITHUB_ORIGIN;
};
/** The only place an installer is ever downloaded from (github.com + this path). */
const DOWNLOAD_PATH = '/YOOJUNGYU/pixel-office-lan/releases/download/';
const NOTES_PATH = '/YOOJUNGYU/pixel-office-lan/releases/';
const RELEASES_PAGE = 'https://github.com/YOOJUNGYU/pixel-office-lan/releases';

/**
 * Installer names from scripts/package (Release assets): `-Windows.exe` / `-Mac.pkg`.
 */
const ASSET_NAME = /^PixelOffice-[\w.-]+-(Windows\.exe|Mac\.pkg)$/;
/**
 * Silent-update bundle (package.yml): the release's dist/ for every platform, built for
 * exactly this Node (`node-version.txt`): `PixelOffice-<ver>-node-<v22.x.y>-app.tgz`.
 * The Node version is in the name so an incompatible one is never downloaded.
 */
export const APP_ASSET_NAME = /^PixelOffice-[\w.-]+-node-(v\d+\.\d+\.\d+)-app\.tgz$/;

export interface AppAsset {
  name: string;
  url: string;
  size: number;
  /** From the Releases API `digest` ("sha256:<hex>"), when GitHub provides it. */
  digest?: string;
  /** Fallback: the `<name>.sha256` release asset. */
  shaUrl?: string;
}

export interface UpdateInfo {
  version: string;
  /** Installer (''/0 when the release has none for this platform: then only `app`). */
  assetUrl: string;
  assetName: string;
  /** Bytes, from the Releases API; the download must match. */
  assetSize: number;
  notesUrl: string;
  /** App bundle for this Node: the silent update path. */
  app?: AppAsset;
}

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size?: number;
  digest?: unknown;
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
export function repoUrl(raw: string, pathPrefix: string, origin = GITHUB_ORIGIN): string | null {
  if (/\.\.|%2e/i.test(raw)) return null; // dot segments, raw or encoded
  try {
    const u = new URL(raw);
    return u.origin === origin && u.pathname.startsWith(pathPrefix) ? u.href : null;
  } catch {
    return null;
  }
}

export { isNewer };

export function pickAsset(
  assets: ReleaseAsset[],
  platform: NodeJS.Platform,
): { name: string; url: string; size: number } | null {
  const suffix = platform === 'win32' ? '-Windows.exe' : platform === 'darwin' ? '-Mac.pkg' : null;
  if (!suffix) return null;
  const a = assets.find((x) => ASSET_NAME.test(x.name) && x.name.endsWith(suffix));
  return a ? { name: a.name, url: a.browser_download_url, size: a.size ?? 0 } : null;
}

/** The app bundle built for `nodeVersion` (exact), with its checksum source. */
export function pickAppAsset(assets: ReleaseAsset[], nodeVersion: string): AppAsset | null {
  const a = assets.find((x) => APP_ASSET_NAME.exec(x.name)?.[1] === nodeVersion);
  if (!a) return null;
  const sha = assets.find((x) => x.name === `${a.name}.sha256`);
  return {
    name: a.name,
    url: a.browser_download_url,
    size: a.size ?? 0,
    ...(typeof a.digest === 'string' && { digest: a.digest }),
    ...(sha && { shaUrl: sha.browser_download_url }),
  };
}

let warnedCheck = false;

/** Newest release for this platform when newer than `current`; null otherwise or on any failure. */
export async function checkForUpdate(
  current: string,
  fetchFn: typeof fetch = fetch,
  platform: NodeJS.Platform = process.platform,
  nodeVersion: string = process.version,
): Promise<UpdateInfo | null> {
  const allowPre = process.env[ALLOW_PRERELEASE_ENV] === '1';
  try {
    const res = await fetchFn(testApi() ?? (allowPre ? RELEASES_LIST_API : RELEASES_API), {
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
    const app = pickAppAsset(release.assets as ReleaseAsset[], nodeVersion);
    if (!asset && !app) return null;
    const notes = release.html_url;
    return {
      version: release.tag_name.replace(/^v/, ''),
      assetUrl: asset?.url ?? '',
      assetName: asset?.name ?? '',
      assetSize: asset?.size ?? 0,
      notesUrl: (typeof notes === 'string' && repoUrl(notes, NOTES_PATH)) || RELEASES_PAGE,
      ...(app && { app }),
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

/** A body ≤ maxBytes (it must be exactly `size` when given) from a validated release URL. */
async function fetchAsset(
  raw: string,
  fetchFn: typeof fetch,
  maxBytes: number,
  size = 0,
): Promise<Buffer> {
  const url = repoUrl(raw, DOWNLOAD_PATH, downloadOrigin());
  if (!url) throw new Error(`refusing download from ${raw}`);
  const res = await fetchFn(url, { signal: AbortSignal.timeout(UPDATE_DOWNLOAD_TIMEOUT_MS) });
  if (res.status !== 200) throw new Error(`download ${res.status.toString()}`);
  if (Number(res.headers.get('content-length') ?? 0) > maxBytes) throw new Error('too large');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes || (size > 0 && buf.length !== size)) {
    throw new Error(`download size ${buf.length.toString()} != ${size.toString()}`);
  }
  return buf;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;
const SHA256_FILE_BYTES = 1024;

/** The expected SHA-256 (hex): the API digest, else the `.sha256` asset; none → throw. */
async function expectedSha256(app: AppAsset, fetchFn: typeof fetch): Promise<string> {
  const fromApi = app.digest?.startsWith('sha256:') ? app.digest.slice(7).toLowerCase() : '';
  if (SHA256_HEX.test(fromApi)) return fromApi;
  if (!app.shaUrl) throw new Error('no checksum for the app bundle');
  const text = (await fetchAsset(app.shaUrl, fetchFn, SHA256_FILE_BYTES)).toString('utf-8');
  const hex = text.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  if (!SHA256_HEX.test(hex)) throw new Error('bad .sha256 file');
  return hex;
}

/** Windows: an AV scan may briefly hold a handle on the fresh files — retry a few times. */
export async function renameWithRetry(
  from: string,
  to: string,
  rename: (a: string, b: string) => void = fs.renameSync,
  delayMs = APP_RENAME_RETRY_MS,
): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      rename(from, to);
      return;
    } catch (err) {
      if (i >= APP_RENAME_TRIES) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

/**
 * Silent update: download the app bundle, check its size and SHA-256, unpack it
 * into `<root>/.<ver>.partial` (paths checked), require its manifest = this version
 * + this Node, then rename to `<root>/<ver>` (the next boot picks it). Never a bad version.
 */
export async function stageAppUpdate(
  version: string,
  app: AppAsset,
  opts: { fetchFn?: typeof fetch; root?: string; installed?: string } = {},
): Promise<void> {
  const { fetchFn = fetch, root = appRoot(), installed = APP_VERSION } = opts;
  if (!/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(version)) throw new Error(`bad version ${version}`);
  if (isBad(root, version)) throw new Error(`v${version} failed to start before; skipped`);
  if (!APP_ASSET_NAME.test(app.name)) throw new Error(`bad asset name ${app.name}`);
  if (!(app.size > 0 && app.size <= APP_BUNDLE_MAX_BYTES)) throw new Error('bad bundle size');
  const want = await expectedSha256(app, fetchFn);
  const buf = await fetchAsset(app.url, fetchFn, APP_BUNDLE_MAX_BYTES, app.size);
  const got = createHash('sha256').update(buf).digest('hex');
  if (got !== want) throw new Error(`checksum mismatch (${got} != ${want})`);

  const dest = path.join(root, version);
  const tmp = path.join(root, `.${version}.partial`);
  fs.rmSync(tmp, { recursive: true, force: true });
  try {
    extractTgz(buf, tmp);
    if (!isValidBundle(tmp, version, process.version)) {
      throw new Error('bundle manifest does not match this version / Node');
    }
    fs.rmSync(dest, { recursive: true, force: true });
    await renameWithRetry(tmp, dest);
  } catch (err) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
  pruneVersions(root, installed, path.basename(__dirname));
}

const updatesDir = (): string => path.join(os.homedir(), LAYOUT_FILE_DIR, UPDATES_DIR_NAME);

/**
 * Written when the launched installer quits this server (POST /api/quit after
 * an in-app [Update]). The new version's first start reads it
 * (consumeReopenMarker) and opens no window, `--open` or not: an open window
 * reconnects and reloads itself into the new version (officeAccess.version),
 * and a closed one was closed on purpose. A failed download or a cancelled UAC
 * prompt never quits us, so no marker is left behind.
 */
export function writeReopenMarker(dir = updatesDir(), now = Date.now()): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, REOPEN_MARKER_NAME), JSON.stringify({ at: now }));
  } catch (err) {
    console.warn('[Pixel Office] reopen marker not written:', err);
  }
}

/**
 * At start: true = this start follows an in-app update (open no window); false =
 * no fresh marker (a normal start: `--open` decides). The marker is deleted either way.
 */
export function consumeReopenMarker(dir = updatesDir(), now = Date.now()): boolean {
  const file = path.join(dir, REOPEN_MARKER_NAME);
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf-8');
  } catch {
    return false;
  }
  fs.rmSync(file, { force: true });
  try {
    const m = JSON.parse(raw) as { at?: unknown };
    return typeof m.at === 'number' && now - m.at <= REOPEN_MARKER_TTL_MS && now >= m.at;
  } catch {
    return false;
  }
}

/** Startup check + the one install in flight; messages go to privileged sockets. */
export class Updater {
  info: UpdateInfo | null = null;
  /** Last updateStatus of an install, re-sent on handshake. */
  status: Record<string, unknown> | null = null;
  /** Set by the HTTP server: send to every privileged socket. */
  broadcast: (msg: Record<string, unknown>) => void = () => {};
  private busy = false;
  /** An installer we launched may quit us (POST /api/quit) to install itself. */
  private installerLaunched = false;
  private launchedAt = 0;
  private timer: NodeJS.Timeout | null = null;
  private recheck: NodeJS.Timeout | null = null;
  private staging = false;
  /** Version whose stage failed → not retried (silently) until `until`. */
  private failed: { version: string; until: number } | null = null;
  /** Staged but not restarted into (Linux/dev): not downloaded again. */
  private staged: string | null = null;

  constructor(
    private readonly current: string,
    private readonly deps: {
      check: (current: string) => Promise<UpdateInfo | null>;
      install: typeof downloadAndRun;
      markReopen?: () => void;
      /** Silent path: download + verify + unpack the app bundle. */
      stage?: (version: string, app: AppAsset) => Promise<void>;
      /** Restart into the staged version; false = can't here (applied at next start). */
      restart?: () => boolean;
    } = {
      check: (c) => checkForUpdate(c),
      install: downloadAndRun,
      markReopen: writeReopenMarker,
      stage: (v, app) => stageAppUpdate(v, app),
    },
  ) {}

  /** A check right after the server listens, then every UPDATE_RECHECK_MS (+ Settings → manual). */
  start(): void {
    this.timer = setTimeout(() => void this.check(), UPDATE_FIRST_CHECK_MS);
    this.timer.unref();
    this.recheck = setInterval(() => void this.check(), UPDATE_RECHECK_MS);
    this.recheck.unref();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.recheck) clearInterval(this.recheck);
    this.timer = null;
    this.recheck = null;
  }

  availableMessage(): Record<string, unknown> | null {
    return this.info
      ? { type: 'updateAvailable', version: this.info.version, notesUrl: this.info.notesUrl }
      : null;
  }

  // ponytail: a failed manual check also reads "up to date"; add an error state if users get confused.
  async check(manual = false): Promise<void> {
    const info = await this.deps.check(this.current);
    if (info && (await this.trySilent(info))) return;
    if (info?.assetName) {
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
    if (this.installerLaunched) this.deps.markReopen?.();
  }

  /**
   * The silent path, when on and possible: stage the app bundle and restart into
   * it (open pages reconnect and reload: officeAccess.version). True = handled.
   * Any failure falls back to the banner + installer.
   */
  private async trySilent(info: UpdateInfo): Promise<boolean> {
    const { stage, restart } = this.deps;
    if (!info.app || !stage) return false;
    // Busy or done: handled (a manual check meanwhile must not raise the banner too).
    if (this.staging || this.staged === info.version) return true;
    if (this.failed?.version === info.version && Date.now() < this.failed.until) return false;
    this.staging = true;
    try {
      await stage(info.version, info.app);
      console.log(`[Pixel Office] v${info.version} 업데이트를 받았습니다`);
      this.staged = info.version;
      if (!restart?.()) console.log('[Pixel Office] 다음 시작 때 적용됩니다');
      return true;
    } catch (err) {
      console.error('[Pixel Office] 자동 업데이트 실패:', err);
      this.failed = { version: info.version, until: Date.now() + UPDATE_STAGE_BACKOFF_MS };
      return false;
    } finally {
      this.staging = false;
    }
  }

  private setStatus(msg: Record<string, unknown>): void {
    this.status = msg;
    this.broadcast(msg);
  }
}

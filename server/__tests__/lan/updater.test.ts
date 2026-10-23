import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { INSTALL_RELAUNCH_GUARD_MS } from '../../src/constants.js';
import type { UpdateInfo } from '../../src/lan/updater.js';
import {
  checkForUpdate,
  consumeReopenMarker,
  downloadAndRun,
  isNewer,
  pickAsset,
  repoUrl,
  Updater,
  writeReopenMarker,
} from '../../src/lan/updater.js';

const DL = 'https://github.com/YOOJUNGYU/pixel-office-lan/releases/download/v0.2.0/';
const ASSETS = [
  {
    name: 'PixelOffice-0.2.0-Windows.exe',
    browser_download_url: `${DL}PixelOffice-0.2.0-Windows.exe`,
    size: 5,
  },
  {
    name: 'PixelOffice-0.2.0-Mac.pkg',
    browser_download_url: `${DL}PixelOffice-0.2.0-Mac.pkg`,
    size: 6,
  },
];
const RELEASE = {
  tag_name: 'v0.2.0',
  html_url: 'https://github.com/YOOJUNGYU/pixel-office-lan/releases/tag/v0.2.0',
  draft: false,
  assets: ASSETS,
};

const json = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

afterEach(() => {
  delete process.env.PIXEL_OFFICE_ALLOW_PRERELEASE;
  vi.restoreAllMocks();
});

describe('isNewer', () => {
  it('compares semver cores', () => {
    expect(isNewer('v0.2.0', '0.1.9')).toBe(true);
    expect(isNewer('v0.1.10', '0.1.9')).toBe(true);
    expect(isNewer('v0.1.0', '0.1.0')).toBe(false);
    expect(isNewer('v0.0.9', '0.1.0')).toBe(false);
    expect(isNewer('garbage', '0.1.0')).toBe(false);
  });

  it('ignores prereleases unless allowed', () => {
    expect(isNewer('v0.2.0-rc1', '0.1.0')).toBe(false);
    expect(isNewer('v0.1.0-rc2', '0.1.0-rc1', true)).toBe(true);
    expect(isNewer('v0.1.0', '0.1.0-rc2', true)).toBe(true);
    expect(isNewer('v0.1.0-rc1', '0.1.0', true)).toBe(false);
  });
});

describe('repoUrl', () => {
  const P = '/YOOJUNGYU/pixel-office-lan/releases/';
  it('accepts this repo only, after normalizing', () => {
    expect(repoUrl(RELEASE.html_url, P)).toBe(RELEASE.html_url);
    expect(repoUrl(`${RELEASE.html_url}/../../../../evil/repo/releases/x`, P)).toBeNull();
    expect(
      repoUrl('https://github.com/YOOJUNGYU/pixel-office-lan/releases/%2e%2e/%2e%2e/x', P),
    ).toBeNull();
    expect(repoUrl('not a url', P)).toBeNull();
  });

  it('a notes URL outside the repo falls back to the releases page', async () => {
    const evil = { ...RELEASE, html_url: `${RELEASE.html_url}/../../../../evil/x/releases/y` };
    const info = await checkForUpdate('0.1.0', json(evil), 'win32');
    expect(info?.notesUrl).toBe('https://github.com/YOOJUNGYU/pixel-office-lan/releases');
  });
});

describe('pickAsset', () => {
  const asset = (name: string) => ({ name, browser_download_url: `${DL}${name}`, size: 1 });

  it('picks the installer for this platform', () => {
    expect(pickAsset(ASSETS, 'win32')?.name).toBe('PixelOffice-0.2.0-Windows.exe');
    expect(pickAsset(ASSETS, 'darwin')?.url).toBe(`${DL}PixelOffice-0.2.0-Mac.pkg`);
    expect(pickAsset(ASSETS, 'linux')).toBeNull();
  });

  it('does not pick legacy names', () => {
    expect(pickAsset([asset('PixelOffice-Setup-0.2.0.exe')], 'win32')).toBeNull();
    expect(pickAsset([asset('PixelOffice-0.2.0-arm64.pkg')], 'darwin')).toBeNull();
    expect(pickAsset([asset('PixelOffice-0.2.0-x64.pkg')], 'darwin')).toBeNull();
  });

  it('never picks names outside the pattern', () => {
    expect(pickAsset([asset('PixelOffice-0.2.0-Windows.exe.bat')], 'win32')).toBeNull();
    expect(pickAsset([asset('Evil-0.2.0-Mac.pkg')], 'darwin')).toBeNull();
    expect(pickAsset([asset('PixelOffice-a/b-Mac.pkg')], 'darwin')).toBeNull();
  });
});

describe('checkForUpdate', () => {
  it('returns the update for a newer release', async () => {
    const info = await checkForUpdate('0.1.0', json(RELEASE), 'darwin');
    expect(info).toEqual({
      version: '0.2.0',
      assetUrl: `${DL}PixelOffice-0.2.0-Mac.pkg`,
      assetName: 'PixelOffice-0.2.0-Mac.pkg',
      assetSize: 6,
      notesUrl: RELEASE.html_url,
    });
  });

  it('null when up to date, 404, or the network fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await checkForUpdate('0.2.0', json(RELEASE), 'win32')).toBeNull();
    expect(await checkForUpdate('0.1.0', json({}, 404), 'win32')).toBeNull();
    const boom = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await checkForUpdate('0.1.0', boom, 'win32')).toBeNull();
  });

  it('PIXEL_OFFICE_ALLOW_PRERELEASE lists releases and takes the newest non-draft', async () => {
    process.env.PIXEL_OFFICE_ALLOW_PRERELEASE = '1';
    const urls: string[] = [];
    const fetchFn = (async (url: string) => {
      urls.push(url);
      return new Response(
        JSON.stringify([
          { ...RELEASE, tag_name: 'v0.3.0', draft: true },
          { ...RELEASE, tag_name: 'v0.2.0-rc2' },
        ]),
      );
    }) as unknown as typeof fetch;
    const info = await checkForUpdate('0.2.0-rc1', fetchFn, 'win32');
    expect(urls[0]).toContain('/releases?per_page=5');
    expect(info?.version).toBe('0.2.0-rc2');
  });
});

describe('downloadAndRun', () => {
  const info: UpdateInfo = {
    version: '0.2.0',
    assetUrl: ASSETS[0].browser_download_url,
    assetName: ASSETS[0].name,
    assetSize: 5,
    notesUrl: RELEASE.html_url,
  };
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'po-upd-'));

  it('rejects a URL outside the release download prefix', async () => {
    const launch = vi.fn();
    for (const assetUrl of [
      'https://evil.example/PixelOffice-0.2.0-Windows.exe',
      'https://github.com/someone/else/releases/download/v1/x.exe',
      'http://github.com/YOOJUNGYU/pixel-office-lan/releases/download/v0.2.0/x.exe',
      `${DL}../../../../evil/repo/releases/download/v1/PixelOffice-1-Windows.exe`,
      `${DL}%2e%2e/%2e%2e/%2e%2e/%2e%2e/evil/repo/releases/download/v1/PixelOffice-1-Windows.exe`,
      `${DL}%2E%2E/x.exe`,
      'https://github.com.evil.example/YOOJUNGYU/pixel-office-lan/releases/download/v1/x.exe',
    ]) {
      await expect(downloadAndRun({ ...info, assetUrl }, tmp(), { launch })).rejects.toThrow();
    }
    expect(launch).not.toHaveBeenCalled();
  });

  it('rejects an asset name that is not a plain installer file name', async () => {
    const launch = vi.fn();
    await expect(
      downloadAndRun({ ...info, assetName: '../evil.exe' }, tmp(), { launch }),
    ).rejects.toThrow();
    await expect(
      downloadAndRun({ ...info, assetName: 'PixelOffice-../x-Mac.pkg' }, tmp(), { launch }),
    ).rejects.toThrow();
    expect(launch).not.toHaveBeenCalled();
  });

  it('saves the installer and launches it', async () => {
    const dir = tmp();
    const launch = vi.fn();
    const urls: string[] = [];
    const fetchFn = (async (url: string) => {
      urls.push(url);
      return new Response('12345');
    }) as unknown as typeof fetch;
    await downloadAndRun(info, dir, { fetchFn, launch });
    expect(urls).toEqual([info.assetUrl]);
    const file = path.join(dir, info.assetName);
    expect(fs.readFileSync(file, 'utf8')).toBe('12345');
    expect(launch).toHaveBeenCalledWith(file);
  });

  it('an async launch failure (spawn error) rejects, so the status becomes error', async () => {
    const fetchFn = (async () => new Response('12345')) as unknown as typeof fetch;
    const launch = () => Promise.reject(new Error('spawn cmd ENOENT'));
    await expect(downloadAndRun(info, tmp(), { fetchFn, launch })).rejects.toThrow('ENOENT');
  });

  it('reuses a cached installer of the exact size: no download, same launch', async () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, info.assetName), '12345');
    const launch = vi.fn();
    const fetchFn = vi.fn();
    await downloadAndRun(info, dir, { fetchFn: fetchFn as unknown as typeof fetch, launch });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(launch).toHaveBeenCalledWith(path.join(dir, info.assetName));
  });

  it('re-downloads when the cached file has the wrong size', async () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, info.assetName), '123');
    const launch = vi.fn();
    const fetchFn = vi.fn(async () => new Response('12345'));
    await downloadAndRun(info, dir, { fetchFn: fetchFn as unknown as typeof fetch, launch });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(path.join(dir, info.assetName), 'utf8')).toBe('12345');
  });

  it('rejects a size mismatch or non-200 without launching', async () => {
    const dir = tmp();
    const launch = vi.fn();
    const short = (async () => new Response('123')) as unknown as typeof fetch;
    await expect(downloadAndRun(info, dir, { fetchFn: short, launch })).rejects.toThrow();
    const missing = (async () => new Response('', { status: 404 })) as unknown as typeof fetch;
    await expect(downloadAndRun(info, dir, { fetchFn: missing, launch })).rejects.toThrow();
    expect(launch).not.toHaveBeenCalled();
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});

describe('Updater', () => {
  const info: UpdateInfo = {
    version: '0.2.0',
    assetUrl: ASSETS[0].browser_download_url,
    assetName: ASSETS[0].name,
    assetSize: 5,
    notesUrl: RELEASE.html_url,
  };

  it('announces a found update and reports install progress', async () => {
    const sent: Record<string, unknown>[] = [];
    const u = new Updater('0.1.0', {
      check: async () => info,
      install: async (_i, _d, opts) => opts?.onProgress?.(50),
    });
    u.broadcast = (m) => sent.push(m);
    await u.check(true);
    expect(sent).toEqual([{ type: 'updateAvailable', version: '0.2.0', notesUrl: info.notesUrl }]);
    await u.install();
    expect(sent.slice(1)).toEqual([
      { type: 'updateStatus', state: 'downloading', percent: 0 },
      { type: 'updateStatus', state: 'downloading', percent: 50 },
      { type: 'updateStatus', state: 'installing' },
    ]);
    // a reload (handshake) after a cancelled UAC prompt is not stuck on "installing"
    expect(u.status).toBeNull();
  });

  it('ignores installUpdate while busy and during the relaunch guard, then allows it again', async () => {
    vi.useFakeTimers();
    try {
      const sent: Record<string, unknown>[] = [];
      let release!: () => void;
      const install = vi.fn(
        () => new Promise<void>((r) => (release = r)),
      ) as unknown as typeof downloadAndRun;
      const u = new Updater('0.1.0', { check: async () => info, install });
      u.broadcast = (m) => sent.push(m);
      u.info = info;
      const first = u.install();
      await u.install(); // busy
      expect(install).toHaveBeenCalledTimes(1);
      release();
      await first;
      sent.length = 0;
      await vi.advanceTimersByTimeAsync(INSTALL_RELAUNCH_GUARD_MS - 1);
      await u.install(); // guard
      expect(install).toHaveBeenCalledTimes(1);
      expect(sent).toEqual([{ type: 'updateStatus', state: 'installing' }]);
      await vi.advanceTimersByTimeAsync(2);
      const again = u.install(); // cancelled UAC: pressing again is allowed
      release();
      await again;
      expect(install).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a manual check with nothing new says up to date; a failed install says error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const sent: Record<string, unknown>[] = [];
    const u = new Updater('0.1.0', {
      check: async () => null,
      install: async () => {
        throw new Error('nope');
      },
    });
    u.broadcast = (m) => sent.push(m);
    await u.check(true);
    expect(sent).toEqual([{ type: 'updateStatus', state: 'upToDate' }]);
    u.info = info;
    await u.install();
    expect(sent.at(-1)).toEqual({ type: 'updateStatus', state: 'error' });
  });
});

describe('reopen marker (window after an update)', () => {
  const dirs: string[] = [];
  const tmp = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'po-reopen-'));
    dirs.push(d);
    return d;
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  it('a window was open: the new start opens nothing; none was: it opens once', () => {
    const d = tmp();
    writeReopenMarker(true, d, 1_000);
    expect(consumeReopenMarker(d, 2_000)).toBe('stay');
    expect(consumeReopenMarker(d, 2_000)).toBeNull(); // consumed
    writeReopenMarker(false, d, 1_000);
    expect(consumeReopenMarker(d, 2_000)).toBe('open');
    expect(fs.readdirSync(d)).toEqual([]);
  });

  it('no, stale or broken marker: a normal start (--open decides)', () => {
    const d = tmp();
    expect(consumeReopenMarker(d, 0)).toBeNull();
    writeReopenMarker(false, d, 0);
    expect(consumeReopenMarker(d, 31 * 60_000)).toBeNull();
    fs.writeFileSync(path.join(d, 'reopen'), '{nope');
    expect(consumeReopenMarker(d, 0)).toBeNull();
    expect(fs.readdirSync(d)).toEqual([]);
  });

  it('the marker is written only when a launched installer quits us, with the UI state then', async () => {
    const marks: boolean[] = [];
    let fail = true;
    const u = new Updater('0.1.0', {
      check: async () => null,
      install: async () => {
        if (fail) throw new Error('download failed');
      },
      markReopen: (open) => marks.push(open),
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    u.info = {
      version: '0.2.0',
      assetUrl: '',
      assetName: 'PixelOffice-0.2.0-Windows.exe',
      assetSize: 1,
      notesUrl: '',
    };
    u.onQuit(); // a manual install's quit: nothing
    await u.install(); // download failed: nothing, and no installer to quit us
    u.onQuit();
    expect(marks).toEqual([]);
    fail = false;
    u.uiConnected = () => true;
    await u.install(); // launched; the tab is closed before the installer quits us
    u.uiConnected = () => false;
    u.onQuit();
    expect(marks).toEqual([false]);
  });
});

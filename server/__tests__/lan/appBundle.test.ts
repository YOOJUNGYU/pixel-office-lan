import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as zlib from 'zlib';

import {
  APP_RENAME_TRIES,
  UPDATE_FIRST_CHECK_MS,
  UPDATE_RECHECK_MS,
  UPDATE_STAGE_BACKOFF_MS,
} from '../../src/constants.js';
import {
  addStrike,
  bootUpdated,
  extractTgz,
  isBad,
  markBad,
  pickVersion,
  pruneVersions,
  readTar,
  restartMode,
} from '../../src/lan/appBundle.js';
import type { AppAsset, UpdateInfo } from '../../src/lan/updater.js';
import {
  APP_ASSET_NAME,
  checkForUpdate,
  pickAppAsset,
  pickAsset,
  renameWithRetry,
  stageAppUpdate,
  Updater,
} from '../../src/lan/updater.js';

const NODE = process.version;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-app-'));

/** Minimal ustar writer (tests only): [name, body | null = dir, type?]. */
function tar(entries: [string, string | null, string?][]): Buffer {
  const blocks: Buffer[] = [];
  for (const [name, body, type] of entries) {
    const h = Buffer.alloc(512);
    h.write(name, 0, 100, 'utf-8');
    h.write('0000644\0', 100);
    const data = Buffer.from(body ?? '');
    h.write(data.length.toString(8).padStart(11, '0') + '\0', 124);
    h.write(type ?? (body === null ? '5' : '0'), 156);
    h.write('ustar\0' + '00', 257, 'latin1');
    h.fill(' ', 148, 156);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    blocks.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}
const tgz = (entries: [string, string | null, string?][]) => zlib.gzipSync(tar(entries));
const manifest = (version: string, node = NODE) => JSON.stringify({ version, node });

function bundleDir(root: string, version: string, node = NODE): void {
  const dir = path.join(root, version);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'app.json'), manifest(version, node));
  fs.writeFileSync(path.join(dir, 'cli.js'), '');
}

describe('pickVersion / prune / bad', () => {
  it('picks the newest valid, compatible, not-bad version newer than the installed one', () => {
    const root = tmp();
    bundleDir(root, '1.0.2');
    bundleDir(root, '1.0.10');
    bundleDir(root, '1.0.11', 'v1.2.3'); // built for another Node
    bundleDir(root, '1.0.0');
    fs.mkdirSync(path.join(root, '1.0.12')); // incomplete (no manifest)
    expect(pickVersion(root, '1.0.1', NODE)).toBe('1.0.10');
    markBad(root, '1.0.10');
    expect(isBad(root, '1.0.10')).toBe(true);
    expect(pickVersion(root, '1.0.1', NODE)).toBe('1.0.2');
    expect(pickVersion(root, '1.0.2', NODE)).toBeNull();
    expect(pickVersion(path.join(root, 'missing'), '1.0.0', NODE)).toBeNull();
  });

  it('a manifest whose version differs from its dir is not booted', () => {
    const root = tmp();
    bundleDir(root, '2.0.0');
    fs.writeFileSync(path.join(root, '2.0.0', 'app.json'), manifest('2.0.1'));
    expect(pickVersion(root, '1.0.0', NODE)).toBeNull();
  });

  it('keeps the newest two newer than installed, plus the running one', () => {
    const root = tmp();
    for (const v of ['1.0.1', '1.0.2', '1.0.3', '1.0.4', '0.9.0']) bundleDir(root, v);
    pruneVersions(root, '1.0.0', '1.0.1');
    expect(fs.readdirSync(root).sort()).toEqual(['1.0.1', '1.0.3', '1.0.4']);
    pruneVersions(root, '1.0.4');
    expect(fs.readdirSync(root)).toEqual([]);
  });
});

describe('strikes / bootUpdated', () => {
  it('prereleases are booted only with the opt-in', () => {
    const root = tmp();
    bundleDir(root, '1.1.0-rc1');
    expect(pickVersion(root, '1.0.0', NODE)).toBeNull();
    expect(pickVersion(root, '1.0.0', NODE, true)).toBe('1.1.0-rc1');
  });

  it('the second strike in a row marks a version bad; an unwritable root records nothing', () => {
    const root = tmp();
    expect(addStrike(root, '1.0.2')).toBe(1);
    expect(isBad(root, '1.0.2')).toBe(false);
    expect(addStrike(root, '1.0.2')).toBe(2);
    expect(isBad(root, '1.0.2')).toBe(true);
    expect(addStrike(path.join(root, 'missing', 'dir'), '1.0.2')).toBeNull();
  });

  it('a throw while loading: installed now, strike 1; again → bad', () => {
    const root = tmp();
    bundleDir(root, '1.0.2');
    fs.writeFileSync(path.join(root, '1.0.2', 'cli.js'), "throw new Error('boom');");
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      expect(bootUpdated('1.0.1', root)).toBe(false);
      expect(isBad(root, '1.0.2')).toBe(false);
      expect(bootUpdated('1.0.1', root)).toBe(false);
      expect(isBad(root, '1.0.2')).toBe(true);
      expect(pickVersion(root, '1.0.1', NODE)).toBeNull();
      expect(err).toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'a read-only app dir: no update is booted (a failure could not be recorded)',
    () => {
      const root = tmp();
      bundleDir(root, '1.0.2');
      fs.writeFileSync(path.join(root, '1.0.2', 'cli.js'), 'globalThis.loadedRO = true;');
      fs.chmodSync(root, 0o555);
      vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        expect(bootUpdated('1.0.1', root)).toBe(false);
        expect((globalThis as { loadedRO?: boolean }).loadedRO).toBeUndefined();
      } finally {
        fs.chmodSync(root, 0o755);
        vi.restoreAllMocks();
      }
    },
  );
});

describe('readTar / extractTgz', () => {
  it('unpacks files and directories (leading ./ dropped)', () => {
    const dest = path.join(tmp(), 'out');
    extractTgz(
      tgz([
        ['./', null],
        ['./webview/', null],
        ['./webview/a.js', 'x'],
        ['./cli.js', 'y'],
      ]),
      dest,
    );
    expect(fs.readFileSync(path.join(dest, 'webview', 'a.js'), 'utf-8')).toBe('x');
    expect(fs.readFileSync(path.join(dest, 'cli.js'), 'utf-8')).toBe('y');
  });

  it.each([['../evil.js'], ['./a/../../evil.js'], ['/etc/evil'], ['C:/evil'], ['a\\..\\evil']])(
    'rejects the unsafe path %s',
    (name) => {
      const dest = path.join(tmp(), 'out');
      expect(() => extractTgz(tgz([[name, 'x']]), dest)).toThrow(/unsafe|escapes/);
      expect(fs.existsSync(path.join(dest, '..', 'evil.js'))).toBe(false);
    },
  );

  it.each([
    ['2', 'symlink'],
    ['1', 'hard link'],
    ['x', 'pax header'],
    ['L', 'GNU long name'],
  ])('rejects entry type %s (%s)', (type) => {
    expect(() => readTar(tar([['link', '', type]]))).toThrow(/refused/);
  });

  it('rejects a truncated archive', () => {
    expect(() => readTar(tar([['a', 'x'.repeat(2000)]]).subarray(0, 1024))).toThrow(/truncated/);
  });
});

describe('asset names', () => {
  const app = `PixelOffice-1.0.2-node-${NODE}-app.tgz`;
  const DL = 'https://github.com/YOOJUNGYU/pixel-office-lan/releases/download/v1.0.2/';
  const assets = [
    { name: app, browser_download_url: DL + app, size: 9, digest: 'sha256:ab' },
    { name: `${app}.sha256`, browser_download_url: `${DL}${app}.sha256`, size: 1 },
    { name: 'PixelOffice-1.0.2-node-v1.0.0-app.tgz', browser_download_url: DL + 'o', size: 9 },
  ];

  it('the app bundle never matches the installer picker, nor installers the bundle one', () => {
    expect(pickAsset(assets, 'win32')).toBeNull();
    expect(pickAsset(assets, 'darwin')).toBeNull();
    expect(APP_ASSET_NAME.test('PixelOffice-1.0.2-Windows.exe')).toBe(false);
    expect(APP_ASSET_NAME.test('PixelOffice-1.0.2-Mac.pkg')).toBe(false);
  });

  it('picks the bundle built for this exact Node, with digest and .sha256', () => {
    expect(pickAppAsset(assets, NODE)).toEqual({
      name: app,
      url: DL + app,
      size: 9,
      digest: 'sha256:ab',
      shaUrl: `${DL}${app}.sha256`,
    });
    expect(pickAppAsset(assets, 'v99.0.0')).toBeNull();
  });

  it('checkForUpdate offers a release with only an app bundle (Linux)', async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ tag_name: 'v1.0.2', assets }))) as unknown as typeof fetch;
    const info = await checkForUpdate('1.0.1', fetchFn, 'linux', NODE);
    expect(info?.assetName).toBe('');
    expect(info?.app?.name).toBe(app);
    expect(await checkForUpdate('1.0.1', fetchFn, 'linux', 'v99.0.0')).toBeNull();
  });
});

describe('stageAppUpdate', () => {
  const V = '1.0.2';
  const name = `PixelOffice-${V}-node-${NODE}-app.tgz`;
  const URL_ = `https://github.com/YOOJUNGYU/pixel-office-lan/releases/download/v${V}/${name}`;
  const good = tgz([
    ['./app.json', manifest(V)],
    ['./cli.js', 'exports.main = async () => {};'],
  ]);
  const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
  const serve = (files: Record<string, Buffer | string>) =>
    (async (u: string | URL) => {
      const body = files[String(u)];
      return body === undefined ? new Response('', { status: 404 }) : new Response(body);
    }) as unknown as typeof fetch;
  const asset = (over: Partial<AppAsset> = {}): AppAsset => ({
    name,
    url: URL_,
    size: good.length,
    digest: `sha256:${sha(good)}`,
    ...over,
  });

  it('verifies the API digest and unpacks into <root>/<version>', async () => {
    const root = tmp();
    await stageAppUpdate(V, asset(), {
      fetchFn: serve({ [URL_]: good }),
      root,
      installed: '1.0.1',
    });
    expect(pickVersion(root, '1.0.1', NODE)).toBe(V);
    expect(fs.readdirSync(root)).toEqual([V]);
  });

  it('falls back to the .sha256 asset when the API has no digest', async () => {
    const root = tmp();
    const fetchFn = serve({ [URL_]: good, [`${URL_}.sha256`]: `${sha(good)}  ${name}\n` });
    await stageAppUpdate(V, asset({ digest: undefined, shaUrl: `${URL_}.sha256` }), {
      fetchFn,
      root,
      installed: '1.0.1',
    });
    expect(pickVersion(root, '1.0.1', NODE)).toBe(V);
  });

  it('rejects a digest mismatch, a missing checksum, a wrong size, a foreign URL, a bad version', async () => {
    const root = tmp();
    const bad = Buffer.from(good);
    bad[bad.length - 1] ^= 1;
    const fetchFn = serve({ [URL_]: bad, 'https://evil.example/x': good });
    const run = (a: AppAsset, v = V) => stageAppUpdate(v, a, { fetchFn, root, installed: '1.0.1' });
    await expect(run(asset())).rejects.toThrow(/checksum mismatch/);
    await expect(run(asset({ digest: undefined }))).rejects.toThrow(/no checksum/);
    await expect(run(asset({ size: good.length + 1 }))).rejects.toThrow(/size/);
    await expect(run(asset({ url: 'https://evil.example/x' }))).rejects.toThrow(/refusing/);
    markBad(root, V);
    await expect(run(asset())).rejects.toThrow(/failed to start before/);
    expect(pickVersion(root, '1.0.1', NODE)).toBeNull();
    expect(fs.readdirSync(root).filter((n) => !n.startsWith('bad-'))).toEqual([]);
  });

  it('rejects a bundle whose manifest is for another Node or version', async () => {
    const root = tmp();
    const other = tgz([
      ['app.json', manifest(V, 'v1.0.0')],
      ['cli.js', ''],
    ]);
    await expect(
      stageAppUpdate(V, asset({ size: other.length, digest: `sha256:${sha(other)}` }), {
        fetchFn: serve({ [URL_]: other }),
        root,
      }),
    ).rejects.toThrow(/manifest/);
    expect(fs.readdirSync(root)).toEqual([]);
  });
});

describe('Updater silent path', () => {
  afterEach(() => vi.useRealTimers());
  const app: AppAsset = { name: 'x', url: 'u', size: 1 };
  const info = (over: Partial<UpdateInfo> = {}): UpdateInfo => ({
    version: '1.0.2',
    assetUrl: 'https://github.com/a',
    assetName: 'PixelOffice-1.0.2-Windows.exe',
    assetSize: 1,
    notesUrl: 'n',
    app,
    ...over,
  });
  const make = (opts: { restart?: boolean; stageFails?: boolean } = {}) => {
    const stage = vi.fn(async () => {
      if (opts.stageFails) throw new Error('nope');
    });
    const restart = vi.fn(() => opts.restart ?? true);
    const check = vi.fn(async () => info());
    const u = new Updater('1.0.1', {
      check,
      install: vi.fn(),
      stage,
      restart,
    });
    const sent: Record<string, unknown>[] = [];
    u.broadcast = (m) => sent.push(m);
    return { u, stage, restart, check, sent };
  };

  it('stages and restarts, without the banner', async () => {
    const { u, stage, restart, sent } = make();
    await u.check();
    expect(stage).toHaveBeenCalledWith('1.0.2', app);
    expect(restart).toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it('a failed stage falls back to the banner', async () => {
    const { u, sent } = make({ stageFails: true });
    await u.check();
    expect(sent[0]?.type).toBe('updateAvailable');
  });

  it('a manual check while staging is handled (no banner)', async () => {
    let release!: () => void;
    const { u, stage, sent } = make();
    stage.mockImplementationOnce(() => new Promise<void>((r) => (release = r)));
    const first = u.check();
    await u.check(true);
    expect(sent).toEqual([]);
    release();
    await first;
    expect(stage).toHaveBeenCalledTimes(1);
  });

  it('a failed stage is not retried for 24 h (banner meanwhile)', async () => {
    vi.useFakeTimers();
    const { u, stage, sent } = make({ stageFails: true });
    await u.check();
    await u.check();
    expect(stage).toHaveBeenCalledTimes(1);
    expect(sent.map((m) => m.type)).toEqual(['updateAvailable', 'updateAvailable']);
    vi.setSystemTime(Date.now() + UPDATE_STAGE_BACKOFF_MS + 1);
    await u.check();
    expect(stage).toHaveBeenCalledTimes(2);
  });

  it('renameWithRetry retries a held rename, then gives up', async () => {
    let n = 0;
    const flaky = () => {
      if (++n < 3) throw new Error('EBUSY');
    };
    await renameWithRetry('a', 'b', flaky, 0);
    expect(n).toBe(3);
    const always = vi.fn(() => {
      throw new Error('EPERM');
    });
    await expect(renameWithRetry('a', 'b', always, 0)).rejects.toThrow('EPERM');
    expect(always).toHaveBeenCalledTimes(APP_RENAME_TRIES);
  });

  it('no restart possible (Linux): staged once, not downloaded again', async () => {
    const { u, stage } = make({ restart: false });
    await u.check();
    await u.check();
    expect(stage).toHaveBeenCalledTimes(1);
  });

  it('checks right after start and then every 6 h', async () => {
    vi.useFakeTimers();
    const { u, check } = make({ stageFails: true });
    u.start();
    await vi.advanceTimersByTimeAsync(UPDATE_FIRST_CHECK_MS);
    expect(check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(UPDATE_RECHECK_MS);
    expect(check).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(UPDATE_RECHECK_MS);
    expect(check).toHaveBeenCalledTimes(3);
    u.stop();
    await vi.advanceTimersByTimeAsync(UPDATE_RECHECK_MS);
    expect(check).toHaveBeenCalledTimes(3);
  });
});

describe('restartMode', () => {
  it('launchd for our LaunchAgent, respawn on Windows/the Mac app, none on Linux', () => {
    expect(restartMode('darwin', { XPC_SERVICE_NAME: 'com.pixeloffice.agent' })).toBe('launchd');
    expect(restartMode('darwin', { XPC_SERVICE_NAME: 'application.x' })).toBe('respawn');
    expect(restartMode('win32', {})).toBe('respawn');
    expect(restartMode('linux', {})).toBe('none');
    expect(restartMode('linux', { PIXEL_OFFICE_UPDATE_RESPAWN: '1' })).toBe('respawn');
  });
});

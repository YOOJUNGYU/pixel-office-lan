// End to end: the bundled dist/cli.js against a fake releases API on 127.0.0.1
// (PIXEL_OFFICE_UPDATE_API) — download, verify, restart into the new version;
// a corrupted bundle is refused; a bundle that fails to start is rolled back.
import { execFileSync, spawn } from 'child_process';
import { createHash } from 'crypto';
import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as http from 'http';
import type { AddressInfo } from 'net';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = path.join(__dirname, '../../..');
const DIST = path.join(ROOT, 'dist');
const CLI = path.join(DIST, 'cli.js');
const INSTALLED = (
  JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')) as {
    version: string;
  }
).version;
const NEXT = '1.0.99';
const ASSET = `PixelOffice-${NEXT}-node-${process.version}-app.tgz`;
const DL_PATH = `/YOOJUNGYU/pixel-office-lan/releases/download/v${NEXT}/${ASSET}`;
const WAIT_MS = 45_000;

let work: string;
let bundle: Buffer;
let api: http.Server;
let apiUrl: string;
/** What the fake API answers: a release, or 404. */
let release: { digest: string } | null = null;
const pids: number[] = [];

async function health(port: number): Promise<{ version: string; pid: number } | null> {
  try {
    const r = await fetch(`http://127.0.0.1:${port.toString()}/api/health`);
    return r.ok ? ((await r.json()) as { version: string; pid: number }) : null;
  } catch {
    return null;
  }
}

async function until<T>(f: () => Promise<T | null | false>, what: string): Promise<T> {
  const end = Date.now() + WAIT_MS;
  while (Date.now() < end) {
    const v = await f();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timed out: ${what}`);
}

let nextPort = 47950;
function startCli(home: string): { port: number; out: () => string } {
  const port = nextPort++;
  let out = '';
  const child = spawn(process.execPath, [CLI, '--port', port.toString()], {
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      PIXEL_OFFICE_NO_PEERS: '1',
      PIXEL_OFFICE_NO_TRAY: '1',
      PIXEL_OFFICE_UPDATE_API: apiUrl,
      PIXEL_OFFICE_UPDATE_RESPAWN: '1',
      CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
      CODEX_HOME: path.join(home, '.codex'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  pids.push(child.pid!);
  child.stdout.on('data', (d: Buffer) => (out += d.toString()));
  child.stderr.on('data', (d: Buffer) => (out += d.toString()));
  return { port, out: () => out };
}

const appDir = (home: string) => path.join(home, '.pixel-office', 'app');

beforeAll(async () => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-e2e-'));
  // The "next release": this dist/ with cli.js rebuilt as NEXT, + its manifest.
  const stage = path.join(work, 'stage');
  fs.cpSync(DIST, stage, { recursive: true, filter: (f) => !f.endsWith('.map') });
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'server/src/cli.ts')],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    outfile: path.join(stage, 'cli.js'),
    define: { __APP_VERSION__: JSON.stringify(NEXT) },
    logLevel: 'silent',
  });
  fs.writeFileSync(
    path.join(stage, 'app.json'),
    JSON.stringify({ version: NEXT, node: process.version }),
  );
  const tgz = path.join(work, ASSET);
  execFileSync('tar', ['--format=ustar', '-czf', tgz, '-C', stage, '.']);
  bundle = fs.readFileSync(tgz);

  api = http.createServer((req, res) => {
    if (req.url === '/api' && release) {
      const base = apiUrl.replace(/\/api$/, '');
      res.end(
        JSON.stringify({
          tag_name: `v${NEXT}`,
          assets: [
            {
              name: ASSET,
              browser_download_url: base + DL_PATH,
              size: bundle.length,
              digest: release.digest,
            },
          ],
        }),
      );
    } else if (req.url === DL_PATH) {
      res.end(bundle);
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((r) => api.listen(0, '127.0.0.1', r));
  apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port.toString()}/api`;
}, 60_000);

afterAll(async () => {
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* gone */
    }
  }
  await new Promise((r) => api.close(r));
});

describe('silent app update (bundled CLI)', { timeout: 90_000 }, () => {
  it('downloads, verifies, restarts and serves the new version', async () => {
    release = { digest: `sha256:${createHash('sha256').update(bundle).digest('hex')}` };
    const home = fs.mkdtempSync(path.join(work, 'home-'));
    const { port } = startCli(home);
    const first = await until(() => health(port), 'first start');
    expect(first.version).toBe(INSTALLED);
    const next = await until(async () => {
      const h = await health(port);
      return h?.version === NEXT && h;
    }, `serving ${NEXT}`);
    pids.push(next.pid);
    expect(next.pid).not.toBe(first.pid);
    expect(fs.existsSync(path.join(appDir(home), NEXT, 'cli.js'))).toBe(true);
  });

  it('refuses a bundle whose SHA-256 does not match', async () => {
    release = { digest: `sha256:${'0'.repeat(64)}` };
    const home = fs.mkdtempSync(path.join(work, 'home-'));
    const { port, out } = startCli(home);
    await until(async () => out().includes('checksum mismatch'), 'checksum refusal');
    expect((await health(port))?.version).toBe(INSTALLED);
    expect(fs.existsSync(path.join(appDir(home), NEXT))).toBe(false);
  });

  /** A staged version dir whose cli.js is `code`. */
  function plant(home: string, version: string, code: string): void {
    const dir = path.join(appDir(home), version);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'app.json'),
      JSON.stringify({ version, node: process.version }),
    );
    fs.writeFileSync(path.join(dir, 'cli.js'), code);
  }

  it('a bundle that throws while loading is marked bad; the installed one starts', async () => {
    release = null;
    const home = fs.mkdtempSync(path.join(work, 'home-'));
    plant(home, '1.0.98', "throw new Error('boom');");
    const { port } = startCli(home);
    expect((await until(() => health(port), 'start')).version).toBe(INSTALLED);
    expect(fs.existsSync(path.join(appDir(home), 'bad-1.0.98'))).toBe(true);
  });

  it('a bundle that exits before listening is marked bad and restarted out of', async () => {
    release = null;
    const home = fs.mkdtempSync(path.join(work, 'home-'));
    plant(home, '1.0.98', 'exports.main = async () => { process.exit(3); };');
    const { port } = startCli(home);
    const h = await until(() => health(port), 'respawned installed version');
    pids.push(h.pid);
    expect(h.version).toBe(INSTALLED);
    expect(fs.existsSync(path.join(appDir(home), 'bad-1.0.98'))).toBe(true);
  });
});

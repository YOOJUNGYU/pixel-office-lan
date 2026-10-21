import { spawn } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

import { CliArgsError, parseArgs } from '../src/cli.js';

const CLI_BUNDLE = path.join(__dirname, '../../dist/cli.js');
const CLI_START_TIMEOUT_MS = 10_000;

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to allocate a test port'));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

async function waitForCondition(check: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + CLI_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for bundled CLI startup');
}

async function stopChild(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolve) => child.once('close', () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

/** Isolated env: no UDP broadcast on the real LAN, no real Claude/Codex sessions. */
function isolatedEnv(home: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    PIXEL_OFFICE_NO_PEERS: '1',
    CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
    CODEX_HOME: path.join(home, '.codex'),
  };
}

/** Run the real bundled CLI as a subprocess, returns exit code + output. */
function runCli(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('node', [CLI_BUNDLE, ...args], {
      env: isolatedEnv(fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-cli-home-'))),
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

describe('parseArgs', () => {
  // 1. Defaults: LAN-reachable on the well-known UI port, no browser
  it('defaults to 0.0.0.0:47801 without --open', () => {
    expect(parseArgs([])).toEqual({ host: '0.0.0.0', port: 47801, open: false });
    expect(parseArgs(['--open']).open).toBe(true);
    expect(parseArgs(['--autostart', 'default']).autostart).toBe('default');
    expect(() => parseArgs(['--autostart', 'maybe'])).toThrow(CliArgsError);
    expect(() => parseArgs(['--autostart'])).toThrow(CliArgsError);
  });

  // 2. Valid --port is accepted
  it('accepts a valid --port', () => {
    expect(parseArgs(['--port', '3100']).port).toBe(3100);
    expect(parseArgs(['-p', '8080']).port).toBe(8080);
  });

  // 3. Boundary values are accepted
  it('accepts the boundary ports 1 and 65535', () => {
    expect(parseArgs(['--port', '1']).port).toBe(1);
    expect(parseArgs(['--port', '65535']).port).toBe(65535);
  });

  // 4. Non-numeric --port is rejected (would otherwise become NaN)
  it('rejects a non-numeric --port instead of producing NaN', () => {
    expect(() => parseArgs(['--port', 'not-a-number'])).toThrow(CliArgsError);
  });

  // 5. Zero is rejected (0 means "ephemeral" internally; not a valid explicit choice)
  it('rejects --port 0', () => {
    expect(() => parseArgs(['--port', '0'])).toThrow(CliArgsError);
  });

  // 6. Out-of-range (too high) is rejected
  it('rejects --port 70000 (out of TCP range)', () => {
    expect(() => parseArgs(['--port', '70000'])).toThrow(CliArgsError);
  });

  // 7. Negative is rejected
  it('rejects a negative --port', () => {
    expect(() => parseArgs(['--port', '-1'])).toThrow(CliArgsError);
  });

  // 8. Non-integer (decimal) is rejected
  it('rejects a decimal --port', () => {
    expect(() => parseArgs(['--port', '3100.5'])).toThrow(CliArgsError);
  });

  // 9. A port option without its required operand is rejected, not ignored
  it.each(['--port', '-p'])('rejects %s when its value is missing', (option) => {
    expect(() => parseArgs([option])).toThrow(CliArgsError);
    expect(() => parseArgs([option])).toThrow(/Missing value/);
  });

  // 10. --host is parsed independently of --port
  it('parses --host', () => {
    expect(parseArgs(['--host', '0.0.0.0']).host).toBe('0.0.0.0');
  });
});

/**
 * These spawn the real bundled dist/cli.js (built by esbuild), not the TS
 * source -- unlike the parseArgs tests above (which only prove importing the
 * module for its exports is side-effect-free), these prove the
 * `require.main === module` guard added to cli.ts still lets `main()` run
 * when the file IS executed directly, i.e. production behavior is intact.
 * Requires `npm run compile` (or `node esbuild.js`) to have produced
 * dist/cli.js first; reported as a loud skip if it hasn't.
 */
describe('dist/cli.js entry-point guard', () => {
  /** These tests spawn the BUNDLED CLI, so they need `npm run compile` to have
   *  run. Reported as a loud skip rather than an early `return`, which Vitest
   *  shows as PASSED with no message — a false green over a test that never
   *  exercised anything. */
  const itBuilt = it.skipIf(!fs.existsSync(CLI_BUNDLE));

  // 11. Direct execution still runs main() (--help exits 0 with usage)
  itBuilt('runs main() when executed directly: --help prints usage and exits 0', async () => {
    const { code, stdout } = await runCli(['--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('Usage: pixel-office');
  });

  // 12. Direct execution still runs main()'s port validation (rejects before listen())
  itBuilt(
    'runs main() when executed directly: invalid --port exits 1 without starting a server',
    async () => {
      const { code, stderr } = await runCli(['--port', 'not-a-number']);
      expect(code).toBe(1);
      expect(stderr).toContain('Invalid --port');
    },
  );

  // Port held by another program: exit 0 so the macOS LaunchAgent does not respawn-loop
  itBuilt('port busy (not a Pixel Office): exits 0 with a message', async () => {
    const blocker = net.createServer((sock) => sock.destroy());
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', r));
    const port = (blocker.address() as net.AddressInfo).port;
    try {
      const { code, stderr } = await runCli(['--port', port.toString(), '--host', '127.0.0.1']);
      expect(stderr).toContain('포트를 다른 프로그램이 쓰고 있습니다');
      expect(code).toBe(0);
    } finally {
      blocker.close();
    }
  });

  /** Spawn the real bundled CLI against an isolated HOME, wait for /api/health,
   *  and hand back its output for assertions. Callers seed `tmpHome` first.
   *  `host` is the literal `--host` operand, so a caller can exercise a wildcard
   *  bind; readiness is always probed over loopback, which every bind serves. */
  async function runCliServer(
    tmpHome: string,
    body: (ctx: { output: () => string; port: number }) => Promise<void>,
    host = '127.0.0.1',
  ): Promise<void> {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-cli-workspace-'));
    const port = await getFreePort();
    const child = spawn(process.execPath, [CLI_BUNDLE, '--port', port.toString(), '--host', host], {
      cwd: workspaceDir,
      env: isolatedEnv(tmpHome),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    try {
      await waitForCondition(async () => {
        if (child.exitCode !== null) {
          throw new Error(`Bundled CLI exited before startup:\n${output}`);
        }
        try {
          return (await fetch(`http://127.0.0.1:${port.toString()}/api/health`)).ok;
        } catch {
          return false;
        }
      });
      await body({ output: () => output, port });
    } finally {
      await stopChild(child);
      fs.rmSync(tmpHome, { recursive: true, force: true });
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  }

  /** The URL line the operator sees. The trailing `\s` waits for a complete line. */
  const URL_LINE = /Pixel Office running at (\S+)\s/;

  function printedUrl(output: string): URL {
    const match = URL_LINE.exec(output);
    if (!match?.[1]) throw new Error(`No server URL in CLI output:\n${output}`);
    return new URL(match[1]);
  }

  itBuilt('prints a browsable URL serving the SPA', async () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-cli-url-'));
    await runCliServer(tmpHome, async ({ output, port }) => {
      await waitForCondition(() => URL_LINE.test(output()));
      const url = printedUrl(output());
      expect(url.port).toBe(port.toString());
      const response = await fetch(url);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('<div id="root">');
    });
  });

  // `--host 0.0.0.0` is a BIND target, not an address to browse to.
  itBuilt('prints a reachable loopback host when bound to the 0.0.0.0 wildcard', async () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-cli-wildcard-'));
    await runCliServer(
      tmpHome,
      async ({ output }) => {
        await waitForCondition(() => URL_LINE.test(output()));
        const url = printedUrl(output());
        expect(url.hostname).toBe('localhost');
        expect((await fetch(url)).status).toBe(200);
      },
      '0.0.0.0',
    );
  });
});

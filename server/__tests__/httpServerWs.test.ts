import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

import { WS_CLOSE_FORBIDDEN_ORIGIN } from '../src/constants.js';

// Isolated temp HOME: layout and config land under ~/.pixel-office/.
let tmpBase: string;

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpBase };
});

const { PixelAgentsServer } = await import('../src/server.js');
const { isLoopback } = await import('../src/httpServer.js');

/** Slack after the handshake for a server-side rejection close to land. */
const SETTLE_MS = 300;

interface ConnectResult {
  accepted: boolean;
  closeCode?: number;
  socket: WebSocket;
}

/**
 * Open a /ws socket and report whether the server KEPT it. `@fastify/websocket`
 * completes the upgrade before the route handler runs, so a rejected connection
 * still fires 'open' and is then closed with an application close code.
 */
function connect(port: number, headers: Record<string, string> = {}): Promise<ConnectResult> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port.toString()}/ws`, { headers });
    let closeCode: number | undefined;
    const failTimer = setTimeout(() => {
      socket.terminate();
      reject(new Error('Timed out waiting for the /ws handshake to settle'));
    }, 5_000);
    const settle = (): void => {
      clearTimeout(failTimer);
      resolve({ accepted: closeCode === undefined, closeCode, socket });
    };
    socket.on('open', () => setTimeout(settle, SETTLE_MS));
    socket.on('close', (code: number) => {
      closeCode = code;
      settle();
    });
    socket.on('error', () => {
      /* a server-side close surfaces as 'close' */
    });
  });
}

/** Wait for one JSON message of the given type (or resolve null on timeout). */
function waitForMessage(socket: WebSocket, type: string, ms = 2_000): Promise<unknown | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    socket.on('message', (data: Buffer) => {
      const msg = JSON.parse(data.toString()) as { type?: string };
      if (msg.type === type) {
        clearTimeout(timer);
        resolve(msg);
      }
    });
  });
}

const layoutPath = (): string => path.join(tmpBase, '.pixel-office', 'layout.json');

describe('isLoopback', () => {
  const req = (remoteAddress: string, host?: string, origin?: string) => ({
    socket: { remoteAddress },
    headers: { host, origin },
  });

  it('accepts a loopback peer under a loopback Host, with or without a same-host Origin', () => {
    expect(isLoopback(req('127.0.0.1', 'localhost:47801'))).toBe(true);
    expect(isLoopback(req('::1', '[::1]:47801'))).toBe(true);
    expect(isLoopback(req('::ffff:127.0.0.1', '127.0.0.1:47801'))).toBe(true);
    expect(isLoopback(req('127.0.0.1', 'localhost:47801', 'http://localhost:47801'))).toBe(true);
  });

  it('rejects a remote peer even under a loopback Host', () => {
    expect(isLoopback(req('192.168.0.20', 'localhost:47801'))).toBe(false);
  });

  it('rejects a non-loopback Host (DNS rebinding) or a missing one', () => {
    expect(isLoopback(req('127.0.0.1', 'evil.example:47801'))).toBe(false);
    expect(isLoopback(req('127.0.0.1', '192.168.0.10:47801'))).toBe(false);
    expect(isLoopback(req('127.0.0.1', undefined))).toBe(false);
  });

  it('rejects an Origin naming another host', () => {
    expect(isLoopback(req('127.0.0.1', 'localhost:47801', 'http://evil.example'))).toBe(false);
    expect(isLoopback(req('127.0.0.1', 'localhost:47801', 'http://localhost:9999'))).toBe(false);
    expect(isLoopback(req('127.0.0.1', 'localhost:47801', 'null'))).toBe(false);
  });
});

describe('/ws', () => {
  let server: InstanceType<typeof PixelAgentsServer>;
  let port: number;
  const sockets: WebSocket[] = [];

  beforeEach(async () => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-ws-test-'));
    server = new PixelAgentsServer();
    ({ port } = await server.start({ logger: false }));
  });

  afterEach(async () => {
    for (const socket of sockets) socket.terminate();
    sockets.length = 0;
    await server.stop();
    fs.rmSync(tmpBase, { recursive: true, force: true });
  });

  it('closes a cross-origin handshake', async () => {
    const result = await connect(port, { Origin: 'http://evil.example' });
    sockets.push(result.socket);
    expect(result.accepted).toBe(false);
    expect(result.closeCode).toBe(WS_CLOSE_FORBIDDEN_ORIGIN);
  });

  it('a loopback browser is privileged: told it can edit, and its saveLayout lands', async () => {
    const host = `localhost:${port.toString()}`;
    const { socket, accepted } = await connect(port, { Host: host, Origin: `http://${host}` });
    sockets.push(socket);
    expect(accepted).toBe(true);
    const access = waitForMessage(socket, 'officeAccess');
    const layoutLoaded = waitForMessage(socket, 'layoutLoaded');
    socket.send(JSON.stringify({ type: 'webviewReady' }));
    expect(await access).toEqual({ type: 'officeAccess', readOnly: false });
    expect(await layoutLoaded).not.toBeNull();

    socket.send(JSON.stringify({ type: 'saveLayout', layout: { version: 1, marker: 'mine' } }));
    await vi.waitFor(() => expect(fs.existsSync(layoutPath())).toBe(true));
    expect(JSON.parse(fs.readFileSync(layoutPath(), 'utf-8'))).toMatchObject({ marker: 'mine' });
  });

  it('a non-loopback Host is read-only: saveLayout is ignored', async () => {
    const host = `office.example:${port.toString()}`;
    const { socket, accepted } = await connect(port, { Host: host, Origin: `http://${host}` });
    sockets.push(socket);
    expect(accepted).toBe(true);
    const access = waitForMessage(socket, 'officeAccess');
    socket.send(JSON.stringify({ type: 'webviewReady' }));
    expect(await access).toEqual({ type: 'officeAccess', readOnly: true });

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    socket.send(JSON.stringify({ type: 'saveLayout', layout: { version: 1 } }));
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    warn.mockRestore();
    expect(fs.existsSync(layoutPath())).toBe(false);
  });
});

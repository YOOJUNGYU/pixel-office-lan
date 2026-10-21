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
const { readConfig, writeConfig } = await import('../src/configPersistence.js');
const { LanService } = await import('../src/lan/office.js');
const { loadProfile } = await import('../src/lan/profile.js');

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

  it('a LAN viewer never receives local paths in the handshake', async () => {
    const cfg = readConfig();
    cfg.externalAssetDirectories = ['/home/kim/assets'];
    cfg.standalone.areaMappings = { 'kim-project': ['Lab'] };
    writeConfig(cfg);

    const host = `office.example:${port.toString()}`;
    const { socket } = await connect(port, { Host: host, Origin: `http://${host}` });
    sockets.push(socket);
    const settings = waitForMessage(socket, 'settingsLoaded');
    const mappings = waitForMessage(socket, 'areaMappingsLoaded');
    socket.send(JSON.stringify({ type: 'webviewReady' }));
    expect(await settings).toMatchObject({ externalAssetDirectories: [] });
    expect(await mappings).toEqual({ type: 'areaMappingsLoaded', mappings: {} });
  });
});

describe('/ws LAN office', () => {
  let server: InstanceType<typeof PixelAgentsServer>;
  let port: number;
  const sockets: WebSocket[] = [];
  const profilePath = (): string => path.join(tmpBase, '.pixel-office', 'profile.json');
  const localView = {
    id: 's1',
    provider: 'claude',
    kind: 'main',
    num: 1,
    room: 'coding',
    permission: false,
    summary: '/home/kim/a.ts 수정 중',
    reason: '',
  } as const;
  const update = {
    nickname: '유',
    palette: 1,
    hueShift: 20,
    hideDetails: true,
    manualPeers: ['192.168.0.9'],
  };

  beforeEach(async () => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-ws-lan-'));
    const lan = new LanService(loadProfile(), { views: () => [localView] });
    server = new PixelAgentsServer();
    ({ port } = await server.start({ logger: false, lan }));
  });

  afterEach(async () => {
    for (const socket of sockets) socket.terminate();
    sockets.length = 0;
    await server.stop();
    fs.rmSync(tmpBase, { recursive: true, force: true });
  });

  async function open(hostname: string): Promise<WebSocket> {
    const host = `${hostname}:${port.toString()}`;
    const { socket } = await connect(port, { Host: host, Origin: `http://${host}` });
    sockets.push(socket);
    return socket;
  }

  it('loopback: canEdit, verbatim agents, saveProfile lands and is echoed', async () => {
    const socket = await open('localhost');
    const loaded = waitForMessage(socket, 'profileLoaded');
    const snap = waitForMessage(socket, 'officeSnapshot');
    socket.send(JSON.stringify({ type: 'webviewReady' }));
    expect(await loaded).toMatchObject({ canEdit: true, profile: { hideDetails: true } });
    expect(await snap).toMatchObject({
      agents: [{ summary: '/home/kim/a.ts 수정 중', key: expect.stringMatching(/:s1$/) }],
      selfPeerId: expect.any(String),
    });

    const echoed = waitForMessage(socket, 'profileLoaded');
    socket.send(JSON.stringify({ type: 'saveProfile', profile: update }));
    expect(await echoed).toMatchObject({ canEdit: true, profile: update });
    expect(JSON.parse(fs.readFileSync(profilePath(), 'utf-8'))).toMatchObject(update);
  });

  it('read-only viewer: redacted agents, no manual peers, saveProfile ignored', async () => {
    const before = fs.readFileSync(profilePath(), 'utf-8');
    const socket = await open('office.example');
    const loaded = waitForMessage(socket, 'profileLoaded');
    const snap = waitForMessage(socket, 'officeSnapshot');
    socket.send(JSON.stringify({ type: 'webviewReady' }));
    expect(await loaded).toMatchObject({ canEdit: false, profile: { manualPeers: [] } });
    expect(await snap).toMatchObject({ agents: [{ summary: 'a.ts 수정 중' }] });

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const refused = waitForMessage(socket, 'profileLoaded');
    socket.send(JSON.stringify({ type: 'saveProfile', profile: update }));
    expect(await refused).toMatchObject({ canEdit: false, profile: { nickname: '' } });
    warn.mockRestore();
    expect(fs.readFileSync(profilePath(), 'utf-8')).toBe(before);
  });

  it('pushes officeSnapshot every second', async () => {
    const socket = await open('localhost');
    let count = 0;
    socket.on('message', (d: Buffer) => {
      if ((JSON.parse(d.toString()) as { type?: string }).type === 'officeSnapshot') count++;
    });
    await vi.waitFor(() => expect(count).toBeGreaterThanOrEqual(2), { timeout: 3_000 });
  });
});

import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

import { WS_CLOSE_FORBIDDEN } from '../src/constants.js';
import type { CreatedOffice } from '../src/lan/office.js';

// Isolated temp HOME: layout and config land under ~/.pixel-office/.
let tmpBase: string;

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpBase };
});

const { PixelAgentsServer } = await import('../src/server.js');
const { isLoopback } = await import('../src/httpServer.js');
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

/** GET path with a given Host header → status code. */
const get = (port: number, p: string, host: string): Promise<number> =>
  new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: p, headers: { Host: host } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      })
      .on('error', reject);
  });

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
    expect(result.closeCode).toBe(WS_CLOSE_FORBIDDEN);
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

  it('another PC or a non-loopback Host is closed 4003, and its HTTP gets 403', async () => {
    const remote = `office.example:${port.toString()}`;
    const r = await connect(port, { Host: remote, Origin: `http://${remote}` });
    sockets.push(r.socket);
    expect(r.accepted).toBe(false);
    expect(r.closeCode).toBe(WS_CLOSE_FORBIDDEN);
    expect(await get(port, '/api/health', remote)).toBe(403);
    expect(await get(port, '/api/ping', remote)).toBe(403);
    expect(await get(port, '/api/ping', `127.0.0.1:${port.toString()}`)).toBe(200);
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
    act: 'edit',
    target: '/home/kim/a.ts',
    reason: '',
  } as const;
  const update = {
    nickname: '유',
    palette: 1,
    hueShift: 20,
    hideDetails: true,
    manualPeers: ['192.168.0.9'],
  };

  let lan: InstanceType<typeof LanService>;

  beforeEach(async () => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-ws-lan-'));
    lan = new LanService(loadProfile(), { views: () => [localView] });
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
      agents: [{ target: '/home/kim/a.ts', key: expect.stringMatching(/:s1$/) }],
      selfPeerId: expect.any(String),
    });

    const echoed = waitForMessage(socket, 'profileLoaded');
    socket.send(JSON.stringify({ type: 'saveProfile', profile: update }));
    expect(await echoed).toMatchObject({ canEdit: true, profile: update });
    expect(JSON.parse(fs.readFileSync(profilePath(), 'utf-8'))).toMatchObject(update);
  });

  it('pushes officeSnapshot every second', async () => {
    const socket = await open('localhost');
    let count = 0;
    socket.on('message', (d: Buffer) => {
      if ((JSON.parse(d.toString()) as { type?: string }).type === 'officeSnapshot') count++;
    });
    await vi.waitFor(() => expect(count).toBeGreaterThanOrEqual(2), { timeout: 3_000 });
  });

  it('an old profile with remoteView: true still serves this PC only', async () => {
    fs.writeFileSync(
      profilePath(),
      JSON.stringify({ ...JSON.parse(fs.readFileSync(profilePath(), 'utf-8')), remoteView: true }),
    );
    lan.profile = loadProfile();
    expect('remoteView' in lan.profile).toBe(false);
    expect(fs.readFileSync(profilePath(), 'utf-8')).not.toContain('remoteView');

    const remote = `office.example:${port.toString()}`;
    expect(await get(port, '/', remote)).toBe(403);
    expect(await get(port, '/api/health', remote)).toBe(403);
    expect(await get(port, '/api/ping', remote)).toBe(403);
    expect(await get(port, '/api/health', `localhost:${port.toString()}`)).toBe(200);
    const r = await connect(port, { Host: remote, Origin: `http://${remote}` });
    sockets.push(r.socket);
    expect(r.closeCode).toBe(WS_CLOSE_FORBIDDEN);
  });

  it('team office: the code goes to the creator only; setRemoteView is unknown', async () => {
    const local = await open('localhost');
    const created = waitForMessage(local, 'officeCreated');
    const state = waitForMessage(local, 'officesState');
    local.send(JSON.stringify({ type: 'createOffice', name: '팀' }));
    const c = (await created) as { tag: string; code: string };
    expect(c.code).toMatch(/^PO2-/);
    const st = await state;
    expect(JSON.stringify(st)).not.toContain(c.code);
    expect(st).not.toHaveProperty('remoteView');
    const localSnap = (await waitForMessage(local, 'officeSnapshot')) as { agents: unknown[] };
    expect(localSnap.agents).toHaveLength(1);

    const replies: string[] = [];
    local.on('message', (d: Buffer) =>
      replies.push((JSON.parse(d.toString()) as { type: string }).type),
    );
    local.send(JSON.stringify({ type: 'setRemoteView', enabled: true }));
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    expect(replies.filter((t) => t !== 'officeSnapshot')).toEqual([]);
    expect(fs.readFileSync(profilePath(), 'utf-8')).not.toContain('remoteView');
  });

  it('a refused join tells only the asking socket why; alreadyJoined still switches', async () => {
    const created = lan.createOffice('팀') as CreatedOffice;
    lan.leaveOffice(created.tag);
    const a = await open('localhost');
    const b = await open('localhost');
    const bTypes: string[] = [];
    b.on('message', (d: Buffer) =>
      bTypes.push((JSON.parse(d.toString()) as { type: string }).type),
    );
    const err = waitForMessage(a, 'officeError');
    a.send(JSON.stringify({ type: 'joinOffice', code: 'PO2-NOPE' }));
    expect(await err).toEqual({ type: 'officeError', reason: 'invalidCode' });

    const ok = waitForMessage(a, 'officesState');
    a.send(JSON.stringify({ type: 'joinOffice', code: created.code.toLowerCase() }));
    expect(await ok).toMatchObject({ activeView: created.tag });

    const again = waitForMessage(a, 'officeError');
    a.send(JSON.stringify({ type: 'joinOffice', code: created.code }));
    expect(await again).toEqual({ type: 'officeError', reason: 'alreadyJoined' });
    expect(lan.profile.offices).toHaveLength(1);

    const bad = waitForMessage(a, 'officeError');
    a.send(JSON.stringify({ type: 'createOffice', name: '' }));
    expect(await bad).toEqual({ type: 'officeError', reason: 'nameInvalid' });
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    expect(bTypes).not.toContain('officeError');
  });

  it('re-sends officesState once a member announces the team name', async () => {
    const created = lan.createOffice('팀') as CreatedOffice;
    lan.leaveOffice(created.tag);
    lan.joinOffice(created.code); // joined without a name
    const a = await open('localhost');
    const named = waitForMessage(a, 'officesState', 3_000);
    lan.net = { ...lan.net, teamName: () => '알림팀' };
    expect(await named).toMatchObject({ offices: [{ tag: created.tag, name: '알림팀' }] });
  });

  it('getOfficeCode answers only the asking loopback socket', async () => {
    const created = lan.createOffice('팀') as CreatedOffice;
    const a = await open('localhost');
    const b = await open('localhost');
    let bGot = false;
    b.on('message', (d: Buffer) => {
      if (d.toString().includes(created.code)) bGot = true;
    });
    const code = waitForMessage(a, 'officeCode');
    a.send(JSON.stringify({ type: 'getOfficeCode', tag: created.tag }));
    expect(await code).toEqual({ type: 'officeCode', tag: created.tag, code: created.code });
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    expect(bGot).toBe(false);
  });
});

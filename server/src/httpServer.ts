import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';

import type {
  AssetCache,
  ClientMessageContext,
  ReloadAssetsSideEffect,
} from './clientMessageHandler.js';
import {
  handleClientMessage,
  layoutMessage,
  officesMessage,
  profileMessage,
  snapshotMessage,
} from './clientMessageHandler.js';
import {
  LOOPBACK_ADDRESSES,
  LOOPBACK_HOSTNAMES,
  PING_APP,
  SNAPSHOT_INTERVAL_MS,
  WS_CLOSE_FORBIDDEN,
} from './constants.js';
import type { FileStateAdapter } from './fileStateAdapter.js';
import type { LanService } from './lan/office.js';
import type { Updater } from './lan/updater.js';
import { APP_VERSION } from './lan/updater.js';

/** Options for creating the HTTP + WebSocket server. */
export interface HttpServerOptions {
  /** Host to bind to. Default: '127.0.0.1' */
  host?: string;
  /** Port to listen on. Default: 0 (auto-assign) */
  port?: number;
  /** Persisted user settings. */
  adapter: FileStateAdapter;
  /** Path to SPA dist directory for static serving */
  staticDir?: string;
  /** Cached assets loaded at startup */
  assetCache?: AssetCache;
  /** Invoked when an external asset directory is added/removed. */
  onReloadAssets?: ReloadAssetsSideEffect;
  /** Request logging. Default true; tests turn it off. */
  logger?: boolean;
  /** LAN office: officeSnapshot every second, profile messages. */
  lan?: LanService;
  /** `POST /api/quit` from this PC: shut everything down. */
  onQuit?: () => void;
  /** Settings → 완전 종료 (`quitApp`): quit without the updater's reopen marker. */
  onQuitApp?: () => void;
  /** Update check/install; its messages go to every (loopback) socket. */
  updater?: Updater;
  /** Start at login. */
  autostart?: ClientMessageContext['autostart'];
}

/** Result of createHttpServer(). */
export interface HttpServerHandle {
  app: FastifyInstance;
  port: number;
  /** Close every UI socket with this code (app quit). */
  closeClients: (code: number) => void;
}

/** The parts of a request isLoopback reads (a FastifyRequest satisfies it). */
export interface LoopbackRequest {
  socket: { remoteAddress?: string };
  headers: { host?: string; origin?: string };
}

const startTime = Date.now();

/** Host part of a Host header or URL authority ("localhost:47801" -> "localhost",
 *  "[::1]:47801" -> "[::1]"), lower-cased; null when unparseable. */
function hostnameOf(authority: string | undefined): string | null {
  if (!authority) return null;
  try {
    return new URL(`http://${authority}`).hostname;
  } catch {
    return null;
  }
}

/** Origin's host:port, or null when the Origin is not a parseable URL. */
function originHost(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

/**
 * Whether a connection comes from a browser on THIS machine, and so may change
 * things (save layout, settings). All three must hold:
 * - the peer address is loopback,
 * - the Host header names a loopback host (defeats DNS rebinding: a rebound
 *   page sends its own name as Host),
 * - the Origin, when present, is the same host (defeats another local site
 *   opening a socket to us).
 */
export function isLoopback(req: LoopbackRequest): boolean {
  const addr = req.socket.remoteAddress ?? '';
  if (!(LOOPBACK_ADDRESSES as readonly string[]).includes(addr)) return false;
  const hostname = hostnameOf(req.headers.host);
  if (hostname === null || !(LOOPBACK_HOSTNAMES as readonly string[]).includes(hostname)) {
    return false;
  }
  const { origin } = req.headers;
  return origin === undefined || originHost(origin) === req.headers.host?.toLowerCase();
}

/**
 * Create a Fastify server with health check, SPA serving and WebSocket support.
 *
 * All Fastify-specific code lives in this file.
 */
export async function createHttpServer(options: HttpServerOptions): Promise<HttpServerHandle> {
  const app = Fastify({ logger: options.logger ?? true });

  await app.register(fastifyWebsocket);

  const { lan } = options;
  // The UI is for this PC's browser only. Defence in depth behind the 127.0.0.1
  // bind: anything else gets 403 (/ws closes with WS_CLOSE_FORBIDDEN instead).
  app.addHook('onRequest', async (request, reply) => {
    if (request.url.split('?')[0] === '/ws' || isLoopback(request)) return;
    return reply.code(403).send({ error: 'forbidden' });
  });

  if (options.staticDir) {
    await app.register(fastifyStatic, {
      root: options.staticDir,
      prefix: '/',
    });
    // HTML5 history fallback: serve index.html for unmatched routes
    app.setNotFoundHandler((_req, reply) => {
      reply.sendFile('index.html');
    });
  }

  app.get('/api/health', async () => ({
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    pid: process.pid,
  }));

  // Single-instance probe (cli.checkExisting probes 127.0.0.1).
  app.get('/api/ping', async () => ({ app: PING_APP }));

  // Used by the uninstaller (loopback only, like every route).
  app.post('/api/quit', async () => {
    options.onQuit?.(); // the caller delays the exit so this reply goes out first
    return { ok: true };
  });

  const clients = new Set<WsLike>();
  if (lan) {
    // A team joined without a name learns it when a member announces it: re-send then.
    let lastOffices = JSON.stringify(officesMessage(lan));
    const timer = setInterval(() => {
      const offices = JSON.stringify(officesMessage(lan));
      const officesChanged = offices !== lastOffices;
      lastOffices = offices;
      for (const c of clients) {
        if (officesChanged) safeSend(c, officesMessage(lan));
        try {
          safeSend(c, snapshotMessage(lan));
        } catch (err) {
          console.error('[Pixel Office] officeSnapshot failed:', err);
        }
      }
    }, SNAPSHOT_INTERVAL_MS);
    app.addHook('onClose', async () => clearInterval(timer));
  }
  const onProfileSaved = (): void => {
    if (!lan) return;
    for (const c of clients) safeSend(c, profileMessage(lan, true));
  };

  const onOfficesChanged = (layoutChanged: boolean): void => {
    if (!lan) return;
    // Personal mode on/off: its own layout first, so the page refits to it on officesState.
    const layout = layoutChanged ? layoutMessage(options.assetCache ?? null, lan) : null;
    for (const c of clients) {
      if (layout) safeSend(c, layout);
      safeSend(c, officesMessage(lan));
      safeSend(c, snapshotMessage(lan)); // the switched office now, not on the next tick
    }
  };

  const { updater } = options;
  if (updater) {
    updater.broadcast = (msg) => {
      for (const c of clients) safeSend(c, msg);
    };
    updater.uiConnected = () => clients.size > 0;
  }

  app.get('/ws', { websocket: true }, (socket, request) => {
    // Another PC, a foreign Host (DNS rebinding) or a cross-origin page.
    const privileged = isLoopback(request);
    if (!privileged) {
      socket.close(WS_CLOSE_FORBIDDEN, 'forbidden');
      return;
    }
    clients.add(socket);
    socket.on('close', () => clients.delete(socket));
    // Every connection learns the server version at once, a reconnect too (no new
    // handshake): a page left open across an update reloads into the new version.
    safeSend(socket, { type: 'officeAccess', readOnly: false, version: APP_VERSION });

    socket.on('message', (data: Buffer | string) => {
      try {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        handleClientMessage(msg, (m) => safeSend(socket, m), {
          adapter: options.adapter,
          cache: options.assetCache ?? null,
          onReloadAssets: options.onReloadAssets,
          privileged, // always true here; handleClientMessage's gate stays as a safety net
          lan,
          onProfileSaved,
          onOfficesChanged,
          updater,
          autostart: options.autostart,
          onQuitApp: options.onQuitApp,
        });
      } catch {
        // Malformed JSON, ignore
      }
    });
  });

  await app.listen({ host: options.host ?? '127.0.0.1', port: options.port ?? 0 });
  const address = app.server.address();
  const port = typeof address === 'object' ? (address?.port ?? 0) : 0;

  return {
    app,
    port,
    closeClients: (code) => {
      for (const c of clients) c.close(code, 'quit');
    },
  };
}

interface WsLike {
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  readyState: number;
}

function safeSend(socket: WsLike, message: Record<string, unknown>): void {
  // WebSocket.OPEN = 1
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(message));
  }
}

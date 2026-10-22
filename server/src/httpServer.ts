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
  /** Update check/install; its messages go to privileged sockets only. */
  updater?: Updater;
  /** Start at login; only privileged sockets see or change it. */
  autostart?: ClientMessageContext['autostart'];
}

/** Result of createHttpServer(). */
export interface HttpServerHandle {
  app: FastifyInstance;
  port: number;
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
 * Connection gate for /ws: a browser handshake must come from this server's own
 * origin (WebSocket connects bypass CORS). A missing Origin is a non-browser
 * client and may watch.
 */
function isAllowedWebSocketOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (origin === undefined) return true;
  return host !== undefined && originHost(origin) === host.toLowerCase();
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
  /** Remote viewing is off: only this PC's browser is served (the ping probe excepted). */
  const remoteBlocked = (req: LoopbackRequest): boolean =>
    lan !== undefined && !lan.profile.remoteView && !isLoopback(req);
  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0];
    // /ws closes with WS_CLOSE_FORBIDDEN instead, so the page can say why
    if (path === '/api/ping' || path === '/ws' || !remoteBlocked(request)) return;
    return reply.code(403).send({ error: 'remote viewing is off' });
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

  // Single-instance probe (cli.checkExisting); harmless for anyone to read.
  app.get('/api/ping', async () => ({ app: PING_APP }));

  // Used by the uninstaller. This PC only: a LAN viewer must not stop our office.
  app.post('/api/quit', async (request, reply) => {
    if (!isLoopback(request)) return reply.code(403).send({ error: 'forbidden' });
    options.onQuit?.(); // the caller delays the exit so this reply goes out first
    return { ok: true };
  });

  const clients = new Set<{ socket: WsLike; privileged: boolean }>();
  if (lan) {
    const timer = setInterval(() => {
      for (const c of clients) {
        try {
          safeSend(c.socket, snapshotMessage(lan, c.privileged));
        } catch (err) {
          console.error('[Pixel Office] officeSnapshot failed:', err);
        }
      }
    }, SNAPSHOT_INTERVAL_MS);
    app.addHook('onClose', async () => clearInterval(timer));
  }
  const onProfileSaved = (): void => {
    if (!lan) return;
    for (const c of clients) if (c.privileged) safeSend(c.socket, profileMessage(lan, true));
  };

  const onOfficesChanged = (): void => {
    if (!lan) return;
    for (const c of clients) {
      if (c.privileged) safeSend(c.socket, officesMessage(lan));
      else if (!lan.profile.remoteView) c.socket.close(WS_CLOSE_FORBIDDEN, 'remote viewing is off');
    }
  };

  const { updater } = options;
  if (updater) {
    updater.broadcast = (msg) => {
      for (const c of clients) if (c.privileged) safeSend(c.socket, msg);
    };
  }

  app.get('/ws', { websocket: true }, (socket, request) => {
    if (!isAllowedWebSocketOrigin(request.headers.origin, request.headers.host)) {
      socket.close(WS_CLOSE_FORBIDDEN, 'forbidden origin');
      return;
    }
    if (remoteBlocked(request)) {
      socket.close(WS_CLOSE_FORBIDDEN, 'remote viewing is off');
      return;
    }
    const privileged = isLoopback(request);
    const client = { socket, privileged };
    clients.add(client);
    socket.on('close', () => clients.delete(client));

    socket.on('message', (data: Buffer | string) => {
      try {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        handleClientMessage(msg, (m) => safeSend(socket, m), {
          adapter: options.adapter,
          cache: options.assetCache ?? null,
          onReloadAssets: options.onReloadAssets,
          privileged,
          lan,
          onProfileSaved,
          onOfficesChanged,
          updater,
          autostart: options.autostart,
        });
      } catch {
        // Malformed JSON, ignore
      }
    });
  });

  await app.listen({ host: options.host ?? '127.0.0.1', port: options.port ?? 0 });
  const address = app.server.address();
  const port = typeof address === 'object' ? (address?.port ?? 0) : 0;

  return { app, port };
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

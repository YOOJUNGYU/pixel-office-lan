import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';

import type { AssetCache, ReloadAssetsSideEffect } from './clientMessageHandler.js';
import { handleClientMessage } from './clientMessageHandler.js';
import { LOOPBACK_ADDRESSES, LOOPBACK_HOSTNAMES, WS_CLOSE_FORBIDDEN_ORIGIN } from './constants.js';
import type { FileStateAdapter } from './fileStateAdapter.js';

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

  await app.register(fastifyCors, { origin: true });
  await app.register(fastifyWebsocket);

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

  app.get('/ws', { websocket: true }, (socket, request) => {
    if (!isAllowedWebSocketOrigin(request.headers.origin, request.headers.host)) {
      socket.close(WS_CLOSE_FORBIDDEN_ORIGIN, 'forbidden origin');
      return;
    }
    const privileged = isLoopback(request);

    socket.on('message', (data: Buffer | string) => {
      try {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        handleClientMessage(msg, (m) => safeSend(socket, m), {
          adapter: options.adapter,
          cache: options.assetCache ?? null,
          onReloadAssets: options.onReloadAssets,
          privileged,
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

function safeSend(
  socket: { send: (data: string) => void; readyState: number },
  message: Record<string, unknown>,
): void {
  // WebSocket.OPEN = 1
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(message));
  }
}

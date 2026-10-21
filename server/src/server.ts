import type { FastifyInstance } from 'fastify';

import type {
  AssetCache,
  ClientMessageContext,
  ReloadAssetsSideEffect,
} from './clientMessageHandler.js';
import { FileStateAdapter } from './fileStateAdapter.js';
import { createHttpServer } from './httpServer.js';
import type { LanService } from './lan/office.js';
import type { Updater } from './lan/updater.js';

/**
 * Pixel Office server: serves the SPA and streams office state over WebSocket.
 *
 * Routes (via Fastify in httpServer.ts):
 * - `GET /api/health` -- health check
 * - `GET /api/ping` -- `{app:'pixel-office'}` single-instance probe
 * - `POST /api/quit` -- shut down (this PC only)
 * - `GET /ws` -- WebSocket protocol channel (writes only from a loopback browser)
 * - `GET /*` -- the SPA
 */
export class PixelAgentsServer {
  private app: FastifyInstance | null = null;

  /** Start listening. Resolves with the bound port. */
  async start(options?: {
    host?: string;
    port?: number;
    staticDir?: string;
    assetCache?: AssetCache;
    onReloadAssets?: ReloadAssetsSideEffect;
    adapter?: FileStateAdapter;
    logger?: boolean;
    lan?: LanService;
    onQuit?: () => void;
    updater?: Updater;
    autostart?: ClientMessageContext['autostart'];
  }): Promise<{ port: number }> {
    const { app, port } = await createHttpServer({
      host: options?.host,
      port: options?.port,
      adapter: options?.adapter ?? new FileStateAdapter(),
      staticDir: options?.staticDir,
      assetCache: options?.assetCache,
      onReloadAssets: options?.onReloadAssets,
      logger: options?.logger,
      lan: options?.lan,
      onQuit: options?.onQuit,
      updater: options?.updater,
      autostart: options?.autostart,
    });
    this.app = app;
    return { port };
  }

  /** Stop the server. */
  async stop(): Promise<void> {
    await this.app?.close();
    this.app = null;
  }
}

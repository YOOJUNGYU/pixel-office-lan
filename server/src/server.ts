import type { FastifyInstance } from 'fastify';

import { WS_CLOSE_APP_QUIT } from '../../core/src/constants.js';
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
  private closeClients: ((code: number) => void) | null = null;

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
    onQuitApp?: () => void;
    updater?: Updater;
    autostart?: ClientMessageContext['autostart'];
    onWaitingPage?: () => void;
  }): Promise<{ port: number }> {
    const { app, port, closeClients } = await createHttpServer({
      host: options?.host,
      port: options?.port,
      adapter: options?.adapter ?? new FileStateAdapter(),
      staticDir: options?.staticDir,
      assetCache: options?.assetCache,
      onReloadAssets: options?.onReloadAssets,
      logger: options?.logger,
      lan: options?.lan,
      onQuit: options?.onQuit,
      onQuitApp: options?.onQuitApp,
      updater: options?.updater,
      autostart: options?.autostart,
      onWaitingPage: options?.onWaitingPage,
    });
    this.app = app;
    this.closeClients = closeClients;
    return { port };
  }

  /** Stop the server. `quit`: the user quit the app — pages get WS_CLOSE_APP_QUIT and stop reconnecting. */
  async stop(quit = false): Promise<void> {
    if (quit) this.closeClients?.(WS_CLOSE_APP_QUIT);
    await this.app?.close();
    this.app = null;
  }
}

#!/usr/bin/env node

/**
 * Standalone CLI entry point.
 *
 * Starts the Fastify server with SPA serving and WebSocket. Loads all assets
 * (PNGs -> SpriteData) on startup and caches them in memory. Each connecting
 * WebSocket client receives the full state on webviewReady.
 */

import { spawn } from 'child_process';
import * as path from 'path';

import { LAN_HTTP_PORT, LAN_UDP_PORT } from '../../core/src/lan.js';
import {
  buildAssetCache,
  loadAllCharacters,
  loadAllFurniture,
  loadAllPets,
} from './assetReload.js';
import type { AssetCache, ReloadAssetsSideEffect } from './clientMessageHandler.js';
import { readConfig } from './configPersistence.js';
import { MAX_PORT, MIN_PORT, QUIT_DELAY_MS } from './constants.js';
import { checkExisting, LanService } from './lan/office.js';
import { PeerNet } from './lan/peerNet.js';
import { loadProfile } from './lan/profile.js';
import { discoverRoots, Scanner } from './lan/scanner.js';
import { PixelAgentsServer } from './server.js';

// ── Argument parsing ──────────────────────────────────────────

export interface CliArgs {
  port: number;
  host: string;
  /** Open the office in the default browser once it is up. */
  open: boolean;
}

/** Thrown by parseArgs on an invalid --port. Kept separate from process.exit so
 *  the parsing logic stays a pure, unit-testable function. */
export class CliArgsError extends Error {}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { host: '0.0.0.0', port: LAN_HTTP_PORT, open: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port' || argv[i] === '-p') {
      const raw = argv[i + 1];
      if (raw === undefined) {
        throw new CliArgsError(
          `Missing value for ${argv[i]}: expected an integer between ${MIN_PORT} and ${MAX_PORT}.`,
        );
      }
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < MIN_PORT || parsed > MAX_PORT) {
        throw new CliArgsError(
          `Invalid --port "${raw}": must be an integer between ${MIN_PORT} and ${MAX_PORT}.`,
        );
      }
      args.port = parsed;
      i++;
    } else if (argv[i] === '--host' && argv[i + 1]) {
      args.host = argv[i + 1];
      i++;
    } else if (argv[i] === '--open') {
      args.open = true;
    } else if (argv[i] === '--help') {
      console.log(`Usage: pixel-office [options]

Options:
  --port, -p <number>   Port to listen on (default: ${LAN_HTTP_PORT})
  --host <string>       Host to bind to (default: 0.0.0.0)
  --open                Open the office in the default browser
  --help                Show this help message`);
      process.exit(0);
    }
  }
  return args;
}

/** Best effort: a missing browser launcher must not take the server down. */
function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]] // '' -> "" (window title), as start expects
      : [process.platform === 'darwin' ? 'open' : 'xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // ignore
  }
}

// ── Main ──────────────────────────────────────────────────────

async function main(): Promise<void> {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`[Pixel Office] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  // One office per PC: a second launch just (re)opens the browser.
  const localUrl = `http://localhost:${args.port.toString()}`;
  if (await checkExisting(args.port)) {
    console.log(`[Pixel Office] 이미 실행 중입니다: ${localUrl}`);
    if (args.open) openBrowser(localUrl);
    process.exit(0);
  }

  // dist/ contains both the CLI bundle and the assets/ + webview/ directories
  const distRoot = __dirname;
  const staticDir = path.join(distRoot, 'webview');

  // External asset directories are merged at startup too, so directories added
  // in a previous session survive a restart.
  console.log('[Pixel Office] Loading assets...');
  const assetCache: AssetCache = await buildAssetCache(
    distRoot,
    readConfig().externalAssetDirectories,
  );
  const charCount = assetCache.characters?.characters.length ?? 0;
  const petCount = assetCache.pets?.pets.length ?? 0;
  const furnitureCount = assetCache.furniture?.catalog.length ?? 0;
  console.log(
    `[Pixel Office] Assets loaded: ${charCount} characters, ${petCount} pets, ${furnitureCount} furniture items`,
  );

  const server = new PixelAgentsServer();

  // LAN: local transcripts -> UDP peers; peers -> officeSnapshot.
  const scanner = new Scanner(await discoverRoots());
  scanner.start();
  const lan = new LanService(loadProfile(), scanner);
  const peerNet = new PeerNet({
    port: LAN_UDP_PORT,
    selfId: lan.profile.peerId,
    getPacket: () => lan.packet(),
    manualPeers: () => lan.profile.manualPeers,
  });
  try {
    await peerNet.start();
    lan.net = peerNet;
  } catch (err) {
    console.warn(
      `[Pixel Office] UDP ${LAN_UDP_PORT.toString()} 포트를 열 수 없어 다른 PC 와 연결하지 않습니다: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\nShutting down...');
    scanner.stop();
    peerNet.stop();
    await server.stop();
    process.exit(0);
  };

  // Re-run the loaders (bundled + external dirs) after an external-asset-
  // directory change, then re-send the updated sprites to the requesting
  // client. Mutates assetCache in place so open sockets and future handshakes
  // both observe the new assets. Only characters/pets/furniture can come from
  // external dirs, so only those three are reloaded.
  const onReloadAssets: ReloadAssetsSideEffect = async (send): Promise<void> => {
    const externalDirs = readConfig().externalAssetDirectories;
    const [characters, pets, furniture] = await Promise.all([
      loadAllCharacters(distRoot, externalDirs),
      loadAllPets(distRoot, externalDirs),
      loadAllFurniture(distRoot, externalDirs),
    ]);
    assetCache.characters = characters;
    assetCache.pets = pets;
    assetCache.furniture = furniture;
    if (characters) {
      send({ type: 'characterSpritesLoaded', characters: characters.characters });
    }
    if (pets) {
      send({
        type: 'petSpritesLoaded',
        pets: pets.pets,
        petNames: pets.manifests.map((m) => m.name),
      });
    }
    if (furniture) {
      send({
        type: 'furnitureAssetsLoaded',
        catalog: furniture.catalog,
        sprites: Object.fromEntries(furniture.sprites),
      });
    }
    console.log('[Pixel Office] Assets reloaded (external directory change)');
  };

  try {
    const { port } = await server.start({
      host: args.host,
      port: args.port,
      staticDir,
      assetCache,
      onReloadAssets,
      lan,
      onQuit: () => setTimeout(() => void shutdown(), QUIT_DELAY_MS),
    });

    // A wildcard bind address is a bind target, not an address you can browse to.
    const displayHost =
      args.host === '0.0.0.0' || args.host === '::' || args.host === '' ? 'localhost' : args.host;
    console.log(`\n  Pixel Office running at http://${displayHost}:${port}\n`);
    if (args.open) openBrowser(localUrl);

    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      console.error(
        `[Pixel Office] ${args.port.toString()} 포트를 다른 프로그램이 쓰고 있습니다. 그 프로그램을 끄거나 --port 로 다른 포트를 지정하세요.`,
      );
    } else {
      console.error('[Pixel Office] 서버를 시작하지 못했습니다:', err);
    }
    process.exit(1);
  }
}

// Only auto-run when executed directly (`node dist/cli.js`), not when imported
// for its exports (e.g. `parseArgs` in tests).
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

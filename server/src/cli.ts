#!/usr/bin/env node

/**
 * Standalone CLI entry point.
 *
 * Starts the Fastify server with SPA serving and WebSocket. Loads all assets
 * (PNGs -> SpriteData) on startup and caches them in memory. Each connecting
 * WebSocket client receives the full state on webviewReady.
 */

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
import {
  LAN_HTTP_HOST,
  MAX_PORT,
  MIN_PORT,
  NO_PEERS_ENV,
  OPEN_WAIT_MS,
  QUIT_DELAY_MS,
  SNAPSHOT_INTERVAL_MS,
  UDP_PORT_ENV,
  UDP_TARGETS_ENV,
  UPDATE_RESTART_EXIT_CODE,
} from './constants.js';
import { bootUpdated, reportListening, respawnSelf, restartMode } from './lan/appBundle.js';
import { openOffice } from './lan/appWindow.js';
import { applyInstallerChoice, getAutostart, setAutostart } from './lan/autostart.js';
import { Notifier } from './lan/notify.js';
import { checkExisting, LanService } from './lan/office.js';
import { PeerNet } from './lan/peerNet.js';
import { KnownPeers, loadProfile } from './lan/profile.js';
import { discoverRoots, Scanner } from './lan/scanner.js';
import { startTray, trayCheck } from './lan/tray.js';
import {
  APP_VERSION,
  checkForUpdate,
  consumeReopenMarker,
  downloadAndRun,
  stageAppUpdate,
  Updater,
  writeReopenMarker,
} from './lan/updater.js';
import { PixelAgentsServer } from './server.js';

// ── Argument parsing ──────────────────────────────────────────

export interface CliArgs {
  port: number;
  host: string;
  /** Open the office (installed app / app window / default browser) once it is up. */
  open: boolean;
  /** Installer hook: set start-at-login and exit (no server). */
  autostart?: AutostartMode;
  /** CI/support: start the tray helper once in smoke mode, exit 0 if it came up. */
  trayCheck?: boolean;
}

const AUTOSTART_MODES = ['on', 'off', 'default'] as const;
type AutostartMode = (typeof AUTOSTART_MODES)[number];

/** Thrown by parseArgs on an invalid --port. Kept separate from process.exit so
 *  the parsing logic stays a pure, unit-testable function. */
export class CliArgsError extends Error {}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { host: LAN_HTTP_HOST, port: LAN_HTTP_PORT, open: false };
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
    } else if (argv[i] === '--autostart') {
      const mode = argv[i + 1];
      if (!AUTOSTART_MODES.includes(mode as AutostartMode)) {
        throw new CliArgsError(`Invalid --autostart "${mode ?? ''}": expected on, off or default.`);
      }
      args.autostart = mode as AutostartMode;
      i++;
    } else if (argv[i] === '--tray-check') {
      args.trayCheck = true;
    } else if (argv[i] === '--help') {
      console.log(`Usage: pixel-office [options]

Options:
  --port, -p <number>   Port to listen on (default: ${LAN_HTTP_PORT})
  --host <string>       Host to bind to (default: ${LAN_HTTP_HOST}; the UI only serves this PC's browser)
  --open                Open the office (installed app or app window on Windows)
  --autostart <mode>    Set start at login (on|off|default) and exit — used by the installer
  --tray-check          Start the tray icon helper once (smoke test) and exit 0 if it works
  --help                Show this help message`);
      process.exit(0);
    }
  }
  return args;
}

// ── Main ──────────────────────────────────────────────────────

/**
 * `boot` = this is the installed cli.js: first hand over to a newer silently
 * updated version in ~/.pixel-office/app (bootUpdated), which runs main(false).
 */
export async function main(boot = true): Promise<void> {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`[Pixel Office] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  if (args.autostart) {
    const state = await applyInstallerChoice(args.autostart);
    console.log(`[Pixel Office] start at login: ${JSON.stringify(state)}`);
    process.exit(0);
  }

  if (args.trayCheck) {
    const ok = await trayCheck();
    console.log(`[Pixel Office] tray helper: ${ok ? 'ready' : 'FAILED'}`);
    process.exit(ok ? 0 : 1);
  }

  if (boot && bootUpdated(APP_VERSION)) return;

  // One office per PC: a second launch just (re)opens the browser.
  // Trailing '/': also the PWA manifest id, from which the installed app's id is derived.
  const localUrl = `http://localhost:${args.port.toString()}/`;
  if (await checkExisting(args.port)) {
    console.log(`[Pixel Office] 이미 실행 중입니다: ${localUrl}`);
    if (args.open) openOffice(localUrl);
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
  const scanner = new Scanner(() => discoverRoots());
  scanner.start();
  const lan = new LanService(loadProfile(), scanner);
  const pins = new KnownPeers();
  const udpPort = Number(process.env[UDP_PORT_ENV]) || LAN_UDP_PORT;
  const udpTargets = process.env[UDP_TARGETS_ENV]?.split(',').filter(Boolean);
  const peerNet = new PeerNet({
    port: udpPort,
    ...(udpTargets?.length && { targets: () => udpTargets }),
    identity: { id: lan.profile.peerId, ...lan.profile.identity },
    getPacket: (channel) => lan.packet(channel),
    manualPeers: () => lan.profile.manualPeers,
    offices: () => lan.teamChannels(),
    offline: () => lan.personal,
    onAvatar: () => lan.peerMoved(),
    pins,
  });
  try {
    if (process.env[NO_PEERS_ENV] !== '1') {
      await peerNet.start();
      lan.net = peerNet;
    }
  } catch (err) {
    console.warn(
      `[Pixel Office] UDP ${udpPort.toString()} 포트를 열 수 없어 다른 PC 와 연결하지 않습니다: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let shuttingDown = false;
  /** Quit and come back as the silently updated version (appBundle.restartMode). */
  const restartIntoUpdate = (): boolean => {
    const mode = restartMode();
    if (mode === 'none') return false;
    void shutdown(false, mode);
    return true;
  };
  const updater = new Updater(APP_VERSION, {
    check: (c) => checkForUpdate(c),
    install: downloadAndRun,
    markReopen: () => writeReopenMarker(),
    stage: (v, app) => stageAppUpdate(v, app),
    restart: restartIntoUpdate,
  });

  /** `quit` = the user quit the app (tray, Settings): open pages stop reconnecting. */
  const shutdown = async (quit = false, restart?: 'launchd' | 'respawn'): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\nShutting down...');
    scanner.stop();
    peerNet.stop();
    pins.flush();
    updater.stop();
    await server.stop(quit);
    // An update restart: our ports are free now. launchd respawns a non-zero exit;
    // elsewhere the installed cli.js is started again (it boots the new version).
    if (restart === 'respawn') respawnSelf();
    if (restart === 'launchd') process.exit(UPDATE_RESTART_EXIT_CODE);
    // Exit 0 = clean: the macOS LaunchAgent (KeepAlive SuccessfulExit=false) does not respawn.
    process.exit(0);
  };
  // Tray / Settings → 완전 종료. Never the updater's reopen marker (that is /api/quit only).
  const quitApp = (): void => void shutdown(true);

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
        petIds: pets.manifests.map((m) => m.id),
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

  let pageWaiting = false;
  try {
    const { port } = await server.start({
      host: args.host,
      port: args.port,
      staticDir,
      assetCache,
      onReloadAssets,
      lan,
      onQuit: () => {
        updater.onQuit();
        setTimeout(() => void shutdown(), QUIT_DELAY_MS);
      },
      onQuitApp: quitApp,
      onWaitingPage: () => {
        pageWaiting = true;
      },
      updater,
      autostart: { get: () => getAutostart(), set: (on) => setAutostart(on) },
    });
    reportListening();
    updater.start();
    // After an in-app update no window is opened: an open one reconnects and reloads
    // itself into the new version, and a closed one was closed on purpose.
    const afterUpdate = consumeReopenMarker();
    // A wildcard bind address is a bind target, not an address you can browse to.
    const displayHost =
      args.host === '0.0.0.0' || args.host === '::' || args.host === '' ? 'localhost' : args.host;
    console.log(`\n  Pixel Office running at http://${displayHost}:${port}\n`);
    if (!afterUpdate && args.open) {
      // Started from the page's [시작] (pixeloffice://start → the Mac app runs --open): that page
      // polls /api/health?waiting and reloads into the office, so don't open a second window.
      setTimeout(() => {
        if (!pageWaiting) openOffice(localUrl);
      }, OPEN_WAIT_MS);
    }
    // Only the instance that owns the server gets here (a second launch exited above).
    const tray = startTray({ onOpen: () => openOffice(localUrl), onQuit: quitApp });
    // OS notifications (join/leave, my agents): decided here, so no window needs to be open.
    const notifier = new Notifier(
      {
        view: () => lan.profile.activeView,
        people: (view) => lan.people(view),
        local: scanner,
        settings: () => {
          const s = readConfig().standalone;
          return { presence: s.notifyPresence, agents: s.notifyAgents };
        },
      },
      tray,
    );
    setInterval(() => {
      try {
        notifier.tick();
      } catch (err) {
        console.error('[Pixel Office] notification tick failed:', err);
      }
    }, SNAPSHOT_INTERVAL_MS).unref();

    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      console.error(
        `[Pixel Office] ${args.port.toString()} 포트를 다른 프로그램이 쓰고 있습니다. 그 프로그램을 끄거나 --port 로 다른 포트를 지정하세요.`,
      );
      // Not a crash: exit 0 so the macOS LaunchAgent (KeepAlive SuccessfulExit=false)
      // does not respawn into the same busy port every 10 s.
      process.exit(0);
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

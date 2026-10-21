import type { LoadedAssets, LoadedCharacterSprites, LoadedPetSprites } from './assetLoader.js';
import { readConfig, writeConfig } from './configPersistence.js';
import type { FileStateAdapter } from './fileStateAdapter.js';
import { readLayoutFromFile, writeLayoutToFile } from './layoutPersistence.js';

type WsSend = (message: Record<string, unknown>) => void;

/**
 * Reload server-side assets after an external-asset-directory change and
 * re-broadcast the updated sprites to the requesting client. Provided by cli.ts,
 * which owns the dist root needed to re-run the loaders.
 */
export type ReloadAssetsSideEffect = (send: WsSend) => Promise<void> | void;

/** Cached assets loaded at server startup. Sent to each WebSocket client on webviewReady. */
export interface AssetCache {
  characters: LoadedCharacterSprites | null;
  pets: LoadedPetSprites | null;
  floorTiles: string[][][] | null;
  wallTiles: string[][][][] | null;
  carpetTiles: string[][][][] | null;
  furniture: LoadedAssets | null;
  defaultLayout: Record<string, unknown> | null;
}

export interface ClientMessageContext {
  adapter: FileStateAdapter;
  cache: AssetCache | null;
  /** Reload assets after an external-asset-directory change. Needs the dist root, known only to cli.ts. */
  onReloadAssets?: ReloadAssetsSideEffect;
  /**
   * Whether this client may change ANYTHING (httpServer.isLoopback). An
   * unprivileged client is read-only: it may load and watch the office
   * (`webviewReady`) and every other message is refused at the top of
   * handleClientMessage. Defaults to false so a caller that forgets to pass it
   * gets the safe answer.
   */
  privileged?: boolean;
}

// ── Setting keys ──
const KEY_SOUND_ENABLED = 'pixel-agents.soundEnabled';
const KEY_LAST_SEEN_VERSION = 'pixel-agents.lastSeenVersion';
const KEY_ALWAYS_SHOW_LABELS = 'pixel-agents.alwaysShowLabels';
const KEY_SHOW_AREAS = 'pixel-agents.showAreas';

/**
 * Handle an incoming ClientMessage from a WebSocket client. The server is the
 * authority for assets, layout and settings; each connecting client receives
 * the full state on webviewReady.
 */
export function handleClientMessage(
  msg: Record<string, unknown>,
  send: WsSend,
  ctx: ClientMessageContext,
): void {
  const { adapter } = ctx;

  // Non-loopback is read-only. Refused HERE, once, rather than per message, so
  // a message type added later is privileged by default.
  if (!ctx.privileged && msg.type !== 'webviewReady') {
    refuseReadOnly(msg, send, ctx);
    return;
  }

  switch (msg.type) {
    case 'webviewReady':
      handleWebviewReady(send, ctx);
      break;

    case 'saveLayout':
      if (msg.layout) {
        writeLayoutToFile(msg.layout as Record<string, unknown>);
      }
      break;

    case 'setSoundEnabled':
      adapter.setSetting(KEY_SOUND_ENABLED, msg.enabled);
      break;

    case 'setLastSeenVersion':
      adapter.setSetting(KEY_LAST_SEEN_VERSION, msg.version as string);
      break;

    case 'setAlwaysShowLabels':
      adapter.setSetting(KEY_ALWAYS_SHOW_LABELS, msg.enabled);
      break;

    case 'setShowAreas':
      adapter.setSetting(KEY_SHOW_AREAS, msg.enabled as boolean);
      break;

    case 'addExternalAssetDirectory': {
      const newPath = msg.path as string | undefined;
      if (!newPath) break;
      const cfg = readConfig();
      if (!cfg.externalAssetDirectories.includes(newPath)) {
        cfg.externalAssetDirectories.push(newPath);
        writeConfig(cfg);
      }
      send({ type: 'externalAssetDirectoriesUpdated', dirs: cfg.externalAssetDirectories });
      void ctx.onReloadAssets?.(send);
      break;
    }

    case 'removeExternalAssetDirectory': {
      const removePath = msg.path as string | undefined;
      if (!removePath) break;
      const cfg = readConfig();
      cfg.externalAssetDirectories = cfg.externalAssetDirectories.filter((d) => d !== removePath);
      writeConfig(cfg);
      send({ type: 'externalAssetDirectoriesUpdated', dirs: cfg.externalAssetDirectories });
      void ctx.onReloadAssets?.(send);
      break;
    }

    case 'saveAreaMappings': {
      const rawMappings = msg.mappings;
      if (!rawMappings || typeof rawMappings !== 'object') break;
      const cfg = readConfig();
      cfg.standalone.areaMappings = rawMappings as Record<string, string[]>;
      writeConfig(cfg);
      break;
    }

    default:
      break;
  }
}

function handleWebviewReady(send: WsSend, ctx: ClientMessageContext): void {
  const { cache } = ctx;

  // 0. Access, first: a read-only office hides every control that would send
  // a change (all refused by refuseReadOnly), so it must know before it draws them.
  send({ type: 'officeAccess', readOnly: ctx.privileged !== true });

  // 1. Assets (from server cache, loaded at startup via pngjs)
  if (cache) {
    if (cache.characters) {
      send({ type: 'characterSpritesLoaded', characters: cache.characters.characters });
    }
    if (cache.pets) {
      send({
        type: 'petSpritesLoaded',
        pets: cache.pets.pets,
        petNames: cache.pets.manifests.map((m) => m.name),
      });
    }
    if (cache.floorTiles) {
      send({ type: 'floorTilesLoaded', sprites: cache.floorTiles });
    }
    if (cache.wallTiles) {
      send({ type: 'wallTilesLoaded', sets: cache.wallTiles });
    }
    if (cache.carpetTiles) {
      send({ type: 'carpetTilesLoaded', sets: cache.carpetTiles });
    }
    if (cache.furniture) {
      send({
        type: 'furnitureAssetsLoaded',
        catalog: cache.furniture.catalog,
        sprites: Object.fromEntries(cache.furniture.sprites),
      });
    }
  }

  // 2. Settings
  send(settingsSnapshot(ctx.adapter));

  // 3. Directory→Area mappings
  send({ type: 'areaMappingsLoaded', mappings: readConfig().standalone.areaMappings ?? {} });

  // 4. Layout last: the webview builds the office once it arrives.
  const savedLayout = readLayoutFromFile();
  send({ type: 'layoutLoaded', layout: savedLayout ?? cache?.defaultLayout ?? null });
}

/**
 * The settingsLoaded snapshot: sent on connect, and re-sent to a read-only
 * client whose setting change was refused, so its optimistic toggle snaps back.
 */
function settingsSnapshot(adapter: FileStateAdapter) {
  return {
    type: 'settingsLoaded',
    soundEnabled: adapter.getSetting(KEY_SOUND_ENABLED, true),
    lastSeenVersion: adapter.getSetting(KEY_LAST_SEEN_VERSION, ''),
    extensionVersion: process.env.PIXEL_AGENTS_VERSION ?? '',
    alwaysShowLabels: adapter.getSetting(KEY_ALWAYS_SHOW_LABELS, false),
    externalAssetDirectories: readConfig().externalAssetDirectories,
    showAreas: adapter.getSetting(KEY_SHOW_AREAS, false),
  } as const;
}

/** Message types already reported as refused, so a read-only client that keeps
 *  sending logs once per type, not per message. */
const reportedRefusals = new Set<string>();

/**
 * Drop a message from a read-only (non-loopback) client. Where the UI changes
 * optimistically before the server answers, the refused client is re-sent the
 * real state so the control snaps back.
 */
function refuseReadOnly(
  msg: Record<string, unknown>,
  send: WsSend,
  ctx: ClientMessageContext,
): void {
  const type = String(msg.type);
  if (!reportedRefusals.has(type)) {
    reportedRefusals.add(type);
    console.warn(
      `[Pixel Office] Ignoring ${type} from a read-only client. Changes are only accepted from http://localhost on this PC.`,
    );
  }
  switch (msg.type) {
    case 'setSoundEnabled':
    case 'setAlwaysShowLabels':
    case 'setShowAreas':
      send(settingsSnapshot(ctx.adapter));
      return;
    case 'addExternalAssetDirectory':
    case 'removeExternalAssetDirectory':
      send({
        type: 'externalAssetDirectoriesUpdated',
        dirs: readConfig().externalAssetDirectories,
      });
      return;
    case 'saveAreaMappings':
      send({ type: 'areaMappingsLoaded', mappings: readConfig().standalone.areaMappings ?? {} });
      return;
  }
}

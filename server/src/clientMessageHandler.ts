import type { ClientMessage, OfficeErrorReason } from '../../core/src/messages.js';
import type { LoadedAssets, LoadedCharacterSprites, LoadedPetSprites } from './assetLoader.js';
import { readConfig, writeConfig } from './configPersistence.js';
import type { FileStateAdapter } from './fileStateAdapter.js';
import type { AutostartState } from './lan/autostart.js';
import type { LanService } from './lan/office.js';
import { validateProfileUpdate } from './lan/profile.js';
import type { Updater } from './lan/updater.js';
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
   * Whether this client may change ANYTHING (httpServer.isLoopback). The HTTP
   * server only accepts loopback sockets, so this is a safety net: an
   * unprivileged client is read-only — it may load the office (`webviewReady`)
   * and every other message is refused at the top of handleClientMessage.
   * Defaults to false so a caller that forgets to pass it gets the safe answer.
   */
  privileged?: boolean;
  /** LAN office (profile + agents). Absent in tests that only exercise layout/settings. */
  lan?: LanService;
  /** After a successful saveProfile: re-send profileLoaded to every privileged client. */
  onProfileSaved?: () => void;
  /** After an office change: officesState + a fresh snapshot to every client. */
  onOfficesChanged?: () => void;
  /** GitHub Releases update check/install. Absent in tests. */
  updater?: Updater;
  /** Start at login (lan/autostart.ts). Absent in tests that don't exercise it. */
  autostart?: {
    get(): AutostartState;
    set(enabled: boolean): Promise<AutostartState>;
  };
}

// ── Setting keys ──
const KEY_SOUND_ENABLED = 'pixel-agents.soundEnabled';
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

  // Safety net: non-loopback is read-only. Refused HERE, once, rather than per message, so
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

    case 'saveProfile': {
      if (!ctx.lan) break;
      const update = validateProfileUpdate(msg.profile);
      if (!update) {
        send(profileMessage(ctx.lan, true));
        break;
      }
      try {
        ctx.lan.saveProfile(update);
      } catch (err) {
        console.error('[Pixel Office] Failed to save profile:', err);
        send(profileMessage(ctx.lan, true));
        break;
      }
      ctx.onProfileSaved?.();
      break;
    }

    case 'createOffice':
    case 'joinOffice':
    case 'leaveOffice':
    case 'setActiveView':
      if (ctx.lan) handleOfficeChange(msg, send, ctx.lan, ctx.onOfficesChanged);
      break;

    case 'getOfficeCode': {
      const code = ctx.lan?.officeCode(msg.tag);
      if (code) send({ type: 'officeCode', tag: msg.tag as string, code });
      break;
    }

    // Results reach privileged sockets via updater.broadcast.
    case 'installUpdate':
      void ctx.updater?.install();
      break;

    case 'checkUpdate':
      void ctx.updater?.check(true);
      break;

    case 'setAutostart': {
      const autostart = ctx.autostart;
      if (!autostart || typeof msg.enabled !== 'boolean') break;
      void autostart.set(msg.enabled).then((state) => send(autostartMessage(state)));
      break;
    }

    default:
      break;
  }
}

/** Office messages: a refused one re-sends the true state to the sender only. */
function handleOfficeChange(
  msg: Record<string, unknown>,
  send: WsSend,
  lan: LanService,
  onChanged?: () => void,
): void {
  let ok = false;
  try {
    switch (msg.type) {
      case 'createOffice': {
        const created = lan.createOffice(msg.name);
        if (typeof created === 'string') send(officeError(created));
        else send({ type: 'officeCreated', ...created }); // the code goes to this socket only
        ok = typeof created !== 'string';
        break;
      }
      case 'joinOffice': {
        const err = lan.joinOffice(msg.code, msg.name);
        if (err) send(officeError(err));
        ok = err === null || err === 'alreadyJoined'; // alreadyJoined switched the view
        break;
      }
      case 'leaveOffice':
        ok = lan.leaveOffice(msg.tag);
        break;
      case 'setActiveView':
        ok = lan.setActiveView(msg.view);
        break;
    }
  } catch (err) {
    console.error('[Pixel Office] Failed to save offices:', err);
  }
  if (ok) onChanged?.();
  else send(officesMessage(lan));
}

const officeError = (reason: OfficeErrorReason) => ({ type: 'officeError', reason }) as const;

/** officesState: names only, never secrets or codes. Privileged clients only. */
export function officesMessage(lan: LanService) {
  return {
    type: 'officesState',
    offices: lan.officeList(),
    activeView: lan.profile.activeView,
  } as const;
}

function autostartMessage(state: AutostartState) {
  return { type: 'autostartState', ...state } as const;
}

/** profileLoaded. Manual peer IPs are LAN-internal: privileged clients only. */
export function profileMessage(lan: LanService, privileged: boolean) {
  const { nickname, palette, hueShift, hideDetails, manualPeers } = lan.profile;
  return {
    type: 'profileLoaded',
    profile: {
      nickname,
      palette,
      hueShift,
      hideDetails,
      manualPeers: privileged ? manualPeers : [],
    },
    canEdit: privileged,
  } as const;
}

/** officeSnapshot of the office this PC's browser has chosen. */
export function snapshotMessage(lan: LanService) {
  const view = lan.profile.activeView;
  return {
    type: 'officeSnapshot',
    agents: lan.office(view),
    people: lan.people(view),
    selfPeerId: lan.profile.peerId,
  } as const;
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
  send(settingsSnapshot(ctx));
  if (ctx.lan) send(profileMessage(ctx.lan, ctx.privileged === true));
  if (ctx.lan && ctx.privileged) send(officesMessage(ctx.lan));

  // 3. Directory→Area mappings
  send(areaMappingsSnapshot(ctx));

  // 4. Layout last: the webview builds the office once it arrives.
  const savedLayout = readLayoutFromFile();
  send({ type: 'layoutLoaded', layout: savedLayout ?? cache?.defaultLayout ?? null });

  // 5. Agents right away rather than on the next 1 s tick.
  if (ctx.lan && ctx.privileged) send(snapshotMessage(ctx.lan));

  // 6. Start-at-login checkbox and update banner: this PC's browser only.
  if (ctx.privileged && ctx.autostart) send(autostartMessage(ctx.autostart.get()));
  const update = ctx.privileged ? ctx.updater?.availableMessage() : null;
  if (update) {
    send(update);
    if (ctx.updater?.status) send(ctx.updater.status);
  }
}

/**
 * The settingsLoaded snapshot: sent on connect, and re-sent to a read-only
 * client whose setting change was refused, so its optimistic toggle snaps back.
 * Local paths: a read-only client (safety net) gets no asset dirs.
 */
function settingsSnapshot(ctx: ClientMessageContext) {
  const { adapter } = ctx;
  return {
    type: 'settingsLoaded',
    soundEnabled: adapter.getSetting(KEY_SOUND_ENABLED, true),
    alwaysShowLabels: adapter.getSetting(KEY_ALWAYS_SHOW_LABELS, false),
    externalAssetDirectories: externalAssetDirectoriesFor(ctx),
    showAreas: adapter.getSetting(KEY_SHOW_AREAS, false),
  } as const;
}

/** Absolute paths: only a privileged (loopback) client may see them. */
function externalAssetDirectoriesFor(ctx: ClientMessageContext): string[] {
  return ctx.privileged ? readConfig().externalAssetDirectories : [];
}

/** Area mappings are keyed by directory name: privileged clients only. */
function areaMappingsSnapshot(ctx: ClientMessageContext) {
  return {
    type: 'areaMappingsLoaded',
    mappings: ctx.privileged ? (readConfig().standalone.areaMappings ?? {}) : {},
  };
}

/** Client message types this server knows. Refusal logging buckets by these
 *  only, so untrusted input can't grow the set below or flood the log. */
const KNOWN_CLIENT_TYPES: ReadonlySet<string> = new Set<ClientMessage['type']>([
  'webviewReady',
  'saveLayout',
  'setSoundEnabled',
  'setAlwaysShowLabels',
  'addExternalAssetDirectory',
  'removeExternalAssetDirectory',
  'saveAreaMappings',
  'setShowAreas',
  'saveProfile',
  'installUpdate',
  'checkUpdate',
  'setAutostart',
  'createOffice',
  'joinOffice',
  'leaveOffice',
  'setActiveView',
  'getOfficeCode',
]);
const UNKNOWN_REFUSAL_KEY = 'unknown';

/** Refusal-log buckets already reported, so a read-only client that keeps
 *  sending logs once per known type (plus one 'unknown' bucket), not per message.
 *  @internal exported for the bounded-growth test. */
export const reportedRefusals = new Set<string>();

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
  const key =
    typeof msg.type === 'string' && KNOWN_CLIENT_TYPES.has(msg.type)
      ? msg.type
      : UNKNOWN_REFUSAL_KEY;
  if (!reportedRefusals.has(key)) {
    reportedRefusals.add(key);
    console.warn(
      `[Pixel Office] Ignoring ${key} message from a read-only client. Changes are only accepted from http://localhost on this PC.`,
    );
  }
  switch (msg.type) {
    case 'setSoundEnabled':
    case 'setAlwaysShowLabels':
    case 'setShowAreas':
      send(settingsSnapshot(ctx));
      return;
    case 'addExternalAssetDirectory':
    case 'removeExternalAssetDirectory':
      send({
        type: 'externalAssetDirectoriesUpdated',
        dirs: externalAssetDirectoriesFor(ctx),
      });
      return;
    case 'saveAreaMappings':
      send(areaMappingsSnapshot(ctx));
      return;
    case 'saveProfile':
      if (ctx.lan) send(profileMessage(ctx.lan, false));
      return;
  }
}

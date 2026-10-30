import type { ClientMessage, OfficeErrorReason } from '../../core/src/messages.js';
import type { LoadedAssets, LoadedCharacterSprites, LoadedPetSprites } from './assetLoader.js';
import { readConfig, writeConfig } from './configPersistence.js';
import type { FileStateAdapter } from './fileStateAdapter.js';
import type { AutostartState } from './lan/autostart.js';
import type { LanService } from './lan/office.js';
import { validateProfileUpdate } from './lan/profile.js';
import type { Updater } from './lan/updater.js';
import { APP_VERSION } from './lan/updater.js';
import {
  readLayoutFromFile,
  roomColorsOf,
  sanitizeLayout,
  writeLayoutToFile,
} from './layoutPersistence.js';

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
  /** Bundled personal-mode default (smaller office); absent in tests that don't need it. */
  personalLayout?: Record<string, unknown> | null;
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
  /** After an office change: officesState + a fresh snapshot to every client, and
   *  layoutLoaded first when personal mode was switched on or off (its own layout). */
  onOfficesChanged?: (layoutChanged: boolean) => void;
  /** GitHub Releases update check/install. Absent in tests. */
  updater?: Updater;
  /** Start at login (lan/autostart.ts). Absent in tests that don't exercise it. */
  autostart?: {
    get(): AutostartState;
    set(enabled: boolean): Promise<AutostartState>;
  };
  /** Settings → 완전 종료. Absent in tests. */
  onQuitApp?: () => void;
}

// ── Setting keys ──
const KEY_ALWAYS_SHOW_LABELS = 'pixel-agents.alwaysShowLabels';
const KEY_NOTIFY_PRESENCE = 'pixel-agents.notifyPresence';
const KEY_NOTIFY_AGENTS = 'pixel-agents.notifyAgents';

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

    case 'saveLayout': {
      // Personal: this PC's own file. Public/team: the shared layout of the active view,
      // a new version every PC there adopts (lan/peerNet.ts pushes it).
      const personal = ctx.lan?.personal === true;
      const def = defaultLayoutFor(ctx.cache, personal);
      const layout = sanitizeLayout(msg.layout, roomColorsOf(def), def);
      if (!layout) console.warn('[Pixel Office] Refused an invalid layout save.');
      const ok =
        layout &&
        (personal ? writeLayoutToFile(layout, true) : ctx.lan?.saveSharedLayout(layout) === true);
      send({ type: ok ? 'layoutSaved' : 'layoutSaveRejected' });
      break;
    }

    case 'setAlwaysShowLabels':
      adapter.setSetting(KEY_ALWAYS_SHOW_LABELS, msg.enabled);
      break;

    // OS notifications (lan/notify.ts reads them from config.json when it has news).
    case 'setNotifications':
      if (typeof msg.presence === 'boolean') adapter.setSetting(KEY_NOTIFY_PRESENCE, msg.presence);
      if (typeof msg.agents === 'boolean') adapter.setSetting(KEY_NOTIFY_AGENTS, msg.agents);
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

    case 'saveProfile': {
      if (!ctx.lan) break;
      const update = validateProfileUpdate(msg.profile);
      if (!update) {
        send(profileMessage(ctx.lan, true));
        break;
      }
      if (ctx.lan.nicknameTaken(update.nickname)) {
        send({ type: 'profileError', reason: 'nicknameTaken' });
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

    case 'sendChat':
    case 'deleteChat':
      if (!ctx.lan) break;
      if (msg.type === 'sendChat') ctx.lan.sendChat(msg.text);
      else ctx.lan.deleteChat();
      send(snapshotMessage(ctx.lan)); // my bubble changes now, not on the next tick
      break;

    case 'moveAvatar':
      ctx.lan?.moveAvatar(msg); // no answer: the page moved it already
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

    case 'quitApp':
      ctx.onQuitApp?.();
      break;

    default:
      break;
  }
}

/** Office messages: a refused one re-sends the true state to the sender only. */
function handleOfficeChange(
  msg: Record<string, unknown>,
  send: WsSend,
  lan: LanService,
  onChanged?: (layoutChanged: boolean) => void,
): void {
  let ok = false;
  const wasView = lan.profile.activeView;
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
  if (ok)
    onChanged?.(lan.profile.activeView !== wasView); // each office has its own layout
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
  const { nickname, palette, hueShift, pet, hideWork, manualPeers } = lan.profile;
  return {
    type: 'profileLoaded',
    profile: {
      nickname,
      palette,
      hueShift,
      ...(pet && { pet }),
      hideWork,
      manualPeers: privileged ? manualPeers : [],
    },
    canEdit: privileged,
    account: lan.account,
    firstRun: !lan.profile.setUp,
  } as const;
}

/** officeSnapshot of the office this PC's browser has chosen. */
export function snapshotMessage(lan: LanService) {
  const view = lan.profile.activeView;
  return {
    type: 'officeSnapshot',
    agents: lan.office(view),
    people: lan.people(view),
    online: lan.online(),
    selfPeerId: lan.profile.peerId,
  } as const;
}

/** The bundled default of a mode: the small personal office, else the shared one. */
function defaultLayoutFor(cache: AssetCache | null, personal: boolean) {
  return (personal ? cache?.personalLayout : cache?.defaultLayout) ?? null;
}

/** layoutLoaded for the view this PC is in: personal → its saved layout; public/team →
 *  the newest shared layout of that office (the same on every PC there); else the
 *  mode's bundled default; rooms normalized (a saved file that fails the checks is sent as is). */
export function layoutMessage(cache: AssetCache | null, lan?: LanService) {
  const personal = lan?.personal === true;
  const def = defaultLayoutFor(cache, personal);
  const raw =
    (personal ? readLayoutFromFile(true) : lan?.layouts.layout(lan.profile.activeView)) ?? def;
  const layout = raw && (sanitizeLayout(raw, roomColorsOf(def), def) ?? raw);
  return { type: 'layoutLoaded', layout } as const;
}

function handleWebviewReady(send: WsSend, ctx: ClientMessageContext): void {
  const { cache } = ctx;

  // 0. Access, first: a read-only office hides every control that would send
  // a change (all refused by refuseReadOnly), so it must know before it draws them.
  send({ type: 'officeAccess', readOnly: ctx.privileged !== true, version: APP_VERSION });

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
        petIds: cache.pets.manifests.map((m) => m.id),
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

  // 3. Layout last: the webview builds the office once it arrives.
  send(layoutMessage(cache, ctx.lan));

  // 4. Agents right away rather than on the next 1 s tick.
  if (ctx.lan && ctx.privileged) send(snapshotMessage(ctx.lan));

  // 5. Start-at-login checkbox and update banner: this PC's browser only.
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
    alwaysShowLabels: adapter.getSetting(KEY_ALWAYS_SHOW_LABELS, false),
    externalAssetDirectories: externalAssetDirectoriesFor(ctx),
    notifyPresence: adapter.getSetting(KEY_NOTIFY_PRESENCE, true),
    notifyAgents: adapter.getSetting(KEY_NOTIFY_AGENTS, true),
  } as const;
}

/** Absolute paths: only a privileged (loopback) client may see them. */
function externalAssetDirectoriesFor(ctx: ClientMessageContext): string[] {
  return ctx.privileged ? readConfig().externalAssetDirectories : [];
}

/** Client message types this server knows. Refusal logging buckets by these
 *  only, so untrusted input can't grow the set below or flood the log. */
const KNOWN_CLIENT_TYPES: ReadonlySet<string> = new Set<ClientMessage['type']>([
  'webviewReady',
  'saveLayout',
  'setAlwaysShowLabels',
  'addExternalAssetDirectory',
  'removeExternalAssetDirectory',
  'setNotifications',
  'saveProfile',
  'installUpdate',
  'checkUpdate',
  'setAutostart',
  'quitApp',
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
    case 'setAlwaysShowLabels':
    case 'setNotifications':
      send(settingsSnapshot(ctx));
      return;
    case 'addExternalAssetDirectory':
    case 'removeExternalAssetDirectory':
      send({
        type: 'externalAssetDirectoriesUpdated',
        dirs: externalAssetDirectoriesFor(ctx),
      });
      return;
    case 'saveProfile':
      if (ctx.lan) send(profileMessage(ctx.lan, false));
      return;
  }
}

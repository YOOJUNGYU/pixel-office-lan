# Pixel Office LAN — Reference

Fork of pixel-agents: a pixel-art office in the browser where coding agents on every PC of a LAN appear as characters. Standalone Node server + browser SPA only (no VS Code extension, no terminal).

LAN design and the task plan: `docs/superpowers/specs/2026-10-21-pixel-office-lan-design.md`, `docs/superpowers/plans/2026-10-21-pixel-office-lan.md`. `CONTEXT.md` is the upstream glossary (partly stale; the spec wins).

## Layering

`core/` depends on nothing; `server/` and `webview-ui/` depend only on `core/`.

```
core/
  asyncapi.yaml          WebSocket protocol contract (AsyncAPI 3.0.0) — single source of truth
  src/messages.ts        GENERATED from asyncapi.yaml (never hand-edit)
  src/transport.ts       MessageTransport interface
  src/assets/            PNG decoding + manifest helpers shared by server and webview
server/src/
  cli.ts                 Entry (dist/cli.js): --port/--host/--open, single-instance check, Scanner + PeerNet, start server
  server.ts              PixelAgentsServer.start({host, port, staticDir, assetCache}) / stop()
  httpServer.ts          Fastify: GET /api/health, /api/ping, POST /api/quit, GET /ws (+1 s officeSnapshot), SPA static — all loopback only; isLoopback(req)
  lan/office.ts          buildOffice, checkExisting (single instance), LanService (profile + scanner + peers + team offices; office(view) snapshot)
  lan/peerNet.ts         UDP v2: plaintext hello + encrypted pairwise pub (public office) / encrypted team broadcast; TOFU pins, per-channel seq replay guard; every datagram ≤ 1200 B (split presence)
  lan/crypto.ts          X25519 identity, HKDF pair/team keys, AES-256-GCM seal/open, invite codes (PO2-…), parseWire
  lan/updater.ts         GitHub Releases check (once, right after the server listens; then only Settings → 업데이트 확인), installer download to ~/.pixel-office/updates + launch (loopback only)
  lan/appWindow.ts       `--open`: Windows → installed PWA (`--app-id`, Chromium id = double SHA-256 of manifest id `http://localhost:<port>/`) in Edge/Chrome, else a normal `--new-window` (the install popup is hidden in `--app=` windows), else default browser
  lan/autostart.ts       Per-user start at login (Win Startup .lnk via PowerShell, Mac LaunchAgent plist copy); Settings toggle + `cli.js --autostart on|off|default` (installer)
  clientMessageHandler.ts  ClientMessage dispatch + webviewReady handshake + read-only gate
  assetLoader.ts / assetReload.ts   PNG → SpriteData, external asset directories
  layoutPersistence.ts   ~/.pixel-office/layout.json (atomic tmp+rename)
  configPersistence.ts   ~/.pixel-office/config.json { standalone: settings, externalAssetDirectories }
  fileStateAdapter.ts    get/setSetting over config.json
  constants.ts           Server constants (data dir, loopback names, ports)
webview-ui/src/          React 19 + Canvas office
  App.tsx                Composition root (canvas, editor, settings)
  hooks/useExtensionMessages.ts   ServerMessage → OfficeState / React state
  transport/             WebSocketTransport (reconnect with backoff)
  office/                engine (officeState, renderer, characters), editor, layout, sprites
  constants.ts           ALL webview magic numbers and colors
  pwa.ts                 Service worker registration (`sw.js?v=<version>`) + install-popup state (lan/InstallPrompt.tsx, pure lan/installMode.ts)
webview-ui/public/sw.js  Navigations network-first, other same-origin GETs cache-first; never /ws or /api/*; cache per app version
webview-ui/public/manifest.webmanifest  `id: "/"` — changing it changes the installed app id the launcher looks for
```

## Removed from upstream (Task 1)

VS Code adapter, PTY/xterm terminal, hook providers + consent flow, JSONL transcript watching, agent runtime/store, directories/launch drawer, mobile terminal shell, server token, server registry (`server.json`), e2e suite, Allure/Vercel, npm/vsix publishing. Agent detection is rebuilt by the LAN reporter (Tasks 2–9). Upstream ADRs, design/research notes, CHANGELOG and CONTRIBUTING were deleted (Task 15).

## Handshake (`webviewReady`)

`officeAccess {readOnly}` (always false in practice; safety net) → asset messages (characters, pets, floor, walls, carpets, furniture) → `settingsLoaded` → `profileLoaded {profile, canEdit, account, firstRun}` → `officesState` (names, never secrets/codes) → `layoutLoaded` (saved layout, else bundled default; rooms normalized) → first `officeSnapshot` → `autostartState` → `updateAvailable` (when known). Privileged-only parts are skipped for a read-only ctx. After that `officeSnapshot {agents, people, selfPeerId}` (`people` = every PC live in that office, agents or not, self first — the right-edge people panel, `webview-ui/src/lan/PeoplePanel.tsx` + pure `peopleModel.ts`) is pushed every second to every socket (this PC's agents verbatim; `hideDetails` only redacts what goes to peers). Names: `PeerInfo`/`people` carry `account` (always shown) + optional `nickname`, label `account (nickname)` (`webview-ui/src/lan/nicknames.ts`; a 0.3.x peer without `account` gets its nickname or short id as account and an empty nickname). Nicknames are unique per visible channel: `saveProfile` with one another live visible peer uses (`nicknameKey`: NFC, trim, case/whitespace-insensitive) → `profileError {nicknameTaken}` + unchanged `profileLoaded`; collisions that slip through are tie-broken per viewer: whoever set the nickname first keeps it (`profile.nicknameSince` → `PeerInfo.nickSince`, missing = loses; then smaller peerId), others get ` · <4 id chars>` on the nickname; identical labels suffix the account; a nickname equal to the account is not repeated in the label. The loser sees a rename notice once per clashing nickname (localStorage). Received nicknames are stripped of control/bidi/format chars. Character: `palette` 0–5 (human) + `hueShift`, and optionally `pet` (`claudio`|`gitcat`, `PET_IDS` in `core/src/lan.ts`; unknown ids are dropped by `parsePeerPacket`/`validateProfileUpdate`, and an older peer that drops the field shows the palette human). A pet character uses the pet sheet (walk cycle when walking, idle loop otherwise, hue-shifted without skin exemption); subagents of a pet owner are the same pet hue-offset, shells keep the shell look. Office replies (`officeCreated`, `officeCode`, `officeError {reason}`) go to the requesting socket only; `officesState` + a fresh snapshot follow every office change, and `officesState` is re-sent when a member announces a team's name.

## Privilege rule (this PC only)

The UI is served to this PC's browser only (remote viewing was removed in v0.4.0). The CLI binds `127.0.0.1` by default, and every HTTP request (`/api/ping` and `POST /api/quit` included) gets 403 and `/ws` closes with 4003 unless `isLoopback(req)` (`server/src/httpServer.ts`):

- remote address is `127.0.0.1`, `::1` or `::ffff:127.0.0.1`, AND
- `Host` header host is `localhost`, `127.0.0.1` or `[::1]`, AND
- `Origin`, if present, has the same host as `Host`.

This holds regardless of `profile.json` (a pre-0.4 `remoteView` key is dropped on load). Safety net: `ctx.privileged` (defaults to false) still drives the single gate at the top of `handleClientMessage`, which refuses every message except `webviewReady` (new message types are privileged by default) and re-sends the true state where the UI updated optimistically; the webview keeps a minimal "보기 전용" display for `officeAccess {readOnly: true}`. The office snapshot follows `profile.activeView`. Never execute or write anything based on data from peers.

## Datagram size (split presence)

Every PeerNet datagram is ≤ `MAX_DATAGRAM_BYTES` (1200) on the wire: some networks (and WSL loopback) drop IP fragments, i.e. anything over 1472 B. `pub`/`team` presence whose datagram fits is sent in the old single form (the Inner `{seq, packet, office?}`, byte-identical to 0.4.x; one seq per send tick, shared by every pub peer). A larger one is deflated and split into ≤ 48 parts `{seq, from, part, parts, d}` (420 B each, inside the same seal/AAD); `fitPacket` trims trailing views until it fits. 0.4.x peers drop parts, so a busy PC is missing for them (documented in the install guides and README). The receiver keeps one assembly per (channel, sender), ≤ 256 in all, a newer seq replaces an unfinished one, unfinished ones expire after 2 s (the last complete state stays), the replay guard applies to complete seqs, and a complete one is inflated (≤ MAX_PACKET_BYTES) and must match the part header's seq and sender (pub: also the wire `from`).

## Data

`~/.pixel-office/` — `layout.json` (the one layout of this PC, shown in every office; never sent to peers — sharing = export/import file), `config.json`, `profile.json` (0600: X25519 key pair, team office secrets, optional nickname + `nicknameSince` (set when it changes; migrated = file mtime), `setUp` = first-run form saved; the OS account name is NOT stored — `LanService.account` = `osAccount()` at every start, `DOMAIN\` stripped, ≤32, else hostname; never settable by a client), `known-peers.json` (0600, TOFU peer id → public key). Ports: UDP 47800 (peers; the only inbound port — Windows firewall rule `protocol=UDP localport=47800`), HTTP 47801 (UI, this PC only); the CLI defaults to `--host 127.0.0.1 --port 47801` (`--host` is kept for dev; non-loopback requests are refused anyway). A UDP bind failure only disables peers. Two instances on one host (tests only): `PIXEL_OFFICE_UDP_PORT=47810 PIXEL_OFFICE_UDP_TARGETS=127.0.0.1:47811` and the mirror for the other.

## Build & test

```bash
npm install                 # root + workspaces (server, webview-ui)
npm run build               # asyncapi:generate, check-types, lint, esbuild CLI + assets, vite SPA → dist/
npm run check-types
npm run lint
npm test                    # webview + server vitest (server CLI tests need dist/ built)
npm run test:server         # cd server && vitest run
npm run test:webview
npm run asyncapi:validate
npm run asyncapi:generate   # after editing core/asyncapi.yaml; commit messages.ts with it
node dist/cli.js --port 47801   # then open http://localhost:47801
```

`esbuild.js` bundles `server/src/cli.ts` with all its dependencies (fastify included — `dist/` runs without `node_modules`) → `dist/cli.js`, inlines `__APP_VERSION__` (package.json version), and copies `webview-ui/public/assets/` → `dist/assets/`; Vite builds the SPA into `dist/webview/`. `@playwright/test` stays as a devDependency for headless screenshots (no e2e suite).

CI (`.github/workflows/ci.yml`): install, lint, asyncapi validate + generate drift check, check-types, build, test:server, test:webview.

Installers (`.github/workflows/package.yml`, `scripts/package/`): official Node (`node-version.txt`, SHA-256 checked by `fetch-node.mjs`) + `dist/` as `app/`. Windows = Inno Setup (`windows.iss`, `launch.vbs`, firewall rule, desktop-shortcut + start-at-login tasks; the per-user Startup shortcut is written by `cli.js --autostart` run as the original user); Mac = `macos.sh` → `/Applications/Pixel Office.app` + LaunchAgent `com.pixeloffice.agent` via pkgbuild. Manual run → artifacts; tag `v<package.json version>` → GitHub Release (`-` in tag = prerelease). User guide: `docs/설치-안내.md`, `docs/INSTALL.en.md`.

## Conventions

- **Protocol**: edit `core/asyncapi.yaml`, run `npm run asyncapi:generate`; CI fails if `core/src/messages.ts` drifts. Every message sets `additionalProperties: false`.
- **Constants**: no inline magic numbers/strings. Server → `server/src/constants.ts`; protocol → `core/src/constants.ts`; webview → `webview-ui/src/constants.ts`; CSS variables in `webview-ui/src/index.css` `:root`.
- **Colors**: hex/rgb/hsl literals only in `webview-ui/src/constants.ts` (eslint `pixel-agents/no-inline-colors`, error level). Pixel style: `borderRadius: 0`, `2px solid` borders, hard `2px 2px 0px` shadows. UI font Pretendard (`var(--font-ui)`, bundled `webview-ui/public/fonts/`, OFL; eslint `pixel-agents/ui-font`).
- **TypeScript**: no `enum` (use `as const`); `import type` for type-only imports; `.js` extensions on relative imports in `server/` and `core/`; `noUnusedLocals`/`noUnusedParameters` everywhere.
- **No new runtime dependencies** — UDP, file watching, paths via Node stdlib.
- **User-facing text via `webview-ui/src/i18n.ts`** (`t(key, params?)`, ko/en per viewer, `localStorage['pixel-office.lang']`, default from `navigator.language`). Agent activity travels as `{act, target}` and is rendered by each viewer; `reason`/targets are shown as-is. Layout room labels stay 코딩실, 자료실, 서버실, 대기실 (keys coding|library|server|lounge) and are translated only for display (`areaName`).
- Logging: `console.*` with `[Pixel Office]` (server) / `[Webview]` prefixes.
- Keep the upstream MIT LICENSE and the JIK-A-4 Metro City character credit.
- Commits: husky pre-commit runs gitleaks + lint-staged; never `--no-verify`.

## Office UI essentials

- Game state lives in the imperative `OfficeState` (not React). Zoom is a float (0.5–10, wheel = `wheelZoom`); the frame is drawn at the integer `renderScale(zoom).renderZoom` (sprite caches stay per-integer) and blitted scaled — overlays/hit-tests use `mapOffset`/`overlayProjection` with the float zoom. No `ctx.scale(dpr)`, z-sort by Y.
- Layout model `{ version: 1, cols, rows, tiles, furniture, tileColors?, areas?, areaTiles?, background? }` (`background` = map fill outside the office/VOID tiles, `office/background.ts`; missing = page navy); grid ≤ 128×128 (`MAX_LAYOUT_COLS/ROWS`, `core/src/lan.ts`); saved via `saveLayout` from the editor (loopback only).
- Rooms are fixed: `areas` = exactly 코딩실/자료실/서버실/대기실 (`normalizeRoomAreas` in `core/src/lan.ts`: missing rooms added with default colors, unknown areas and their tiles dropped). Applied by the webview on `layoutLoaded`/import (`migrateLayout`) and by the server on save and load (`sanitizeLayout`, `server/src/layoutPersistence.ts`, which strips legacy `pets`). Grid check shared by the server, the import and `layoutLoaded`: `isLayoutGrid` (v1, cols/rows ≤ 128, `tiles.length === cols*rows`, furniture array); a refused `saveLayout` answers `layoutSaveRejected` to the sender (toast). A missing room color falls back to `ROOM_DEFAULT_COLORS`. The area tool only paints/erases the four rooms (no add/rename/delete); a room with no walkable tile is warned about in the editor.
- Layout editor: floor/wall/erase/furniture/area/background tools, 50-level stroke-scoped undo, Esc unwinds in stages; pure ops in `office/editor/editorActions.ts`.
- Assets: per-furniture `manifest.json` under `webview-ui/public/assets/furniture/`, characters `char_0..5.png`, floors, walls, carpets, pets.

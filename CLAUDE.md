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
  lan/peerNet.ts         UDP v2: plaintext hello + encrypted pairwise pub (public office) / encrypted team broadcast; TOFU pins, per-channel seq replay guard
  lan/crypto.ts          X25519 identity, HKDF pair/team keys, AES-256-GCM seal/open, invite codes (PO2-…), parseWire
  lan/updater.ts         GitHub Releases check (60 s, then 6 h), installer download to ~/.pixel-office/updates + launch (loopback only)
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

`officeAccess {readOnly}` (always false in practice; safety net) → asset messages (characters, pets, floor, walls, carpets, furniture) → `settingsLoaded` → `profileLoaded {profile, canEdit}` → `officesState` (names, never secrets/codes) → `areaMappingsLoaded` → `layoutLoaded` (saved layout, else bundled default) → first `officeSnapshot` → `autostartState` → `updateAvailable` (when known). Privileged-only parts are skipped for a read-only ctx. After that `officeSnapshot {agents, people, selfPeerId}` (`people` = every PC live in that office, agents or not, self first — the right-edge people panel, `webview-ui/src/lan/PeoplePanel.tsx` + pure `peopleModel.ts`) is pushed every second to every socket (this PC's agents verbatim; `hideDetails` only redacts what goes to peers). Office replies (`officeCreated`, `officeCode`, `officeError {reason}`) go to the requesting socket only; `officesState` + a fresh snapshot follow every office change, and `officesState` is re-sent when a member announces a team's name.

## Privilege rule (this PC only)

The UI is served to this PC's browser only (remote viewing was removed in v0.4.0). The CLI binds `127.0.0.1` by default, and every HTTP request (`/api/ping` and `POST /api/quit` included) gets 403 and `/ws` closes with 4003 unless `isLoopback(req)` (`server/src/httpServer.ts`):

- remote address is `127.0.0.1`, `::1` or `::ffff:127.0.0.1`, AND
- `Host` header host is `localhost`, `127.0.0.1` or `[::1]`, AND
- `Origin`, if present, has the same host as `Host`.

This holds regardless of `profile.json` (a pre-0.4 `remoteView` key is dropped on load). Safety net: `ctx.privileged` (defaults to false) still drives the single gate at the top of `handleClientMessage`, which refuses every message except `webviewReady` (new message types are privileged by default) and re-sends the true state where the UI updated optimistically; the webview keeps a minimal "보기 전용" display for `officeAccess {readOnly: true}`. The office snapshot follows `profile.activeView`. Never execute or write anything based on data from peers.

## Data

`~/.pixel-office/` — `layout.json`, `config.json`, `profile.json` (0600: X25519 key pair, team office secrets), `known-peers.json` (0600, TOFU peer id → public key). Ports: UDP 47800 (peers; the only inbound port — Windows firewall rule `protocol=UDP localport=47800`), HTTP 47801 (UI, this PC only); the CLI defaults to `--host 127.0.0.1 --port 47801` (`--host` is kept for dev; non-loopback requests are refused anyway). A UDP bind failure only disables peers. Two instances on one host (tests only): `PIXEL_OFFICE_UDP_PORT=47810 PIXEL_OFFICE_UDP_TARGETS=127.0.0.1:47811` and the mirror for the other.

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
- Layout model `{ version: 1, cols, rows, tiles, furniture, tileColors?, areas?, background? }` (`background` = map fill outside the office/VOID tiles, `office/background.ts`; missing = page navy); saved via `saveLayout` from the editor (loopback only).
- Layout editor: floor/wall/erase/furniture/area/background tools, 50-level stroke-scoped undo, Esc unwinds in stages; pure ops in `office/editor/editorActions.ts`.
- Assets: per-furniture `manifest.json` under `webview-ui/public/assets/furniture/`, characters `char_0..5.png`, floors, walls, carpets, pets.

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
  cli.ts                 Entry (dist/cli.js): parse --port/--host, load assets, start server
  server.ts              PixelAgentsServer.start({host, port, staticDir, assetCache}) / stop()
  httpServer.ts          Fastify: GET /api/health, GET /ws, SPA static; isLoopback(req)
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
```

## Removed from upstream (Task 1)

VS Code adapter, PTY/xterm terminal, hook providers + consent flow, JSONL transcript watching, agent runtime/store, directories/launch drawer, mobile terminal shell, server token, server registry (`server.json`), e2e suite, Allure/Vercel, npm/vsix publishing. Agent detection is rebuilt by the LAN reporter (Tasks 2–9). `docs/adr/`, `docs/design/`, `docs/research/` describe the removed upstream pipeline.

## Handshake (`webviewReady`)

`officeAccess {readOnly}` → asset messages (characters, pets, floor, walls, carpets, furniture) → `settingsLoaded` → `areaMappingsLoaded` → `layoutLoaded` (saved layout, else bundled default) last.

## Privilege rule

A `/ws` connection may write (save layout, settings, area mappings, asset dirs) only when `isLoopback(req)` (`server/src/httpServer.ts`):

- remote address is `127.0.0.1`, `::1` or `::ffff:127.0.0.1`, AND
- `Host` header host is `localhost`, `127.0.0.1` or `[::1]`, AND
- `Origin`, if present, has the same host as `Host`.

Everyone else is read-only: the single gate at the top of `handleClientMessage` refuses every message except `webviewReady` (new message types are privileged by default) and re-sends the true state where the UI updated optimistically. A cross-origin handshake is closed with 4003. Never execute or write anything based on data from peers or remote browsers.

## Data

`~/.pixel-office/` — `layout.json`, `config.json`. Ports: UDP 47800 (peers), HTTP 47801 (UI) per the spec; the CLI currently defaults to `127.0.0.1` and an ephemeral port.

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

`esbuild.js` bundles only `server/src/cli.ts` → `dist/cli.js` and copies `webview-ui/public/assets/` → `dist/assets/`; Vite builds the SPA into `dist/webview/`. `@playwright/test` stays as a devDependency for headless screenshots (no e2e suite).

CI (`.github/workflows/ci.yml`): install, lint, asyncapi validate + generate drift check, check-types, build, test:server, test:webview.

## Conventions

- **Protocol**: edit `core/asyncapi.yaml`, run `npm run asyncapi:generate`; CI fails if `core/src/messages.ts` drifts. Every message sets `additionalProperties: false`.
- **Constants**: no inline magic numbers/strings. Server → `server/src/constants.ts`; protocol → `core/src/constants.ts`; webview → `webview-ui/src/constants.ts`; CSS variables in `webview-ui/src/index.css` `:root`.
- **Colors**: hex/rgb/hsl literals only in `webview-ui/src/constants.ts` (eslint `pixel-agents/no-inline-colors`, error level). Pixel style: `borderRadius: 0`, `2px solid` borders, hard `2px 2px 0px` shadows, FS Pixel Sans.
- **TypeScript**: no `enum` (use `as const`); `import type` for type-only imports; `.js` extensions on relative imports in `server/` and `core/`; `noUnusedLocals`/`noUnusedParameters` everywhere.
- **No new runtime dependencies** — UDP, file watching, paths via Node stdlib.
- **User-facing text in Korean** (room labels 코딩실, 자료실, 서버실, 대기실; keys coding|library|server|lounge).
- Logging: `console.*` with `[Pixel Office]` (server) / `[Webview]` prefixes.
- Keep the upstream MIT LICENSE and the JIK-A-4 Metro City character credit.
- Commits: husky pre-commit runs gitleaks + lint-staged; never `--no-verify`.

## Office UI essentials

- Game state lives in the imperative `OfficeState` (not React). Integer zoom, no `ctx.scale(dpr)`, z-sort by Y.
- Layout model `{ version: 1, cols, rows, tiles, furniture, tileColors?, areas? }`; saved via `saveLayout` from the editor (loopback only).
- Layout editor: floor/wall/erase/furniture/area tools, 50-level stroke-scoped undo, Esc unwinds in stages; pure ops in `office/editor/editorActions.ts`.
- Assets: per-furniture `manifest.json` under `webview-ui/public/assets/furniture/`, characters `char_0..5.png`, floors, walls, carpets, pets.

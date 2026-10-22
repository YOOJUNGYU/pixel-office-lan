# Offices + Encryption + PWA Implementation Plan (v0.2.0)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Encrypt all PC↔PC traffic automatically, add invite-code team offices, make the UI installable as a PWA, and close remote viewing by default; ship as v0.2.0.

**Architecture:** A pure `server/src/lan/crypto.ts` (Node `crypto`: X25519, HKDF-SHA256, AES-256-GCM) defines the v2 wire format. `PeerNet` speaks v2: plaintext `hello` (id + public key) broadcast for the public office, encrypted pairwise `pub` unicast, encrypted `team` broadcast per joined team. Profile gains `offices[]` and `activeView`. The server builds the snapshot for the viewed office; the webview gets an office switcher and office management.

**Tech Stack:** existing (TypeScript, Node 22 `crypto`/`dgram`, Fastify, React). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-22-offices-encryption-design.md` (+ the v0.1.0 spec).

## Global Constraints

- No new runtime dependencies. Node `crypto` only (`generateKeyPairSync('x25519')`, `diffieHellman`, `hkdfSync`, `createCipheriv('aes-256-gcm')`, `randomBytes`, `createHmac`).
- No plaintext state ever leaves the PC: only `hello` (`{v:2,t:'hello',id,pk}`) is unencrypted.
- Team secret never leaves the PC; only an 8-byte HMAC tag identifies the team on the wire.
- Membership rule: `offices.length > 0` ⇒ no `hello`, no `pub` send, `pub` receive ignored, public view unavailable.
- Remote (non-loopback) HTTP/WS viewers: rejected unless `profile.remoteView === true`; even then they only ever get the public office, and get an empty office while the host is in any team office.
- Privilege gate unchanged (loopback + Host + Origin) for every new client message.
- UI strings via `webview-ui/src/i18n.ts` (ko + en). Constants policy, asyncapi generation, TS rules per CLAUDE.md.
- v1 packets (`"v":1`) are ignored (log once "구버전 PC 감지").
- Ports unchanged (UDP 47800, HTTP 47801). Version becomes `0.2.0`.

## Review Focus

1. Malformed/oversized/forged v2 datagrams (bad base64, wrong tag, bit-flipped ciphertext, replayed seq, key-substitution for a known id) → dropped silently, no throw, no state change.
2. A team member's data must never appear in the public snapshot or for a remote viewer — test both.
3. Profile file with `offices` containing team secrets must stay 0600 and secrets must never be sent to unprivileged sockets (they get names only, no codes).
4. Leaving the last team re-enables public within one send interval; joining a team stops `hello` immediately.
5. Upgrading from v0.1.0 profile.json (no `offices`, no keys) works: keys generated, public office by default.

---

### Task 1: Crypto + v2 wire codec

**Files:** Create `server/src/lan/crypto.ts`, `server/__tests__/lan/crypto.test.ts`. Modify `server/src/constants.ts` (constants).

**Interfaces (produces):**

```ts
export interface Identity {
  id: string;
  publicKey: string /* base64 raw 32B */;
  privateKeyPem: string;
}
export function createIdentity(id: string): Identity;
export function pairKey(
  myPrivatePem: string,
  theirPublicB64: string,
  idA: string,
  idB: string,
): Buffer; // HKDF(salt 'pixel-office/v2/pub', info = [idA,idB].sort().join('|')) → 32B
export interface InviteCode {
  secret: Buffer /* 13 bytes = 104 bits */;
  text: string; /* 'PO2-' + 5 groups of 4 Crockford base32, last group padded */
}
export function newInviteCode(): InviteCode;
export function parseInviteCode(text: string): Buffer | null; // tolerant: case-insensitive, ignores spaces/dashes, Crockford aliases (O→0, I/L→1)
export function teamKey(secret: Buffer): Buffer; // HKDF(salt 'pixel-office/v2/team', info 'key')
export function teamTag(key: Buffer): string; // base64url(HMAC-SHA256(key,'tag')[0..8])
export type Wire =
  | { v: 2; t: 'hello'; id: string; pk: string }
  | { v: 2; t: 'pub'; from: string; to: string; n: string; c: string }
  | { v: 2; t: 'team'; tag: string; n: string; c: string };
export function seal(key: Buffer, aad: string, plaintext: string): { n: string; c: string }; // 12B random nonce, ciphertext||authTag, base64
export function open(key: Buffer, aad: string, n: string, c: string): string | null; // null on any failure
export function parseWire(text: string): Wire | null; // shape-validates, size cap MAX_PACKET_BYTES, never throws
```

AAD: `pub|${from}|${to}` and `team|${tag}`. Encrypted plaintext JSON = `{ seq: number, packet: PeerPacket /* existing v1 shape */, office?: { name: string } }`.

- [ ] Step 1: tests — round-trip seal/open; bit-flip in c → null; wrong AAD → null; pairKey symmetric for A↔B and differs for A↔C; invite code text parses back to the same secret incl. lowercase/no-dashes/O-vs-0; two codes differ; teamTag stable and 11 chars; parseWire rejects v:1, unknown t, non-base64, oversize; no function throws on garbage.
- [ ] Step 2: run → FAIL. Step 3: implement. Step 4: `cd server && npx vitest run __tests__/lan/crypto.test.ts` → PASS. Step 5: commit `feat(lan): v2 crypto and wire codec`.

### Task 2: PeerNet v2, profile offices, per-office snapshot

**Files:** Modify `server/src/lan/peerNet.ts`, `server/src/lan/profile.ts`, `server/src/lan/office.ts`, `server/src/cli.ts`; tests `server/__tests__/lan/peerNet.test.ts`, `profile.test.ts`, `office.test.ts`.

**Interfaces:**

- Profile gains `identity: { publicKey; privateKeyPem }` (generated on load if missing), `offices: { tag: string; name: string; secret: string /* base64 */ }[]`, `activeView: 'public' | string /* tag */`, `remoteView: boolean` (default false). `known-peers.json` (0600) maps peer id → pinned public key.
- `PeerNet` options add `identity`, `offices: () => {tag,key,name}[]`, `pins` store. Sends every SEND_INTERVAL_MS: if no offices → broadcast `hello` + `pub` unicast to each live hello'd peer (address from the hello datagram's rinfo, plus manual peers); else → one `team` datagram per office to broadcast + manual peers. Receive: `hello` → record {pk, address} (TOFU: pinned key mismatch → drop + warn once per id); `pub` addressed to me from a known peer → open with pairKey; `team` with a joined tag → open with that team key. Per (sender id, channel) monotonic `seq` (drop ≤ last). Output: `peers(view: 'public' | tag): PeerPacket[]` (TTL 5 s per channel).
- `LanService.office(view, redactLocal)` builds the snapshot for that view (self included in public only when no offices; self included in every joined team view).
- New privileged client messages (asyncapi): `createOffice {name}` → returns `officeCreated {tag, name, code}` to that socket only; `joinOffice {code, name?}`; `leaveOffice {tag}`; `setActiveView {view}`; `setRemoteView {enabled}`. Server→client `officesState { offices: {tag,name}[], activeView, remoteView }` in handshake + after changes (privileged sockets only; never include secrets/codes except `officeCreated` reply, and `getOfficeCode {tag}` → `officeCode {tag, code}` for re-copying, privileged only).
- HTTP/WS gate: non-loopback connection when `remoteView` false → close 4003 / HTTP 403 (except `/api/ping`). When true: remote sockets get public view only; empty agents when `offices.length > 0`.

- [ ] Tests: two PeerNet instances on loopback ports exchange `hello`+`pub` and see each other in `peers('public')`; a third instance with a different identity claiming instance A's id is dropped (pin); captured `pub` replayed → dropped; team: A and B join same code → see each other in `peers(tag)`, C without code sees nothing and `peers('public')` of C excludes A/B; joining stops hello (C stops seeing A in public after TTL); leaving re-enables; profile migration from v0.1.0 file; office snapshot excludes team data from public and from remote sockets; secrets absent from `officesState`.
- [ ] Commit `feat(lan): encrypted peer protocol and team offices`.

### Task 3: Webview — office switcher, office management, remote-view setting

**Files:** Create `webview-ui/src/lan/OfficeSwitcher.tsx`, `webview-ui/src/lan/OfficeSettings.tsx`; modify `App.tsx`, `SettingsModal.tsx`, `useExtensionMessages.ts`, `i18n.ts`.

- Top-centre switcher (pixel style): "🌐 공개 오피스" (disabled with tooltip "팀 오피스에 있는 동안은 공개 오피스에 보이지 않습니다" when offices exist) + each team "🔒 name". Hidden for remote viewers.
- Settings → 오피스: create (name input → shows the code with Copy button and "이 코드를 팀원에게 공유하세요"), join (code input, tolerant), list with Copy code / Leave, and remote-view toggle with warning "켜면 이 PC의 공개 오피스 화면을 같은 망의 다른 브라우저가 평문(HTTP)으로 볼 수 있습니다".
- First-run modal unchanged. Joining a team shows a notice that you've left the public office.
- [ ] Tests: pure helpers (code input normalisation, switcher state) + i18n parity. Playwright screenshots (ko/en) of switcher and settings with two local instances (temp HOMEs, ports 47898/47899, `targets` via manual peers 127.0.0.1) in a team; save to the SDD workspace. Commit `feat(webview): office switcher and team offices`.

### Task 4: PWA, launcher, docs, v0.2.0 release

**Files:** Create `webview-ui/public/manifest.webmanifest`, `webview-ui/public/sw.js`, icons 192/512 (from `icon.png`, nearest-neighbour upscale); modify `webview-ui/index.html`, `scripts/package/launch.vbs` (open `msedge --app=http://localhost:47801/` if Edge exists, else default browser), macOS launcher unchanged, README.md / README.en.md / install guides (offices, encryption, PWA install, remote view), `package.json` version `0.2.0`.

- Service worker: cache-first for the static shell (`/`, assets), network-only for `/ws` and `/api/*`; versioned cache name from app version; no caching of snapshot data.
- [ ] Verify with Playwright: manifest served, SW registered, `installable` (check `navigator.serviceWorker.controller` after reload + manifest fields). CI package workflow green. Commit, merge to main, tag `v0.2.0` (release published by CI).

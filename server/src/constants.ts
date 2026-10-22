/** Valid explicit TCP port range for --port. */
export const MIN_PORT = 1;
export const MAX_PORT = 65_535;

/** Host-header names a privileged (loopback) browser may use. See httpServer.isLoopback. */
export const LOOPBACK_HOSTNAMES = ['localhost', '127.0.0.1', '[::1]'] as const;
/** Remote addresses that count as this machine. */
export const LOOPBACK_ADDRESSES = ['127.0.0.1', '::1', '::ffff:127.0.0.1'] as const;

/** A cross-origin handshake, or a remote browser while remote viewing is off.
 *  WebSocket connects bypass CORS, so this rejects drive-by web pages. */
export const WS_CLOSE_FORBIDDEN = 4003;

// ── Layout/Config Persistence ──────────────────────────────
/** Data directory under the user's home (layout.json, config.json). */
export const LAYOUT_FILE_DIR = '.pixel-office';
export const LAYOUT_FILE_NAME = 'layout.json';
export const LAYOUT_REVISION_KEY = 'layoutRevision';
export const CONFIG_FILE_NAME = 'config.json';

// ── LAN session state ──────────────────────────────────────
/** A room change must hold this long before the agent moves. */
export const ROOM_DEBOUNCE_MS = 3_000;
/** Non-exempt tool pending this long with no new line => waiting for approval. */
export const PERMISSION_DELAY_MS = 7_000;
/** Text-only turn with no tool pending this long => idle. */
export const TEXT_IDLE_DELAY_MS = 5_000;

// ── LAN transcript scanner ─────────────────────────────────
/** Main session hidden once its transcript is unchanged this long. */
export const SESSION_TTL_MS = 30 * 60_000;
/** Subagent transcript unchanged this long => removed. */
export const CHILD_IDLE_TTL_MS = 120_000;
/** Subagent hidden this long after its turn ended. */
export const CHILD_ENDED_HIDE_MS = 10_000;
/** Bytes replayed from the end of a newly found transcript. */
export const TAIL_BYTES = 64 * 1024;
/** Max bytes read to find a Codex rollout's first (session_meta) line. */
export const CODEX_META_MAX_BYTES = 256 * 1024;
export const DISCOVER_INTERVAL_MS = 10_000;
export const POLL_INTERVAL_MS = 1_000;
export const WSL_LIST_TIMEOUT_MS = 3_000;

// ── LAN office wiring ──────────────────────────────────────
/** `GET /api/ping` answer that marks a running Pixel Office (single-instance check). */
export const PING_APP = 'pixel-office';
export const PING_TIMEOUT_MS = 1_000;
/** officeSnapshot push interval per WebSocket. */
export const SNAPSHOT_INTERVAL_MS = 1_000;
/** `POST /api/quit`: delay before exit so the reply reaches the caller. */
export const QUIT_DELAY_MS = 100;

// ── Updates (GitHub Releases) ──────────────────────────────
/** First update check after start. */
export const UPDATE_FIRST_CHECK_MS = 60_000;
export const UPDATE_API_TIMEOUT_MS = 15_000;
export const UPDATE_DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
/** Downloaded installers, under the data directory. */
export const UPDATES_DIR_NAME = 'updates';
/** `PIXEL_OFFICE_NO_PEERS=1`: no UDP peers (tests must never broadcast on the real LAN). */
export const NO_PEERS_ENV = 'PIXEL_OFFICE_NO_PEERS';
/** Test only: two instances on one host. `PIXEL_OFFICE_UDP_PORT=47810` binds that UDP port and
 *  `PIXEL_OFFICE_UDP_TARGETS=127.0.0.1:47811` replaces broadcast + manual peers ("host:port", comma-separated). */
export const UDP_PORT_ENV = 'PIXEL_OFFICE_UDP_PORT';
export const UDP_TARGETS_ENV = 'PIXEL_OFFICE_UDP_TARGETS';
/** Opt in to prereleases (rc testing): `PIXEL_OFFICE_ALLOW_PRERELEASE=1`. */
export const ALLOW_PRERELEASE_ENV = 'PIXEL_OFFICE_ALLOW_PRERELEASE';

// ── Start at login (lan/autostart.ts) ──────────────────────
/** Installed Windows layout: `<install dir>\launch.vbs` next to node.exe. */
export const WIN_LAUNCHER_NAME = 'launch.vbs';
/** Per-user Startup folder under %APPDATA%, and the shortcut placed there. */
export const WIN_STARTUP_SUBDIR = ['Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'];
export const WIN_STARTUP_LINK_NAME = 'Pixel Office.lnk';
export const WIN_DEFAULT_SYSTEM_ROOT = 'C:\\Windows';
export const AUTOSTART_EXEC_TIMEOUT_MS = 15_000;
/** Installed macOS layout: the LaunchAgent template sits next to node in Contents/Resources. */
export const MAC_AGENT_PLIST_NAME = 'com.pixeloffice.agent.plist';
export const MAC_LAUNCH_AGENTS_SUBDIR = ['Library', 'LaunchAgents'];
/** Marker in the data dir: the user turned start-at-login off; a silent update must not undo it. */
export const AUTOSTART_OFF_MARKER = 'autostart-off';

// ── v2 wire crypto (lan/crypto.ts) ─────────────────────────
/** HKDF salts/infos: public-office pair keys and team-office keys. */
export const PUB_KEY_SALT = 'pixel-office/v2/pub';
export const TEAM_KEY_SALT = 'pixel-office/v2/team';
export const TEAM_KEY_INFO = 'key';
/** HMAC message whose first TEAM_TAG_BYTES identify a team on the wire. */
export const TEAM_TAG_INFO = 'tag';
export const TEAM_TAG_BYTES = 8;
export const KEY_BYTES = 32;
export const X25519_PUBLIC_KEY_BYTES = 32;
/** SPKI DER header that wraps a raw 32-byte X25519 public key. */
export const X25519_SPKI_PREFIX = '302a300506032b656e032100';
export const GCM_NONCE_BYTES = 12;
export const GCM_TAG_BYTES = 16;
/** Invite secret: 13 bytes = 104 bits = 21 Crockford base32 chars, shown as PO2-XXXX-…. */
export const INVITE_SECRET_BYTES = 13;
export const INVITE_PREFIX = 'PO2';
export const INVITE_GROUP_LEN = 4;
export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const WIRE_MAX_ID = 64;

// ── v2 peer protocol / offices (lan/peerNet.ts, lan/profile.ts) ──
/** Max JSON bytes of the encrypted plaintext, so seal + base64 + wire JSON stays ≤ MAX_PACKET_BYTES. */
export const PACKET_PLAINTEXT_BUDGET = 44_000;
/** TOFU pins: peer id → public key (0600), oldest dropped past MAX_KNOWN_PEERS. */
export const KNOWN_PEERS_FILE_NAME = 'known-peers.json';
export const MAX_KNOWN_PEERS = 1_000;
/** New pins are written at most this often (a hello flood must not hammer the disk). */
export const PIN_SAVE_DELAY_MS = 1_000;
/** Public-office peers tracked at once; hellos from further new ids are ignored. */
export const MAX_HELLO_PEERS = 256;
/** Distinct once-only UDP warnings (ids/addresses come from the network); then logging stops. */
export const MAX_WARN_KEYS = 256;
/** Replay guard: last seq per (channel, sender) is remembered this long. */
export const SEQ_MEMORY_MS = 10 * 60_000;
export const MAX_OFFICES = 10;
export const MAX_OFFICE_NAME = 20;

// ── App window (lan/appWindow.ts) ──────────────────────────
/** Chromium web app id length: first 16 bytes of the (double) SHA-256, as letters a-p. */
export const WEB_APP_ID_BYTES = 16;

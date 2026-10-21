/** Valid explicit TCP port range for --port. */
export const MIN_PORT = 1;
export const MAX_PORT = 65_535;

/** Host-header names a privileged (loopback) browser may use. See httpServer.isLoopback. */
export const LOOPBACK_HOSTNAMES = ['localhost', '127.0.0.1', '[::1]'] as const;
/** Remote addresses that count as this machine. */
export const LOOPBACK_ADDRESSES = ['127.0.0.1', '::1', '::ffff:127.0.0.1'] as const;

/** Standalone mode: the handshake's Origin is not this server's own origin.
 *  WebSocket connects bypass CORS, so this rejects drive-by web pages. */
export const WS_CLOSE_FORBIDDEN_ORIGIN = 4003;

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
/** Nickname sent to peers until the user picks one. */
export const UNNAMED_NICKNAME = '이름없음';

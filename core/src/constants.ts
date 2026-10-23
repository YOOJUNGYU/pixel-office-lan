/**
 * Shared constants used across server and webview.
 * Only constants needed by core interfaces live here.
 * Server-specific constants stay in server/src/constants.ts.
 * Webview-specific rendering constants stay in webview-ui/src/constants.ts.
 */

// ── Transport ────────────────────────────────────────────────
// Connection-state names for the MessageTransport state machine.

export const TRANSPORT_STATE_CONNECTING = 'connecting';
export const TRANSPORT_STATE_CONNECTED = 'connected';
export const TRANSPORT_STATE_RECONNECTING = 'reconnecting';
export const TRANSPORT_STATE_DISCONNECTED = 'disconnected';

/** WebSocket close code: the app was quit (tray / Settings) — the page stops reconnecting. */
export const WS_CLOSE_APP_QUIT = 4010;

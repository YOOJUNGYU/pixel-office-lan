// "Server is off" panel: when to show it and what it says (pure; ServerPanel.tsx renders it).
import type { TransportState } from '../transport/types.js';

/**
 * Show the panel after the user quit the app ('disconnected' = WS_CLOSE_APP_QUIT),
 * or when this page has never connected and the first-load grace is over.
 * A page that was connected and is reconnecting (e.g. an update restart) never shows it.
 */
export function panelVisible(
  state: TransportState,
  everConnected: boolean,
  graceOver: boolean,
): boolean {
  if (state === 'disconnected') return true;
  if (state === 'replaced') return false; // ReplacedPanel instead (polling would reload it back)
  return !everConnected && state !== 'connected' && graceOver;
}

export type StartPhase = 'idle' | 'starting' | 'timeout';

/** idle = [시작] not pressed; starting = waiting for the server; timeout = show the manual hint. */
export function startPhase(clickedAt: number | null, now: number, timeoutMs: number): StartPhase {
  if (clickedAt === null) return 'idle';
  return now - clickedAt < timeoutMs ? 'starting' : 'timeout';
}

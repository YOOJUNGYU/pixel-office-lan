// Reload into the server's version after an update (pure decision; pwa.ts does the reload).
import { DEV_SERVER_VERSION } from '../constants.js';

/**
 * The version to reload into, or null. A page whose bundle differs from the
 * server's version reconnected to an updated server and reloads once; an
 * unbuilt dev server (0.0.0), an old server that sends none, or a version this
 * tab already reloaded for (a stale cache would loop) never reloads.
 */
export function reloadTarget(
  server: unknown,
  bundle: string,
  triedFor: string | null,
): string | null {
  if (typeof server !== 'string' || server === '' || server === DEV_SERVER_VERSION) return null;
  if (server === bundle || server === triedFor) return null;
  return server;
}

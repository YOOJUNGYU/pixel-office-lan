import type { UpdateStatus } from '../../../core/src/messages.js';

/** [Update] is offered only when idle: not while downloading, nor once the installer is launched. */
export function showInstallButton(hasUpdate: boolean, state: UpdateStatus['state'] | undefined) {
  return hasUpdate && state !== 'upToDate' && state !== 'downloading' && state !== 'installing';
}

/** The "updated to `current`" notice is due: this viewer last ran an older version (never on a first run). */
export function updatedNoticeDue(seen: string | null, current: string): boolean {
  return seen !== null && current.localeCompare(seen, 'en', { numeric: true }) > 0;
}

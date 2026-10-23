import type { UpdateStatus } from '../../../core/src/messages.js';

/** [Update] is offered only when idle: not while downloading, nor once the installer is launched. */
export function showInstallButton(hasUpdate: boolean, state: UpdateStatus['state'] | undefined) {
  return hasUpdate && state !== 'upToDate' && state !== 'downloading' && state !== 'installing';
}

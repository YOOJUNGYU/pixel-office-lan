// Pure decision for the install-as-app popup (src/pwa.ts feeds it the browser state).
import { INSTALL_SNOOZE_MS } from '../constants.js';

/** What the install popup shows: Chromium's install button, manual steps, or nothing. */
export type InstallMode = 'hidden' | 'prompt' | 'safari' | 'other';

export interface InstallInputs {
  /** Already running as the installed app. */
  standalone: boolean;
  /** Read-only (remote) viewer. */
  readOnly: boolean;
  /** Installing needs a secure context (localhost); LAN `http://<IP>` viewers can't. */
  secure: boolean;
  installed: boolean;
  /** Chromium captured `beforeinstallprompt`. */
  canPrompt: boolean;
  /** The browser has `onbeforeinstallprompt` (Chromium): no event = installed or not installable. */
  chromium: boolean;
  userAgent: string;
  /** Epoch ms of the last [Later], or null. */
  dismissedAt: number | null;
  now: number;
}

export function installMode(i: InstallInputs): InstallMode {
  if (i.standalone || i.readOnly || !i.secure || i.installed) return 'hidden';
  if (i.dismissedAt !== null && i.now - i.dismissedAt < INSTALL_SNOOZE_MS) return 'hidden';
  if (i.canPrompt) return 'prompt';
  if (i.chromium) return 'hidden';
  return /Safari/.test(i.userAgent) && !/Firefox|FxiOS/.test(i.userAgent) ? 'safari' : 'other';
}

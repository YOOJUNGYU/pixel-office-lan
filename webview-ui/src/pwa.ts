// PWA: service worker registration + the "install as app" prompt state.
import { useSyncExternalStore } from 'react';

import { INSTALL_DISMISSED_STORAGE_KEY, VERSION_RELOAD_KEY } from './constants.js';
import type { InstallMode } from './lan/installMode.js';
import { installMode } from './lan/installMode.js';
import { reloadTarget } from './lan/versionReload.js';

declare const __APP_VERSION__: string;

/**
 * officeAccess.version from the server: when it is another version (the page
 * reconnected to an updated server), drop the service worker and its caches
 * and reload, so this same window runs the new version. True = reloading.
 */
export function reloadIfNewVersion(serverVersion: unknown): boolean {
  let tried: string | null = null;
  try {
    tried = sessionStorage.getItem(VERSION_RELOAD_KEY);
  } catch {
    /* no storage: still reload once per page */
  }
  const target = reloadTarget(serverVersion, __APP_VERSION__, tried);
  if (!target) return false;
  try {
    sessionStorage.setItem(VERSION_RELOAD_KEY, target);
  } catch {
    /* see above */
  }
  const unregister =
    'serviceWorker' in navigator
      ? navigator.serviceWorker
          .getRegistrations()
          .then((rs) => Promise.all(rs.map((r) => r.unregister())))
      : Promise.resolve();
  const clearCaches =
    'caches' in window
      ? caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k))))
      : Promise.resolve();
  void Promise.allSettled([unregister, clearCaches]).then(() => window.location.reload());
  return true;
}

/** Chromium's install event (not in lib.dom). */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<unknown>;
}

// ── Browser state (set up once by initPwa) ──────────────────

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
let version = 0;
const listeners = new Set<() => void>();
const changed = () => {
  version++;
  listeners.forEach((l) => l());
};

/** Register the service worker and capture the install event (call before rendering). */
export function initPwa(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // we show our own popup
    deferred = e as BeforeInstallPromptEvent;
    changed();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    deferred = null;
    changed();
  });
  if ('serviceWorker' in navigator && window.isSecureContext && !import.meta.env.DEV) {
    navigator.serviceWorker
      .register(`./sw.js?v=${encodeURIComponent(__APP_VERSION__)}`)
      .catch((err: unknown) => console.warn('[Webview] service worker:', err));
  }
}

function readDismissed(): number | null {
  try {
    const v = Number(localStorage.getItem(INSTALL_DISMISSED_STORAGE_KEY));
    return v > 0 ? v : null;
  } catch {
    return null;
  }
}

/** [Later]: hide for INSTALL_SNOOZE_MS. */
export function dismissInstall(): void {
  try {
    localStorage.setItem(INSTALL_DISMISSED_STORAGE_KEY, String(Date.now()));
  } catch {
    /* hidden for this page only */
  }
  changed();
}

/** [Install]: Chromium's own install dialog. */
export function promptInstall(): void {
  const e = deferred;
  deferred = null; // prompt() works once per event
  changed();
  void e?.prompt().catch(() => {});
}

function currentInstallMode(readOnly: boolean): InstallMode {
  const nav = navigator as Navigator & { standalone?: boolean };
  return installMode({
    standalone: window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true,
    readOnly,
    secure: window.isSecureContext,
    installed,
    canPrompt: deferred !== null,
    chromium: 'onbeforeinstallprompt' in window,
    userAgent: navigator.userAgent,
    dismissedAt: readDismissed(),
    now: Date.now(),
  });
}

/** Re-evaluated on install events and [Later]; the 7-day snooze is checked per render. */
export function useInstallMode(readOnly: boolean): InstallMode {
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
  return currentInstallMode(readOnly);
}

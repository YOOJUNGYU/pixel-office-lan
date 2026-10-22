/**
 * Per-viewer color theme. `dark` is the original look and the default; `system`
 * follows prefers-color-scheme. The resolved theme drives `<html data-theme>`
 * (CSS variables in index.css) and the canvas transforms (office/themeColors.ts),
 * read by the renderer every frame — switching never reloads or moves anything.
 */
import { useSyncExternalStore } from 'react';

import { THEME_META_COLORS, THEME_STORAGE_KEY } from './constants.js';

export type Theme = 'dark' | 'light';
export type ThemePref = Theme | 'system';
export const THEME_PREFS: readonly ThemePref[] = ['dark', 'light', 'system'];

const SYSTEM_LIGHT_QUERY = '(prefers-color-scheme: light)';

/** The DOM bits used here, typed locally: this module also loads under Node (tests). */
const env = globalThis as unknown as {
  document?: {
    documentElement: { dataset: Record<string, string | undefined> };
    querySelector(sel: string): { setAttribute(name: string, value: string): void } | null;
  };
  matchMedia?: (q: string) => {
    matches: boolean;
    addEventListener(type: 'change', listener: () => void): void;
  };
};

export function parseThemePref(v: unknown): ThemePref {
  return v === 'light' || v === 'system' ? v : 'dark';
}

export function resolveTheme(pref: ThemePref, systemLight: boolean): Theme {
  return pref === 'system' ? (systemLight ? 'light' : 'dark') : pref;
}

function loadPref(): ThemePref {
  try {
    return parseThemePref(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'dark';
  }
}

function systemLight(): boolean {
  return env.matchMedia?.(SYSTEM_LIGHT_QUERY).matches ?? false;
}

let pref: ThemePref = loadPref();
let theme: Theme = resolveTheme(pref, systemLight());
const listeners = new Set<() => void>();

function apply(): void {
  theme = resolveTheme(pref, systemLight());
  if (env.document) {
    env.document.documentElement.dataset.theme = theme;
    env.document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', THEME_META_COLORS[theme]);
  }
  for (const l of listeners) l();
}

apply();
env.matchMedia?.(SYSTEM_LIGHT_QUERY).addEventListener('change', () => {
  if (pref === 'system') apply();
});

/** The theme in effect (renderer reads this every frame). */
export function getTheme(): Theme {
  return theme;
}

export function getThemePref(): ThemePref {
  return pref;
}

export function setThemePref(next: ThemePref): void {
  pref = next;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    /* not persisted; still applies for this page */
  }
  apply();
}

/** Current preference; re-renders the caller when it changes. */
export function useThemePref(): ThemePref {
  return useSyncExternalStore((cb) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }, getThemePref);
}

/**
 * `cli.js --open`: show the office as an app window, not a browser tab.
 * Windows: the installed PWA (Edge, then Chrome) via `--app-id`, else an
 * Edge/Chrome `--app=` window, else the default browser. macOS/Linux: the
 * default browser.
 */
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { WEB_APP_ID_BYTES } from '../constants.js';

/**
 * Chromium's web app id: GenerateAppIdFromManifestId = crx_file::id_util::GenerateId(SHA-256(manifest id URL)),
 * and GenerateId is itself SHA-256 → first 16 bytes → hex digits 0-f as letters a-p.
 */
export function webAppId(manifestIdUrl: string): string {
  const inner = createHash('sha256').update(manifestIdUrl).digest();
  const hex = createHash('sha256')
    .update(inner)
    .digest()
    .subarray(0, WEB_APP_ID_BYTES)
    .toString('hex');
  return Array.from(hex, (h) => String.fromCharCode(0x61 + parseInt(h, 16))).join('');
}

export interface Launch {
  cmd: string;
  args: string[];
}

interface WinEnv {
  LOCALAPPDATA?: string;
  ProgramFiles?: string;
  'ProgramFiles(x86)'?: string;
}

interface Fs {
  exists: (p: string) => boolean;
  /** Folder names directly under `dir` ([] when missing). */
  list: (dir: string) => string[];
}

const BROWSERS = [
  { exe: ['Microsoft', 'Edge', 'Application', 'msedge.exe'], data: ['Microsoft', 'Edge'] },
  { exe: ['Google', 'Chrome', 'Application', 'chrome.exe'], data: ['Google', 'Chrome'] },
] as const;

/** Windows launch plan for `url` (origin + '/', which is also the manifest id). */
export function planWindowsOpen(url: string, env: WinEnv, fsx: Fs): Launch {
  const appId = webAppId(url);
  const found = BROWSERS.map((b) => {
    const roots = [env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA];
    const exe = roots
      .filter((r): r is string => !!r)
      .map((r) => path.win32.join(r, ...b.exe))
      .find(fsx.exists);
    return {
      exe,
      userData: env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, ...b.data, 'User Data'),
    };
  }).filter((b): b is { exe: string; userData: string | undefined } => !!b.exe);

  for (const { exe, userData } of found) {
    if (!userData) continue;
    const profiles = fsx
      .list(userData)
      .filter((p) => p === 'Default' || p.startsWith('Profile '))
      .sort((a, z) => (a === 'Default' ? -1 : z === 'Default' ? 1 : a.localeCompare(z)));
    const profile = profiles.find((p) =>
      fsx.exists(path.win32.join(userData, p, 'Web Applications', 'Manifest Resources', appId)),
    );
    if (profile) return { cmd: exe, args: [`--profile-directory=${profile}`, `--app-id=${appId}`] };
  }
  if (found[0]) return { cmd: found[0].exe, args: [`--app=${url}`] };
  return { cmd: 'cmd', args: ['/c', 'start', '', url] }; // '' = window title, as start expects
}

function listDirs(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

/** Best effort: a missing browser must not take the server down. */
export function openOffice(url: string): void {
  const { cmd, args } =
    process.platform === 'win32'
      ? planWindowsOpen(url, process.env, { exists: fs.existsSync, list: listDirs })
      : { cmd: process.platform === 'darwin' ? 'open' : 'xdg-open', args: [url] };
  try {
    // Hide only cmd's console: windowsHide would also start a browser's first window hidden.
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: cmd === 'cmd' });
    child.on('error', () => {});
    child.unref();
  } catch {
    // ignore
  }
}

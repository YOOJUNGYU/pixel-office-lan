/**
 * Start at login, per user, toggled from Settings (and by the installer via
 * `cli.js --autostart on|off|default`).
 *
 * - win32: a shortcut in the user's Startup folder → wscript "<install>\launch.vbs".
 *   A .lnk needs COM, so PowerShell's WScript.Shell writes it; every path is
 *   passed through environment variables (never spliced into the command) and
 *   comes from process.execPath / %APPDATA% only.
 * - darwin: ~/Library/LaunchAgents/com.pixeloffice.agent.plist, copied from the
 *   template shipped in the app (the one postinstall uses). No launchctl: a
 *   bootout would kill this very server; the change applies at next login.
 * - anything else, or not running from an installed layout: unsupported.
 *
 * The marker file records an explicit "off" so a silent update (`default`)
 * doesn't turn it back on.
 */
import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  AUTOSTART_EXEC_TIMEOUT_MS,
  AUTOSTART_OFF_MARKER,
  LAYOUT_FILE_DIR,
  MAC_AGENT_PLIST_NAME,
  MAC_LAUNCH_AGENTS_SUBDIR,
  WIN_DEFAULT_SYSTEM_ROOT,
  WIN_LAUNCHER_NAME,
  WIN_STARTUP_LINK_NAME,
  WIN_STARTUP_SUBDIR,
} from '../constants.js';

export interface AutostartState {
  enabled: boolean;
  supported: boolean;
}

/** Everything that touches the machine, injectable for tests. */
export interface AutostartDeps {
  platform: NodeJS.Platform;
  execPath: string;
  env: NodeJS.ProcessEnv;
  home: string;
  exists(p: string): boolean;
  copyFile(from: string, to: string): void;
  remove(p: string): void;
  mkdir(p: string): void;
  writeFile(p: string, data: string): void;
  /** Run a program (no shell) with extra env vars; rejects on failure. */
  run(file: string, args: string[], env: Record<string, string>): Promise<void>;
}

export const realDeps = (): AutostartDeps => ({
  platform: process.platform,
  execPath: process.execPath,
  env: process.env,
  home: os.homedir(),
  exists: (p) => fs.existsSync(p),
  copyFile: (a, b) => fs.copyFileSync(a, b),
  remove: (p) => fs.rmSync(p, { force: true }),
  mkdir: (p) => fs.mkdirSync(p, { recursive: true }),
  writeFile: (p, d) => fs.writeFileSync(p, d),
  run: (file, args, env) =>
    new Promise((resolve, reject) => {
      execFile(
        file,
        args,
        { env: { ...process.env, ...env }, timeout: AUTOSTART_EXEC_TIMEOUT_MS, windowsHide: true },
        (err) => (err ? reject(err) : resolve()),
      );
    }),
});

/** Writes the shortcut from $env:PO_* only — nothing user-controlled in the script text. */
const PS_CREATE_LINK =
  '$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:PO_LNK);' +
  '$s.TargetPath=$env:PO_TARGET;$s.Arguments=$env:PO_ARGS;' +
  '$s.WorkingDirectory=$env:PO_DIR;$s.Save()';

type Plan =
  | { kind: 'win'; link: string; installDir: string; systemRoot: string }
  | { kind: 'mac'; plist: string; template: string }
  | null;

function plan(d: AutostartDeps): Plan {
  if (d.platform === 'win32') {
    const w = path.win32;
    const installDir = w.dirname(d.execPath);
    const appData = d.env.APPDATA;
    if (!appData || !d.exists(w.join(installDir, WIN_LAUNCHER_NAME))) return null;
    return {
      kind: 'win',
      link: w.join(appData, ...WIN_STARTUP_SUBDIR, WIN_STARTUP_LINK_NAME),
      installDir,
      systemRoot: d.env.SystemRoot ?? WIN_DEFAULT_SYSTEM_ROOT,
    };
  }
  if (d.platform === 'darwin') {
    const template = path.posix.join(path.posix.dirname(d.execPath), MAC_AGENT_PLIST_NAME);
    if (!d.exists(template)) return null;
    return {
      kind: 'mac',
      template,
      plist: path.posix.join(d.home, ...MAC_LAUNCH_AGENTS_SUBDIR, MAC_AGENT_PLIST_NAME),
    };
  }
  return null;
}

const markerPath = (d: AutostartDeps) => path.join(d.home, LAYOUT_FILE_DIR, AUTOSTART_OFF_MARKER);

export function getAutostart(d: AutostartDeps = realDeps()): AutostartState {
  const p = plan(d);
  if (!p) return { enabled: false, supported: false };
  return { enabled: d.exists(p.kind === 'win' ? p.link : p.plist), supported: true };
}

/** Turn start-at-login on/off. Returns the resulting state (re-read, not assumed). */
export async function setAutostart(
  enabled: boolean,
  d: AutostartDeps = realDeps(),
): Promise<AutostartState> {
  const p = plan(d);
  if (!p) return { enabled: false, supported: false };
  const marker = markerPath(d);
  try {
    if (p.kind === 'win') {
      if (enabled) {
        const w = path.win32;
        d.mkdir(w.dirname(p.link));
        await d.run(
          w.join(p.systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
          [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            PS_CREATE_LINK,
          ],
          {
            PO_LNK: p.link,
            PO_TARGET: w.join(p.systemRoot, 'System32', 'wscript.exe'),
            PO_ARGS: `"${w.join(p.installDir, WIN_LAUNCHER_NAME)}"`,
            PO_DIR: p.installDir,
          },
        );
      } else {
        d.remove(p.link);
      }
    } else if (enabled) {
      d.mkdir(path.posix.dirname(p.plist));
      d.copyFile(p.template, p.plist);
    } else {
      d.remove(p.plist);
    }
    if (enabled) {
      d.remove(marker);
    } else {
      d.mkdir(path.dirname(marker));
      d.writeFile(marker, '');
    }
  } catch (err) {
    console.error('[Pixel Office] Failed to change start-at-login:', err);
  }
  return getAutostart(d);
}

/**
 * Installer hook (`cli.js --autostart <mode>`): `on`/`off` = the user's
 * explicit checkbox; `default` (silent update) = on unless the user turned it
 * off before.
 */
export async function applyInstallerChoice(
  mode: 'on' | 'off' | 'default',
  d: AutostartDeps = realDeps(),
): Promise<AutostartState> {
  if (mode === 'default' && d.exists(markerPath(d))) return getAutostart(d);
  return setAutostart(mode !== 'off', d);
}

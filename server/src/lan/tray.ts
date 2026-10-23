/**
 * Tray icon (Windows notification area / macOS menu bar) so a background
 * server can be opened and fully quit. No dependencies: a helper child process
 * built from OS built-ins draws it —
 *
 * - win32: `PixelOfficeTray.exe --pid <pid>` next to node.exe (C# WinForms NotifyIcon,
 *   scripts/package/tray/, built by package.yml, installed by windows.iss). Never
 *   PowerShell: a hidden -EncodedCommand helper gets the install deleted by endpoint AV.
 *   Exits when the server pid is gone (polled every second). Missing exe (dev) = no tray.
 * - darwin: `osascript -l JavaScript` (JXA) with NSStatusBar + NSMenu,
 *   accessory policy (no Dock icon); icon `Contents/Resources/AppIcon.icns`,
 *   else the title "PO". Exits on stdin EOF (the server's end of the pipe).
 *
 * IPC = one word per line on the helper's stdout: `ko`|`en` (OS UI language,
 * before `ready`), `ready`, `open`, `quit`; one command per line on its stdin:
 * `notify <base64 of the UTF-8 body>` → an OS notification titled "Pixel Office"
 * (win32 balloon tip = a toast attributed to the exe; darwin `displayNotification`).
 * Values reach the helpers only through argv/env (PO_*) and base64 stdin lines,
 * never spliced into script text. A helper that dies is logged, never respawned.
 */
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createInterface } from 'node:readline';

import {
  MAC_OSASCRIPT,
  MAC_TRAY_ICON_NAME,
  NO_TRAY_ENV,
  TRAY_CHECK_TIMEOUT_MS,
  TRAY_SMOKE_ENV,
  WIN_TRAY_EXE_NAME,
} from '../constants.js';

export const TRAY_EVENTS = ['ready', 'open', 'quit', 'ko', 'en'] as const;
export type TrayEvent = (typeof TRAY_EVENTS)[number];

export function parseTrayLine(line: string): TrayEvent | null {
  const word = line.trim();
  return (TRAY_EVENTS as readonly string[]).includes(word) ? (word as TrayEvent) : null;
}

/** The stdin line that shows `body` as a notification: base64, so it is data to the helper. */
export function notifyCommand(body: string): string {
  return `notify ${Buffer.from(body, 'utf8').toString('base64')}\n`;
}

export const MAC_TRAY_JXA = String.raw`
ObjC.import('Cocoa');
const env = $.NSProcessInfo.processInfo.environment;
function getEnv(k) { const v = env.objectForKey(k); return v.isNil() ? '' : ObjC.unwrap(v); }
const stdout = $.NSFileHandle.fileHandleWithStandardOutput;
const stdin = $.NSFileHandle.fileHandleWithStandardInput;
function say(s) { try { stdout.writeData($(s + '\n').dataUsingEncoding($.NSUTF8StringEncoding)); } catch (e) {} }
const lang = $.NSLocale.preferredLanguages.firstObject;
const ko = !lang.isNil() && ObjC.unwrap(lang).indexOf('ko') === 0;
const sa = Application.currentApplication();
sa.includeStandardAdditions = true;
let buf = '';
function onLine(l) {
  const m = /^notify ([A-Za-z0-9+\/=]+)$/.exec(l);
  if (!m) return;
  const d = $.NSData.alloc.initWithBase64EncodedStringOptions(m[1], 0);
  if (d.isNil()) return;
  const body = ObjC.unwrap($.NSString.alloc.initWithDataEncoding(d, $.NSUTF8StringEncoding));
  try { sa.displayNotification(String(body), { withTitle: 'Pixel Office' }); } catch (e) {}
}
const app = $.NSApplication.sharedApplication;
app.setActivationPolicy(1); // NSApplicationActivationPolicyAccessory: no Dock icon
ObjC.registerSubclass({
  name: 'POTrayTarget',
  methods: {
    'open:': { types: ['void', ['id']], implementation: function () { say('open'); } },
    'quit:': { types: ['void', ['id']], implementation: function () { say('quit'); app.terminate(null); } },
    'stdinRead:': {
      types: ['void', ['id']],
      implementation: function (n) {
        const data = n.userInfo.objectForKey($.NSFileHandleNotificationDataItem);
        if (data.isNil() || data.length === 0) { app.terminate(null); return; }
        buf += ObjC.unwrap($.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding)) || '';
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const l of lines) onLine(l.replace(/\r$/, ''));
        stdin.readInBackgroundAndNotify;
      },
    },
  },
});
const target = $.POTrayTarget.alloc.init;
const item = $.NSStatusBar.systemStatusBar.statusItemWithLength(-1); // NSVariableStatusItemLength
const iconPath = getEnv('PO_ICON');
const img = iconPath ? $.NSImage.alloc.initWithContentsOfFile(iconPath) : null;
if (img && !img.isNil()) { img.setSize($.NSMakeSize(18, 18)); item.button.image = img; }
else item.button.title = 'PO';
item.button.toolTip = 'Pixel Office';
const menu = $.NSMenu.alloc.init;
function add(title, sel) {
  const mi = $.NSMenuItem.alloc.initWithTitleActionKeyEquivalent(title, sel, '');
  mi.target = target;
  menu.addItem(mi);
}
add(ko ? 'Pixel Office 열기' : 'Open Pixel Office', 'open:');
menu.addItem($.NSMenuItem.separatorItem);
add(ko ? 'Pixel Office 종료' : 'Quit Pixel Office', 'quit:');
item.menu = menu;
$.NSNotificationCenter.defaultCenter.addObserverSelectorNameObject(target, 'stdinRead:', $.NSFileHandleReadCompletionNotification, stdin);
stdin.readInBackgroundAndNotify;
say(ko ? 'ko' : 'en');
say('ready');
if (getEnv('PO_TRAY_SMOKE') === '1') $.NSStatusBar.systemStatusBar.removeStatusItem(item);
else app.run;
`;

export interface TrayLaunch {
  cmd: string;
  args: string[];
  env: Record<string, string>;
}

/** How to start the helper on this OS; null = no tray here (Linux, WSL). */
export function trayLaunch(
  platform: NodeJS.Platform,
  execPath: string,
  pid: number,
): TrayLaunch | null {
  if (platform === 'win32') {
    return {
      cmd: path.win32.join(path.win32.dirname(execPath), WIN_TRAY_EXE_NAME),
      args: ['--pid', pid.toString()],
      env: {},
    };
  }
  if (platform === 'darwin') {
    return {
      cmd: MAC_OSASCRIPT,
      args: ['-l', 'JavaScript', '-e', MAC_TRAY_JXA],
      env: { PO_ICON: path.posix.join(path.posix.dirname(execPath), MAC_TRAY_ICON_NAME) },
    };
  }
  return null;
}

/** Whether the server should start a tray helper (not in tests: PIXEL_OFFICE_NO_TRAY=1). */
export function wantTray(env: NodeJS.ProcessEnv): boolean {
  return env[NO_TRAY_ENV] !== '1';
}

/** This server's helper, if this OS has one and it is installed (a dev run has no tray exe). */
function helperLaunch(): TrayLaunch | null {
  const launch = trayLaunch(process.platform, process.execPath, process.pid);
  if (launch && !fs.existsSync(launch.cmd)) {
    console.warn(
      `[Pixel Office] 트레이 도우미가 없어 트레이 아이콘 없이 실행합니다: ${launch.cmd}`,
    );
    return null;
  }
  return launch;
}

function spawnHelper(launch: TrayLaunch, extraEnv: Record<string, string> = {}) {
  return spawn(launch.cmd, launch.args, {
    env: { ...process.env, ...launch.env, ...extraEnv },
    stdio: ['pipe', 'pipe', 'inherit'],
    windowsHide: true,
  });
}

/** OS notifications through the tray helper; `lang` = the OS UI language it reported. */
export interface TrayNotifier {
  lang: 'ko' | 'en';
  /** false = no helper here (Linux/WSL, tests) or it died: the caller logs instead. */
  notify(body: string): boolean;
}

/** Start the tray for this server. Best effort: a failing helper only logs. */
export function startTray(handlers: { onOpen: () => void; onQuit: () => void }): TrayNotifier {
  const tray: TrayNotifier = { lang: 'en', notify: () => false };
  if (!wantTray(process.env)) return tray;
  const launch = helperLaunch();
  if (!launch) return tray;
  try {
    const child = spawnHelper(launch);
    child.stdin.on('error', () => {}); // a dead helper: notify() reports false, nothing throws
    tray.notify = (body) => {
      if (child.exitCode !== null || !child.stdin.writable) return false;
      child.stdin.write(notifyCommand(body));
      return true;
    };
    child.on('error', (err) =>
      console.warn('[Pixel Office] 트레이 아이콘을 띄우지 못했습니다:', err),
    );
    child.on('exit', (code) =>
      console.warn(`[Pixel Office] 트레이 아이콘이 종료되었습니다 (exit ${String(code)})`),
    );
    createInterface({ input: child.stdout }).on('line', (line) => {
      const ev = parseTrayLine(line);
      if (ev === 'open') handlers.onOpen();
      else if (ev === 'quit') handlers.onQuit();
      else if (ev === 'ko' || ev === 'en') tray.lang = ev;
    });
  } catch (err) {
    console.warn('[Pixel Office] 트레이 아이콘을 띄우지 못했습니다:', err);
  }
  return tray;
}

/** `cli.js --tray-check`: start the helper in smoke mode; true once it prints `ready`. */
export function trayCheck(): Promise<boolean> {
  const launch = helperLaunch();
  if (!launch) return Promise.resolve(false);
  return new Promise((resolve) => {
    const child = spawnHelper(launch, { [TRAY_SMOKE_ENV]: '1' });
    const timer = setTimeout(() => {
      child.kill();
      resolve(false);
    }, TRAY_CHECK_TIMEOUT_MS);
    let ready = false;
    createInterface({ input: child.stdout }).on('line', (line) => {
      if (parseTrayLine(line) === 'ready') ready = true;
    });
    child.on('error', () => resolve(false));
    child.on('close', () => {
      clearTimeout(timer);
      resolve(ready);
    });
  });
}

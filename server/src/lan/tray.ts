/**
 * Tray icon (Windows notification area / macOS menu bar) so a background
 * server can be opened and fully quit. No dependencies: a helper child process
 * built from OS built-ins draws it —
 *
 * - win32: `powershell.exe -STA` with System.Windows.Forms.NotifyIcon
 *   (icon: `<install>\icon.ico`, else node.exe's icon, else the system one).
 *   Exits when the server pid is gone (polled every second).
 * - darwin: `osascript -l JavaScript` (JXA) with NSStatusBar + NSMenu,
 *   accessory policy (no Dock icon); icon `Contents/Resources/AppIcon.icns`,
 *   else the title "PO". Exits on stdin EOF (the server's end of the pipe).
 *
 * IPC = one word per line on the helper's stdout: `ko`|`en` (OS UI language,
 * before `ready`), `ready`, `open`, `quit`; one command per line on its stdin:
 * `notify <base64 of the UTF-8 body>` → an OS notification titled "Pixel Office"
 * (win32 toast under our AppUserModelID, else a balloon tip; darwin `displayNotification`). Values reach the scripts
 * only through environment variables (PO_*) and base64 stdin lines, never
 * spliced into the script text. A helper that dies is logged, never respawned.
 */
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { createInterface } from 'node:readline';

import {
  MAC_OSASCRIPT,
  MAC_TRAY_ICON_NAME,
  NO_TRAY_ENV,
  TRAY_CHECK_TIMEOUT_MS,
  TRAY_SMOKE_ENV,
  WIN_DEFAULT_SYSTEM_ROOT,
  WIN_NOTIFY_AUMID,
  WIN_TRAY_ICON_NAME,
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

export const WIN_TRAY_PS = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
function Say($s) { try { [Console]::Out.WriteLine($s); [Console]::Out.Flush() } catch {} }
$ko = [Globalization.CultureInfo]::CurrentUICulture.TwoLetterISOLanguageName -eq 'ko'
$icon = $null
try { if ($env:PO_ICON -and (Test-Path -LiteralPath $env:PO_ICON)) { $icon = New-Object System.Drawing.Icon $env:PO_ICON } } catch {}
if (-not $icon) { try { $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($env:PO_NODE) } catch {} }
if (-not $icon) { $icon = [System.Drawing.SystemIcons]::Application }
$ni = New-Object System.Windows.Forms.NotifyIcon
$ni.Icon = $icon
$ni.Text = 'Pixel Office'
function Leave { try { $ni.Visible = $false; $ni.Dispose() } catch {}; [System.Windows.Forms.Application]::Exit() }
# Notifications: a real toast under our own AppUserModelID (HKCU registration = per user, no
# admin: header "Pixel Office" + our icon), else the NotifyIcon balloon (shown as PowerShell).
$toast = $null
try {
  $k = "HKCU:\Software\Classes\AppUserModelId\$env:PO_AUMID"
  [void](New-Item -Path $k -Force)
  [void](New-ItemProperty -Path $k -Name DisplayName -Value 'Pixel Office' -PropertyType String -Force)
  if ($env:PO_ICON -and (Test-Path -LiteralPath $env:PO_ICON)) { [void](New-ItemProperty -Path $k -Name IconUri -Value $env:PO_ICON -PropertyType String -Force) }
  [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
  [void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
  $toast = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($env:PO_AUMID)
} catch {}
function Notify($b) {
  if ($toast) {
    try {
      $x = New-Object Windows.Data.Xml.Dom.XmlDocument
      $x.LoadXml('<toast><visual><binding template="ToastGeneric"><text>Pixel Office</text><text/></binding></visual></toast>')
      $x.GetElementsByTagName('text').Item(1).InnerText = $b # a text node: never parsed as XML
      $toast.Show([Windows.UI.Notifications.ToastNotification]::new($x))
      return
    } catch {}
  }
  try { $ni.ShowBalloonTip(5000, 'Pixel Office', $b, [System.Windows.Forms.ToolTipIcon]::None) } catch {}
}
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$open = $menu.Items.Add($(if ($ko) { 'Pixel Office 열기' } else { 'Open Pixel Office' }))
$open.add_Click({ Say 'open' })
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$quit = $menu.Items.Add($(if ($ko) { 'Pixel Office 종료' } else { 'Quit Pixel Office' }))
$quit.add_Click({ Say 'quit'; Leave })
$ni.ContextMenuStrip = $menu
$script:last = [DateTime]::MinValue
$ni.add_MouseClick({ param($s, $e)
  if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left -and ([DateTime]::Now - $script:last).TotalSeconds -gt 1) {
    $script:last = [DateTime]::Now; Say 'open'
  } })
$ni.Visible = $true
Say $(if ($ko) { 'ko' } else { 'en' })
Say 'ready'
if ($env:PO_TRAY_SMOKE -eq '1') { $ni.Visible = $false; $ni.Dispose(); exit 0 }
$parent = $null
try { if ([int]$env:PO_PID -gt 0) { $parent = [System.Diagnostics.Process]::GetProcessById([int]$env:PO_PID) } } catch {}
if (-not $parent) { Leave; exit 0 }
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 1000
$in = New-Object System.IO.StreamReader([Console]::OpenStandardInput())
$script:line = $in.ReadLineAsync()
$timer.add_Tick({
  try { if ($parent.HasExited) { Leave; return } } catch { Leave; return }
  while ($script:line -and $script:line.IsCompleted) {
    $l = $script:line.Result
    if ($null -eq $l) { $script:line = $null; break }
    if ($l -match '^notify ([A-Za-z0-9+/=]+)$') {
      try { Notify ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Matches[1]))) } catch {}
    }
    $script:line = $in.ReadLineAsync()
  } })
$timer.Start()
[System.Windows.Forms.Application]::Run()
`;

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
  env: NodeJS.ProcessEnv,
  execPath: string,
  pid: number,
): TrayLaunch | null {
  if (platform === 'win32') {
    const w = path.win32;
    const root = env.SystemRoot ?? WIN_DEFAULT_SYSTEM_ROOT;
    return {
      cmd: w.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      args: [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-WindowStyle',
        'Hidden',
        '-STA',
        '-EncodedCommand',
        Buffer.from(WIN_TRAY_PS, 'utf16le').toString('base64'),
      ],
      env: {
        PO_PID: pid.toString(),
        PO_NODE: execPath,
        PO_ICON: w.join(w.dirname(execPath), WIN_TRAY_ICON_NAME),
        PO_AUMID: WIN_NOTIFY_AUMID,
      },
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
  const launch = trayLaunch(process.platform, process.env, process.execPath, process.pid);
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
  const launch = trayLaunch(process.platform, process.env, process.execPath, process.pid);
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

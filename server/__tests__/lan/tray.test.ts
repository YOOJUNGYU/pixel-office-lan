import { readFileSync } from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  MAC_TRAY_JXA,
  notifyCommand,
  parseTrayLine,
  trayLaunch,
  wantTray,
} from '../../src/lan/tray.js';

const TRAY_CS = path.join(__dirname, '../../../scripts/package/tray/PixelOfficeTray.cs');

describe('tray helper', () => {
  it('parses one event word per stdout line, ignoring noise', () => {
    expect(parseTrayLine('open')).toBe('open');
    expect(parseTrayLine('quit\r')).toBe('quit');
    expect(parseTrayLine('  ready ')).toBe('ready');
    expect(parseTrayLine('')).toBeNull();
    expect(parseTrayLine('#< CLIXML')).toBeNull();
    expect(parseTrayLine('open now')).toBeNull();
  });

  it('is skipped with PIXEL_OFFICE_NO_TRAY=1 (tests) and on other OSes', () => {
    expect(wantTray({ PIXEL_OFFICE_NO_TRAY: '1' })).toBe(false);
    expect(wantTray({})).toBe(true);
    expect(trayLaunch('linux', '/usr/bin/node', 1)).toBeNull();
  });

  it('Windows: the PixelOfficeTray.exe next to node.exe, never PowerShell', () => {
    const l = trayLaunch('win32', 'C:\\Pixel Office\\node.exe', 42)!;
    expect(l).toEqual({
      cmd: 'C:\\Pixel Office\\PixelOfficeTray.exe',
      args: ['--pid', '42'],
      env: {},
    });
    const cmdline = `${l.cmd} ${l.args.join(' ')}`.toLowerCase();
    for (const bad of ['powershell', 'encodedcommand', 'bypass', 'hidden']) {
      expect(cmdline).not.toContain(bad);
    }
  });

  it('macOS: JXA through osascript, icon next to node', () => {
    const l = trayLaunch('darwin', '/Applications/Pixel Office.app/Contents/Resources/node', 42)!;
    expect(l.cmd).toBe('/usr/bin/osascript');
    expect(l.args).toEqual(['-l', 'JavaScript', '-e', MAC_TRAY_JXA]);
    expect(l.env.PO_ICON).toBe('/Applications/Pixel Office.app/Contents/Resources/AppIcon.icns');
  });

  it('the helpers speak the same words the server parses', () => {
    const cs = readFileSync(TRAY_CS, 'utf8');
    expect(MAC_TRAY_JXA).toContain(`say(ko ? 'ko' : 'en')`);
    expect(cs).toContain('Say(ko ? "ko" : "en")');
    expect(parseTrayLine('ko')).toBe('ko');
    for (const word of ['ready', 'open', 'quit']) {
      expect(MAC_TRAY_JXA).toContain(`say('${word}')`);
      expect(cs).toContain(`Say("${word}")`);
    }
    // The exe stays boring: no registry, no child processes, no network.
    for (const bad of ['Registry', 'Process.Start', 'System.Net', 'AppUserModel']) {
      expect(cs).not.toContain(bad);
    }
  });

  it('the JXA script is valid JavaScript', () => {
    // osacompile runs in CI (package.yml, macOS); here at least the syntax.
    expect(() => new Function(MAC_TRAY_JXA)).not.toThrow();
  });

  it('a notification is one base64 stdin line: hostile text stays data', () => {
    const body = 'a\'b"c\n$(rm -rf ~)`whoami`;\r\nnotify x ${x} 한글 \u202e';
    const cmd = notifyCommand(body);
    // The same pattern both helpers accept (PixelOfficeTray.cs Regex, JXA RegExp).
    const re = /^notify ([A-Za-z0-9+/=]+)$/;
    expect(cmd.endsWith('\n')).toBe(true);
    const lines = cmd.slice(0, -1).split('\n');
    expect(lines).toHaveLength(1);
    const m = re.exec(lines[0])!;
    expect(Buffer.from(m[1], 'base64').toString('utf8')).toBe(body);
    expect(readFileSync(TRAY_CS, 'utf8')).toContain('new Regex("^notify ([A-Za-z0-9+/=]+)$")');
    expect(MAC_TRAY_JXA).toContain('/^notify ([A-Za-z0-9+\\/=]+)$/');
  });
});

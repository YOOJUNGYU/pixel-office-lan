import { describe, expect, it } from 'vitest';

import {
  MAC_TRAY_JXA,
  parseTrayLine,
  trayLaunch,
  wantTray,
  WIN_TRAY_PS,
} from '../../src/lan/tray.js';

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
    expect(trayLaunch('linux', {}, '/usr/bin/node', 1)).toBeNull();
  });

  it('Windows: hidden STA PowerShell, script as -EncodedCommand, values only via env', () => {
    const l = trayLaunch('win32', { SystemRoot: 'D:\\Win' }, 'C:\\Pixel Office\\node.exe', 42)!;
    expect(l.cmd).toBe('D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect(l.args).toEqual(
      expect.arrayContaining(['-NoProfile', '-STA', '-WindowStyle', 'Hidden']),
    );
    const enc = l.args[l.args.indexOf('-EncodedCommand') + 1];
    expect(Buffer.from(enc, 'base64').toString('utf16le')).toBe(WIN_TRAY_PS);
    expect(l.env).toEqual({
      PO_PID: '42',
      PO_NODE: 'C:\\Pixel Office\\node.exe',
      PO_ICON: 'C:\\Pixel Office\\icon.ico',
    });
    // Windows' command line limit is 32767 chars.
    expect(enc.length).toBeLessThan(16_000);
  });

  it('macOS: JXA through osascript, icon next to node', () => {
    const l = trayLaunch(
      'darwin',
      {},
      '/Applications/Pixel Office.app/Contents/Resources/node',
      42,
    )!;
    expect(l.cmd).toBe('/usr/bin/osascript');
    expect(l.args).toEqual(['-l', 'JavaScript', '-e', MAC_TRAY_JXA]);
    expect(l.env.PO_ICON).toBe('/Applications/Pixel Office.app/Contents/Resources/AppIcon.icns');
  });

  it('the scripts speak the same words the server parses', () => {
    for (const word of ['ready', 'open', 'quit']) {
      expect(WIN_TRAY_PS).toContain(`Say '${word}'`);
      expect(MAC_TRAY_JXA).toContain(`say('${word}')`);
    }
  });

  it('the JXA script is valid JavaScript', () => {
    // osacompile runs in CI (package.yml, macOS); here at least the syntax.
    expect(() => new Function(MAC_TRAY_JXA)).not.toThrow();
  });
});

import { describe, expect, it } from 'vitest';

import type { AutostartDeps } from '../../src/lan/autostart.js';
import { applyInstallerChoice, getAutostart, setAutostart } from '../../src/lan/autostart.js';

/** In-memory machine: a set of existing files plus a log of every action. */
function fake(platform: NodeJS.Platform, execPath: string, files: string[], env = {}) {
  const fsSet = new Set(files);
  const log: string[] = [];
  const runs: { file: string; args: string[]; env: Record<string, string> }[] = [];
  const deps: AutostartDeps = {
    platform,
    execPath,
    env,
    home: '/home/u',
    exists: (p) => fsSet.has(p),
    copyFile: (a, b) => {
      log.push(`copy ${a} -> ${b}`);
      fsSet.add(b);
    },
    remove: (p) => {
      log.push(`rm ${p}`);
      fsSet.delete(p);
    },
    mkdir: (p) => log.push(`mkdir ${p}`),
    writeFile: (p) => {
      log.push(`write ${p}`);
      fsSet.add(p);
    },
    run: async (file, args, e) => {
      runs.push({ file, args, env: e });
      fsSet.add(e.PO_LNK); // PowerShell would have written the shortcut
    },
  };
  return { deps, fsSet, log, runs };
}

const WIN_EXE = 'C:\\Program Files\\PixelOffice\\node.exe';
const WIN_VBS = 'C:\\Program Files\\PixelOffice\\launch.vbs';
const WIN_ENV = { APPDATA: 'C:\\Users\\u\\AppData\\Roaming', SystemRoot: 'C:\\Windows' };
const WIN_LNK =
  'C:\\Users\\u\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\Pixel Office.lnk';
const MAC_EXE = '/Applications/Pixel Office.app/Contents/Resources/node';
const MAC_TEMPLATE =
  '/Applications/Pixel Office.app/Contents/Resources/com.pixeloffice.agent.plist';
const MAC_PLIST = '/home/u/Library/LaunchAgents/com.pixeloffice.agent.plist';
const MARKER = '/home/u/.pixel-office/autostart-off';

describe('autostart', () => {
  it('unsupported on linux and on a non-installed (dev) layout', () => {
    expect(getAutostart(fake('linux', '/usr/bin/node', []).deps)).toEqual({
      enabled: false,
      supported: false,
    });
    expect(getAutostart(fake('win32', WIN_EXE, [], WIN_ENV).deps).supported).toBe(false);
    expect(getAutostart(fake('darwin', '/usr/local/bin/node', []).deps).supported).toBe(false);
  });

  it('win32: enable writes the Startup shortcut via env vars, disable removes it', async () => {
    const f = fake('win32', WIN_EXE, [WIN_VBS], WIN_ENV);
    expect(getAutostart(f.deps)).toEqual({ enabled: false, supported: true });
    expect(await setAutostart(true, f.deps)).toEqual({ enabled: true, supported: true });
    const run = f.runs[0];
    expect(run.file).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect(run.env).toEqual({
      PO_LNK: WIN_LNK,
      PO_TARGET: 'C:\\Windows\\System32\\wscript.exe',
      PO_ARGS: `"${WIN_VBS}"`,
      PO_DIR: 'C:\\Program Files\\PixelOffice',
    });
    // No path is spliced into the PowerShell source.
    expect(run.args.join(' ')).not.toContain('Program Files');
    expect(await setAutostart(false, f.deps)).toEqual({ enabled: false, supported: true });
    expect(f.fsSet.has(WIN_LNK)).toBe(false);
    expect(f.fsSet.has(MARKER)).toBe(true);
  });

  it('darwin: copies / removes the LaunchAgent plist, never calls launchctl', async () => {
    const f = fake('darwin', MAC_EXE, [MAC_TEMPLATE]);
    expect(await setAutostart(true, f.deps)).toEqual({ enabled: true, supported: true });
    expect(f.log).toContain(`copy ${MAC_TEMPLATE} -> ${MAC_PLIST}`);
    expect(await setAutostart(false, f.deps)).toEqual({ enabled: false, supported: true });
    expect(f.log).toContain(`rm ${MAC_PLIST}`);
    expect(f.runs).toHaveLength(0);
  });

  it('installer "default" keeps an explicit off; "on" overrides it', async () => {
    const f = fake('darwin', MAC_EXE, [MAC_TEMPLATE]);
    expect((await applyInstallerChoice('default', f.deps)).enabled).toBe(true);
    await setAutostart(false, f.deps); // user turned it off in Settings
    expect((await applyInstallerChoice('default', f.deps)).enabled).toBe(false);
    expect((await applyInstallerChoice('on', f.deps)).enabled).toBe(true);
    expect(f.fsSet.has(MARKER)).toBe(false);
    expect((await applyInstallerChoice('off', f.deps)).enabled).toBe(false);
  });

  it('a failing PowerShell leaves it off and reports the real state', async () => {
    const f = fake('win32', WIN_EXE, [WIN_VBS], WIN_ENV);
    f.deps.run = () => Promise.reject(new Error('blocked'));
    expect(await setAutostart(true, f.deps)).toEqual({ enabled: false, supported: true });
  });
});

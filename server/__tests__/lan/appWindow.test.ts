import { describe, expect, it } from 'vitest';

import { planWindowsOpen, webAppId } from '../../src/lan/appWindow.js';

const URL = 'http://localhost:47801/';
const LOCAL = 'C:\\Users\\me\\AppData\\Local';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ENV = {
  LOCALAPPDATA: LOCAL,
  ProgramFiles: 'C:\\Program Files',
  'ProgramFiles(x86)': 'C:\\Program Files (x86)',
};

function fakeFs(files: string[], dirs: Record<string, string[]> = {}) {
  return { exists: (p: string) => files.includes(p), list: (d: string) => dirs[d] ?? [] };
}
const appDir = (browser: string, profile: string) =>
  `${LOCAL}\\${browser}\\User Data\\${profile}\\Web Applications\\Manifest Resources\\${webAppId(URL)}`;

describe('webAppId', () => {
  it('matches the folder a real Chromium install created', () => {
    // Chromium 1234 (Playwright), PWA.install of http://localhost:47898/ →
    // <profile>/Web Applications/Manifest Resources/nfnhoogkkheoidacojkiajnngpdahoni
    expect(webAppId('http://localhost:47898/')).toBe('nfnhoogkkheoidacojkiajnngpdahoni');
  });
  it('gives the office its fixed id', () => {
    expect(webAppId(URL)).toBe('fjkncnabjjcblkbcihecilehoideemcj');
  });
});

describe('planWindowsOpen', () => {
  it('launches the installed Edge app from the first profile that has it', () => {
    const fs = fakeFs([EDGE, CHROME, appDir('Microsoft\\Edge', 'Profile 2')], {
      [`${LOCAL}\\Microsoft\\Edge\\User Data`]: ['System Profile', 'Profile 2', 'Default'],
    });
    expect(planWindowsOpen(URL, ENV, fs)).toEqual({
      cmd: EDGE,
      args: ['--profile-directory=Profile 2', `--app-id=${webAppId(URL)}`],
    });
  });
  it('falls back to the installed Chrome app', () => {
    const fs = fakeFs([EDGE, CHROME, appDir('Google\\Chrome', 'Default')], {
      [`${LOCAL}\\Google\\Chrome\\User Data`]: ['Default'],
    });
    expect(planWindowsOpen(URL, ENV, fs).args[0]).toBe('--profile-directory=Default');
    expect(planWindowsOpen(URL, ENV, fs).cmd).toBe(CHROME);
  });
  it('opens a normal Edge window (where the install popup shows) when nothing is installed', () => {
    expect(planWindowsOpen(URL, ENV, fakeFs([EDGE, CHROME]))).toEqual({
      cmd: EDGE,
      args: ['--new-window', URL],
    });
  });
  it('finds a per-user Chrome', () => {
    const chrome = `${LOCAL}\\Google\\Chrome\\Application\\chrome.exe`;
    expect(planWindowsOpen(URL, ENV, fakeFs([chrome])).cmd).toBe(chrome);
  });
  it('uses the default browser without Edge or Chrome', () => {
    expect(planWindowsOpen(URL, ENV, fakeFs([]))).toEqual({
      cmd: 'cmd',
      args: ['/c', 'start', '', URL],
    });
  });
});

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadProfile, saveProfile, validateProfileUpdate } from '../../src/lan/profile.js';

const ok = { nickname: ' 김 ', palette: 1, hueShift: 10, hideDetails: true, manualPeers: [] };
let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('loadProfile', () => {
  it('creates defaults, then keeps the same peerId (file mode 0600)', () => {
    const a = loadProfile(dir);
    expect(a).toMatchObject({ nickname: '', hideDetails: true, palette: 0, manualPeers: [] });
    expect(loadProfile(dir).peerId).toBe(a.peerId);
    if (process.platform !== 'win32') {
      expect(fs.statSync(path.join(dir, 'profile.json')).mode & 0o777).toBe(0o600);
    }
  });
  it('round-trips a saved profile', () => {
    const p = { peerId: 'abc', ...ok, nickname: '김', manualPeers: ['10.0.0.1'] };
    saveProfile(p, dir);
    expect(loadProfile(dir)).toEqual(p);
  });
  it('does not throw when nickname is missing', () => {
    const f = path.join(dir, 'profile.json');
    fs.writeFileSync(
      f,
      JSON.stringify({ peerId: 'k', palette: 1, hueShift: 0, hideDetails: true, manualPeers: [] }),
    );
    expect(loadProfile(dir)).toMatchObject({ peerId: 'k', nickname: '', palette: 0 });
  });
  it('keeps a valid peerId when fields are invalid, falls back on garbage', () => {
    fs.writeFileSync(
      path.join(dir, 'profile.json'),
      JSON.stringify({ peerId: 'keep', palette: 99 }),
    );
    const p = loadProfile(dir);
    expect(p.peerId).toBe('keep');
    expect(p.palette).toBe(0);
    fs.writeFileSync(path.join(dir, 'profile.json'), '{nope');
    expect(loadProfile(dir).peerId).toBeTruthy();
  });
});

describe('validateProfileUpdate', () => {
  it('accepts and normalizes', () => {
    const r = validateProfileUpdate({ ...ok, manualPeers: [' 10.0.0.2 ', '', 'pc-1.corp'] });
    expect(r).toEqual({ ...ok, nickname: '김', manualPeers: ['10.0.0.2', 'pc-1.corp'] });
  });
  it.each([
    [{ ...ok, nickname: '  ' }],
    [{ ...ok, nickname: 'x'.repeat(21) }],
    [{ ...ok, palette: 7 }],
    [{ ...ok, hueShift: 361 }],
    [{ ...ok, hideDetails: 'y' }],
    [{ ...ok, manualPeers: ['bad host!'] }],
    [{ ...ok, manualPeers: ['300.1.1.1'] }],
    [{ ...ok, manualPeers: Array(21).fill('1.1.1.1') }],
    [null],
    [[]],
  ])('rejects %j', (x) => expect(validateProfileUpdate(x)).toBeNull());
});

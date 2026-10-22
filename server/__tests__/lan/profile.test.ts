import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PUBLIC_VIEW } from '../../../core/src/lan.js';
import { MAX_KNOWN_PEERS } from '../../src/constants.js';
import { createIdentity, newInviteCode, publicKeyOf } from '../../src/lan/crypto.js';
import {
  KnownPeers,
  loadProfile,
  officeFromSecret,
  saveProfile,
  validateProfileUpdate,
} from '../../src/lan/profile.js';

const mode = (f: string) => fs.statSync(f).mode & 0o777;
const posix = process.platform !== 'win32';

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
    const { publicKey, privateKeyPem } = createIdentity('abc');
    const office = officeFromSecret(newInviteCode().secret, '우리팀');
    const p = {
      peerId: 'abc',
      ...ok,
      nickname: '김',
      manualPeers: ['10.0.0.1'],
      identity: { publicKey, privateKeyPem },
      offices: [office],
      activeView: office.tag,
    };
    saveProfile(p, dir);
    expect(loadProfile(dir)).toEqual(p);
  });
  it('upgrades a v0.1.0 file: key pair generated, public office, 0600', () => {
    const f = path.join(dir, 'profile.json');
    const v1 = { peerId: 'old-pc', ...ok, nickname: '김' };
    fs.writeFileSync(f, JSON.stringify(v1), { mode: 0o644 });
    const p = loadProfile(dir);
    expect(p).toMatchObject({ ...v1, offices: [], activeView: PUBLIC_VIEW });
    expect(publicKeyOf(p.identity.privateKeyPem)).toBe(p.identity.publicKey);
    expect(loadProfile(dir).identity).toEqual(p.identity); // persisted, stable
    if (posix) expect(mode(f)).toBe(0o600);
  });
  it('drops broken offices, derives tags, fixes activeView; secrets only on disk at 0600', () => {
    const code = newInviteCode();
    const good = officeFromSecret(code.secret, '팀');
    fs.writeFileSync(
      path.join(dir, 'profile.json'),
      JSON.stringify({
        peerId: 'pc',
        offices: [
          { ...good, tag: 'forged-tag' },
          good,
          { tag: 't', name: 'x', secret: 'short' },
          'junk',
        ],
        activeView: 'gone',
        identity: { publicKey: 'x', privateKeyPem: 'nope' },
      }),
    );
    const p = loadProfile(dir);
    expect(p.offices).toEqual([good]);
    expect(p.activeView).toBe(good.tag);
    expect(publicKeyOf(p.identity.privateKeyPem)).toBe(p.identity.publicKey);
    if (posix) expect(mode(path.join(dir, 'profile.json'))).toBe(0o600);
  });
  it('a corrupt key pair gets a new peerId with the new key (old pins would ignore it)', () => {
    fs.writeFileSync(
      path.join(dir, 'profile.json'),
      JSON.stringify({ peerId: 'keep', identity: { publicKey: 'x', privateKeyPem: 'broken' } }),
    );
    const p = loadProfile(dir);
    expect(p.peerId).not.toBe('keep');
    expect(publicKeyOf(p.identity.privateKeyPem)).toBe(p.identity.publicKey);
    expect(loadProfile(dir).peerId).toBe(p.peerId);
  });
  it('replaces a peerId that is not a wire id', () => {
    fs.writeFileSync(path.join(dir, 'profile.json'), JSON.stringify({ peerId: 'a|b' }));
    expect(loadProfile(dir).peerId).toMatch(/^[0-9a-f-]{36}$/);
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
  it('never takes identity, offices or views from a client', () => {
    const r = validateProfileUpdate({
      ...ok,
      peerId: 'x',
      identity: { publicKey: 'a', privateKeyPem: 'b' },
      offices: [{ tag: 't', name: 'n', secret: 's' }],
      activeView: 't',
      remoteView: true,
    });
    expect(Object.keys(r ?? {}).sort()).toEqual(
      ['hideDetails', 'hueShift', 'manualPeers', 'nickname', 'palette'].sort(),
    );
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

describe('KnownPeers', () => {
  it('persists pins at 0600 and reloads them', () => {
    const pins = new KnownPeers(dir);
    expect(pins.get('a')).toBeUndefined();
    pins.set('a', 'KA');
    pins.flush();
    const f = path.join(dir, 'known-peers.json');
    if (posix) expect(mode(f)).toBe(0o600);
    expect(new KnownPeers(dir).get('a')).toBe('KA');
  });
  it('keeps at most MAX_KNOWN_PEERS, dropping the least recently seen', () => {
    const pins = new KnownPeers(dir);
    for (let i = 0; i < MAX_KNOWN_PEERS; i++) pins.set(`p${i}`, 'k');
    pins.get('p0'); // seen again: now most recent
    pins.set('new', 'k');
    expect(pins.get('p0')).toBe('k');
    expect(pins.get('p1')).toBeUndefined();
    pins.flush();
    expect(
      Object.keys(
        JSON.parse(fs.readFileSync(path.join(dir, 'known-peers.json'), 'utf-8')) as object,
      ),
    ).toHaveLength(MAX_KNOWN_PEERS);
  });
});

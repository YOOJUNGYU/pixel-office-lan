import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PeerPacket } from '../../../core/src/lan.js';
import { parseAvatar, parsePeerPacket, PERSONAL_VIEW, PUBLIC_VIEW } from '../../../core/src/lan.js';
import { handleClientMessage } from '../../src/clientMessageHandler.js';
import { AVATAR_SAVE_DELAY_MS, AVATAR_SEND_DELAY_MS } from '../../src/constants.js';
import { FileStateAdapter } from '../../src/fileStateAdapter.js';
import { createIdentity } from '../../src/lan/crypto.js';
import { LanService } from '../../src/lan/office.js';
import type { Profile } from '../../src/lan/profile.js';
import { loadProfile } from '../../src/lan/profile.js';

const pkt = (id: string, avatar?: unknown): PeerPacket =>
  ({
    v: 1,
    peer: { id, account: id, nickname: '', palette: 0, hueShift: 0 },
    views: [],
    ...(avatar !== undefined && { avatar }),
  }) as PeerPacket;

describe('avatar validation', () => {
  it('strict (moveAvatar): integer tiles 0..127, a known dir', () => {
    expect(parseAvatar({ col: 3, row: 4, dir: 'left' }, true)).toEqual({
      col: 3,
      row: 4,
      dir: 'left',
    });
    for (const bad of [
      { col: 1.5, row: 0, dir: 'up' },
      { col: -1, row: 0, dir: 'up' },
      { col: 0, row: 128, dir: 'up' },
      { col: '1', row: 0, dir: 'up' },
      { col: 0, row: 0, dir: 'north' },
      { col: 0, row: 0 },
      null,
      [1, 2],
    ])
      expect(parseAvatar(bad, true)).toBeNull();
  });

  it('peers: finite coords rounded and clamped into the grid, bad dir / NaN dropped', () => {
    expect(parseAvatar({ col: -5, row: 999.4, dir: 'up' })).toEqual({
      col: 0,
      row: 127,
      dir: 'up',
    });
    expect(parseAvatar({ col: 2.6, row: 1, dir: 'down' })).toEqual({ col: 3, row: 1, dir: 'down' });
    expect(parseAvatar({ col: Number.NaN, row: 1, dir: 'down' })).toBeNull();
    expect(parseAvatar({ col: 1, row: 1, dir: 'x' })).toBeNull();
  });

  it('parsePeerPacket keeps a valid avatar (clamped), drops a bad one, the packet still parses', () => {
    const ok = parsePeerPacket(JSON.stringify(pkt('p', { col: 500, row: 2, dir: 'right' })));
    expect(ok?.avatar).toEqual({ col: 127, row: 2, dir: 'right' });
    const bad = parsePeerPacket(JSON.stringify(pkt('p', { col: 1, row: 2, dir: 'sideways' })));
    expect(bad).not.toBeNull();
    expect(bad).not.toHaveProperty('avatar');
  });
});

describe('LanService avatar', () => {
  const profile: Profile = {
    peerId: 'me',
    nickname: '',
    palette: 0,
    hueShift: 0,
    hideWork: false,
    manualPeers: [],
    identity: (({ publicKey, privateKeyPem }) => ({ publicKey, privateKeyPem }))(
      createIdentity('me'),
    ),
    offices: [],
    activeView: PUBLIC_VIEW,
    setUp: true,
    nicknameSince: 0,
  };
  let dir: string;
  const mk = (peers: Record<string, PeerPacket[]> = {}) => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-avatar-'));
    const lan = new LanService({ ...profile }, { views: () => [] }, dir);
    const sendNow = vi.fn();
    lan.net = { peers: (v) => peers[v] ?? [], sendNow, teamName: () => undefined };
    return { lan, sendNow };
  };
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('none until moved: no avatar in packet or snapshot', () => {
    const { lan } = mk();
    expect(lan.packet()).not.toHaveProperty('avatar');
    expect(lan.people(PUBLIC_VIEW)[0]).not.toHaveProperty('avatar');
  });

  it('moveAvatar: presence coalesced (≤ 5/s), saved per layout, reloaded', () => {
    const { lan, sendNow } = mk();
    expect(lan.moveAvatar({ col: 5, row: 6, dir: 'up' })).toBe(true);
    expect(lan.moveAvatar({ col: 6, row: 6, dir: 'right' })).toBe(true);
    expect(sendNow).not.toHaveBeenCalled();
    vi.advanceTimersByTime(AVATAR_SEND_DELAY_MS);
    expect(sendNow).toHaveBeenCalledOnce();
    expect(lan.packet().avatar).toEqual({ col: 6, row: 6, dir: 'right' });
    expect(lan.people(PUBLIC_VIEW)[0].avatar).toEqual({ col: 6, row: 6, dir: 'right' });
    vi.advanceTimersByTime(AVATAR_SAVE_DELAY_MS);
    expect(loadProfile(dir).avatar).toEqual({ office: { col: 6, row: 6, dir: 'right' } });

    // Personal mode keeps its own spot; the office one stays and is what peers get.
    lan.setActiveView(PERSONAL_VIEW);
    expect(lan.people(PERSONAL_VIEW)[0]).not.toHaveProperty('avatar');
    lan.moveAvatar({ col: 1, row: 2, dir: 'down' });
    expect(lan.people(PERSONAL_VIEW)[0].avatar).toEqual({ col: 1, row: 2, dir: 'down' });
    expect(lan.packet(PUBLIC_VIEW).avatar).toEqual({ col: 6, row: 6, dir: 'right' });
    vi.advanceTimersByTime(AVATAR_SAVE_DELAY_MS);
    const again = new LanService(loadProfile(dir), { views: () => [] }, dir);
    expect(again.profile.avatar).toEqual({
      office: { col: 6, row: 6, dir: 'right' },
      personal: { col: 1, row: 2, dir: 'down' },
    });
  });

  it('refuses bad moves (nothing changes) and drops a malformed saved spot', () => {
    const { lan, sendNow } = mk();
    for (const bad of [{ col: 1.5, row: 1, dir: 'up' }, { col: 1, row: 200, dir: 'up' }, {}])
      expect(lan.moveAvatar(bad)).toBe(false);
    vi.advanceTimersByTime(AVATAR_SAVE_DELAY_MS);
    expect(sendNow).not.toHaveBeenCalled();
    expect(lan.profile).not.toHaveProperty('avatar');
    const file = path.join(dir, 'profile.json');
    lan.moveAvatar({ col: 1, row: 1, dir: 'up' });
    vi.advanceTimersByTime(AVATAR_SAVE_DELAY_MS);
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    fs.writeFileSync(
      file,
      JSON.stringify({ ...raw, avatar: { office: { col: -1, row: 0, dir: 'up' }, personal: 'x' } }),
    );
    expect(loadProfile(dir)).not.toHaveProperty('avatar');
  });

  it('a pre-avatar saved chat loses its col/row on load', () => {
    const { lan } = mk();
    const c = lan.sendChat('old', 0)!;
    const file = path.join(dir, 'profile.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    fs.writeFileSync(file, JSON.stringify({ ...raw, chat: { ...raw.chat, col: 3, row: 4 } }));
    expect(loadProfile(dir).chat).toEqual({ ...c, view: PUBLIC_VIEW });
  });

  it("received: each live peer's avatar in the snapshot", () => {
    const peers = { [PUBLIC_VIEW]: [pkt('p', { col: 9, row: 8, dir: 'left' }), pkt('q')] };
    const { lan } = mk(peers);
    const rows = lan.people(PUBLIC_VIEW);
    expect(rows.find((r) => r.peerId === 'p')?.avatar).toEqual({ col: 9, row: 8, dir: 'left' });
    expect(rows.find((r) => r.peerId === 'q')).not.toHaveProperty('avatar');
  });

  it('moveAvatar message: privileged only', () => {
    const { lan } = mk();
    const adapter = new FileStateAdapter();
    const send = vi.fn();
    const move = { type: 'moveAvatar', col: 2, row: 3, dir: 'up' };
    handleClientMessage(move, send, { adapter, cache: null, lan, privileged: false });
    expect(lan.profile).not.toHaveProperty('avatar');
    handleClientMessage(move, send, { adapter, cache: null, lan, privileged: true });
    expect(lan.profile.avatar).toEqual({ office: { col: 2, row: 3, dir: 'up' } });
  });
});

// Personal mode: activeView 'personal' = offline, this PC alone, its own layout file.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentView, PeerPacket } from '../../../core/src/lan.js';
import { PERSONAL_VIEW, PUBLIC_VIEW } from '../../../core/src/lan.js';
import type { AssetCache } from '../../src/clientMessageHandler.js';
import { handleClientMessage, snapshotMessage } from '../../src/clientMessageHandler.js';
import { FileStateAdapter } from '../../src/fileStateAdapter.js';
import { createIdentity } from '../../src/lan/crypto.js';
import type { CreatedOffice } from '../../src/lan/office.js';
import { LanService } from '../../src/lan/office.js';
import type { Profile } from '../../src/lan/profile.js';
import { loadProfile } from '../../src/lan/profile.js';
import { getLayoutFilePath } from '../../src/layoutPersistence.js';

const view: AgentView = {
  id: 's1',
  provider: 'claude',
  kind: 'main',
  num: 1,
  room: 'coding',
  permission: false,
  act: 'edit',
  target: 'a.ts',
  reason: '',
};
const pubPeer: PeerPacket = {
  v: 1,
  peer: { id: 'p1', account: 'kim', nickname: '', palette: 1, hueShift: 0 },
  views: [{ ...view, id: 'remote' }],
};
const grid = (marker: string, cols = 2) => ({
  version: 1,
  cols,
  rows: 1,
  tiles: new Array<number>(cols).fill(1),
  furniture: [],
  marker,
});
const CACHE: AssetCache = {
  characters: null,
  pets: null,
  floorTiles: null,
  wallTiles: null,
  carpetTiles: null,
  furniture: null,
  defaultLayout: grid('office-default', 4),
  personalLayout: grid('personal-default', 2),
};

describe('personal mode', () => {
  let home: string;
  let originalHome: string | undefined;
  let lan: LanService;
  let sent: Record<string, unknown>[];
  const onOfficesChanged = vi.fn();
  const msg = (m: Record<string, unknown>) =>
    handleClientMessage(m, (x) => sent.push(x), {
      adapter: new FileStateAdapter(),
      cache: CACHE,
      privileged: true,
      lan,
      onOfficesChanged,
    });
  const layoutMarker = () =>
    (sent.find((m) => m.type === 'layoutLoaded')?.layout as { marker?: string } | null)?.marker;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-personal-'));
    originalHome = process.env.HOME;
    process.env.HOME = home;
    const profile: Profile = {
      peerId: 'me',
      nickname: '',
      palette: 0,
      hueShift: 0,
      hideWork: true,
      manualPeers: [],
      identity: (({ publicKey, privateKeyPem }) => ({ publicKey, privateKeyPem }))(
        createIdentity('me'),
      ),
      offices: [],
      activeView: PUBLIC_VIEW,
      setUp: true,
      nicknameSince: 0,
    };
    lan = new LanService(profile, { views: () => [view] }, home);
    lan.net = { peers: () => [pubPeer], sendNow: vi.fn(), teamName: () => undefined };
    sent = [];
    onOfficesChanged.mockClear();
  });
  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('switches on and off by setActiveView, persists, and shows only this PC', () => {
    msg({ type: 'setActiveView', view: PERSONAL_VIEW });
    expect(lan.personal).toBe(true);
    expect(onOfficesChanged).toHaveBeenCalledWith(true); // layout changes with the mode
    expect(loadProfile(home).activeView).toBe(PERSONAL_VIEW);
    const snap = snapshotMessage(lan);
    expect(snap.agents.map((a) => a.key)).toEqual(['me:s1']);
    expect(snap.people.map((p) => p.peerId)).toEqual(['me']);

    msg({ type: 'setActiveView', view: PUBLIC_VIEW });
    expect(lan.personal).toBe(false);
    expect(onOfficesChanged).toHaveBeenLastCalledWith(true);
    expect(loadProfile(home).activeView).toBe(PUBLIC_VIEW);
  });

  it('refuses unknown views and read-only clients', () => {
    for (const v of ['Personal', 'bogus', 5, null]) msg({ type: 'setActiveView', view: v });
    expect(lan.profile.activeView).toBe(PUBLIC_VIEW);
    expect(onOfficesChanged).not.toHaveBeenCalled();
    expect(sent.every((m) => m.type === 'officesState')).toBe(true);
    handleClientMessage({ type: 'setActiveView', view: PERSONAL_VIEW }, () => {}, {
      adapter: new FileStateAdapter(),
      cache: CACHE,
      privileged: false,
      lan,
    });
    expect(lan.personal).toBe(false);
  });

  it('keeps team memberships inactive and switches back to a team without a code', () => {
    const team = lan.createOffice('팀') as CreatedOffice;
    expect(lan.setActiveView(PERSONAL_VIEW)).toBe(true);
    expect(loadProfile(home)).toMatchObject({ activeView: PERSONAL_VIEW });
    expect(loadProfile(home).offices.map((o) => o.tag)).toEqual([team.tag]);
    // Leaving another team keeps personal mode.
    const other = lan.createOffice('둘') as CreatedOffice;
    lan.setActiveView(PERSONAL_VIEW);
    lan.leaveOffice(other.tag);
    expect(lan.personal).toBe(true);
    msg({ type: 'setActiveView', view: team.tag });
    expect(lan.profile.activeView).toBe(team.tag);
    expect(onOfficesChanged).toHaveBeenLastCalledWith(true);
  });

  it('every office switch resends the layout (each office has its own); a no-op switch does not', () => {
    const a = lan.createOffice('a') as CreatedOffice;
    lan.createOffice('b');
    msg({ type: 'setActiveView', view: a.tag });
    expect(onOfficesChanged).toHaveBeenLastCalledWith(true);
    msg({ type: 'setActiveView', view: a.tag });
    expect(onOfficesChanged).toHaveBeenLastCalledWith(false);
  });

  it('chat in personal mode stays on this PC (its own view, never on another channel)', () => {
    lan.setActiveView(PERSONAL_VIEW);
    expect(lan.sendChat('hi')).not.toBeNull();
    expect(snapshotMessage(lan).people[0].chat?.text).toBe('hi');
    expect(lan.packet(PUBLIC_VIEW).chat).toBeUndefined();
  });

  it('personal has its own layout file; public and each team their own shared layout', () => {
    expect(getLayoutFilePath(false)).toBe(path.join(home, '.pixel-office', 'layout.json'));
    expect(getLayoutFilePath(true)).toBe(path.join(home, '.pixel-office', 'layout-personal.json'));

    msg({ type: 'webviewReady' });
    expect(layoutMarker()).toBe('office-default');
    msg({ type: 'saveLayout', layout: grid('office-saved', 4) });
    expect(sent.at(-1)).toEqual({ type: 'layoutSaved' });
    expect(lan.layouts.rev(PUBLIC_VIEW)).toMatchObject({ rev: 1, by: lan.profile.peerId });
    expect(lan.packet(PUBLIC_VIEW).layout?.rev).toBe(1); // peers learn the version

    lan.setActiveView(PERSONAL_VIEW);
    sent = [];
    msg({ type: 'webviewReady' });
    expect(layoutMarker()).toBe('personal-default');
    msg({ type: 'saveLayout', layout: grid('personal-saved') });
    expect(sent.at(-1)).toEqual({ type: 'layoutSaved' });
    sent = [];
    msg({ type: 'webviewReady' });
    expect(layoutMarker()).toBe('personal-saved');

    const read = (personal: boolean) =>
      (JSON.parse(fs.readFileSync(getLayoutFilePath(personal), 'utf-8')) as { marker: string })
        .marker;
    expect(fs.existsSync(getLayoutFilePath(false))).toBe(false);
    expect(read(true)).toBe('personal-saved');

    lan.setActiveView(PUBLIC_VIEW);
    sent = [];
    msg({ type: 'webviewReady' });
    expect(layoutMarker()).toBe('office-saved');

    const team = lan.createOffice('t') as CreatedOffice; // a team starts from the default
    sent = [];
    msg({ type: 'webviewReady' });
    expect(layoutMarker()).toBe('office-default');
    expect(lan.packet(team.tag).layout?.rev).toBe(0);
  });
});

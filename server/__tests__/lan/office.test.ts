import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentView, PeerInfo, PeerPacket } from '../../../core/src/lan.js';
import { PUBLIC_VIEW } from '../../../core/src/lan.js';
import { officesMessage, snapshotMessage } from '../../src/clientMessageHandler.js';
import { MAX_OFFICES } from '../../src/constants.js';
import { createIdentity, parseInviteCode } from '../../src/lan/crypto.js';
import type { CreatedOffice } from '../../src/lan/office.js';
import { buildOffice, LanService } from '../../src/lan/office.js';
import type { Profile } from '../../src/lan/profile.js';
import { loadProfile } from '../../src/lan/profile.js';

const view = (o: Partial<AgentView> = {}): AgentView => ({
  id: 's1',
  provider: 'claude',
  kind: 'main',
  num: 1,
  room: 'coding',
  permission: false,
  act: 'edit',
  target: '/home/kim/a.ts',
  reason: '',
  ...o,
});
const self: PeerInfo = { id: 'me', nickname: '나', palette: 0, hueShift: 0 };
const peer: PeerPacket = {
  v: 1,
  peer: { id: 'p1', nickname: '김', palette: 1, hueShift: 10 },
  views: [view({ id: 'm' }), view({ id: 'm/sub/x', kind: 'subagent', num: 0, parentId: 'm' })],
};

describe('buildOffice', () => {
  it('passes local and peer views through untouched (this PC only; senders redact)', () => {
    expect(buildOffice(self, [view()], [])[0].target).toBe('/home/kim/a.ts');
    expect(buildOffice(self, [], [peer])[0].target).toBe('/home/kim/a.ts');
  });

  it('keys agents by peer and links children to their parent', () => {
    const agents = buildOffice(self, [view()], [peer]);
    expect(agents.map((a) => a.key)).toEqual(['me:s1', 'p1:m', 'p1:m/sub/x']);
    expect(agents[1].parentKey).toBeUndefined();
    expect(agents[2].parentKey).toBe('p1:m');
    expect(agents[2].peer).toEqual(peer.peer);
  });
});

describe('LanService', () => {
  const profile: Profile = {
    peerId: 'me',
    nickname: '',
    palette: 2,
    hueShift: 30,
    hideDetails: true,
    manualPeers: [],
    identity: (({ publicKey, privateKeyPem }) => ({ publicKey, privateKeyPem }))(
      createIdentity('me'),
    ),
    offices: [],
    activeView: PUBLIC_VIEW,
  };

  it('sends an empty nickname until one is set, and redacts when hideDetails', () => {
    const lan = new LanService({ ...profile }, { views: () => [view()] });
    const p = lan.packet();
    expect(p.peer).toEqual({ id: 'me', nickname: '', palette: 2, hueShift: 30 });
    expect(p.views[0].target).toBe('a.ts');
  });

  it('asks for brief (program-name) views only when details are hidden', () => {
    const asked: Array<boolean | undefined> = [];
    const local = {
      views: (brief?: boolean) => {
        asked.push(brief);
        return [view({ target: brief ? 'ssh' : 'ssh dev@db01.acme.local' })];
      },
    };
    const lan = new LanService({ ...profile }, local);
    expect(lan.packet().views[0].target).toBe('ssh');
    expect(lan.office(PUBLIC_VIEW)[0].target).toBe('ssh dev@db01.acme.local');
    lan.profile = { ...lan.profile, hideDetails: false };
    expect(lan.packet().views[0].target).toBe('ssh dev@db01.acme.local');
    expect(asked).toEqual([true, undefined, false]);
  });

  it('packet() never throws: a failing scan sends no views', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const lan = new LanService(
      { ...profile },
      {
        views: () => {
          throw new Error('boom');
        },
      },
    );
    expect(lan.packet().views).toEqual([]);
    err.mockRestore();
  });

  it('saveProfile persists, keeps peerId and announces right away', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-lan-'));
    const lan = new LanService({ ...profile }, { views: () => [] }, dir);
    const sendNow = vi.fn();
    lan.net = { peers: () => [], sendNow, teamName: () => undefined };
    const { peerId: _, ...rest } = profile;
    lan.saveProfile({ ...rest, nickname: '유' });
    expect(lan.profile).toMatchObject({ peerId: 'me', nickname: '유' });
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'profile.json'), 'utf-8'))).toMatchObject({
      peerId: 'me',
      nickname: '유',
    });
    expect(sendNow).toHaveBeenCalledOnce();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('offices', () => {
    const teamPeer: PeerPacket = {
      v: 1,
      peer: { id: 'mate', nickname: '팀원', palette: 0, hueShift: 0 },
      views: [view({ id: 'team-secret-work' })],
    };
    const pubPeer: PeerPacket = { ...peer, views: [view({ id: 'public-work' })] };
    let dir: string;
    const mk = () => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-off-'));
      const lan = new LanService({ ...profile }, { views: () => [view()] }, dir);
      const sendNow = vi.fn();
      lan.net = {
        peers: (v: string) => (v === PUBLIC_VIEW ? [pubPeer] : [teamPeer]),
        sendNow,
        teamName: () => 'announced',
      };
      return { lan, sendNow };
    };
    const keys = (agents: { key: string }[]) => agents.map((a) => a.key);
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('public office: self + public peers while in no team', () => {
      const { lan } = mk();
      expect(keys(lan.office(PUBLIC_VIEW))).toEqual(['me:s1', 'p1:public-work']);
      expect(lan.office('unknown-tag')).toEqual([]);
    });

    it('people: self first, zero-agent peers included, team peers never in public', () => {
      const { lan } = mk();
      const idle: PeerPacket = { ...pubPeer, peer: { ...pubPeer.peer, id: 'idle' }, views: [] };
      lan.net.peers = (v: string) => (v === PUBLIC_VIEW ? [pubPeer, idle] : [teamPeer]);
      const ids = (m: { people: { peerId: string; self: boolean }[] }) =>
        m.people.map((p) => `${p.peerId}${p.self ? '*' : ''}`);
      expect(ids(snapshotMessage(lan))).toEqual(['me*', 'p1', 'idle']);
      expect(snapshotMessage(lan).people[1]).toEqual({
        peerId: 'p1',
        nickname: '김',
        palette: 1,
        hueShift: 10,
        self: false,
      });
      const created = lan.createOffice('팀') as CreatedOffice;
      expect(ids(snapshotMessage(lan))).toEqual(['me*', 'mate']);
      expect(lan.people(PUBLIC_VIEW)).toEqual([]);
      expect(lan.people('unknown-tag')).toEqual([]);
      expect(lan.people(created.tag).map((p) => p.peerId)).toEqual(['me', 'mate']);
    });

    it('create: code to the caller, team view active, the public office is empty', () => {
      const { lan, sendNow } = mk();
      const created = lan.createOffice(' 우리팀 ') as CreatedOffice;
      expect(created.name).toBe('우리팀');
      expect(parseInviteCode(created.code)).not.toBeNull();
      expect(sendNow).toHaveBeenCalled();
      expect(lan.profile.activeView).toBe(created.tag);
      expect(keys(lan.office(created.tag))).toEqual(['me:s1', 'mate:team-secret-work']);
      expect(lan.office(PUBLIC_VIEW)).toEqual([]);
      // this PC's browser follows activeView
      expect(keys(snapshotMessage(lan).agents)).toContain('mate:team-secret-work');
      expect(lan.setActiveView(PUBLIC_VIEW)).toBe(false);
    });

    it('officesState carries names only; the secret stays in the 0600 profile', () => {
      const { lan } = mk();
      const created = lan.createOffice('팀') as CreatedOffice;
      const msg = JSON.stringify(officesMessage(lan));
      const { secret } = lan.profile.offices[0];
      expect(msg).not.toContain(secret);
      expect(msg).not.toContain(created.code);
      expect(msg).not.toContain(created.code.replace(/-/g, ''));
      expect(officesMessage(lan)).toEqual({
        type: 'officesState',
        offices: [{ tag: created.tag, name: '팀' }],
        activeView: created.tag,
      });
      const file = path.join(dir, 'profile.json');
      expect(fs.readFileSync(file, 'utf-8')).toContain(secret);
      if (process.platform !== 'win32') expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      expect(loadProfile(dir).offices).toEqual(lan.profile.offices);
      expect(lan.officeCode(created.tag)).toBe(created.code);
    });

    it('join by a sloppy code (name announced by members), leave back to public', () => {
      const a = mk().lan;
      const { code, tag } = a.createOffice('팀') as CreatedOffice;
      const { lan } = mk();
      expect(lan.joinOffice('nope')).toBe('invalidCode');
      expect(lan.joinOffice(code, 'x'.repeat(21))).toBe('nameInvalid');
      expect(lan.joinOffice(` ${code.toLowerCase().replace(/-/g, ' ')} `, '')).toBeNull();
      expect(lan.profile.offices.map((o) => o.tag)).toEqual([tag]);
      expect(lan.officeList()).toEqual([{ tag, name: 'announced' }]);
      expect(lan.joinOffice(code)).toBe('alreadyJoined'); // again: no duplicate
      expect(lan.profile.offices).toHaveLength(1);
      expect(lan.leaveOffice('other')).toBe(false);
      expect(lan.leaveOffice(tag)).toBe(true);
      expect(lan.profile).toMatchObject({ offices: [], activeView: PUBLIC_VIEW });
      expect(keys(lan.office(PUBLIC_VIEW))).toContain('p1:public-work');
    });

    it('rejects bad names and a full office list', () => {
      const { lan } = mk();
      expect(lan.createOffice('')).toBe('nameInvalid');
      expect(lan.createOffice('x'.repeat(21))).toBe('nameInvalid');
      expect(lan.createOffice(5)).toBe('nameInvalid');
      for (let i = 0; i < MAX_OFFICES; i++) lan.createOffice(`팀${i.toString()}`);
      expect(lan.createOffice('one more')).toBe('full');
    });
  });
});

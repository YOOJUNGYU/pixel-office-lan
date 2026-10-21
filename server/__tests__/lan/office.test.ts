import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it, vi } from 'vitest';

import type { AgentView, PeerInfo, PeerPacket } from '../../../core/src/lan.js';
import { buildOffice, LanService } from '../../src/lan/office.js';
import type { Profile } from '../../src/lan/profile.js';

const view = (o: Partial<AgentView> = {}): AgentView => ({
  id: 's1',
  provider: 'claude',
  kind: 'main',
  num: 1,
  room: 'coding',
  permission: false,
  summary: '/home/kim/a.ts 수정 중',
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
  it('redacts only local views when redactLocal', () => {
    expect(buildOffice(self, [view()], [], true)[0].summary).toBe('a.ts 수정 중');
    expect(buildOffice(self, [view()], [], false)[0].summary).toBe('/home/kim/a.ts 수정 중');
    // peer views pass through untouched (sender redacts)
    const fromPeer = buildOffice(self, [], [peer], true);
    expect(fromPeer[0].summary).toBe('/home/kim/a.ts 수정 중');
  });

  it('keys agents by peer and links children to their parent', () => {
    const agents = buildOffice(self, [view()], [peer], false);
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
  };

  it('sends 이름없음 until a nickname is set, and redacts when hideDetails', () => {
    const lan = new LanService({ ...profile }, { views: () => [view()] });
    const p = lan.packet();
    expect(p.peer).toEqual({ id: 'me', nickname: '이름없음', palette: 2, hueShift: 30 });
    expect(p.views[0].summary).toBe('a.ts 수정 중');
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
    lan.net = { peers: () => [], sendNow };
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
});

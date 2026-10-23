import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PeerChat, PeerPacket } from '../../../core/src/lan.js';
import {
  CHAT_MAX_CHARS,
  cleanChatText,
  parseChat,
  parsePeerPacket,
  PUBLIC_VIEW,
} from '../../../core/src/lan.js';
import { handleClientMessage } from '../../src/clientMessageHandler.js';
import { FileStateAdapter } from '../../src/fileStateAdapter.js';
import { createIdentity } from '../../src/lan/crypto.js';
import { LanService } from '../../src/lan/office.js';
import type { Profile } from '../../src/lan/profile.js';

const chat = (o: Partial<PeerChat> = {}): PeerChat => ({
  id: 'abcd1234',
  text: 'hi',
  ts: 1,
  col: 3,
  row: 4.5,
  ...o,
});
const pkt = (id: string, c?: PeerChat): PeerPacket => ({
  v: 1,
  peer: { id, account: id, nickname: '', palette: 0, hueShift: 0 },
  views: [],
  ...(c && { chat: c }),
});

describe('chat validation', () => {
  it('cleanChatText: line breaks → space, control/bidi/format stripped, ≤100 code points, empty → null', () => {
    expect(cleanChatText(' a\nb‮ c​\u0007 ')).toBe('a b c');
    expect(cleanChatText('😀'.repeat(150))).toBe('😀'.repeat(CHAT_MAX_CHARS));
    expect(cleanChatText(' ‮\n ')).toBeNull();
    expect(cleanChatText(5)).toBeNull();
  });

  it('parseChat: id 8 alnum, safe ts, finite col/row clamped to the 128 grid', () => {
    expect(parseChat(chat())).toEqual(chat());
    expect(parseChat(chat({ col: -5, row: 999 }))).toMatchObject({ col: 0, row: 127 });
    for (const bad of [
      { id: 'short' },
      { id: 'abcd123!' },
      { text: '\u0007' },
      { ts: -1 },
      { ts: 1.5 },
      { col: Number.NaN },
      { row: Infinity },
      { col: '3' },
    ])
      expect(parseChat(chat(bad as Partial<PeerChat>))).toBeNull();
  });

  it('parsePeerPacket keeps a valid chat, drops a bad one (the packet still parses)', () => {
    expect(parsePeerPacket(JSON.stringify(pkt('p', chat())))?.chat).toEqual(chat());
    const bad = parsePeerPacket(JSON.stringify(pkt('p', chat({ col: 'x' as never }))));
    expect(bad).not.toBeNull();
    expect(bad).not.toHaveProperty('chat');
  });
});

describe('LanService chat', () => {
  const profile: Profile = {
    peerId: 'me',
    nickname: '',
    palette: 0,
    hueShift: 0,
    hideDetails: false,
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
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-chat-'));
    const lan = new LanService({ ...profile }, { views: () => [] }, dir);
    const sendNow = vi.fn();
    lan.net = { peers: (v) => peers[v] ?? [], sendNow, teamName: () => undefined };
    return { lan, sendNow };
  };
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('sendChat: sanitised, sent at once, in packets for 10 s; one per 2 s', () => {
    const { lan, sendNow } = mk();
    const c = lan.sendChat(' hi‮ ', 2, 3, 1000)!;
    expect(c).toMatchObject({ text: 'hi', col: 2, row: 3, ts: 1000 });
    expect(c.id).toMatch(/^[0-9a-z]{8}$/i);
    expect(sendNow).toHaveBeenCalledOnce();
    expect(lan.packet(PUBLIC_VIEW, 1000).chat).toEqual(c);
    expect(lan.sendChat('again', 0, 0, 2999)).toBeNull();
    expect(lan.packet(PUBLIC_VIEW, 10_999).chat).toEqual(c);
    expect(lan.packet(PUBLIC_VIEW, 11_000)).not.toHaveProperty('chat');
    expect(lan.sendChat('', 0, 0, 20_000)).toBeNull();
    expect(lan.sendChat('x', Number.NaN, 0, 20_000)).toBeNull();
    expect(lan.sendChat('ok', 0, 0, 3000)).not.toBeNull();
  });

  it('own chat: in my snapshot row with the time left; only in the view it was said in', () => {
    const { lan } = mk();
    const c = lan.sendChat('hi', 1, 1, 0)!;
    expect(lan.people(PUBLIC_VIEW, 4000)[0].chat).toEqual({
      id: c.id,
      text: 'hi',
      col: 1,
      row: 1,
      left: 6000,
    });
    lan.createOffice('팀'); // now in a team: the public chat goes nowhere
    const tag = lan.profile.activeView;
    expect(lan.packet(tag, 4000)).not.toHaveProperty('chat');
    expect(lan.people(tag, 4000)[0]).not.toHaveProperty('chat');
  });

  it('team chat goes only on its team channel, never public', () => {
    const { lan } = mk();
    lan.createOffice('팀');
    const tag = lan.profile.activeView;
    lan.createOffice('팀2'); // active view is now the second team
    const other = lan.profile.activeView;
    lan.setActiveView(tag);
    lan.sendChat('team only', 0, 0, 0);
    expect(lan.packet(tag, 1).chat?.text).toBe('team only');
    expect(lan.packet(other, 1)).not.toHaveProperty('chat');
    expect(lan.packet(PUBLIC_VIEW, 1)).not.toHaveProperty('chat');
  });

  it('received: shown once per (sender, id) for 10 s from first receipt; new ids within 2 s ignored', () => {
    const peers: Record<string, PeerPacket[]> = { [PUBLIC_VIEW]: [pkt('p', chat())] };
    const { lan } = mk(peers);
    const row = (t: number) => lan.people(PUBLIC_VIEW, t).find((p) => p.peerId === 'p')!;
    expect(row(5000).chat).toMatchObject({ id: 'abcd1234', left: 10_000 });
    peers[PUBLIC_VIEW] = [pkt('p', chat({ id: 'zzzz0000', text: 'spam' }))];
    expect(row(6000).chat).toMatchObject({ id: 'abcd1234', left: 9000 }); // rate limited
    peers[PUBLIC_VIEW] = [pkt('p', chat())];
    expect(row(14_999).chat?.left).toBe(1);
    expect(row(15_000)).not.toHaveProperty('chat');
    expect(row(30_000)).not.toHaveProperty('chat'); // the same id never comes back
    peers[PUBLIC_VIEW] = [pkt('p', chat({ id: 'next0001', text: 'new' }))];
    expect(row(31_000).chat).toMatchObject({ text: 'new', left: 10_000 });
  });

  it('a chat heard in a team is never in the public snapshot', () => {
    const { lan } = mk();
    lan.createOffice('팀');
    const tag = lan.profile.activeView;
    lan.net.peers = (v) => (v === tag ? [pkt('mate', chat())] : [pkt('pub', chat())]);
    expect(lan.people(tag, 0).find((p) => p.peerId === 'mate')?.chat?.text).toBe('hi');
    expect(lan.people(PUBLIC_VIEW, 0)).toEqual([]);
  });

  it('sendChat message: privileged only', () => {
    const { lan } = mk();
    const adapter = new FileStateAdapter();
    const msg = { type: 'sendChat', text: 'hey', col: 1, row: 2 };
    handleClientMessage(msg, () => {}, { adapter, cache: null, lan, privileged: false });
    expect(lan.packet()).not.toHaveProperty('chat');
    handleClientMessage(msg, () => {}, { adapter, cache: null, lan, privileged: true });
    expect(lan.packet().chat?.text).toBe('hey');
  });
});

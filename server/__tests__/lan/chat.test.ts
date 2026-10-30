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
  PERSONAL_VIEW,
  PUBLIC_VIEW,
} from '../../../core/src/lan.js';
import { handleClientMessage } from '../../src/clientMessageHandler.js';
import { FileStateAdapter } from '../../src/fileStateAdapter.js';
import { createIdentity } from '../../src/lan/crypto.js';
import { LanService } from '../../src/lan/office.js';
import type { Profile } from '../../src/lan/profile.js';
import { loadProfile } from '../../src/lan/profile.js';

const chat = (o: Partial<PeerChat> = {}): PeerChat => ({
  id: 'abcd1234',
  text: 'hi',
  ts: 1,
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

  it('parseChat: id 8 alnum, safe ts; a pre-avatar col/row is ignored', () => {
    expect(parseChat(chat())).toEqual(chat());
    expect(parseChat({ ...chat(), col: 3, row: 'x' })).toEqual(chat());
    for (const bad of [
      { id: 'short' },
      { id: 'abcd123!' },
      { text: '\u0007' },
      { ts: -1 },
      { ts: 1.5 },
    ])
      expect(parseChat(chat(bad as Partial<PeerChat>))).toBeNull();
  });

  it('parsePeerPacket keeps a valid chat, drops a bad one (the packet still parses)', () => {
    expect(parsePeerPacket(JSON.stringify(pkt('p', chat())))?.chat).toEqual(chat());
    const bad = parsePeerPacket(JSON.stringify(pkt('p', chat({ ts: 'x' as never }))));
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
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-chat-'));
    const lan = new LanService({ ...profile }, { views: () => [] }, dir);
    const sendNow = vi.fn();
    lan.net = { peers: (v) => peers[v] ?? [], sendNow, teamName: () => undefined };
    return { lan, sendNow };
  };
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('sendChat: sanitised, sent at once, no expiry; one per 2 s; a new one replaces the old', () => {
    const { lan, sendNow } = mk();
    const c = lan.sendChat(' hi‮ ', 1000)!;
    expect(c).toEqual({ id: c.id, text: 'hi', ts: 1000 });
    expect(c.id).toMatch(/^[0-9a-z]{8}$/i);
    expect(sendNow).toHaveBeenCalledOnce();
    expect(lan.packet(PUBLIC_VIEW).chat).toEqual(c);
    expect(lan.sendChat('again', 2999)).toBeNull();
    expect(lan.sendChat('', 20_000)).toBeNull();
    expect(lan.packet(PUBLIC_VIEW).chat).toEqual(c); // refused ones change nothing, still there
    const d = lan.sendChat('moved', 3000)!;
    expect(d.id).not.toBe(c.id);
    expect(lan.packet(PUBLIC_VIEW).chat).toEqual(d);
    expect(lan.people(PUBLIC_VIEW)[0].chat).toEqual({ id: d.id, text: 'moved' });
  });

  it('deleteChat clears my bubble (persisted); the rate limit is not reset by it', () => {
    const { lan, sendNow } = mk();
    lan.sendChat('bye', 0);
    lan.deleteChat();
    expect(sendNow).toHaveBeenCalledTimes(2);
    expect(lan.packet()).not.toHaveProperty('chat');
    expect(lan.people(PUBLIC_VIEW)[0]).not.toHaveProperty('chat');
    expect(loadProfile(dir)).not.toHaveProperty('chat');
    expect(lan.sendChat('spam', 1000)).toBeNull();
  });

  it('persisted in profile.json; loaded back; malformed or a gone view is dropped', () => {
    const { lan } = mk();
    const c = lan.sendChat('stay', 0)!;
    expect(loadProfile(dir).chat).toEqual({ ...c, view: PUBLIC_VIEW });
    const again = new LanService(loadProfile(dir), { views: () => [] }, dir);
    expect(again.packet().chat).toEqual(c);
    const file = path.join(dir, 'profile.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    for (const bad of [{ ...raw.chat, id: 'x' }, { ...raw.chat, view: 'gone' }, 'nope']) {
      fs.writeFileSync(file, JSON.stringify({ ...raw, chat: bad }));
      expect(loadProfile(dir)).not.toHaveProperty('chat');
    }
  });

  it('a team chat goes only on its team channel, survives switching views, dies with the team', () => {
    const { lan } = mk();
    lan.createOffice('팀');
    const tag = lan.profile.activeView;
    lan.createOffice('팀2'); // active view is now the second team
    const other = lan.profile.activeView;
    lan.setActiveView(tag);
    lan.sendChat('team only', 0);
    expect(lan.packet(tag).chat?.text).toBe('team only');
    expect(lan.packet(other)).not.toHaveProperty('chat');
    expect(lan.packet(PUBLIC_VIEW)).not.toHaveProperty('chat');
    lan.setActiveView(other);
    expect(lan.packet(tag).chat?.text).toBe('team only');
    expect(lan.people(other)[0]).not.toHaveProperty('chat');
    lan.leaveOffice(tag);
    expect(lan.profile).not.toHaveProperty('chat');
  });

  it('online: me + live peers per open office; personal mode: only the others heard', () => {
    const peers: Record<string, PeerPacket[]> = { [PUBLIC_VIEW]: [pkt('p'), pkt('q')] };
    const { lan } = mk(peers);
    expect(lan.online()).toEqual({ [PUBLIC_VIEW]: 3 });
    lan.createOffice('팀');
    const tag = lan.profile.activeView;
    peers[tag] = [pkt('r')];
    expect(lan.online()).toEqual({ [tag]: 2 }); // public is closed while in a team
    lan.setActiveView(PERSONAL_VIEW);
    lan.net.liveCount = (v) => (peers[v] ?? []).length;
    expect(lan.online()).toEqual({ [tag]: 1 });
    lan.leaveOffice(tag);
    expect(lan.online()).toEqual({ [PUBLIC_VIEW]: 2 });
  });

  it('a public chat is dropped when joining a team', () => {
    const { lan } = mk();
    lan.sendChat('hi', 0);
    lan.createOffice('팀');
    expect(lan.profile).not.toHaveProperty('chat');
    expect(lan.packet(PUBLIC_VIEW)).not.toHaveProperty('chat');
  });

  it("received: each live peer's current chat, replaced by a new id, gone when absent", () => {
    const peers: Record<string, PeerPacket[]> = { [PUBLIC_VIEW]: [pkt('p', chat())] };
    const { lan } = mk(peers);
    const row = () => lan.people(PUBLIC_VIEW).find((p) => p.peerId === 'p');
    expect(row()?.chat).toEqual({ id: 'abcd1234', text: 'hi' });
    peers[PUBLIC_VIEW] = [pkt('p', chat({ id: 'next0001', text: 'new' }))];
    expect(row()?.chat).toMatchObject({ id: 'next0001', text: 'new' });
    peers[PUBLIC_VIEW] = [pkt('p')];
    expect(row()).not.toHaveProperty('chat');
    peers[PUBLIC_VIEW] = [];
    expect(row()).toBeUndefined();
  });

  it('a chat heard in a team is never in the public snapshot', () => {
    const { lan } = mk();
    lan.createOffice('팀');
    const tag = lan.profile.activeView;
    lan.net.peers = (v) => (v === tag ? [pkt('mate', chat())] : [pkt('pub', chat())]);
    expect(lan.people(tag).find((p) => p.peerId === 'mate')?.chat?.text).toBe('hi');
    expect(lan.people(PUBLIC_VIEW)).toEqual([]);
  });

  it('sendChat / deleteChat messages: privileged only; answered with a fresh snapshot', () => {
    const { lan } = mk();
    const adapter = new FileStateAdapter();
    const sent: Array<Record<string, unknown>> = [];
    const send = (m: Record<string, unknown>) => sent.push(m);
    const say = { type: 'sendChat', text: 'hey' };
    handleClientMessage(say, send, { adapter, cache: null, lan, privileged: false });
    expect(lan.packet()).not.toHaveProperty('chat');
    handleClientMessage(say, send, { adapter, cache: null, lan, privileged: true });
    expect(lan.packet().chat?.text).toBe('hey');
    expect(sent.at(-1)).toMatchObject({
      type: 'officeSnapshot',
      people: [{ chat: { text: 'hey' } }],
    });
    const del = { type: 'deleteChat' };
    handleClientMessage(del, send, { adapter, cache: null, lan, privileged: false });
    expect(lan.packet().chat?.text).toBe('hey');
    handleClientMessage(del, send, { adapter, cache: null, lan, privileged: true });
    expect(lan.packet()).not.toHaveProperty('chat');
    expect(sent.at(-1)).toMatchObject({ type: 'officeSnapshot' });
  });
});

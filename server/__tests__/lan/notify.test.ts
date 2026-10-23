import { describe, expect, it } from 'vitest';

import type { AgentView } from '../../../core/src/lan.js';
import {
  PRESENCE_LEAVE_GRACE_MS as GRACE,
  PRESENCE_SETTLE_MS as SETTLE,
} from '../../src/constants.js';
import {
  agentText,
  AgentWatcher,
  Notifier,
  presenceText,
  PresenceWatcher,
} from '../../src/lan/notify.js';
import type { AgentInfo } from '../../src/lan/scanner.js';
import { Scanner } from '../../src/lan/scanner.js';

/** A Scanner that reports given views/infos (the Notifier only accepts a real Scanner). */
class FakeScanner extends Scanner {
  constructor(
    private readonly list: () => AgentView[],
    private readonly infos: Record<string, AgentInfo> = {},
  ) {
    super({ claude: [], codex: [] });
  }
  override views(): AgentView[] {
    return this.list();
  }
  override info(id: string): AgentInfo | undefined {
    return this.infos[id];
  }
}
const fake = (list: () => AgentView[], infos: Record<string, AgentInfo> = {}) =>
  new FakeScanner(list, infos);

const me = { peerId: 'me', account: 'me', nickname: '', self: true };
const p = (id: string, nickname = '') => ({ peerId: id, account: id, nickname, self: false });
const none = { joined: [], left: [] };

function watcher(view = 'public') {
  const w = new PresenceWatcher();
  w.reset(view);
  return w;
}

describe('PresenceWatcher (public office join/leave)', () => {
  it('first tick + settle window are the baseline; a newcomer joins; self ignored', () => {
    const w = watcher();
    expect(w.apply([me, p('a')], 0)).toEqual(none);
    expect(w.apply([me, p('a'), p('z')], SETTLE - 1)).toEqual(none);
    const t = SETTLE;
    expect(w.apply([me, p('a'), p('z'), p('b', 'Bee')], t)).toEqual({
      joined: ['b (Bee)'],
      left: [],
    });
    expect(w.apply([p('a'), p('z'), p('b', 'Bee')], t + 1000)).toEqual(none);
    expect(w.apply([me, p('a'), p('z'), p('b', 'Bee')], t + 2000)).toEqual(none);
  });

  it('a leave is reported only after the grace, once', () => {
    const w = watcher();
    w.apply([me, p('a'), p('b')], 0);
    expect(w.apply([me, p('a')], 1000)).toEqual(none);
    expect(w.apply([me, p('a')], 1000 + GRACE - 1)).toEqual(none);
    expect(w.apply([me, p('a')], 1000 + GRACE)).toEqual({ joined: [], left: ['b'] });
    expect(w.apply([me, p('a')], 1000 + GRACE * 2)).toEqual(none);
  });

  it('back within the grace: neither leave nor join', () => {
    const w = watcher();
    w.apply([me, p('a')], 0);
    expect(w.apply([me], SETTLE + 1000)).toEqual(none);
    expect(w.apply([me, p('a')], SETTLE + 5000)).toEqual(none);
    expect(w.apply([me, p('a')], SETTLE + GRACE * 2)).toEqual(none);
  });

  it('view switch re-baselines; personal and team views say nothing', () => {
    const w = watcher();
    w.apply([me, p('a')], 0);
    expect(w.apply([me], 1000)).toEqual(none);
    w.reset('personal');
    expect(w.apply([me], 2000)).toEqual(none);
    w.reset('Tabcdefghij');
    expect(w.apply([me, p('x')], 3000)).toEqual(none);
    expect(w.apply([me, p('x'), p('y')], 4000)).toEqual(none);
    w.reset('public');
    expect(w.apply([me, p('b'), p('c')], 5000)).toEqual(none);
    expect(w.apply([me, p('b'), p('c')], 5000 + GRACE * 2)).toEqual(none);
    expect(w.apply([me, p('b'), p('c'), p('d'), p('e')], 6000 + GRACE * 2 + SETTLE)).toEqual({
      joined: ['d', 'e'],
      left: [],
    });
  });

  it('text: one name, or merged "N명"; long untrusted names clipped', () => {
    expect(presenceText('ko', { joined: ['b (Bee)'], left: [] })).toEqual([
      'b (Bee) 님이 접속했습니다',
    ]);
    expect(presenceText('ko', { joined: ['a', 'b', 'c'], left: ['d'] })).toEqual([
      '3명이 접속했습니다',
      'd 님이 나갔습니다',
    ]);
    expect(presenceText('en', { joined: [], left: ['a', 'b'] })).toEqual(['2 people left']);
    const [long] = presenceText('en', { joined: ['x'.repeat(500)], left: [] });
    expect(long.length).toBeLessThan(60);
  });
});

const agent = (o: Partial<AgentView> = {}): AgentView => ({
  id: 's1',
  provider: 'claude',
  kind: 'main',
  num: 1,
  room: 'coding',
  permission: false,
  act: 'edit',
  target: 'a.ts',
  reason: '',
  ...o,
});
const idle = { room: 'lounge', act: 'idle', target: '' } as const;

describe('AgentWatcher (my own agents)', () => {
  it('baseline: agents already waiting or idle at start say nothing', () => {
    const w = new AgentWatcher();
    expect(w.apply([agent({ permission: true }), agent({ id: 's2', ...idle })])).toEqual([]);
    expect(w.apply([agent({ permission: true }), agent({ id: 's2', ...idle })])).toEqual([]);
  });

  it('waiting: false→true once per wait, with the clipped context', () => {
    const w = new AgentWatcher();
    w.apply([agent({ act: 'run', target: 'npm test' })]);
    const waitingView = agent({ act: 'run', target: 'npm test', permission: true });
    expect(w.apply([waitingView])).toEqual([
      { kind: 'waiting', label: 'Claude #1', context: 'npm test' },
    ]);
    expect(w.apply([waitingView])).toEqual([]);
    w.apply([agent()]);
    expect(w.apply([agent({ provider: 'codex', act: 'ask', room: 'lounge', target: '' })])).toEqual(
      [{ kind: 'waiting', label: 'Codex #1', context: '' }],
    );
  });

  it('done: once per turn end (idle in the lounge after working)', () => {
    const w = new AgentWatcher();
    w.apply([agent()]);
    expect(w.apply([agent({ act: 'idle', target: '' })])).toEqual([]); // room not debounced yet
    expect(w.apply([agent(idle)])).toEqual([{ kind: 'done', label: 'Claude #1', context: '' }]);
    expect(w.apply([agent(idle)])).toEqual([]);
    w.apply([agent()]);
    expect(w.apply([agent(idle)])).toHaveLength(1);
  });

  it('a closed session (gone) and subagents/shells say nothing', () => {
    const w = new AgentWatcher();
    const sub = agent({ id: 's1/sub/x', kind: 'subagent', num: 0, parentId: 's1' });
    w.apply([agent(), sub]);
    expect(w.apply([agent(), { ...sub, ...idle }])).toEqual([]);
    expect(w.apply([agent(), { ...sub, permission: true }])).toEqual([]);
    expect(w.apply([])).toEqual([]);
    expect(w.apply([agent(idle)])).toEqual([]); // back = a new baseline
  });

  it('text', () => {
    expect(agentText('ko', { kind: 'waiting', label: 'Claude #1', context: 'npm\ntest' })).toBe(
      'Claude #1 — 응답을 기다립니다 (npm test)',
    );
    expect(agentText('en', { kind: 'done', label: 'Codex #2', context: '' })).toBe(
      'Codex #2 finished its work',
    );
  });
});

describe('Notifier', () => {
  function rig(settings: { presence: boolean; agents: boolean }) {
    let people = [me, p('a')];
    let agents = [agent()];
    const sent: string[] = [];
    const n = new Notifier(
      {
        view: () => 'public',
        people: () => people,
        local: fake(() => agents),
        settings: () => settings,
      },
      { lang: 'ko', notify: (b) => (sent.push(b), true) },
    );
    n.tick(0);
    people = [me, p('a'), p('b')];
    agents = [agent({ permission: true })];
    n.tick(SETTLE);
    return sent;
  }

  it('both on (default): one notification per kind', () => {
    expect(rig({ presence: true, agents: true })).toEqual([
      'b 님이 접속했습니다',
      'Claude #1 — 응답을 기다립니다 (a.ts)',
    ]);
  });

  it('each toggle is independent; off = nothing sent to the tray', () => {
    expect(rig({ presence: false, agents: true })).toEqual([
      'Claude #1 — 응답을 기다립니다 (a.ts)',
    ]);
    expect(rig({ presence: true, agents: false })).toEqual(['b 님이 접속했습니다']);
    expect(rig({ presence: false, agents: false })).toEqual([]);
  });

  it('agents notify in every view (personal too); presence only in public', () => {
    const sent: string[] = [];
    let agents = [agent()];
    let people = [me];
    const n = new Notifier(
      {
        view: () => 'personal',
        people: () => people,
        local: fake(() => agents),
        settings: () => ({ presence: true, agents: true }),
      },
      { lang: 'en', notify: (b) => (sent.push(b), true) },
    );
    n.tick(0);
    agents = [agent(idle)];
    people = [me, p('x')];
    n.tick(SETTLE * 3);
    expect(sent).toEqual(['Claude #1 finished its work']);
  });

  it('my agents carry their local title + folder; merged ones list short titles', () => {
    const sent: string[] = [];
    let agents = [agent(), agent({ id: 's2', num: 2 })];
    const n = new Notifier(
      {
        view: () => 'personal',
        people: () => [me],
        local: fake(() => agents, {
          s1: { title: '검진라이브러리 검색 index 설정', folder: 'pixel-office-lan' },
          s2: { title: 'x'.repeat(100), folder: '' },
        }),
        settings: () => ({ presence: true, agents: true }),
      },
      { lang: 'ko', notify: (b) => (sent.push(b), true) },
    );
    n.tick(0);
    agents = [agent({ act: 'ask', room: 'lounge', target: '' }), agent({ id: 's2', num: 2 })];
    n.tick(1000);
    agents = [agent(idle), agent({ id: 's2', num: 2, ...idle })];
    n.tick(2000);
    expect(sent[0]).toBe(
      'Claude #1 · pixel-office-lan\n검진라이브러리 검색 index 설정 — 응답을 기다립니다',
    );
    expect(sent[1]).toBe(
      `Claude #1 · 검진라이브러리 검색 index 설정 — 작업을 마쳤습니다\nClaude #2 · ${'x'.repeat(23)}… — 작업을 마쳤습니다`,
    );
  });

  it("a peer's agents (office snapshot) never notify, whatever they do", () => {
    // what lan.office() returns: peers' views carry `peer` — not ours even if fed in
    const peer = { id: 'p', account: 'p', nickname: '', palette: 0, hueShift: 0 };
    const peerView = (o: Partial<AgentView>) => ({
      ...agent({ id: 'p1', ...o }),
      key: 'p:p1',
      peer,
    });
    const sent: string[] = [];
    let views: AgentView[] = [peerView({})];
    const n = new Notifier(
      {
        view: () => 'public',
        people: () => [me, p('p')],
        local: fake(() => views),
        settings: () => ({ presence: true, agents: true }),
      },
      { lang: 'ko', notify: (b) => (sent.push(b), true) },
    );
    n.tick(0);
    views = [peerView({ permission: true })];
    n.tick(1000);
    views = [peerView(idle)];
    n.tick(2000);
    expect(sent).toEqual([]);
  });
});

describe('agentText with a title', () => {
  const e = { kind: 'waiting', label: 'Codex #2', context: '' } as const;
  it('clips the title; no title = label + folder on one line', () => {
    expect(agentText('en', { ...e, title: 't'.repeat(80), folder: 'repo' })).toBe(
      `Codex #2 · repo\n${'t'.repeat(59)}… — waiting for you`,
    );
    expect(agentText('en', { ...e, kind: 'done', title: 'Fix login' })).toBe(
      'Codex #2\nFix login — finished',
    );
    expect(agentText('ko', { ...e, folder: 'repo' })).toBe('Codex #2 · repo — 응답을 기다립니다');
    expect(agentText('en', { ...e, kind: 'done', folder: 'repo' })).toBe(
      'Codex #2 · repo finished its work',
    );
  });
});

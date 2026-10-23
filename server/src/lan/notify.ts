// OS notifications, decided here on the server (so they work with no window open):
// - join/leave of the public office: diff of consecutive ticks' people by peerId;
// - this PC's own main agents: waiting for an answer (❗ / ask) and turn finished.
// Pure watchers driven by `Notifier.tick` every SNAPSHOT_INTERVAL_MS (cli.ts); the
// body goes to the tray helper (tray.ts, base64 on its stdin) or, without one, the log.
import type { AgentView } from '../../../core/src/lan.js';
import { peerLabel, PUBLIC_VIEW } from '../../../core/src/lan.js';
import {
  NOTIFY_BODY_MAX,
  NOTIFY_CONTEXT_MAX,
  NOTIFY_NAME_MAX,
  PRESENCE_LEAVE_GRACE_MS,
  PRESENCE_SETTLE_MS,
} from '../constants.js';

interface Person {
  peerId: string;
  account: string;
  nickname: string;
  self: boolean;
}

export interface PresenceChange {
  joined: string[];
  left: string[];
}

/** Clip to `max` code points (… when cut), whitespace runs → one space. */
export const clip = (s: string, max: number): string => {
  const cps = [...s.replace(/\s+/g, ' ').trim()];
  return cps.length > max ? `${cps.slice(0, max - 1).join('')}…` : cps.join('');
};

/**
 * Public office only. No timers: a leave is reported by the first tick at least
 * PRESENCE_LEAVE_GRACE_MS after it, dropped if the peer is back by then. After a
 * reset (start, view switch) people who show up within PRESENCE_SETTLE_MS of the
 * first tick are the baseline (peers are rediscovered over a few seconds).
 */
export class PresenceWatcher {
  view: string | null = null;
  /** peerId → label of the last tick; null = take the next one as the baseline. */
  private known: Map<string, string> | null = null;
  private since = 0;
  /** Gone but not reported yet. */
  private gone = new Map<string, { label: string; since: number }>();

  reset(view: string | null): void {
    this.view = view;
    this.known = null;
    this.gone.clear();
  }

  apply(people: Person[], now: number): PresenceChange {
    const out: PresenceChange = { joined: [], left: [] };
    if (this.view !== PUBLIC_VIEW) return out;
    const cur = new Map(people.filter((p) => !p.self).map((p) => [p.peerId, peerLabel(p)]));
    const known = this.known;
    this.known = cur;
    if (!known) {
      this.since = now;
      return out;
    }
    const settling = now - this.since < PRESENCE_SETTLE_MS;
    for (const [id, label] of cur) {
      if (known.has(id) || settling) continue;
      if (!this.gone.delete(id)) out.joined.push(label);
    }
    for (const [id, label] of known) if (!cur.has(id)) this.gone.set(id, { label, since: now });
    for (const [id, g] of this.gone) {
      if (cur.has(id)) this.gone.delete(id);
      else if (now - g.since >= PRESENCE_LEAVE_GRACE_MS) {
        out.left.push(g.label);
        this.gone.delete(id);
      }
    }
    return out;
  }
}

export interface AgentEvent {
  kind: 'waiting' | 'done';
  /** `Claude #1`, as the office's name tag. */
  label: string;
  /** waiting: what it waits on (command, file…), '' if none. */
  context: string;
}

const waiting = (v: AgentView): boolean => v.permission || v.act === 'ask';
/** Done = idle in the lounge: the room is debounced (ROOM_DEBOUNCE_MS), so a new turn
 *  starting right away never shows as finished — the same moment the office shows it. */
const idle = (v: AgentView): boolean => v.room === 'lounge' && v.act === 'idle';

/**
 * This PC's main agents (subagents/shells ignored: their parent's turn is what matters).
 * An agent seen for the first time is the baseline (also everything at start); a
 * closed session just disappears. waiting: false→true once per wait; done: busy→idle
 * once per turn.
 */
export class AgentWatcher {
  private last = new Map<string, { waiting: boolean; idle: boolean }>();

  apply(views: AgentView[]): AgentEvent[] {
    const out: AgentEvent[] = [];
    const next = new Map<string, { waiting: boolean; idle: boolean }>();
    for (const v of views) {
      if (v.kind !== 'main') continue;
      const now = { waiting: waiting(v), idle: idle(v) };
      const prev = this.last.get(v.id);
      next.set(v.id, now);
      if (!prev) continue;
      const label = `${v.provider === 'claude' ? 'Claude' : 'Codex'} #${v.num.toString()}`;
      if (now.waiting && !prev.waiting) {
        out.push({ kind: 'waiting', label, context: v.permission ? v.target : '' });
      } else if (now.idle && !prev.idle) out.push({ kind: 'done', label, context: '' });
    }
    this.last = next;
    return out;
  }
}

export type NotifyLang = 'ko' | 'en';

export function presenceText(lang: NotifyLang, c: PresenceChange): string[] {
  const out: string[] = [];
  for (const [names, verbKo, verbEn] of [
    [c.joined, '접속했습니다', 'joined'],
    [c.left, '나갔습니다', 'left'],
  ] as const) {
    if (names.length === 0) continue;
    const who =
      names.length === 1
        ? clip(names[0], NOTIFY_NAME_MAX)
        : lang === 'ko'
          ? `${names.length.toString()}명`
          : `${names.length.toString()} people`;
    out.push(
      lang === 'ko' ? `${who}${names.length === 1 ? ' 님' : ''}이 ${verbKo}` : `${who} ${verbEn}`,
    );
  }
  return out;
}

export function agentText(lang: NotifyLang, e: AgentEvent): string {
  const ctx = e.context ? ` (${clip(e.context, NOTIFY_CONTEXT_MAX)})` : '';
  if (e.kind === 'waiting') {
    return lang === 'ko'
      ? `${e.label} — 응답을 기다립니다${ctx}`
      : `${e.label} is waiting for you${ctx}`;
  }
  return lang === 'ko' ? `${e.label} — 작업을 마쳤습니다` : `${e.label} finished its work`;
}

export interface NotifySettings {
  presence: boolean;
  agents: boolean;
}

export class Notifier {
  private readonly presence = new PresenceWatcher();
  private readonly agents = new AgentWatcher();

  constructor(
    private readonly src: {
      view(): string;
      people(view: string): Person[];
      /** This PC's own agents (the scanner), never peers'. */
      agents(): AgentView[];
      settings(): NotifySettings;
    },
    private readonly out: { lang: NotifyLang; notify(body: string): boolean },
  ) {}

  /** One tick: watchers always run (so turning a setting on never fires stale news). */
  tick(now = Date.now()): void {
    const view = this.src.view();
    if (view !== this.presence.view) this.presence.reset(view); // start / another office: new baseline
    const change = this.presence.apply(this.src.people(view), now);
    const events = this.agents.apply(this.src.agents());
    if (change.joined.length + change.left.length + events.length === 0) return;
    const { lang } = this.out;
    const settings = this.src.settings();
    for (const body of settings.presence ? presenceText(lang, change) : []) this.send(body);
    if (settings.agents && events.length > 0) {
      this.send(events.map((e) => agentText(lang, e)).join('\n'));
    }
  }

  private send(body: string): void {
    const text = [...body].slice(0, NOTIFY_BODY_MAX).join('');
    if (!this.out.notify(text)) console.log(`[Pixel Office] 알림: ${text}`);
  }
}

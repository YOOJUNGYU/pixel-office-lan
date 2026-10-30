// LAN shared model + validation of untrusted peer packets.

export type Room = 'coding' | 'library' | 'server' | 'lounge';
export const ROOM_LABELS: Record<Room, string> = {
  coding: '코딩실',
  library: '자료실',
  server: '서버실',
  lounge: '대기실',
};
/** The four fixed rooms, in layout order. */
export const ROOM_ORDER: readonly Room[] = ['coding', 'library', 'server', 'lounge'];

/** Layout grid limits (editor expansion, layout validation on server and webview). */
export const MAX_LAYOUT_COLS = 128;
export const MAX_LAYOUT_ROWS = 128;

/** The fields of a layout normalizeRoomAreas reads/writes (the rest passes through). */
export interface RoomAreasLayout {
  cols: number;
  rows: number;
  areas?: Array<{ label: string; color: string }>;
  areaTiles?: Array<string | null>;
}

const HEX_RGB = /^#[0-9a-f]{6}$/i;

/** Room overlay colors of the bundled default layout: the last-resort color of a missing room. */
/* eslint-disable pixel-agents/no-inline-colors -- shared default, used by server and webview */
export const ROOM_DEFAULT_COLORS: Readonly<Record<Room, string>> = {
  coding: '#48dbfb',
  library: '#1dd1a1',
  server: '#ff6b6b',
  lounge: '#feca57',
};
/* eslint-enable pixel-agents/no-inline-colors */

/** A layout grid worth building: v1, cols/rows integers within MAX_LAYOUT_COLS×ROWS,
 *  `tiles` exactly cols*rows long, `furniture` an array. Cheap: never walks the
 *  arrays, so a hostile huge cols×rows is refused before anything allocates. */
export function isLayoutGrid(
  x: unknown,
): x is { version: 1; cols: number; rows: number; tiles: unknown[]; furniture: unknown[] } {
  if (!isObj(x) || x.version !== 1) return false;
  const { cols, rows } = x;
  return (
    int(cols, 1, MAX_LAYOUT_COLS) !== null &&
    int(rows, 1, MAX_LAYOUT_ROWS) !== null &&
    Array.isArray(x.tiles) &&
    x.tiles.length === (cols as number) * (rows as number) &&
    Array.isArray(x.furniture)
  );
}

/**
 * Exactly the four fixed rooms: `areas` = the four definitions in ROOM_ORDER
 * (a room's existing valid color is kept, a missing room gets a valid
 * `colors[room]`, else ROOM_DEFAULT_COLORS — never an empty color),
 * `areaTiles` = cols*rows labels with everything but the four room labels
 * cleared (a missing or mis-sized array becomes all null). Never throws on odd
 * `areas`/`areaTiles`; cols/rows must already be validated.
 */
export function normalizeRoomAreas<T extends RoomAreasLayout>(
  layout: T,
  colors: Partial<Record<Room, string>> = {},
): T {
  const have = new Map<string, string>();
  for (const a of Array.isArray(layout.areas) ? (layout.areas as unknown[]) : []) {
    if (isObj(a) && typeof a.label === 'string' && typeof a.color === 'string') {
      if (HEX_RGB.test(a.color) && !have.has(a.label)) have.set(a.label, a.color);
    }
  }
  const areas = ROOM_ORDER.map((r) => ({
    label: ROOM_LABELS[r],
    color:
      have.get(ROOM_LABELS[r]) ??
      (HEX_RGB.test(colors[r] ?? '') ? colors[r]! : ROOM_DEFAULT_COLORS[r]),
  }));
  const labels = new Set<unknown>(Object.values(ROOM_LABELS));
  const n = layout.cols * layout.rows;
  const src: unknown[] =
    Array.isArray(layout.areaTiles) && layout.areaTiles.length === n ? layout.areaTiles : [];
  const areaTiles = Array.from({ length: n }, (_, i) =>
    labels.has(src[i]) ? (src[i] as string) : null,
  );
  return { ...layout, areas, areaTiles };
}

/**
 * Rooms come only from the bundled default layout (the editor has no area tool):
 * a normalized layout with a room that has no tiles takes that room's tiles from
 * `fallback` (the default layout) when both grids are the same size, on tiles
 * that carry no other room. Otherwise the layout is returned as is.
 */
export function fillMissingRooms<T extends RoomAreasLayout>(layout: T, fallback: unknown): T {
  if (!isObj(fallback) || fallback.cols !== layout.cols || fallback.rows !== layout.rows) {
    return layout;
  }
  const src = fallback.areaTiles;
  const tiles = layout.areaTiles;
  if (!Array.isArray(src) || !Array.isArray(tiles) || src.length !== tiles.length) return layout;
  const missing = new Set<unknown>(
    ROOM_ORDER.map((r) => ROOM_LABELS[r]).filter((l) => !tiles.includes(l)),
  );
  if (missing.size === 0) return layout;
  const areaTiles = tiles.map((t, i) =>
    t === null && missing.has(src[i]) ? (src[i] as string) : t,
  );
  return { ...layout, areaTiles };
}

/** Bundled pets a profile may pick as its character (unknown ids → the human palette). */
export const PET_IDS = ['claudio', 'gitcat'] as const;
export type PetId = (typeof PET_IDS)[number];
export const isPetId = (x: unknown): x is PetId => (PET_IDS as readonly unknown[]).includes(x);
const ACTS = [
  'idle',
  'edit',
  'read',
  'search',
  'find',
  'web',
  'fetch',
  'mcp',
  'run',
  'delegate',
  'ask',
  'image',
  'tool',
] as const;
/** What an agent is doing; each viewer renders it in their own language. */
export type Act = (typeof ACTS)[number];
export type Lang = 'ko' | 'en';
export type Provider = 'claude' | 'codex';
export type ViewKind = 'main' | 'subagent' | 'shell';

export interface AgentView {
  /** unique within a peer. main=session id, subagent=`${parentId}/sub/${name}`, shell=`${parentId}/sh/${shellId}` */
  id: string;
  provider: Provider;
  kind: ViewKind;
  /** #n for main, 0 for children */
  num: number;
  /** children only */
  parentId?: string;
  room: Room;
  /** waiting for approval/input */
  permission: boolean;
  act: Act;
  /** what the act is applied to (file, pattern, command…), <=120 chars, '' if none */
  target: string;
  /** <=200 chars, '' if none */
  reason: string;
  /** The owner hides its work: act/target/reason are blanked; room, kind and permission stay. */
  hidden?: true;
  /** Children only: talking with its parent right now (handed a task, reporting back, or a
   *  SendMessage to it); viewers show the two face to face. Older peers ignore it. */
  talk?: true;
}
export interface PeerInfo {
  id: string;
  /** OS login account name: fixed, always shown. */
  account: string;
  /** Optional, '' = none. */
  nickname: string;
  /** When this nickname was set (ms epoch): the earlier one keeps a clashing nickname. Absent = unknown (loses). */
  nickSince?: number;
  palette: number;
  hueShift: number;
  /** Pet character instead of the `palette` human; absent = human. Unknown ids are dropped. */
  pet?: PetId;
  /** Avatar name tag colours; absent = the default tag. */
  tagColors?: TagColors;
}

/** A person's avatar name tag colours (`#RRGGBB`, upper case), chosen in the profile. */
export interface TagColors {
  bg: string;
  fg: string;
}

const HEX_COLOR = /^#[0-9A-F]{6}$/i;

/** Untrusted tag colours → both valid hex colours (upper-cased), else undefined. */
export function parseTagColors(raw: unknown): TagColors | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const { bg, fg } = raw as Record<string, unknown>;
  return typeof bg === 'string' &&
    typeof fg === 'string' &&
    HEX_COLOR.test(bg) &&
    HEX_COLOR.test(fg)
    ? { bg: bg.toUpperCase(), fg: fg.toUpperCase() }
    : undefined;
}
/** This PC's chat bubble (shown above its avatar), in every presence of its channel until replaced or deleted. */
export interface PeerChat {
  /** Random CHAT_ID_LENGTH chars; a new id = a new bubble. */
  id: string;
  /** Sanitised (cleanChatText), 1..CHAT_MAX_CHARS code points. */
  text: string;
  /** Sender's send time (ms epoch). */
  ts: number;
}
/** Which way an avatar faces. */
export const AVATAR_DIRS = ['down', 'up', 'left', 'right'] as const;
export type AvatarDir = (typeof AVATAR_DIRS)[number];
/** A person's avatar: a tile of the sender's own layout (integers, 0..MAX_LAYOUT_COLS-1 / ROWS-1) and facing. */
export interface AvatarPos {
  col: number;
  row: number;
  dir: AvatarDir;
}
export interface PeerPacket {
  v: 1;
  peer: PeerInfo;
  views: AgentView[];
  /** Absent = not chatting. Older peers ignore it. */
  chat?: PeerChat;
  /** Where this PC's avatar stands; absent = not placed yet (receivers pick a spot). */
  avatar?: AvatarPos;
  /** Which shared layout of this channel the PC has (≥ 1.0.14; absent = an older PC). */
  layout?: LayoutRev;
}

/**
 * A shared (public/team) office layout version. The newest wins everywhere: higher
 * `rev`, then the larger `by` (author peer id). rev 0 = the bundled default (by '', h '').
 * `h` = the first LAYOUT_HASH_HEX hex chars of SHA-256 of the layout JSON a PC sends.
 */
export interface LayoutRev {
  rev: number;
  by: string;
  h: string;
}
export const LAYOUT_HASH_HEX = 16;
export const DEFAULT_LAYOUT_REV: LayoutRev = { rev: 0, by: '', h: '' };
const LAYOUT_HASH = new RegExp(`^[0-9a-f]{${String(LAYOUT_HASH_HEX)}}$`);

/** a is newer than b. */
export const newerLayout = (a: LayoutRev, b: LayoutRev): boolean =>
  a.rev !== b.rev ? a.rev > b.rev : a.by > b.by;

/** Untrusted layout version → a fresh LayoutRev, else null. */
export function parseLayoutRev(raw: unknown): LayoutRev | null {
  if (!isObj(raw)) return null;
  const { rev, by, h } = raw;
  if (!Number.isSafeInteger(rev) || (rev as number) < 0) return null;
  if (rev === 0) return by === '' && h === '' ? { ...DEFAULT_LAYOUT_REV } : null;
  if (typeof by !== 'string' || by.length < 1 || by.length > MAX_PEER_ID) return null;
  if (typeof h !== 'string' || !LAYOUT_HASH.test(h)) return null;
  return { rev: rev as number, by, h };
}
/** key=`${peer.id}:${id}` */
export interface OfficeAgent extends AgentView {
  key: string;
  parentKey?: string;
  peer: PeerInfo;
}

const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const HOSTNAME = /^[a-zA-Z0-9.-]{1,253}$/;

/** A manual peer address: plain IPv4 or hostname (no scheme, port or IPv6). Server and profile form share it. */
export function isValidManualPeer(s: string): boolean {
  return IPV4.test(s) ? s.split('.').every((n) => Number(n) <= 255) : HOSTNAME.test(s);
}

/** Nickname identity for the uniqueness rule: NFC, trimmed, inner whitespace
 *  collapsed, case-insensitive. '' = unset (exempt from the rule). */
export const nicknameKey = (s: string): string =>
  s.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();

/** The label everywhere a PC is named: the fixed account, then the optional
 *  nickname (left out when it just repeats the account). */
export const peerLabel = (p: { account: string; nickname: string }): string =>
  p.nickname && nicknameKey(p.nickname) !== nicknameKey(p.account)
    ? `${p.account} (${p.nickname})`
    : p.account;

export const MAX_ACCOUNT = 32;
/** Length of the peer-id prefix shown to tell same-looking PCs apart (and as a 0.3.x account stand-in). */
export const SHORT_PEER_ID = 4;

const CONTROL_OR_FORMAT = /\p{C}/u;

/** At most `max` code points (never splits a surrogate pair). */
export const takeCodePoints = (s: string, max: number): string =>
  Array.from(s).slice(0, max).join('');

/** A displayable account name (trimmed, 1..MAX_ACCOUNT code points, no control/bidi/format chars), else null. */
export function cleanAccount(x: unknown): string | null {
  if (typeof x !== 'string') return null;
  const s = x.trim();
  const n = Array.from(s).length;
  return n >= 1 && n <= MAX_ACCOUNT && !CONTROL_OR_FORMAT.test(s) ? s : null;
}

/** A received nickname made displayable: control/bidi/format chars removed, trimmed. */
export const cleanNickname = (s: string): string => s.replace(/\p{C}/gu, '').trim();

// ── Chat ──
export const CHAT_MAX_CHARS = 100;
/** One message per this interval (webview and server). */
export const CHAT_MIN_INTERVAL_MS = 2_000;
export const CHAT_ID_LENGTH = 8;
const CHAT_ID = /^[0-9a-z]{8}$/i;
/** Raw input looked at before sanitising (bounds the work on hostile input). */
const CHAT_RAW_MAX = 4 * CHAT_MAX_CHARS;

/** Chat text made displayable: line breaks/tabs → space, other control/bidi/format
 *  chars removed, whitespace collapsed, trimmed, ≤ CHAT_MAX_CHARS code points; '' → null. */
export function cleanChatText(x: unknown): string | null {
  if (typeof x !== 'string') return null;
  const s = takeCodePoints(
    x
      .slice(0, CHAT_RAW_MAX)
      .replace(/\p{Cc}/gu, ' ')
      .replace(/\p{C}/gu, '')
      .replace(/\s+/g, ' ')
      .trim(),
    CHAT_MAX_CHARS,
  ).trim();
  return s === '' ? null : s;
}

/** Untrusted chat → a fresh PeerChat, else null. Pre-avatar senders' `col`/`row` are ignored. */
export function parseChat(raw: unknown): PeerChat | null {
  if (!isObj(raw)) return null;
  const text = cleanChatText(raw.text);
  const { id, ts } = raw;
  if (typeof id !== 'string' || !CHAT_ID.test(id) || text === null) return null;
  if (typeof ts !== 'number' || !Number.isSafeInteger(ts) || ts < 0) return null;
  return { id, text, ts };
}

export const isAvatarDir = (x: unknown): x is AvatarDir =>
  (AVATAR_DIRS as readonly unknown[]).includes(x);

/**
 * Untrusted avatar → a fresh AvatarPos, else null. `strict` (this PC's own
 * `moveAvatar`): integer tiles within the grid limits. Otherwise (peers, saved
 * file): finite numbers rounded and clamped into the grid limits.
 */
export function parseAvatar(raw: unknown, strict = false): AvatarPos | null {
  if (!isObj(raw) || !isAvatarDir(raw.dir)) return null;
  const tile = (x: unknown, max: number): number | null =>
    strict
      ? int(x, 0, max)
      : typeof x === 'number' && Number.isFinite(x)
        ? Math.min(Math.max(Math.round(x), 0), max)
        : null;
  const col = tile(raw.col, MAX_LAYOUT_COLS - 1);
  const row = tile(raw.row, MAX_LAYOUT_ROWS - 1);
  return col === null || row === null ? null : { col, row, dir: raw.dir };
}

/** The office everyone on the LAN shares; any other view is a team office tag. */
export const PUBLIC_VIEW = 'public';
/** This PC alone, offline: no datagram in or out, the small personal layout. Never a team tag (11 chars). */
export const PERSONAL_VIEW = 'personal';
export const LAN_UDP_PORT = 47800;
export const LAN_HTTP_PORT = 47801;
export const MAX_PACKET_BYTES = 60_000;
const MAX_VIEWS = 50;
const MAX_PEER_ID = 64;
const MAX_NICKNAME = 20;
const MAX_ID = 200;
const MAX_TARGET = 120;
const MAX_REASON = 200;

const ROOMS = new Set<string>(ROOM_ORDER);
const PROVIDERS = new Set<string>(['claude', 'codex']);
const KINDS = new Set<string>(['main', 'subagent', 'shell']);
const ACT_SET = new Set<string>(ACTS);

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const str = (x: unknown, max: number): string | null =>
  typeof x === 'string' ? x.slice(0, max) : null;
const int = (x: unknown, min: number, max: number): number | null =>
  typeof x === 'number' && Number.isInteger(x) && x >= min && x <= max ? x : null;

function parseView(raw: unknown): AgentView | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id, MAX_ID);
  const num = int(raw.num, 0, 1_000_000);
  const target = str(raw.target, MAX_TARGET);
  const reason = str(raw.reason, MAX_REASON);
  if (id === null || num === null || target === null || reason === null) return null;
  if (!PROVIDERS.has(raw.provider as string) || !KINDS.has(raw.kind as string)) return null;
  if (!ROOMS.has(raw.room as string) || typeof raw.permission !== 'boolean') return null;
  if (!ACT_SET.has(raw.act as string)) return null;
  const view: AgentView = {
    id,
    provider: raw.provider as Provider,
    kind: raw.kind as ViewKind,
    num,
    room: raw.room as Room,
    permission: raw.permission,
    act: raw.act as Act,
    target,
    reason,
  };
  if (raw.hidden === true) view.hidden = true;
  if (raw.talk === true) view.talk = true;
  if (raw.parentId !== undefined) {
    const parentId = str(raw.parentId, MAX_ID);
    if (parentId === null) return null;
    if (view.kind !== 'main') view.parentId = parentId;
  }
  return view;
}

/** Parse untrusted UDP text. Never throws; returns a freshly built object or null. */
export function parsePeerPacket(text: string): PeerPacket | null {
  if (typeof text !== 'string' || text.length > MAX_PACKET_BYTES) return null;
  try {
    const raw: unknown = JSON.parse(text);
    if (!isObj(raw) || raw.v !== 1 || !isObj(raw.peer) || !Array.isArray(raw.views)) return null;
    const id = str(raw.peer.id, Infinity);
    const rawNickname = str(raw.peer.nickname, MAX_NICKNAME);
    const palette = int(raw.peer.palette, 0, 5);
    const hueShift = int(raw.peer.hueShift, 0, 360);
    if (!id || id.length > MAX_PEER_ID || rawNickname === null) return null;
    if (palette === null || hueShift === null) return null;
    const views: AgentView[] = [];
    for (const r of raw.views.slice(0, MAX_VIEWS)) {
      const v = parseView(r);
      if (!v) return null;
      views.push(v);
    }
    let nickname = cleanNickname(rawNickname);
    let account = cleanAccount(raw.peer.account);
    if (account === null) {
      // 0.3.x peers send no account: their nickname (or short id) stands in, shown once.
      account = cleanAccount(nickname) ?? id.slice(0, SHORT_PEER_ID);
      nickname = '';
    }
    const peer: PeerInfo = { id, account, nickname, palette, hueShift };
    if (isPetId(raw.peer.pet)) peer.pet = raw.peer.pet;
    const tagColors = parseTagColors(raw.peer.tagColors);
    if (tagColors) peer.tagColors = tagColors;
    const since = raw.peer.nickSince;
    if (typeof since === 'number' && Number.isSafeInteger(since) && since >= 0) {
      peer.nickSince = since;
    }
    const chat = parseChat(raw.chat);
    const avatar = parseAvatar(raw.avatar);
    const layout = parseLayoutRev(raw.layout);
    return {
      v: 1,
      peer,
      views,
      ...(chat && { chat }),
      ...(avatar && { avatar }),
      ...(layout && { layout }),
    };
  } catch {
    return null;
  }
}

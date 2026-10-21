// LAN shared model + validation of untrusted peer packets.

export type Room = 'coding' | 'library' | 'server' | 'lounge';
export const ROOM_LABELS: Record<Room, string> = {
  coding: '코딩실',
  library: '자료실',
  server: '서버실',
  lounge: '대기실',
};
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
  /** <=120 chars */
  summary: string;
  /** <=200 chars, '' if none */
  reason: string;
}
export interface PeerInfo {
  id: string;
  nickname: string;
  palette: number;
  hueShift: number;
}
export interface PeerPacket {
  v: 1;
  peer: PeerInfo;
  views: AgentView[];
}
/** key=`${peer.id}:${id}` */
export interface OfficeAgent extends AgentView {
  key: string;
  parentKey?: string;
  peer: PeerInfo;
}

export const LAN_UDP_PORT = 47800;
export const LAN_HTTP_PORT = 47801;
export const MAX_PACKET_BYTES = 60_000;
const MAX_VIEWS = 50;
const MAX_PEER_ID = 64;
const MAX_NICKNAME = 20;
const MAX_ID = 200;
const MAX_SUMMARY = 120;
const MAX_REASON = 200;

const ROOMS = new Set<string>(Object.keys(ROOM_LABELS));
const PROVIDERS = new Set<string>(['claude', 'codex']);
const KINDS = new Set<string>(['main', 'subagent', 'shell']);

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
  const summary = str(raw.summary, MAX_SUMMARY);
  const reason = str(raw.reason, MAX_REASON);
  if (id === null || num === null || summary === null || reason === null) return null;
  if (!PROVIDERS.has(raw.provider as string) || !KINDS.has(raw.kind as string)) return null;
  if (!ROOMS.has(raw.room as string) || typeof raw.permission !== 'boolean') return null;
  const view: AgentView = {
    id,
    provider: raw.provider as Provider,
    kind: raw.kind as ViewKind,
    num,
    room: raw.room as Room,
    permission: raw.permission,
    summary,
    reason,
  };
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
    const nickname = str(raw.peer.nickname, MAX_NICKNAME);
    const palette = int(raw.peer.palette, 0, 5);
    const hueShift = int(raw.peer.hueShift, 0, 360);
    if (!id || id.length > MAX_PEER_ID || nickname === null) return null;
    if (palette === null || hueShift === null) return null;
    const views: AgentView[] = [];
    for (const r of raw.views.slice(0, MAX_VIEWS)) {
      const v = parseView(r);
      if (!v) return null;
      views.push(v);
    }
    return { v: 1, peer: { id, nickname, palette, hueShift }, views };
  } catch {
    return null;
  }
}

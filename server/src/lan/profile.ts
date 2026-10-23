import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { AvatarPos, PeerChat, PetId, TagColors } from '../../../core/src/lan.js';
import {
  cleanAccount,
  isPetId,
  isValidManualPeer,
  MAX_ACCOUNT,
  parseAvatar,
  parseChat,
  parseTagColors,
  PERSONAL_VIEW,
  PUBLIC_VIEW,
  takeCodePoints,
} from '../../../core/src/lan.js';
import {
  ACCOUNT_FALLBACK,
  INVITE_SECRET_BYTES,
  KNOWN_PEERS_FILE_NAME,
  LAYOUT_FILE_DIR,
  MAX_KNOWN_PEERS,
  MAX_OFFICE_NAME,
  MAX_OFFICES,
  PIN_SAVE_DELAY_MS,
} from '../constants.js';
import { createIdentity, isWireId, publicKeyOf, teamKey, teamTag } from './crypto.js';

/** A joined team office. `secret` (base64 invite secret) never leaves this PC. */
export interface TeamOffice {
  tag: string;
  name: string;
  secret: string;
}

export interface Profile {
  peerId: string;
  nickname: string;
  palette: number;
  hueShift: number;
  /** Pet character instead of the `palette` human; absent = human. */
  pet?: PetId;
  /** Avatar name tag colours; absent = the default tag. */
  tagColors?: TagColors;
  hideDetails: boolean;
  manualPeers: string[];
  identity: { publicKey: string; privateKeyPem: string };
  offices: TeamOffice[];
  /** PUBLIC_VIEW, a joined office's tag, or PERSONAL_VIEW (offline; team secrets kept). */
  activeView: string;
  /** Saved once from the first-run form (character and color chosen). */
  setUp: boolean;
  /** When the current nickname was set (ms epoch); the earlier one keeps a clashing nickname. */
  nicknameSince: number;
  /** This PC's chat bubble and the office view it was said in; absent = none. */
  chat?: SavedChat;
  /** Where my avatar stands, per layout: `office` (layout.json: public and team
   *  offices) and `personal` (layout-personal.json). Absent = the page picks a spot. */
  avatar?: SavedAvatars;
}

export type SavedChat = PeerChat & { view: string };
export type AvatarLayout = 'office' | 'personal';
export type SavedAvatars = Partial<Record<AvatarLayout, AvatarPos>>;

/** Stored avatar spots; malformed ones dropped. */
function parseSavedAvatars(raw: unknown): SavedAvatars | undefined {
  if (!isObj(raw)) return undefined;
  const out: SavedAvatars = {};
  for (const k of ['office', 'personal'] as const) {
    const a = parseAvatar(raw[k], true);
    if (a) out[k] = a;
  }
  return out.office || out.personal ? out : undefined;
}

/** What saveProfile may change; identity/offices/views change only via their own messages. */
export type EditableProfile = Pick<
  Profile,
  'nickname' | 'palette' | 'hueShift' | 'pet' | 'tagColors' | 'hideDetails' | 'manualPeers'
>;

const PROFILE_FILE_NAME = 'profile.json';
const MAX_NICKNAME = 20;
const MAX_MANUAL_PEERS = 20;

const defaultDir = (): string => path.join(os.homedir(), LAYOUT_FILE_DIR);
const isInt = (x: unknown, min: number, max: number): x is number =>
  typeof x === 'number' && Number.isInteger(x) && x >= min && x <= max;
const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

/** Atomic (tmp + rename) owner-only JSON write. */
function writePrivateJson(dir: string, name: string, data: unknown): void {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 });
  fs.chmodSync(tmp, 0o600); // a leftover tmp keeps its old mode otherwise
  fs.renameSync(tmp, file);
}

function readJsonObject(file: string): Record<string, unknown> {
  try {
    const j: unknown = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (isObj(j)) return j;
  } catch {
    // missing or unparsable
  }
  return {};
}

/** Trimmed office name, 1..MAX_OFFICE_NAME chars; null otherwise. */
export function validateOfficeName(x: unknown): string | null {
  if (typeof x !== 'string') return null;
  const s = x.trim();
  return s.length >= 1 && s.length <= MAX_OFFICE_NAME ? s : null;
}

/** Team office from its invite secret; the tag is always derived, never trusted from disk. */
export function officeFromSecret(secret: Buffer, name: string): TeamOffice {
  return { tag: teamTag(teamKey(secret)), name, secret: secret.toString('base64') };
}

function parseOffices(x: unknown): TeamOffice[] {
  const out: TeamOffice[] = [];
  for (const o of Array.isArray(x) ? x : []) {
    if (!isObj(o) || typeof o.secret !== 'string') continue;
    const secret = Buffer.from(o.secret, 'base64');
    if (secret.length !== INVITE_SECRET_BYTES || secret.toString('base64') !== o.secret) continue;
    const office = officeFromSecret(secret, validateOfficeName(o.name) ?? '');
    if (out.length < MAX_OFFICES && !out.some((e) => e.tag === office.tag)) out.push(office);
  }
  return out;
}

/** The office `view` is open on this PC: public only while in no team, a team once
 *  joined, personal always. */
export const isViewOpen = (offices: TeamOffice[], view: unknown): boolean =>
  view === PERSONAL_VIEW ||
  (view === PUBLIC_VIEW ? offices.length === 0 : offices.some((o) => o.tag === view));

/** A stored chat, or undefined when malformed or its office is no longer open. */
function parseSavedChat(raw: unknown, offices: TeamOffice[]): SavedChat | undefined {
  const chat = parseChat(raw);
  const view = isObj(raw) ? raw.view : undefined;
  return chat && typeof view === 'string' && isViewOpen(offices, view)
    ? { ...chat, view }
    : undefined;
}

/** Validates a client-supplied update. Returns a fresh object, or null if anything is off.
 *  `pet` and `tagColors` are optional: an unknown id or bad colours are ignored (defaults), not an error. */
export function validateProfileUpdate(x: unknown): EditableProfile | null {
  if (!isObj(x)) return null;
  const o = x;
  if (typeof o.nickname !== 'string' || typeof o.hideDetails !== 'boolean') return null;
  const nickname = o.nickname.trim();
  if (nickname.length > MAX_NICKNAME) return null; // optional: '' = account name only
  if (!isInt(o.palette, 0, 5) || !isInt(o.hueShift, 0, 360)) return null;
  if (!Array.isArray(o.manualPeers) || o.manualPeers.length > MAX_MANUAL_PEERS) return null;
  const tagColors = parseTagColors(o.tagColors);
  const manualPeers: string[] = [];
  for (const p of o.manualPeers) {
    if (typeof p !== 'string') return null;
    const t = p.trim();
    if (!t) continue;
    if (!isValidManualPeer(t)) return null;
    manualPeers.push(t);
  }
  return {
    nickname,
    palette: o.palette,
    hueShift: o.hueShift,
    ...(isPetId(o.pet) && { pet: o.pet }),
    ...(tagColors && { tagColors }),
    hideDetails: o.hideDetails,
    manualPeers,
  };
}

/** This PC's account name: the OS login name (`DOMAIN\\` stripped, trimmed,
 *  capped), else the hostname. Never editable; re-read at every start. */
export function accountName(username: string | undefined, hostname: string): string {
  const cap = (x: string) => takeCodePoints(x.trim(), MAX_ACCOUNT).trim();
  const user = username ? username.slice(username.lastIndexOf('\\') + 1) : '';
  return cleanAccount(cap(user)) ?? cleanAccount(cap(hostname)) ?? ACCOUNT_FALLBACK;
}

/** accountName() of this PC (macOS too: the short login name). Never throws. */
export function osAccount(): string {
  let user: string | undefined;
  try {
    user = os.userInfo().username;
  } catch {
    user = undefined;
  }
  return accountName(user, os.hostname());
}

/** Stored nicknameSince; a pre-0.4 profile with a nickname gets the file's mtime (else 0). */
function nicknameSinceOf(raw: Record<string, unknown>, nickname: string, dir: string): number {
  const v = raw.nicknameSince;
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return v;
  if (nickname === '') return 0;
  try {
    return Math.floor(fs.statSync(path.join(dir, PROFILE_FILE_NAME)).mtimeMs);
  } catch {
    return 0;
  }
}

export function saveProfile(p: Profile, dir: string = defaultDir()): void {
  writePrivateJson(dir, PROFILE_FILE_NAME, p);
}

/**
 * Missing or broken fields -> defaults (a valid peerId and key pair are kept);
 * a v0.1.0 file gets a key pair and the public office. Changes are persisted.
 */
export function loadProfile(dir: string = defaultDir()): Profile {
  const raw = readJsonObject(path.join(dir, PROFILE_FILE_NAME));
  let peerId = isWireId(raw.peerId) ? raw.peerId : randomUUID();
  const nick = typeof raw.nickname === 'string' ? raw.nickname.trim() : '';
  const editable: EditableProfile = validateProfileUpdate({ ...raw, nickname: nick }) ?? {
    nickname: '',
    palette: 0,
    hueShift: 0,
    hideDetails: true,
    manualPeers: [],
  };
  const pem =
    isObj(raw.identity) && typeof raw.identity.privateKeyPem === 'string'
      ? raw.identity.privateKeyPem
      : '';
  const pk = publicKeyOf(pem);
  // A new key under the old id would be ignored by every peer that pinned the old key.
  if (!pk && raw.identity !== undefined) peerId = randomUUID();
  const { publicKey, privateKeyPem } = pk
    ? { publicKey: pk, privateKeyPem: pem }
    : createIdentity(peerId);
  const offices = parseOffices(raw.offices);
  const activeView =
    raw.activeView === PERSONAL_VIEW || offices.some((o) => o.tag === raw.activeView)
      ? (raw.activeView as string)
      : (offices[0]?.tag ?? PUBLIC_VIEW);
  const profile: Profile = {
    peerId,
    ...editable,
    identity: { publicKey, privateKeyPem },
    offices,
    activeView, // a pre-0.4 `remoteView` key is dropped (rewritten below)
    // Before 0.4 a saved profile always had a nickname.
    setUp: raw.setUp === true || nick !== '',
    nicknameSince: nicknameSinceOf(raw, editable.nickname, dir),
  };
  const chat = parseSavedChat(raw.chat, offices);
  if (chat) profile.chat = chat;
  const avatar = parseSavedAvatars(raw.avatar);
  if (avatar) profile.avatar = avatar;
  if (JSON.stringify(profile) !== JSON.stringify(raw)) {
    try {
      saveProfile(profile, dir);
    } catch (err) {
      console.error('[Pixel Office] Failed to write profile:', err);
    }
  }
  return profile;
}

/**
 * TOFU pins (known-peers.json, 0600): peer id → public key seen first.
 * Least recently seen ids are dropped past MAX_KNOWN_PEERS.
 */
export class KnownPeers {
  private readonly pins = new Map<string, string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly dir: string = defaultDir()) {
    for (const [id, pk] of Object.entries(readJsonObject(path.join(dir, KNOWN_PEERS_FILE_NAME)))) {
      if (isWireId(id) && typeof pk === 'string') this.pins.set(id, pk);
    }
    this.trim();
  }

  get(id: string): string | undefined {
    const pk = this.pins.get(id);
    if (pk !== undefined) {
      this.pins.delete(id); // most recently seen goes last
      this.pins.set(id, pk);
    }
    return pk;
  }

  set(id: string, pk: string): void {
    this.pins.delete(id);
    this.pins.set(id, pk);
    this.trim();
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), PIN_SAVE_DELAY_MS);
    this.timer.unref();
  }

  /** Writes pending pins now (no-op when nothing changed). */
  flush(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
    try {
      writePrivateJson(this.dir, KNOWN_PEERS_FILE_NAME, Object.fromEntries(this.pins));
    } catch (err) {
      console.error('[Pixel Office] Failed to write known peers:', err);
    }
  }

  private trim(): void {
    for (const id of this.pins.keys()) {
      if (this.pins.size <= MAX_KNOWN_PEERS) break;
      this.pins.delete(id);
    }
  }
}

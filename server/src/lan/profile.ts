import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { isValidManualPeer, PUBLIC_VIEW } from '../../../core/src/lan.js';
import {
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
  hideDetails: boolean;
  manualPeers: string[];
  identity: { publicKey: string; privateKeyPem: string };
  offices: TeamOffice[];
  /** PUBLIC_VIEW or a joined office's tag: what this PC's browser shows. */
  activeView: string;
}

/** What saveProfile may change; identity/offices/views change only via their own messages. */
export type EditableProfile = Pick<
  Profile,
  'nickname' | 'palette' | 'hueShift' | 'hideDetails' | 'manualPeers'
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

/** Validates a client-supplied update. Returns a fresh object, or null if anything is off. */
export function validateProfileUpdate(x: unknown): EditableProfile | null {
  if (!isObj(x)) return null;
  const o = x;
  if (typeof o.nickname !== 'string' || typeof o.hideDetails !== 'boolean') return null;
  const nickname = o.nickname.trim();
  if (nickname.length < 1 || nickname.length > MAX_NICKNAME) return null;
  if (!isInt(o.palette, 0, 5) || !isInt(o.hueShift, 0, 360)) return null;
  if (!Array.isArray(o.manualPeers) || o.manualPeers.length > MAX_MANUAL_PEERS) return null;
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
    hideDetails: o.hideDetails,
    manualPeers,
  };
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
  // nickname '' is a valid stored state (not yet chosen), so validate fields individually
  const valid = validateProfileUpdate({ ...raw, nickname: nick || 'x' });
  const editable: EditableProfile =
    valid && nick
      ? valid
      : { nickname: '', palette: 0, hueShift: 0, hideDetails: true, manualPeers: [] };
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
  const activeView = offices.some((o) => o.tag === raw.activeView)
    ? (raw.activeView as string)
    : (offices[0]?.tag ?? PUBLIC_VIEW);
  const profile: Profile = {
    peerId,
    ...editable,
    identity: { publicKey, privateKeyPem },
    offices,
    activeView, // a pre-0.4 `remoteView` key is dropped (rewritten below)
  };
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

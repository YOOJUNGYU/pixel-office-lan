import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { LAYOUT_FILE_DIR } from '../constants.js';

export interface Profile {
  peerId: string;
  nickname: string;
  palette: number;
  hueShift: number;
  hideDetails: boolean;
  manualPeers: string[];
}

const PROFILE_FILE_NAME = 'profile.json';
const MAX_NICKNAME = 20;
const MAX_MANUAL_PEERS = 20;
const MAX_PEER_ID = 64;
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const HOSTNAME = /^[a-zA-Z0-9.-]{1,253}$/;

const defaultDir = (): string => path.join(os.homedir(), LAYOUT_FILE_DIR);
const isInt = (x: unknown, min: number, max: number): x is number =>
  typeof x === 'number' && Number.isInteger(x) && x >= min && x <= max;
const validIpv4 = (s: string): boolean => s.split('.').every((n) => Number(n) <= 255);

/** Validates a client-supplied update. Returns a fresh object, or null if anything is off. */
export function validateProfileUpdate(x: unknown): Omit<Profile, 'peerId'> | null {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
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
    if (IPV4.test(t) ? !validIpv4(t) : !HOSTNAME.test(t)) return null;
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
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, PROFILE_FILE_NAME);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(p, null, 2), { encoding: 'utf-8', mode: 0o600 });
  fs.renameSync(tmp, file);
}

/** Missing or broken file -> defaults (an existing valid peerId is kept); defaults are persisted. */
export function loadProfile(dir: string = defaultDir()): Profile {
  let raw: Record<string, unknown> = {};
  try {
    const j: unknown = JSON.parse(fs.readFileSync(path.join(dir, PROFILE_FILE_NAME), 'utf-8'));
    if (typeof j === 'object' && j !== null && !Array.isArray(j)) {
      raw = j as Record<string, unknown>;
    }
  } catch {
    // missing or unparsable: defaults
  }
  const peerId =
    typeof raw.peerId === 'string' && raw.peerId && raw.peerId.length <= MAX_PEER_ID
      ? raw.peerId
      : randomUUID();
  // nickname '' is a valid stored state (not yet chosen), so validate fields individually
  const valid = validateProfileUpdate({
    ...raw,
    nickname: typeof raw.nickname === 'string' && raw.nickname.trim() ? raw.nickname : 'x',
  });
  const profile: Profile =
    valid && (raw.nickname as string).trim()
      ? { peerId, ...valid }
      : {
          peerId,
          nickname: '',
          palette: 0,
          hueShift: 0,
          hideDetails: true,
          manualPeers: [],
        };
  if (raw.peerId !== peerId || valid === null) {
    try {
      saveProfile(profile, dir);
    } catch (err) {
      console.error('[Pixel Office] Failed to write profile:', err);
    }
  }
  return profile;
}

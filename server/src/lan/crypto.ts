import * as crypto from 'crypto';

import { MAX_PACKET_BYTES } from '../../../core/src/lan.js';
import {
  CROCKFORD_ALPHABET,
  GCM_NONCE_BYTES,
  GCM_TAG_BYTES,
  INVITE_GROUP_LEN,
  INVITE_PREFIX,
  INVITE_SECRET_BYTES,
  KEY_BYTES,
  PUB_KEY_SALT,
  TEAM_KEY_INFO,
  TEAM_KEY_SALT,
  TEAM_TAG_BYTES,
  TEAM_TAG_INFO,
  WIRE_MAX_ID,
  X25519_PUBLIC_KEY_BYTES,
  X25519_SPKI_PREFIX,
} from '../constants.js';

export interface Identity {
  id: string;
  /** base64 of the raw 32-byte X25519 public key. */
  publicKey: string;
  privateKeyPem: string;
}

export interface InviteCode {
  secret: Buffer;
  text: string;
}

export type Wire =
  | { v: 2; t: 'hello'; id: string; pk: string }
  | { v: 2; t: 'pub'; from: string; to: string; n: string; c: string }
  | { v: 2; t: 'team'; tag: string; n: string; c: string };

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const TAG = new RegExp(`^[A-Za-z0-9_-]{${Math.ceil((TEAM_TAG_BYTES * 4) / 3)}}$`);
const INVITE_CHARS = Math.ceil((INVITE_SECRET_BYTES * 8) / 5);

const hkdf = (ikm: Buffer, salt: string, info: string): Buffer =>
  Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, KEY_BYTES));

/** Decoded bytes of a strict standard-base64 string, else null. */
function b64(s: unknown): Buffer | null {
  return typeof s === 'string' && BASE64.test(s) ? Buffer.from(s, 'base64') : null;
}

export function createIdentity(id: string): Identity {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  const der = publicKey.export({ format: 'der', type: 'spki' });
  return {
    id,
    publicKey: der.subarray(der.length - X25519_PUBLIC_KEY_BYTES).toString('base64'),
    privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
  };
}

/** Shared public-office key for the pair {idA, idB}; null for a bad/low-order key. */
export function pairKey(
  myPrivatePem: string,
  theirPublicB64: string,
  idA: string,
  idB: string,
): Buffer | null {
  try {
    const raw = b64(theirPublicB64);
    if (!raw || raw.length !== X25519_PUBLIC_KEY_BYTES) return null;
    const secret = crypto.diffieHellman({
      privateKey: crypto.createPrivateKey(myPrivatePem),
      publicKey: crypto.createPublicKey({
        key: Buffer.concat([Buffer.from(X25519_SPKI_PREFIX, 'hex'), raw]),
        format: 'der',
        type: 'spki',
      }),
    });
    if (secret.every((b) => b === 0)) return null;
    return hkdf(secret, PUB_KEY_SALT, [idA, idB].sort().join('|'));
  } catch {
    return null;
  }
}

export function newInviteCode(): InviteCode {
  const secret = crypto.randomBytes(INVITE_SECRET_BYTES);
  let bits = '';
  for (const b of secret) bits += b.toString(2).padStart(8, '0');
  bits = bits.padEnd(INVITE_CHARS * 5, '0');
  let chars = '';
  for (let i = 0; i < bits.length; i += 5)
    chars += CROCKFORD_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  const groups = chars.match(new RegExp(`.{1,${INVITE_GROUP_LEN}}`, 'g')) ?? [];
  return { secret, text: [INVITE_PREFIX, ...groups].join('-') };
}

/** Tolerant: any case, spaces/dashes, optional PO2 prefix, O→0 and I/L→1. */
export function parseInviteCode(text: string): Buffer | null {
  if (typeof text !== 'string') return null;
  let s = text.toUpperCase().replace(/[\s-]/g, '');
  if (s.length === INVITE_CHARS + INVITE_PREFIX.length && /^P[O0]2/.test(s))
    s = s.slice(INVITE_PREFIX.length);
  s = s.replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== INVITE_CHARS) return null;
  let bits = '';
  for (const ch of s) {
    const v = CROCKFORD_ALPHABET.indexOf(ch);
    if (v < 0) return null;
    bits += v.toString(2).padStart(5, '0');
  }
  // Padding bits must be zero so each secret has exactly one code.
  if (/1/.test(bits.slice(INVITE_SECRET_BYTES * 8))) return null;
  const out = Buffer.alloc(INVITE_SECRET_BYTES);
  for (let i = 0; i < INVITE_SECRET_BYTES; i++) out[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  return out;
}

export function teamKey(secret: Buffer): Buffer {
  return hkdf(secret, TEAM_KEY_SALT, TEAM_KEY_INFO);
}

export function teamTag(key: Buffer): string {
  return crypto
    .createHmac('sha256', key)
    .update(TEAM_TAG_INFO)
    .digest()
    .subarray(0, TEAM_TAG_BYTES)
    .toString('base64url');
}

/** AES-256-GCM, random 12-byte nonce; c = ciphertext||tag, both base64. */
export function seal(key: Buffer, aad: string, plaintext: string): { n: string; c: string } {
  const nonce = crypto.randomBytes(GCM_NONCE_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(aad));
  const c = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return { n: nonce.toString('base64'), c: c.toString('base64') };
}

export function open(key: Buffer, aad: string, n: string, c: string): string | null {
  try {
    const nonce = b64(n);
    const data = b64(c);
    if (!nonce || nonce.length !== GCM_NONCE_BYTES || !data || data.length < GCM_TAG_BYTES)
      return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce, {
      authTagLength: GCM_TAG_BYTES,
    });
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(data.subarray(data.length - GCM_TAG_BYTES));
    return Buffer.concat([
      decipher.update(data.subarray(0, data.length - GCM_TAG_BYTES)),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}

const isId = (s: unknown): s is string =>
  typeof s === 'string' && s.length > 0 && s.length <= WIRE_MAX_ID;
const isNonce = (s: unknown): s is string => b64(s)?.length === GCM_NONCE_BYTES;
const isCipher = (s: unknown): s is string => (b64(s)?.length ?? 0) > GCM_TAG_BYTES;

/** Strict shape check of a v2 datagram; fresh object with known fields only, never throws. */
export function parseWire(text: string): Wire | null {
  if (typeof text !== 'string' || text.length > MAX_PACKET_BYTES) return null;
  let o: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    o = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  if (o.v !== 2) return null;
  switch (o.t) {
    case 'hello':
      return isId(o.id) && b64(o.pk)?.length === X25519_PUBLIC_KEY_BYTES
        ? { v: 2, t: 'hello', id: o.id, pk: o.pk as string }
        : null;
    case 'pub':
      return isId(o.from) && isId(o.to) && isNonce(o.n) && isCipher(o.c)
        ? { v: 2, t: 'pub', from: o.from, to: o.to, n: o.n, c: o.c }
        : null;
    case 'team':
      return typeof o.tag === 'string' && TAG.test(o.tag) && isNonce(o.n) && isCipher(o.c)
        ? { v: 2, t: 'team', tag: o.tag, n: o.n, c: o.c }
        : null;
    default:
      return null;
  }
}

import { describe, expect, it } from 'vitest';

import { MAX_PACKET_BYTES } from '../../../core/src/lan.js';
import {
  createIdentity,
  newInviteCode,
  open,
  pairKey,
  parseInviteCode,
  parseWire,
  seal,
  teamKey,
  teamTag,
} from '../../src/lan/crypto.js';

const key = Buffer.alloc(32, 7);
const b64 = (n: number, fill = 1): string => Buffer.alloc(n, fill).toString('base64');

describe('seal/open', () => {
  it('round-trips', () => {
    const { n, c } = seal(key, 'pub|a|b', '{"seq":1}');
    expect(Buffer.from(n, 'base64')).toHaveLength(12);
    expect(open(key, 'pub|a|b', n, c)).toBe('{"seq":1}');
  });
  it('uses a fresh nonce each time', () => {
    expect(seal(key, 'x', 'p').n).not.toBe(seal(key, 'x', 'p').n);
  });
  it('rejects a bit flip, wrong AAD and wrong key', () => {
    const { n, c } = seal(key, 'team|t', 'hello');
    const raw = Buffer.from(c, 'base64');
    raw[0] ^= 1;
    expect(open(key, 'team|t', n, raw.toString('base64'))).toBeNull();
    expect(open(key, 'team|u', n, c)).toBeNull();
    expect(open(Buffer.alloc(32, 8), 'team|t', n, c)).toBeNull();
  });
});

describe('pairKey', () => {
  it('is symmetric and pair-specific', () => {
    const a = createIdentity('A');
    const b = createIdentity('B');
    const c = createIdentity('C');
    expect(Buffer.from(a.publicKey, 'base64')).toHaveLength(32);
    const ab = pairKey(a.privateKeyPem, b.publicKey, 'A', 'B');
    const ba = pairKey(b.privateKeyPem, a.publicKey, 'B', 'A');
    expect(ab).toHaveLength(32);
    expect(ab?.equals(ba!)).toBe(true);
    expect(ab?.equals(pairKey(a.privateKeyPem, c.publicKey, 'A', 'C')!)).toBe(false);
  });
  it('rejects low-order and malformed public keys', () => {
    const a = createIdentity('A');
    expect(pairKey(a.privateKeyPem, b64(32, 0), 'A', 'B')).toBeNull();
    expect(pairKey(a.privateKeyPem, b64(16), 'A', 'B')).toBeNull();
    expect(pairKey('garbage', a.publicKey, 'A', 'B')).toBeNull();
  });
});

describe('invite code', () => {
  it('formats and parses back, tolerantly', () => {
    const code = newInviteCode();
    expect(code.secret).toHaveLength(13);
    expect(code.text).toMatch(
      /^PO2-[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){4}-[0-9A-HJKMNP-TV-Z]$/,
    );
    const bare = code.text.slice(4).replace(/-/g, '');
    for (const t of [
      code.text,
      code.text.toLowerCase(),
      bare,
      ` ${bare.slice(0, 7)} ${bare.slice(7)} `,
      bare.replace(/0/g, 'O').replace(/1/g, 'l'),
      'po2' + bare,
    ]) {
      expect(parseInviteCode(t)?.equals(code.secret)).toBe(true);
    }
  });
  it('codes differ', () => {
    expect(newInviteCode().text).not.toBe(newInviteCode().text);
  });
  it('rejects invalid input', () => {
    const bare = newInviteCode().text.slice(4).replace(/-/g, '');
    for (const t of [
      '',
      'PO2-',
      bare.slice(1),
      bare + '0',
      bare.slice(1) + 'U',
      bare.slice(0, 20) + 'Z',
    ]) {
      expect(parseInviteCode(t)).toBeNull();
    }
  });
});

describe('teamKey/teamTag', () => {
  it('is stable, 11 chars, secret-specific', () => {
    const s = newInviteCode().secret;
    const tag = teamTag(teamKey(s));
    expect(tag).toMatch(/^[A-Za-z0-9_-]{11}$/);
    expect(teamTag(teamKey(Buffer.from(s)))).toBe(tag);
    expect(teamTag(teamKey(newInviteCode().secret))).not.toBe(tag);
    expect(teamKey(s).equals(Buffer.from(s))).toBe(false);
  });
});

describe('parseWire', () => {
  const hello = { v: 2, t: 'hello', id: 'pc1', pk: b64(32) };
  const pub = { v: 2, t: 'pub', from: 'a', to: 'b', n: b64(12), c: b64(40) };
  const team = { v: 2, t: 'team', tag: 'AAAAAAAAAAA', n: b64(12), c: b64(40) };

  it('accepts valid variants and returns fresh objects without extras', () => {
    expect(parseWire(JSON.stringify({ ...hello, x: 1 }))).toEqual(hello);
    expect(parseWire(JSON.stringify(pub))).toEqual(pub);
    expect(parseWire(JSON.stringify(team))).toEqual(team);
  });
  it('rejects bad shapes', () => {
    for (const w of [
      { ...hello, v: 1 },
      { ...hello, t: 'nope' },
      { ...hello, pk: b64(31) },
      { ...hello, pk: '!!!notbase64!!!' },
      { ...hello, id: '' },
      { ...hello, id: 'x'.repeat(65) },
      { ...pub, n: b64(16) },
      { ...pub, c: 'a b' },
      { ...pub, to: 5 },
      { ...team, tag: 'short' },
      { ...team, c: '' },
      null,
      [],
      'str',
    ]) {
      expect(parseWire(JSON.stringify(w))).toBeNull();
    }
  });
  it('rejects oversize', () => {
    const big = { ...pub, c: 'A'.repeat(MAX_PACKET_BYTES) };
    expect(parseWire(JSON.stringify(big))).toBeNull();
  });
  it('never throws on garbage', () => {
    const junk: unknown[] = ['', '{', 'null', '1e999', undefined, null, 42, {}, '\u0000'];
    for (const j of junk) {
      expect(() => parseWire(j as string)).not.toThrow();
      expect(parseWire(j as string)).toBeNull();
      expect(() => parseInviteCode(j as string)).not.toThrow();
      expect(() => open(key, 'x', j as string, j as string)).not.toThrow();
      expect(open(key, 'x', j as string, j as string)).toBeNull();
    }
    expect(open(Buffer.alloc(3), 'x', b64(12), b64(40))).toBeNull();
  });
});

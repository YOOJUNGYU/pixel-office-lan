// Who is who: "account (nickname)" labels, and same-name tie-breaks. No central
// server, so every viewer computes the same answer from the same snapshot.
import type { OfficeAgent } from '../../../core/src/lan.js';
import { nicknameKey, SHORT_PEER_ID } from '../../../core/src/lan.js';
import type { OfficePersonMessage } from '../../../core/src/messages.js';

interface Named {
  peerId: string;
  account: string;
  nickname: string;
}

/** The label everywhere a PC is named: the fixed account, then the optional nickname. */
export const peerLabel = (p: { account: string; nickname: string }): string =>
  p.nickname ? `${p.account} (${p.nickname})` : p.account;

const suffix = (s: string, peerId: string): string => `${s} · ${peerId.slice(0, SHORT_PEER_ID)}`;

/** Per group key, every peerId but the lexicographically smallest. */
function losers(list: Named[], keyOf: (p: Named) => string): Set<string> {
  const owner = new Map<string, string>();
  for (const p of list) {
    const k = keyOf(p);
    const o = owner.get(k);
    if (k !== '' && (o === undefined || p.peerId < o)) owner.set(k, p.peerId);
  }
  return new Set(
    list.filter((p) => keyOf(p) !== '' && owner.get(keyOf(p)) !== p.peerId).map((p) => p.peerId),
  );
}

/**
 * peerId → {account, nickname} to show, for PCs that need telling apart:
 * 1. same nickname (nicknameKey; '' exempt): the smallest peerId keeps it, the
 *    others' nickname gets " · <peerId prefix>";
 * 2. labels still identical (same account, no nickname): the same suffix on the
 *    account of all but the smallest peerId. Accounts are otherwise shown as is.
 */
export function tieBreak(people: Named[]): Map<string, { account: string; nickname: string }> {
  const uniq = [...new Map(people.map((p) => [p.peerId, p] as const)).values()];
  const nick = losers(uniq, (p) => nicknameKey(p.nickname));
  const named = uniq.map((p) => ({
    ...p,
    nickname: nick.has(p.peerId) ? suffix(p.nickname, p.peerId) : p.nickname,
  }));
  const label = losers(named, (p) => peerLabel(p));
  const out = new Map<string, { account: string; nickname: string }>();
  for (const p of named) {
    if (!nick.has(p.peerId) && !label.has(p.peerId)) continue;
    out.set(p.peerId, {
      account: label.has(p.peerId) ? suffix(p.account, p.peerId) : p.account,
      nickname: p.nickname,
    });
  }
  return out;
}

/** A snapshot with tie-broken names, the other people's nickname keys (live
 *  check in the profile form) and whether this PC's nickname lost a tie-break. */
export function disambiguate(people: OfficePersonMessage[], agents: OfficeAgent[]) {
  const shown = tieBreak([
    ...people,
    ...agents.map((a) => ({
      peerId: a.peer.id,
      account: a.peer.account,
      nickname: a.peer.nickname,
    })),
  ]);
  const self = people.find((p) => p.self);
  return {
    people: people.map((p) => ({ ...p, ...shown.get(p.peerId) })),
    agents: agents.map((a) => {
      const n = shown.get(a.peer.id);
      return n === undefined ? a : { ...a, peer: { ...a.peer, ...n } };
    }),
    taken: new Set(
      people
        .filter((p) => !p.self)
        .map((p) => nicknameKey(p.nickname))
        .filter((k) => k !== ''),
    ) as ReadonlySet<string>,
    selfLost:
      self !== undefined &&
      self.nickname !== '' &&
      shown.get(self.peerId)?.nickname !== undefined &&
      shown.get(self.peerId)?.nickname !== self.nickname,
  };
}

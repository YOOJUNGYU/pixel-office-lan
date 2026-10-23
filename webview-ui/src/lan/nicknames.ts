// Who is who: "account (nickname)" labels, and same-name tie-breaks. No central
// server, so every viewer computes the same answer from the same snapshot.
import type { OfficeAgent } from '../../../core/src/lan.js';
import { nicknameKey, peerLabel, SHORT_PEER_ID } from '../../../core/src/lan.js';
import type { OfficePersonMessage } from '../../../core/src/messages.js';

interface Named {
  peerId: string;
  account: string;
  nickname: string;
  /** When the nickname was set (ms epoch); absent = unknown, loses a clash. */
  nickSince?: number;
}

export { peerLabel };

/** An avatar's name tag: the nickname alone when set (tie-broken), else the account. */
export const avatarLabel = (p: { account: string; nickname: string }): string =>
  p.nickname || p.account;

const suffix = (s: string, peerId: string): string => `${s} · ${peerId.slice(0, SHORT_PEER_ID)}`;

/** Who keeps a clashing nickname: set earliest (unknown = last), then the smaller peerId. */
const keepsNickname = (a: Named, b: Named): boolean => {
  const ta = a.nickSince ?? Infinity;
  const tb = b.nickSince ?? Infinity;
  return ta !== tb ? ta < tb : a.peerId < b.peerId;
};

/** Per non-empty group key, every peerId but the one `keeps` prefers. */
function losers(
  list: Named[],
  keyOf: (p: Named) => string,
  keeps: (a: Named, b: Named) => boolean,
): Set<string> {
  const owner = new Map<string, Named>();
  for (const p of list) {
    const k = keyOf(p);
    const o = owner.get(k);
    if (k !== '' && (o === undefined || keeps(p, o))) owner.set(k, p);
  }
  return new Set(
    list.filter((p) => keyOf(p) !== '' && owner.get(keyOf(p)) !== p).map((p) => p.peerId),
  );
}

/**
 * peerId → {account, nickname} to show, for PCs that need telling apart:
 * 1. same nickname (nicknameKey; '' exempt): whoever set it first (nickSince,
 *    then the smaller peerId) keeps it; the others' nickname gets
 *    " · <peerId prefix>";
 * 2. labels still identical (same account, no nickname): the same suffix on the
 *    account of all but the smallest peerId. Accounts are otherwise shown as is.
 */
export function tieBreak(people: Named[]): Map<string, { account: string; nickname: string }> {
  const uniq = [...new Map(people.map((p) => [p.peerId, p] as const)).values()];
  const nick = losers(uniq, (p) => nicknameKey(p.nickname), keepsNickname);
  const named = uniq.map((p) => ({
    ...p,
    nickname: nick.has(p.peerId) ? suffix(p.nickname, p.peerId) : p.nickname,
  }));
  const label = losers(
    named,
    (p) => peerLabel(p),
    (a, b) => a.peerId < b.peerId,
  );
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
 *  check in the profile form) and, when this PC's nickname lost a clash, its key. */
export function disambiguate(people: OfficePersonMessage[], agents: OfficeAgent[]) {
  const shown = tieBreak([
    ...people,
    ...agents.map((a) => ({
      peerId: a.peer.id,
      account: a.peer.account,
      nickname: a.peer.nickname,
      nickSince: a.peer.nickSince,
    })),
  ]);
  const self = people.find((p) => p.self);
  const selfShown = self && shown.get(self.peerId);
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
    /** nicknameKey of this PC's nickname when it lost a clash, else null. */
    selfLost:
      self && self.nickname !== '' && selfShown && selfShown.nickname !== self.nickname
        ? nicknameKey(self.nickname)
        : null,
  };
}

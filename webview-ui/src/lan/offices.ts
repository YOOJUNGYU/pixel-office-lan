// Pure helpers for the office switcher and Settings → 오피스.
import { PUBLIC_VIEW } from '../../../core/src/lan.js';
import type { OfficesState } from '../../../core/src/messages.js';

/** Typed/pasted invite code as sent and shown: upper-case, no spaces (the server tolerates the rest). */
export const normalizeCodeInput = (s: string): string => s.toUpperCase().replace(/\s+/g, '');

export interface SwitcherItem {
  view: string;
  /** '' for the public office and for a team whose name is not known yet. */
  name: string;
  isPublic: boolean;
  active: boolean;
  /** The public office while in any team: you are not visible there. */
  disabled: boolean;
}

/** Public first, then each joined team, in join order. */
export function switcherItems(state: Omit<OfficesState, 'type'>): SwitcherItem[] {
  const inTeam = state.offices.length > 0;
  return [
    {
      view: PUBLIC_VIEW,
      name: '',
      isPublic: true,
      active: state.activeView === PUBLIC_VIEW,
      disabled: inTeam,
    },
    ...state.offices.map((o) => ({
      view: o.tag,
      name: o.name,
      isPublic: false,
      active: state.activeView === o.tag,
      disabled: false,
    })),
  ];
}

import type { OfficeAgent } from '../../../core/src/lan.js';
import { LAN_KIND_BADGES, LAN_MAIN_BADGE_LIGHT } from '../constants.js';
import { getTheme } from '../theme.js';

/** MAIN / SUB / SHELL badge colors; MAIN has its own pair in the light theme. */
export const badgeColors = (kind: OfficeAgent['kind']) => {
  const k = LAN_KIND_BADGES[kind];
  const c = kind === 'main' && getTheme() === 'light' ? LAN_MAIN_BADGE_LIGHT : k;
  return { background: c.bg, color: c.fg };
};

/**
 * Theme transforms for the office canvas. Applied per pixel into new SpriteData
 * (cached per sprite and theme), so the zoom caches stay pixel-exact — never a
 * CSS/canvas filter. Dark is the identity: the original look, same objects.
 * Characters and pets never go through here.
 */
import { LIGHT_THEME_TRANSFORMS } from '../constants.js';
import type { Theme } from '../theme.js';
import { hslToHex, rgbToHsl } from './colorize.js';
import type { SpriteData } from './types.js';

export type ThemeKind = keyof typeof LIGHT_THEME_TRANSFORMS;

const HEX_RE = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;

/** One `#RRGGBB[AA]` color in `theme` (alpha kept; anything else unchanged). Pure. */
export function themeColor(color: string, kind: ThemeKind, theme: Theme): string {
  if (theme === 'dark' || !HEX_RE.test(color)) return color;
  const { lo, hi, lift, sat } = LIGHT_THEME_TRANSFORMS[kind];
  const [h, s, l] = rgbToHsl(
    parseInt(color.slice(1, 3), 16),
    parseInt(color.slice(3, 5), 16),
    parseInt(color.slice(5, 7), 16),
  );
  const light = lo + (hi - lo) * (1 - (1 - l) ** lift);
  return hslToHex(h, s * sat, light) + color.slice(7).toUpperCase();
}

/** A floor/background color in `theme` (lighter, less saturated in light). Pure. */
export function themeFloorColor(color: string, theme: Theme): string {
  return themeColor(color, 'floor', theme);
}

const colorMemo = new Map<string, string>();
const spriteMemo = new Map<ThemeKind, WeakMap<SpriteData, SpriteData>>();

/** `sprite` in `theme`: the same object in dark, a cached per-pixel copy in light. */
export function themeSprite(sprite: SpriteData, kind: ThemeKind, theme: Theme): SpriteData {
  if (theme === 'dark') return sprite;
  let memo = spriteMemo.get(kind);
  if (!memo) spriteMemo.set(kind, (memo = new WeakMap()));
  const hit = memo.get(sprite);
  if (hit) return hit;
  const out = sprite.map((row) =>
    row.map((px) => {
      if (px === '') return px;
      const key = kind + px;
      let c = colorMemo.get(key);
      if (c === undefined) colorMemo.set(key, (c = themeColor(px, kind, theme)));
      return c;
    }),
  );
  memo.set(sprite, out);
  return out;
}

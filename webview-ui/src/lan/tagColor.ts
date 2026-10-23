// A person's avatar name tag in their character's colour, with readable text on it.
import {
  AVATAR_TAG_MIN_SATURATION,
  AVATAR_TAG_TEXT_DARK,
  AVATAR_TAG_TEXT_LIGHT,
  CHARACTER_SKIN_COLORS,
} from '../constants.js';
import { rgbToHsl } from '../office/colorize.js';
import { getPetSprites } from '../office/sprites/petSpriteData.js';
import { getCharacterSprites } from '../office/sprites/spriteData.js';
import type { SpriteData } from '../office/types.js';
import { Direction } from '../office/types.js';

const rgbOf = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/**
 * The colour that stands for a sprite: its most common clearly coloured pixel
 * (skin and half-transparent pixels skipped), else its most common opaque one.
 */
export function dominantColor(sprite: SpriteData, skin: ReadonlySet<string>): string | null {
  const vivid = new Map<string, number>();
  const any = new Map<string, number>();
  for (const row of sprite)
    for (const px of row) {
      if (px.length < 7 || (px.length > 7 && parseInt(px.slice(7, 9), 16) < 128)) continue;
      const hex = px.slice(0, 7).toUpperCase();
      if (skin.has(hex)) continue;
      any.set(hex, (any.get(hex) ?? 0) + 1);
      const [, s] = rgbToHsl(...rgbOf(hex));
      if (s >= AVATAR_TAG_MIN_SATURATION) vivid.set(hex, (vivid.get(hex) ?? 0) + 1);
    }
  const top = (m: Map<string, number>) =>
    [...m].reduce<[string, number] | null>((a, e) => (!a || e[1] > a[1] ? e : a), null)?.[0] ??
    null;
  return top(vivid) ?? top(any);
}

/** WCAG relative luminance of `#RRGGBB`. */
function luminance(hex: string): number {
  const [r, g, b] = rgbOf(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** The text colour (dark or light) with the higher contrast on `bg`. */
export const textOn = (bg: string): string =>
  contrast(bg, AVATAR_TAG_TEXT_DARK) >= contrast(bg, AVATAR_TAG_TEXT_LIGHT)
    ? AVATAR_TAG_TEXT_DARK
    : AVATAR_TAG_TEXT_LIGHT;

export interface TagColors {
  bg: string;
  fg: string;
}

const cache = new Map<string, TagColors | null>();

/** Tag colours of a character look (front-facing frame); null until its sprites are loaded. */
export function avatarTagColors(look: {
  palette: number;
  hueShift: number;
  pet?: string;
}): TagColors | null {
  const key = `${look.pet ?? look.palette}:${look.hueShift}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const sprite = look.pet
    ? getPetSprites(look.pet, look.hueShift)?.walkDown[0]
    : getCharacterSprites(look.palette, look.hueShift).walk[Direction.DOWN][0];
  // Pets are tinted whole: no skin to skip.
  const bg = sprite ? dominantColor(sprite, look.pet ? new Set() : CHARACTER_SKIN_COLORS) : null;
  const colors = bg ? { bg, fg: textOn(bg) } : null;
  if (colors) cache.set(key, colors); // not before the sprites load (placeholders are empty)
  return colors;
}

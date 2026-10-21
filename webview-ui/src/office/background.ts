/**
 * Map background: what fills the canvas around the office and shows through
 * VOID tiles. `resolveBackground` turns the (possibly hand-edited) layout field
 * into a validated fill descriptor; the renderer only ever sees the descriptor.
 */

import type { ColorValue } from '../components/ui/types.js';
import {
  BACKGROUND_DEFAULT_CARPET_VARIANT,
  BACKGROUND_DEFAULT_COLOR,
  BACKGROUND_DEFAULT_FLOOR_COLOR,
  BACKGROUND_DEFAULT_FLOOR_PATTERN,
  CARPET_DEFAULT_ACCENT_COLOR,
  CARPET_DEFAULT_COLOR,
} from '../constants.js';
import { colorValueToHex, hexToColorValue } from './colorize.js';
import type { OfficeBackground } from './types.js';
import { BackgroundKind } from './types.js';

export type BackgroundFill =
  /** Nothing drawn: the page's own dark navy shows (layouts without a background). */
  | { kind: 'none' }
  | { kind: 'color'; css: string }
  | { kind: 'floor'; pattern: number; color: ColorValue }
  | { kind: 'carpet'; variant: number; color: ColorValue; accent: ColorValue };

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function isColorValue(v: unknown): v is ColorValue {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return ['h', 's', 'b', 'c'].every((k) => typeof c[k] === 'number' && Number.isFinite(c[k]));
}

/** ColorValue from a stored color (ColorValue or `#RRGGBB`), else `fallback`. */
function toColorValue(v: unknown, fallback: ColorValue): ColorValue {
  if (isColorValue(v)) return v;
  if (typeof v === 'string' && HEX_RE.test(v)) return hexToColorValue(v) ?? fallback;
  return fallback;
}

/** Integer in [min, max], else `fallback`. */
function toIndex(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : fallback;
}

/** How many floor patterns / carpet variants are loaded. An index past them (e.g. an
 *  imported layout from a PC with more assets) falls back to the default instead of
 *  drawing an error tile. 0 carpets = not loaded yet: the index is kept. */
export interface BackgroundLimits {
  floorPatterns: number;
  carpetVariants: number;
}

export function resolveBackground(
  bg: OfficeBackground | undefined | null,
  limits?: BackgroundLimits,
): BackgroundFill {
  const maxFloor = limits?.floorPatterns ?? Number.MAX_SAFE_INTEGER;
  const maxCarpet = limits?.carpetVariants ? limits.carpetVariants - 1 : Number.MAX_SAFE_INTEGER;
  if (!bg || typeof bg !== 'object') return { kind: 'none' };
  switch (bg.kind) {
    case BackgroundKind.COLOR:
      return {
        kind: 'color',
        css:
          typeof bg.color === 'string' && HEX_RE.test(bg.color)
            ? bg.color
            : colorValueToHex(toColorValue(bg.color, BACKGROUND_DEFAULT_COLOR)),
      };
    case BackgroundKind.FLOOR:
      return {
        kind: 'floor',
        pattern: toIndex(bg.pattern, 1, maxFloor, BACKGROUND_DEFAULT_FLOOR_PATTERN),
        color: toColorValue(bg.color, BACKGROUND_DEFAULT_FLOOR_COLOR),
      };
    case BackgroundKind.CARPET:
      return {
        kind: 'carpet',
        variant: toIndex(bg.pattern, 0, maxCarpet, BACKGROUND_DEFAULT_CARPET_VARIANT),
        color: toColorValue(bg.color, CARPET_DEFAULT_COLOR),
        accent: toColorValue(bg.accent, CARPET_DEFAULT_ACCENT_COLOR),
      };
    default:
      return { kind: 'none' };
  }
}

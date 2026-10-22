import { PET_TINT_BRIGHTNESS, PET_TINT_SATURATION } from '../../constants.js';
import { colorizeSprite } from '../colorize.js';
import type { SpriteData } from '../types.js';

type Triple = [SpriteData, SpriteData, SpriteData];

/**
 * Resolved per-pet sprite frames (3-frame animations). Down/up frames are
 * 16×32, side frames 32×32; `walkLeft` is the flipped `walkRight`.
 */
export interface PetSpriteFrames {
  walkDown: Triple;
  idleDown: Triple;
  walkUp: Triple;
  idleUp: Triple;
  walkRight: Triple;
  walkLeft: Triple;
}

/** Flip a sprite horizontally (used for walkRight → walkLeft). */
function flipHorizontal(s: SpriteData): SpriteData {
  return s.map((row) => [...row].reverse());
}

/** Coerce a 3-frame raw array to a fixed-length tuple. Caller must verify len ≥ 3 first. */
function toTriple(arr: string[][][]): Triple {
  return [arr[0], arr[1], arr[2]];
}

/** Bundled pet id (manifest id) → frames. */
const loadedPets = new Map<string, PetSpriteFrames>();
/** `${id}:${hueShift}` → hue-shifted frames. */
const shiftedCache = new Map<string, PetSpriteFrames>();

/**
 * Receive raw frame arrays + parallel manifest ids from the server message.
 * Skips entries with fewer than 3 frames in any of the required directions.
 */
export function setPetTemplates(
  data: Array<{
    walkDown: string[][][];
    idleDown: string[][][];
    walkUp: string[][][];
    idleUp: string[][][];
    walkRight: string[][][];
  }>,
  petIds: string[],
): void {
  loadedPets.clear();
  shiftedCache.clear();
  for (let i = 0; i < data.length; i++) {
    const raw = data[i];
    const id = petIds[i];
    const ok =
      raw &&
      typeof id === 'string' &&
      [raw.walkDown, raw.idleDown, raw.walkUp, raw.idleUp, raw.walkRight].every(
        (a) => Array.isArray(a) && a.length >= 3,
      );
    if (!ok) continue;
    const walkRight = toTriple(raw.walkRight);
    loadedPets.set(id, {
      walkDown: toTriple(raw.walkDown),
      idleDown: toTriple(raw.idleDown),
      walkUp: toTriple(raw.walkUp),
      idleUp: toTriple(raw.idleUp),
      walkRight,
      walkLeft: [
        flipHorizontal(walkRight[0]),
        flipHorizontal(walkRight[1]),
        flipHorizontal(walkRight[2]),
      ],
    });
  }
}

/** One pet frame in a profile color: 0 = the pet as drawn, else a colorize tint
 *  of that hue (see PET_TINT_SATURATION). */
export function tintPetSprite(sprite: SpriteData, pet: string, hueShift: number): SpriteData {
  if (hueShift % 360 === 0) return sprite;
  return colorizeSprite(sprite, {
    h: hueShift % 360,
    s: PET_TINT_SATURATION,
    b: PET_TINT_BRIGHTNESS[pet] ?? 0,
    c: 0,
  });
}

/**
 * Frames of a bundled pet in a profile color (tintPetSprite). Null when that pet is not loaded (unknown id
 * or sprites not here yet) — callers fall back to the palette human.
 */
export function getPetSprites(id: string, hueShift = 0): PetSpriteFrames | null {
  const base = loadedPets.get(id);
  if (!base || hueShift % 360 === 0) return base ?? null;
  const key = `${id}:${hueShift}`;
  const hit = shiftedCache.get(key);
  if (hit) return hit;
  const t = (f: Triple): Triple => [
    tintPetSprite(f[0], id, hueShift),
    tintPetSprite(f[1], id, hueShift),
    tintPetSprite(f[2], id, hueShift),
  ];
  const shifted: PetSpriteFrames = {
    walkDown: t(base.walkDown),
    idleDown: t(base.idleDown),
    walkUp: t(base.walkUp),
    idleUp: t(base.idleUp),
    walkRight: t(base.walkRight),
    walkLeft: t(base.walkLeft),
  };
  shiftedCache.set(key, shifted);
  return shifted;
}

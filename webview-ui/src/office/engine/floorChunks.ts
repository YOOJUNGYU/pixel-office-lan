// Which floor-cache chunks a layout edit touches (pure; the renderer drops just those).
import type { ColorValue } from '../../components/ui/types.js';
import type { CarpetTile, TileType as TileTypeVal } from '../types.js';

export interface FloorData {
  tileMap: TileTypeVal[][];
  tileColors: Array<ColorValue | null> | undefined;
  carpetTiles: Array<CarpetTile | null> | undefined;
}

const sameColor = (a: ColorValue | null | undefined, b: ColorValue | null | undefined): boolean =>
  a === b ||
  (!!a &&
    !!b &&
    a.h === b.h &&
    a.s === b.s &&
    a.b === b.b &&
    a.c === b.c &&
    a.colorize === b.colorize);

const sameCarpet = (a: CarpetTile | null | undefined, b: CarpetTile | null | undefined): boolean =>
  a === b ||
  (!!a &&
    !!b &&
    a.variant === b.variant &&
    a.order === b.order &&
    sameColor(a.color, b.color) &&
    sameColor(a.accentColor, b.accentColor));

/** Chunk ids ("i,j", `n` tiles a side) touched by tiles that differ between two floors. */
export function changedFloorChunks(
  a: FloorData,
  b: FloorData,
  cols: number,
  rows: number,
  n: number,
): Set<string> {
  const dirty = new Set<string>();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (
        a.tileMap[r]?.[c] === b.tileMap[r]?.[c] &&
        sameColor(a.tileColors?.[i], b.tileColors?.[i]) &&
        sameCarpet(a.carpetTiles?.[i], b.carpetTiles?.[i])
      ) {
        continue;
      }
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const cc = c + dc;
          const rr = r + dr;
          if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
          dirty.add(`${Math.floor(cc / n)},${Math.floor(rr / n)}`);
        }
      }
    }
  }
  return dirty;
}

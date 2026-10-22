import type { ColorValue } from '../../components/ui/types.js';
import {
  AREA_LABEL_ALPHA,
  AREA_LABEL_FALLBACK_COLOR,
  AREA_LABEL_FONT_SIZE_PX,
  AREA_LABEL_MIN_FONT_SIZE_PX,
  AREA_LABEL_SHADOW_ALPHA,
  AREA_LABEL_SHADOW_COLOR,
  AREA_OVERLAY_ALPHA,
  BACKGROUND_CARPET_PATCH_TILES,
  BUTTON_ICON_COLOR,
  BUTTON_ICON_SIZE_FACTOR,
  BUTTON_LINE_WIDTH_MIN,
  BUTTON_LINE_WIDTH_ZOOM_FACTOR,
  BUTTON_MIN_RADIUS,
  BUTTON_RADIUS_ZOOM_FACTOR,
  CARPET_DEFAULT_ACCENT_COLOR,
  CARPET_DEFAULT_COLOR,
  CHARACTER_SITTING_OFFSET_PX,
  CHARACTER_Z_SORT_OFFSET,
  DELETE_BUTTON_BG,
  FALLBACK_FLOOR_COLOR,
  FLOOR_CACHE_MAX_PIXELS,
  FLOOR_CHUNK_MIN_TILES,
  FLOOR_CHUNK_PX,
  GHOST_INVALID_TINT,
  GHOST_PREVIEW_SPRITE_ALPHA,
  GHOST_PREVIEW_TINT_ALPHA,
  GHOST_VALID_TINT,
  GRID_LINE_COLORS,
  HEADLESS_CHARACTER_ALPHA,
  HOVERED_OUTLINE_ALPHA,
  LAN_ROOM_LABEL_COLORS,
  LAN_ROOM_LABEL_FONT_PX,
  LAN_ROOM_LABEL_MIN_FONT_PX,
  LAN_ROOM_LABEL_OUTLINE_PX,
  LAN_ROOM_LABEL_PAD_PX,
  OUTLINE_Z_SORT_OFFSET,
  ROTATE_BUTTON_BG,
  SEAT_AVAILABLE_COLOR,
  SEAT_BUSY_COLOR,
  SEAT_OWN_COLOR,
  SELECTED_OUTLINE_ALPHA,
  SELECTION_DASH_PATTERN,
  SELECTION_HIGHLIGHT_COLOR,
  VOID_TILE_DASH_PATTERN,
  VOID_TILE_OUTLINE_COLORS,
} from '../../constants.js';
import { areaName } from '../../i18n.js';
import type { RoomCount } from '../../lan/lanAgents.js';
import { plateText } from '../../lan/lanAgents.js';
import { getTheme } from '../../theme.js';
import type { BackgroundFill } from '../background.js';
import { resolveBackground } from '../background.js';
import {
  getColorizedFloorSprite,
  getFloorPatternCount,
  hasFloorSprites,
  WALL_COLOR,
} from '../floorTiles.js';
import { mapOffset } from '../projection.js';
import {
  getCarpetJunctionSprite,
  getCarpetPaletteKey,
  getCarpetPatchSprite,
  getCarpetSetCount,
  hasCarpetSprites,
} from '../sprites/carpetTiles.js';
import { getPetSprites } from '../sprites/petSpriteData.js';
import { getCachedSprite, getOutlineSprite } from '../sprites/spriteCache.js';
import { getCharacterSprites } from '../sprites/spriteData.js';
import { themeColor, themeFloorColor, themeSprite } from '../themeColors.js';
import type {
  AreaDefinition,
  CarpetTile,
  Character,
  FurnitureInstance,
  OfficeBackground,
  Seat,
  SpriteData,
  TileType as TileTypeVal,
} from '../types.js';
import { CharacterState, TILE_SIZE, TileType } from '../types.js';
import { getWallInstances, hasWallSprites, wallColorToHex } from '../wallTiles.js';
import { getCharacterSprite, getPetCharacterSprite } from './characters.js';
import type { FloorData } from './floorChunks.js';
import { changedFloorChunks } from './floorChunks.js';
import { renderMatrixEffect } from './matrixEffect.js';

// ── Settings ────────────────────────────────────────────────────

/**
 * "Display headless as ghosts" — whether headless agents render translucent.
 * Module state rather than a render param: the rAF loop reads it every frame,
 * so a toggle takes effect on the next one without threading a 21st argument
 * through renderFrame. Same shape as setProviderCapabilities / setSoundEnabled.
 * Mirrors the server default (off) — the cue is opt-in, so an office looks the
 * same as it did before the setting existed until someone turns it on.
 */
let ghostHeadlessAgents = false;

export function setGhostHeadlessAgents(enabled: boolean): void {
  ghostHeadlessAgents = enabled;
}

export function isGhostHeadlessAgentsEnabled(): boolean {
  return ghostHeadlessAgents;
}

// ── Render functions ────────────────────────────────────────────

/**
 * Render the carpet layer. Called AFTER renderTileGrid and BEFORE seat
 * indicators / characters / furniture.
 *
 * Per junction (cols+1 × rows+1 grid of corners), we gather every
 * (variant, palette) pair from the up-to-4 adjacent tiles. Each pair becomes
 * one local "layer" drawn in ascending `order`, so the highest-order carpet
 * visually wins at overlaps. Sprite anchor: each 16×16 junction sprite is
 * centered on the corner — drawn at (offsetX + jx*s - halfS, offsetY + jy*s - halfS).
 *
 * @internal
 */
export function renderCarpetLayer(
  ctx: CanvasRenderingContext2D,
  carpetTiles: Array<CarpetTile | null>,
  cols: number,
  rows: number,
  offsetX: number,
  offsetY: number,
  zoom: number,
  /** Junction range (inclusive), default the whole grid. */
  range: { c0: number; r0: number; c1: number; r1: number } = { c0: 0, r0: 0, c1: cols, r1: rows },
): void {
  if (!hasCarpetSprites()) return;
  if (!carpetTiles || carpetTiles.length === 0) return;

  const s = TILE_SIZE * zoom;
  const halfS = s / 2;

  for (let jy = range.r0; jy <= range.r1; jy++) {
    for (let jx = range.c0; jx <= range.c1; jx++) {
      const localGroups = new Map<
        string,
        {
          variant: number;
          color: ColorValue;
          accentColor: ColorValue;
          paletteKey: string;
          order: number;
        }
      >();

      const adjacent = [
        { col: jx - 1, row: jy - 1 }, // NW
        { col: jx, row: jy - 1 }, // NE
        { col: jx, row: jy }, // SE
        { col: jx - 1, row: jy }, // SW
      ];

      for (const pos of adjacent) {
        if (pos.col < 0 || pos.row < 0 || pos.col >= cols || pos.row >= rows) continue;
        const tile = carpetTiles[pos.row * cols + pos.col];
        if (!tile) continue;
        const color = tile.color ?? CARPET_DEFAULT_COLOR;
        const accentColor = tile.accentColor ?? CARPET_DEFAULT_ACCENT_COLOR;
        const paletteKey = getCarpetPaletteKey(color, accentColor);
        const key = `${tile.variant}:${paletteKey}`;
        const order = tile.order ?? 0;
        const existing = localGroups.get(key);
        if (!existing || order > existing.order) {
          localGroups.set(key, { variant: tile.variant, color, accentColor, paletteKey, order });
        }
      }

      if (localGroups.size === 0) continue;

      // Ascending order → drawn lowest first; highest-order layer ends on top.
      const ordered = [...localGroups.values()].sort((a, b) => a.order - b.order);
      for (const { variant, color, accentColor, paletteKey } of ordered) {
        const sprite = getCarpetJunctionSprite(
          jx,
          jy,
          variant,
          carpetTiles,
          cols,
          rows,
          color,
          accentColor,
          paletteKey,
        );
        if (!sprite) continue;
        const cached = getCachedSprite(themeSprite(sprite, 'floor', getTheme()), zoom);
        ctx.drawImage(cached, offsetX + jx * s - halfS, offsetY + jy * s - halfS);
      }
    }
  }
}

/**
 * Translucent per-tile color wash for Areas. Runs ABOVE carpets/floor and
 * BELOW seat indicators / characters / furniture (Settings → Show Areas).
 *
 * @internal
 */
export function renderAreaOverlay(
  ctx: CanvasRenderingContext2D,
  areaTiles: Array<string | null> | undefined,
  areas: AreaDefinition[] | undefined,
  cols: number,
  rows: number,
  offsetX: number,
  offsetY: number,
  zoom: number,
): void {
  if (!areaTiles || areaTiles.length === 0) return;
  if (!areas || areas.length === 0) return;

  const s = TILE_SIZE * zoom;
  const colorMap = new Map<string, string>();
  for (const a of areas) colorMap.set(a.label, a.color);

  ctx.save();
  ctx.globalAlpha = AREA_OVERLAY_ALPHA;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const label = areaTiles[r * cols + c];
      if (!label) continue;
      const color = colorMap.get(label);
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(offsetX + c * s, offsetY + r * s, s, s);
    }
  }
  ctx.restore();
}

/**
 * Render the centroid label for each Area, ABOVE characters/bubbles. Centroid
 * = arithmetic mean of all tile centers belonging to a given label. Pixel-art
 * drop shadow (no blur) for legibility on light backgrounds.
 *
 * @internal
 */
export function renderAreaLabels(
  ctx: CanvasRenderingContext2D,
  areaTiles: Array<string | null> | undefined,
  areas: AreaDefinition[] | undefined,
  cols: number,
  rows: number,
  offsetX: number,
  offsetY: number,
  zoom: number,
): void {
  if (!areaTiles || areaTiles.length === 0) return;
  if (!areas || areas.length === 0) return;

  const s = TILE_SIZE * zoom;
  const colorMap = new Map<string, string>();
  for (const a of areas) colorMap.set(a.label, a.color);

  // Centroid accumulator: label → { sumX, sumY, count }.
  const centroids = new Map<string, { sumX: number; sumY: number; count: number }>();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const label = areaTiles[r * cols + c];
      if (!label) continue;
      const acc = centroids.get(label);
      if (acc) {
        acc.sumX += c;
        acc.sumY += r;
        acc.count += 1;
      } else {
        centroids.set(label, { sumX: c, sumY: r, count: 1 });
      }
    }
  }

  if (centroids.size === 0) return;

  const fontSize = Math.max(AREA_LABEL_FONT_SIZE_PX * zoom, AREA_LABEL_MIN_FONT_SIZE_PX);

  ctx.save();
  ctx.font = `bold ${fontSize}px Pretendard`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const [label, acc] of centroids) {
    const cx = offsetX + (acc.sumX / acc.count + 0.5) * s;
    const cy = offsetY + (acc.sumY / acc.count + 0.5) * s;
    const name = areaName(label);

    // Pixel-art drop shadow (1px right + down, no blur).
    ctx.globalAlpha = AREA_LABEL_SHADOW_ALPHA;
    ctx.fillStyle = AREA_LABEL_SHADOW_COLOR;
    ctx.fillText(name, cx + 1, cy + 1);

    // Main label — area's own color, falling back to white if missing.
    ctx.globalAlpha = AREA_LABEL_ALPHA;
    ctx.fillStyle = colorMap.get(label) ?? AREA_LABEL_FALLBACK_COLOR;
    ctx.fillText(name, cx, cy);
  }
  ctx.restore();
}

let roomTopsMemo: {
  areaTiles: Array<string | null>;
  cols: number;
  tops: Map<string, { row: number; minCol: number }>;
} | null = null;

/** label → top row and the leftmost column on that row; scanned once per areaTiles array. */
function roomTops(
  areaTiles: Array<string | null>,
  cols: number,
  rows: number,
): Map<string, { row: number; minCol: number }> {
  if (roomTopsMemo?.areaTiles === areaTiles && roomTopsMemo.cols === cols) return roomTopsMemo.tops;
  const tops = new Map<string, { row: number; minCol: number }>();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const label = areaTiles[r * cols + c];
      if (!label) continue;
      if (!tops.has(label)) tops.set(label, { row: r, minCol: c });
    }
  }
  roomTopsMemo = { areaTiles, cols, tops };
  return tops;
}

/**
 * Room name plates for everyday viewing: light text with a dark outline in
 * each area's top-left corner (its top row's leftmost tile), with the number
 * of agents shown there (`counts`, see plateText).
 *
 * @internal
 */
export function renderRoomNames(
  ctx: CanvasRenderingContext2D,
  areaTiles: Array<string | null> | undefined,
  cols: number,
  rows: number,
  offsetX: number,
  offsetY: number,
  zoom: number,
  /** Blit scale of this frame (fractional zoom): the minimum font is in screen px. */
  scale = 1,
  counts?: Map<string, RoomCount> | null,
): void {
  if (!areaTiles || areaTiles.length === 0) return;
  const tops = roomTops(areaTiles, cols, rows);
  if (tops.size === 0) return;

  const s = TILE_SIZE * zoom;
  const fontSize = Math.max(LAN_ROOM_LABEL_FONT_PX * zoom, LAN_ROOM_LABEL_MIN_FONT_PX / scale);
  ctx.save();
  ctx.font = `bold ${fontSize}px Pretendard`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(LAN_ROOM_LABEL_OUTLINE_PX, LAN_ROOM_LABEL_OUTLINE_PX / scale);
  const colors = LAN_ROOM_LABEL_COLORS[getTheme()];
  ctx.strokeStyle = colors.outline;
  ctx.fillStyle = colors.fill;
  const pad = LAN_ROOM_LABEL_PAD_PX * zoom + ctx.lineWidth / 2;
  for (const [label, t] of tops) {
    const x = offsetX + t.minCol * s + pad;
    const y = offsetY + t.row * s + pad;
    const text = plateText(label, counts?.get(label));
    ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
  }
  ctx.restore();
}

/**
 * Fill the whole canvas with the map background, grid-aligned so it pans and
 * zooms with the office. Drawn first; VOID tiles leave it visible. A floor or
 * carpet background repeats one tile via a canvas pattern (one fillRect, not a
 * drawImage per tile). Carpet uses the fully-surrounded junction (case 15), so
 * an endless carpet shows its interior weave.
 *
 * @internal
 */
export function renderBackground(
  ctx: CanvasRenderingContext2D,
  fill: BackgroundFill,
  canvasWidth: number,
  canvasHeight: number,
  offsetX: number,
  offsetY: number,
  zoom: number,
  /** Draw the zoom-`zoom` tile pattern shrunk by this (fractional zoom below 1, on screen). */
  patternScale = 1,
): void {
  if (fill.kind === 'none') return;
  if (fill.kind === 'color') {
    ctx.fillStyle = themeFloorColor(fill.css, getTheme());
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    return;
  }
  const sprite =
    fill.kind === 'floor'
      ? getColorizedFloorSprite(fill.pattern, fill.color)
      : getCarpetPatchSprite(fill.variant, fill.color, fill.accent, BACKGROUND_CARPET_PATCH_TILES);
  if (!sprite) return;
  const pattern = ctx.createPattern(
    getCachedSprite(themeSprite(sprite, 'floor', getTheme()), zoom),
    'repeat',
  );
  if (!pattern) return;
  if (patternScale !== 1)
    pattern.setTransform(new DOMMatrix([patternScale, 0, 0, patternScale, 0, 0]));
  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.fillStyle = pattern;
  ctx.fillRect(-offsetX, -offsetY, canvasWidth, canvasHeight);
  ctx.restore();
}

/** @internal */
export function renderTileGrid(
  ctx: CanvasRenderingContext2D,
  tileMap: TileTypeVal[][],
  offsetX: number,
  offsetY: number,
  zoom: number,
  tileColors?: Array<ColorValue | null>,
  cols?: number,
  /** Tile range (end-exclusive), default the whole grid. */
  range?: { c0: number; r0: number; c1: number; r1: number },
): void {
  const s = TILE_SIZE * zoom;
  const useSpriteFloors = hasFloorSprites();
  const tmRows = tileMap.length;
  const tmCols = tmRows > 0 ? tileMap[0].length : 0;
  const layoutCols = cols ?? tmCols;
  const { c0 = 0, r0 = 0, c1 = tmCols, r1 = tmRows } = range ?? {};
  const theme = getTheme();

  // Floor tiles + wall base color
  for (let r = r0; r < Math.min(r1, tmRows); r++) {
    for (let c = c0; c < Math.min(c1, tmCols); c++) {
      const tile = tileMap[r][c];

      // Skip VOID tiles entirely (transparent)
      if (tile === TileType.VOID) continue;

      if (tile === TileType.WALL || !useSpriteFloors) {
        // Wall tiles or fallback: solid color
        if (tile === TileType.WALL) {
          const colorIdx = r * layoutCols + c;
          const wallColor = tileColors?.[colorIdx];
          ctx.fillStyle = themeColor(
            wallColor ? wallColorToHex(wallColor) : WALL_COLOR,
            'wall',
            theme,
          );
        } else {
          ctx.fillStyle = themeFloorColor(FALLBACK_FLOOR_COLOR, theme);
        }
        ctx.fillRect(offsetX + c * s, offsetY + r * s, s, s);
        continue;
      }

      // Floor tile: get colorized sprite
      const colorIdx = r * layoutCols + c;
      const color = tileColors?.[colorIdx] ?? { h: 0, s: 0, b: 0, c: 0 };
      const sprite = themeSprite(getColorizedFloorSprite(tile, color), 'floor', theme);
      const cached = getCachedSprite(sprite, zoom);
      ctx.drawImage(cached, offsetX + c * s, offsetY + r * s);
    }
  }
}

/** Floor chunk canvases by "i,j" (Map order = least recently used first). */
const floorChunks = new Map<string, HTMLCanvasElement>();
let floorChunksKey: unknown[] | null = null;
let floorChunkPixels = 0;

/**
 * Floor tiles, wall base colors and carpets: static between layout edits, so
 * they are drawn into square chunk canvases (about FLOOR_CHUNK_PX device px a
 * side, whatever the zoom) once and blitted every frame. Only chunks on screen
 * are built and drawn; least recently used ones are dropped beyond
 * FLOOR_CACHE_MAX_PIXELS (chunks on screen are never dropped, so the cache
 * never exceeds the cap plus one screenful). Edge chunks are padded by half a
 * tile: carpet junction sprites straddle the grid edge.
 */
function renderFloorLayer(
  ctx: CanvasRenderingContext2D,
  tileMap: TileTypeVal[][],
  tileColors: Array<ColorValue | null> | undefined,
  carpetTiles: Array<CarpetTile | null> | undefined,
  cols: number,
  rows: number,
  offsetX: number,
  offsetY: number,
  zoom: number,
): void {
  const s = TILE_SIZE * zoom;
  const pad = s / 2;
  const hasCarpets = !!carpetTiles && carpetTiles.length > 0;
  const draw = (
    c: CanvasRenderingContext2D,
    ox: number,
    oy: number,
    tr?: { c0: number; r0: number; c1: number; r1: number },
  ) => {
    renderTileGrid(c, tileMap, ox, oy, zoom, tileColors, cols, tr);
    if (hasCarpets) renderCarpetLayer(c, carpetTiles, cols, rows, ox, oy, zoom, tr);
  };
  if (typeof document === 'undefined') {
    draw(ctx, offsetX, offsetY);
    return;
  }
  const n = Math.max(FLOOR_CHUNK_MIN_TILES, Math.round(FLOOR_CHUNK_PX / s)); // tiles per side
  const key = [
    cols,
    rows,
    zoom,
    hasFloorSprites(),
    getFloorPatternCount(),
    getCarpetSetCount(),
    hasWallSprites(),
    getTheme(),
  ];
  if (!floorChunksKey || floorChunksKey.some((k, i) => k !== key[i])) {
    dropFloorChunks(() => true);
    floorChunksKey = key;
  } else if (
    floorData &&
    (floorData.tileMap !== tileMap ||
      floorData.tileColors !== tileColors ||
      floorData.carpetTiles !== carpetTiles)
  ) {
    // A layout edit: rebuild only the chunks whose tiles changed (a carpet
    // tile's junction sprites reach one tile around it), not the whole floor.
    const dirty = changedFloorChunks(
      floorData,
      { tileMap, tileColors, carpetTiles },
      cols,
      rows,
      n,
    );
    dropFloorChunks((id) => dirty.has(id));
  }
  floorData = { tileMap, tileColors, carpetTiles };
  const span = n * s;
  const iMax = Math.min(
    Math.ceil(cols / n) - 1,
    Math.floor((ctx.canvas.width - offsetX + pad) / span),
  );
  const jMax = Math.min(
    Math.ceil(rows / n) - 1,
    Math.floor((ctx.canvas.height - offsetY + pad) / span),
  );
  const used = new Set<string>();
  for (let j = Math.max(0, Math.floor((-offsetY - pad) / span)); j <= jMax; j++) {
    for (let i = Math.max(0, Math.floor((-offsetX - pad) / span)); i <= iMax; i++) {
      const id = `${i},${j}`;
      used.add(id);
      const c0 = i * n;
      const r0 = j * n;
      const c1 = Math.min(cols, c0 + n);
      const r1 = Math.min(rows, r0 + n);
      const padL = i === 0 ? pad : 0;
      const padT = j === 0 ? pad : 0;
      let canvas = floorChunks.get(id);
      if (canvas) {
        floorChunks.delete(id); // re-insert below: most recently used
      } else {
        canvas = document.createElement('canvas');
        canvas.width = (c1 - c0) * s + padL + (c1 === cols ? pad : 0);
        canvas.height = (r1 - r0) * s + padT + (r1 === rows ? pad : 0);
        const c = canvas.getContext('2d')!;
        c.imageSmoothingEnabled = false;
        draw(c, padL - c0 * s, padT - r0 * s, { c0, r0, c1, r1 });
        floorChunkPixels += canvas.width * canvas.height;
      }
      floorChunks.set(id, canvas);
      ctx.drawImage(canvas, offsetX + c0 * s - padL, offsetY + r0 * s - padT);
    }
  }
  for (const [id, canvas] of floorChunks) {
    if (floorChunkPixels <= FLOOR_CACHE_MAX_PIXELS) break;
    if (used.has(id)) continue;
    floorChunks.delete(id);
    floorChunkPixels -= canvas.width * canvas.height;
  }
}

let floorData: FloorData | null = null;

function dropFloorChunks(which: (id: string) => boolean): void {
  for (const [id, canvas] of floorChunks) {
    if (!which(id)) continue;
    floorChunks.delete(id);
    floorChunkPixels -= canvas.width * canvas.height;
  }
}

/** Test/benchmark hook: cached floor chunks and their device pixels. */
export function floorCacheStats(): { chunks: number; pixels: number } {
  return { chunks: floorChunks.size, pixels: floorChunkPixels };
}

let wallMemo: { key: unknown[]; walls: FurnitureInstance[] } | null = null;

/** Wall sprites change only with the layout (and loaded wall sprites): built once, not per frame. */
function wallInstancesFor(
  tileMap: TileTypeVal[][],
  tileColors: Array<ColorValue | null> | undefined,
  cols: number | undefined,
): FurnitureInstance[] {
  const theme = getTheme();
  const key = [tileMap, tileColors, cols, hasWallSprites(), theme];
  if (!wallMemo || wallMemo.key.some((k, i) => k !== key[i])) {
    const walls = hasWallSprites() ? getWallInstances(tileMap, tileColors, cols) : [];
    wallMemo = {
      key,
      walls: walls.map((w) => ({ ...w, sprite: themeSprite(w.sprite, 'wall', theme) })),
    };
  }
  return wallMemo.walls;
}

interface ZDrawable {
  zY: number;
  draw: (ctx: CanvasRenderingContext2D) => void;
}

/** @internal */
export function renderScene(
  ctx: CanvasRenderingContext2D,
  furniture: FurnitureInstance[],
  characters: Character[],
  offsetX: number,
  offsetY: number,
  zoom: number,
  selectedAgentId: number | null,
  hoveredAgentId: number | null,
  /** The first `wallCount` items are walls, already themed; the rest get the furniture theme. */
  wallCount = 0,
): void {
  const drawables: ZDrawable[] = [];
  const theme = getTheme();
  const viewW = ctx.canvas.width;
  const viewH = ctx.canvas.height;

  // Furniture (off-screen pieces skipped: a big office is mostly off screen when zoomed in)
  for (let i = 0; i < furniture.length; i++) {
    const f = furniture[i];
    const fx = offsetX + f.x * zoom;
    const fy = offsetY + f.y * zoom;
    const spriteH = f.sprite.length;
    const spriteW = spriteH > 0 ? f.sprite[0].length : 0;
    if (fx > viewW || fy > viewH || fx + spriteW * zoom < 0 || fy + spriteH * zoom < 0) continue;
    const cached = getCachedSprite(
      i < wallCount ? f.sprite : themeSprite(f.sprite, 'furniture', theme),
      zoom,
    );
    if (f.mirrored) {
      drawables.push({
        zY: f.zY,
        draw: (c) => {
          c.save();
          c.translate(fx + cached.width, fy);
          c.scale(-1, 1);
          c.drawImage(cached, 0, 0);
          c.restore();
        },
      });
    } else {
      drawables.push({
        zY: f.zY,
        draw: (c) => {
          c.drawImage(cached, fx, fy);
        },
      });
    }
  }

  // Characters (a pet character uses its pet sheet; unknown/unloaded pet = the palette human)
  const nowSec = performance.now() / 1000;
  for (const ch of characters) {
    const pet = ch.pet ? getPetSprites(ch.pet, ch.hueShift) : null;
    const spriteData = pet
      ? ch.matrixEffect
        ? pet.idleDown[0] // 16 px wide, like the matrix effect's column sweep
        : getPetCharacterSprite(ch, pet, nowSec)
      : getCharacterSprite(ch, getCharacterSprites(ch.palette, ch.hueShift));
    const cached = getCachedSprite(spriteData, zoom);
    // Sitting offset: shift character down when seated so they visually sit in the chair
    const sittingOffset = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0;
    // Anchor at bottom-center of character — round to integer device pixels
    const drawX = Math.round(offsetX + ch.x * zoom - cached.width / 2);
    const drawY = Math.round(offsetY + (ch.y + sittingOffset) * zoom - cached.height);

    // Sort characters by bottom of their tile (not center) so they render
    // in front of same-row furniture (e.g. chairs) but behind furniture
    // at lower rows (e.g. desks, bookshelves that occlude from below).
    const charZY = ch.y + TILE_SIZE / 2 + CHARACTER_Z_SORT_OFFSET;

    // Headless agents (adopted, no terminal to focus) render translucent while
    // the "Display headless as ghosts" setting is on.
    const alpha = ch.isHeadless && ghostHeadlessAgents ? HEADLESS_CHARACTER_ALPHA : 1;

    // Matrix spawn/despawn effect — skip outline, use per-pixel rendering
    if (ch.matrixEffect) {
      const mDrawX = drawX;
      const mDrawY = drawY;
      const mSpriteData = spriteData;
      const mCh = ch;
      drawables.push({
        zY: charZY,
        draw: (c) => {
          c.save();
          c.globalAlpha = alpha;
          renderMatrixEffect(c, mCh, mSpriteData, mDrawX, mDrawY, zoom);
          c.restore();
        },
      });
      continue;
    }

    // White outline: full opacity for selected, 50% for hover
    const isSelected = selectedAgentId !== null && ch.id === selectedAgentId;
    const isHovered = hoveredAgentId !== null && ch.id === hoveredAgentId;
    if (isSelected || isHovered) {
      const outlineAlpha = isSelected ? SELECTED_OUTLINE_ALPHA : HOVERED_OUTLINE_ALPHA;
      const outlineData = getOutlineSprite(spriteData);
      const outlineCached = getCachedSprite(outlineData, zoom);
      const olDrawX = drawX - zoom; // 1 sprite-pixel offset, scaled
      const olDrawY = drawY - zoom; // outline follows sitting offset via drawY
      drawables.push({
        zY: charZY - OUTLINE_Z_SORT_OFFSET, // sort just before character
        draw: (c) => {
          c.save();
          c.globalAlpha = outlineAlpha;
          c.drawImage(outlineCached, olDrawX, olDrawY);
          c.restore();
        },
      });
    }

    drawables.push({
      zY: charZY,
      draw: (c) => {
        if (alpha === 1) {
          c.drawImage(cached, drawX, drawY);
          return;
        }
        c.save();
        c.globalAlpha = alpha;
        c.drawImage(cached, drawX, drawY);
        c.restore();
      },
    });
  }

  // Sort by Y (lower = in front = drawn later)
  drawables.sort((a, b) => a.zY - b.zY);

  for (const d of drawables) {
    d.draw(ctx);
  }
}

// ── Seat indicators ─────────────────────────────────────────────

function renderSeatIndicators(
  ctx: CanvasRenderingContext2D,
  seats: Map<string, Seat>,
  characters: Map<number, Character>,
  selectedAgentId: number | null,
  hoveredTile: { col: number; row: number } | null,
  offsetX: number,
  offsetY: number,
  zoom: number,
): void {
  if (selectedAgentId === null || !hoveredTile) return;
  const selectedChar = characters.get(selectedAgentId);
  if (!selectedChar) return;

  // Only show indicator for the hovered seat tile
  for (const [uid, seat] of seats) {
    if (seat.seatCol !== hoveredTile.col || seat.seatRow !== hoveredTile.row) continue;

    const s = TILE_SIZE * zoom;
    const x = offsetX + seat.seatCol * s;
    const y = offsetY + seat.seatRow * s;

    if (selectedChar.seatId === uid) {
      // Selected agent's own seat — blue
      ctx.fillStyle = SEAT_OWN_COLOR;
    } else if (!seat.assigned) {
      // Available seat — green
      ctx.fillStyle = SEAT_AVAILABLE_COLOR;
    } else {
      // Busy (assigned to another agent) — red
      ctx.fillStyle = SEAT_BUSY_COLOR;
    }
    ctx.fillRect(x, y, s, s);
    break;
  }
}

// ── Edit mode overlays ──────────────────────────────────────────

/** @internal */
export function renderGridOverlay(
  ctx: CanvasRenderingContext2D,
  offsetX: number,
  offsetY: number,
  zoom: number,
  cols: number,
  rows: number,
  tileMap?: TileTypeVal[][],
): void {
  const s = TILE_SIZE * zoom;
  ctx.strokeStyle = GRID_LINE_COLORS[getTheme()];
  ctx.lineWidth = 1;
  ctx.beginPath();
  // Vertical lines — offset by 0.5 for crisp 1px lines
  for (let c = 0; c <= cols; c++) {
    const x = offsetX + c * s + 0.5;
    ctx.moveTo(x, offsetY);
    ctx.lineTo(x, offsetY + rows * s);
  }
  // Horizontal lines
  for (let r = 0; r <= rows; r++) {
    const y = offsetY + r * s + 0.5;
    ctx.moveTo(offsetX, y);
    ctx.lineTo(offsetX + cols * s, y);
  }
  ctx.stroke();

  // Draw faint dashed outlines on VOID tiles
  if (tileMap) {
    ctx.save();
    ctx.strokeStyle = VOID_TILE_OUTLINE_COLORS[getTheme()];
    ctx.lineWidth = 1;
    ctx.setLineDash(VOID_TILE_DASH_PATTERN);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (tileMap[r]?.[c] === TileType.VOID) {
          ctx.strokeRect(offsetX + c * s + 0.5, offsetY + r * s + 0.5, s - 1, s - 1);
        }
      }
    }
    ctx.restore();
  }
}

/** @internal */
export function renderGhostPreview(
  ctx: CanvasRenderingContext2D,
  sprite: SpriteData,
  col: number,
  row: number,
  valid: boolean,
  offsetX: number,
  offsetY: number,
  zoom: number,
  mirrored: boolean = false,
): void {
  const cached = getCachedSprite(themeSprite(sprite, 'furniture', getTheme()), zoom);
  const x = offsetX + col * TILE_SIZE * zoom;
  const y = offsetY + row * TILE_SIZE * zoom;
  ctx.save();
  ctx.globalAlpha = GHOST_PREVIEW_SPRITE_ALPHA;
  if (mirrored) {
    ctx.translate(x + cached.width, y);
    ctx.scale(-1, 1);
    ctx.drawImage(cached, 0, 0);
  } else {
    ctx.drawImage(cached, x, y);
  }
  // Tint overlay — reset transform for correct fill position
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = GHOST_PREVIEW_TINT_ALPHA;
  ctx.fillStyle = valid ? GHOST_VALID_TINT : GHOST_INVALID_TINT;
  ctx.fillRect(x, y, cached.width, cached.height);
  ctx.restore();
}

/** @internal */
export function renderSelectionHighlight(
  ctx: CanvasRenderingContext2D,
  col: number,
  row: number,
  w: number,
  h: number,
  offsetX: number,
  offsetY: number,
  zoom: number,
): void {
  const s = TILE_SIZE * zoom;
  const x = offsetX + col * s;
  const y = offsetY + row * s;
  ctx.save();
  ctx.strokeStyle = SELECTION_HIGHLIGHT_COLOR;
  ctx.lineWidth = 2;
  ctx.setLineDash(SELECTION_DASH_PATTERN);
  ctx.strokeRect(x + 1, y + 1, w * s - 2, h * s - 2);
  ctx.restore();
}

/** @internal */
export function renderDeleteButton(
  ctx: CanvasRenderingContext2D,
  col: number,
  row: number,
  w: number,
  _h: number,
  offsetX: number,
  offsetY: number,
  zoom: number,
): DeleteButtonBounds {
  const s = TILE_SIZE * zoom;
  // Position at top-right corner of selected furniture
  const cx = offsetX + (col + w) * s + 1;
  const cy = offsetY + row * s - 1;
  const radius = Math.max(BUTTON_MIN_RADIUS, zoom * BUTTON_RADIUS_ZOOM_FACTOR);

  // Circle background
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = DELETE_BUTTON_BG;
  ctx.fill();

  // X mark
  ctx.strokeStyle = BUTTON_ICON_COLOR;
  ctx.lineWidth = Math.max(BUTTON_LINE_WIDTH_MIN, zoom * BUTTON_LINE_WIDTH_ZOOM_FACTOR);
  ctx.lineCap = 'round';
  const xSize = radius * BUTTON_ICON_SIZE_FACTOR;
  ctx.beginPath();
  ctx.moveTo(cx - xSize, cy - xSize);
  ctx.lineTo(cx + xSize, cy + xSize);
  ctx.moveTo(cx + xSize, cy - xSize);
  ctx.lineTo(cx - xSize, cy + xSize);
  ctx.stroke();
  ctx.restore();

  return { cx, cy, radius };
}

function renderRotateButton(
  ctx: CanvasRenderingContext2D,
  col: number,
  row: number,
  _w: number,
  _h: number,
  offsetX: number,
  offsetY: number,
  zoom: number,
): RotateButtonBounds {
  const s = TILE_SIZE * zoom;
  // Position to the left of the delete button (which is at top-right corner)
  const radius = Math.max(BUTTON_MIN_RADIUS, zoom * BUTTON_RADIUS_ZOOM_FACTOR);
  const cx = offsetX + col * s - 1;
  const cy = offsetY + row * s - 1;

  // Circle background
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = ROTATE_BUTTON_BG;
  ctx.fill();

  // Circular arrow icon
  ctx.strokeStyle = BUTTON_ICON_COLOR;
  ctx.lineWidth = Math.max(BUTTON_LINE_WIDTH_MIN, zoom * BUTTON_LINE_WIDTH_ZOOM_FACTOR);
  ctx.lineCap = 'round';
  const arcR = radius * BUTTON_ICON_SIZE_FACTOR;
  ctx.beginPath();
  // Draw a 270-degree arc
  ctx.arc(cx, cy, arcR, -Math.PI * 0.8, Math.PI * 0.7);
  ctx.stroke();
  // Draw arrowhead at the end of the arc
  const endAngle = Math.PI * 0.7;
  const endX = cx + arcR * Math.cos(endAngle);
  const endY = cy + arcR * Math.sin(endAngle);
  const arrowSize = radius * 0.35;
  ctx.beginPath();
  ctx.moveTo(endX + arrowSize * 0.6, endY - arrowSize * 0.3);
  ctx.lineTo(endX, endY);
  ctx.lineTo(endX + arrowSize * 0.7, endY + arrowSize * 0.5);
  ctx.stroke();
  ctx.restore();

  return { cx, cy, radius };
}

// Character bubbles (the permission "!") are rendered by LanOverlay as DOM
// elements so they stack ABOVE the DOM name tags.

export interface ButtonBounds {
  /** Center X in device pixels */
  cx: number;
  /** Center Y in device pixels */
  cy: number;
  /** Radius in device pixels */
  radius: number;
}

export type DeleteButtonBounds = ButtonBounds;
export type RotateButtonBounds = ButtonBounds;

/** One translucent preview sprite at a target tile. */
export interface GhostSprite {
  sprite: SpriteData;
  col: number;
  row: number;
  mirrored: boolean;
}

export interface EditorRenderState {
  showGrid: boolean;
  /**
   * Preview sprites, drawn in order with one shared validity tint: the item
   * being placed, or a dragged item followed by everything riding on it — the
   * group previews (and is accepted or refused) as one.
   */
  ghosts: GhostSprite[];
  ghostValid: boolean;
  selectedCol: number;
  selectedRow: number;
  selectedW: number;
  selectedH: number;
  hasSelection: boolean;
  isRotatable: boolean;
  /** Updated each frame by renderDeleteButton */
  deleteButtonBounds: DeleteButtonBounds | null;
  /** Updated each frame by renderRotateButton */
  rotateButtonBounds: RotateButtonBounds | null;
}

export interface SelectionRenderState {
  selectedAgentId: number | null;
  hoveredAgentId: number | null;
  hoveredTile: { col: number; row: number } | null;
  seats: Map<string, Seat>;
  characters: Map<number, Character>;
}

export function renderFrame(
  screenCtx: CanvasRenderingContext2D,
  screenWidth: number,
  screenHeight: number,
  tileMap: TileTypeVal[][],
  furniture: FurnitureInstance[],
  characters: Character[],
  viewZoom: number,
  panX: number,
  panY: number,
  selection?: SelectionRenderState,
  editor?: EditorRenderState,
  tileColors?: Array<ColorValue | null>,
  layoutCols?: number,
  layoutRows?: number,
  carpetTiles?: Array<CarpetTile | null>,
  areas?: AreaDefinition[],
  areaTiles?: Array<string | null>,
  showAreas?: boolean,
  background?: OfficeBackground,
  roomCounts?: Map<string, RoomCount> | null,
): { offsetX: number; offsetY: number } {
  // Use layout dimensions (fallback to tileMap size)
  const cols = layoutCols ?? (tileMap.length > 0 ? tileMap[0].length : 0);
  const rows = layoutRows ?? tileMap.length;

  // Fractional zoom: draw at the integer `renderZoom` (sprite caches stay
  // per-integer) into an offscreen canvas, then blit it scaled by `scale` with
  // nearest-neighbour. Everything below works in that render space; the
  // returned offsets are screen device px, the frame overlays use.
  const view = mapOffset(screenWidth, screenHeight, cols, rows, viewZoom, panX, panY);
  const scaled = view.scale !== 1;
  let canvasWidth = scaled ? Math.ceil(screenWidth / view.scale) : screenWidth;
  let canvasHeight = scaled ? Math.ceil(screenHeight / view.scale) : screenHeight;
  // Zoomed out below 1 the render space is bigger than the screen: render only
  // the visible part of the map (plus a tile for edge sprites) and paint the
  // background around it straight onto the screen.
  let originX = 0;
  let originY = 0;
  if (view.scale < 1) {
    const pad = TILE_SIZE * view.renderZoom;
    const x0 = Math.max(0, view.renderOffsetX - pad);
    const y0 = Math.max(0, view.renderOffsetY - pad);
    const x1 = Math.min(canvasWidth, view.renderOffsetX + cols * TILE_SIZE * view.renderZoom + pad);
    const y1 = Math.min(
      canvasHeight,
      view.renderOffsetY + rows * TILE_SIZE * view.renderZoom + pad,
    );
    if (x1 > x0 && y1 > y0) {
      originX = x0;
      originY = y0;
      canvasWidth = x1 - x0;
      canvasHeight = y1 - y0;
    }
  }
  const ctx = scaled ? offscreenContext(canvasWidth, canvasHeight) : screenCtx;
  const zoom = view.renderZoom;
  const offsetX = view.renderOffsetX - originX;
  const offsetY = view.renderOffsetY - originY;
  const backgroundFill = resolveBackground(background, {
    floorPatterns: getFloorPatternCount(),
    carpetVariants: getCarpetSetCount(),
  });

  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  // Background (outside the office + VOID tiles), then tiles (floor + wall base color)
  renderBackground(ctx, backgroundFill, canvasWidth, canvasHeight, offsetX, offsetY, zoom);
  // Floor + wall base + carpets (below seat indicators / furniture / characters)
  renderFloorLayer(ctx, tileMap, tileColors, carpetTiles, cols, rows, offsetX, offsetY, zoom);

  // Area overlay (translucent color wash) — above carpets, below seat indicators
  if (showAreas) {
    renderAreaOverlay(ctx, areaTiles, areas, cols, rows, offsetX, offsetY, zoom);
  }

  // Seat indicators (below furniture/characters, on top of floor)
  if (selection) {
    renderSeatIndicators(
      ctx,
      selection.seats,
      selection.characters,
      selection.selectedAgentId,
      selection.hoveredTile,
      offsetX,
      offsetY,
      zoom,
    );
  }

  // Build wall instances for z-sorting with furniture and characters
  const wallInstances = wallInstancesFor(tileMap, tileColors, layoutCols);
  const allFurniture = wallInstances.length > 0 ? [...wallInstances, ...furniture] : furniture;

  // Draw walls + furniture + characters (z-sorted)
  const selectedId = selection?.selectedAgentId ?? null;
  const hoveredId = selection?.hoveredAgentId ?? null;
  renderScene(
    ctx,
    allFurniture,
    characters,
    offsetX,
    offsetY,
    zoom,
    selectedId,
    hoveredId,
    wallInstances.length,
  );

  // Area labels (above bubbles + characters, below editor overlays). Outside
  // Show Areas the room names still show, at the top of each room.
  if (showAreas) {
    renderAreaLabels(ctx, areaTiles, areas, cols, rows, offsetX, offsetY, zoom);
  } else {
    renderRoomNames(ctx, areaTiles, cols, rows, offsetX, offsetY, zoom, view.scale, roomCounts);
  }

  // Editor overlays
  if (editor) {
    if (editor.showGrid) {
      renderGridOverlay(ctx, offsetX, offsetY, zoom, cols, rows, tileMap);
    }
    for (const ghost of editor.ghosts) {
      renderGhostPreview(
        ctx,
        ghost.sprite,
        ghost.col,
        ghost.row,
        editor.ghostValid,
        offsetX,
        offsetY,
        zoom,
        ghost.mirrored,
      );
    }
    if (editor.hasSelection) {
      renderSelectionHighlight(
        ctx,
        editor.selectedCol,
        editor.selectedRow,
        editor.selectedW,
        editor.selectedH,
        offsetX,
        offsetY,
        zoom,
      );
      editor.deleteButtonBounds = renderDeleteButton(
        ctx,
        editor.selectedCol,
        editor.selectedRow,
        editor.selectedW,
        editor.selectedH,
        offsetX,
        offsetY,
        zoom,
      );
      if (editor.isRotatable) {
        editor.rotateButtonBounds = renderRotateButton(
          ctx,
          editor.selectedCol,
          editor.selectedRow,
          editor.selectedW,
          editor.selectedH,
          offsetX,
          offsetY,
          zoom,
        );
      } else {
        editor.rotateButtonBounds = null;
      }
    } else {
      editor.deleteButtonBounds = null;
      editor.rotateButtonBounds = null;
    }
  }

  if (scaled) {
    screenCtx.clearRect(0, 0, screenWidth, screenHeight);
    screenCtx.imageSmoothingEnabled = false;
    if (originX !== 0 || originY !== 0 || view.scale < 1) {
      renderBackground(
        screenCtx,
        backgroundFill,
        screenWidth,
        screenHeight,
        view.offsetX,
        view.offsetY,
        zoom,
        view.scale,
      );
    }
    const sx = originX * view.scale;
    const sy = originY * view.scale;
    screenCtx.drawImage(ctx.canvas, sx, sy, canvasWidth * view.scale, canvasHeight * view.scale);
    if (editor) {
      editor.deleteButtonBounds = scaleBounds(editor.deleteButtonBounds, view.scale, sx, sy);
      editor.rotateButtonBounds = scaleBounds(editor.rotateButtonBounds, view.scale, sx, sy);
    }
  }

  return { offsetX: view.offsetX, offsetY: view.offsetY };
}

let offscreen: CanvasRenderingContext2D | null = null;

/** One reusable offscreen render target for fractional-zoom frames. */
function offscreenContext(width: number, height: number): CanvasRenderingContext2D {
  if (!offscreen) offscreen = document.createElement('canvas').getContext('2d')!;
  const c = offscreen.canvas;
  if (c.width !== width || c.height !== height) {
    c.width = width;
    c.height = height;
    offscreen.imageSmoothingEnabled = false;
  }
  return offscreen;
}

function scaleBounds(b: ButtonBounds | null, scale: number, dx = 0, dy = 0): ButtonBounds | null {
  return b && { cx: b.cx * scale + dx, cy: b.cy * scale + dy, radius: b.radius * scale };
}

/**
 * World coordinates → screen coordinates, in one place.
 *
 * The office is drawn by centering the map in the canvas and then applying the
 * pan, both snapped to whole device pixels so sprites stay on the pixel grid.
 * That formula was reproduced in the renderer and in each DOM overlay that
 * floats something above a character; a copy that rounds differently puts the
 * overlay a pixel off the sprite it is labelling, which is invisible in review
 * and obvious on screen.
 *
 * Deliberately free of DOM access — `dpr` is passed in, not read from
 * `window`. Reading the environment belongs at the component boundary; a state
 * or math module that reaches for `window` drags the DOM into every module
 * graph that imports it.
 */

import { ZOOM_INTEGER_EPSILON } from '../constants.js';
import { TILE_SIZE } from './types.js';

/**
 * Split a (possibly fractional) zoom into the integer zoom sprites are drawn
 * at and the scale the drawn frame is blitted with: zoom = renderZoom × scale.
 * Floor, not ceil, so zooms ≥ 1 only ever upscale (scale in [1, 2)) and no
 * 1-px sprite detail is dropped; below 1 the frame is drawn at 1 and shrunk.
 */
export function renderScale(zoom: number): { renderZoom: number; scale: number } {
  const renderZoom = Math.max(1, Math.floor(zoom + ZOOM_INTEGER_EPSILON));
  const scale = zoom / renderZoom;
  return { renderZoom, scale: Math.abs(scale - 1) < ZOOM_INTEGER_EPSILON ? 1 : scale };
}

/** Where the map sits for a zoom + pan, in two frames of reference:
 *  `offsetX/Y` = screen device px of the map's top-left (world → screen is
 *  offset + world × zoom); `renderOffsetX/Y` = the same corner in the integer
 *  render space the renderer draws in before scaling. The render offset is
 *  whole pixels, so sprites stay on the pixel grid, and the screen offset is
 *  derived from it, so overlays land exactly on the scaled sprites.
 *  Overlays go through {@link overlayProjection} instead of calling this. */
export function mapOffset(
  canvasWidth: number,
  canvasHeight: number,
  cols: number,
  rows: number,
  zoom: number,
  panX: number,
  panY: number,
): {
  offsetX: number;
  offsetY: number;
  renderOffsetX: number;
  renderOffsetY: number;
  renderZoom: number;
  scale: number;
} {
  const { renderZoom, scale } = renderScale(zoom);
  const mapW = cols * TILE_SIZE * renderZoom;
  const mapH = rows * TILE_SIZE * renderZoom;
  const renderOffsetX = Math.floor((canvasWidth / scale - mapW) / 2) + Math.round(panX / scale);
  const renderOffsetY = Math.floor((canvasHeight / scale - mapH) / 2) + Math.round(panY / scale);
  return {
    offsetX: renderOffsetX * scale,
    offsetY: renderOffsetY * scale,
    renderOffsetX,
    renderOffsetY,
    renderZoom,
    scale,
  };
}

/** Projects world points into CSS pixels within the overlay container that
 *  sits on top of the canvas. */
export interface OverlayProjection {
  toScreenX(worldX: number): number;
  toScreenY(worldY: number): number;
  /** Container size in world units — what the viewport currently covers.
   *  Used to cap overlay offsets against the visible area. */
  readonly viewportWorldWidth: number;
  readonly viewportWorldHeight: number;
  /** CSS px → world units, for sizing overlay geometry in world terms. */
  toWorldLength(cssPx: number): number;
}

export function overlayProjection(
  layout: { cols: number; rows: number },
  containerRect: { width: number; height: number },
  zoom: number,
  pan: { x: number; y: number },
  dpr: number,
): OverlayProjection {
  const canvasW = Math.round(containerRect.width * dpr);
  const canvasH = Math.round(containerRect.height * dpr);
  const { offsetX, offsetY } = mapOffset(
    canvasW,
    canvasH,
    layout.cols,
    layout.rows,
    zoom,
    pan.x,
    pan.y,
  );
  return {
    toScreenX: (worldX) => (offsetX + worldX * zoom) / dpr,
    toScreenY: (worldY) => (offsetY + worldY * zoom) / dpr,
    viewportWorldWidth: canvasW / zoom,
    viewportWorldHeight: canvasH / zoom,
    toWorldLength: (cssPx) => (cssPx * dpr) / zoom,
  };
}

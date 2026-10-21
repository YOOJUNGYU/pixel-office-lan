import { WHEEL_LINE_HEIGHT_PX, ZOOM_MAX, ZOOM_MIN, ZOOM_WHEEL_SENSITIVITY } from '../constants.js';

export function clampZoom(zoom: number): number {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
}

/**
 * Continuous wheel/pinch zoom: multiplicative and proportional to the scroll
 * delta, so a mouse notch is one ~×1.16 step and a trackpad's small deltas are
 * fine steps. `deltaMode` 1 = lines (some mice), converted to px.
 */
export function wheelZoom(zoom: number, deltaY: number, deltaMode = 0): number {
  const px = deltaMode === 1 ? deltaY * WHEEL_LINE_HEIGHT_PX : deltaY;
  return clampZoom(zoom * Math.exp(-px * ZOOM_WHEEL_SENSITIVITY));
}

/**
 * New pan (device px) that keeps the world point under `cursor` fixed on screen
 * when zoom changes. The map is centered in the viewport, so the point's offset
 * from the map center is (cursor - viewportCenter - pan) / zoom, in world units.
 * All screen values are device pixels, matching `mapOffset` in projection.ts.
 */
export function zoomAtPoint(
  pan: { x: number; y: number },
  oldZoom: number,
  newZoom: number,
  cursor: { x: number; y: number },
  viewport: { w: number; h: number },
): { x: number; y: number } {
  const ratio = newZoom / oldZoom;
  const ux = cursor.x - viewport.w / 2;
  const uy = cursor.y - viewport.h / 2;
  return { x: ux - (ux - pan.x) * ratio, y: uy - (uy - pan.y) * ratio };
}

/** Keeps the map from being panned further than `marginFraction` of the viewport past its edge. */
export function clampPanToMap(
  pan: { x: number; y: number },
  zoom: number,
  mapWorldW: number,
  mapWorldH: number,
  viewport: { w: number; h: number },
  marginFraction: number,
): { x: number; y: number } {
  const maxX = (mapWorldW * zoom) / 2 + viewport.w / 2 - viewport.w * marginFraction;
  const maxY = (mapWorldH * zoom) / 2 + viewport.h / 2 - viewport.h * marginFraction;
  return {
    x: Math.max(-maxX, Math.min(maxX, pan.x)),
    y: Math.max(-maxY, Math.min(maxY, pan.y)),
  };
}

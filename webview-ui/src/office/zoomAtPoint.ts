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

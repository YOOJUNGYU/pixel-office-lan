import { type MutableRefObject, type RefObject, useEffect, useState } from 'react';

import { ROOM_PLATE_INSET_PX, ROOM_PLATE_Z_INDEX } from '../constants.js';
import { useLang } from '../i18n.js';
import { onFrame } from '../office/engine/gameLoop.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { overlayProjection } from '../office/projection.js';
import { TILE_SIZE } from '../office/types.js';
import { plateText } from './lanAgents.js';

interface Plate {
  label: string;
  text: string;
  left: number;
  top: number;
}

/** label → top row and the leftmost column on that row; scanned once per areaTiles array. */
const topsCache = new WeakMap<Array<string | null>, Map<string, { row: number; col: number }>>();
function roomTops(
  areaTiles: Array<string | null>,
  cols: number,
): Map<string, { row: number; col: number }> {
  let tops = topsCache.get(areaTiles);
  if (!tops) {
    tops = new Map();
    areaTiles.forEach((label, i) => {
      if (label && !tops!.has(label))
        tops!.set(label, { row: Math.floor(i / cols), col: i % cols });
    });
    topsCache.set(areaTiles, tops);
  }
  return tops;
}

interface RoomPlatesProps {
  officeState: OfficeState;
  containerRef: RefObject<HTMLDivElement | null>;
  zoom: number;
  panRef: MutableRefObject<{ x: number; y: number }>;
}

/**
 * Room name plates (`코딩실 5 · +3`) as DOM badges just inside each room's
 * top-left corner, following pan/zoom at a fixed font size. Recomputed after
 * every canvas frame (`onFrame`), re-rendered only when a plate moved or
 * changed text — nothing at all while the office is idle.
 */
export function RoomPlates({ officeState, containerRef, zoom, panRef }: RoomPlatesProps) {
  const lang = useLang();
  const [plates, setPlates] = useState<Plate[]>([]);
  useEffect(() => {
    let key = '';
    const update = () => {
      const el = containerRef.current;
      const layout = officeState.getLayout();
      if (!el || !layout.areaTiles) return;
      const p = overlayProjection(
        layout,
        el.getBoundingClientRect(),
        zoom,
        panRef.current,
        window.devicePixelRatio || 1,
      );
      const next: Plate[] = [];
      for (const [label, t] of roomTops(layout.areaTiles, layout.cols)) {
        next.push({
          label,
          text: plateText(label, officeState.roomCounts?.get(label)),
          left: Math.round(p.toScreenX(t.col * TILE_SIZE)) + ROOM_PLATE_INSET_PX,
          top: Math.round(p.toScreenY(t.row * TILE_SIZE)) + ROOM_PLATE_INSET_PX,
        });
      }
      const k = JSON.stringify(next);
      if (k !== key) {
        key = k;
        setPlates(next);
      }
    };
    update();
    return onFrame(update);
  }, [officeState, containerRef, zoom, panRef, lang]);

  return (
    <>
      {plates.map((pl) => (
        <div
          key={pl.label}
          data-room-plate={pl.label}
          className="absolute pixel-panel px-6 py-1 text-sm font-bold leading-normal whitespace-nowrap pointer-events-none select-none"
          style={{ left: pl.left, top: pl.top, zIndex: ROOM_PLATE_Z_INDEX }}
        >
          {pl.text}
        </div>
      ))}
    </>
  );
}

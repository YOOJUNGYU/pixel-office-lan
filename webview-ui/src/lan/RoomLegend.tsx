import { useState } from 'react';

import type { Room } from '../../../core/src/lan.js';
import { ROOM_LABELS, ROOM_ORDER } from '../../../core/src/lan.js';
import {
  MOBILE_MEDIA_QUERY,
  PEOPLE_WIDE_MIN_PX,
  ROOM_AREA_COLORS,
  ROOM_LEGEND_KEY,
  ROOM_LEGEND_MOBILE_TOP_PX,
  ROOM_LEGEND_TOP_PX,
} from '../constants.js';
import { t, useLang } from '../i18n.js';
import type { AreaDefinition } from '../office/types.js';

/** Remembered choice, else open on a wide, non-mobile screen. */
function initialOpen(): boolean {
  try {
    const saved = localStorage.getItem(ROOM_LEGEND_KEY);
    if (saved !== null) return saved === '1';
  } catch {
    /* storage blocked: fall back to the screen width */
  }
  return !window.matchMedia(MOBILE_MEDIA_QUERY).matches && window.innerWidth >= PEOPLE_WIDE_MIN_PX;
}

interface RoomLegendProps {
  /** The layout's room colors (missing ones fall back to the defaults). */
  areas: AreaDefinition[] | undefined;
  isMobile: boolean;
  /** The tour's legend step shows it open regardless of the viewer's choice. */
  forceOpen: boolean;
  tagsHidden: boolean;
  onToggleTags: () => void;
}

/** Top-left "Rooms" legend under the zoom buttons: what sends an agent to which room. */
export function RoomLegend({
  areas,
  isMobile,
  forceOpen,
  tagsHidden,
  onToggleTags,
}: RoomLegendProps) {
  useLang();
  const [isOpen, setIsOpen] = useState(initialOpen);
  const open = forceOpen || isOpen;
  const toggle = () => {
    setIsOpen(!isOpen);
    try {
      localStorage.setItem(ROOM_LEGEND_KEY, isOpen ? '0' : '1');
    } catch {
      /* storage blocked: the choice lasts for this page only */
    }
  };
  const color = (r: Room) =>
    areas?.find((a) => a.label === ROOM_LABELS[r])?.color ?? ROOM_AREA_COLORS[r];

  return (
    <div
      data-tour="room-legend"
      style={{ top: isMobile ? ROOM_LEGEND_MOBILE_TOP_PX : ROOM_LEGEND_TOP_PX }}
      className="absolute left-8 z-10 flex flex-col items-start gap-4 text-sm max-w-[min(340px,calc(50%-20px))]"
    >
      <div className="pixel-panel flex flex-col self-stretch">
        <button
          type="button"
          aria-expanded={open}
          onClick={toggle}
          className="flex items-center justify-between gap-8 py-4 px-8 bg-transparent border-0 text-text cursor-pointer font-bold whitespace-nowrap"
        >
          <span>{t('legend.title')}</span>
          <span aria-hidden>{open ? '▾' : '▸'}</span>
        </button>
        {open && (
          <ul className="m-0 py-4 px-8 list-none flex flex-col gap-6 border-t-2 border-border">
            {ROOM_ORDER.map((r) => (
              <li key={r} className="flex gap-6 items-start">
                <span
                  aria-hidden
                  className="w-10 h-10 mt-4 shrink-0 border-2 border-border"
                  style={{ background: color(r) }}
                />
                <span className="flex flex-col min-w-0">
                  <span className="font-bold">{t(`room.${r}`)}</span>
                  <span className="text-xs text-text-muted">{t(`legend.${r}`)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <button
        type="button"
        aria-pressed={tagsHidden}
        onClick={onToggleTags}
        className="pixel-panel py-4 px-8 text-text cursor-pointer whitespace-nowrap"
      >
        {t(tagsHidden ? 'tags.show' : 'tags.hide')}
      </button>
    </div>
  );
}

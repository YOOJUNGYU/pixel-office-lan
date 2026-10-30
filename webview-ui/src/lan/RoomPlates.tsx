import { type MutableRefObject, type RefObject, useEffect, useState } from 'react';

import type { OfficeAgent, Room } from '../../../core/src/lan.js';
import { ROOM_LABELS, ROOM_ORDER } from '../../../core/src/lan.js';
import {
  LAN_ALERT_COLOR,
  LAN_PROVIDER_BADGE_FG,
  LAN_PROVIDER_COLORS,
  PEOPLE_FACE_CROP,
  PEOPLE_FACE_SCALE,
  PEOPLE_PET_FACE_CROP,
  ROOM_PLATE_INSET_PX,
  ROOM_PLATE_TIP_Z_INDEX,
  ROOM_PLATE_Z_INDEX,
  ROOM_TIP_WIDTH_PX,
} from '../constants.js';
import { areaName, t, useLang } from '../i18n.js';
import { onFrame } from '../office/engine/gameLoop.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { overlayProjection } from '../office/projection.js';
import { TILE_SIZE } from '../office/types.js';
import { badgeColors } from './badgeColors.js';
import {
  activityText,
  type LanAgents,
  plateCount,
  providerName,
  roomAgents,
  tagBadge,
  tagText,
} from './lanAgents.js';
import { CharacterPreview } from './ProfileModal.js';

interface Plate {
  label: string;
  count: string | null;
  left: number;
  top: number;
  /** The room's right and bottom edges on screen: the popup stays inside them. */
  right: number;
  bottom: number;
}

interface RoomBox {
  /** Top row and the leftmost column on that row (the plate's corner). */
  row: number;
  col: number;
  maxCol: number;
  maxRow: number;
}

/** label → its plate corner and bounding box; scanned once per areaTiles array. */
const boxCache = new WeakMap<Array<string | null>, Map<string, RoomBox>>();
function roomBoxes(areaTiles: Array<string | null>, cols: number): Map<string, RoomBox> {
  let boxes = boxCache.get(areaTiles);
  if (!boxes) {
    const out = new Map<string, RoomBox>();
    areaTiles.forEach((label, i) => {
      if (!label) return;
      const row = Math.floor(i / cols);
      const col = i % cols;
      const b = out.get(label);
      if (!b) out.set(label, { row, col, maxCol: col, maxRow: row });
      else {
        b.maxCol = Math.max(b.maxCol, col);
        b.maxRow = Math.max(b.maxRow, row);
      }
    });
    boxCache.set(areaTiles, out);
    boxes = out;
  }
  return boxes;
}

interface RoomPlatesProps {
  officeState: OfficeState;
  lan: LanAgents;
  containerRef: RefObject<HTMLDivElement | null>;
  zoom: number;
  panRef: MutableRefObject<{ x: number; y: number }>;
  /** The tour's room step shows the first room's popup without a hover. */
  forceTip: boolean;
}

/** The room of a layout label (`legend.<room>` says what sends an agent there). */
const roomOf = (label: string) => ROOM_ORDER.find((r) => ROOM_LABELS[r] === label);

/**
 * Room name plates as DOM badges just inside each room's top-left corner, with
 * a count chip ("에이전트 5 · 하위 3") when agents are there, following pan/zoom
 * at a fixed font size. Recomputed after every canvas frame (`onFrame`),
 * re-rendered only when a plate moved or changed — nothing while idle. Hover
 * opens the room's popup (RoomTip).
 */
export function RoomPlates({
  officeState,
  lan,
  containerRef,
  zoom,
  panRef,
  forceTip,
}: RoomPlatesProps) {
  const lang = useLang();
  const [plates, setPlates] = useState<Plate[]>([]);
  const [hovered, setHovered] = useState<string | null>(null);
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
      for (const [label, b] of roomBoxes(layout.areaTiles, layout.cols)) {
        next.push({
          label,
          // The lounge holds people (one avatar each), not agents: no count.
          count:
            label === ROOM_LABELS.lounge ? null : plateCount(officeState.roomCounts?.get(label)),
          left: Math.round(p.toScreenX(b.col * TILE_SIZE)) + ROOM_PLATE_INSET_PX,
          top: Math.round(p.toScreenY(b.row * TILE_SIZE)) + ROOM_PLATE_INSET_PX,
          right: Math.round(p.toScreenX((b.maxCol + 1) * TILE_SIZE)) - ROOM_PLATE_INSET_PX,
          bottom: Math.round(p.toScreenY((b.maxRow + 1) * TILE_SIZE)) - ROOM_PLATE_INSET_PX,
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
      {plates.map((pl, i) => {
        const room = roomOf(pl.label);
        const tip = room && (hovered === pl.label || (forceTip && i === 0));
        return (
          <div
            key={pl.label}
            data-room-plate={pl.label}
            data-tour={i === 0 ? 'room-plate' : undefined}
            className="absolute select-none"
            style={{
              left: pl.left,
              top: pl.top,
              zIndex: tip ? ROOM_PLATE_TIP_Z_INDEX : ROOM_PLATE_Z_INDEX,
            }}
            onMouseEnter={() => setHovered(pl.label)}
            onMouseLeave={() => setHovered((h) => (h === pl.label ? null : h))}
          >
            <div className="pixel-panel flex items-center gap-6 px-6 py-1 text-sm leading-normal whitespace-nowrap cursor-help w-max">
              <span className="font-bold">{areaName(pl.label)}</span>
              {pl.count && (
                <span
                  data-room-count
                  className="px-4 text-xs leading-normal bg-accent text-on-accent"
                >
                  {pl.count}
                </span>
              )}
            </div>
            {tip && <RoomTip room={room} lan={lan} plate={pl} />}
          </div>
        );
      })}
    </>
  );
}

/**
 * A plate's popup: what sends an agent to the room, then a card per agent in it
 * (face, MAIN/SUB/SHELL + #n + name, provider badge + what it does). Kept inside
 * the room's screen box; scrolls when the cards don't fit. Re-rendered every
 * frame while open, so the cards follow the snapshots.
 */
function RoomTip({ room, lan, plate }: { room: Room; lan: LanAgents; plate: Plate }) {
  const [, setTick] = useState(0);
  useEffect(() => onFrame(() => setTick((n) => n + 1)), []);
  /** The popup's offset below the plate's top (the plate's own height + margin). */
  const [offset, setOffset] = useState(0);
  const all = lan.all();
  const agents = roomAgents(all, room);
  const byKey = new Map(all.map((a) => [a.key, a] as const));
  return (
    <div
      role="tooltip"
      ref={(el) => {
        if (el && el.offsetTop !== offset) setOffset(el.offsetTop);
      }}
      data-room-tip={room}
      className="pixel-panel mt-4 flex flex-col gap-6 px-8 py-6 overflow-y-auto"
      style={{
        width: Math.max(0, Math.min(ROOM_TIP_WIDTH_PX, plate.right - plate.left)),
        maxHeight: Math.max(0, plate.bottom - plate.top - offset),
      }}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="text-xs text-text-muted">{t(`legend.${room}`)}</div>
      {agents.length === 0 ? (
        <div className="text-xs text-text-muted">{t('plate.none')}</div>
      ) : (
        agents.map((a) => (
          <AgentCard
            key={a.key}
            a={a}
            parent={a.parentKey !== undefined ? byKey.get(a.parentKey) : undefined}
          />
        ))
      )}
    </div>
  );
}

function AgentCard({ a, parent }: { a: OfficeAgent; parent?: OfficeAgent }) {
  return (
    <div data-agent-card={a.key} className="flex items-center gap-8 min-w-0">
      <span className="shrink-0 flex bg-bg-dark border-2 border-border">
        <CharacterPreview
          palette={a.peer.palette}
          hueShift={a.peer.hueShift}
          pet={a.peer.pet}
          scale={PEOPLE_FACE_SCALE}
          crop={a.peer.pet ? PEOPLE_PET_FACE_CROP : PEOPLE_FACE_CROP}
        />
      </span>
      <span className="flex-1 min-w-0 flex flex-col gap-2 text-sm leading-normal">
        <span className="flex items-center gap-4 min-w-0">
          <span
            className="shrink-0 px-2 text-2xs font-bold leading-normal"
            style={badgeColors(a.kind)}
          >
            {tagBadge(a)}
          </span>
          <span className="truncate">{tagText(a, parent)}</span>
        </span>
        <span className="flex items-center gap-4 min-w-0 text-xs">
          <span
            className="shrink-0 px-2 text-2xs font-bold leading-normal"
            style={{ background: LAN_PROVIDER_COLORS[a.provider], color: LAN_PROVIDER_BADGE_FG }}
          >
            {providerName(a)}
          </span>
          {a.permission && (
            <span className="shrink-0 font-bold" style={{ color: LAN_ALERT_COLOR }}>
              ! {t('bubble.permission')}
            </span>
          )}
          <span className="truncate text-text-muted">{activityText(a)}</span>
        </span>
      </span>
    </div>
  );
}

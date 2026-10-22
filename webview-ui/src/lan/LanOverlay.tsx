import { type MutableRefObject, type RefObject, useEffect, useRef, useState } from 'react';

import {
  BUBBLE_SITTING_OFFSET_PX,
  BUBBLE_VERTICAL_OFFSET_PX,
  CHARACTER_SITTING_OFFSET_PX,
  LAN_ALERT_COLOR,
  LAN_BUBBLE_HEAD_OFFSET,
  LAN_BUBBLE_MAX_WIDTH_PX,
  LAN_BUBBLE_Z_INDEX,
  LAN_KIND_BADGES,
  LAN_PERMISSION_Z_INDEX,
  LAN_PROVIDER_COLORS,
  LAN_TAG_Z_INDEX,
  PET_HEAD_DROP_PX,
} from '../constants.js';
import { actText, t } from '../i18n.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { overlayProjection, renderScale } from '../office/projection.js';
import { getCachedSprite } from '../office/sprites/spriteCache.js';
import { BUBBLE_PERMISSION_SPRITE } from '../office/sprites/spriteData.js';
import { CharacterState } from '../office/types.js';
import { type LanAgents, tagBadge, tagText } from './lanAgents.js';

/** The permission bubble sprite, blitted into a DOM canvas above the tags. */
/** `scale` = fractional-zoom stretch on top of the integer-zoom sprite (see renderScale). */
function PermissionBubble({
  cached,
  dpr,
  scale,
}: {
  cached: HTMLCanvasElement;
  dpr: number;
  scale: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = cached.width;
    canvas.height = cached.height;
    canvas.getContext('2d')?.drawImage(cached, 0, 0);
  }, [cached]);
  return (
    <canvas
      ref={ref}
      className="block"
      style={{
        width: (cached.width * scale) / dpr,
        height: (cached.height * scale) / dpr,
        imageRendering: 'pixelated',
      }}
    />
  );
}

interface LanOverlayProps {
  officeState: OfficeState;
  lan: LanAgents;
  containerRef: RefObject<HTMLDivElement | null>;
  zoom: number;
  panRef: MutableRefObject<{ x: number; y: number }>;
}

/**
 * Name tags under every LAN character, permission bubbles over waiting ones,
 * and the hover bubble (room, activity, reason) in the viewer's language. Re-rendered every animation
 * frame so the DOM follows walking sprites; tags are keyed so React only
 * moves them. Ghost parents get no tag (the real parent has one) but hovering
 * one shows the parent's bubble. All text is React text nodes.
 */
export function LanOverlay({ officeState, lan, containerRef, zoom, panRef }: LanOverlayProps) {
  const [, setTick] = useState(0);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setTick((n) => n + 1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const el = containerRef.current;
  if (!el) return null;
  const dpr = window.devicePixelRatio || 1;
  const project = overlayProjection(
    officeState.getLayout(),
    el.getBoundingClientRect(),
    zoom,
    panRef.current,
    dpr,
  );
  // Sprite cache stays per integer zoom; the bubble is stretched by `scale`.
  const { renderZoom, scale } = renderScale(zoom);
  const permissionSprite = getCachedSprite(BUBBLE_PERMISSION_SPRITE, renderZoom);

  const nodes = [];
  const byKey = new Map(lan.all().map((a) => [a.key, a] as const));
  for (const a of lan.all()) {
    const id = lan.idFor(a.key);
    const ch = id !== undefined ? officeState.characters.get(id) : undefined;
    if (!ch) continue;
    const typing = ch.state === CharacterState.TYPE;
    const x = project.toScreenX(ch.x);
    const lit = a.peer.id === lan.highlightPeer;
    nodes.push(
      <div
        key={a.key}
        data-agent-key={a.key}
        className={`absolute -translate-x-1/2 flex items-center gap-4 whitespace-nowrap text-sm leading-none px-3 py-1 text-text pointer-events-none ${lit ? 'bg-accent outline-2 outline-accent-bright' : 'bg-bg/75'}`}
        style={{
          left: x,
          top: project.toScreenY(ch.y + (typing ? CHARACTER_SITTING_OFFSET_PX : 0)),
          zIndex: lit ? LAN_PERMISSION_Z_INDEX : LAN_TAG_Z_INDEX,
        }}
      >
        <span
          className="w-6 h-6 shrink-0"
          style={{ background: LAN_PROVIDER_COLORS[a.provider] }}
        />
        {tagText(a, a.parentKey !== undefined ? byKey.get(a.parentKey) : undefined)}
        {a.kind !== 'main' && (
          <span
            data-badge={a.kind}
            className="shrink-0 px-2 text-2xs font-bold leading-none"
            style={{ background: LAN_KIND_BADGES[a.kind].bg, color: LAN_KIND_BADGES[a.kind].fg }}
          >
            {tagBadge(a)}
          </span>
        )}
      </div>,
    );
    if (a.permission) {
      nodes.push(
        <div
          key={`${a.key}!`}
          className="absolute -translate-x-1/2 pointer-events-none"
          style={{
            left: x,
            top:
              project.toScreenY(
                ch.y +
                  (typing ? BUBBLE_SITTING_OFFSET_PX : 0) +
                  (ch.pet ? PET_HEAD_DROP_PX : 0) -
                  BUBBLE_VERTICAL_OFFSET_PX,
              ) -
              (permissionSprite.height * scale + zoom) / dpr,
            zIndex: LAN_PERMISSION_Z_INDEX,
          }}
        >
          <PermissionBubble cached={permissionSprite} dpr={dpr} scale={scale} />
        </div>,
      );
    }
  }

  // Hovering a ghost resolves to its real parent's agent (absent parent → nothing).
  const hoveredId = officeState.hoveredAgentId;
  const hovered = hoveredId !== null ? lan.agentFor(hoveredId) : undefined;
  const hoveredCh = hoveredId !== null ? officeState.characters.get(hoveredId) : undefined;
  if (hovered && hoveredCh) {
    const typing = hoveredCh.state === CharacterState.TYPE;
    nodes.push(
      <div
        key="hover"
        data-tour="hover-bubble"
        className="absolute -translate-x-1/2 -translate-y-full pixel-panel px-8 py-6 flex flex-col gap-4 w-max text-sm leading-snug break-words pointer-events-none"
        style={{
          left: project.toScreenX(hoveredCh.x),
          top: project.toScreenY(
            hoveredCh.y +
              (typing ? CHARACTER_SITTING_OFFSET_PX : 0) +
              (hoveredCh.pet ? PET_HEAD_DROP_PX : 0) -
              LAN_BUBBLE_HEAD_OFFSET,
          ),
          maxWidth: LAN_BUBBLE_MAX_WIDTH_PX,
          zIndex: LAN_BUBBLE_Z_INDEX,
        }}
      >
        <span className="font-bold">
          {hovered.permission && (
            <>
              <span style={{ color: LAN_ALERT_COLOR }}>!</span> {t('bubble.permission')} ·{' '}
            </>
          )}
          {t(`room.${hovered.room}`)}
        </span>
        <span>{actText(hovered.act, hovered.target)}</span>
        {hovered.reason && <span className="text-text-muted">“{hovered.reason}”</span>}
      </div>,
    );
  }
  return <>{nodes}</>;
}

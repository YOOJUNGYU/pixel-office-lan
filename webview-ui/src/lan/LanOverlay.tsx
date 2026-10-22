import { type MutableRefObject, type RefObject, useEffect, useRef, useState } from 'react';

import type { OfficeAgent } from '../../../core/src/lan.js';
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
  LAN_TAG_BADGE_CHROME_PX,
  LAN_TAG_BADGE_FONT,
  LAN_TAG_CHROME_PX,
  LAN_TAG_FONT,
  LAN_TAG_HEIGHT_PX,
  LAN_TAG_STACK_GAP_PX,
  LAN_TAG_Z_INDEX,
  PET_HEAD_DROP_PX,
} from '../constants.js';
import { actText, t } from '../i18n.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { overlayProjection, renderScale } from '../office/projection.js';
import { getCachedSprite } from '../office/sprites/spriteCache.js';
import { BUBBLE_PERMISSION_SPRITE } from '../office/sprites/spriteData.js';
import { type Character, CharacterState } from '../office/types.js';
import { type LanAgents, tagBadge, tagText } from './lanAgents.js';
import { stackTags, type TagBox } from './tagStack.js';

/** Text widths for tag stacking, measured once per string (cleared when web fonts finish loading). */
const textWidths = new Map<string, number>();
let measureCtx: CanvasRenderingContext2D | null = null;
document.fonts?.addEventListener('loadingdone', () => textWidths.clear());
function textWidth(text: string, font: string): number {
  const key = `${font}|${text}`;
  let w = textWidths.get(key);
  if (w === undefined) {
    measureCtx ??= document.createElement('canvas').getContext('2d');
    if (!measureCtx) return 0;
    measureCtx.font = font;
    w = measureCtx.measureText(text).width;
    textWidths.set(key, w);
  }
  return w;
}

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
  // Project every tag first, then stack the ones that collide (side-by-side characters).
  const tags: Array<{ a: OfficeAgent; ch: Character; text: string }> = [];
  const boxes: TagBox[] = [];
  for (const a of lan.all()) {
    const id = lan.idFor(a.key);
    const ch = id !== undefined ? officeState.characters.get(id) : undefined;
    if (!ch) continue;
    const text = tagText(a, a.parentKey !== undefined ? byKey.get(a.parentKey) : undefined);
    const badge = tagBadge(a);
    const typing = ch.state === CharacterState.TYPE;
    tags.push({ a, ch, text });
    boxes.push({
      x: project.toScreenX(ch.x),
      y: project.toScreenY(ch.y + (typing ? CHARACTER_SITTING_OFFSET_PX : 0)),
      w:
        LAN_TAG_CHROME_PX +
        textWidth(text, LAN_TAG_FONT) +
        (badge ? LAN_TAG_BADGE_CHROME_PX + textWidth(badge, LAN_TAG_BADGE_FONT) : 0),
    });
  }
  const tops = stackTags(boxes, LAN_TAG_HEIGHT_PX, LAN_TAG_STACK_GAP_PX);
  for (let i = 0; i < tags.length; i++) {
    const { a, ch, text } = tags[i];
    const typing = ch.state === CharacterState.TYPE;
    const x = boxes[i].x;
    const lit = a.peer.id === lan.highlightPeer;
    nodes.push(
      <div
        key={a.key}
        data-agent-key={a.key}
        className={`absolute -translate-x-1/2 flex items-center gap-4 whitespace-nowrap text-sm leading-none px-3 py-1 pointer-events-none ${lit ? 'bg-accent text-on-accent outline-2 outline-accent-bright' : 'bg-bg/75 text-text'}`}
        style={{
          left: x,
          top: tops[i],
          zIndex: lit ? LAN_PERMISSION_Z_INDEX : LAN_TAG_Z_INDEX,
        }}
      >
        <span
          className="w-6 h-6 shrink-0"
          style={{ background: LAN_PROVIDER_COLORS[a.provider] }}
        />
        {text}
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

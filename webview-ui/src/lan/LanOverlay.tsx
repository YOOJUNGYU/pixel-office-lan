import { type MutableRefObject, type RefObject, useEffect, useRef, useState } from 'react';

import type { OfficeAgent } from '../../../core/src/lan.js';
import {
  AVATAR_TAG_HEIGHT_PX,
  BUBBLE_SITTING_OFFSET_PX,
  BUBBLE_VERTICAL_OFFSET_PX,
  CHARACTER_SITTING_OFFSET_PX,
  CHAT_BORDER_PX,
  CHAT_TAIL_PX,
  LAN_ACTIVITY_MAX_WIDTH_PX,
  LAN_ACTIVITY_PAD_X_PX,
  LAN_ACTIVITY_PAD_Y_PX,
  LAN_ALERT_COLOR,
  LAN_BUBBLE_HEAD_OFFSET,
  LAN_BUBBLE_MAX_WIDTH_PX,
  LAN_BUBBLE_Z_INDEX,
  LAN_PERMISSION_Z_INDEX,
  LAN_PROVIDER_BADGE_FG,
  LAN_PROVIDER_COLORS,
  LAN_TAG_BADGE_CHROME_PX,
  LAN_TAG_BADGE_FONT,
  LAN_TAG_FONT,
  LAN_TAG_HEIGHT_PX,
  LAN_TAG_LINE_PX,
  LAN_TAG_PAD_X_PX,
  LAN_TAG_STACK_GAP_PX,
  LAN_TAG_Z_INDEX,
  PET_HEAD_DROP_PX,
} from '../constants.js';
import { actText, t } from '../i18n.js';
import { onFrame } from '../office/engine/gameLoop.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { overlayProjection, renderScale } from '../office/projection.js';
import { getCachedSprite } from '../office/sprites/spriteCache.js';
import { BUBBLE_PERMISSION_SPRITE } from '../office/sprites/spriteData.js';
import { type Character, CharacterState } from '../office/types.js';
import { badgeColors } from './badgeColors.js';
import { stackBubbles } from './chat.js';
import { type AvatarRef, type LanAgents, providerName, tagBadge, tagText } from './lanAgents.js';
import { stackTags, type TagBox } from './tagStack.js';
import { tagVisible } from './tagVisibility.js';
import { textWidth } from './textWidth.js';

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
  /** Agents' name tags hidden (except the hovered/selected character's); avatar tags always show. */
  tagsHidden: boolean;
}

/**
 * Name tags under every LAN character, permission bubbles over waiting ones,
 * and the hover bubble (room, activity, reason) in the viewer's language. Re-rendered after every
 * canvas frame (`onFrame`) so the DOM follows walking sprites; tags are keyed so React only
 * moves them. All text is React text nodes.
 */
export function LanOverlay({
  officeState,
  lan,
  containerRef,
  zoom,
  panRef,
  tagsHidden,
}: LanOverlayProps) {
  // Re-render after every canvas frame (the on-demand schedule), never when idle.
  const [, setTick] = useState(0);
  useEffect(() => onFrame(() => setTick((n) => n + 1)), []);

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
  const tags: Array<{ a: OfficeAgent; ch: Character; text: string; show: boolean }> = [];
  const boxes: TagBox[] = [];
  for (const a of lan.all()) {
    const id = lan.idFor(a.key);
    const ch = id !== undefined ? officeState.characters.get(id) : undefined;
    if (!ch) continue;
    const text = tagText(a, a.parentKey !== undefined ? byKey.get(a.parentKey) : undefined);
    const typing = ch.state === CharacterState.TYPE;
    tags.push({
      a,
      ch,
      text,
      show: tagVisible(tagsHidden, ch.id, officeState.hoveredAgentId, officeState.selectedAgentId),
    });
    boxes.push({
      x: project.toScreenX(ch.x),
      y: project.toScreenY(ch.y + (typing ? CHARACTER_SITTING_OFFSET_PX : 0)),
      w:
        2 * LAN_TAG_PAD_X_PX +
        LAN_TAG_BADGE_CHROME_PX +
        textWidth(tagBadge(a), LAN_TAG_BADGE_FONT) +
        textWidth(text, LAN_TAG_FONT),
    });
  }
  // Avatar tags (one per person): always shown, one line, after the agents' so they stack below.
  const avatarTags: Array<AvatarRef & { box: TagBox }> = [];
  for (const av of lan.avatars()) {
    const ch = officeState.characters.get(av.id);
    if (!ch || ch.matrixEffect === 'despawn') continue;
    if (!tagVisible(tagsHidden, av.id, null, null, true)) continue;
    avatarTags.push({
      ...av,
      box: {
        x: project.toScreenX(ch.x),
        y: project.toScreenY(
          ch.y + (ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0),
        ),
        w: 2 * LAN_TAG_PAD_X_PX + textWidth(av.label, LAN_TAG_FONT),
      },
    });
  }
  // Only visible tags take part in stacking (one line, the same height for both).
  const shown = boxes.map((_, i) => i).filter((i) => tags[i].show);
  const stacked = stackTags(
    [...shown.map((i) => boxes[i]), ...avatarTags.map((v) => v.box)],
    Math.max(LAN_TAG_HEIGHT_PX, AVATAR_TAG_HEIGHT_PX),
    LAN_TAG_STACK_GAP_PX,
  );
  const tops: number[] = [];
  shown.forEach((i, k) => (tops[i] = stacked[k]));
  /** The red "!" above a head (a waiting agent, or an avatar holding one). */
  const alert = (key: string, ch: Character) => {
    const typing = ch.state === CharacterState.TYPE;
    nodes.push(
      <div
        key={key}
        className="absolute -translate-x-1/2 pointer-events-none"
        style={{
          left: project.toScreenX(ch.x),
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
  };
  const waiting = lan.waitingPeers();
  for (const v of avatarTags) {
    const ch = officeState.characters.get(v.id);
    if (ch && waiting.has(v.peerId)) alert(`avatar!:${v.peerId}`, ch);
  }
  avatarTags.forEach((v, k) => {
    const lit = v.peerId === lan.highlightPeer;
    nodes.push(
      <div
        key={`avatar:${v.peerId}`}
        data-avatar-tag={v.self ? 'self' : 'other'}
        className={`absolute -translate-x-1/2 whitespace-nowrap text-sm leading-none px-3 py-1 pointer-events-none ${lit ? 'outline-2 outline-accent-bright' : ''}`}
        style={{
          left: v.box.x,
          top: stacked[shown.length + k],
          background: v.tagColors?.bg ?? 'var(--avatar-tag-bg)',
          color: v.tagColors?.fg ?? 'var(--avatar-tag-fg)',
          border: v.self ? '2px solid var(--avatar-tag-self-border)' : undefined,
          zIndex: lit ? LAN_PERMISSION_Z_INDEX : LAN_TAG_Z_INDEX,
        }}
      >
        {v.label}
      </div>,
    );
  });
  for (let i = 0; i < tags.length; i++) {
    const { a, ch, text } = tags[i];
    const x = boxes[i].x;
    const lit = a.peer.id === lan.highlightPeer;
    if (tags[i].show)
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
            data-badge={a.kind}
            className="shrink-0 px-2 text-2xs font-bold leading-none"
            style={badgeColors(a.kind)}
          >
            {tagBadge(a)}
          </span>
          {text}
        </div>,
      );
    if (a.permission) alert(`${a.key}!`, ch);
  }

  // Tags & bubbles shown: every working agent also has a speech bubble above its head (provider
  // badge + what it does), drawn like the chat bubbles: pixel panel, tail down to the head.
  if (!tagsHidden) {
    const lines: Array<{
      key: string;
      a: OfficeAgent;
      text: string;
      x: number;
      head: number;
      w: number;
      h: number;
      bottom: number;
    }> = [];
    for (const { a, ch } of tags) {
      if (ch.id === officeState.hoveredAgentId || ch.mergeInto !== undefined) continue;
      const text = actText(a.act, a.target);
      const typing = ch.state === CharacterState.TYPE;
      const head = project.toScreenY(
        ch.y +
          (typing ? CHARACTER_SITTING_OFFSET_PX : 0) +
          (ch.pet ? PET_HEAD_DROP_PX : 0) -
          LAN_BUBBLE_HEAD_OFFSET,
      );
      lines.push({
        key: a.key,
        a,
        text,
        x: project.toScreenX(ch.x),
        head,
        w: Math.min(
          LAN_ACTIVITY_MAX_WIDTH_PX,
          2 * (LAN_ACTIVITY_PAD_X_PX + CHAT_BORDER_PX) +
            LAN_TAG_BADGE_CHROME_PX +
            textWidth(providerName(a), LAN_TAG_BADGE_FONT) +
            textWidth(text, LAN_TAG_FONT),
        ),
        h: LAN_TAG_LINE_PX + 2 * (LAN_ACTIVITY_PAD_Y_PX + CHAT_BORDER_PX),
        bottom: head - CHAT_TAIL_PX,
      });
    }
    const bottoms = stackBubbles(lines, LAN_TAG_STACK_GAP_PX);
    lines.forEach((l, k) =>
      nodes.push(
        <div
          key={`act-tail:${l.key}`}
          className="absolute bg-border pointer-events-none"
          style={{
            left: l.x - CHAT_BORDER_PX / 2,
            top: bottoms[k],
            width: CHAT_BORDER_PX,
            height: Math.max(0, l.head - bottoms[k]),
            zIndex: LAN_TAG_Z_INDEX,
          }}
        />,
        <div
          key={`act:${l.key}`}
          data-activity={l.key}
          className="absolute pixel-panel flex items-center gap-4 whitespace-nowrap text-sm leading-none text-text pointer-events-none"
          style={{
            left: l.x - l.w / 2,
            top: bottoms[k] - l.h,
            width: l.w,
            height: l.h,
            padding: `${LAN_ACTIVITY_PAD_Y_PX}px ${LAN_ACTIVITY_PAD_X_PX}px`,
            zIndex: LAN_TAG_Z_INDEX,
          }}
        >
          <span
            data-provider={l.a.provider}
            className="shrink-0 px-2 text-2xs font-bold leading-none"
            style={{ background: LAN_PROVIDER_COLORS[l.a.provider], color: LAN_PROVIDER_BADGE_FG }}
          >
            {providerName(l.a)}
          </span>
          <span className="min-w-0 overflow-hidden text-ellipsis">{l.text}</span>
        </div>,
      ),
    );
  }

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

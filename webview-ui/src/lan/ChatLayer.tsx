import { type MutableRefObject, type RefObject, useEffect, useRef, useState } from 'react';

import { CHAT_MAX_CHARS, takeCodePoints } from '../../../core/src/lan.js';
import {
  CHAT_BAR_BOTTOM_PX,
  CHAT_BAR_WIDTH_PX,
  CHAT_BORDER_PX,
  CHAT_DELETE_GAP_PX,
  CHAT_DELETE_PX,
  CHAT_FONT,
  CHAT_INPUT_Z_INDEX,
  CHAT_LINE_PX,
  CHAT_PAD_X_PX,
  CHAT_PAD_Y_PX,
  CHAT_STACK_GAP_PX,
  CHAT_TAIL_PX,
  CHAT_TEXT_MAX_PX,
  CHAT_Z_INDEX,
  LAN_BUBBLE_HEAD_OFFSET,
  PET_HEAD_DROP_PX,
} from '../constants.js';
import { t } from '../i18n.js';
import { onFrame } from '../office/engine/gameLoop.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { overlayProjection } from '../office/projection.js';
import { type ChatBubbles, stackBubbles, wrapLines } from './chat.js';
import type { LanAgents } from './lanAgents.js';
import { textWidth } from './textWidth.js';

/** IME composition in progress (Korean): Enter there confirms the syllable, not the message. */
const IME_KEYCODE = 229;

interface ChatLayerProps {
  officeState: OfficeState;
  lan: LanAgents;
  chats: ChatBubbles;
  containerRef: RefObject<HTMLDivElement | null>;
  zoom: number;
  panRef: MutableRefObject<{ x: number; y: number }>;
  /** The chat bar is shown (I am in the viewed office; not editing, touring, read-only or on touch). */
  canType: boolean;
  /** Say a line; false = refused (empty, too soon). */
  onSend: (text: string) => boolean;
  /** Delete my bubble. */
  onDelete: () => void;
}

/** The × that deletes my bubble (on the bubble and next to the chat bar). */
function DeleteButton({ onDelete, testId }: { onDelete: () => void; testId: string }) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={t('chat.delete')}
      title={t('chat.delete')}
      className="pointer-events-auto shrink-0 flex items-center justify-center text-sm font-bold text-text-muted hover:text-text hover:bg-btn-hover cursor-pointer"
      style={{ width: CHAT_DELETE_PX, height: CHAT_DELETE_PX, lineHeight: 1 }}
      onClick={onDelete}
    >
      ×
    </button>
  );
}

/**
 * Chat bubbles above each person's avatar (they follow it as it walks, and
 * pan/zoom), and the chat bar at the bottom centre. Enter with nothing
 * focused focuses the bar; Esc leaves it (the arrow keys move the avatar
 * again). Re-rendered after every canvas frame. All text is React text nodes.
 */
export function ChatLayer({
  officeState,
  lan,
  chats,
  containerRef,
  zoom,
  panRef,
  canType,
  onSend,
  onDelete,
}: ChatLayerProps) {
  const [, setTick] = useState(0);
  useEffect(() => onFrame(() => setTick((n) => n + 1)), []);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!canType) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      const el = document.activeElement;
      // Only from the office itself: a focused button/field keeps its own Enter.
      if (el && el !== document.body && el.tagName !== 'CANVAS') return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canType]);

  const el = containerRef.current;
  if (!el) return null;
  const project = overlayProjection(
    officeState.getLayout(),
    el.getBoundingClientRect(),
    zoom,
    panRef.current,
    window.devicePixelRatio || 1,
  );

  const avatarOf = new Map(lan.avatars().map((a) => [a.peerId, a.id] as const));
  const bubbles = chats.active().flatMap((b) => {
    const id = avatarOf.get(b.peerId);
    const ch = id !== undefined ? officeState.characters.get(id) : undefined;
    if (!ch || ch.matrixEffect === 'despawn') return [];
    const lines = wrapLines(b.text, CHAT_TEXT_MAX_PX, (s) => textWidth(s, CHAT_FONT));
    const text = Math.ceil(Math.max(...lines.map((l) => textWidth(l, CHAT_FONT))));
    const inner = text + (b.self ? CHAT_DELETE_GAP_PX + CHAT_DELETE_PX : 0);
    const at = {
      x: project.toScreenX(ch.x),
      y: project.toScreenY(ch.y + (ch.pet ? PET_HEAD_DROP_PX : 0) - LAN_BUBBLE_HEAD_OFFSET),
    };
    return [
      {
        b,
        at,
        box: {
          x: at.x,
          bottom: at.y - CHAT_TAIL_PX,
          w: inner + 2 * (CHAT_PAD_X_PX + CHAT_BORDER_PX),
          h: lines.length * CHAT_LINE_PX + 2 * (CHAT_PAD_Y_PX + CHAT_BORDER_PX),
        },
      },
    ];
  });
  const bottoms = stackBubbles(
    bubbles.map((x) => x.box),
    CHAT_STACK_GAP_PX,
  );

  const nodes = bubbles.map(({ b, at, box }, i) => (
    <div key={`${b.peerId}:${b.id}`} className="pointer-events-none" data-chat-peer={b.peerId}>
      {/* Tail: from the bubble down to the head, however far stacking moved it up. */}
      <div
        className="absolute bg-border"
        style={{
          left: at.x - CHAT_BORDER_PX / 2,
          top: bottoms[i],
          width: CHAT_BORDER_PX,
          height: Math.max(0, at.y - bottoms[i]),
          zIndex: CHAT_Z_INDEX,
        }}
      />
      <div
        className="absolute pixel-panel flex items-start"
        style={{
          left: box.x - box.w / 2,
          top: bottoms[i] - box.h,
          width: box.w,
          padding: `${CHAT_PAD_Y_PX}px ${CHAT_PAD_X_PX}px`,
          gap: CHAT_DELETE_GAP_PX,
          zIndex: CHAT_Z_INDEX,
        }}
      >
        <span
          data-chat-text
          className="flex-1 min-w-0 text-sm text-text"
          style={{ lineHeight: `${CHAT_LINE_PX}px`, overflowWrap: 'anywhere' }}
        >
          {b.text}
        </span>
        {b.self && (
          <span style={{ marginTop: (CHAT_LINE_PX - CHAT_DELETE_PX) / 2 }}>
            <DeleteButton onDelete={onDelete} testId="chat-delete" />
          </span>
        )}
      </div>
    </div>
  ));

  if (canType) {
    const send = () => {
      if (onSend(draft)) setDraft('');
    };
    nodes.push(
      <div
        key="chat-bar"
        data-tour="chat-bar"
        className="absolute left-1/2 -translate-x-1/2 flex items-center gap-4 max-w-[calc(100%-20px)]"
        style={{ bottom: CHAT_BAR_BOTTOM_PX, width: CHAT_BAR_WIDTH_PX, zIndex: CHAT_INPUT_Z_INDEX }}
      >
        <input
          ref={inputRef}
          data-testid="chat-input"
          aria-label={t('chat.label')}
          className="pixel-panel flex-1 min-w-0 text-sm text-text px-8 py-4 outline-none"
          placeholder={t('chat.placeholder')}
          value={draft}
          onChange={(e) => setDraft(takeCodePoints(e.target.value, CHAT_MAX_CHARS))}
          onKeyDown={(e) => {
            e.stopPropagation(); // never reaches the editor/tour shortcuts or the avatar keys
            if (e.nativeEvent.isComposing || e.keyCode === IME_KEYCODE) return;
            if (e.key === 'Enter') send();
            else if (e.key === 'Escape') e.currentTarget.blur();
          }}
        />
        {chats.mine() && (
          <span className="pixel-panel flex items-center p-4">
            <DeleteButton onDelete={onDelete} testId="chat-bar-delete" />
          </span>
        )}
      </div>,
    );
  }
  return <>{nodes}</>;
}

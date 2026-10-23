import { type MutableRefObject, type RefObject, useEffect, useRef, useState } from 'react';

import { CHAT_MAX_CHARS, takeCodePoints } from '../../../core/src/lan.js';
import {
  CHAT_BORDER_PX,
  CHAT_DELETE_GAP_PX,
  CHAT_DELETE_PX,
  CHAT_DOT_PX,
  CHAT_FONT,
  CHAT_INPUT_WIDTH_PX,
  CHAT_INPUT_Z_INDEX,
  CHAT_LABEL_FONT,
  CHAT_LABEL_LINE_PX,
  CHAT_LINE_PX,
  CHAT_PAD_X_PX,
  CHAT_PAD_Y_PX,
  CHAT_STACK_GAP_PX,
  CHAT_TAIL_PX,
  CHAT_TEXT_MAX_PX,
  CHAT_Z_INDEX,
} from '../constants.js';
import { t } from '../i18n.js';
import { onFrame } from '../office/engine/gameLoop.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { overlayProjection } from '../office/projection.js';
import { TILE_SIZE } from '../office/types.js';
import { type ChatBubbles, isTextEntry, pointerTile, stackBubbles, wrapLines } from './chat.js';
import { textWidth } from './textWidth.js';

/** IME composition in progress (Korean): Enter there confirms the syllable, not the message. */
const IME_KEYCODE = 229;

interface ChatLayerProps {
  officeState: OfficeState;
  chats: ChatBubbles;
  containerRef: RefObject<HTMLDivElement | null>;
  zoom: number;
  panRef: MutableRefObject<{ x: number; y: number }>;
  /** "/" opens the input (not while editing, touring, read-only or on touch). */
  canType: boolean;
  /** Send a line said at (col, row); false = refused (empty, too soon). */
  onSend: (text: string, col: number, row: number) => boolean;
  /** Delete my bubble. */
  onDelete: () => void;
}

/**
 * Chat bubbles pinned to world tile spots (they follow pan/zoom), and the "/"
 * input opened at the mouse pointer. Re-rendered after every canvas frame. All
 * text is React text nodes.
 */
export function ChatLayer({
  officeState,
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
  const [draft, setDraft] = useState<{ col: number; row: number; text: string } | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const onMove = (e: PointerEvent) => (pointer.current = { x: e.clientX, y: e.clientY });
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  useEffect(() => {
    if (!canType) {
      setDraft(null);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      if (isTextEntry(document.activeElement)) return;
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const at = pointer.current ?? {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
      e.preventDefault();
      const layout = officeState.getLayout();
      const p = overlayProjection(layout, rect, zoom, panRef.current, window.devicePixelRatio || 1);
      setDraft({ ...pointerTile(p, at.x - rect.left, at.y - rect.top, layout), text: '' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canType, containerRef, officeState, zoom, panRef]);

  const el = containerRef.current;
  if (!el) return null;
  const layout = officeState.getLayout();
  const project = overlayProjection(
    layout,
    el.getBoundingClientRect(),
    zoom,
    panRef.current,
    window.devicePixelRatio || 1,
  );
  // A spot outside this PC's (smaller) grid is shown at its edge.
  const spot = (col: number, row: number) => ({
    x: project.toScreenX(Math.min(col, layout.cols) * TILE_SIZE),
    y: project.toScreenY(Math.min(row, layout.rows) * TILE_SIZE),
  });

  const bubbles = chats.active().map((b) => {
    const lines = wrapLines(b.text, CHAT_TEXT_MAX_PX, (s) => textWidth(s, CHAT_FONT));
    const head =
      textWidth(b.label, CHAT_LABEL_FONT) + (b.self ? CHAT_DELETE_GAP_PX + CHAT_DELETE_PX : 0);
    const inner = Math.min(
      CHAT_TEXT_MAX_PX,
      Math.ceil(Math.max(head, ...lines.map((l) => textWidth(l, CHAT_FONT)))),
    );
    const at = spot(b.col, b.row);
    return {
      b,
      at,
      box: {
        x: at.x,
        bottom: at.y - CHAT_TAIL_PX,
        w: inner + 2 * (CHAT_PAD_X_PX + CHAT_BORDER_PX),
        h: CHAT_LABEL_LINE_PX + lines.length * CHAT_LINE_PX + 2 * (CHAT_PAD_Y_PX + CHAT_BORDER_PX),
      },
    };
  });
  const bottoms = stackBubbles(
    bubbles.map((x) => x.box),
    CHAT_STACK_GAP_PX,
  );

  const nodes = bubbles.map(({ b, at, box }, i) => (
    <div key={`${b.peerId}:${b.id}`} className="pointer-events-none" data-chat-peer={b.peerId}>
      {/* Tail: from the bubble down to the spot, however far stacking moved it up. */}
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
        className="absolute bg-border"
        style={{
          left: at.x - CHAT_DOT_PX / 2,
          top: at.y - CHAT_DOT_PX / 2,
          width: CHAT_DOT_PX,
          height: CHAT_DOT_PX,
          zIndex: CHAT_Z_INDEX,
        }}
      />
      <div
        className="absolute pixel-panel flex flex-col"
        style={{
          left: box.x - box.w / 2,
          top: bottoms[i] - box.h,
          width: box.w,
          padding: `${CHAT_PAD_Y_PX}px ${CHAT_PAD_X_PX}px`,
          zIndex: CHAT_Z_INDEX,
        }}
      >
        <div className="flex items-start">
          <span
            className="flex-1 min-w-0 text-2xs font-bold text-text-muted truncate"
            style={{ lineHeight: `${CHAT_LABEL_LINE_PX}px` }}
          >
            {b.label}
          </span>
          {b.self && (
            <button
              type="button"
              data-testid="chat-delete"
              aria-label={t('chat.delete')}
              title={t('chat.delete')}
              className="pointer-events-auto shrink-0 flex items-center justify-center text-sm font-bold text-text-muted hover:text-text hover:bg-btn-hover cursor-pointer"
              style={{
                width: CHAT_DELETE_PX,
                height: CHAT_DELETE_PX,
                marginLeft: CHAT_DELETE_GAP_PX,
                marginTop: (CHAT_LABEL_LINE_PX - CHAT_DELETE_PX) / 2,
                marginBottom: (CHAT_LABEL_LINE_PX - CHAT_DELETE_PX) / 2,
                lineHeight: 1,
              }}
              onClick={onDelete}
            >
              ×
            </button>
          )}
        </div>
        <span
          data-chat-text
          className="text-sm text-text"
          style={{ lineHeight: `${CHAT_LINE_PX}px`, overflowWrap: 'anywhere' }}
        >
          {b.text}
        </span>
      </div>
    </div>
  ));

  if (draft) {
    const at = spot(draft.col, draft.row);
    const send = () => {
      if (onSend(draft.text, draft.col, draft.row)) setDraft(null);
    };
    nodes.push(
      <input
        key="chat-input"
        data-testid="chat-input"
        aria-label={t('chat.label')}
        autoFocus
        className="absolute pixel-panel text-sm text-text px-6 py-3 outline-none"
        style={{
          left: at.x,
          top: at.y,
          width: CHAT_INPUT_WIDTH_PX,
          zIndex: CHAT_INPUT_Z_INDEX,
        }}
        placeholder={t('chat.placeholder')}
        value={draft.text}
        onChange={(e) =>
          setDraft({ ...draft, text: takeCodePoints(e.target.value, CHAT_MAX_CHARS) })
        }
        onKeyDown={(e) => {
          e.stopPropagation(); // never reaches the editor/tour shortcuts
          if (e.nativeEvent.isComposing || e.keyCode === IME_KEYCODE) return;
          if (e.key === 'Enter') send();
          else if (e.key === 'Escape') setDraft(null);
        }}
        onBlur={() => setDraft(null)}
      />,
    );
  }
  return <>{nodes}</>;
}

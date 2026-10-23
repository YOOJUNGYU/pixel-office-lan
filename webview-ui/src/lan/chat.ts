// Chat bubbles pinned to map spots: who said what where, for how long. Pure
// except for the expiry timer, which asks the canvas for a frame.
import {
  CHAT_MIN_INTERVAL_MS,
  CHAT_SHOW_MS,
  chatCoord,
  cleanChatText,
  MAX_LAYOUT_COLS,
  MAX_LAYOUT_ROWS,
} from '../../../core/src/lan.js';
import type { OfficePersonMessage } from '../../../core/src/messages.js';
import { requestRender } from '../office/engine/gameLoop.js';
import type { OverlayProjection } from '../office/projection.js';
import { TILE_SIZE } from '../office/types.js';
import { peerLabel } from './nicknames.js';

export interface Bubble {
  peerId: string;
  /** The server's chat id; '' = my local echo, not yet in a snapshot. */
  id: string;
  text: string;
  /** Sender label, `account (nickname)`. */
  label: string;
  /** World tile coordinates (floats). */
  col: number;
  row: number;
  /** Shown until this time (ms epoch, this browser's clock). */
  until: number;
}

const LOCAL = '';

/**
 * One bubble per sender. A snapshot's (sender, id) is shown once, for the time
 * the server says is left (≤ CHAT_SHOW_MS) from its first arrival; later
 * snapshots never extend it. My own line shows at once (say) and is matched to
 * the server's id when it comes back.
 */
export class ChatBubbles {
  private by = new Map<string, Bubble>();
  private lastSaid = -Infinity;
  private timer: ReturnType<typeof setTimeout> | null = null;

  apply(people: readonly OfficePersonMessage[], now: number): void {
    const next = new Map<string, Bubble>();
    for (const p of people) {
      const prev = this.by.get(p.peerId);
      const c = p.chat;
      const label = peerLabel(p);
      if (prev?.id === LOCAL && p.self) {
        // My echo: keep it until the server's copy (same text) takes over its timer.
        const text = c ? cleanChatText(c.text) : null;
        if (c && text === prev.text) next.set(p.peerId, { ...prev, id: c.id, label });
        else if (prev.until > now) next.set(p.peerId, prev);
        continue;
      }
      if (!c) continue;
      if (prev?.id === c.id) {
        next.set(p.peerId, { ...prev, label });
        continue;
      }
      const text = cleanChatText(c.text);
      const col = chatCoord(c.col, MAX_LAYOUT_COLS - 1);
      const row = chatCoord(c.row, MAX_LAYOUT_ROWS - 1);
      if (text === null || col === null || row === null) continue;
      const left = Math.min(Math.max(Number(c.left) || 0, 0), CHAT_SHOW_MS);
      next.set(p.peerId, { peerId: p.peerId, id: c.id, text, label, col, row, until: now + left });
    }
    this.by = next;
    this.schedule(now);
  }

  /** My own line, shown at once; the cleaned text, or null = empty or less than 2 s since the last. */
  say(
    me: OfficePersonMessage,
    rawText: string,
    col: number,
    row: number,
    now: number,
  ): string | null {
    const text = cleanChatText(rawText);
    if (text === null || now - this.lastSaid < CHAT_MIN_INTERVAL_MS) return null;
    this.lastSaid = now;
    this.by.set(me.peerId, {
      peerId: me.peerId,
      id: LOCAL,
      text,
      label: peerLabel(me),
      col,
      row,
      until: now + CHAT_SHOW_MS,
    });
    this.schedule(now);
    requestRender('chat');
    return text;
  }

  active(now = Date.now()): Bubble[] {
    return [...this.by.values()].filter((b) => b.until > now);
  }

  /** One timer at the next expiry: the bubble disappears on time even on an idle canvas. */
  private schedule(now: number): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    const next = Math.min(...this.active(now).map((b) => b.until));
    if (!Number.isFinite(next)) return;
    this.timer = setTimeout(
      () => {
        this.timer = null;
        requestRender('chat');
        this.schedule(Date.now());
      },
      next - now + 1,
    );
  }
}

/** The tile under a container point (CSS px), clamped to the layout grid. */
export function pointerTile(
  p: OverlayProjection,
  x: number,
  y: number,
  layout: { cols: number; rows: number },
): { col: number; row: number } {
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);
  return {
    col: clamp(p.toWorldX(x) / TILE_SIZE, layout.cols),
    row: clamp(p.toWorldY(y) / TILE_SIZE, layout.rows),
  };
}

/** Lines `text` wraps into at `max` px: greedy by words, an over-long word broken anywhere
 *  (CSS `overflow-wrap: anywhere`). */
export function wrapLines(text: string, max: number, measure: (s: string) => number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const tryLine = line ? `${line} ${word}` : word;
    if (measure(tryLine) <= max) {
      line = tryLine;
      continue;
    }
    if (line) lines.push(line);
    line = '';
    for (const ch of Array.from(word)) {
      if (line && measure(line + ch) > max) {
        lines.push(line);
        line = '';
      }
      line += ch;
    }
  }
  if (line || lines.length === 0) lines.push(line);
  return lines;
}

/** A bubble on screen: centre x, the bottom it wants (CSS px), size. */
export interface BubbleBox {
  x: number;
  bottom: number;
  w: number;
  h: number;
}

/**
 * Bottoms so no two bubbles overlap: lowest first, each later one moves up
 * above every placed bubble it hits (`gap` apart).
 * ponytail: O(n²) per frame, fine for a handful of live chats.
 */
export function stackBubbles(boxes: readonly BubbleBox[], gap: number): number[] {
  const order = boxes.map((_, i) => i).sort((a, b) => boxes[b].bottom - boxes[a].bottom);
  const out = boxes.map((b) => b.bottom);
  const placed: Array<{ l: number; r: number; top: number; bottom: number }> = [];
  for (const i of order) {
    const b = boxes[i];
    const l = b.x - b.w / 2;
    const r = b.x + b.w / 2;
    let bottom = b.bottom;
    for (let moved = true; moved;) {
      moved = false;
      for (const p of placed) {
        if (p.l < r && l < p.r && p.top - gap < bottom && bottom - b.h < p.bottom + gap) {
          bottom = p.top - gap;
          moved = true;
        }
      }
    }
    out[i] = bottom;
    placed.push({ l, r, top: bottom - b.h, bottom });
  }
  return out;
}

/** Focus is in something that takes typing (then "/" is just a character). */
export const isTextEntry = (el: { tagName: string; isContentEditable?: boolean } | null): boolean =>
  !!el &&
  (el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable === true);

// Chat bubbles above each person's avatar: one per person, from the office snapshot. Pure.
import { CHAT_MIN_INTERVAL_MS, cleanChatText } from '../../../core/src/lan.js';
import type { OfficePersonMessage } from '../../../core/src/messages.js';

export interface Bubble {
  peerId: string;
  /** The sender's chat id: a new id = a new bubble. */
  id: string;
  text: string;
  /** My own bubble (gets the delete button). */
  self: boolean;
}

/**
 * The bubbles of the viewed office = the latest snapshot's `people[].chat`
 * (a person without one, or gone, has none). No local echo: the server answers
 * sendChat/deleteChat with a fresh snapshot at once.
 */
export class ChatBubbles {
  private list: Bubble[] = [];
  private lastSaid = -Infinity;

  apply(people: readonly OfficePersonMessage[]): void {
    const next: Bubble[] = [];
    for (const p of people) {
      const c = p.chat;
      if (!c) continue;
      const text = cleanChatText(c.text);
      if (text === null || typeof c.id !== 'string') continue;
      next.push({ peerId: p.peerId, id: c.id, text, self: p.self });
    }
    this.list = next;
  }

  /** The cleaned text to send, or null = empty or less than 2 s since the last. */
  say(rawText: string, now: number): string | null {
    const text = cleanChatText(rawText);
    if (text === null || now - this.lastSaid < CHAT_MIN_INTERVAL_MS) return null;
    this.lastSaid = now;
    return text;
  }

  active(): Bubble[] {
    return this.list;
  }

  /** My current bubble, if any. */
  mine(): Bubble | undefined {
    return this.list.find((b) => b.self);
  }
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

/** Focus is in something that takes typing (then arrows/Enter are the field's). */
export const isTextEntry = (el: { tagName: string; isContentEditable?: boolean } | null): boolean =>
  !!el &&
  (el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable === true);

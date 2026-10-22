/** A name tag on screen: horizontal centre, top, width (CSS px). */
export interface TagBox {
  x: number;
  y: number;
  w: number;
}

/**
 * Tops for `tags` so none overlap: sweep in (y, x) order and push each tag
 * below every earlier-placed tag it collides with (`h` = tag height, `gap`
 * between stacked tags). Sort O(n log n); each tag is checked only against
 * placed tags whose bottom still reaches it.
 */
export function stackTags(tags: readonly TagBox[], h: number, gap: number): number[] {
  const order = tags
    .map((_, i) => i)
    .sort((a, b) => tags[a].y - tags[b].y || tags[a].x - tags[b].x);
  const tops = tags.map((t) => t.y);
  let active: Array<{ l: number; r: number; top: number }> = [];
  for (const i of order) {
    const t = tags[i];
    const l = t.x - t.w / 2;
    const r = t.x + t.w / 2;
    // Placed tags ending above this one's original top can never collide again (tops only grow).
    active = active.filter((a) => a.top + h + gap > t.y);
    // `active` is sorted by top, and y only grows: one pass meets every collider in order.
    let y = t.y;
    for (const a of active) {
      if (a.l < r && l < a.r && a.top < y + h && y < a.top + h + gap) y = a.top + h + gap;
    }
    tops[i] = y;
    let at = active.length;
    while (at > 0 && active[at - 1].top > y) at--;
    active.splice(at, 0, { l, r, top: y });
  }
  return tops;
}

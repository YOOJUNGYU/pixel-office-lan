// Shared (public + team) office layouts: one per channel, the newest version wins on every PC.
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';

import type { LayoutRev } from '../../../core/src/lan.js';
import { DEFAULT_LAYOUT_REV, LAYOUT_HASH_HEX, newerLayout } from '../../../core/src/lan.js';
import { LAYOUT_FILE_DIR, SHARED_LAYOUT_FILE_NAME } from '../constants.js';

interface Entry {
  rev: LayoutRev;
  layout: Record<string, unknown>;
  /** Deflated layout JSON, as sent to peers. */
  blob: Buffer;
}

export const layoutHash = (text: string): string =>
  createHash('sha256').update(text).digest('hex').slice(0, LAYOUT_HASH_HEX);

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

/**
 * The shared layouts this PC knows, persisted in ~/.pixel-office/layout-shared.json
 * (atomic). Layouts are checked by `check` (sanitizeLayout against the bundled
 * default) before they are stored, whether they come from this PC or a peer.
 */
export class SharedLayouts {
  private readonly entries = new Map<string, Entry>();
  private readonly file: string;

  constructor(dir = path.join(os.homedir(), LAYOUT_FILE_DIR)) {
    this.file = path.join(dir, SHARED_LAYOUT_FILE_NAME);
    try {
      if (!fs.existsSync(this.file)) return;
      const raw: unknown = JSON.parse(fs.readFileSync(this.file, 'utf-8'));
      const channels = isObj(raw) && isObj(raw.channels) ? raw.channels : {};
      for (const [channel, e] of Object.entries(channels)) {
        if (!isObj(e) || !isObj(e.layout) || !Number.isSafeInteger(e.rev)) continue;
        if ((e.rev as number) < 1 || typeof e.by !== 'string' || !e.by) continue;
        this.put(channel, e.rev as number, e.by, e.layout);
      }
    } catch (err) {
      console.error('[Pixel Office] Failed to read shared layouts:', err);
    }
  }

  rev(channel: string): LayoutRev {
    return this.entries.get(channel)?.rev ?? DEFAULT_LAYOUT_REV;
  }

  layout(channel: string): Record<string, unknown> | null {
    return this.entries.get(channel)?.layout ?? null;
  }

  blob(channel: string): Buffer | null {
    return this.entries.get(channel)?.blob ?? null;
  }

  /** Store `layout` as (rev, by) when that is newer than what this PC has. True = stored. */
  offer(channel: string, rev: number, by: string, layout: Record<string, unknown>): boolean {
    if (!newerLayout({ rev, by, h: '' }, this.rev(channel))) return false;
    this.put(channel, rev, by, layout);
    this.write();
    return true;
  }

  private put(channel: string, rev: number, by: string, layout: Record<string, unknown>): void {
    const text = JSON.stringify(layout);
    this.entries.set(channel, {
      rev: { rev, by, h: layoutHash(text) },
      layout,
      blob: zlib.deflateSync(text),
    });
  }

  private write(): void {
    const channels = Object.fromEntries(
      [...this.entries].map(([ch, e]) => [ch, { rev: e.rev.rev, by: e.rev.by, layout: e.layout }]),
    );
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ channels }), 'utf-8');
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('[Pixel Office] Failed to write shared layouts:', err);
    }
  }
}

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { Room, RoomAreasLayout } from '../../core/src/lan.js';
import {
  fillMissingRooms,
  isLayoutGrid,
  normalizeRoomAreas,
  ROOM_LABELS,
  ROOM_ORDER,
} from '../../core/src/lan.js';
import { LAYOUT_FILE_DIR, LAYOUT_FILE_NAME } from './constants.js';

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

/** Room colors of a layout (the bundled default), for rooms another layout lacks. */
export function roomColorsOf(layout: unknown): Partial<Record<Room, string>> {
  const out: Partial<Record<Room, string>> = {};
  const areas = isObj(layout) && Array.isArray(layout.areas) ? layout.areas : [];
  for (const r of ROOM_ORDER) {
    const a: unknown = areas.find((x: unknown) => isObj(x) && x.label === ROOM_LABELS[r]);
    if (isObj(a) && typeof a.color === 'string') out[r] = a.color;
  }
  return out;
}

/**
 * A layout fit to store or serve: a v1 grid within MAX_LAYOUT_COLS×ROWS whose
 * tiles match it, with exactly the four fixed rooms (normalizeRoomAreas; a room
 * without tiles takes the default layout's when the grid is the default size)
 * and no decorative pets. Null for anything else. Never throws.
 */
export function sanitizeLayout(
  raw: unknown,
  colors: Partial<Record<Room, string>>,
  defaultLayout: unknown = null,
): Record<string, unknown> | null {
  if (!isLayoutGrid(raw)) return null;
  // normalizeRoomAreas checks every areas/areaTiles entry itself.
  const out: Record<string, unknown> = fillMissingRooms(
    normalizeRoomAreas(raw as RoomAreasLayout & Record<string, unknown>, colors),
    defaultLayout,
  );
  delete out.pets;
  return out;
}

function getLayoutFilePath(): string {
  return path.join(os.homedir(), LAYOUT_FILE_DIR, LAYOUT_FILE_NAME);
}

export function readLayoutFromFile(): Record<string, unknown> | null {
  const filePath = getLayoutFilePath();
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    console.error('[Pixel Office] Failed to read layout file:', err);
    return null;
  }
}

/** Atomic write; false when it failed (logged). */
export function writeLayoutToFile(layout: Record<string, unknown>): boolean {
  const filePath = getLayoutFilePath();
  const dir = path.dirname(filePath);
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const json = JSON.stringify(layout, null, 2);
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, json, 'utf-8');
    fs.renameSync(tmpPath, filePath);
    return true;
  } catch (err) {
    console.error('[Pixel Office] Failed to write layout file:', err);
    return false;
  }
}

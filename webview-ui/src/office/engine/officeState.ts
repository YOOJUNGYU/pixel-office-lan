import { ROOM_LABELS, ROOM_ORDER } from '../../../../core/src/lan.js';
import { pickDiversePalette } from '../../../../core/src/paletteUtils.js';
import {
  AUTO_ON_FACING_DEPTH,
  AUTO_ON_SIDE_DEPTH,
  CHARACTER_HIT_HALF_WIDTH,
  CHARACTER_HIT_HEIGHT,
  CHARACTER_SITTING_OFFSET_PX,
  DISMISS_BUBBLE_FAST_FADE_SEC,
  FOLLOW_RETRY_SEC,
  FURNITURE_ANIM_INTERVAL_SEC,
  GREETER_ID,
  GREETER_TILE_MARGIN,
  INACTIVE_SEAT_TIMER_MIN_SEC,
  INACTIVE_SEAT_TIMER_RANGE_SEC,
  WAITING_BUBBLE_DURATION_SEC,
} from '../../constants.js';
import { getAnimationFrames, getCatalogEntry, getOnStateType } from '../layout/furnitureCatalog.js';
import {
  createDefaultLayout,
  getBlockedTiles,
  layoutToFurnitureInstances,
  layoutToSeats,
  layoutToTileMap,
} from '../layout/layoutSerializer.js';
import { findPath, getWalkableTiles, isWalkable } from '../layout/tileMap.js';
import { getLoadedCharacterCount } from '../sprites/spriteData.js';
import type {
  Character,
  FurnitureInstance,
  OfficeLayout,
  PlacedFurniture,
  Seat,
  TileType as TileTypeVal,
} from '../types.js';
import { CharacterState, Direction, TILE_SIZE } from '../types.js';
import { createCharacter, updateCharacter } from './characters.js';
import { advanceMatrixEffect, startMatrixEffect } from './matrixEffectState.js';
import { anchorTile, closestFreeSeat } from './seatPlacement.js';

/** Internal helper: facing-tile coords for a seat. Returns null for invalid direction. */
function seatFacingOffset(direction: Direction): { dCol: number; dRow: number } {
  if (direction === Direction.RIGHT) return { dCol: 1, dRow: 0 };
  if (direction === Direction.LEFT) return { dCol: -1, dRow: 0 };
  if (direction === Direction.DOWN) return { dCol: 0, dRow: 1 };
  return { dCol: 0, dRow: -1 };
}

export class OfficeState {
  layout: OfficeLayout;
  tileMap: TileTypeVal[][];
  seats: Map<string, Seat>;
  blockedTiles: Set<string>;
  furniture: FurnitureInstance[];
  walkableTiles: Array<{ col: number; row: number }>;
  /** Walkable tiles per area label (rooms confine seats, floor spots and wander). */
  areaWalkable: Map<string, Array<{ col: number; row: number }>> = new Map();
  characters: Map<number, Character> = new Map();
  /** Accumulated time for furniture animation frame cycling */
  furnitureAnimTimer = 0;
  private _selectedAgentId: number | null = null;
  private readonly selectionListeners = new Set<(id: number | null) => void>();
  get selectedAgentId(): number | null {
    return this._selectedAgentId;
  }
  set selectedAgentId(id: number | null) {
    if (this._selectedAgentId === id) return;
    this._selectedAgentId = id;
    for (const listener of this.selectionListeners) listener(id);
  }
  /** Observe selectedAgentId changes. React (the card bars) subscribes so
   *  imperative canvas selection can drive card highlights — everything else
   *  about selection stays out of React state. Returns the unsubscribe. */
  subscribeSelection(listener: (id: number | null) => void): () => void {
    this.selectionListeners.add(listener);
    return () => this.selectionListeners.delete(listener);
  }
  cameraFollowId: number | null = null;
  hoveredAgentId: number | null = null;
  hoveredTile: { col: number; row: number } | null = null;
  /** Maps "parentId:toolId" → sub-agent character ID (negative) */
  subagentIdMap: Map<string, number> = new Map();
  /** Reverse lookup: sub-agent character ID → parent info */
  subagentMeta: Map<number, { parentAgentId: number; parentToolId: string }> = new Map();
  private nextSubagentId = -1;

  /**
   * The first-run consent greeter, deliberately NOT in `characters`.
   *
   * `characters` means "agents": everything that iterates it — seat
   * assignment, palette diversity, the wander FSM, hit-testing, the seat
   * payload the webview persists — is asking an agent question the greeter has
   * no answer to. Holding it here instead of tagging it with a flag makes
   * every one of those loops correct by default, rather than correct as long
   * as each remembers an `isGreeter` guard. It is drawn because
   * `getCharacters()` appends it, and that is the only place it joins the
   * others.
   */
  greeter: Character | null = null;

  /** World-space point the camera drifts to while the greeter is up
   *  (the bubble overlay recomputes it every frame: the combined center of the
   *  character and its speech bubble). An explicit cameraFollowId outranks it. */
  greeterCameraTarget: { x: number; y: number } | null = null;
  /** Latched by a manual pan during the ask: the user took the camera, so the
   *  overlay's per-frame updates stop re-centering. Reset on spawn/despawn. */
  private greeterCameraCancelled = false;

  constructor(layout?: OfficeLayout) {
    this.layout = layout || createDefaultLayout();
    this.tileMap = layoutToTileMap(this.layout);
    this.seats = layoutToSeats(this.layout.furniture);
    this.blockedTiles = getBlockedTiles(this.layout.furniture);
    this.furniture = layoutToFurnitureInstances(this.layout.furniture);
    this.walkableTiles = getWalkableTiles(this.tileMap, this.blockedTiles);
    this.indexAreaTiles();
  }

  /** Rebuild all derived state from a new layout (every editor edit). Characters
   *  stay where they are: walkers keep their destination, sitters their seat;
   *  only those whose tile or seat the edit took away move — nearby, on foot.
   *  @param shift Optional tile shift to apply when grid expands left/up */
  rebuildFromLayout(layout: OfficeLayout, shift?: { col: number; row: number }): void {
    const oldSeats = this.seats;
    this.layout = layout;
    this.tileMap = layoutToTileMap(layout);
    this.seats = layoutToSeats(layout.furniture);
    this.blockedTiles = getBlockedTiles(layout.furniture);
    this.rebuildFurnitureInstances();
    this.walkableTiles = getWalkableTiles(this.tileMap, this.blockedTiles);
    this.indexAreaTiles();

    const dc = shift?.col ?? 0;
    const dr = shift?.row ?? 0;
    // Shift positions (and paths) when the grid expands left/up
    for (const e of this.characters.values()) {
      e.tileCol += dc;
      e.tileRow += dr;
      e.x += dc * TILE_SIZE;
      e.y += dr * TILE_SIZE;
      e.path = e.path.map((t) => ({ col: t.col + dc, row: t.row + dr }));
    }

    // Where each character was headed before the edit: its seat (sitting or
    // walking there), else the end of its path, else nowhere.
    const toSeat = new Map<Character, boolean>();
    for (const ch of this.characters.values()) {
      const old = ch.seatId ? oldSeats.get(ch.seatId) : undefined;
      const end = ch.path[ch.path.length - 1];
      toSeat.set(
        ch,
        !!old &&
          (end
            ? end.col === old.seatCol + dc && end.row === old.seatRow + dr
            : ch.state === CharacterState.TYPE),
      );
    }

    // Keep seat claims; a character whose seat is gone loses it
    for (const seat of this.seats.values()) seat.assigned = false;
    const seatless: Character[] = [];
    for (const ch of this.characters.values()) {
      if (!ch.seatId) continue;
      const seat = this.seats.get(ch.seatId);
      if (seat && !seat.assigned) {
        seat.assigned = true;
      } else {
        ch.seatId = null;
        seatless.push(ch);
      }
    }

    for (const ch of this.characters.values()) {
      const end = ch.path[ch.path.length - 1];
      this.unstrand(ch);
      if (seatless.includes(ch)) {
        if (ch.homeArea) {
          this.moveToArea(ch.id, ch.homeArea);
          continue;
        }
        if (toSeat.get(ch)) {
          const seatId = this.findFreeSeat();
          if (seatId) {
            this.seats.get(seatId)!.assigned = true;
            ch.seatId = seatId;
          }
        }
      }
      const seat = ch.seatId && toSeat.get(ch) ? this.seats.get(ch.seatId) : undefined;
      const dest = seat ? { col: seat.seatCol, row: seat.seatRow } : end;
      if (!dest) continue; // standing or sitting without a seat: stays put
      const last = ch.path[ch.path.length - 1] ?? { col: ch.tileCol, row: ch.tileRow };
      const pathOk = this.withOwnSeatUnblocked(ch, () =>
        ch.path.every((t) => isWalkable(t.col, t.row, this.tileMap, this.blockedTiles)),
      );
      if (last.col === dest.col && last.row === dest.row && pathOk) continue;
      this.walkTo(ch, dest);
      if (ch.path.length > 0) {
        if (ch.state !== CharacterState.WALK) {
          ch.state = CharacterState.WALK;
          ch.frame = 0;
          ch.frameTimer = 0;
        }
      } else if (seat && ch.tileCol === seat.seatCol && ch.tileRow === seat.seatRow) {
        ch.state = CharacterState.TYPE;
        ch.dir = seat.facingDir;
      } else if (ch.state === CharacterState.WALK) {
        ch.state = CharacterState.IDLE;
      }
    }
  }

  /** A character on a tile the edit took away (blocked, wall, erased, outside
   *  the grid) steps to the closest open tile, in its room when it has one. */
  private unstrand(ch: Character): void {
    const ok = this.withOwnSeatUnblocked(ch, () =>
      isWalkable(ch.tileCol, ch.tileRow, this.tileMap, this.blockedTiles),
    );
    if (ok) return;
    const inGrid =
      ch.tileCol >= 0 &&
      ch.tileCol < this.layout.cols &&
      ch.tileRow >= 0 &&
      ch.tileRow < this.layout.rows;
    const area = (inGrid ? this.areaAt(ch.tileCol, ch.tileRow) : null) ?? ch.homeArea;
    const inArea = area ? this.areaWalkable.get(area) : undefined;
    const spot =
      (inArea && this.closestFreeWalkableTile(ch.tileCol, ch.tileRow, ch, inArea)) ||
      this.closestFreeWalkableTile(ch.tileCol, ch.tileRow, ch);
    if (spot) this.placeAt(ch, spot);
  }

  /** Path `ch` to `dest` from where it stands, finishing a step already under way. */
  private walkTo(ch: Character, dest: { col: number; row: number }): void {
    const next = ch.moveProgress > 0 ? ch.path[0] : undefined;
    this.withOwnSeatUnblocked(ch, () => {
      const step =
        next && isWalkable(next.col, next.row, this.tileMap, this.blockedTiles) ? next : null;
      const from = step ?? { col: ch.tileCol, row: ch.tileRow };
      const rest = findPath(
        from.col,
        from.row,
        dest.col,
        dest.row,
        this.tileMap,
        this.blockedTiles,
      );
      ch.path = step ? [step, ...rest] : rest;
      if (!step) ch.moveProgress = 0;
    });
  }

  private indexAreaTiles(): void {
    this.areaWalkable = new Map();
    const labels = this.layout.areaTiles;
    if (!labels) return;
    for (const t of this.walkableTiles) {
      const label = labels[t.row * this.layout.cols + t.col];
      if (!label) continue;
      let list = this.areaWalkable.get(label);
      if (!list) this.areaWalkable.set(label, (list = []));
      list.push(t);
    }
  }

  getLayout(): OfficeLayout {
    return this.layout;
  }

  /** Labels of the four rooms with no walkable tile: agents sent there sit anywhere. */
  emptyRooms(): string[] {
    return ROOM_ORDER.map((r) => ROOM_LABELS[r]).filter((l) => !this.areaWalkable.get(l)?.length);
  }

  /** Get the blocked-tile key for a character's own seat, or null */
  private ownSeatKey(ch: Character): string | null {
    if (!ch.seatId) return null;
    const seat = this.seats.get(ch.seatId);
    if (!seat) return null;
    return `${seat.seatCol},${seat.seatRow}`;
  }

  /** Temporarily unblock a character's own seat, run fn, then re-block */
  private withOwnSeatUnblocked<T>(ch: Character, fn: () => T): T {
    const key = this.ownSeatKey(ch);
    if (key) this.blockedTiles.delete(key);
    const result = fn();
    if (key) this.blockedTiles.add(key);
    return result;
  }

  /** Collect every tile occupied by electronics furniture (PCs, monitors, etc.). */
  private buildElectronicsTileSet(): Set<string> {
    const out = new Set<string>();
    for (const item of this.layout.furniture) {
      const entry = getCatalogEntry(item.type);
      if (!entry || entry.category !== 'electronics') continue;
      for (let dr = 0; dr < entry.footprintH; dr++) {
        for (let dc = 0; dc < entry.footprintW; dc++) {
          out.add(`${item.col + dc},${item.row + dr}`);
        }
      }
    }
    return out;
  }

  /** Find the area label assigned to a seat's tile, or null. Public for e2e
   *  observability (getAgentSeats hook reads a seated agent's area). */
  seatZone(uid: string): string | null {
    const seat = this.seats.get(uid);
    if (!seat) return null;
    const tiles = this.layout.areaTiles;
    if (!tiles || tiles.length === 0) return null;
    const idx = seat.seatRow * this.layout.cols + seat.seatCol;
    if (idx < 0 || idx >= tiles.length) return null;
    return tiles[idx] ?? null;
  }

  /**
   * Does this seat face an electronics tile (PC, monitor)? Mirrors the
   * forward-and-flanking scan used by furniture auto-state.
   */
  private isSeatFacingElectronics(seat: Seat, electronicsTiles: Set<string>): boolean {
    const { dCol, dRow } = seatFacingOffset(seat.facingDir);
    for (let d = 1; d <= AUTO_ON_FACING_DEPTH; d++) {
      const tileCol = seat.seatCol + dCol * d;
      const tileRow = seat.seatRow + dRow * d;
      if (electronicsTiles.has(`${tileCol},${tileRow}`)) return true;
      if (dCol !== 0) {
        if (
          electronicsTiles.has(`${tileCol},${tileRow - 1}`) ||
          electronicsTiles.has(`${tileCol},${tileRow + 1}`)
        ) {
          return true;
        }
      } else if (
        electronicsTiles.has(`${tileCol - 1},${tileRow}`) ||
        electronicsTiles.has(`${tileCol + 1},${tileRow}`)
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Random-pick a seat from a candidate list, biased toward seats that face an
   * electronics tile. Returns null when the candidate list is empty.
   */
  private pickFromSeats(seatUids: string[], electronicsTiles: Set<string>): string | null {
    if (seatUids.length === 0) return null;
    const pcSeats: string[] = [];
    const otherSeats: string[] = [];
    for (const uid of seatUids) {
      const seat = this.seats.get(uid);
      if (!seat) continue;
      if (this.isSeatFacingElectronics(seat, electronicsTiles)) {
        pcSeats.push(uid);
      } else {
        otherSeats.push(uid);
      }
    }
    if (pcSeats.length > 0) return pcSeats[Math.floor(Math.random() * pcSeats.length)];
    if (otherSeats.length > 0) return otherSeats[Math.floor(Math.random() * otherSeats.length)];
    return null;
  }

  /**
   * Seat picker. With `areaLabel`: a free seat in that room, else null.
   * Without: an unzoned free seat (no area label), else any free seat.
   * Every stage routes through `pickFromSeats` for the PC-bias rule.
   */
  private findFreeSeat(areaLabel?: string): string | null {
    const electronicsTiles = this.buildElectronicsTileSet();
    const freeSeats: string[] = [];
    for (const [uid, seat] of this.seats) {
      if (!seat.assigned) freeSeats.push(uid);
    }
    if (freeSeats.length === 0) return null;

    if (areaLabel) {
      const inArea = freeSeats.filter((uid) => this.seatZone(uid) === areaLabel);
      return this.pickFromSeats(inArea, electronicsTiles);
    }

    // Stage 2 — unzoned seats (no area label, or layout has no areas at all).
    const unzoned = freeSeats.filter((uid) => this.seatZone(uid) === null);
    const pick2 = this.pickFromSeats(unzoned, electronicsTiles);
    if (pick2) return pick2;

    // Stage 3 — any free seat.
    return this.pickFromSeats(freeSeats, electronicsTiles);
  }

  /** Closest walkable tile to (col,row) not occupied by another character, or null. */
  private closestFreeWalkableTile(
    col: number,
    row: number,
    self?: Character,
    tiles = this.walkableTiles,
  ): { col: number; row: number } | null {
    const occupied = new Set<string>();
    for (const ch of this.characters.values()) {
      if (ch !== self) occupied.add(`${ch.tileCol},${ch.tileRow}`);
    }
    let best: { col: number; row: number } | null = null;
    let bestDist = Infinity;
    for (const tile of tiles) {
      if (occupied.has(`${tile.col},${tile.row}`)) continue;
      const d = Math.abs(tile.col - col) + Math.abs(tile.row - row);
      if (d < bestDist) {
        best = tile;
        bestDist = d;
      }
    }
    return best;
  }

  /**
   * Pick a diverse palette for a new agent based on currently active agents.
   * First 6 agents each get a unique skin (random order). Beyond 6, skins
   * repeat in balanced rounds with a random hue shift (≥45°).
   */
  private pickDiversePalette(): { palette: number; hueShift: number } {
    // Count how many non-sub-agents use each base palette (0-5)
    const paletteCount = getLoadedCharacterCount();
    const counts = new Array(paletteCount).fill(0) as number[];
    for (const ch of this.characters.values()) {
      if (ch.isSubagent) continue;
      if (ch.palette < paletteCount) counts[ch.palette]++;
    }
    return pickDiversePalette(paletteCount, counts);
  }

  addAgent(
    id: number,
    preferredPalette?: number,
    preferredHueShift?: number,
    preferredSeatId?: string,
    skipSpawnEffect?: boolean,
    directoryName?: string,
    nearAgentId?: number,
  ): void {
    if (this.characters.has(id)) return;

    let palette: number;
    let hueShift: number;
    if (preferredPalette !== undefined) {
      palette = preferredPalette;
      hueShift = preferredHueShift ?? 0;
    } else {
      const pick = this.pickDiversePalette();
      palette = pick.palette;
      hueShift = pick.hueShift;
    }

    // Try preferred seat first, then (for teammates) the seat closest to the
    // anchor agent, then any free seat. anchorTile resolves to the anchor's SEAT
    // (stable from creation) rather than its live tile, so a teammate placed while
    // the lead is still walking to its seat still clusters around the final seat.
    const anchor = nearAgentId !== undefined ? this.characters.get(nearAgentId) : undefined;
    const anchorAt = anchorTile(anchor, this.seats);
    let seatId: string | null = null;
    if (preferredSeatId && this.seats.has(preferredSeatId)) {
      const seat = this.seats.get(preferredSeatId)!;
      if (!seat.assigned) {
        seatId = preferredSeatId;
      }
    }
    if (!seatId && anchorAt) {
      seatId = closestFreeSeat(this.seats, anchorAt.col, anchorAt.row);
    }
    if (!seatId) {
      seatId = this.findFreeSeat();
    }

    let ch: Character;
    if (seatId) {
      const seat = this.seats.get(seatId)!;
      seat.assigned = true;
      ch = createCharacter(id, palette, seatId, seat, hueShift);
    } else {
      // No seats — teammates spawn beside their anchor, others at a random walkable tile
      let spawn = anchorAt ? this.closestFreeWalkableTile(anchorAt.col, anchorAt.row) : null;
      if (!spawn) {
        spawn =
          this.walkableTiles.length > 0
            ? this.walkableTiles[Math.floor(Math.random() * this.walkableTiles.length)]
            : { col: 1, row: 1 };
      }
      ch = createCharacter(id, palette, null, null, hueShift);
      ch.x = spawn.col * TILE_SIZE + TILE_SIZE / 2;
      ch.y = spawn.row * TILE_SIZE + TILE_SIZE / 2;
      ch.tileCol = spawn.col;
      ch.tileRow = spawn.row;
    }

    if (directoryName) {
      ch.directoryName = directoryName;
    }
    if (!skipSpawnEffect) {
      startMatrixEffect(ch, 'spawn');
    }
    this.characters.set(id, ch);
  }

  // ── Greeter ───────────────────────────────────────────────────
  // The Intro is diegetic: a char_0 character stands near the office's
  // bottom-left corner and "speaks" the tour through a DOM bubble
  // (IntroBubble). It is not an agent — see the `greeter` field.

  /** Spawn the greeter near the office's bottom-left corner: target tile
   *  GREETER_TILE_MARGIN in from the left and bottom edges, falling
   *  back to the closest walkable tile when the target is a seat, furniture,
   *  a wall, or VOID (seat tiles are in blockedTiles, so closestFreeWalkableTile
   *  covers every one of those). Idempotent; a remount mid-despawn (StrictMode)
   *  revives it. */
  spawnGreeter(): void {
    this.greeterCameraCancelled = false;
    if (this.greeter) {
      if (this.greeter.matrixEffect === 'despawn') startMatrixEffect(this.greeter, 'spawn');
      return;
    }
    const spawn = this.closestFreeWalkableTile(
      GREETER_TILE_MARGIN,
      this.layout.rows - 1 - GREETER_TILE_MARGIN,
    );
    if (!spawn) return; // no walkable tile — IntroBubble falls back to a fixed panel
    const ch = createCharacter(GREETER_ID, 0, null, null, 0);
    ch.isGreeter = true;
    ch.state = CharacterState.IDLE;
    ch.isActive = false;
    ch.dir = Direction.DOWN;
    ch.x = spawn.col * TILE_SIZE + TILE_SIZE / 2;
    ch.y = spawn.row * TILE_SIZE + TILE_SIZE / 2;
    ch.tileCol = spawn.col;
    ch.tileRow = spawn.row;
    startMatrixEffect(ch, 'spawn');
    this.greeter = ch;
  }

  /** Start the greeter's despawn effect and release the greeter camera. The
   *  character is dropped once the effect finishes (see update()).
   *  Idempotent — every close path (answer, Escape, hooksStatus) funnels here. */
  despawnGreeter(): void {
    this.greeterCameraTarget = null;
    this.greeterCameraCancelled = false;
    if (!this.greeter || this.greeter.matrixEffect === 'despawn') return;
    startMatrixEffect(this.greeter, 'despawn');
  }

  /** Per-frame update from the bubble overlay; ignored once the user panned. */
  setGreeterCameraTarget(p: { x: number; y: number }): void {
    if (!this.greeterCameraCancelled) this.greeterCameraTarget = p;
  }

  /** Manual pan during the ask: stop re-centering until the next spawn. */
  cancelGreeterCamera(): void {
    this.greeterCameraTarget = null;
    this.greeterCameraCancelled = true;
  }

  /** Every manual pan (mouse, wheel, touch) takes the camera back from both
   *  automatic drivers: character follow and the greeter's ask. */
  breakCameraFollow(): void {
    this.cameraFollowId = null;
    this.cancelGreeterCamera();
  }

  /** Select an agent's character and have the camera follow it — what a card
   *  tap does to the office. No-op for an agent with no character. */
  selectAndFollow(id: number): void {
    if (!this.characters.has(id)) return;
    this.selectedAgentId = id;
    this.cameraFollowId = id;
  }

  /** The agent that owns `id`'s terminal: a sub-agent's parent, else itself. */
  terminalOwnerOf(id: number): number {
    return this.subagentMeta.get(id)?.parentAgentId ?? id;
  }

  removeAgent(id: number): void {
    const ch = this.characters.get(id);
    if (!ch) return;
    if (ch.matrixEffect === 'despawn') return; // already despawning
    // Free seat and clear selection immediately
    if (ch.seatId) {
      const seat = this.seats.get(ch.seatId);
      if (seat) seat.assigned = false;
    }
    if (this.selectedAgentId === id) this.selectedAgentId = null;
    if (this.cameraFollowId === id) this.cameraFollowId = null;
    // Start despawn animation instead of immediate delete
    startMatrixEffect(ch, 'despawn');
    ch.bubbleType = null;
  }

  /** Find seat uid at a given tile position, or null */
  getSeatAtTile(col: number, row: number): string | null {
    for (const [uid, seat] of this.seats) {
      if (seat.seatCol === col && seat.seatRow === row) return uid;
    }
    return null;
  }

  /** Reassign an agent from their current seat to a new seat */
  reassignSeat(agentId: number, seatId: string): void {
    const ch = this.characters.get(agentId);
    if (!ch) return;
    // Unassign old seat
    if (ch.seatId) {
      const old = this.seats.get(ch.seatId);
      if (old) old.assigned = false;
    }
    // Assign new seat
    const seat = this.seats.get(seatId);
    if (!seat || seat.assigned) return;
    seat.assigned = true;
    ch.seatId = seatId;
    // Pathfind to new seat (unblock own seat tile for this query)
    const path = this.withOwnSeatUnblocked(ch, () =>
      findPath(ch.tileCol, ch.tileRow, seat.seatCol, seat.seatRow, this.tileMap, this.blockedTiles),
    );
    if (path.length > 0) {
      ch.path = path;
      ch.moveProgress = 0;
      ch.state = CharacterState.WALK;
      ch.frame = 0;
      ch.frameTimer = 0;
    } else {
      // Already at seat or no path — sit down
      ch.state = CharacterState.TYPE;
      ch.dir = seat.facingDir;
      ch.frame = 0;
      ch.frameTimer = 0;
      if (!ch.isActive) {
        ch.seatTimer = INACTIVE_SEAT_TIMER_MIN_SEC + Math.random() * INACTIVE_SEAT_TIMER_RANGE_SEC;
      }
    }
  }

  /**
   * Move a just-linked teammate to the free seat closest to its lead, so teams
   * cluster. Only moves when that seat is strictly closer than the teammate's
   * current one — a teammate created as a plain external agent (seated by an
   * arbitrary findFreeSeat) and tagged as a teammate only after tag discovery
   * would otherwise keep its arbitrary seat, unlike an inline teammate seated
   * next to the lead at creation.
   */
  private reseatNextToLead(teammateId: number, leadId: number): void {
    const teammate = this.characters.get(teammateId);
    const lead = this.characters.get(leadId);
    if (!teammate || !lead) return;
    const anchorAt = anchorTile(lead, this.seats);
    if (!anchorAt) return;
    const target = closestFreeSeat(this.seats, anchorAt.col, anchorAt.row);
    if (!target || target === teammate.seatId) return;
    const targetSeat = this.seats.get(target)!;
    const targetDist =
      Math.abs(targetSeat.seatCol - anchorAt.col) + Math.abs(targetSeat.seatRow - anchorAt.row);
    const currentSeat = teammate.seatId ? this.seats.get(teammate.seatId) : undefined;
    const currentDist = currentSeat
      ? Math.abs(currentSeat.seatCol - anchorAt.col) + Math.abs(currentSeat.seatRow - anchorAt.row)
      : Infinity;
    if (targetDist < currentDist) {
      this.reassignSeat(teammateId, target);
    }
  }

  /** Send an agent back to their currently assigned seat */
  sendToSeat(agentId: number): void {
    const ch = this.characters.get(agentId);
    if (!ch || !ch.seatId) return;
    const seat = this.seats.get(ch.seatId);
    if (!seat) return;
    const path = this.withOwnSeatUnblocked(ch, () =>
      findPath(ch.tileCol, ch.tileRow, seat.seatCol, seat.seatRow, this.tileMap, this.blockedTiles),
    );
    if (path.length > 0) {
      ch.path = path;
      ch.moveProgress = 0;
      ch.state = CharacterState.WALK;
      ch.frame = 0;
      ch.frameTimer = 0;
    } else {
      // Already at seat — sit down
      ch.state = CharacterState.TYPE;
      ch.dir = seat.facingDir;
      ch.frame = 0;
      ch.frameTimer = 0;
      if (!ch.isActive) {
        ch.seatTimer = INACTIVE_SEAT_TIMER_MIN_SEC + Math.random() * INACTIVE_SEAT_TIMER_RANGE_SEC;
      }
    }
  }

  /** Walk an agent to an arbitrary walkable tile (right-click command) */
  walkToTile(agentId: number, col: number, row: number): boolean {
    const ch = this.characters.get(agentId);
    if (!ch || ch.isSubagent) return false;
    if (!isWalkable(col, row, this.tileMap, this.blockedTiles)) {
      // Also allow walking to own seat tile (blocked for others but not self)
      const key = this.ownSeatKey(ch);
      if (!key || key !== `${col},${row}`) return false;
    }
    const path = this.withOwnSeatUnblocked(ch, () =>
      findPath(ch.tileCol, ch.tileRow, col, row, this.tileMap, this.blockedTiles),
    );
    if (path.length === 0) return false;
    ch.path = path;
    ch.moveProgress = 0;
    ch.state = CharacterState.WALK;
    ch.frame = 0;
    ch.frameTimer = 0;
    return true;
  }

  /**
   * Send a character to a room (area): free its seat, take a free seat there
   * (PC-facing first) unless `standing`, else a free floor tile there, and
   * walk. A character still materializing is placed directly. `homeArea`
   * confines its wander.
   */
  moveToArea(id: number, areaLabel: string, standing = false): void {
    const ch = this.characters.get(id);
    if (!ch) return;
    this.releaseSeat(ch);
    ch.homeArea = areaLabel;
    const seatId = standing ? null : this.findFreeSeat(areaLabel);
    const seat = seatId ? this.seats.get(seatId)! : null;
    let target: { col: number; row: number } | null;
    if (seat) {
      seat.assigned = true;
      ch.seatId = seatId;
      target = { col: seat.seatCol, row: seat.seatRow };
    } else {
      target = this.freeTileIn(this.areaWalkable.get(areaLabel) ?? this.walkableTiles, ch);
    }
    if (!target) return;

    ch.frame = 0;
    ch.frameTimer = 0;
    if (ch.matrixEffect === 'spawn') {
      this.placeAt(ch, target);
    } else {
      this.walkTo(ch, target);
    }
    if (ch.path.length > 0) {
      ch.state = CharacterState.WALK;
    } else if (seat && ch.tileCol === seat.seatCol && ch.tileRow === seat.seatRow) {
      ch.state = CharacterState.TYPE;
      ch.dir = seat.facingDir;
    } else {
      ch.state = CharacterState.IDLE;
    }
  }

  private releaseSeat(ch: Character): void {
    if (!ch.seatId) return;
    const seat = this.seats.get(ch.seatId);
    if (seat) seat.assigned = false;
    ch.seatId = null;
  }

  private placeAt(ch: Character, t: { col: number; row: number }): void {
    ch.tileCol = t.col;
    ch.tileRow = t.row;
    ch.x = t.col * TILE_SIZE + TILE_SIZE / 2;
    ch.y = t.row * TILE_SIZE + TILE_SIZE / 2;
    ch.path = [];
    ch.moveProgress = 0;
  }

  /** A random tile from `tiles` that no other character stands on or walks to (any, if all taken). */
  private freeTileIn(
    tiles: Array<{ col: number; row: number }>,
    self: Character,
  ): { col: number; row: number } | null {
    if (tiles.length === 0) return null;
    const taken = new Set<string>();
    for (const ch of this.characters.values()) {
      if (ch === self) continue;
      const end = ch.path[ch.path.length - 1] ?? { col: ch.tileCol, row: ch.tileRow };
      taken.add(`${end.col},${end.row}`);
    }
    const free = tiles.filter((t) => !taken.has(`${t.col},${t.row}`));
    const pool = free.length > 0 ? free : tiles;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /**
   * Make a child walk hand in hand beside `leaderId` (its parent, or the
   * parent's ghost in another room): it gives up its seat and room and never
   * sits or wanders (see update()). `null` stops following and leaves
   * `homeArea` unset so the caller re-homes it.
   */
  setFollowTarget(childId: number, leaderId: number | null): void {
    const ch = this.characters.get(childId);
    if (!ch || ch.followId === (leaderId ?? undefined)) return;
    if (leaderId === null) {
      ch.followId = undefined;
      ch.homeArea = undefined;
      return;
    }
    const wasFollowing = ch.followId !== undefined;
    ch.followId = leaderId;
    ch.wanderTimer = 0;
    if (wasFollowing) return; // already standing; update() re-paths to the new leader
    this.releaseSeat(ch);
    ch.homeArea = undefined;
    ch.path = [];
    ch.moveProgress = 0;
    ch.state = CharacterState.IDLE;
    const leader = this.characters.get(leaderId);
    const spot = leader && ch.matrixEffect === 'spawn' ? this.spotBeside(leader, ch) : null;
    if (spot) this.placeAt(ch, spot);
  }

  /** The tile right of `anchor` if free (lines grow left → right), else the closest free one in its area. */
  private spotBeside(anchor: Character, self: Character): { col: number; row: number } | null {
    const col = anchor.tileCol + 1;
    const row = anchor.tileRow;
    const area = this.areaAt(anchor.tileCol, anchor.tileRow);
    let free =
      isWalkable(col, row, this.tileMap, this.blockedTiles) && this.areaAt(col, row) === area;
    for (const ch of this.characters.values()) {
      if (!free) break;
      if (ch !== self && ch.tileCol === col && ch.tileRow === row) free = false;
    }
    if (free) return { col, row };
    const tiles = (area && this.areaWalkable.get(area)) || this.walkableTiles;
    return this.closestFreeWalkableTile(anchor.tileCol, anchor.tileRow, self, tiles);
  }

  private areaAt(col: number, row: number): string | null {
    return this.layout.areaTiles?.[row * this.layout.cols + col] ?? null;
  }

  /** Walk a follower beside `anchor` (its leader or the follower ahead in the line). */
  private followAnchor(ch: Character, anchor: Character, dt: number): void {
    if (ch.matrixEffect || ch.path.length > 0) return;
    const dist = Math.max(
      Math.abs(ch.tileCol - anchor.tileCol),
      Math.abs(ch.tileRow - anchor.tileRow),
    );
    if (dist <= 1) return;
    if (ch.wanderTimer > 0) {
      ch.wanderTimer -= dt;
      return;
    }
    const spot = this.spotBeside(anchor, ch);
    const path =
      spot && (spot.col !== ch.tileCol || spot.row !== ch.tileRow)
        ? findPath(ch.tileCol, ch.tileRow, spot.col, spot.row, this.tileMap, this.blockedTiles)
        : [];
    if (path.length === 0) {
      ch.wanderTimer = FOLLOW_RETRY_SEC;
      return;
    }
    ch.path = path;
    ch.moveProgress = 0;
    ch.state = CharacterState.WALK;
    ch.frame = 0;
    ch.frameTimer = 0;
  }

  /** Create a sub-agent character with the parent's palette. Returns the sub-agent ID. */
  addSubagent(parentAgentId: number, parentToolId: string): number {
    const key = `${parentAgentId}:${parentToolId}`;
    if (this.subagentIdMap.has(key)) return this.subagentIdMap.get(key)!;

    const id = this.nextSubagentId--;
    const parentCh = this.characters.get(parentAgentId);
    const palette = parentCh ? parentCh.palette : 0;
    const hueShift = parentCh ? parentCh.hueShift : 0;

    // Find the closest walkable tile to the parent, avoiding tiles occupied by other characters
    const parentCol = parentCh ? parentCh.tileCol : 0;
    const parentRow = parentCh ? parentCh.tileRow : 0;
    let spawn = { col: parentCol, row: parentRow };
    if (this.walkableTiles.length > 0) {
      spawn = this.closestFreeWalkableTile(parentCol, parentRow) ?? this.walkableTiles[0];
    }

    const ch = createCharacter(id, palette, null, null, hueShift);
    ch.x = spawn.col * TILE_SIZE + TILE_SIZE / 2;
    ch.y = spawn.row * TILE_SIZE + TILE_SIZE / 2;
    ch.tileCol = spawn.col;
    ch.tileRow = spawn.row;
    // Face the same direction as the parent agent
    if (parentCh) ch.dir = parentCh.dir;
    ch.isSubagent = true;
    ch.parentAgentId = parentAgentId;
    startMatrixEffect(ch, 'spawn');
    this.characters.set(id, ch);

    this.subagentIdMap.set(key, id);
    this.subagentMeta.set(id, { parentAgentId, parentToolId });
    return id;
  }

  /** Remove a specific sub-agent character and free its seat */
  removeSubagent(parentAgentId: number, parentToolId: string): void {
    const key = `${parentAgentId}:${parentToolId}`;
    const id = this.subagentIdMap.get(key);
    if (id === undefined) return;

    const ch = this.characters.get(id);
    if (ch) {
      if (ch.matrixEffect === 'despawn') {
        // Already despawning — just clean up maps
        this.subagentIdMap.delete(key);
        this.subagentMeta.delete(id);
        return;
      }
      if (ch.seatId) {
        const seat = this.seats.get(ch.seatId);
        if (seat) seat.assigned = false;
      }
      // Start despawn animation — keep character in map for rendering
      startMatrixEffect(ch, 'despawn');
      ch.bubbleType = null;
    }
    // Clean up tracking maps immediately so keys don't collide
    this.subagentIdMap.delete(key);
    this.subagentMeta.delete(id);
    if (this.selectedAgentId === id) this.selectedAgentId = null;
    if (this.cameraFollowId === id) this.cameraFollowId = null;
  }

  /** Remove all sub-agents belonging to a parent agent */
  removeAllSubagents(parentAgentId: number): void {
    const toRemove: string[] = [];
    for (const [key, id] of this.subagentIdMap) {
      const meta = this.subagentMeta.get(id);
      if (meta && meta.parentAgentId === parentAgentId) {
        const ch = this.characters.get(id);
        if (ch) {
          if (ch.matrixEffect === 'despawn') {
            // Already despawning — just clean up maps
            this.subagentMeta.delete(id);
            toRemove.push(key);
            continue;
          }
          if (ch.seatId) {
            const seat = this.seats.get(ch.seatId);
            if (seat) seat.assigned = false;
          }
          // Start despawn animation
          startMatrixEffect(ch, 'despawn');
          ch.bubbleType = null;
        }
        this.subagentMeta.delete(id);
        if (this.selectedAgentId === id) this.selectedAgentId = null;
        if (this.cameraFollowId === id) this.cameraFollowId = null;
        toRemove.push(key);
      }
    }
    for (const key of toRemove) {
      this.subagentIdMap.delete(key);
    }
  }

  /** Look up the sub-agent character ID for a given parent+toolId, or null */
  getSubagentId(parentAgentId: number, parentToolId: string): number | null {
    return this.subagentIdMap.get(`${parentAgentId}:${parentToolId}`) ?? null;
  }

  setAgentActive(id: number, active: boolean): void {
    const ch = this.characters.get(id);
    if (ch) {
      ch.isActive = active;
      if (!active) {
        // Sentinel -1: signals turn just ended, skip next seat rest timer.
        // Prevents the WALK handler from setting a 2-4 min rest on arrival.
        ch.seatTimer = -1;
        ch.path = [];
        ch.moveProgress = 0;
      }
      this.rebuildFurnitureInstances();
    }
  }

  /** Rebuild furniture instances with auto-state applied (active agents turn electronics ON) */
  private rebuildFurnitureInstances(): void {
    // Collect tiles where active agents face desks
    const autoOnTiles = new Set<string>();
    for (const ch of this.characters.values()) {
      if (!ch.isActive || !ch.seatId) continue;
      const seat = this.seats.get(ch.seatId);
      if (!seat) continue;
      // Find the desk tile(s) the agent faces from their seat
      const dCol =
        seat.facingDir === Direction.RIGHT ? 1 : seat.facingDir === Direction.LEFT ? -1 : 0;
      const dRow = seat.facingDir === Direction.DOWN ? 1 : seat.facingDir === Direction.UP ? -1 : 0;
      // Check tiles in the facing direction (desk could be 1-3 tiles deep)
      for (let d = 1; d <= AUTO_ON_FACING_DEPTH; d++) {
        const tileCol = seat.seatCol + dCol * d;
        const tileRow = seat.seatRow + dRow * d;
        autoOnTiles.add(`${tileCol},${tileRow}`);
      }
      // Also check tiles to the sides of the facing direction (desks can be wide)
      for (let d = 1; d <= AUTO_ON_SIDE_DEPTH; d++) {
        const baseCol = seat.seatCol + dCol * d;
        const baseRow = seat.seatRow + dRow * d;
        if (dCol !== 0) {
          // Facing left/right: check tiles above and below
          autoOnTiles.add(`${baseCol},${baseRow - 1}`);
          autoOnTiles.add(`${baseCol},${baseRow + 1}`);
        } else {
          // Facing up/down: check tiles left and right
          autoOnTiles.add(`${baseCol - 1},${baseRow}`);
          autoOnTiles.add(`${baseCol + 1},${baseRow}`);
        }
      }
    }

    if (autoOnTiles.size === 0) {
      this.furniture = layoutToFurnitureInstances(this.layout.furniture);
      return;
    }

    // Build modified furniture list with auto-state and animation applied
    const animFrame = Math.floor(this.furnitureAnimTimer / FURNITURE_ANIM_INTERVAL_SEC);
    const modifiedFurniture: PlacedFurniture[] = this.layout.furniture.map((item) => {
      const entry = getCatalogEntry(item.type);
      if (!entry) return item;
      // Check if any tile of this furniture overlaps an auto-on tile
      for (let dr = 0; dr < entry.footprintH; dr++) {
        for (let dc = 0; dc < entry.footprintW; dc++) {
          if (autoOnTiles.has(`${item.col + dc},${item.row + dr}`)) {
            let onType = getOnStateType(item.type);
            if (onType !== item.type) {
              // Check if the on-state type has animation frames
              const frames = getAnimationFrames(onType);
              if (frames && frames.length > 1) {
                const frameIdx = animFrame % frames.length;
                onType = frames[frameIdx];
              }
              return { ...item, type: onType };
            }
            return item;
          }
        }
      }
      return item;
    });

    this.furniture = layoutToFurnitureInstances(modifiedFurniture);
  }

  setAgentTool(id: number, tool: string | null): void {
    const ch = this.characters.get(id);
    if (ch) {
      ch.currentTool = tool;
    }
  }

  showPermissionBubble(id: number): void {
    const ch = this.characters.get(id);
    if (ch) {
      ch.bubbleType = 'permission';
      ch.bubbleTimer = 0;
    }
  }

  clearPermissionBubble(id: number): void {
    const ch = this.characters.get(id);
    if (ch && ch.bubbleType === 'permission') {
      ch.bubbleType = null;
      ch.bubbleTimer = 0;
    }
  }

  showWaitingBubble(id: number, awaitingInput = false): void {
    const ch = this.characters.get(id);
    if (ch) {
      ch.bubbleType = 'waiting';
      ch.waitingAwaitingInput = awaitingInput;
      ch.bubbleTimer = WAITING_BUBBLE_DURATION_SEC;
    }
  }

  /** Dismiss bubble on click — permission: instant, waiting: quick fade */
  dismissBubble(id: number): void {
    const ch = this.characters.get(id);
    if (!ch || !ch.bubbleType) return;
    if (ch.bubbleType === 'permission') {
      ch.bubbleType = null;
      ch.bubbleTimer = 0;
    } else if (ch.bubbleType === 'waiting') {
      // Trigger immediate fade (0.3s remaining)
      ch.bubbleTimer = Math.min(ch.bubbleTimer, DISMISS_BUBBLE_FAST_FADE_SEC);
    }
  }

  setTeamInfo(
    id: number,
    teamName?: string,
    agentName?: string,
    isTeamLead?: boolean,
    leadAgentId?: number,
    teamUsesTmux?: boolean,
  ): void {
    const ch = this.characters.get(id);
    if (!ch) return;
    const wasUnlinked = ch.leadAgentId === undefined;
    ch.teamName = teamName;
    ch.agentName = agentName;
    ch.isTeamLead = isTeamLead;
    ch.leadAgentId = leadAgentId;
    if (teamUsesTmux !== undefined) {
      ch.teamUsesTmux = teamUsesTmux;
    }
    // A teammate is not a headless agent: clicking it focuses its lead's terminal.
    // Adopted sessions are marked headless at creation and only later discovered
    // to be teammates, so drop the mark once the link lands.
    if (leadAgentId !== undefined) {
      ch.isHeadless = false;
    }
    // A teammate discovered only after its plain external session was adopted is
    // linked here, not at creation, so it never went through the seat-next-to-lead
    // path addAgent runs for inline teammates. Cluster it now, once, on first link.
    if (wasUnlinked && leadAgentId !== undefined && !isTeamLead) {
      this.reseatNextToLead(id, leadAgentId);
    }
  }

  /** Mark an agent as headless (adopted, no terminal to focus). */
  setHeadless(id: number, headless: boolean): void {
    const ch = this.characters.get(id);
    if (!ch) return;
    ch.isHeadless = headless;
  }

  setAgentContext(id: number, contextTokens: number, maxContextTokens: number): void {
    const ch = this.characters.get(id);
    if (!ch) return;
    ch.contextTokens = contextTokens;
    ch.maxContextTokens = maxContextTokens;
  }

  update(dt: number): void {
    // Furniture animation cycling
    const prevFrame = Math.floor(this.furnitureAnimTimer / FURNITURE_ANIM_INTERVAL_SEC);
    this.furnitureAnimTimer += dt;
    const newFrame = Math.floor(this.furnitureAnimTimer / FURNITURE_ANIM_INTERVAL_SEC);
    if (newFrame !== prevFrame) {
      this.rebuildFurnitureInstances();
    }

    // The greeter materializes and dematerializes like anyone else, but runs
    // no FSM — it stands where it spawned for as long as the ask is up.
    if (this.greeter && advanceMatrixEffect(this.greeter, dt) === 'despawned') {
      this.greeter = null;
    }

    const toDelete: number[] = [];
    /** leader id → last follower in its line, so siblings queue behind each other */
    const lineEnd = new Map<number, Character>();
    for (const ch of this.characters.values()) {
      const effect = advanceMatrixEffect(ch, dt);
      if (effect !== 'none') {
        if (effect === 'despawned') toDelete.push(ch.id);
        continue; // skip normal FSM while the effect is (or just was) active
      }

      if (ch.followId !== undefined) {
        const leader = this.characters.get(ch.followId);
        if (leader) {
          this.followAnchor(ch, lineEnd.get(ch.followId) ?? leader, dt);
          lineEnd.set(ch.followId, ch);
        }
      }

      const wanderTiles = (ch.homeArea && this.areaWalkable.get(ch.homeArea)) || this.walkableTiles;
      // Temporarily unblock own seat so character can pathfind to it
      this.withOwnSeatUnblocked(ch, () =>
        updateCharacter(ch, dt, wanderTiles, this.seats, this.tileMap, this.blockedTiles),
      );

      // Tick bubble timer for waiting bubbles
      if (ch.bubbleType === 'waiting') {
        ch.bubbleTimer -= dt;
        if (ch.bubbleTimer <= 0) {
          ch.bubbleType = null;
          ch.bubbleTimer = 0;
        }
      }
    }
    // Remove characters that finished despawn
    for (const id of toDelete) {
      this.characters.delete(id);
    }
  }

  /** The `saveAgentSeats` payload: palette, hue and seat for every agent worth
   *  restoring. Sub-agents are excluded because they are derived state the
   *  runtime re-materializes, and the greeter never reaches here at all —
   *  it is not in `characters`. */
  getPersistableSeats(): Record<
    number,
    { palette: number; hueShift: number; seatId: string | null }
  > {
    const seats: Record<number, { palette: number; hueShift: number; seatId: string | null }> = {};
    for (const ch of this.characters.values()) {
      if (ch.isSubagent) continue;
      seats[ch.id] = { palette: ch.palette, hueShift: ch.hueShift, seatId: ch.seatId };
    }
    return seats;
  }

  /** Everything the renderer draws: the agents plus, while the first-run ask
   *  is up, the consent greeter. This is the ONE place the greeter joins the
   *  agents — every other consumer reads `characters` and gets agents only. */
  getCharacters(): Character[] {
    const chars = Array.from(this.characters.values());
    if (this.greeter) chars.push(this.greeter);
    return chars;
  }

  /** Get character at pixel position (for hit testing). Returns id or null.
   *  Agents only: clicks pass straight through the consent greeter, which is
   *  a prop, not something to select or follow. */
  getCharacterAt(worldX: number, worldY: number): number | null {
    const chars = Array.from(this.characters.values()).sort((a, b) => b.y - a.y);
    for (const ch of chars) {
      // Skip characters that are despawning
      if (ch.matrixEffect === 'despawn') continue;
      // Character sprite is 16x24, anchored bottom-center
      // Apply sitting offset to match visual position
      const sittingOffset = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0;
      const anchorY = ch.y + sittingOffset;
      const left = ch.x - CHARACTER_HIT_HALF_WIDTH;
      const right = ch.x + CHARACTER_HIT_HALF_WIDTH;
      const top = anchorY - CHARACTER_HIT_HEIGHT;
      const bottom = anchorY;
      if (worldX >= left && worldX <= right && worldY >= top && worldY <= bottom) {
        return ch.id;
      }
    }
    return null;
  }
}

import {
  DEFAULT_MAX_CONTEXT_TOKENS,
  PET_IDLE_FRAME_DURATION_SEC,
  PET_IDLE_SEQUENCE,
  PET_WALK_SEQUENCE,
  TYPE_FRAME_DURATION_SEC,
  WALK_FRAME_DURATION_SEC,
  WALK_SPEED_PX_PER_SEC,
} from '../../constants.js';
import { findPath } from '../layout/tileMap.js';
import type { PetSpriteFrames } from '../sprites/petSpriteData.js';
import type { CharacterSprites } from '../sprites/spriteData.js';
import { isReadingToolName } from '../toolUtils.js';
import type { Character, Seat, SpriteData, TileType as TileTypeVal } from '../types.js';
import { CharacterState, Direction, TILE_SIZE } from '../types.js';

/** Whether a tool should show the reading animation (vs typing). Taxonomy comes
 *  from the active HookProvider via the `providerCapabilities` message. */
export function isReadingTool(tool: string | null): boolean {
  if (!tool) return false;
  return isReadingToolName(tool);
}

/** Pixel center of a tile */
function tileCenter(col: number, row: number): { x: number; y: number } {
  return {
    x: col * TILE_SIZE + TILE_SIZE / 2,
    y: row * TILE_SIZE + TILE_SIZE / 2,
  };
}

/** Direction from one tile to an adjacent tile */
function directionBetween(
  fromCol: number,
  fromRow: number,
  toCol: number,
  toRow: number,
): Direction {
  const dc = toCol - fromCol;
  const dr = toRow - fromRow;
  if (dc > 0) return Direction.RIGHT;
  if (dc < 0) return Direction.LEFT;
  if (dr > 0) return Direction.DOWN;
  return Direction.UP;
}

export function createCharacter(
  id: number,
  palette: number,
  seatId: string | null,
  seat: Seat | null,
  hueShift = 0,
): Character {
  const col = seat ? seat.seatCol : 1;
  const row = seat ? seat.seatRow : 1;
  const center = tileCenter(col, row);
  return {
    id,
    state: CharacterState.TYPE,
    dir: seat ? seat.facingDir : Direction.DOWN,
    x: center.x,
    y: center.y,
    tileCol: col,
    tileRow: row,
    path: [],
    moveProgress: 0,
    currentTool: null,
    palette,
    hueShift,
    frame: 0,
    frameTimer: 0,
    followTimer: 0,
    isActive: true,
    seatId,
    bubbleType: null,
    bubbleTimer: 0,
    isSubagent: false,
    parentAgentId: null,
    matrixEffect: null,
    matrixEffectTimer: 0,
    matrixEffectSeeds: [],
    contextTokens: 0,
    maxContextTokens: DEFAULT_MAX_CONTEXT_TOKENS,
  };
}

/**
 * Start walking `path`, or sit down at `seat` when already on it. No path and
 * not on it = the seat can't be reached: give it up and stand where it is
 * (never sit or type on the wrong tile).
 */
function walkOrSit(ch: Character, path: Array<{ col: number; row: number }>, seat: Seat): void {
  ch.frame = 0;
  ch.frameTimer = 0;
  if (path.length > 0) {
    ch.path = path;
    ch.moveProgress = 0;
    ch.state = CharacterState.WALK;
  } else if (ch.tileCol === seat.seatCol && ch.tileRow === seat.seatRow) {
    ch.state = CharacterState.TYPE;
    ch.dir = seat.facingDir;
  } else {
    seat.assigned = false;
    ch.seatId = null;
  }
}

/**
 * One tick of a character. Nobody strolls: a character with a seat goes to it
 * and stays seated (typing while active, still otherwise); one without a seat
 * stands where it is (or types in place while active). Walking only happens
 * on the way to a seat or tile set by OfficeState (moving rooms, following).
 */
export function updateCharacter(
  ch: Character,
  dt: number,
  seats: Map<string, Seat>,
  tileMap: TileTypeVal[][],
  blockedTiles: Set<string>,
): void {
  ch.frameTimer += dt;

  switch (ch.state) {
    case CharacterState.TYPE: {
      if (!ch.isActive) {
        ch.frame = 0; // seated and idle: a still pose
        break;
      }
      if (ch.frameTimer >= TYPE_FRAME_DURATION_SEC) {
        ch.frameTimer -= TYPE_FRAME_DURATION_SEC;
        ch.frame = (ch.frame + 1) % 2;
      }
      break;
    }

    case CharacterState.IDLE: {
      // No idle animation — static pose
      ch.frame = 0;
      // Followers never sit: OfficeState walks followers to their leader.
      if (ch.followId !== undefined) break;
      const seat = ch.seatId ? seats.get(ch.seatId) : undefined;
      if (seat) {
        walkOrSit(
          ch,
          findPath(ch.tileCol, ch.tileRow, seat.seatCol, seat.seatRow, tileMap, blockedTiles),
          seat,
        );
      } else if (ch.isActive) {
        // No seat — type in place
        ch.state = CharacterState.TYPE;
        ch.frameTimer = 0;
      }
      break;
    }

    case CharacterState.WALK: {
      // Walk animation
      if (ch.frameTimer >= WALK_FRAME_DURATION_SEC) {
        ch.frameTimer -= WALK_FRAME_DURATION_SEC;
        ch.frame = (ch.frame + 1) % 4;
      }

      if (ch.path.length === 0) {
        // Path complete — snap to tile center and transition
        const center = tileCenter(ch.tileCol, ch.tileRow);
        ch.x = center.x;
        ch.y = center.y;

        const seat = ch.seatId ? seats.get(ch.seatId) : undefined;
        if (
          ch.followId === undefined &&
          seat &&
          ch.tileCol === seat.seatCol &&
          ch.tileRow === seat.seatRow
        ) {
          ch.state = CharacterState.TYPE;
          ch.dir = seat.facingDir;
        } else {
          // Not at its seat (yet): IDLE heads there next tick, or stands / types in place.
          ch.state = CharacterState.IDLE;
        }
        ch.frame = 0;
        ch.frameTimer = 0;
        break;
      }

      // Move toward next tile in path
      const nextTile = ch.path[0];
      ch.dir = directionBetween(ch.tileCol, ch.tileRow, nextTile.col, nextTile.row);

      ch.moveProgress += (WALK_SPEED_PX_PER_SEC / TILE_SIZE) * dt;

      const fromCenter = tileCenter(ch.tileCol, ch.tileRow);
      const toCenter = tileCenter(nextTile.col, nextTile.row);
      const t = Math.min(ch.moveProgress, 1);
      ch.x = fromCenter.x + (toCenter.x - fromCenter.x) * t;
      ch.y = fromCenter.y + (toCenter.y - fromCenter.y) * t;

      if (ch.moveProgress >= 1) {
        // Arrived at next tile
        ch.tileCol = nextTile.col;
        ch.tileRow = nextTile.row;
        ch.x = toCenter.x;
        ch.y = toCenter.y;
        ch.path.shift();
        ch.moveProgress = 0;
      }

      // Became active on the way somewhere else: repath to the seat
      if (ch.isActive && ch.seatId) {
        const seat = seats.get(ch.seatId);
        if (seat) {
          const lastStep = ch.path[ch.path.length - 1];
          if (!lastStep || lastStep.col !== seat.seatCol || lastStep.row !== seat.seatRow) {
            const newPath = findPath(
              ch.tileCol,
              ch.tileRow,
              seat.seatCol,
              seat.seatRow,
              tileMap,
              blockedTiles,
            );
            if (newPath.length > 0) {
              ch.path = newPath;
              ch.moveProgress = 0;
            }
          }
        }
      }
      break;
    }
  }
}

/** Get the correct sprite frame for a character's current state and direction */
export function getCharacterSprite(ch: Character, sprites: CharacterSprites): SpriteData {
  switch (ch.state) {
    case CharacterState.TYPE:
      if (isReadingTool(ch.currentTool)) {
        return sprites.reading[ch.dir][ch.frame % 2];
      }
      return sprites.typing[ch.dir][ch.frame % 2];
    case CharacterState.WALK:
      return sprites.walk[ch.dir][ch.frame % 4];
    case CharacterState.IDLE:
      return sprites.walk[ch.dir][1];
    default:
      return sprites.walk[ch.dir][1];
  }
}

/**
 * A pet character's frame: the walk cycle while walking, else the idle loop
 * (sitting at a desk too — pets have no typing/reading frames). Idle frames run
 * on the wall clock `nowSec`, offset per character so pets don't blink in sync.
 * Side-facing idle uses the front idle (the sheet has no side idle).
 */
export function getPetCharacterSprite(
  ch: Character,
  frames: PetSpriteFrames,
  nowSec: number,
): SpriteData {
  if (ch.state === CharacterState.WALK) {
    const f = PET_WALK_SEQUENCE[ch.frame % PET_WALK_SEQUENCE.length];
    if (ch.dir === Direction.UP) return frames.walkUp[f];
    if (ch.dir === Direction.RIGHT) return frames.walkRight[f];
    if (ch.dir === Direction.LEFT) return frames.walkLeft[f];
    return frames.walkDown[f];
  }
  const step = Math.floor(nowSec / PET_IDLE_FRAME_DURATION_SEC) + Math.abs(ch.id);
  const f = PET_IDLE_SEQUENCE[step % PET_IDLE_SEQUENCE.length];
  return ch.dir === Direction.UP ? frames.idleUp[f] : frames.idleDown[f];
}

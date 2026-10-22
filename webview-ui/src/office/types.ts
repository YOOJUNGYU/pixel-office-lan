export {
  DEFAULT_COLS,
  DEFAULT_ROWS,
  MATRIX_EFFECT_DURATION_SEC as MATRIX_EFFECT_DURATION,
  MAX_COLS,
  MAX_ROWS,
  TILE_SIZE,
} from '../constants.js';

export const TileType = {
  WALL: 0,
  FLOOR_1: 1,
  FLOOR_2: 2,
  FLOOR_3: 3,
  FLOOR_4: 4,
  FLOOR_5: 5,
  FLOOR_6: 6,
  FLOOR_7: 7,
  FLOOR_8: 8,
  FLOOR_9: 9,
  VOID: 255,
} as const;
export type TileType = (typeof TileType)[keyof typeof TileType];

/** Re-export ColorValue for consumers that import color types from office/types */
export type { ColorValue } from '../components/ui/types.js';
import type { ColorValue } from '../components/ui/types.js';

export const CharacterState = {
  IDLE: 'idle',
  WALK: 'walk',
  TYPE: 'type',
} as const;
export type CharacterState = (typeof CharacterState)[keyof typeof CharacterState];

export const Direction = {
  DOWN: 0,
  LEFT: 1,
  RIGHT: 2,
  UP: 3,
} as const;
export type Direction = (typeof Direction)[keyof typeof Direction];

/** 2D array of hex color strings: '' = transparent, '#RRGGBB' = opaque, '#RRGGBBAA' = semi-transparent. [row][col] */
export type SpriteData = string[][];

export interface Seat {
  /** Chair furniture uid */
  uid: string;
  /** Tile col where agent sits */
  seatCol: number;
  /** Tile row where agent sits */
  seatRow: number;
  /** Direction character faces when sitting (toward adjacent desk) */
  facingDir: Direction;
  assigned: boolean;
}

export interface FurnitureInstance {
  sprite: SpriteData;
  /** Pixel x (top-left) */
  x: number;
  /** Pixel y (top-left) */
  y: number;
  /** Y value used for depth sorting (typically bottom edge) */
  zY: number;
  /** Render-time horizontal flip flag (for mirrored side variants) */
  mirrored?: boolean;
}

export interface ToolActivity {
  toolId: string;
  status: string;
  done: boolean;
  permissionWait?: boolean;
}

export const EditTool = {
  TILE_PAINT: 'tile_paint',
  WALL_PAINT: 'wall_paint',
  FURNITURE_PLACE: 'furniture_place',
  FURNITURE_PICK: 'furniture_pick',
  SELECT: 'select',
  EYEDROPPER: 'eyedropper',
  ERASE: 'erase',
  CARPET_PAINT: 'carpet_paint',
  CARPET_PICK: 'carpet_pick',
  /** Colour-only eyedropper: takes a placed item's colour, leaves its type alone. */
  COLOR_PICK: 'color_pick',
  /** Background tab: edits layout.background from the panel; canvas clicks do nothing. */
  BACKGROUND: 'background',
} as const;
export type EditTool = (typeof EditTool)[keyof typeof EditTool];

export interface FurnitureCatalogEntry {
  type: string; // asset ID from furniture manifest
  label: string;
  footprintW: number;
  footprintH: number;
  sprite: SpriteData;
  isDesk: boolean;
  category?: string;
  /** Orientation from rotation group: 'front' | 'back' | 'left' | 'right' */
  orientation?: string;
  /** Whether this item can be placed on top of desk/table surfaces */
  canPlaceOnSurfaces?: boolean;
  /** Number of tile rows from the top of the footprint that are "background" (allow placement, still block walking). Default 0. */
  backgroundTiles?: number;
  /** Whether this item can be placed on wall tiles */
  canPlaceOnWalls?: boolean;
  /** Whether this is a side-oriented asset that produces a mirrored "left" variant */
  mirrorSide?: boolean;
}

export interface PlacedFurniture {
  uid: string;
  type: string; // asset ID from furniture manifest
  col: number;
  row: number;
  /** Optional color override for furniture */
  color?: ColorValue;
}

// ─────────────────────────────────────────────────────────────────────────────
// CARPETS — visual layer between floor and furniture. Walkable, decorative.
// ─────────────────────────────────────────────────────────────────────────────

export interface CarpetTile {
  /** Variant index into the loaded carpet sprite sets (0 .. getCarpetSetCount()-1). */
  variant: number;
  /** Main colorization (lowest-luminance pixels). Defaults to CARPET_DEFAULT_COLOR when omitted. */
  color?: ColorValue;
  /** Accent colorization (highest-luminance pixels). Defaults to CARPET_DEFAULT_ACCENT_COLOR when omitted. */
  accentColor?: ColorValue;
  /** Stacking order at overlapping junctions. Higher draws on top. Defaults to 0. */
  order?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// AREAS — the four fixed rooms (코딩실, 자료실, 서버실, 대기실) painted onto tiles.
// ─────────────────────────────────────────────────────────────────────────────

export interface AreaDefinition {
  /** Stable label used as the FK in `areaTiles`: one of the four fixed room labels. */
  label: string;
  /** Hex color (e.g. "#ff6b6b"). RGB only — alpha applied at render time. */
  color: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// BACKGROUND — what fills the canvas outside the office and on VOID tiles.
// ─────────────────────────────────────────────────────────────────────────────

export const BackgroundKind = {
  COLOR: 'color',
  FLOOR: 'floor',
  CARPET: 'carpet',
} as const;
export type BackgroundKind = (typeof BackgroundKind)[keyof typeof BackgroundKind];

export interface OfficeBackground {
  kind: BackgroundKind;
  /** Solid color (kind 'color'), floor tint (kind 'floor') or carpet main color. A string is `#RRGGBB`. */
  color?: ColorValue | string;
  /** Floor pattern index (1..7, kind 'floor') or carpet variant (0-based, kind 'carpet'). */
  pattern?: number;
  /** Carpet accent color (kind 'carpet'). */
  accent?: ColorValue | string;
}

export interface OfficeLayout {
  version: 1;
  cols: number;
  rows: number;
  tiles: TileType[];
  furniture: PlacedFurniture[];
  /** Per-tile color settings, parallel to tiles array. null = wall/no color */
  tileColors?: Array<ColorValue | null>;
  /** Bumped when the bundled default layout changes; forces a reset on existing installs */
  layoutRevision?: number;
  /** Per-tile carpet data, parallel to tiles array. null/undefined = no carpet on tile. */
  carpetTiles?: Array<CarpetTile | null>;
  /** Area definitions referenced by `areaTiles` labels. Distinct labels required. */
  areas?: AreaDefinition[];
  /** Per-tile Area label, parallel to tiles array. null = no area assignment. */
  areaTiles?: Array<string | null>;
  /** Canvas background around the office. Missing = the page's dark navy. */
  background?: OfficeBackground;
}

export interface Character {
  id: number;
  state: CharacterState;
  dir: Direction;
  /** Pixel position */
  x: number;
  y: number;
  /** Current tile column */
  tileCol: number;
  /** Current tile row */
  tileRow: number;
  /** Remaining path steps (tile coords) */
  path: Array<{ col: number; row: number }>;
  /** 0-1 lerp between current tile and next tile */
  moveProgress: number;
  /** Current tool name for typing vs reading animation, or null */
  currentTool: string | null;
  /** Palette index (0-5) */
  palette: number;
  /** Hue shift in degrees (0 = no shift, ≥45 for repeated palettes) */
  hueShift: number;
  /** Bundled pet id drawn instead of the `palette` human (absent, or not loaded = human). */
  pet?: string;
  /** Animation frame index */
  frame: number;
  /** Time accumulator for animation */
  frameTimer: number;
  /** Follower: seconds before it tries again to reach its leader */
  followTimer: number;
  /** Whether the agent is actively working */
  isActive: boolean;
  /** Assigned seat uid, or null if no seat */
  seatId: string | null;
  /** Active speech bubble type, or null if none showing */
  bubbleType: 'permission' | 'waiting' | null;
  /** Only meaningful while bubbleType === 'waiting': true when the agent went
   *  idle waiting on the user (surfaces the "Waiting for input" label);
   *  false/undefined when the agent simply finished its turn (checkmark only,
   *  label falls through to idle). */
  waitingAwaitingInput?: boolean;
  /** Countdown timer for bubble (waiting: 2→0, permission: unused) */
  bubbleTimer: number;
  /** Whether this character represents a sub-agent (spawned by Task tool) */
  isSubagent: boolean;
  /** Parent agent ID if this is a sub-agent, null otherwise */
  parentAgentId: number | null;
  /** Active matrix spawn/despawn effect, or null */
  matrixEffect: 'spawn' | 'despawn' | null;
  /** Timer counting up from 0 to MATRIX_EFFECT_DURATION */
  matrixEffectTimer: number;
  /** Per-column random seeds (16 values) for staggered rain timing */
  matrixEffectSeeds: number[];
  /** Directory name — the agent's origin label (only set for multi-root workspaces) */
  directoryName?: string;
  /** Headless agent: adopted from outside the office, so there is no terminal to
   *  focus. Rendered translucent. Teammates and sub-agents are never headless —
   *  clicking them reaches their lead's / parent's terminal. */
  isHeadless?: boolean;
  /** The first-run consent greeter. A MARKER, not a gate: the greeter lives in
   *  OfficeState.greeter, outside the agent map, so seat assignment, palette
   *  diversity, the FSM, hit-testing and seat persistence never see it — no
   *  per-consumer guard reads this flag. It exists for the render/e2e snapshot
   *  (testHooks.getCharacters) to tell the greeter from agents. */
  isGreeter?: boolean;

  // -- LAN rooms --
  /** Area label of the agent's room: seats and standing spots stay inside it. */
  homeArea?: string;
  /** Leader (parent or its ghost) this child walks beside, hand in hand; never sits. */
  followId?: number;
  /** Set on a parent's ghost: the real parent's character id (its own id when the
   *  parent is absent). Drawn translucent; stands still at the head of the line. */
  ghostOf?: number;

  // -- Agent Teams --
  /** Team name this agent belongs to */
  teamName?: string;
  /** Role name within the team (null for lead) */
  agentName?: string;
  /** Whether this agent is the team lead */
  isTeamLead?: boolean;
  /** ID of the lead agent (set on teammates) */
  leadAgentId?: number;
  /** True when lead spawns teammates via tmux (run_in_background Agent calls) */
  teamUsesTmux?: boolean;

  // -- Context gauge --
  /** Tokens in the agent's context as of its newest turn; 0 until reported.
   *  Sub-agents have no session of their own and stay at 0. */
  contextTokens: number;
  /** Window `contextTokens` is measured against. */
  maxContextTokens: number;
}

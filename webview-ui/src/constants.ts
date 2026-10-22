import type { Provider, Room } from '../../core/src/lan.js';
import type { ColorValue } from './components/ui/types.js';

// ── Grid & Layout ────────────────────────────────────────────
export const TILE_SIZE = 16;
export const DEFAULT_COLS = 20;
export const DEFAULT_ROWS = 11;
export const MAX_COLS = 64;
export const MAX_ROWS = 64;

// ── Character Animation ─────────────────────────────────────
export const WALK_SPEED_PX_PER_SEC = 48;
export const WALK_FRAME_DURATION_SEC = 0.15;
export const TYPE_FRAME_DURATION_SEC = 0.3;
export const WANDER_PAUSE_MIN_SEC = 2.0;
export const WANDER_PAUSE_MAX_SEC = 20.0;
export const WANDER_MOVES_BEFORE_REST_MIN = 3;
export const WANDER_MOVES_BEFORE_REST_MAX = 6;
/** A follower that found no free tile beside its parent retries after this long. */
export const FOLLOW_RETRY_SEC = 1.0;
export const SEAT_REST_MIN_SEC = 120.0;
export const SEAT_REST_MAX_SEC = 240.0;

// ── Matrix Effect ────────────────────────────────────────────
export const MATRIX_EFFECT_DURATION_SEC = 0.3;
export const MATRIX_TRAIL_LENGTH = 6;
export const MATRIX_SPRITE_COLS = 16;
export const MATRIX_SPRITE_ROWS = 24;
export const MATRIX_FLICKER_FPS = 30;
export const MATRIX_FLICKER_VISIBILITY_THRESHOLD = 180;
export const MATRIX_COLUMN_STAGGER_RANGE = 0.3;
export const MATRIX_HEAD_COLOR = '#ccffcc';
export const matrixGreenBright = (a: number): string => `rgba(0, 255, 65, ${a})`;
export const matrixGreenMid = (a: number): string => `rgba(0, 170, 40, ${a})`;
export const matrixGreenDim = (a: number): string => `rgba(0, 85, 20, ${a})`;
export const MATRIX_TRAIL_OVERLAY_ALPHA = 0.6;
export const MATRIX_TRAIL_EMPTY_ALPHA = 0.5;
export const MATRIX_TRAIL_MID_THRESHOLD = 0.33;
export const MATRIX_TRAIL_DIM_THRESHOLD = 0.66;

// ── Rendering ────────────────────────────────────────────────
export const CHARACTER_SITTING_OFFSET_PX = 6;
export const CHARACTER_Z_SORT_OFFSET = 0.5;
export const OUTLINE_Z_SORT_OFFSET = 0.001;
export const SELECTED_OUTLINE_ALPHA = 1.0;
export const HOVERED_OUTLINE_ALPHA = 0.5;
/** Headless agents (adopted, no terminal to focus) render slightly translucent. */
export const HEADLESS_CHARACTER_ALPHA = 0.5;
export const GHOST_PREVIEW_SPRITE_ALPHA = 0.5;
export const GHOST_PREVIEW_TINT_ALPHA = 0.25;
export const SELECTION_DASH_PATTERN: [number, number] = [4, 3];
export const BUTTON_MIN_RADIUS = 6;
export const BUTTON_RADIUS_ZOOM_FACTOR = 3;
export const BUTTON_ICON_SIZE_FACTOR = 0.45;
export const BUTTON_LINE_WIDTH_MIN = 1.5;
export const BUTTON_LINE_WIDTH_ZOOM_FACTOR = 0.5;
export const BUBBLE_FADE_DURATION_SEC = 0.5;
export const BUBBLE_SITTING_OFFSET_PX = 10;
export const BUBBLE_VERTICAL_OFFSET_PX = 24;
export const FALLBACK_FLOOR_COLOR = '#808080';

// ── Rendering - Overlay Colors (canvas, not CSS) ─────────────
export const SEAT_OWN_COLOR = 'rgba(0, 127, 212, 0.35)';
export const SEAT_AVAILABLE_COLOR = 'rgba(0, 200, 80, 0.35)';
export const SEAT_BUSY_COLOR = 'rgba(220, 50, 50, 0.35)';
export const GRID_LINE_COLOR = 'rgba(255,255,255,0.12)';
export const VOID_TILE_OUTLINE_COLOR = 'rgba(255,255,255,0.08)';
export const VOID_TILE_DASH_PATTERN: [number, number] = [2, 2];
export const GHOST_BORDER_HOVER_FILL = 'rgba(60, 130, 220, 0.25)';
export const GHOST_BORDER_HOVER_STROKE = 'rgba(60, 130, 220, 0.5)';
export const GHOST_BORDER_STROKE = 'rgba(255, 255, 255, 0.06)';
export const GHOST_VALID_TINT = '#00ff00';
export const GHOST_INVALID_TINT = '#ff0000';
export const SELECTION_HIGHLIGHT_COLOR = '#007fd4';
export const DELETE_BUTTON_BG = 'rgba(200, 50, 50, 0.85)';
export const ROTATE_BUTTON_BG = 'rgba(50, 120, 200, 0.85)';
export const BUTTON_ICON_COLOR = '#fff';
export const CANVAS_FALLBACK_TILE_COLOR = '#444';
export const CANVAS_ERROR_TILE_COLOR = '#FF00FF';
export const WALL_COLOR = '#3A3A5C';

// ── Camera ───────────────────────────────────────────────────
export const CAMERA_FOLLOW_LERP = 0.1;
export const CAMERA_FOLLOW_SNAP_THRESHOLD = 0.5;

// ── Zoom ─────────────────────────────────────────────────────
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 10;
/** Wheel/pinch zoom: zoom *= exp(-deltaY × this). A 100-px mouse notch ≈ ×1.16. */
export const ZOOM_WHEEL_SENSITIVITY = 0.0015;
/** Zoom +/- buttons multiply / divide by this. */
export const ZOOM_BUTTON_FACTOR = 1.25;
/** Wheel deltaMode 1 (lines) → px, so line-scrolling mice zoom like pixel ones. */
export const WHEEL_LINE_HEIGHT_PX = 40;
/** A zoom this close to an integer counts as that integer (crisp, unscaled frame). */
export const ZOOM_INTEGER_EPSILON = 1e-6;
export const ZOOM_DEFAULT_DPR_FACTOR = 2;
export const ZOOM_LEVEL_FADE_DELAY_MS = 1500;
export const ZOOM_LEVEL_HIDE_DELAY_MS = 2000;
export const ZOOM_LEVEL_FADE_DURATION_SEC = 0.5;
export const PAN_MARGIN_FRACTION = 0.25;
/** Left-button movement (CSS px) before a press becomes a map pan instead of a click */
export const PAN_DRAG_THRESHOLD_PX = 4;

// ── Editor ───────────────────────────────────────────────────
export const UNDO_STACK_MAX_SIZE = 50;
export const LAYOUT_SAVE_DEBOUNCE_MS = 500;
/** data-testid of the office canvas — e2e drives real editor gestures on it. */
export const OFFICE_CANVAS_TEST_ID = 'office-canvas';
/** Ghost-border hover tile when the border isn't shown — off any reachable tile. */
export const GHOST_BORDER_NO_HOVER_TILE = -999;

// ── Layout Import/Export (browser-native, standalone) ────────
/** Suggested filename when exporting the office layout from the standalone browser. */
export const LAYOUT_EXPORT_FILENAME = 'pixel-agents-layout.json';
/** localStorage key of this viewer's UI language ('ko' | 'en'). */
export const LANG_STORAGE_KEY = 'pixel-office.lang';
/** localStorage key: the update version this viewer closed the banner for. */
export const UPDATE_DISMISSED_STORAGE_KEY = 'pixel-office.updateDismissed';
/** localStorage key: epoch ms when this viewer chose [Later] on the install-as-app popup. */
export const INSTALL_DISMISSED_STORAGE_KEY = 'pixel-office.installDismissed';
/** [Later] hides the install popup for 7 days. */
export const INSTALL_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
/** MIME type for the exported layout Blob. */
export const LAYOUT_EXPORT_MIME = 'application/json';
export const DEFAULT_FLOOR_COLOR: ColorValue = { h: 35, s: 30, b: 15, c: 0 };
export const DEFAULT_WALL_COLOR: ColorValue = { h: 240, s: 25, b: 0, c: 0 };
export const DEFAULT_NEUTRAL_COLOR: ColorValue = { h: 0, s: 0, b: 0, c: 0 };

// ── Map background (outside the office + VOID tiles) ─────────
/** Solid background offered when the Background tab is first used: the page navy (#181828). */
export const BACKGROUND_DEFAULT_COLOR: ColorValue = { h: 240, s: 25, b: -76, c: 0, colorize: true };
/** Floor tint offered for a floor background (a dim gray-blue, so the office stands out). */
export const BACKGROUND_DEFAULT_FLOOR_COLOR: ColorValue = { h: 220, s: 15, b: -45, c: 0 };
export const BACKGROUND_DEFAULT_FLOOR_PATTERN = 1;
export const BACKGROUND_DEFAULT_CARPET_VARIANT = 0;
/** A carpet background repeats one rug of this many tiles square (body + accent trim). */
export const BACKGROUND_CARPET_PATCH_TILES = 2;

// ── Carpets ──────────────────────────────────────────────────
/** Main (lowest-luminance) color applied to carpets when no per-tile override is set. */
export const CARPET_DEFAULT_COLOR: ColorValue = { h: 0, s: 71, b: -32, c: 0, colorize: true };
/** Accent (highest-luminance) color applied to carpets when no per-tile override is set. */
export const CARPET_DEFAULT_ACCENT_COLOR: ColorValue = {
  h: 34,
  s: 64,
  b: 21,
  c: 0,
  colorize: true,
};
/** Keyboard key that switches from CARPET_PAINT to CARPET_PICK while editing. */
export const KEY_CARPET_PICK = 'p';

// ── Areas (named, colored Directory zones) ───────────────────
/** Color palette assigned to new Areas in rotation (cycles when more areas exist). */
export const AREA_DEFAULT_COLORS: readonly string[] = [
  '#ff6b6b',
  '#feca57',
  '#48dbfb',
  '#1dd1a1',
  '#5f27cd',
  '#ff9ff3',
  '#54a0ff',
  '#ffa502',
] as const;
/** Translucent overlay alpha for area tile fills. */
export const AREA_OVERLAY_ALPHA = 0.25;
/** Alpha multiplier applied to the actively-selected area's overlay. */
export const AREA_ACTIVE_ALPHA_MULTIPLIER = 1.6;
/** Base font size (pixel-pre-zoom) for area centroid labels. */
export const AREA_LABEL_FONT_SIZE_PX = 14;
/** Minimum on-screen label size to keep labels legible at low zoom. */
export const AREA_LABEL_MIN_FONT_SIZE_PX = 12;
/** Alpha of the area label text. */
export const AREA_LABEL_ALPHA = 1.0;
/** Fallback label color when an area has no color set (shouldn't happen in practice). */
export const AREA_LABEL_FALLBACK_COLOR = '#ffffff';
/** Drop-shadow color behind area labels for legibility on light backgrounds. */
export const AREA_LABEL_SHADOW_COLOR = '#000000';
/** Drop-shadow alpha behind area labels. */
export const AREA_LABEL_SHADOW_ALPHA = 0.6;

// ── VisualColorPicker (HSV wheel + brightness for carpets) ───
export const VISUAL_COLOR_PICKER_SV_SIZE_PX = 180;
export const VISUAL_COLOR_PICKER_HUE_WIDTH_PX = 20;
export const VISUAL_COLOR_PICKER_MARKER_RADIUS_PX = 6;
/**
 * The hue bar gradient is intrinsic to the color-picking interaction, not a
 * theme color — it must span the full hue circle. Centralized here so the
 * component body stays free of inline color literals. (The saturation/brightness
 * square is painted to a canvas from the carpet HSL model, not a CSS gradient.)
 */
export const VISUAL_COLOR_PICKER_HUE_GRADIENT =
  'linear-gradient(to bottom, ' +
  '#ff0000 0%, #ffff00 16.7%, #00ff00 33.3%, ' +
  '#00ffff 50%, #0000ff 66.7%, #ff00ff 83.3%, #ff0000 100%)';
export const VISUAL_COLOR_PICKER_MARKER_BORDER = '2px solid #fff';
export const VISUAL_COLOR_PICKER_MARKER_SHADOW = '0 0 0 1px rgba(0,0,0,0.6)';
/** Width of the collapsed swatch + hex trigger row (compact mode). */
export const VISUAL_COLOR_PICKER_COMPACT_WIDTH_PX = 160;
/** Swatch square size shown in the collapsed trigger. */
export const VISUAL_COLOR_PICKER_SWATCH_PX = 22;
/** Gap (px) between the collapsed trigger and the expanded popup panel. */
export const VISUAL_COLOR_PICKER_POPUP_GAP_PX = 6;

// ── Notification Sound (done: ascending chime) ─────────────
export const NOTIFICATION_NOTE_1_HZ = 659.25; // E5
export const NOTIFICATION_NOTE_2_HZ = 1318.51; // E6 (octave up)
export const NOTIFICATION_NOTE_1_START_SEC = 0;
export const NOTIFICATION_NOTE_2_START_SEC = 0.1;
export const NOTIFICATION_NOTE_DURATION_SEC = 0.18;
export const NOTIFICATION_VOLUME = 0.14;

// ── Permission Sound (attention: descending double tap) ────
export const PERMISSION_NOTE_1_HZ = 880; // A5
export const PERMISSION_NOTE_2_HZ = 659.25; // E5 (down a fourth)
export const PERMISSION_NOTE_1_START_SEC = 0;
export const PERMISSION_NOTE_2_START_SEC = 0.12;
export const PERMISSION_NOTE_DURATION_SEC = 0.15;
export const PERMISSION_VOLUME = 0.12;

// ── Furniture Animation ─────────────────────────────────────
export const FURNITURE_ANIM_INTERVAL_SEC = 0.2;

// ── Version Notice ──────────────────────────────────────────
export const WHATS_NEW_AUTO_CLOSE_MS = 20000;
export const WHATS_NEW_FADE_MS = 1000;

// ── Game Logic ───────────────────────────────────────────────
export const MAX_DELTA_TIME_SEC = 0.1;
export const WAITING_BUBBLE_DURATION_SEC = 2.0;
export const DISMISS_BUBBLE_FAST_FADE_SEC = 0.3;
export const INACTIVE_SEAT_TIMER_MIN_SEC = 3.0;
export const INACTIVE_SEAT_TIMER_RANGE_SEC = 2.0;
/** Default/fallback palette count (bundled characters). Actual count comes from getLoadedCharacterCount(). */
export const PALETTE_COUNT = 6;
export const AUTO_ON_FACING_DEPTH = 3;
export const AUTO_ON_SIDE_DEPTH = 2;
export const CHARACTER_HIT_HALF_WIDTH = 8;
export const CHARACTER_HIT_HEIGHT = 24;

// ── Greeter + Intro bubble ──────────────────────────────────
/** Reserved character id for the Intro's greeter. Far outside both real agent
 *  ids (positive) and sub-agent ids (small negatives from -1 down). */
export const GREETER_ID = -1_000_000_000;
/** The greeter stands this many tiles in from the office's bottom-left corner
 *  (target tile (margin, rows-1-margin); nearest walkable tile if blocked). */
export const GREETER_TILE_MARGIN = 3;

// ── Context Fuel Gauge ──────────────────────────────────────
/** Window assumed before the runtime reports one (it always does for agents
 *  that have taken a turn; this only covers characters created ahead of it). */
export const DEFAULT_MAX_CONTEXT_TOKENS = 200_000;

// ── Pets ────────────────────────────────────────────────────────
/** Walking speed in world pixels per second (matches character walk speed visually but slower). */
export const PET_WALK_SPEED_PX_PER_SEC = 32;
/** Time per WALK animation cycle step (4 cycle steps × 0.15s = 0.6s per loop). */
export const PET_WALK_FRAME_DURATION_SEC = 0.15;
/** Time per IDLE animation cycle step (4 cycle steps × 0.3s = 1.2s per loop). */
export const PET_IDLE_FRAME_DURATION_SEC = 0.3;
/** Walk cycle: 4-step lookup into the 3-frame walkDown/walkUp/walkRight arrays. */
export const PET_WALK_SEQUENCE = [0, 1, 0, 2] as const;
/** Idle cycle: 4-step lookup into the 3-frame idleDown/idleUp arrays. */
export const PET_IDLE_SEQUENCE = [0, 1, 2, 1] as const;
/** Minimum seconds the pet stays in IDLE before making a new decision. */
export const PET_WANDER_PAUSE_MIN_SEC = 3.0;
/** Maximum seconds the pet stays in IDLE before making a new decision. */
export const PET_WANDER_PAUSE_MAX_SEC = 15.0;
/** Seconds between FOLLOW path re-computations. */
export const PET_FOLLOW_RECALC_INTERVAL_SEC = 1.0;
/** Probability that a pet enters FOLLOW (instead of WALK) when wanderTimer expires. */
export const PET_FOLLOW_CHANCE = 0.3;
/** Maximum Manhattan distance (tiles) at which a character can become a follow target. */
export const PET_FOLLOW_RADIUS_TILES = 3;
/** Minimum seconds a FOLLOW episode lasts before timing out. */
export const PET_FOLLOW_DURATION_MIN_SEC = 5.0;
/** Maximum seconds a FOLLOW episode lasts before timing out. */
export const PET_FOLLOW_DURATION_MAX_SEC = 15.0;
/** Hit-box half-width (world px) for pet click detection. */
export const PET_HIT_HALF_WIDTH = 8;
/** Hit-box height (world px) measured upward from the bottom-center anchor. */
export const PET_HIT_HEIGHT = 16;
/** Zoom factor used to draw pet thumbnails in the EditorToolbar Pets tab. */
export const PET_THUMB_ZOOM = 2;
/** Scale margin so the pet thumbnail fills the ItemSelect cell without touching the edges. */
export const PET_THUMB_SCALE_MARGIN = 0.85;
/** Fallback background fill for sprite-less thumbnail (used while pet sprites are loading). */
export const EMPTY_SPRITE_THUMBNAIL_BG = '#333';
/** Maximum string length for a PlacedPet.id (defends against pathologically-long layout entries). */
export const MAX_PET_ID_LENGTH = 128;

// ── WebSocket reconnect (standalone only) ────────────────────
/** Reconnect backoff ladder for the /ws transport (transport/reconnectBackoff.ts).
 *  The last rung repeats. */
export const WS_RECONNECT_DELAYS_MS = [250, 500, 1_000, 2_000, 4_000] as const;

// ── Mobile ───────────────────────────────────────────────────
// Below this the app uses touch-friendly chrome (no zoom buttons, floating
// Settings). Phones match the first clause in either orientation; the second
// catches touch tablets.
export const MOBILE_MEDIA_QUERY = '(max-width: 768px), ((pointer: coarse) and (max-width: 1024px))';

// ── Touch input (every surface) ──────────────────────────────
/** Tap slop shared by every touch surface (withinTapSlop): a finger that
 *  travels less than this from where it landed is still a tap; beyond it the
 *  gesture becomes that surface's drag (pan, scroll, reorder). */
export const TOUCH_TAP_MAX_MOVE_PX = 10;
/** A press longer than this is not a tap even if the finger never moved. */
export const TOUCH_TAP_MAX_DURATION_MS = 350;

// ── Dropdown ─────────────────────────────────────────────────
/** Gap a viewport-fitted Dropdown keeps from the top of the viewport when its
 *  content is taller than the room above its anchor. */
export const DROPDOWN_VIEWPORT_MARGIN_PX = 8;

// ── LAN agents ──────────────────────────────────────────────
/** Animation tool per room: typing (coding/server), reading (library), none = idle wander (lounge). */
export const LAN_ROOM_TOOL: Record<Room, string | null> = {
  coding: 'Edit',
  library: 'Read',
  server: 'Bash',
  lounge: null,
};
/** Tools drawn with the reading animation (no provider sends providerCapabilities). */
export const LAN_READING_TOOLS = ['Read'];
/** Subagents wear their PC's palette, hue-rotated by this much. */
export const LAN_SUBAGENT_HUE_OFFSET = 120;
export const MAX_HUE_DEG = 360;
/** Skin colors of char_0..5.png (measured); exempt from a character's hue shift. */
export const CHARACTER_SKIN_COLORS: ReadonlySet<string> = new Set([
  '#E9A384',
  '#C5896E',
  '#FBBF97',
  '#FFD8B2',
  '#E29878',
  '#BD8068',
  '#84523A',
  '#FFF2EC',
  '#FCD6C4',
  '#E1AA91',
  '#CF9D86',
  '#BA917E',
  '#5F4132',
  '#493227',
  '#B67352',
  '#8C583F',
]);
/** A parent's ghost, leading its children in a room the parent is not in. */
export const LAN_GHOST_ALPHA = 0.45;
/** Shell characters share one fixed look. */
export const LAN_SHELL_PALETTE = 3;
/** Provider badge dot in a main agent's name tag. */
export const LAN_PROVIDER_COLORS: Record<Provider, string> = {
  claude: '#D97757',
  codex: '#10A37F',
};
/** Hover bubble wraps long summaries/reasons at this width (CSS px). */
export const LAN_BUBBLE_MAX_WIDTH_PX = 300;
/** Hover bubble sits this many world px above a character's feet (sprite height). */
export const LAN_BUBBLE_HEAD_OFFSET = 32;
export const LAN_TAG_Z_INDEX = 40;
export const LAN_PERMISSION_Z_INDEX = 41;
export const LAN_BUBBLE_Z_INDEX = 42;
/** Room names on the map outside Show Areas: light text, dark outline, top of each room. */
export const LAN_ROOM_LABEL_COLOR = '#f2f2f2';
export const LAN_ROOM_LABEL_OUTLINE_COLOR = '#000000';
/** Outline stroke width in device px. */
export const LAN_ROOM_LABEL_OUTLINE_PX = 4;
/** Font size per zoom step (sprite px), floored at the minimum in device px. */
export const LAN_ROOM_LABEL_FONT_PX = 7;
export const LAN_ROOM_LABEL_MIN_FONT_PX = 13;

// ── Team offices ─────────────────────────────────────────────
/** Office name length the server accepts (server MAX_OFFICE_NAME). */
export const MAX_OFFICE_NAME = 20;
/** How long "copied" stays next to a Copy button. */
export const OFFICE_COPIED_MS = 2_000;

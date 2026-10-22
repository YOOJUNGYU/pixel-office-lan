import type { Provider, Room } from '../../core/src/lan.js';
import { MAX_LAYOUT_COLS, MAX_LAYOUT_ROWS, ROOM_DEFAULT_COLORS } from '../../core/src/lan.js';
import type { ColorValue } from './components/ui/types.js';

// ── Grid & Layout ────────────────────────────────────────────
export const TILE_SIZE = 16;
export const DEFAULT_COLS = 20;
export const DEFAULT_ROWS = 11;
export const MAX_COLS = MAX_LAYOUT_COLS;
export const MAX_ROWS = MAX_LAYOUT_ROWS;
/** The bundled default layout (rooms of an imported layout that lacks them), relative to the base URL. */
export const DEFAULT_LAYOUT_ASSET = 'assets/default-layout-1.json';
/** Floor chunk cache budget (device px², all chunks; chunks on screen are always kept). */
export const FLOOR_CACHE_MAX_PIXELS = 4096 * 4096;
/** Floor chunk side in device px (rounded to whole tiles) and its minimum in tiles. */
export const FLOOR_CHUNK_PX = 512;
export const FLOOR_CHUNK_MIN_TILES = 4;
/** Random tiles tried before scanning a whole room for a free one. */
export const FREE_TILE_PROBES = 16;

// ── Character Animation ─────────────────────────────────────
export const WALK_SPEED_PX_PER_SEC = 48;
export const WALK_FRAME_DURATION_SEC = 0.15;
export const TYPE_FRAME_DURATION_SEC = 0.3;
/** A follower that found no free tile beside its parent retries after this long. */
export const FOLLOW_RETRY_SEC = 1.0;

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
/** Low enough that the whole 128×128 office fits a 1280×720 screen. */
export const ZOOM_MIN = 0.25;
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

// ── Layout Import/Export (browser-native, standalone) ────────
/** Suggested filename when exporting the office layout from the standalone browser. */
export const LAYOUT_EXPORT_FILENAME = 'pixel-agents-layout.json';
/** localStorage key of this viewer's UI language ('ko' | 'en'). */
export const LANG_STORAGE_KEY = 'pixel-office.lang';
/** localStorage key: the update version this viewer closed the banner for. */
export const UPDATE_DISMISSED_STORAGE_KEY = 'pixel-office.updateDismissed';
/** nicknameKey of the last nickname clash whose rename notice was handled (shown once per clash). */
export const NICKNAME_NOTICE_STORAGE_KEY = 'pixel-office.nicknameNotice';
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

// ── Areas (the four fixed rooms) ─────────────────────────────
/** Room overlay colors of the bundled default layout: a layout missing a room gets these. */
export const ROOM_AREA_COLORS: Readonly<Record<Room, string>> = ROOM_DEFAULT_COLORS;
/** Translucent overlay alpha for area tile fills. */
export const AREA_OVERLAY_ALPHA = 0.25;
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
/** Default/fallback palette count (bundled characters). Actual count comes from getLoadedCharacterCount(). */
export const PALETTE_COUNT = 6;
export const AUTO_ON_FACING_DEPTH = 3;
export const AUTO_ON_SIDE_DEPTH = 2;
export const CHARACTER_HIT_HALF_WIDTH = 8;
export const CHARACTER_HIT_HEIGHT = 24;
/** Pet character hit box (measured on claudio/gitcat): front/back frames are
 *  16 px wide, side frames 32; the animal is 16 (sitting) to 21 (walking) px tall. */
export const PET_HIT_HALF_WIDTH = 7;
export const PET_HIT_HALF_WIDTH_SIDE = 11;
export const PET_HIT_HEIGHT = 19;
/** A pet's head is this much lower than a human's: bubbles and the "!" sit lower. */
export const PET_HEAD_DROP_PX = 2;

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

// ── Pet characters (a profile's character may be a pet) ─────
/** Time per IDLE animation cycle step (4 cycle steps × 0.3s = 1.2s per loop). */
export const PET_IDLE_FRAME_DURATION_SEC = 0.3;
/** Walk cycle: 4-step lookup into the 3-frame walkDown/walkUp/walkRight arrays. */
export const PET_WALK_SEQUENCE = [0, 1, 0, 2] as const;
/** Idle cycle: 4-step lookup into the 3-frame idleDown/idleUp arrays. */
export const PET_IDLE_SEQUENCE = [0, 1, 2, 1] as const;
/** A pet's color (hueShift ≠ 0) is a colorize tint, not a hue rotation: gitcat is
 *  nearly black/grey, where rotating the hue changes nothing. Saturation of the tint
 *  and a per-pet lightness lift (colorize `b`) so dark pets show the color. */
export const PET_TINT_SATURATION = 55;
export const PET_TINT_BRIGHTNESS: Readonly<Record<string, number>> = { claudio: 0, gitcat: 40 };

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
/** Animation tool per room: typing (coding/server), reading (library), none = idle (lounge). */
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
/** Badge after a subagent's / shell's name tag (which shows the parent's label). */
export const LAN_KIND_BADGES: Record<
  'subagent' | 'shell',
  { text: string; bg: string; fg: string }
> = {
  subagent: { text: 'SUB', bg: '#5f27cd', fg: '#ffffff' },
  shell: { text: 'SHELL', bg: '#576574', fg: '#ffffff' },
};
/** Waiting/permission "!" over a character's head: red glyph, 1px dark outline. */
export const LAN_ALERT_COLOR = '#e8202a';
export const LAN_ALERT_OUTLINE_COLOR = '#2b0608';
/** The "!" glyph (sprite pixels, before the outline): bar, gap, dot. */
export const LAN_ALERT_GLYPH = ['###', '###', '###', '###', '.#.', '...', '###', '###'];
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

// ── Onboarding tour ──────────────────────────────────────────
/** localStorage flag: this browser finished or skipped the tour. */
export const TOUR_STORAGE_KEY = 'pixel-office.tour.v1';
/** Peer id prefix of the client-only demo characters (never sent anywhere). */
export const TOUR_DEMO_PREFIX = 'tour-demo:';
/** Fewer visible agents than this → the tour adds demo characters. */
export const TOUR_DEMO_MIN_AGENTS = 3;
/** Wait for the first snapshot before deciding on demos. */
export const TOUR_AUTOSTART_DELAY_MS = 800;
export const TOUR_DIM_COLOR = 'rgba(0, 0, 0, 0.62)';
export const TOUR_Z_INDEX = 100;
/** Spotlight padding around a target, and the gap every hole/tooltip keeps from the viewport edge. */
export const TOUR_SPOTLIGHT_PAD_PX = 6;
export const TOUR_VIEWPORT_MARGIN_PX = 8;
export const TOUR_TOOLTIP_GAP_PX = 12;
export const TOUR_TOOLTIP_MAX_WIDTH_PX = 340;
/** Fraction of the remaining distance a spotlight hole moves per frame. */
export const TOUR_SPOTLIGHT_EASE = 0.25;
/** Spotlight outline width (CSS px). */
export const TOUR_OUTLINE_PX = 2;
/** The tour fits the whole office into this fraction of the screen. */
export const TOUR_FIT_FILL = 0.92;
/** First open: share of the window the whole office fills when it would not fit at the default zoom. */
export const FIRST_OPEN_FIT_FILL = 0.95;
/** First-open fit leaves this much room at the top (CSS px): the office switcher + a gap. */
export const FIT_TOP_MARGIN_PX = 56;
/** How long the "layout not saved" toast stays. */
export const LAYOUT_REJECTED_TOAST_MS = 4_000;

// ── App version ─────────────────────────────────────────────
/** An unbuilt (dev/test) server's version: never triggers a reload. */
export const DEV_SERVER_VERSION = '0.0.0';
/** sessionStorage: the server version this tab last reloaded for (no reload loop). */
export const VERSION_RELOAD_KEY = 'pixel-office.reloadedFor';

// ── Room legend (top left) ───────────────────────────────────
/** localStorage: '1' = open, '0' = collapsed (per viewer); unset = open on a wide screen. */
export const ROOM_LEGEND_KEY = 'pixel-office.roomLegend';
/** Below the zoom buttons (desktop) / the Settings button (mobile), CSS px. */
export const ROOM_LEGEND_TOP_PX = 100;
export const ROOM_LEGEND_MOBILE_TOP_PX = 56;

// ── People panel ─────────────────────────────────────────────
/** localStorage: '1' = collapsed, '0' = expanded (per viewer); unset = by screen width. */
export const PEOPLE_COLLAPSED_KEY = 'pixel-office.people.collapsed';
/** Narrower than this (CSS px) the panel starts collapsed. */
export const PEOPLE_WIDE_MIN_PX = 1100;
/** Face crop of the standing frame (sprite rows) and its integer scale. */
export const PEOPLE_FACE_TOP = 10;
export const PEOPLE_FACE_ROWS = 14;
/** Pet face crop (rows of the front idle frame; the animal starts at row 15). */
export const PEOPLE_PET_FACE_TOP = 15;
export const PEOPLE_FACE_SCALE = 2;
/** How long the "no agents" hint stays after clicking an agentless row. */
export const PEOPLE_HINT_MS = 2_000;
/** Top-right stack (update banner, install popup, people panel): room kept clear below it, CSS px. */
export const TOP_RIGHT_BOTTOM_RESERVE_PX = 64;
/** Top-right stack: above name tags and bubbles (LAN_*_Z_INDEX), below modals (50). */
export const TOP_RIGHT_Z_INDEX = 43;

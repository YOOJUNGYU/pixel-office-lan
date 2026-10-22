#!/usr/bin/env node
// Generates the bundled four-room LAN office layout (deterministic — no randomness).
//   node scripts/generate-lan-layout.mjs > webview-ui/public/assets/default-layout-1.json
//
//   ┌──────────┬────────────┬────────────┐
//   │  코딩실   │   자료실    │   서버실    │   doors in the side walls + bottom walls
//   ├──  ──────┴─────  ─────┴─────  ─────┤
//   │               corridor              │
//   ├────  ────────────  ───────────  ───┤
//   │                대기실               │   widest room: overflow agents stand here
//   └──────────────────────────────────────┘

const WALL = 0;
const VOID = 255;
const FLOOR_1 = 1;
const FLOOR_4 = 4;
const FLOOR_7 = 7;
const FLOOR_9 = 9;

// Grid geometry (cols × rows). Row 0 is void headroom for the 2-tile-tall top wall sprites.
const TOP_WALL = 1;
const TOP_Y = 2; // first interior row of the top rooms
const TOP_H = 48;
const MID_WALL = TOP_Y + TOP_H; // 50
const CORRIDOR_Y = MID_WALL + 1; // 51
const CORRIDOR_H = 5;
const LOUNGE_WALL = CORRIDOR_Y + CORRIDOR_H; // 56
const LOUNGE_Y = LOUNGE_WALL + 1; // 57
const LOUNGE_H = 70;
const ROWS = LOUNGE_Y + LOUNGE_H + 1; // 128

const CODING = { label: '코딩실', color: '#48dbfb', x: 1, w: 41, y: TOP_Y, h: TOP_H };
const LIBRARY = {
  label: '자료실',
  color: '#1dd1a1',
  x: CODING.x + CODING.w + 1,
  w: 41,
  y: TOP_Y,
  h: TOP_H,
};
const SERVER = {
  label: '서버실',
  color: '#ff6b6b',
  x: LIBRARY.x + LIBRARY.w + 1,
  w: 42,
  y: TOP_Y,
  h: TOP_H,
};
const COLS = SERVER.x + SERVER.w + 1; // 128
const LOUNGE = { label: '대기실', color: '#feca57', x: 1, w: COLS - 2, y: LOUNGE_Y, h: LOUNGE_H };

// Floor pattern + colour per zone (ColorValue {h,s,b,c}, same as the editor writes).
const FLOOR = {
  coding: { tile: FLOOR_7, color: { h: 214, s: 30, b: -60, c: -40 } },
  library: { tile: FLOOR_1, color: { h: 30, s: 45, b: -35, c: -60 } },
  server: { tile: FLOOR_9, color: { h: 200, s: 10, b: -25, c: -40 } },
  lounge: { tile: FLOOR_4, color: { h: 25, s: 48, b: -20, c: -70 } },
  corridor: { tile: FLOOR_1, color: { h: 209, s: 0, b: -20, c: -60 } },
};
const WALL_COLOR = { h: 214, s: 30, b: -100, c: -55 };

const tiles = new Array(COLS * ROWS).fill(VOID);
const tileColors = new Array(COLS * ROWS).fill(null);
const areaTiles = new Array(COLS * ROWS).fill(null);
const furniture = [];
const idx = (c, r) => r * COLS + c;

function rect(x, y, w, h, fn) {
  for (let r = y; r < y + h; r++) for (let c = x; c < x + w; c++) fn(c, r);
}
function wall(c, r) {
  tiles[idx(c, r)] = WALL;
  tileColors[idx(c, r)] = WALL_COLOR;
}
function floor(c, r, f, label = null) {
  tiles[idx(c, r)] = f.tile;
  tileColors[idx(c, r)] = f.color;
  areaTiles[idx(c, r)] = label;
}
let seq = 0;
function put(type, col, row) {
  furniture.push({ uid: `lan-${String(seq++).padStart(3, '0')}`, type, col, row });
}

// ── Shell: everything inside the outer wall is wall, then rooms are carved out ──
rect(0, TOP_WALL, COLS, ROWS - TOP_WALL, wall);
const room = (r, f) => rect(r.x, r.y, r.w, r.h, (c, row) => floor(c, row, f, r.label));
room(CODING, FLOOR.coding);
room(LIBRARY, FLOOR.library);
room(SERVER, FLOOR.server);
room(LOUNGE, FLOOR.lounge);
rect(1, CORRIDOR_Y, COLS - 2, CORRIDOR_H, (c, r) => floor(c, r, FLOOR.corridor));

// ── Doors (2-tile gaps, unzoned corridor floor) ──
const door = (x, y, w, h) => rect(x, y, w, h, (c, r) => floor(c, r, FLOOR.corridor));
// Two doors per wall: at a quarter and three quarters of each room's width (or height).
const quarters = (r) => [r.x + Math.floor(r.w / 4) - 1, r.x + Math.floor((3 * r.w) / 4) - 1];
for (const r of [CODING, LIBRARY, SERVER]) for (const x of quarters(r)) door(x, MID_WALL, 2, 1);
for (const y of [TOP_Y + Math.floor(TOP_H / 2) - 1, TOP_Y + TOP_H - 2]) {
  door(LIBRARY.x - 1, y, 1, 2); // 코딩실 ↔ 자료실
  door(SERVER.x - 1, y, 1, 2); // 자료실 ↔ 서버실
}
for (const r of [CODING, LIBRARY, SERVER]) for (const x of quarters(r)) door(x, LOUNGE_WALL, 2, 1);

// ── 코딩실: 9 rows × 2 blocks of 4 desks, PCs on each desk, 3 chairs facing up under each desk ──
for (let row = 0; row < 9; row++) {
  for (let d = 0; d < 8; d++) {
    const c = CODING.x + 3 + d * 4 + (d >= 4 ? 3 : 0);
    const y = CODING.y + 1 + row * 5;
    put('DESK_FRONT', c, y);
    put('PC_FRONT_OFF', c, y);
    put('PC_FRONT_OFF', c + 2, y);
    for (let k = 0; k < 3; k++) put('CUSHIONED_CHAIR_BACK', c + k, y + 2);
  }
}
for (const x of [3, 15, 30]) put('WHITEBOARD', CODING.x + x, TOP_WALL - 1);
put('CLOCK', CODING.x + 23, TOP_WALL - 1);
put('PLANT', CODING.x, CODING.y + CODING.h - 2);
put('BIN', CODING.x + CODING.w - 1, CODING.y + CODING.h - 1);

// ── 자료실: wall of bookshelves, 6 rows × 6 reading tables (4 seats each), shelf stacks ──
for (let x = LIBRARY.x; x + 1 < LIBRARY.x + LIBRARY.w; x += 2) {
  put('DOUBLE_BOOKSHELF', x, TOP_WALL - 1);
}
for (let row = 0; row < 6; row++) {
  for (let t = 0; t < 6; t++) {
    const c = LIBRARY.x + 3 + t * 6;
    const y = LIBRARY.y + 1 + row * 4;
    put('SMALL_TABLE_FRONT', c, y);
    put('CUSHIONED_CHAIR_SIDE', c - 1, y + 1);
    put('CUSHIONED_CHAIR_SIDE:left', c + 2, y + 1);
    put('CUSHIONED_CHAIR_BACK', c, y + 2);
    put('CUSHIONED_CHAIR_BACK', c + 1, y + 2);
  }
}
for (const y of [27, 33, 39]) {
  for (const x of [1, 4, 7, 10, 29, 32, 35, 38])
    put('DOUBLE_BOOKSHELF', LIBRARY.x + x, LIBRARY.y + y);
}
put('LARGE_PLANT', LIBRARY.x + 19, LIBRARY.y + 32);

// ── 서버실: 7 rows × 6 workstation tables, PC on every seat, wooden chairs both sides ──
for (let row = 0; row < 7; row++) {
  for (let t = 0; t < 6; t++) {
    const c = SERVER.x + 4 + t * 6 + (t >= 3 ? 2 : 0);
    const y = SERVER.y + 1 + row * 5;
    put('TABLE_FRONT', c, y);
    for (const dy of [0, 2]) {
      put('PC_SIDE', c, y + dy);
      put('PC_SIDE:left', c + 2, y + dy);
      put('WOODEN_CHAIR_SIDE', c - 1, y + dy);
      put('WOODEN_CHAIR_SIDE:left', c + 3, y + dy);
    }
  }
}
put('LARGE_PAINTING', SERVER.x + 4, TOP_WALL - 1);
put('SMALL_PAINTING', SERVER.x + 14, TOP_WALL - 1);
put('CLOCK', SERVER.x + 21, TOP_WALL - 1);
put('LARGE_PAINTING', SERVER.x + 28, TOP_WALL - 1);
put('SMALL_PAINTING', SERVER.x + 37, TOP_WALL - 1);
put('BIN', SERVER.x, SERVER.y + SERVER.h - 1);
put('CACTUS', SERVER.x + SERVER.w - 1, SERVER.y + SERVER.h - 2);

// ── 대기실: 5 rows × 9 sofa lounges (8 seats each) + coffee corner, lots of open floor ──
for (let row = 0; row < 5; row++) {
  for (let k = 0; k < 9; k++) {
    const c = LOUNGE.x + 4 + k * 14;
    const y = LOUNGE.y + 4 + row * 12;
    put('COFFEE_TABLE', c, y);
    put('COFFEE', c + (k % 2), y + 1);
    put('SOFA_FRONT', c, y - 1);
    put('SOFA_BACK', c, y + 2);
    put('SOFA_SIDE', c - 1, y);
    put('SOFA_SIDE:left', c + 2, y);
  }
}
const bar = LOUNGE.x + LOUNGE.w - 4;
put('SMALL_TABLE_FRONT', bar, LOUNGE.y + 5);
put('COFFEE', bar, LOUNGE.y + 6);
put('COFFEE', bar + 1, LOUNGE.y + 6);
for (let x = 1; x < LOUNGE.w - 2; x += 15) put('PLANT_2', LOUNGE.x + x, LOUNGE.y + LOUNGE.h - 2);
put('LARGE_PLANT', LOUNGE.x, LOUNGE.y);
put('LARGE_PLANT', LOUNGE.x + LOUNGE.w - 2, LOUNGE.y + LOUNGE.h - 3);
put('POT', LOUNGE.x + LOUNGE.w - 1, LOUNGE.y);
put('BIN', bar + 2, LOUNGE.y + 5);

const layout = {
  version: 1,
  cols: COLS,
  rows: ROWS,
  layoutRevision: 1,
  tiles,
  tileColors,
  furniture,
  areas: [CODING, LIBRARY, SERVER, LOUNGE].map(({ label, color }) => ({ label, color })),
  areaTiles,
};

// Pretty-print with one grid row per line so diffs stay readable.
const grid = (arr) =>
  '[\n' +
  Array.from({ length: ROWS }, (_, r) =>
    arr
      .slice(r * COLS, (r + 1) * COLS)
      .map((v) => JSON.stringify(v))
      .join(','),
  )
    .map((line) => `    ${line}`)
    .join(',\n') +
  '\n  ]';
const out = JSON.stringify(
  layout,
  (k, v) => (['tiles', 'tileColors', 'areaTiles'].includes(k) ? `@@${k}@@` : v),
  2,
).replace(/"@@(\w+)@@"/g, (_, k) => grid(layout[k]));
process.stdout.write(`${out}\n`);

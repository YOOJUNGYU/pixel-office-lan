#!/usr/bin/env node
// Generates the bundled four-room LAN office layout (deterministic — no randomness).
//   node scripts/generate-lan-layout.mjs > webview-ui/public/assets/default-layout-1.json
//   node scripts/generate-lan-layout.mjs --personal > webview-ui/public/assets/default-layout-personal.json
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

// Two variants from one generator:
//   (default)    90×60 shared office  → default-layout-1.json
//   --personal   34×22 personal office → default-layout-personal.json
// Each room is a block of repeated furniture units; a variant only sets the counts.
const PERSONAL = process.argv.includes('--personal');

const V = PERSONAL
  ? {
      topH: 8,
      corridorH: 2,
      loungeH: 7,
      roomW: [10, 10, 11],
      coding: { x0: 2, cols: 2, rows: 2, chairs: [0, 2], bin: [9, 0] },
      library: { x0: 2, step: 4, cols: 2, rows: 1, stacks: [1, 7], stackY: 5, plant: [4, 4] },
      server: { x0: 2, step: 5, cols: 2, rows: 1 },
      lounge: { x0: 15, step: 14, cols: 1, rows: 1, y0: 2, barY: 1, plants: [1, 8, 24] },
      extraLoungeDoors: false,
      wallDeco: {
        coding: [
          ['WHITEBOARD', 1],
          ['CLOCK', 5],
          ['WHITEBOARD', 7],
        ],
        server: [
          ['LARGE_PAINTING', 1],
          ['CLOCK', 6],
          ['SMALL_PAINTING', 8],
        ],
      },
    }
  : {
      topH: 22,
      corridorH: 3,
      loungeH: 30,
      roomW: [28, 29, 29],
      coding: { x0: 4, cols: 5, rows: 5, chairs: [0, 1, 2], bin: [27, 21] },
      library: {
        x0: 2,
        step: 6,
        cols: 5,
        rows: 3,
        stacks: [1, 4, 7, 20, 23, 26],
        stackY: 14,
        plant: [13, 13],
      },
      server: { x0: 4, step: 6, cols: 4, rows: 4 },
      lounge: {
        x0: 4,
        step: 14,
        cols: 6,
        rows: 3,
        y0: 4,
        barY: 5,
        plants: [1, 15, 30, 45, 60, 75],
      },
      extraLoungeDoors: true,
      wallDeco: {
        coding: [
          ['WHITEBOARD', 3],
          ['CLOCK', 13],
          ['WHITEBOARD', 22],
        ],
        server: [
          ['LARGE_PAINTING', 4],
          ['CLOCK', 14],
          ['SMALL_PAINTING', 24],
        ],
      },
    };

// Grid geometry (cols × rows). Row 0 is void headroom for the 2-tile-tall top wall sprites.
const TOP_WALL = 1;
const TOP_Y = 2; // first interior row of the top rooms
const TOP_H = V.topH;
const MID_WALL = TOP_Y + TOP_H;
const CORRIDOR_Y = MID_WALL + 1;
const CORRIDOR_H = V.corridorH;
const LOUNGE_WALL = CORRIDOR_Y + CORRIDOR_H;
const LOUNGE_Y = LOUNGE_WALL + 1;
const LOUNGE_H = V.loungeH;
const ROWS = LOUNGE_Y + LOUNGE_H + 1;

const CODING = { label: '코딩실', color: '#48dbfb', x: 1, w: V.roomW[0], y: TOP_Y, h: TOP_H };
const LIBRARY = {
  label: '자료실',
  color: '#1dd1a1',
  x: CODING.x + CODING.w + 1,
  w: V.roomW[1],
  y: TOP_Y,
  h: TOP_H,
};
const SERVER = {
  label: '서버실',
  color: '#ff6b6b',
  x: LIBRARY.x + LIBRARY.w + 1,
  w: V.roomW[2],
  y: TOP_Y,
  h: TOP_H,
};
const COLS = SERVER.x + SERVER.w + 1;
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
for (const r of [CODING, LIBRARY, SERVER]) door(r.x + Math.floor(r.w / 2) - 1, MID_WALL, 2, 1);
door(LIBRARY.x - 1, TOP_Y + TOP_H - 2, 1, 2); // 코딩실 ↔ 자료실
door(SERVER.x - 1, TOP_Y + TOP_H - 2, 1, 2); // 자료실 ↔ 서버실
for (const r of [CODING, LIBRARY, SERVER]) door(r.x + Math.floor(r.w / 2) - 1, LOUNGE_WALL, 2, 1);
if (V.extraLoungeDoors) {
  for (const x of [Math.floor(COLS / 3), Math.floor((2 * COLS) / 3)]) door(x, LOUNGE_WALL, 2, 1);
}

// ── 코딩실: rows × cols desks, PCs on each desk, chairs facing up under each desk ──
const { coding: cd, library: lb, server: sv, lounge: lg } = V;
for (let row = 0; row < cd.rows; row++) {
  for (let d = 0; d < cd.cols; d++) {
    const c = CODING.x + cd.x0 + d * 4;
    const y = CODING.y + 1 + row * 4;
    put('DESK_FRONT', c, y);
    put('PC_FRONT_OFF', c, y);
    put('PC_FRONT_OFF', c + 2, y);
    for (const k of cd.chairs) put('CUSHIONED_CHAIR_BACK', c + k, y + 2);
  }
}
for (const [type, x] of V.wallDeco.coding) put(type, CODING.x + x, TOP_WALL - 1);
put('PLANT', CODING.x, CODING.y + CODING.h - 2);
put('BIN', CODING.x + cd.bin[0], CODING.y + cd.bin[1]);

// ── 자료실: wall of bookshelves, rows × cols reading tables (4 seats each), shelf stacks ──
for (let x = LIBRARY.x; x + 1 < LIBRARY.x + LIBRARY.w; x += 2) {
  put('DOUBLE_BOOKSHELF', x, TOP_WALL - 1);
}
for (let row = 0; row < lb.rows; row++) {
  for (let t = 0; t < lb.cols; t++) {
    const c = LIBRARY.x + lb.x0 + t * lb.step;
    const y = LIBRARY.y + 1 + row * 4;
    put('SMALL_TABLE_FRONT', c, y);
    put('CUSHIONED_CHAIR_SIDE', c - 1, y + 1);
    put('CUSHIONED_CHAIR_SIDE:left', c + 2, y + 1);
    put('CUSHIONED_CHAIR_BACK', c, y + 2);
    put('CUSHIONED_CHAIR_BACK', c + 1, y + 2);
  }
}
for (const x of lb.stacks) put('DOUBLE_BOOKSHELF', LIBRARY.x + x, LIBRARY.y + lb.stackY);
put('LARGE_PLANT', LIBRARY.x + lb.plant[0], LIBRARY.y + lb.plant[1]);

// ── 서버실: rows × cols workstation tables, PC on every seat, wooden chairs both sides ──
for (let row = 0; row < sv.rows; row++) {
  for (let t = 0; t < sv.cols; t++) {
    const c = SERVER.x + sv.x0 + t * sv.step;
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
for (const [type, x] of V.wallDeco.server) put(type, SERVER.x + x, TOP_WALL - 1);
put('BIN', SERVER.x, SERVER.y + SERVER.h - 1);
put('CACTUS', SERVER.x + SERVER.w - 1, SERVER.y + SERVER.h - 2);

// ── 대기실: rows × cols sofa lounges (8 seats each) + coffee corner, lots of open floor ──
for (let row = 0; row < lg.rows; row++) {
  for (let k = 0; k < lg.cols; k++) {
    const c = LOUNGE.x + lg.x0 + k * lg.step;
    const y = LOUNGE.y + lg.y0 + row * 8;
    put('COFFEE_TABLE', c, y);
    put('COFFEE', c + (k % 2), y + 1);
    put('SOFA_FRONT', c, y - 1);
    put('SOFA_BACK', c, y + 2);
    put('SOFA_SIDE', c - 1, y);
    put('SOFA_SIDE:left', c + 2, y);
  }
}
const bar = LOUNGE.x + LOUNGE.w - 4;
put('SMALL_TABLE_FRONT', bar, LOUNGE.y + lg.barY);
put('COFFEE', bar, LOUNGE.y + lg.barY + 1);
put('COFFEE', bar + 1, LOUNGE.y + lg.barY + 1);
for (const x of lg.plants) put('PLANT_2', LOUNGE.x + x, LOUNGE.y + LOUNGE.h - 2);
put('LARGE_PLANT', LOUNGE.x, LOUNGE.y);
put('LARGE_PLANT', LOUNGE.x + LOUNGE.w - 2, LOUNGE.y + LOUNGE.h - 3);
put('POT', LOUNGE.x + LOUNGE.w - 1, LOUNGE.y);
put('BIN', bar + 2, LOUNGE.y + lg.barY);

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

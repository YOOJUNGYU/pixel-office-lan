#!/usr/bin/env node
// Generates the bundled four-room LAN office layout (deterministic — no randomness).
//   node scripts/generate-lan-layout.mjs > webview-ui/public/assets/default-layout-1.json
//   node scripts/generate-lan-layout.mjs --personal > webview-ui/public/assets/default-layout-personal.json
//
//   ┌──────────┬────────────────┐
//   │  코딩실   │     서버실      │   left column: 코딩실 = 자료실 (same size)
//   ├───  ─────┴───  ────────  ──┤   right column: 서버실 = 대기실 (same size)
//   │           corridor          │
//   ├───  ─────┬───  ────────  ──┤   doors to the corridor + between the two rooms of a row
//   │  자료실   │     대기실      │
//   └──────────┴────────────────┘

const WALL = 0;
const VOID = 255;
const FLOOR_1 = 1;
const FLOOR_4 = 4;
const FLOOR_7 = 7;
const FLOOR_9 = 9;

// Two variants from one generator:
//   (default)    83×54 shared office   → default-layout-1.json
//   --personal   28×23 personal office → default-layout-personal.json
const PERSONAL = process.argv.includes('--personal');

// Each room is a grid of furniture groups with the same free border (`pad`) along all four
// walls; the gaps between groups take up the rest (spread evenly, symmetric).
const V = PERSONAL
  ? {
      roomH: 8,
      corridorH: 2,
      roomW: [10, 15],
      pad: { coding: 1, library: 1, server: 2, lounge: 2 },
      coding: { cols: 2, rows: 2, chairs: [0, 2] },
      // Two tables on opposite corners (the room is too small for a grid).
      library: {
        tables: [
          [2, 1],
          [6, 4],
        ],
      },
      server: { cols: 2, rows: 1 },
      lounge: { cols: 2, rows: 1 },
      extraDoors: false,
      wallDeco: {
        coding: [
          ['WHITEBOARD', 1],
          ['CLOCK', 5],
          ['WHITEBOARD', 7],
        ],
        server: [
          ['LARGE_PAINTING', 2],
          ['CLOCK', 7],
          ['SMALL_PAINTING', 11],
        ],
      },
    }
  : {
      roomH: 23,
      corridorH: 3,
      roomW: [29, 51],
      pad: { coding: 2, library: 2, server: 2, lounge: 2 },
      coding: { cols: 5, rows: 5, chairs: [0, 1, 2] },
      library: { cols: 4, rows: 4 },
      server: { cols: 8, rows: 4 },
      lounge: { cols: 4, rows: 2 },
      extraDoors: true,
      wallDeco: {
        coding: [
          ['WHITEBOARD', 3],
          ['CLOCK', 13],
          ['WHITEBOARD', 22],
        ],
        server: [
          ['LARGE_PAINTING', 4],
          ['CLOCK', 25],
          ['SMALL_PAINTING', 45],
        ],
      },
    };

// Grid geometry (cols × rows). Row 0 is void headroom for the 2-tile-tall top wall sprites.
// Two rows of two rooms around a corridor; every room of a column has the same size.
const TOP_WALL = 1;
const TOP_Y = 2; // first interior row of the top rooms
const ROOM_H = V.roomH;
const MID_WALL = TOP_Y + ROOM_H;
const CORRIDOR_Y = MID_WALL + 1;
const CORRIDOR_H = V.corridorH;
const BOTTOM_WALL = CORRIDOR_Y + CORRIDOR_H;
const BOTTOM_Y = BOTTOM_WALL + 1;
const ROWS = BOTTOM_Y + ROOM_H + 1;
const [LEFT_W, RIGHT_W] = V.roomW;
const RIGHT_X = LEFT_W + 2;
const COLS = RIGHT_X + RIGHT_W + 1;

const box = (label, color, x, w, y) => ({ label, color, x, w, y, h: ROOM_H });
const CODING = box('코딩실', '#48dbfb', 1, LEFT_W, TOP_Y);
const SERVER = box('서버실', '#ff6b6b', RIGHT_X, RIGHT_W, TOP_Y);
const LIBRARY = box('자료실', '#1dd1a1', 1, LEFT_W, BOTTOM_Y);
const LOUNGE = box('대기실', '#feca57', RIGHT_X, RIGHT_W, BOTTOM_Y);

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
const mid = (r) => r.x + Math.floor(r.w / 2) - 1;
/** First tile of the two 2-tile doors at 1/3 and 2/3 of a wall `len` tiles long from `start`
 *  (moved apart, symmetrically, until a wall tile is left between them). */
function thirds(start, len) {
  let [a, b] = [1, 2].map((k) => Math.round((k * len) / 3) - 1);
  while (b - a < 3) [a, b] = [a - 1, b + 1];
  return [start + a, start + b];
}
for (const x of thirds(CODING.x, CODING.w)) door(x, MID_WALL, 2, 1); // 코딩실 ↔ 복도
for (const x of thirds(LIBRARY.x, LIBRARY.w)) door(x, BOTTOM_WALL, 2, 1); // 복도 ↔ 자료실
door(mid(SERVER), MID_WALL, 2, 1);
door(mid(LOUNGE), BOTTOM_WALL, 2, 1);
for (const y of thirds(TOP_Y, ROOM_H)) door(RIGHT_X - 1, y, 1, 2); // 코딩실 ↔ 서버실
for (const y of thirds(BOTTOM_Y, ROOM_H)) door(RIGHT_X - 1, y, 1, 2); // 자료실 ↔ 대기실
if (V.extraDoors) {
  // The wide right-hand rooms get two more doors each.
  for (const x of [
    RIGHT_X + Math.floor(RIGHT_W / 4),
    RIGHT_X + Math.floor((3 * RIGHT_W) / 4) - 1,
  ]) {
    door(x, MID_WALL, 2, 1);
    door(x, BOTTOM_WALL, 2, 1);
  }
}

/** n groups of `size` tiles spread over `inner` tiles: first at 0, last at the far end,
 *  gaps as even as possible and mirror-symmetric (one group: centred). */
function spread(n, size, inner) {
  const span = inner - size;
  if (span < (n - 1) * size)
    throw new Error(`${String(n)} groups of ${String(size)} do not fit ${String(inner)}`);
  if (n === 1) return [Math.floor(span / 2)];
  return Array.from({ length: n }, (_, i) =>
    i * 2 <= n - 1
      ? Math.floor((i * span) / (n - 1))
      : span - Math.floor(((n - 1 - i) * span) / (n - 1)),
  );
}

/**
 * A cols × rows grid of furniture groups in `room`, `pad` tiles from every wall.
 * `unit` = the group's footprint (w × h) and where its anchor sits inside it (ox, oy);
 * `place(col, row, k)` puts one group at its anchor (k = index in reading order).
 */
function roomGrid(room, pad, unit, cols, rows, place) {
  const xs = spread(cols, unit.w, room.w - 2 * pad);
  const ys = spread(rows, unit.h, room.h - 2 * pad);
  let k = 0;
  for (const y of ys) {
    for (const x of xs) place(room.x + pad + x + unit.ox, room.y + pad + y + unit.oy, k++);
  }
}

// ── 코딩실: desks with two PCs, chairs facing up under each desk (group 3×3) ──
const { coding: cd, library: lb, server: sv, lounge: lg, pad } = V;
roomGrid(CODING, pad.coding, { w: 3, h: 3, ox: 0, oy: 0 }, cd.cols, cd.rows, (c, y) => {
  put('DESK_FRONT', c, y);
  put('PC_FRONT_OFF', c, y);
  put('PC_FRONT_OFF', c + 2, y);
  for (const k of cd.chairs) put('CUSHIONED_CHAIR_BACK', c + k, y + 2);
});
for (const [type, x] of V.wallDeco.coding) put(type, CODING.x + x, TOP_WALL - 1);

// ── 자료실: bookshelves on the top wall, reading tables with 4 chairs (group 4×3) ──
// The shelves sit as in the top rooms (the lower tile on the wall, the upper one over the
// corridor's last row), leaving the doors to the corridor open.
const libraryDoors = thirds(LIBRARY.x, LIBRARY.w);
for (let x = LIBRARY.x; x + 1 < LIBRARY.x + LIBRARY.w; x += 2) {
  if (libraryDoors.some((d) => x + 1 >= d && x <= d + 1)) continue;
  put('DOUBLE_BOOKSHELF', x, LIBRARY.y - 2);
}
const readingTable = (c, y) => {
  put('SMALL_TABLE_FRONT', c, y);
  put('CUSHIONED_CHAIR_SIDE', c - 1, y + 1);
  put('CUSHIONED_CHAIR_SIDE:left', c + 2, y + 1);
  put('CUSHIONED_CHAIR_BACK', c, y + 2);
  put('CUSHIONED_CHAIR_BACK', c + 1, y + 2);
};
if (lb.tables) {
  for (const [c, y] of lb.tables) readingTable(LIBRARY.x + c, LIBRARY.y + y);
} else {
  roomGrid(LIBRARY, pad.library, { w: 4, h: 3, ox: 1, oy: 0 }, lb.cols, lb.rows, readingTable);
}

// ── 서버실: workstation tables, a PC on every seat, wooden chairs both sides (group 5×4) ──
roomGrid(SERVER, pad.server, { w: 5, h: 4, ox: 1, oy: 0 }, sv.cols, sv.rows, (c, y) => {
  put('TABLE_FRONT', c, y);
  for (const dy of [0, 2]) {
    put('PC_SIDE', c, y + dy);
    put('PC_SIDE:left', c + 2, y + dy);
    put('WOODEN_CHAIR_SIDE', c - 1, y + dy);
    put('WOODEN_CHAIR_SIDE:left', c + 3, y + dy);
  }
});
for (const [type, x] of V.wallDeco.server) put(type, SERVER.x + x, TOP_WALL - 1);

// ── 대기실: sofa lounges around a coffee table, 8 seats each (group 4×4); open floor between ──
roomGrid(LOUNGE, pad.lounge, { w: 4, h: 4, ox: 1, oy: 1 }, lg.cols, lg.rows, (c, y, k) => {
  put('COFFEE_TABLE', c, y);
  put('COFFEE', c + (k % 2), y + 1);
  put('SOFA_FRONT', c, y - 1);
  put('SOFA_BACK', c, y + 2);
  put('SOFA_SIDE', c - 1, y);
  put('SOFA_SIDE:left', c + 2, y);
});

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

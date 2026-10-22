import { TileType } from '../types.js';

/** Check if a tile is walkable (floor, carpet, or doorway, and not blocked by furniture) */
export function isWalkable(
  col: number,
  row: number,
  tileMap: TileType[][],
  blockedTiles: Set<string>,
): boolean {
  const rows = tileMap.length;
  const cols = rows > 0 ? tileMap[0].length : 0;
  if (row < 0 || row >= rows || col < 0 || col >= cols) return false;
  const t = tileMap[row][col];
  if (t === TileType.WALL || t === TileType.VOID) return false;
  if (blockedTiles.has(`${col},${row}`)) return false;
  return true;
}

/** Get walkable tile positions (grid coords) (spawn and standing spots) */
export function getWalkableTiles(
  tileMap: TileType[][],
  blockedTiles: Set<string>,
): Array<{ col: number; row: number }> {
  const rows = tileMap.length;
  const cols = rows > 0 ? tileMap[0].length : 0;
  const tiles: Array<{ col: number; row: number }> = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (isWalkable(c, r, tileMap, blockedTiles)) {
        tiles.push({ col: c, row: r });
      }
    }
  }
  return tiles;
}

/**
 * BFS pathfinding on 4-connected grid (no diagonals). Returns path excluding start, including end.
 * Index-based (typed arrays, head pointer): linear in the tiles visited, so a 256×256 office stays fast.
 */
export function findPath(
  startCol: number,
  startRow: number,
  endCol: number,
  endRow: number,
  tileMap: TileType[][],
  blockedTiles: Set<string>,
): Array<{ col: number; row: number }> {
  if (startCol === endCol && startRow === endRow) return [];
  // The end must be walkable (a desk tile can't be pathed to).
  if (!isWalkable(endCol, endRow, tileMap, blockedTiles)) return [];

  const rows = tileMap.length;
  const cols = rows > 0 ? tileMap[0].length : 0;
  if (startRow < 0 || startRow >= rows || startCol < 0 || startCol >= cols) return [];
  const start = startRow * cols + startCol;
  const end = endRow * cols + endCol;
  // parent index + 1 (0 = unvisited); the start points at itself.
  const parent = new Int32Array(rows * cols);
  parent[start] = start + 1;
  const queue = new Int32Array(rows * cols);
  let head = 0;
  let tail = 0;
  queue[tail++] = start;

  while (head < tail) {
    const curr = queue[head++];
    if (curr === end) {
      const path: Array<{ col: number; row: number }> = [];
      for (let k = end; k !== start; k = parent[k] - 1) {
        path.push({ col: k % cols, row: Math.floor(k / cols) });
      }
      return path.reverse();
    }
    const c = curr % cols;
    const r = (curr - c) / cols;
    for (let d = 0; d < 4; d++) {
      // up, down, left, right
      const nc = d === 2 ? c - 1 : d === 3 ? c + 1 : c;
      const nr = d === 0 ? r - 1 : d === 1 ? r + 1 : r;
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
      const n = nr * cols + nc;
      if (parent[n] !== 0) continue;
      if (!isWalkable(nc, nr, tileMap, blockedTiles)) continue;
      parent[n] = curr + 1;
      queue[tail++] = n;
    }
  }
  return [];
}

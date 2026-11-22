// sokoban-solver-01: a push-optimal Sokoban solver.
//
// Design: the rooms of a level are independent. A box pushed through a door into
// the hallway can never be pushed back, so every box stays in its room and the
// level's push-optimal count P* is the sum of the rooms' optima. Each room is
// therefore solved on its own, push-optimally, and the rooms are joined by the
// player's walk along the hallway.
//
// A room is solved with A* over pushes: a state is the room's boxes plus the
// region the player can reach without pushing. The heuristic is the minimum
// assignment of boxes to goals by grid distance (admissible: one push moves one
// box one square), and states are pruned by dead squares (a box on a square from
// which no goal can ever be reached) and 2x2 blocks of walls and boxes with no
// goal. The search is budgeted by a fixed number of expansions, never by the
// wall clock, so two executions write the same bytes.
//
// No model, no network, no clock: the answer is a pure function of level.txt.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

type Dir = [number, number, string];
const DIRS: Dir[] = [
  [0, -1, 'u'],
  [0, 1, 'd'],
  [-1, 0, 'l'],
  [1, 0, 'r'],
];

/** Expansions a room search may spend before it gives up and retries bigger. */
const BUDGET_FIRST = 300_000;
const BUDGET_RETRY = 2_000_000;

interface Level {
  w: number;
  h: number;
  wall: Uint8Array;
  goals: number[];
  boxes: number[];
  player: number;
}

function parseLevel(text: string): Level {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const wall = new Uint8Array(w * h).fill(1);
  const goals: number[] = [];
  const boxes: number[] = [];
  let player = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x] ?? '#';
      const i = y * w + x;
      if (ch === '#') continue;
      wall[i] = 0;
      if (ch === '.' || ch === '*' || ch === '+') goals.push(i);
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  });
  boxes.sort((a, b) => a - b);
  goals.sort((a, b) => a - b);
  return { w, h, wall, goals, boxes, player };
}

/** Flood fill from `from` over cells with walkable set, avoiding `blocked` cells. */
function bfsRegion(
  w: number,
  h: number,
  walkable: Uint8Array,
  blocked: Uint8Array,
  from: number,
): { parent: Int32Array; seen: Uint8Array } {
  const parent = new Int32Array(w * h).fill(-2);
  const seen = new Uint8Array(w * h);
  if (!walkable[from] || blocked[from]) return { parent, seen };
  const queue: number[] = [from];
  parent[from] = -1;
  seen[from] = 1;
  for (let qi = 0; qi < queue.length; qi++) {
    const c = queue[qi]!;
    const cx = c % w;
    const cy = (c - cx) / w;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const q = ny * w + nx;
      if (!walkable[q] || blocked[q] || seen[q]) continue;
      seen[q] = 1;
      parent[q] = c;
      queue.push(q);
    }
  }
  return { parent, seen };
}

function letter(a: number, b: number, w: number): string {
  const dx = (b % w) - (a % w);
  const dy = Math.floor(b / w) - Math.floor(a / w);
  for (const [x, y, ch] of DIRS) if (x === dx && y === dy) return ch;
  return '?';
}

/** The move letters from `from` to `to` along a BFS parent tree. */
function pathFromParents(parent: Int32Array, from: number, to: number, w: number): string {
  if (to === from) return '';
  const steps: string[] = [];
  let c = to;
  while (c !== from) {
    const p = parent[c]!;
    if (p < 0) return '';
    steps.push(letter(p, c, w));
    c = p;
  }
  return steps.reverse().join('');
}

interface Room {
  cells: number[];
  cellSet: Uint8Array;
  door: number;
  hall: number;
  boxes: number[];
  goals: number[];
}

/**
 * Split a level into its rooms: the hallway is the player's row, and removing
 * it leaves one connected component per room. A room's door is its one cell
 * adjacent to the hallway, and the hallway cell outside the door is where the
 * player enters from.
 */
function decompose(level: Level): Room[] {
  const { w, h, wall } = level;
  const hallRow = Math.floor(level.player / w);
  const boxAt = new Set(level.boxes);
  const goalAt = new Set(level.goals);
  const seen = new Uint8Array(w * h);
  const rooms: Room[] = [];
  for (let i = 0; i < w * h; i++) {
    if (wall[i] || Math.floor(i / w) === hallRow || seen[i]) continue;
    const cells: number[] = [];
    const queue = [i];
    seen[i] = 1;
    for (let qi = 0; qi < queue.length; qi++) {
      const c = queue[qi]!;
      cells.push(c);
      const cx = c % w;
      const cy = (c - cx) / w;
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (wall[q] || Math.floor(q / w) === hallRow || seen[q]) continue;
        seen[q] = 1;
        queue.push(q);
      }
    }
    cells.sort((a, b) => a - b);
    const boxes = cells.filter((c) => boxAt.has(c));
    if (boxes.length === 0) continue;
    const goals = cells.filter((c) => goalAt.has(c));
    let door = -1;
    let hall = -1;
    for (const c of cells) {
      const cx = c % w;
      const cy = (c - cx) / w;
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (Math.floor(q / w) === hallRow && !wall[q]) {
          door = c;
          hall = q;
          break;
        }
      }
      if (door >= 0) break;
    }
    if (door < 0) continue;
    const cellSet = new Uint8Array(w * h);
    for (const c of cells) cellSet[c] = 1;
    rooms.push({ cells, cellSet, door, hall, boxes, goals });
  }
  return rooms;
}

/**
 * Dead squares: a room cell is live when it is a goal, or it can be pushed to
 * a live cell with the player standing on the square behind it. A box on a
 * cell this flood fill never reaches can never reach a goal, whatever the
 * other boxes do, so any state holding one is pruned.
 */
function computeLive(
  w: number,
  h: number,
  cellSet: Uint8Array,
  walkSet: Uint8Array,
  goals: number[],
): Uint8Array {
  const live = new Uint8Array(w * h);
  for (const g of goals) live[g] = 1;
  let changed = true;
  while (changed) {
    changed = false;
    for (let c = 0; c < w * h; c++) {
      if (!cellSet[c] || live[c]) continue;
      const cx = c % w;
      const cy = (c - cx) / w;
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (!cellSet[n] || !live[n]) continue;
        const px = cx - dx;
        const py = cy - dy;
        if (px < 0 || py < 0 || px >= w || py >= h) continue;
        if (!walkSet[py * w + px]) continue;
        live[c] = 1;
        changed = true;
        break;
      }
    }
  }
  return live;
}

/** Grid distance from each goal over the room's cells, one BFS per goal. */
function goalDistances(w: number, h: number, cellSet: Uint8Array, goals: number[]): Int32Array[] {
  return goals.map((g) => {
    const dist = new Int32Array(w * h).fill(-1);
    dist[g] = 0;
    const queue = [g];
    for (let qi = 0; qi < queue.length; qi++) {
      const c = queue[qi]!;
      const cx = c % w;
      const cy = (c - cx) / w;
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (!cellSet[q] || dist[q] >= 0) continue;
        dist[q] = dist[c]! + 1;
        queue.push(q);
      }
    }
    return dist;
  });
}

/**
 * Minimum assignment of boxes to goals by grid distance, by brute force over
 * the goal permutations (at most four boxes). Infinity when some box cannot
 * reach any goal. Admissible: one push moves one box one square.
 */
function assignmentCost(boxes: number[], dists: Int32Array[]): number {
  const n = boxes.length;
  const m = dists.length;
  if (n > m) return Infinity;
  let best = Infinity;
  const used = new Array<boolean>(m).fill(false);
  const rec = (i: number, cost: number): void => {
    if (cost >= best) return;
    if (i === n) {
      best = cost;
      return;
    }
    for (let g = 0; g < m; g++) {
      if (used[g]) continue;
      const d = dists[g]![boxes[i]!]!;
      if (d < 0) continue;
      used[g] = true;
      rec(i + 1, cost + d);
      used[g] = false;
    }
  };
  rec(0, 0);
  return best;
}

/** Every 2x2 block that touches the room, as its four cells. */
function twoByTwoBlocks(w: number, h: number, cellSet: Uint8Array): number[][] {
  const blocks: number[][] = [];
  for (let y = 0; y + 1 < h; y++) {
    for (let x = 0; x + 1 < w; x++) {
      const t = y * w + x;
      const cells = [t, t + 1, t + w, t + w + 1];
      if (!cells.some((c) => cellSet[c])) continue;
      blocks.push(cells);
    }
  }
  return blocks;
}

/**
 * A 2x2 block of walls and boxes with no goal is frozen: a box in it can only
 * be pushed out by a player standing on a cell of the block, which is itself
 * a wall or a box, or into another cell of the block, which is also taken.
 */
function hasTwoByTwo(
  blocks: number[][],
  wall: Uint8Array,
  boxSet: Set<number>,
  goalSet: Set<number>,
): boolean {
  for (const b of blocks) {
    let all = true;
    let anyGoal = false;
    for (const c of b) {
      if (goalSet.has(c)) {
        anyGoal = true;
        break;
      }
      if (!wall[c] && !boxSet.has(c)) {
        all = false;
        break;
      }
    }
    if (all && !anyGoal) return true;
  }
  return false;
}

interface RoomState {
  boxes: number[];
  player: number;
  g: number;
  parent: number;
  seg: string;
  key: string;
}

type HeapEntry = [number, number, number];

/** Solve one room push-optimally from its hallway square, or null. */
function solveRoom(
  w: number,
  h: number,
  wall: Uint8Array,
  room: Room,
  budget: number,
): { moves: string; endPlayer: number } | null {
  const { cellSet, hall, boxes: boxes0, goals } = room;
  const walkSet = new Uint8Array(w * h);
  for (const c of room.cells) walkSet[c] = 1;
  walkSet[hall] = 1;
  const live = computeLive(w, h, cellSet, walkSet, goals);
  const dists = goalDistances(w, h, cellSet, goals);
  const blocks = twoByTwoBlocks(w, h, cellSet);
  const goalSet = new Set(goals);
  const solved = (bs: number[]): boolean => bs.every((b) => goalSet.has(b));

  const keyOf = (bs: number[], rep: number): string => bs.join(',') + '|' + rep;
  const repOf = (player: number, bs: number[]): number => {
    const blocked = new Uint8Array(w * h);
    for (const b of bs) blocked[b] = 1;
    const { seen } = bfsRegion(w, h, walkSet, blocked, player);
    let rep = Infinity;
    for (let c = 0; c < w * h; c++) if (seen[c] && c < rep) rep = c;
    return rep;
  };

  const heap: HeapEntry[] = [];
  const less = (a: HeapEntry, b: HeapEntry): boolean =>
    a[0] < b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] < b[2])));
  const heapPush = (e: HeapEntry): void => {
    let i = heap.length;
    heap.push(e);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(heap[i]!, heap[p]!)) break;
      [heap[i], heap[p]] = [heap[p]!, heap[i]!];
      i = p;
    }
  };
  const heapPop = (): HeapEntry => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      for (let i = 0; ; ) {
        let c = 2 * i + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && less(heap[c + 1]!, heap[c]!)) c++;
        if (!less(heap[c]!, heap[i]!)) break;
        [heap[i], heap[c]] = [heap[c]!, heap[i]!];
        i = c;
      }
    }
    return top;
  };

  const states: RoomState[] = [];
  const closed = new Map<string, number>();
  const startBoxes = [...boxes0].sort((a, b) => a - b);
  const h0 = assignmentCost(startBoxes, dists);
  if (h0 === Infinity) return null;
  const startRep = repOf(hall, startBoxes);
  const startKey = keyOf(startBoxes, startRep);
  states.push({ boxes: startBoxes, player: hall, g: 0, parent: -1, seg: '', key: startKey });
  closed.set(startKey, 0);
  heapPush([h0, 0, 0]);

  let expansions = 0;
  while (heap.length > 0) {
    const [, g, si] = heapPop();
    const s = states[si]!;
    if (closed.get(s.key) !== g) continue;
    if (solved(s.boxes)) {
      const chain: string[] = [];
      for (let t = si; t > 0; t = states[t]!.parent) chain.push(states[t]!.seg);
      chain.reverse();
      return { moves: chain.join(''), endPlayer: s.player };
    }
    if (expansions >= budget) return null;
    expansions++;
    const blocked = new Uint8Array(w * h);
    for (const b of s.boxes) blocked[b] = 1;
    const { parent, seen } = bfsRegion(w, h, walkSet, blocked, s.player);
    const boxSet = new Set(s.boxes);
    for (let bi = 0; bi < s.boxes.length; bi++) {
      const b = s.boxes[bi]!;
      const bx = b % w;
      const by = (b - bx) / w;
      for (const [dx, dy, ch] of DIRS) {
        const nx = bx + dx;
        const ny = by + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const dest = ny * w + nx;
        if (!cellSet[dest] || boxSet.has(dest)) continue;
        const px = bx - dx;
        const py = by - dy;
        if (px < 0 || py < 0 || px >= w || py >= h) continue;
        const pushPos = py * w + px;
        if (!seen[pushPos]) continue;
        const nb = s.boxes.slice();
        nb[bi] = dest;
        nb.sort((a, b) => a - b);
        let dead = false;
        for (const x of nb) {
          if (!live[x]) {
            dead = true;
            break;
          }
        }
        if (dead) continue;
        if (hasTwoByTwo(blocks, wall, new Set(nb), goalSet)) continue;
        const hh = assignmentCost(nb, dists);
        if (hh === Infinity) continue;
        const ng = s.g + 1;
        const nrep = repOf(b, nb);
        const nkey = keyOf(nb, nrep);
        const prev = closed.get(nkey);
        if (prev !== undefined && prev <= ng) continue;
        closed.set(nkey, ng);
        const walk = pathFromParents(parent, s.player, pushPos, w);
        const idx = states.length;
        states.push({ boxes: nb, player: b, g: ng, parent: si, seg: walk + ch, key: nkey });
        heapPush([ng + hh, ng, idx]);
      }
    }
  }
  return null;
}

/** Solve one level: walk the hallway, solve each room in turn, join the moves. */
function solve(text: string): string {
  const level = parseLevel(text);
  const { w, h, wall } = level;
  const rooms = decompose(level);
  if (rooms.length === 0) return '';
  rooms.sort((a, b) => a.door - b.door);
  const floorWalk = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (!wall[i]) floorWalk[i] = 1;
  const curBoxes = new Set(level.boxes);
  let moves = '';
  let curPlayer = level.player;
  for (const room of rooms) {
    const blocked = new Uint8Array(w * h);
    for (const b of curBoxes) blocked[b] = 1;
    const { parent, seen } = bfsRegion(w, h, floorWalk, blocked, curPlayer);
    if (!seen[room.hall]) return '';
    moves += pathFromParents(parent, curPlayer, room.hall, w);
    curPlayer = room.hall;
    let res = solveRoom(w, h, wall, room, BUDGET_FIRST);
    if (res === null) res = solveRoom(w, h, wall, room, BUDGET_RETRY);
    if (res === null) return '';
    moves += res.moves;
    curPlayer = res.endPlayer;
    for (const b of room.boxes) curBoxes.delete(b);
    for (const g of room.goals) curBoxes.add(g);
  }
  return moves;
}

for (const id of readdirSync(I).sort()) {
  const moves = solve(readFileSync(join(I, id, 'level.txt'), 'utf8'));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'solution.txt'), `${moves}\n`);
}

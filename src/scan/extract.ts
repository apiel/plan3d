// Turns a walk-around depth capture into a room outline and furniture boxes.
//
// Input is a set of keyframes: where the camera was and the 3D points the
// depth sensor saw (world metres, y up, gravity aligned as in ARCore).
//
//  1. Floor and ceiling heights come from the spread of all points.
//  2. Walls are taken from a band just below the ceiling, above most
//     furniture, so a sofa or desk against a wall does not move the wall.
//  3. Every ray from the camera is free space up to the point it hit; floor
//     and ceiling points are free space themselves. Upper-band points are
//     walls. The free cells form the room.
//  4. The outline of that region is traced, simplified, and snapped to the
//     dominant wall directions so rooms come out with clean right angles.
//  5. Points between floor and the wall band, away from the walls, are
//     grouped into furniture boxes.

import { Vec } from '../model';

export interface Keyframe {
  cam: [number, number, number];
  /** Flat x, y, z triples. */
  points: Float32Array;
}

export interface Box {
  /** Min corner and size in plan metres (same frame as the corners). */
  x: number;
  y: number;
  w: number;
  d: number;
  /** Height above the floor. */
  h: number;
}

export interface RoomScan {
  /** Outline in metres, axis aligned, min corner at the origin. */
  corners: Vec[];
  furniture: Box[];
  floorY: number;
  ceilingY: number;
}

const CELL = 0.05;
const MAX_GRID = 500;
const SNAP_DEG = 15;
// rays that must cross a cell before it counts as free: one stray reading cannot open a hole in a wall
const FREE_MIN = 3;
const OCC_MIN = 2; // wall hits that make a cell stop rays
const STUB = 0.35; // diagonal walls shorter than this are noise (metres)
const FLOOR_BAND = 0.1; // points this close to floor or ceiling belong to them
const WALL_BAND_FROM = 1.5; // metres above the floor where the wall band starts
const MIN_WALL_SHARE = 0.05; // below this share of all points the upper band is too sparse, fall back to a wide band
const FURNITURE_MIN_HEIGHT = 0.25;
const FURNITURE_MIN_AREA = 0.15; // m²
const FURNITURE_WALL_GAP = 3; // cells kept clear along walls, so low wall points are not furniture

export function extractRoom(frames: Keyframe[]): RoomScan | null {
  // First pass finds which way the walls run. Rotating the capture to match
  // makes walls follow the grid, so the second pass has no diagonal staircases.
  const first = run(frames);
  if (!first) return null;
  const second = run(rotateFrames(frames, -first.phi));
  return second ?? first;
}

function rotateFrames(frames: Keyframe[], angle: number): Keyframe[] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return frames.map((f) => {
    const pts = new Float32Array(f.points.length);
    for (let i = 0; i < f.points.length; i += 3) {
      pts[i] = f.points[i] * c - f.points[i + 2] * s;
      pts[i + 1] = f.points[i + 1];
      pts[i + 2] = f.points[i] * s + f.points[i + 2] * c;
    }
    return { cam: [f.cam[0] * c - f.cam[2] * s, f.cam[1], f.cam[0] * s + f.cam[2] * c], points: pts };
  });
}

interface Pass extends RoomScan {
  /** Dominant wall direction (radians, modulo 90 degrees) in this pass's frame. */
  phi: number;
}

function run(frames: Keyframe[]): Pass | null {
  const ys: number[] = [];
  for (const f of frames) for (let i = 1; i < f.points.length; i += 3) ys.push(f.points[i]);
  if (ys.length < 200) return null;
  ys.sort((a, b) => a - b);
  const floorY = ys[Math.floor(ys.length * 0.02)];
  const ceilingY = ys[Math.floor(ys.length * 0.98)];
  const ceilingSeen = ceilingY - floorY > 2.0;

  // wall band: under the ceiling if there is enough there, otherwise wall height
  let lo = floorY + WALL_BAND_FROM;
  let hi = ceilingSeen ? ceilingY - 0.15 : floorY + 2.3;
  let upper = 0;
  for (const y of ys) if (y >= lo && y <= hi) upper++;
  if (upper < Math.max(300, ys.length * MIN_WALL_SHARE)) {
    lo = floorY + 0.4;
    hi = Math.max(lo + 0.3, Math.min(floorY + 2.0, ceilingY - 0.3));
  }

  // per keyframe: wall hits (x, z), other hits that only carve (x, z, inclusive), low hits for furniture (x, z, y)
  const walls: number[][] = [];
  const carve: number[][] = [];
  const low: number[] = [];
  for (const f of frames) {
    const w: number[] = [];
    const c: number[] = [];
    for (let i = 0; i < f.points.length; i += 3) {
      const x = f.points[i];
      const y = f.points[i + 1];
      const z = f.points[i + 2];
      if (y >= lo && y <= hi) w.push(x, z);
      else if (y < floorY + FLOOR_BAND || (ceilingSeen && y > ceilingY - FLOOR_BAND)) c.push(x, z, 1);
      else {
        c.push(x, z, 0);
        if (y < lo) low.push(x, z, y);
      }
    }
    walls.push(w);
    carve.push(c);
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const see = (x: number, z: number) => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  };
  frames.forEach((f, i) => {
    see(f.cam[0], f.cam[2]);
    const h = walls[i];
    for (let k = 0; k < h.length; k += 2) see(h[k], h[k + 1]);
  });
  if (!isFinite(minX) || walls.every((h) => h.length === 0)) return null;

  const cell = Math.max(CELL, Math.max(maxX - minX, maxZ - minZ) / MAX_GRID);
  const W = Math.ceil((maxX - minX) / cell) + 3;
  const H = Math.ceil((maxZ - minZ) / cell) + 3;
  const ix = (x: number) => Math.floor((x - minX) / cell) + 1;
  const iz = (z: number) => Math.floor((z - minZ) / cell) + 1;
  const inside = (x: number, z: number) => x >= 0 && z >= 0 && x < W && z < H;

  // wall hits first, then carve free space along every ray, stopping at walls
  // so a stray reading behind a wall cannot open it
  const occ = new Uint16Array(W * H);
  walls.forEach((w) => {
    for (let k = 0; k < w.length; k += 2) {
      const i = iz(w[k + 1]) * W + ix(w[k]);
      if (occ[i] < 65535) occ[i]++;
    }
  });
  const free = new Uint8Array(W * H);
  const mark = (x: number, z: number) => {
    const i = z * W + x;
    if (occ[i] >= OCC_MIN) return false;
    if (free[i] < 255) free[i]++;
    return true;
  };
  frames.forEach((f, i) => {
    const cx = ix(f.cam[0]);
    const cz = iz(f.cam[2]);
    const w = walls[i];
    for (let k = 0; k < w.length; k += 2) line(cx, cz, ix(w[k]), iz(w[k + 1]), mark);
    const c = carve[i];
    for (let k = 0; k < c.length; k += 3) {
      const hx = ix(c[k]);
      const hz = iz(c[k + 1]);
      if (!inside(hx, hz)) continue;
      if (line(cx, cz, hx, hz, mark) && c[k + 2]) mark(hx, hz);
    }
  });

  let mask: Uint8Array = new Uint8Array(W * H);
  for (let i = 0; i < mask.length; i++) mask[i] = free[i] >= FREE_MIN && !occ[i] ? 1 : 0;
  mask = erode(dilate(mask, W, H, 2), W, H, 2);
  mask = fillHoles(mask, W, H);
  mask = largestComponent(mask, W, H);

  const loop = traceOutline(mask, W, H);
  if (!loop || loop.length < 4) return null;

  const metres = loop.map(([vx, vz]) => ({ x: minX + (vx - 1) * cell, y: minZ + (vz - 1) * cell }));
  const simplified = simplifyClosed(metres, 0.07);
  const snapped = snapToWalls(simplified);
  if (!snapped || snapped.corners.length < 3) return null;
  const clean = snapped.corners;

  // furniture boxes, rotated into the same frame as the snapped outline
  const cos = Math.cos(-snapped.phi);
  const sin = Math.sin(-snapped.phi);
  const boxes = findFurniture(low, mask, W, H, cell, ix, iz, floorY).map((b) => {
    const gx = minX + (b.x0 - 1) * cell;
    const gz = minZ + (b.z0 - 1) * cell;
    const w = (b.x1 - b.x0 + 1) * cell;
    const d = (b.z1 - b.z0 + 1) * cell;
    const mx = gx + w / 2;
    const mz = gz + d / 2;
    return { x: mx * cos - mz * sin - w / 2, y: mx * sin + mz * cos - d / 2, w, d, h: b.h };
  });

  const cx = Math.min(...clean.map((p) => p.x));
  const cy = Math.min(...clean.map((p) => p.y));
  const corners = clean.map((p) => ({ x: p.x - cx, y: p.y - cy }));
  return {
    corners,
    furniture: boxes.map((b) => snapBoxToWalls({ ...b, x: b.x - cx, y: b.y - cy }, corners)),
    floorY,
    ceilingY,
    phi: snapped.phi,
  };
}

/** Furniture near a wall was cut short by the clear strip along walls: extend it to the wall. */
function snapBoxToWalls(b: Box, corners: Vec[]): Box {
  const reach = (FURNITURE_WALL_GAP + 1) * CELL;
  let { x, y, w, d } = b;
  for (let i = 0; i < corners.length; i++) {
    const p = corners[i];
    const q = corners[(i + 1) % corners.length];
    if (Math.abs(p.y - q.y) < 1e-6) {
      // horizontal wall at p.y, must overlap the box in x
      if (Math.min(p.x, q.x) > x + w || Math.max(p.x, q.x) < x) continue;
      if (p.y < y && y - p.y < reach) {
        d += y - p.y;
        y = p.y;
      } else if (p.y > y + d && p.y - (y + d) < reach) {
        d = p.y - y;
      }
    } else if (Math.abs(p.x - q.x) < 1e-6) {
      if (Math.min(p.y, q.y) > y + d || Math.max(p.y, q.y) < y) continue;
      if (p.x < x && x - p.x < reach) {
        w += x - p.x;
        x = p.x;
      } else if (p.x > x + w && p.x - (x + w) < reach) {
        w = p.x - x;
      }
    }
  }
  return { ...b, x, y, w, d };
}

/** Groups low points inside the room (away from the walls) into boxes, in grid cells. */
function findFurniture(
  low: number[],
  mask: Uint8Array,
  W: number,
  H: number,
  cell: number,
  ix: (x: number) => number,
  iz: (z: number) => number,
  floorY: number
): { x0: number; z0: number; x1: number; z1: number; h: number }[] {
  const inner = erode(mask, W, H, FURNITURE_WALL_GAP);
  const count = new Uint16Array(W * H);
  const top = new Float32Array(W * H);
  for (let k = 0; k < low.length; k += 3) {
    const x = ix(low[k]);
    const z = iz(low[k + 1]);
    if (x < 0 || z < 0 || x >= W || z >= H) continue;
    const i = z * W + x;
    if (!inner[i]) continue;
    count[i]++;
    top[i] = Math.max(top[i], low[k + 2] - floorY);
  }
  let cand: Uint8Array = new Uint8Array(W * H);
  for (let i = 0; i < cand.length; i++) cand[i] = count[i] >= 1 && top[i] >= FURNITURE_MIN_HEIGHT ? 1 : 0;
  // close the gaps between sparse samples on the same object
  cand = erode(dilate(cand, W, H, 2), W, H, 2);

  const seen = new Uint8Array(W * H);
  const out: { x0: number; z0: number; x1: number; z1: number; h: number }[] = [];
  for (let s = 0; s < cand.length; s++) {
    if (!cand[s] || seen[s]) continue;
    const stack = [s];
    seen[s] = 1;
    let n = 0;
    let x0 = W;
    let z0 = H;
    let x1 = 0;
    let z1 = 0;
    let h = 0;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % W;
      const z = (i - x) / W;
      n++;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      z0 = Math.min(z0, z);
      z1 = Math.max(z1, z);
      h = Math.max(h, top[i]);
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, z > 0 ? i - W : -1, z < H - 1 ? i + W : -1]) {
        if (j >= 0 && cand[j] && !seen[j]) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    if (n * cell * cell >= FURNITURE_MIN_AREA) out.push({ x0, z0, x1, z1, h });
  }
  return out;
}

// ---------- grid helpers ----------

/** Cells from (x0, y0) up to but not including (x1, y1). Stops early, returning false, when `visit` returns false. */
function line(x0: number, y0: number, x1: number, y1: number, visit: (x: number, y: number) => boolean): boolean {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0;
  let y = y0;
  while (x !== x1 || y !== y1) {
    if (!visit(x, y)) return false;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
  return true;
}

function dilate(m: Uint8Array, W: number, H: number, r: number): Uint8Array {
  return morph(m, W, H, r, true);
}
function erode(m: Uint8Array, W: number, H: number, r: number): Uint8Array {
  return morph(m, W, H, r, false);
}

/** Square-kernel dilate/erode, done as a horizontal then a vertical pass. */
function morph(m: Uint8Array, W: number, H: number, r: number, grow: boolean): Uint8Array {
  const pass = (src: Uint8Array, horizontal: boolean): Uint8Array => {
    const dst = new Uint8Array(src.length);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let hit = grow ? 0 : 1;
        for (let d = -r; d <= r; d++) {
          const nx = horizontal ? x + d : x;
          const ny = horizontal ? y : y + d;
          const v = nx < 0 || ny < 0 || nx >= W || ny >= H ? 0 : src[ny * W + nx];
          if (grow && v) {
            hit = 1;
            break;
          }
          if (!grow && !v) {
            hit = 0;
            break;
          }
        }
        dst[y * W + x] = hit;
      }
    }
    return dst;
  };
  return pass(pass(m, true), false);
}

/** Cells not reachable from the border without crossing the mask become part of it. */
function fillHoles(m: Uint8Array, W: number, H: number): Uint8Array {
  const outside = new Uint8Array(m.length);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    const i = y * W + x;
    if (!m[i] && !outside[i]) {
      outside[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < W; x++) {
    push(x, 0);
    push(x, H - 1);
  }
  for (let y = 0; y < H; y++) {
    push(0, y);
    push(W - 1, y);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % W;
    const y = (i - x) / W;
    if (x > 0) push(x - 1, y);
    if (x < W - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < H - 1) push(x, y + 1);
  }
  const out = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) out[i] = outside[i] ? 0 : 1;
  return out;
}

function largestComponent(m: Uint8Array, W: number, H: number): Uint8Array {
  const label = new Int32Array(m.length);
  let best = 0;
  let bestSize = 0;
  let next = 0;
  for (let s = 0; s < m.length; s++) {
    if (!m[s] || label[s]) continue;
    next++;
    let size = 0;
    const stack = [s];
    label[s] = next;
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % W;
      const y = (i - x) / W;
      const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
      for (const j of nb) {
        if (j >= 0 && m[j] && !label[j]) {
          label[j] = next;
          stack.push(j);
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      best = next;
    }
  }
  const out = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) out[i] = label[i] === best ? 1 : 0;
  return out;
}

/** Outer boundary of the mask as grid-corner vertices, staircase steps merged. */
function traceOutline(m: Uint8Array, W: number, H: number): [number, number][] | null {
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && m[y * W + x] === 1;
  const key = (x: number, y: number) => y * (W + 1) + x;
  const edges = new Map<number, [number, number][]>(); // start vertex -> end vertices
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    const k = key(x0, y0);
    const list = edges.get(k);
    if (list) list.push([x1, y1]);
    else edges.set(k, [[x1, y1]]);
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!m[y * W + x]) continue;
      if (!on(x, y - 1)) add(x, y, x + 1, y);
      if (!on(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!on(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!on(x - 1, y)) add(x, y + 1, x, y);
    }
  }

  let best: [number, number][] | null = null;
  let bestArea = 0;
  for (const [startKey, ends] of edges) {
    while (ends.length) {
      const sx = startKey % (W + 1);
      const sy = (startKey - sx) / (W + 1);
      const loop: [number, number][] = [[sx, sy]];
      let [cx, cy] = ends.pop()!;
      let guard = 0;
      while ((cx !== sx || cy !== sy) && guard++ < 4 * W * H) {
        loop.push([cx, cy]);
        const list = edges.get(key(cx, cy));
        if (!list || !list.length) break;
        [cx, cy] = list.pop()!;
      }
      const area = Math.abs(polyArea(loop.map(([x, y]) => ({ x, y }))));
      if (area > bestArea) {
        bestArea = area;
        best = loop;
      }
    }
  }
  if (!best) return null;

  // drop vertices in the middle of straight runs
  const out: [number, number][] = [];
  for (let i = 0; i < best.length; i++) {
    const a = best[(i + best.length - 1) % best.length];
    const b = best[i];
    const c = best[(i + 1) % best.length];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (cross !== 0) out.push(b);
  }
  return out;
}

// ---------- polygon helpers ----------

export function polyArea(p: Vec[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

function distToSegment(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function dp(pts: Vec[], tol: number): Vec[] {
  if (pts.length < 3) return pts;
  const a = pts[0];
  const b = pts[pts.length - 1];
  let worst = -1;
  let wi = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distToSegment(pts[i], a, b);
    if (d > worst) {
      worst = d;
      wi = i;
    }
  }
  if (worst <= tol) return [a, b];
  return [...dp(pts.slice(0, wi + 1), tol).slice(0, -1), ...dp(pts.slice(wi), tol)];
}

/** Douglas-Peucker on a closed loop, anchored at the two most distant vertices. */
function simplifyClosed(p: Vec[], tol: number): Vec[] {
  if (p.length < 4) return p;
  let far = 1;
  let farD = 0;
  for (let i = 1; i < p.length; i++) {
    const d = Math.hypot(p[i].x - p[0].x, p[i].y - p[0].y);
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const first = dp(p.slice(0, far + 1), tol);
  const second = dp([...p.slice(far), p[0]], tol);
  return [...first.slice(0, -1), ...second.slice(0, -1)];
}

// ---------- wall snapping ----------

type Axis = 'h' | 'v' | 'free';
interface Side {
  a: Vec;
  b: Vec;
  axis: Axis;
  /** z for horizontal, x for vertical */
  at: number;
}

/** Rotates the outline to its dominant direction, makes near-axis walls exactly axis aligned and re-intersects the walls. */
function snapToWalls(poly: Vec[]): { corners: Vec[]; phi: number } | undefined {
  // dominant direction modulo 90 degrees, weighted by wall length
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    sx += Math.cos(4 * ang) * len;
    sy += Math.sin(4 * ang) * len;
  }
  const phi = Math.atan2(sy, sx) / 4;
  const rot = (p: Vec): Vec => ({
    x: p.x * Math.cos(-phi) - p.y * Math.sin(-phi),
    y: p.x * Math.sin(-phi) + p.y * Math.cos(-phi),
  });
  const pts = poly.map(rot);

  const tol = Math.tan((SNAP_DEG * Math.PI) / 180);
  const sides: Side[] = pts.map((a, i) => {
    const b = pts[(i + 1) % pts.length];
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    if (dy <= dx * tol) return { a, b, axis: 'h', at: (a.y + b.y) / 2 };
    if (dx <= dy * tol) return { a, b, axis: 'v', at: (a.x + b.x) / 2 };
    return { a, b, axis: 'free', at: 0 };
  });

  // tidy: drop short diagonal stubs (noise at corners), and merge neighbouring
  // walls that snapped to the same axis (small jogs)
  const len = (side: Side) => Math.hypot(side.b.x - side.a.x, side.b.y - side.a.y);
  let changed = true;
  while (changed && sides.length > 3) {
    changed = false;
    const stub = sides.findIndex((side) => side.axis === 'free' && len(side) < STUB);
    if (stub >= 0) {
      sides.splice(stub, 1);
      changed = true;
      continue;
    }
    for (let i = 0; i < sides.length; i++) {
      const a = sides[i];
      const b = sides[(i + 1) % sides.length];
      if (a.axis === 'free' || a.axis !== b.axis) continue;
      const total = len(a) + len(b);
      const merged: Side = { a: a.a, b: b.b, axis: a.axis, at: (a.at * len(a) + b.at * len(b)) / total };
      if (i + 1 < sides.length) {
        sides.splice(i, 2, merged);
      } else {
        sides.splice(i, 1);
        sides[0] = { ...merged, b: sides[0].b };
      }
      changed = true;
      break;
    }
  }
  if (sides.length < 3) return undefined;

  const lineOf = (s: Side): { p: Vec; d: Vec } =>
    s.axis === 'h'
      ? { p: { x: 0, y: s.at }, d: { x: 1, y: 0 } }
      : s.axis === 'v'
        ? { p: { x: s.at, y: 0 }, d: { x: 0, y: 1 } }
        : { p: s.a, d: { x: s.b.x - s.a.x, y: s.b.y - s.a.y } };

  const corners: Vec[] = [];
  for (let i = 0; i < sides.length; i++) {
    const prev = sides[(i + sides.length - 1) % sides.length];
    const cur = sides[i];
    const l1 = lineOf(prev);
    const l2 = lineOf(cur);
    const cross = l1.d.x * l2.d.y - l1.d.y * l2.d.x;
    if (Math.abs(cross) < 1e-6 * Math.hypot(l1.d.x, l1.d.y) * Math.hypot(l2.d.x, l2.d.y)) {
      corners.push({ x: cur.a.x, y: cur.a.y });
      continue;
    }
    const t = ((l2.p.x - l1.p.x) * l2.d.y - (l2.p.y - l1.p.y) * l2.d.x) / cross;
    corners.push({ x: l1.p.x + l1.d.x * t, y: l1.p.y + l1.d.y * t });
  }
  return { corners, phi };
}

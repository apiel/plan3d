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
//
//  6. Doorways and windows nobody marked are found where the phone saw
//     through a wall: past the wall at hip and chest height is an open door,
//     past it at chest height only (wall below the sill) is a window.
//
// The user can also mark corners, doors and windows with the crosshair while
// scanning. Three or more marked corners replace the traced outline (each
// wall between two marks is still fitted to the depth points), and door and
// window edges become openings on the nearest wall.

import { Vec } from '../model';
import type { Vec3 } from '../xr';

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

/** What the user pointed at during the scan, in world metres. */
export interface Marks {
  corners: Vec3[];
  /** Left and right edge of each door or window, and where the phone was when each was marked. */
  openings: { type: 'door' | 'window'; a: Vec3; b: Vec3; camA?: Vec3; camB?: Vec3 }[];
}

export interface RoomOpening {
  type: 'door' | 'window';
  /** Wall from corners[wall] to corners[wall + 1]; from/to are metres from its first corner. */
  wall: number;
  from: number;
  to: number;
}

export interface RoomScan {
  /** Outline in metres, axis aligned, min corner at the origin. */
  corners: Vec[];
  furniture: Box[];
  openings: RoomOpening[];
  floorY: number;
  ceilingY: number;
}

const noMarks: Marks = { corners: [], openings: [] };

const CELL = 0.05;
const MAX_GRID = 500;
const SNAP_DEG = 15;
// rays that must cross a cell before it counts as free: one stray reading cannot open a hole in a wall
const FREE_MIN = 3;
const OCC_MIN = 2; // wall hits that make a cell stop rays
const STUB = 0.35; // diagonal walls shorter than this are noise (metres)
const JOG = 0.12; // a step this short between two walls running the same way is noise (often at a doorway's edge), not a chimney breast
const FLOOR_BAND = 0.1; // points this close to floor or ceiling belong to them
const WALL_BAND_FROM = 1.5; // metres above the floor where the wall band starts
const MIN_WALL_SHARE = 0.05; // below this share of all points the upper band is too sparse, fall back to a wide band
const FURNITURE_MIN_HEIGHT = 0.25;
const FURNITURE_MIN_AREA = 0.15; // m²
const FURNITURE_WALL_GAP = 3; // cells kept clear along walls, so low wall points are not furniture
const MARK_MERGE = 0.3; // corner marks closer than this are the same corner marked twice
const MARK_TRUST = 0.3; // a fitted corner further than this from its mark is wrong, keep the mark
const WALL_FIT_BAND = 0.15; // wall points this close to the line between two marks belong to that wall
const WALL_FIT_MIN = 20; // fewer points than this and the wall is just the line between the marks
const OPENING_REACH = 0.75; // door/window marks inside the room further than this from every wall are dropped
const RECESS_MAX = 1.0; // a mark this far behind its wall is a window deep in its recess; further, depth went through the glass
const OPENING_MIN = 0.3; // narrower openings are a slip of the finger
// free space seen through a doorway joins the room to the next one through a neck this narrow (half width, metres): cut it
const NECK = 0.55;
const NECK_SLACK = 1; // cells
const SEE_BIN = 0.1; // metres along a wall per bin when looking for openings
const SEE_AT = 0.12; // a point this close to a wall's line is the wall
const SEE_BEHIND = 0.25; // a point this far past a wall was seen through it
const SEE_MIN = 3; // points over a whole opening, per height band, before it counts
const DOOR_WIDTH = [0.6, 1.5]; // metres: narrower is a gap in the data, wider an open plan, not a door
const WINDOW_WIDTH = [0.4, 3];
const LOW_BAND = [0.2, 0.8]; // metres above the floor: under any window sill, open only at a door
const MID_BAND = [1.1, 1.8]; // metres above the floor: open at a door and at a window

export function extractRoom(frames: Keyframe[], marks: Marks = noMarks): RoomScan | null {
  // First pass finds which way the walls run. Rotating the capture to match
  // makes walls follow the grid, so the second pass has no diagonal staircases.
  const first = run(frames, marks, false);
  if (!first) return null;
  const c = Math.cos(-first.phi);
  const s = Math.sin(-first.phi);
  const second = run(rotateFrames(frames, c, s), {
    corners: marks.corners.map((p) => rotate(p, c, s)),
    openings: marks.openings.map((o) => ({
      ...o,
      a: rotate(o.a, c, s),
      b: rotate(o.b, c, s),
      camA: o.camA && rotate(o.camA, c, s),
      camB: o.camB && rotate(o.camB, c, s),
    })),
  }, true);
  return second ?? first;
}

/** Turns a point around the vertical axis (c, s: cosine and sine of the angle). */
const rotate = (p: Vec3, c: number, s: number): Vec3 => [p[0] * c - p[2] * s, p[1], p[0] * s + p[2] * c];

function rotateFrames(frames: Keyframe[], c: number, s: number): Keyframe[] {
  return frames.map((f) => {
    const pts = new Float32Array(f.points.length);
    for (let i = 0; i < f.points.length; i += 3) {
      pts[i] = f.points[i] * c - f.points[i + 2] * s;
      pts[i + 1] = f.points[i + 1];
      pts[i + 2] = f.points[i] * s + f.points[i + 2] * c;
    }
    return { cam: rotate(f.cam, c, s), points: pts };
  });
}

interface Pass extends RoomScan {
  /** Dominant wall direction (radians, modulo 90 degrees) in this pass's frame. */
  phi: number;
}

/** One extraction. `cutDoors` cuts off what was seen through doorways; the first pass, which only finds the wall direction, skips it. */
function run(frames: Keyframe[], marks: Marks, cutDoors: boolean): Pass | null {
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
  if (cutDoors) mask = cutNecks(mask, W, H, Math.round(NECK / cell), frames.map((f) => iz(f.cam[2]) * W + ix(f.cam[0])));
  mask = largestComponent(mask, W, H);

  const loop = traceOutline(mask, W, H);
  if (!loop || loop.length < 4) return null;

  const metres = loop.map(([vx, vz]) => ({ x: minX + (vx - 1) * cell, y: minZ + (vz - 1) * cell }));
  const simplified = simplifyClosed(metres, 0.07);
  const marked = mergeClose(marks.corners.map(flat), MARK_MERGE);
  const snapped = snapToWalls(marked.length >= 3 ? outlineFromMarks(marked, metres, walls) : simplified);
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
  const toPlan = (p: Vec3): Vec => ({ x: p[0] * cos - p[2] * sin - cx, y: p[0] * sin + p[2] * cos - cy });
  const placed = marks.openings.flatMap(
    (o) => placeOpening(o.type, toPlan(o.a), toPlan(o.b), corners, o.camA && toPlan(o.camA), o.camB && toPlan(o.camB)) ?? []
  );
  // the user's marks win over what the depth suggests
  const seen = seeThroughOpenings(frames, corners, toPlan, floorY).filter(
    (d) => !placed.some((m) => m.wall === d.wall && m.from < d.to && d.from < m.to)
  );
  return {
    corners,
    furniture: boxes.map((b) => snapBoxToWalls({ ...b, x: b.x - cx, y: b.y - cy }, corners)),
    openings: [...placed, ...seen],
    floorY,
    ceilingY,
    phi: snapped.phi,
  };
}

// ---------- marks ----------

const flat = (p: Vec3): Vec => ({ x: p[0], y: p[2] });

/** Averages points closer than `d` to an earlier one, keeping the first one's place in the list. */
function mergeClose(pts: Vec[], d: number): Vec[] {
  const groups: Vec[][] = [];
  for (const p of pts) {
    const g = groups.find((g) => Math.hypot(g[0].x - p.x, g[0].y - p.y) < d);
    if (g) g.push(p);
    else groups.push([p]);
  }
  return groups.map((g) => ({ x: g.reduce((s, p) => s + p.x, 0) / g.length, y: g.reduce((s, p) => s + p.y, 0) / g.length }));
}

/** How far along the closed outline (metres from its first vertex) the point nearest to `p` is. */
function alongOutline(p: Vec, outline: Vec[]): number {
  let run = 0;
  let best = Infinity;
  let at = 0;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (len * len))) : 0;
    const d = Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y)));
    if (d < best) {
      best = d;
      at = run + t * len;
    }
    run += len;
  }
  return at;
}

/**
 * Outline through the marked corners. The traced outline only decides their
 * order (so L shapes come out right); each wall between two marks is fitted
 * to the wall points along it, because many depth points place a wall better
 * than one reading at a corner, where depth is least reliable.
 */
function outlineFromMarks(marks: Vec[], outline: Vec[], walls: number[][]): Vec[] {
  const order = marks
    .map((m) => ({ m, t: alongOutline(m, outline) }))
    .sort((a, b) => a.t - b.t)
    .map((o) => o.m);
  const n = order.length;
  const lines = order.map((a, i) => fitWall(a, order[(i + 1) % n], walls));
  return order.map((m, i) => {
    const p = intersect(lines[(i + n - 1) % n], lines[i]);
    return p && Math.hypot(p.x - m.x, p.y - m.y) < MARK_TRUST ? p : m;
  });
}

/** Best line through the wall points between two marked corners, or the line through the marks. */
function fitWall(a: Vec, b: Vec, walls: number[][]): Line {
  let line: Line = { p: a, d: { x: b.x - a.x, y: b.y - a.y } };
  const len = Math.hypot(line.d.x, line.d.y);
  if (len < 1e-6) return line;
  // second round with a tighter band drops what the first one caught by mistake
  for (const band of [WALL_FIT_BAND, WALL_FIT_BAND / 2]) {
    const ux = line.d.x / Math.hypot(line.d.x, line.d.y);
    const uy = line.d.y / Math.hypot(line.d.x, line.d.y);
    let n = 0;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    let syy = 0;
    for (const w of walls) {
      for (let k = 0; k < w.length; k += 2) {
        const t = ((w[k] - a.x) * ux + (w[k + 1] - a.y) * uy) / len;
        // leave the ends out: corners are where depth smears
        if (t < 0.15 || t > 0.85) continue;
        if (Math.abs((w[k] - line.p.x) * uy - (w[k + 1] - line.p.y) * ux) > band) continue;
        n++;
        sx += w[k];
        sy += w[k + 1];
        sxx += w[k] * w[k];
        sxy += w[k] * w[k + 1];
        syy += w[k + 1] * w[k + 1];
      }
    }
    if (n < WALL_FIT_MIN) return line;
    const mx = sx / n;
    const my = sy / n;
    // main direction of the points (principal axis of their spread)
    const ang = Math.atan2(2 * (sxy / n - mx * my), sxx / n - mx * mx - (syy / n - my * my)) / 2;
    line = { p: { x: mx, y: my }, d: { x: Math.cos(ang), y: Math.sin(ang) } };
  }
  return line;
}

/**
 * A door or window from its two edge marks. Marks inside the room go to the
 * nearest wall. Marks outside it, like a window at the back of a deep recess
 * or depth that went through the glass, go to the wall that the line from
 * the phone to them crosses first.
 */
function placeOpening(type: 'door' | 'window', a: Vec, b: Vec, corners: Vec[], camA?: Vec, camB?: Vec): RoomOpening | undefined {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const inside = insidePolygon(mid, corners);
  let wall = -1;
  if (!inside && camA && camB) {
    wall = firstCrossing({ x: (camA.x + camB.x) / 2, y: (camA.y + camB.y) / 2 }, mid, corners);
  } else {
    let best = inside ? OPENING_REACH : RECESS_MAX;
    corners.forEach((p, i) => {
      const d = distToSegment(mid, p, corners[(i + 1) % corners.length]);
      if (d < best) {
        best = d;
        wall = i;
      }
    });
  }
  if (wall < 0) return undefined;
  const p = corners[wall];
  const q = corners[(wall + 1) % corners.length];
  const len = Math.hypot(q.x - p.x, q.y - p.y);
  // straight across onto the wall, except for marks far behind it: those are
  // where the line of sight meets the wall
  const along = (v: Vec, cam?: Vec) => {
    const behind = Math.abs((v.x - p.x) * (q.y - p.y) - (v.y - p.y) * (q.x - p.x)) / len;
    const at = cam && behind > RECESS_MAX ? (crossLine(cam, v, p, q) ?? v) : v;
    return Math.max(0, Math.min(len, ((at.x - p.x) * (q.x - p.x) + (at.y - p.y) * (q.y - p.y)) / len));
  };
  const ta = along(a, camA);
  const tb = along(b, camB);
  const from = Math.min(ta, tb);
  const to = Math.max(ta, tb);
  return to - from >= OPENING_MIN ? { type, wall, from, to } : undefined;
}

/**
 * Doorways and windows from where the phone saw through the walls. Along each
 * wall, in bins, points on the wall's line count as wall and points past it
 * (reached through it, the ray from the phone crossing that wall first) count
 * as open. Open at hip and chest height is a doorway; wall at hip height and
 * open at chest height is a window. A closed door or a window whose glass
 * stops the depth is flush with its wall and cannot be seen this way.
 */
function seeThroughOpenings(frames: Keyframe[], corners: Vec[], toPlan: (p: Vec3) => Vec, floorY: number): RoomOpening[] {
  const n = corners.length;
  const ccw = polyArea(corners) > 0;
  const walls = corners.map((a, i) => {
    const b = corners[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    // the room is on the left of the walking direction when the area is positive, so out is the right
    const out = ccw ? { x: u.y, y: -u.x } : { x: -u.y, y: u.x };
    const bins = Math.max(1, Math.floor(len / SEE_BIN));
    const counts = () => ({ wall: new Uint16Array(bins), open: new Uint16Array(bins) });
    return { a, len, u, out, bins, low: counts(), mid: counts() };
  });
  const bandOf = (h: number) =>
    h >= LOW_BAND[0] && h <= LOW_BAND[1] ? 'low' : h >= MID_BAND[0] && h <= MID_BAND[1] ? 'mid' : undefined;

  for (const f of frames) {
    const cam = toPlan(f.cam);
    for (let i = 0; i < f.points.length; i += 3) {
      const band = bandOf(f.points[i + 1] - floorY);
      if (!band) continue;
      const p = toPlan([f.points[i], f.points[i + 1], f.points[i + 2]]);
      // on a wall?
      let onWall = false;
      for (const w of walls) {
        const s = (p.x - w.a.x) * w.u.x + (p.y - w.a.y) * w.u.y;
        const d = (p.x - w.a.x) * w.out.x + (p.y - w.a.y) * w.out.y;
        if (s < 0 || s >= w.len || Math.abs(d) > SEE_AT) continue;
        w[band].wall[Math.min(w.bins - 1, Math.floor(s / SEE_BIN))]++;
        onWall = true;
        break;
      }
      if (onWall || insidePolygon(p, corners)) continue;
      // past a wall: the one the line of sight went through
      const k = firstCrossing(cam, p, corners);
      if (k < 0) continue;
      const w = walls[k];
      if ((p.x - w.a.x) * w.out.x + (p.y - w.a.y) * w.out.y < SEE_BEHIND) continue;
      const hit = crossLine(cam, p, w.a, corners[(k + 1) % n]);
      if (!hit) continue;
      const s = (hit.x - w.a.x) * w.u.x + (hit.y - w.a.y) * w.u.y;
      if (s < 0 || s >= w.len) continue;
      w[band].open[Math.min(w.bins - 1, Math.floor(s / SEE_BIN))]++;
    }
  }

  // runs of bins seen through more than seen as wall; then the run's totals decide what it is
  const found: RoomOpening[] = [];
  walls.forEach((w, k) => {
    // open at either height: a window has wall under its sill
    const open = (i: number) =>
      (w.low.open[i] > 0 && w.low.open[i] >= 2 * w.low.wall[i]) || (w.mid.open[i] > 0 && w.mid.open[i] >= 2 * w.mid.wall[i]);
    for (let i = 0; i < w.bins; ) {
      if (!open(i)) {
        i++;
        continue;
      }
      let j = i;
      // one bin without evidence inside a run is sparse data, not the end of the opening
      while (j + 1 < w.bins && (open(j + 1) || (j + 2 < w.bins && open(j + 2)))) j++;
      const sum = (c: Uint16Array) => c.slice(i, j + 1).reduce((t, v) => t + v, 0);
      const low = { open: sum(w.low.open), wall: sum(w.low.wall) };
      const mid = { open: sum(w.mid.open), wall: sum(w.mid.wall) };
      const type =
        low.open >= SEE_MIN && low.open >= 2 * low.wall && mid.open >= SEE_MIN
          ? 'door'
          : low.wall >= SEE_MIN && low.wall > low.open && mid.open >= SEE_MIN && mid.open >= 2 * mid.wall
            ? 'window'
            : undefined;
      const from = i * SEE_BIN;
      const to = Math.min(w.len, (j + 1) * SEE_BIN);
      const [lo, hi] = type === 'door' ? DOOR_WIDTH : WINDOW_WIDTH;
      if (type && to - from >= lo && to - from <= hi) found.push({ type, wall: k, from, to });
      i = j + 1;
    }
  });
  return found;
}

function insidePolygon(p: Vec, poly: Vec[]): boolean {
  let inside = false;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (a.y > p.y !== b.y > p.y && p.x < a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y)) inside = !inside;
  }
  return inside;
}

/** Where the line through `o` and `v` meets the line through `p` and `q`. */
function crossLine(o: Vec, v: Vec, p: Vec, q: Vec): Vec | undefined {
  return intersect({ p: o, d: { x: v.x - o.x, y: v.y - o.y } }, { p, d: { x: q.x - p.x, y: q.y - p.y } });
}

/** Index of the polygon side the segment from `o` to `v` crosses first, or -1. */
function firstCrossing(o: Vec, v: Vec, poly: Vec[]): number {
  let best = -1;
  let bestT = Infinity;
  const dx = v.x - o.x;
  const dy = v.y - o.y;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((a.x - o.x) * ey - (a.y - o.y) * ex) / den; // along o -> v
    const u = ((a.x - o.x) * dy - (a.y - o.y) * dx) / den; // along the side
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1 && t < bestT) {
      bestT = t;
      best = i;
    }
  }
  return best;
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

/**
 * Rays through an open door carve the next room too, joined to this one
 * through the doorway. Shrinking the free space by `r` cells breaks such
 * narrow necks; the part where the phone was is kept and grown back inside
 * the original free space, so the room keeps its shape and loses what was
 * only seen through the door. A room too narrow to survive the shrinking is
 * left as it was.
 */
function cutNecks(m: Uint8Array, W: number, H: number, r: number, cams: number[]): Uint8Array {
  const core = erode(m, W, H, r);
  const { label, sizes } = components(core, W, H);
  // the core piece holding most camera positions, else the biggest
  const votes = new Map<number, number>();
  for (const c of cams) if (label[c]) votes.set(label[c], (votes.get(label[c]) ?? 0) + 1);
  let keep = 0;
  for (const [l, v] of votes) if (!keep || v > votes.get(keep)! || (v === votes.get(keep) && sizes[l] > sizes[keep])) keep = l;
  if (!keep) keep = sizes.reduce((b, sz, l) => (sz > (sizes[b] ?? 0) ? l : b), 0);
  if (!keep) return m;
  const piece = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) piece[i] = label[i] === keep ? 1 : 0;
  // grown back a little further than it was shrunk: the edge along a wall is rough by a cell or two, and
  // regrowing only as far would shave that roughness and move every wall inwards
  const grown = dilate(piece, W, H, r + NECK_SLACK);
  for (let i = 0; i < m.length; i++) grown[i] &= m[i];
  return grown;
}

/** 4-connected components: a label per cell (0 for empty) and each label's size. */
function components(m: Uint8Array, W: number, H: number): { label: Int32Array; sizes: number[] } {
  const label = new Int32Array(m.length);
  const sizes = [0];
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
    sizes.push(size);
  }
  return { label, sizes };
}

function largestComponent(m: Uint8Array, W: number, H: number): Uint8Array {
  const { label, sizes } = components(m, W, H);
  const best = sizes.reduce((b, sz, l) => (sz > sizes[b] ? l : b), 0);
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

  // tidy: drop short diagonal stubs (noise at corners) and tiny steps between
  // walls running the same way, then merge neighbouring walls that snapped to
  // the same axis
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
    const jog = sides.findIndex((side, i) => {
      const prev = sides[(i + sides.length - 1) % sides.length];
      const next = sides[(i + 1) % sides.length];
      return side.axis !== 'free' && len(side) < JOG && prev.axis === next.axis && prev.axis !== 'free' && prev.axis !== side.axis;
    });
    if (jog >= 0) {
      sides.splice(jog, 1);
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

  const lineOf = (s: Side): Line =>
    s.axis === 'h'
      ? { p: { x: 0, y: s.at }, d: { x: 1, y: 0 } }
      : s.axis === 'v'
        ? { p: { x: s.at, y: 0 }, d: { x: 0, y: 1 } }
        : { p: s.a, d: { x: s.b.x - s.a.x, y: s.b.y - s.a.y } };

  const corners: Vec[] = [];
  for (let i = 0; i < sides.length; i++) {
    const prev = sides[(i + sides.length - 1) % sides.length];
    const cur = sides[i];
    corners.push(intersect(lineOf(prev), lineOf(cur)) ?? { x: cur.a.x, y: cur.a.y });
  }
  return { corners, phi };
}

interface Line {
  p: Vec;
  d: Vec;
}

/** Where two lines cross, or undefined when they are parallel. */
function intersect(l1: Line, l2: Line): Vec | undefined {
  const cross = l1.d.x * l2.d.y - l1.d.y * l2.d.x;
  if (Math.abs(cross) < 1e-6 * Math.hypot(l1.d.x, l1.d.y) * Math.hypot(l2.d.x, l2.d.y)) return undefined;
  const t = ((l2.p.x - l1.p.x) * l2.d.y - (l2.p.y - l1.p.y) * l2.d.x) / cross;
  return { x: l1.p.x + l1.d.x * t, y: l1.p.y + l1.d.y * t };
}

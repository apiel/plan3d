// Plan data model. Units are metres, y axis points down on screen.

export interface Vec {
  x: number;
  y: number;
}

export interface PlanPoint extends Vec {
  id: string;
  /** Where the capture (depth/AR/hand-drawn) put this point. The solver pulls
   *  towards it weakly, so manual measurements win when they disagree. */
  sensor: Vec;
  /** The name of the floor of the house this corner is on, as the user wrote it ("Cellar", "First floor", "Attic 3"); missing: the ground floor. Rooms sharing corners are on one floor. */
  floor?: string | number;
}

/** A room's name, put down at a spot inside the room. */
export interface RoomName extends Vec {
  name: string;
}

export interface Wall {
  a: string;
  b: string;
  /** A colour the user picked, as '#rrggbb', e.g. for walls to build or to remove. */
  color?: string;
  /** Metres, growing outwards from the line (the line is the face inside the room). */
  thickness?: number;
  /** Metres from the floor to the top of this wall in the 3D view, when it is not as high as the rest (a low wall under a platform). */
  height?: number;
}

export const DEFAULT_THICKNESS = 0.1;

export type Constraint =
  /** Measured distance between two points, in metres. */
  | { type: 'distance'; a: string; b: string; value: number }
  /** The angle at corner `b` between `a` and `c` is 90 degrees. */
  | { type: 'rightAngle'; a: string; b: string; c: string }
  /** The angle at corner `b` between `a` and `c`, in degrees (other than 90). */
  | { type: 'angle'; a: string; b: string; c: string; value: number }
  /** Wall a-b runs parallel to wall c-d. */
  | { type: 'parallel'; a: string; b: string; c: string; d: string }
  /** Wall a-b is as long as wall c-d. */
  | { type: 'equal'; a: string; b: string; c: string; d: string };

/** The point ids a constraint ties together. */
export const constraintIds = (c: Constraint): string[] =>
  c.type === 'distance' ? [c.a, c.b] : c.type === 'rightAngle' || c.type === 'angle' ? [c.a, c.b, c.c] : [c.a, c.b, c.c, c.d];

/** A piece from the furniture library (src/furniture.ts): centre and size in metres, turned by `angle` degrees; its back is towards -y before turning. */
export interface Furniture {
  id: string;
  kind: string;
  x: number;
  y: number;
  /** Width, depth (back to front) and height above the floor. */
  w: number;
  d: number;
  h: number;
  angle: number;
}

/**
 * A door or window in the wall between points `a` and `b`, `at` metres from `a`.
 * A `part` is no opening but a stretch of the wall, drawn in its colour.
 */
export interface Opening {
  id: string;
  type: 'door' | 'window' | 'part';
  /** A colour the user picked, as '#rrggbb'. */
  color?: string;
  a: string;
  b: string;
  at: number;
  width: number;
  /** The width was typed in: it stays when the wall is rescaled. */
  measured?: boolean;
  /** Door hinged at the `b` end of the wall instead of the `a` end. */
  hingeAtB?: boolean;
  /** Door swings out of the room instead of into it. */
  outward?: boolean;
  /** A doorway with only its frame: no door hangs in it. */
  noLeaf?: boolean;
  /** Window: metres from the wall's face inside the room to the frame. Centred in the wall when unset. */
  frameAt?: number;
  /** Window: under it the wall is open down to the floor between the room and the frame (a niche), instead of filled up to the sill. */
  niche?: boolean;
}

/** How thick a window frame is, in metres. */
export const WINDOW_FRAME = 0.07;

/** Where a window's frame sits in a wall `t` thick: metres from the face inside the room to its two sides. */
export function windowFrame(o: Opening, t: number): { from: number; to: number } {
  const frame = Math.min(WINDOW_FRAME, t);
  const from = Math.max(0, Math.min(t - frame, o.frameAt ?? (t - frame) / 2));
  return { from, to: from + frame };
}

/** Two doors, in different rooms, that are the same door: the rooms are placed so the doors coincide. */
export interface Join {
  a: string;
  b: string;
}

/** Which way the walker turns, going up. */
export type Turn = 'left' | 'right';

/**
 * A flight of stairs: centre and size of its straight part in metres, turned
 * by `angle` degrees; it goes up towards +length. At the bottom and the top it
 * can turn a quarter turn (winders in a square as wide as the flight, beyond
 * that end); missing means it ends straight.
 */
export interface Stair {
  id: string;
  x: number;
  y: number;
  width: number;
  length: number;
  angle: number;
  steps: number;
  bottom?: Turn;
  top?: Turn;
  /** The flight goes down to the floor under this one, its top at this floor's level; missing: up to the floor above, its bottom here. */
  down?: boolean;
}

export interface Plan {
  /** The project's name: file names for exports and Drive. */
  name?: string;
  /** Floor to ceiling in metres, for the 3D view; from the scan when it saw the ceiling. */
  height?: number;
  points: PlanPoint[];
  walls: Wall[];
  constraints: Constraint[];
  furniture: Furniture[];
  openings: Opening[];
  joins: Join[];
  stairs: Stair[];
  names: RoomName[];
}

export const emptyPlan = (): Plan => ({ points: [], walls: [], constraints: [], furniture: [], openings: [], joins: [], stairs: [], names: [] });

export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);

export const pointById = (plan: Plan, id: string): PlanPoint | undefined =>
  plan.points.find((p) => p.id === id);

export const sameWall = (w: Wall, a: string, b: string): boolean =>
  (w.a === a && w.b === b) || (w.a === b && w.b === a);

export const wallThickness = (plan: Plan, a: string, b: string): number =>
  plan.walls.find((w) => sameWall(w, a, b))?.thickness ?? DEFAULT_THICKNESS;

export function findDistance(plan: Plan, a: string, b: string): number | undefined {
  for (const c of plan.constraints) {
    if (c.type === 'distance' && ((c.a === a && c.b === b) || (c.a === b && c.b === a))) return c.value;
  }
  return undefined;
}

/** Sets (or replaces) the measured distance between two points. */
export function setDistance(plan: Plan, a: string, b: string, value: number): void {
  plan.constraints = plan.constraints.filter(
    (c) => !(c.type === 'distance' && ((c.a === a && c.b === b) || (c.a === b && c.b === a)))
  );
  plan.constraints.push({ type: 'distance', a, b, value });
}

export function clearDistance(plan: Plan, a: string, b: string): void {
  plan.constraints = plan.constraints.filter(
    (c) => !(c.type === 'distance' && ((c.a === a && c.b === b) || (c.a === b && c.b === a)))
  );
}

/** How close, in metres, a wall's end must be to another wall to count as standing on it. */
const ON_WALL = 0.05;

/** The wall a corner stands on partway along (a T junction), not one of its own walls. */
export function wallUnderCorner(plan: Plan, id: string): Wall | undefined {
  const p = pointById(plan, id);
  if (!p) return undefined;
  let best: Wall | undefined;
  let bestD = ON_WALL;
  for (const w of plan.walls) {
    if (w.a === id || w.b === id) continue;
    const a = pointById(plan, w.a);
    const b = pointById(plan, w.b);
    if (!a || !b) continue;
    const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1;
    const t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len2;
    if (t <= 0 || t >= 1) continue;
    const d = dist(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
    if (d < bestD) {
      best = w;
      bestD = d;
    }
  }
  return best;
}

/**
 * The two neighbours of a corner, if exactly two walls meet at it. A wall
 * ending on another wall (a T junction) counts that wall's first end as the
 * other neighbour, so the angle between the two walls can be held too.
 */
export function cornerNeighbours(plan: Plan, id: string): [string, string] | undefined {
  const others: string[] = [];
  for (const w of plan.walls) {
    if (w.a === id) others.push(w.b);
    else if (w.b === id) others.push(w.a);
  }
  if (others.length === 2) return [others[0], others[1]];
  if (others.length === 3) {
    // a wall joined onto another one, split there: the wall that ends here and one half of the other
    const p = pointById(plan, id);
    const dir = (o: string) => {
      const q = pointById(plan, o)!;
      const l = Math.hypot(q.x - p!.x, q.y - p!.y) || 1;
      return { x: (q.x - p!.x) / l, y: (q.y - p!.y) / l };
    };
    for (let i = 0; i < 3; i++) {
      const [m, n] = [others[(i + 1) % 3], others[(i + 2) % 3]];
      if (p && dir(m).x * dir(n).x + dir(m).y * dir(n).y < -0.97) return [others[i], m];
    }
    return undefined;
  }
  const host = others.length === 1 ? wallUnderCorner(plan, id) : undefined;
  return host ? [others[0], host.a] : undefined;
}


export function findRightAngle(plan: Plan, id: string): boolean {
  return plan.constraints.some((c) => c.type === 'rightAngle' && c.b === id);
}

/** The angle a corner is held at, in degrees: 90 for a right angle, undefined when free. */
export function findAngle(plan: Plan, id: string): number | undefined {
  for (const c of plan.constraints) {
    if (c.b !== id) continue;
    if (c.type === 'rightAngle') return 90;
    if (c.type === 'angle') return c.value;
  }
  return undefined;
}

/** Holds a corner at an angle in degrees (90 becomes a right angle), or frees it with undefined. */
export function setAngle(plan: Plan, id: string, deg: number | undefined): void {
  plan.constraints = plan.constraints.filter((c) => !((c.type === 'rightAngle' || c.type === 'angle') && c.b === id));
  const n = cornerNeighbours(plan, id);
  if (deg === undefined || !n) return;
  if (Math.abs(deg - 90) < 1e-9) plan.constraints.push({ type: 'rightAngle', a: n[0], b: id, c: n[1] });
  else plan.constraints.push({ type: 'angle', a: n[0], b: id, c: n[1], value: deg });
}

export function toggleRightAngle(plan: Plan, id: string): void {
  setAngle(plan, id, findRightAngle(plan, id) ? undefined : 90);
}

/** Parallel / equal-length ties between two walls. */
export type WallTie = 'parallel' | 'equal';

const tieMatches = (c: Constraint, a: string, b: string): boolean =>
  (c.type === 'parallel' || c.type === 'equal') &&
  (((c.a === a && c.b === b) || (c.a === b && c.b === a)) || ((c.c === a && c.d === b) || (c.c === b && c.d === a)));

/** The other walls tied to wall a-b, with the kind of tie. */
export function wallTies(plan: Plan, a: string, b: string): { type: WallTie; a: string; b: string }[] {
  const out: { type: WallTie; a: string; b: string }[] = [];
  for (const c of plan.constraints) {
    if (!tieMatches(c, a, b) || (c.type !== 'parallel' && c.type !== 'equal')) continue;
    if (c.type === 'parallel' && c.b === c.c) continue; // the two halves of a split wall, held in line: not shown

    const first = (c.a === a && c.b === b) || (c.a === b && c.b === a);
    out.push({ type: c.type, a: first ? c.c : c.a, b: first ? c.d : c.b });
  }
  return out;
}

/** Ties wall a-b to wall c-d (parallel or same length); a second identical tie is not added. */
export function addWallTie(plan: Plan, type: WallTie, a: string, b: string, c: string, d: string): void {
  if (wallTies(plan, a, b).some((t) => t.type === type && ((t.a === c && t.b === d) || (t.a === d && t.b === c)))) return;
  plan.constraints.push({ type, a, b, c, d });
}

export function removeWallTie(plan: Plan, type: WallTie, a: string, b: string, c: string, d: string): void {
  plan.constraints = plan.constraints.filter(
    (x) => !(x.type === type && tieMatches(x, a, b) && tieMatches(x, c, d))
  );
}

export function removePoint(plan: Plan, id: string): void {
  plan.points = plan.points.filter((p) => p.id !== id);
  plan.walls = plan.walls.filter((w) => w.a !== id && w.b !== id);
  plan.constraints = plan.constraints.filter((c) => !constraintIds(c).includes(id));
  plan.openings = plan.openings.filter((o) => o.a !== id && o.b !== id);
}

let counter = 0;
export const newId = (): string => `p${Date.now().toString(36)}${(counter++).toString(36)}`;

export function addPoint(plan: Plan, at: Vec): PlanPoint {
  const p: PlanPoint = { id: newId(), x: at.x, y: at.y, sensor: { ...at } };
  plan.points.push(p);
  return p;
}

export function serialize(plan: Plan): string {
  return JSON.stringify({ version: 1, ...plan }, null, 2);
}

export function parse(text: string): Plan {
  const raw = JSON.parse(text);
  if (!Array.isArray(raw.points) || !Array.isArray(raw.walls) || !Array.isArray(raw.constraints)) {
    throw new Error('Not a plan file');
  }
  // plans from before colours could be picked had a status: to build or to remove
  for (const x of [...raw.walls, ...(Array.isArray(raw.openings) ? raw.openings : [])]) {
    if (x.change && !x.color) x.color = x.change === 'new' ? '#fb923c' : '#f87171';
    delete x.change;
  }
  return {
    ...(typeof raw.name === 'string' && raw.name.trim() ? { name: raw.name.trim() } : {}),
    ...(typeof raw.height === 'number' && raw.height > 0 ? { height: raw.height } : {}),
    points: raw.points,
    walls: raw.walls,
    constraints: raw.constraints,
    // boxes older scans added had no kind: they are dropped
    furniture: Array.isArray(raw.furniture) ? raw.furniture.filter((f: Furniture) => typeof f.kind === 'string') : [],
    openings: Array.isArray(raw.openings) ? raw.openings : [],
    joins: Array.isArray(raw.joins) ? raw.joins : [],
    stairs: Array.isArray(raw.stairs) ? raw.stairs : [],
    names: Array.isArray(raw.names) ? raw.names : namesFromCorners(raw.points),
  };
}

/** Plans from before names had a place kept them on the room's corners: the name goes to their middle. */
function namesFromCorners(points: (PlanPoint & { room?: string })[]): RoomName[] {
  const byName = new Map<string, PlanPoint[]>();
  for (const p of points) {
    if (p.room) byName.set(p.room, [...(byName.get(p.room) ?? []), p]);
    delete p.room;
  }
  return [...byName].map(([name, ps]) => ({ name, x: ps.reduce((s, p) => s + p.x, 0) / ps.length, y: ps.reduce((s, p) => s + p.y, 0) / ps.length }));
}

/** A closed room from an ordered list of corners (metres). */
export function roomFromCorners(corners: Vec[]): Plan {
  const plan = emptyPlan();
  const pts = corners.map((c) => addPoint(plan, c));
  pts.forEach((p, i) => plan.walls.push({ a: p.id, b: pts[(i + 1) % pts.length].id }));
  return plan;
}

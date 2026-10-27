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
}

export interface Wall {
  a: string;
  b: string;
  /** Metres, growing outwards from the line (the line is the face inside the room). */
  thickness?: number;
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

/** A box standing on the floor: min corner and size in metres, height above the floor. */
export interface Furniture {
  id: string;
  x: number;
  y: number;
  w: number;
  d: number;
  h: number;
}

/** A door or window in the wall between points `a` and `b`, `at` metres from `a`. */
export interface Opening {
  id: string;
  type: 'door' | 'window';
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
}

/** Two doors, in different rooms, that are the same door: the rooms are placed so the doors coincide. */
export interface Join {
  a: string;
  b: string;
}

/** A straight flight of stairs: centre and size in metres, turned by `angle` degrees; it goes up towards +length. */
export interface Stair {
  id: string;
  x: number;
  y: number;
  width: number;
  length: number;
  angle: number;
  steps: number;
}

export interface Plan {
  points: PlanPoint[];
  walls: Wall[];
  constraints: Constraint[];
  furniture: Furniture[];
  openings: Opening[];
  joins: Join[];
  stairs: Stair[];
}

export const emptyPlan = (): Plan => ({ points: [], walls: [], constraints: [], furniture: [], openings: [], joins: [], stairs: [] });

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

/** The two neighbours of a corner, if exactly two walls meet at it. */
export function cornerNeighbours(plan: Plan, id: string): [string, string] | undefined {
  const others: string[] = [];
  for (const w of plan.walls) {
    if (w.a === id) others.push(w.b);
    else if (w.b === id) others.push(w.a);
  }
  return others.length === 2 ? [others[0], others[1]] : undefined;
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
  return {
    points: raw.points,
    walls: raw.walls,
    constraints: raw.constraints,
    furniture: Array.isArray(raw.furniture) ? raw.furniture : [],
    openings: Array.isArray(raw.openings) ? raw.openings : [],
    joins: Array.isArray(raw.joins) ? raw.joins : [],
    stairs: Array.isArray(raw.stairs) ? raw.stairs : [],
  };
}

/** A closed room from an ordered list of corners (metres). */
export function roomFromCorners(corners: Vec[]): Plan {
  const plan = emptyPlan();
  const pts = corners.map((c) => addPoint(plan, c));
  pts.forEach((p, i) => plan.walls.push({ a: p.id, b: pts[(i + 1) % pts.length].id }));
  return plan;
}

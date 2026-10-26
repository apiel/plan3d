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
}

export type Constraint =
  /** Measured distance between two points, in metres. */
  | { type: 'distance'; a: string; b: string; value: number }
  /** The angle at corner `b` between `a` and `c` is 90 degrees. */
  | { type: 'rightAngle'; a: string; b: string; c: string };

export interface Plan {
  points: PlanPoint[];
  walls: Wall[];
  constraints: Constraint[];
}

export const emptyPlan = (): Plan => ({ points: [], walls: [], constraints: [] });

export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);

export const pointById = (plan: Plan, id: string): PlanPoint | undefined =>
  plan.points.find((p) => p.id === id);

export const sameWall = (w: Wall, a: string, b: string): boolean =>
  (w.a === a && w.b === b) || (w.a === b && w.b === a);

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

export function toggleRightAngle(plan: Plan, id: string): void {
  if (findRightAngle(plan, id)) {
    plan.constraints = plan.constraints.filter((c) => !(c.type === 'rightAngle' && c.b === id));
    return;
  }
  const n = cornerNeighbours(plan, id);
  if (n) plan.constraints.push({ type: 'rightAngle', a: n[0], b: id, c: n[1] });
}

export function removePoint(plan: Plan, id: string): void {
  plan.points = plan.points.filter((p) => p.id !== id);
  plan.walls = plan.walls.filter((w) => w.a !== id && w.b !== id);
  plan.constraints = plan.constraints.filter((c) =>
    c.type === 'distance' ? c.a !== id && c.b !== id : c.a !== id && c.b !== id && c.c !== id
  );
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
  return { points: raw.points, walls: raw.walls, constraints: raw.constraints };
}

/** A closed room from an ordered list of corners (metres). */
export function roomFromCorners(corners: Vec[]): Plan {
  const plan = emptyPlan();
  const pts = corners.map((c) => addPoint(plan, c));
  pts.forEach((p, i) => plan.walls.push({ a: p.id, b: pts[(i + 1) % pts.length].id }));
  return plan;
}

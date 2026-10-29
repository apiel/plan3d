// The plan as solids for the 3D view: each piece is a flat outline on the plan
// (metres, y down like the plan) pulled up between two heights. Walls are cut
// into pieces around their doors and windows; three.js is kept out of here.

import { Plan, Vec, Wall, pointById, sameWall, wallThickness, windowFrame } from '../model';
import { groupLoop, insideLoop, insideRoom, roomIdsOf, roomOutline, rooms } from '../rooms';
import { stairCorners, stairSteps } from '../stairs';
import { furnitureOutline } from '../furniture';

export type Kind = 'wall' | 'glass' | 'floor' | 'stair' | 'furniture';

export interface Solid {
  kind: Kind;
  /** Outline on the plan, any simple polygon. */
  pts: Vec[];
  z0: number;
  z1: number;
  /** A colour the user picked, '#rrggbb'. */
  color?: string;
  /** Openings in the outline (a stairwell in a floor). */
  holes?: Vec[][];
}

/** Floor to ceiling, when the plan does not say. */
export const DEFAULT_HEIGHT = 2.5;
const DOOR_TOP = 2.05;
const SILL = 0.9;
const WINDOW_TOP = 2.1;
const STEP_RISE = 0.175;
const FLOOR = 0.02; // floors are a thin slab under the walls' foot

const add = (a: Vec, b: Vec, s = 1): Vec => ({ x: a.x + b.x * s, y: a.y + b.y * s });

/** Each wall's two outer corners, mitred where the wall goes round the outside of a group of rooms. */
function outerCorners(plan: Plan): Map<Wall, { a: Vec; b: Vec }> {
  const out = new Map<Wall, { a: Vec; b: Vec }>();
  const done = new Set<string>();
  for (const p of plan.points) {
    const ids = roomIdsOf(plan, p.id);
    const key = [...ids].sort().join();
    if (done.has(key)) continue;
    done.add(key);
    const loop = groupLoop(plan, ids);
    const o = roomOutline(plan, ids);
    if (!loop || !o) continue;
    loop.forEach((id, i) => {
      const next = loop[(i + 1) % loop.length];
      const wall = plan.walls.find((w) => sameWall(w, id, next));
      if (!wall) return;
      const [oa, ob] = [o.outer[i], o.outer[(i + 1) % loop.length]];
      out.set(wall, wall.a === id ? { a: oa, b: ob } : { a: ob, b: oa });
    });
  }
  return out;
}

/**
 * The solids of the plan: walls with their openings cut out, window panes,
 * floors, stairs and furniture. Every floor of the house is built at the same
 * level, side by side as on the plan.
 */
export const buildSolids = (plan: Plan): Solid[] => buildLevel(plan, { slab: FLOOR });

function buildLevel(plan: Plan, level: { slab: number }): Solid[] {
  const roomHeight = plan.height ?? DEFAULT_HEIGHT;
  const solids: Solid[] = [];
  const mitred = outerCorners(plan);

  for (const wall of plan.walls) {
    const a = pointById(plan, wall.a);
    const b = pointById(plan, wall.b);
    if (!a || !b) continue;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-6) continue;
    const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const t = wallThickness(plan, wall.a, wall.b);
    const height = wall.height ?? roomHeight;
    // outwards: away from the room, as the editor draws it
    let n = { x: -u.y, y: u.x };
    if (insideRoom(plan, roomIdsOf(plan, wall.a), add({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, n, 0.05))) n = { x: -n.x, y: -n.y };
    const ends = mitred.get(wall) ?? { a: add(a, n, t), b: add(b, n, t) };
    const inner = (s: number) => add(a, u, s);
    const outer = (s: number) => (s < 1e-6 ? ends.a : s > len - 1e-6 ? ends.b : add(add(a, u, s), n, t));
    const piece = (s0: number, s1: number, z0: number, z1: number, kind: Kind = 'wall', color?: string) => {
      if (s1 - s0 > 1e-6 && z1 - z0 > 1e-6) solids.push({ kind, pts: [inner(s0), inner(s1), outer(s1), outer(s0)], z0, z1, color });
    };

    // openings as stretches along a-b
    const cuts = plan.openings
      .filter((o) => sameWall(wall, o.a, o.b))
      .map((o) => {
        const [s0, s1] = o.a === wall.a ? [o.at, o.at + o.width] : [len - o.at - o.width, len - o.at];
        return { o, s0: Math.max(0, s0), s1: Math.min(len, s1) };
      })
      .filter((c) => c.s1 > c.s0);
    const stops = [...new Set([0, len, ...cuts.flatMap((c) => [c.s0, c.s1])])].sort((p, q) => p - q);
    for (let i = 0; i + 1 < stops.length; i++) {
      const [s0, s1] = [stops[i], stops[i + 1]];
      const o = cuts.find((c) => c.s0 <= (s0 + s1) / 2 && (s0 + s1) / 2 <= c.s1)?.o;
      if (!o) piece(s0, s1, 0, height, 'wall', wall.color);
      else if (o.type === 'part') piece(s0, s1, 0, height, 'wall', o.color ?? '#f87171');
      else if (o.type === 'door') piece(s0, s1, Math.min(DOOR_TOP, height), height, 'wall', wall.color);
      else {
        const top = Math.min(WINDOW_TOP, height);
        const f = windowFrame(o, t);
        const sill = Math.min(SILL, top);
        // under the window: the whole thickness, or in a niche only from the frame outwards
        if (o.niche) {
          if (s1 - s0 > 1e-6 && sill > 1e-6) solids.push({ kind: 'wall', pts: [add(inner(s0), n, f.from), add(inner(s1), n, f.from), outer(s1), outer(s0)], z0: 0, z1: sill, color: wall.color });
        } else piece(s0, s1, 0, sill, 'wall', wall.color);
        piece(s0, s1, top, height, 'wall', wall.color);
        // the pane, in the middle of the frame
        const m0 = add(inner(s0), n, (f.from + f.to) / 2 - 0.005);
        const m1 = add(inner(s1), n, (f.from + f.to) / 2 - 0.005);
        solids.push({ kind: 'glass', pts: [m0, m1, add(m1, n, 0.01), add(m0, n, 0.01)], z0: sill, z1: top });
      }
    }
  }

  // the floor is open where stairs go down through it (a hair smaller than the flight, so it never touches a wall)
  const wells = plan.stairs.filter((s) => s.down).map((s) => stairCorners({ ...s, width: s.width - 0.02, length: s.length - 0.02 }));
  for (const loop of rooms(plan)) {
    const pts = loop.map((id) => pointById(plan, id)!);
    const holes = wells.filter((w) => w.every((p) => insideLoop(plan, loop, p)));
    solids.push({ kind: 'floor', pts, z0: -level.slab, z1: 0, ...(holes.length ? { holes } : {}) });
  }

  // stairs up rise from this floor; stairs down reach this floor with their last step and drop to the floor under
  for (const s of plan.stairs) {
    const steps = stairSteps(s);
    const drop = s.down ? steps.length * STEP_RISE : 0;
    steps.forEach((pts, i) => solids.push({ kind: 'stair', pts, z0: -drop, z1: (i + 1) * STEP_RISE - drop }));
  }

  for (const f of plan.furniture) solids.push({ kind: 'furniture', pts: furnitureOutline(f), z0: 0, z1: f.h });
  return solids;
}

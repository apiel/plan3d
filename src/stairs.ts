// Straight stairs on the plan: a rectangle with one line per step and an arrow going up.

import { Stair, Vec, newId } from './model';

/** A typical straight flight: 90 cm wide, 13 steps of about 23 cm. */
export const newStair = (at: Vec): Stair => ({ id: newId(), x: at.x, y: at.y, width: 0.9, length: 3.0, angle: 0, steps: 13 });

/** Unit vectors: `u` along the flight (going up), `v` across it. */
export function stairAxes(s: Stair): { u: Vec; v: Vec } {
  const a = (s.angle * Math.PI) / 180;
  return { u: { x: Math.cos(a), y: Math.sin(a) }, v: { x: -Math.sin(a), y: Math.cos(a) } };
}

/** A point at `along` metres from the centre up the flight and `across` metres to its side. */
export function stairPoint(s: Stair, along: number, across: number): Vec {
  const { u, v } = stairAxes(s);
  return { x: s.x + u.x * along + v.x * across, y: s.y + u.y * along + v.y * across };
}

/** The four corners, starting at the bottom of the flight. */
export function stairCorners(s: Stair): Vec[] {
  const l = s.length / 2;
  const w = s.width / 2;
  return [stairPoint(s, -l, -w), stairPoint(s, l, -w), stairPoint(s, l, w), stairPoint(s, -l, w)];
}

/** The line between one step and the next, for each of the `steps - 1` nosings. */
export function stairTreads(s: Stair): [Vec, Vec][] {
  const out: [Vec, Vec][] = [];
  const n = Math.max(1, Math.round(s.steps));
  for (let i = 1; i < n; i++) {
    const along = -s.length / 2 + (i * s.length) / n;
    out.push([stairPoint(s, along, -s.width / 2), stairPoint(s, along, s.width / 2)]);
  }
  return out;
}

export function insideStair(s: Stair, p: Vec, margin = 0): boolean {
  const { u, v } = stairAxes(s);
  const dx = p.x - s.x;
  const dy = p.y - s.y;
  return Math.abs(dx * u.x + dy * u.y) <= s.length / 2 + margin && Math.abs(dx * v.x + dy * v.y) <= s.width / 2 + margin;
}

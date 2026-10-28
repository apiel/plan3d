// A simulated phone scan: what the depth sensor would return in a known room,
// for the extraction tests and the README's scan figure.

import { Vec } from '../model';
import { Keyframe } from './extract';

// small deterministic random numbers so the tests do not flake
export function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/** Distance along a 2D ray to the polygon boundary, or Infinity. */
function rayToPolygon(o: Vec, dx: number, dz: number, poly: Vec[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x;
    const ez = b.y - a.y;
    const den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((a.x - o.x) * ez - (a.y - o.y) * ex) / den;
    const u = ((a.x - o.x) * dz - (a.y - o.y) * dx) / den;
    if (t > 1e-6 && u >= 0 && u <= 1 && t < best) best = t;
  }
  return best;
}

/** Furniture as an axis-aligned box: min corner, size, height. */
export interface TestBox {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
}

/** Distance along a 3D ray to a box standing on the floor (slab method), or Infinity. */
function rayToBox(o: [number, number, number], dir: [number, number, number], b: TestBox): number {
  const lo = [b.x, 0, b.z];
  const hi = [b.x + b.w, b.h, b.z + b.d];
  let tmin = 0;
  let tmax = Infinity;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(dir[k]) < 1e-12) {
      if (o[k] < lo[k] || o[k] > hi[k]) return Infinity;
      continue;
    }
    let t1 = (lo[k] - o[k]) / dir[k];
    let t2 = (hi[k] - o[k]) / dir[k];
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return Infinity;
  }
  return tmin > 1e-6 ? tmin : Infinity;
}

/** A doorway or window: part of a wall (a to b) open from `bottom` to `top` metres; behind it the rays go on to the walls of `beyond`. */
export interface Hole {
  a: Vec;
  b: Vec;
  bottom: number;
  top: number;
  beyond: Vec[];
}

const onSegment = (p: Vec, a: Vec, b: Vec) => {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const t = ((p.x - a.x) * ex + (p.y - a.y) * ey) / (ex * ex + ey * ey);
  return t >= 0 && t <= 1 && Math.abs((p.x - a.x) * ey - (p.y - a.y) * ex) / Math.hypot(ex, ey) < 1e-6;
};

/** What a phone turning on the spot at each position would see in a room. */
export function scan(
  poly: Vec[],
  ceiling: number,
  cams: Vec[],
  noise = 0.02,
  camY = 1.4,
  boxes: TestBox[] = [],
  holes: Hole[] = []
): Keyframe[] {
  const rand = rng(7);
  return cams.map((c) => {
    const pts: number[] = [];
    for (let az = 0; az < 360; az += 4) {
      for (let el = -60; el <= 60; el += 10) {
        const a = (az * Math.PI) / 180;
        const e = (el * Math.PI) / 180;
        const dx = Math.cos(a);
        const dz = Math.sin(a);
        let flat = rayToPolygon(c, dx, dz, poly);
        // through a doorway or window: the ray goes on to whatever is behind it
        const at = { x: c.x + dx * flat, y: c.y + dz * flat };
        const y = camY + Math.tan(e) * flat;
        const hole = holes.find((h) => onSegment(at, h.a, h.b) && y > h.bottom && y < h.top);
        if (hole) flat += rayToPolygon(at, dx, dz, hole.beyond); // from the opening on to the far side of the space behind it
        let t = flat / Math.cos(e);
        if (el < 0) t = Math.min(t, camY / -Math.sin(e));
        if (el > 0) t = Math.min(t, (ceiling - camY) / Math.sin(e));
        for (const b of boxes) t = Math.min(t, rayToBox([c.x, camY, c.y], [Math.cos(e) * dx, Math.sin(e), Math.cos(e) * dz], b));
        if (!isFinite(t) || t > 6) continue;
        const n = () => (rand() - 0.5) * 2 * noise;
        pts.push(c.x + Math.cos(e) * dx * t + n(), camY + Math.sin(e) * t + n(), c.y + Math.cos(e) * dz * t + n());
      }
    }
    return { cam: [c.x, camY, c.y], points: Float32Array.from(pts) };
  });
}

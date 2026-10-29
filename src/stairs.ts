// Stairs on the plan: a straight flight with one line per step and an arrow going
// up, optionally turning a quarter turn to the left or right at the bottom or the
// top. A turn is a square as wide as the flight, beyond its end, with winders.

import { Stair, Turn, Vec, newId } from './model';

/** A typical straight flight: 90 cm wide, 13 steps of about 23 cm. */
export const newStair = (at: Vec): Stair => ({ id: newId(), x: at.x, y: at.y, width: 0.9, length: 3.0, angle: 0, steps: 13 });

/** Steps in each quarter turn: winders fanning out from the inner corner. */
export const WINDERS = 3;

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

/** Steps on the straight part, once the turns have taken theirs. */
export const straightSteps = (s: Stair): number => Math.max(1, Math.round(s.steps) - WINDERS * ((s.bottom ? 1 : 0) + (s.top ? 1 : 0)));

/** Where the outline starts and ends along the flight: the turns add a square beyond each end. */
function extent(s: Stair): [number, number] {
  return [-s.length / 2 - (s.bottom ? s.width : 0), s.length / 2 + (s.top ? s.width : 0)];
}

/** The four corners, starting at the bottom of the flight. */
export function stairCorners(s: Stair): Vec[] {
  const [lo, hi] = extent(s);
  const w = s.width / 2;
  return [stairPoint(s, lo, -w), stairPoint(s, hi, -w), stairPoint(s, hi, w), stairPoint(s, lo, w)];
}

/** Local (along, across) coordinates. */
type Local = [number, number];

/**
 * A turn's square in local coordinates: `p` is the inner corner the walker
 * turns around, `a` runs from it along the side next to the straight part,
 * `b` along the side where the stairs come in (bottom) or go out (top).
 * Turning left going up, the walker comes in from the left at the bottom, and
 * goes out to the left at the top; v points to the walker's right.
 */
function turnSquare(s: Stair, end: 'bottom' | 'top', turn: Turn): { p: Local; a: Local; b: Local } {
  const side = turn === 'left' ? -1 : 1;
  const top = end === 'top';
  return { p: [((top ? 1 : -1) * s.length) / 2, (side * s.width) / 2], a: [0, -side], b: [top ? 1 : -1, 0] };
}

const at = (p: Local, a: Local, ta: number, b: Local, tb: number): Local => [p[0] + a[0] * ta + b[0] * tb, p[1] + a[1] * ta + b[1] * tb];

/** The winders of a turn, from the straight part's side round to the free side. */
function winders(s: Stair, end: 'bottom' | 'top', turn: Turn): Local[][] {
  const { p, a, b } = turnSquare(s, end, turn);
  const w = s.width;
  const t = w * Math.tan(Math.PI / 6); // lines at 30° and 60° from the inner corner
  return [
    [p, at(p, a, w, b, 0), at(p, a, w, b, t)],
    [p, at(p, a, w, b, t), at(p, a, w, b, w), at(p, a, t, b, w)],
    [p, at(p, a, t, b, w), at(p, a, 0, b, w)],
  ];
}

/** Every step as an outline on the plan, from the bottom one up. */
export function stairSteps(s: Stair): Vec[][] {
  const out: Local[][] = [];
  if (s.bottom) out.push(...winders(s, 'bottom', s.bottom).reverse());
  const n = straightSteps(s);
  const w = s.width / 2;
  for (let i = 0; i < n; i++) {
    const from = -s.length / 2 + (i * s.length) / n;
    const to = -s.length / 2 + ((i + 1) * s.length) / n;
    out.push([[from, -w], [to, -w], [to, w], [from, w]]);
  }
  if (s.top) out.push(...winders(s, 'top', s.top));
  return out.map((poly) => poly.map(([al, ac]) => stairPoint(s, al, ac)));
}

/** The line between one step and the next: the nosings, the ends of the straight part and the winders' edges. */
export function stairTreads(s: Stair): [Vec, Vec][] {
  const out: [Local, Local][] = [];
  const n = straightSteps(s);
  const w = s.width / 2;
  for (let i = 1; i < n; i++) {
    const along = -s.length / 2 + (i * s.length) / n;
    out.push([[along, -w], [along, w]]);
  }
  for (const end of ['bottom', 'top'] as const) {
    const turn = s[end];
    if (!turn) continue;
    const ws = winders(s, end, turn);
    out.push([ws[0][0], ws[0][1]], [ws[0][0], ws[0][2]], [ws[2][0], ws[2][1]]);
  }
  return out.map(([p, q]) => [stairPoint(s, ...p), stairPoint(s, ...q)]);
}

/** The walking line up the middle, from just inside where the stairs start to just inside where they arrive. */
export function stairWalk(s: Stair): Vec[] {
  const out: Local[] = [];
  if (s.bottom) {
    const { p, a, b } = turnSquare(s, 'bottom', s.bottom);
    out.push(at(p, a, 0.15, b, s.width / 2), at(p, a, s.width / 2, b, s.width / 2));
  } else out.push([-s.length / 2 + 0.15, 0]);
  if (s.top) {
    const { p, a, b } = turnSquare(s, 'top', s.top);
    out.push(at(p, a, s.width / 2, b, s.width / 2), at(p, a, 0.05, b, s.width / 2));
  } else out.push([s.length / 2 - 0.05, 0]);
  return out.map(([al, ac]) => stairPoint(s, al, ac));
}

/** The same stairs going up the other way: the turns swap ends, and left becomes right. */
export function flipStair(s: Stair): void {
  const other = (t?: Turn): Turn | undefined => (t === 'left' ? 'right' : t === 'right' ? 'left' : undefined);
  const [bottom, top] = [other(s.top), other(s.bottom)];
  s.angle = (s.angle + 180) % 360;
  if (bottom) s.bottom = bottom;
  else delete s.bottom;
  if (top) s.top = top;
  else delete s.top;
}

export function insideStair(s: Stair, p: Vec, margin = 0): boolean {
  const { u, v } = stairAxes(s);
  const dx = p.x - s.x;
  const dy = p.y - s.y;
  const [lo, hi] = extent(s);
  const along = dx * u.x + dy * u.y;
  return along >= lo - margin && along <= hi + margin && Math.abs(dx * v.x + dy * v.y) <= s.width / 2 + margin;
}

/** The handles of selected stairs: the middle of each end and of each side of the straight part. */
export type StairHandle = 'bottom' | 'top' | 'left' | 'right';

export function stairHandles(s: Stair): Record<StairHandle, Vec> {
  const [lo, hi] = extent(s);
  return { bottom: stairPoint(s, lo, 0), top: stairPoint(s, hi, 0), left: stairPoint(s, 0, -s.width / 2), right: stairPoint(s, 0, s.width / 2) };
}

const MIN_LENGTH = 0.3;
const MIN_WIDTH = 0.4;

/**
 * `start` with one handle dragged by `d` (metres on the plan): that end or side
 * follows, to the centimetre, and the opposite one stays where it was.
 */
export function resizeStair(start: Stair, handle: StairHandle, d: Vec): Pick<Stair, 'x' | 'y' | 'width' | 'length'> {
  const { u, v } = stairAxes(start);
  const ends = handle === 'top' || handle === 'bottom';
  const dir = ends ? u : v;
  const sign = handle === 'top' || handle === 'right' ? 1 : -1;
  const old = ends ? start.length : start.width;
  const size = Math.max(ends ? MIN_LENGTH : MIN_WIDTH, Math.round((old + sign * (d.x * dir.x + d.y * dir.y)) * 100) / 100);
  const shift = (sign * (size - old)) / 2;
  return {
    x: start.x + dir.x * shift,
    y: start.y + dir.y * shift,
    width: ends ? start.width : size,
    length: ends ? size : start.length,
  };
}

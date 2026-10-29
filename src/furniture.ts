// Furniture library: pieces with their usual size and a plan symbol, placed as
// rotated boxes. Each symbol is drawn in the piece's own frame: x across its
// width, y from its back (-0.5, against the wall) to its front (+0.5), both as
// fractions of the size, so a piece resized in the editor keeps its look.

import { Furniture, Plan, Vec, Wall, dist, newId, pointById, sameWall, wallThickness, windowFrame } from './model';

export type Shape =
  /** Rectangle between two corners; `r` rounds its corners, in metres. */
  | { t: 'rect'; x0: number; y0: number; x1: number; y1: number; r?: number }
  | { t: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  | { t: 'line'; x0: number; y0: number; x1: number; y1: number }
  | { t: 'text'; x: number; y: number; s: string };

export interface FurnitureItem {
  kind: string;
  name: string;
  group: string;
  /** Width, depth (back to front) and height, metres. */
  w: number;
  d: number;
  h: number;
  /** The footprint is the ellipse inside the box (round table, plant). */
  round?: boolean;
  shapes: Shape[];
}

const R = (x0: number, y0: number, x1: number, y1: number, r?: number): Shape => ({ t: 'rect', x0, y0, x1, y1, r });
const E = (cx: number, cy: number, rx: number, ry: number): Shape => ({ t: 'ellipse', cx, cy, rx, ry });
const L = (x0: number, y0: number, x1: number, y1: number): Shape => ({ t: 'line', x0, y0, x1, y1 });
const T = (s: string, x = 0, y = 0): Shape => ({ t: 'text', x, y, s });
const BOX = R(-0.5, -0.5, 0.5, 0.5);
const box = (r: number) => R(-0.5, -0.5, 0.5, 0.5, r);

const bed = (pillows: number): Shape[] => [
  box(0.03),
  ...Array.from({ length: pillows }, (_, i) => R(-0.45 + (0.9 * i) / pillows + 0.02, -0.47, -0.45 + (0.9 * (i + 1)) / pillows - 0.02, -0.37, 0.04)),
  L(-0.5, -0.27, 0.5, -0.27),
  L(0.15, -0.27, 0.5, -0.12),
];

const sofa = (seats: number): Shape[] => [
  box(0.05),
  R(-0.5, -0.5, 0.5, -0.25, 0.05),
  R(-0.5, -0.25, -0.42, 0.5, 0.03),
  R(0.42, -0.25, 0.5, 0.5, 0.03),
  ...Array.from({ length: seats - 1 }, (_, i) => -0.42 + (0.84 * (i + 1)) / seats).map((x) => L(x, -0.25, x, 0.5)),
];

export const LIBRARY: FurnitureItem[] = [
  // bathroom
  { kind: 'wc', name: 'WC', group: 'Bathroom', w: 0.38, d: 0.65, h: 0.8, shapes: [R(-0.5, -0.5, 0.5, -0.22, 0.03), E(0, 0.12, 0.42, 0.38), E(0, 0.15, 0.27, 0.25)] },
  { kind: 'basin', name: 'Washbasin', group: 'Bathroom', w: 0.6, d: 0.45, h: 0.85, shapes: [box(0.04), E(0, 0.08, 0.38, 0.34), E(0, -0.38, 0.04, 0.06)] },
  { kind: 'doubleBasin', name: 'Double basin', group: 'Bathroom', w: 1.2, d: 0.5, h: 0.85, shapes: [box(0.04), E(-0.25, 0.08, 0.19, 0.34), E(0.25, 0.08, 0.19, 0.34), E(-0.25, -0.38, 0.02, 0.06), E(0.25, -0.38, 0.02, 0.06)] },
  { kind: 'shower', name: 'Shower', group: 'Bathroom', w: 0.9, d: 0.9, h: 0.05, shapes: [BOX, L(-0.5, -0.5, 0.5, 0.5), L(0.5, -0.5, -0.5, 0.5), E(0, 0, 0.06, 0.06)] },
  { kind: 'walkInShower', name: 'Walk-in shower', group: 'Bathroom', w: 1.2, d: 0.9, h: 0.05, shapes: [BOX, L(-0.5, -0.5, 0.5, 0.5), L(0.5, -0.5, -0.5, 0.5), E(0, 0, 0.045, 0.06), L(-0.5, 0.5, 0.1, 0.5)] },
  { kind: 'bath', name: 'Bathtub', group: 'Bathroom', w: 1.7, d: 0.75, h: 0.55, shapes: [box(0.03), R(-0.46, -0.38, 0.46, 0.38, 0.2), E(-0.38, 0, 0.02, 0.05)] },
  { kind: 'bidet', name: 'Bidet', group: 'Bathroom', w: 0.38, d: 0.55, h: 0.4, shapes: [E(0, 0, 0.5, 0.5), E(0, 0.06, 0.32, 0.32), E(0, -0.35, 0.06, 0.05)] },
  { kind: 'washer', name: 'Washing machine', group: 'Bathroom', w: 0.6, d: 0.6, h: 0.85, shapes: [BOX, L(-0.5, -0.32, 0.5, -0.32), E(0, 0.1, 0.32, 0.32)] },
  { kind: 'dryer', name: 'Dryer', group: 'Bathroom', w: 0.6, d: 0.6, h: 0.85, shapes: [BOX, L(-0.5, -0.32, 0.5, -0.32), E(0, 0.1, 0.32, 0.32), E(0, 0.1, 0.2, 0.2)] },
  { kind: 'radiator', name: 'Radiator', group: 'Bathroom', w: 1.0, d: 0.1, h: 0.6, shapes: [BOX, ...[-0.3, -0.1, 0.1, 0.3].map((x) => L(x, -0.5, x, 0.5))] },
  // kitchen
  { kind: 'kitchenSink', name: 'Kitchen sink', group: 'Kitchen', w: 1.0, d: 0.6, h: 0.9, shapes: [BOX, R(-0.42, -0.3, 0, 0.35, 0.04), E(-0.21, -0.42, 0.03, 0.05), ...[-0.15, 0, 0.15].map((y) => L(0.1, y, 0.42, y))] },
  { kind: 'hob', name: 'Cooker', group: 'Kitchen', w: 0.6, d: 0.6, h: 0.9, shapes: [BOX, E(-0.22, -0.2, 0.16, 0.16), E(0.22, -0.2, 0.12, 0.12), E(-0.22, 0.2, 0.12, 0.12), E(0.22, 0.2, 0.16, 0.16)] },
  { kind: 'fridge', name: 'Fridge', group: 'Kitchen', w: 0.6, d: 0.65, h: 1.85, shapes: [BOX, L(-0.5, 0.38, 0.5, 0.38), T('F')] },
  { kind: 'dishwasher', name: 'Dishwasher', group: 'Kitchen', w: 0.6, d: 0.6, h: 0.85, shapes: [BOX, L(-0.5, 0.38, 0.5, 0.38), T('DW')] },
  { kind: 'counter', name: 'Kitchen unit', group: 'Kitchen', w: 0.6, d: 0.6, h: 0.9, shapes: [BOX, L(-0.5, 0.38, 0.5, 0.38)] },
  { kind: 'tallUnit', name: 'Tall unit', group: 'Kitchen', w: 0.6, d: 0.6, h: 2.1, shapes: [BOX, L(-0.5, 0.38, 0.5, 0.38), L(-0.5, -0.5, 0.5, 0.38), L(0.5, -0.5, -0.5, 0.38)] },
  // bedroom
  { kind: 'bedSingle', name: 'Single bed', group: 'Bedroom', w: 0.9, d: 2.0, h: 0.5, shapes: bed(1) },
  { kind: 'bedDouble', name: 'Double bed', group: 'Bedroom', w: 1.4, d: 1.9, h: 0.5, shapes: bed(2) },
  { kind: 'bedQueen', name: 'Bed 160', group: 'Bedroom', w: 1.6, d: 2.0, h: 0.5, shapes: bed(2) },
  { kind: 'cot', name: 'Cot', group: 'Bedroom', w: 0.65, d: 1.25, h: 0.9, shapes: [BOX, R(-0.42, -0.45, 0.42, 0.45), ...[-0.25, 0, 0.25].map((y) => L(-0.5, y, -0.42, y))] },
  { kind: 'bedside', name: 'Bedside table', group: 'Bedroom', w: 0.45, d: 0.4, h: 0.55, shapes: [BOX, E(0, 0, 0.25, 0.28)] },
  { kind: 'wardrobe', name: 'Wardrobe', group: 'Bedroom', w: 1.0, d: 0.6, h: 2.0, shapes: [BOX, L(-0.45, 0, 0.45, 0), ...[-0.3, -0.1, 0.1, 0.3].map((x) => L(x - 0.05, -0.25, x + 0.05, 0.25))] },
  { kind: 'drawers', name: 'Chest of drawers', group: 'Bedroom', w: 0.8, d: 0.5, h: 0.9, shapes: [BOX, L(-0.5, 0.35, 0.5, 0.35)] },
  // living room
  { kind: 'sofa2', name: 'Sofa, 2 seats', group: 'Living', w: 1.6, d: 0.9, h: 0.85, shapes: sofa(2) },
  { kind: 'sofa3', name: 'Sofa, 3 seats', group: 'Living', w: 2.1, d: 0.9, h: 0.85, shapes: sofa(3) },
  { kind: 'armchair', name: 'Armchair', group: 'Living', w: 0.8, d: 0.85, h: 0.85, shapes: [box(0.06), R(-0.5, -0.5, 0.5, -0.22, 0.05), R(-0.5, -0.22, -0.32, 0.5, 0.04), R(0.32, -0.22, 0.5, 0.5, 0.04)] },
  { kind: 'coffeeTable', name: 'Coffee table', group: 'Living', w: 1.1, d: 0.6, h: 0.45, shapes: [box(0.05)] },
  { kind: 'tvUnit', name: 'TV unit', group: 'Living', w: 1.6, d: 0.4, h: 0.5, shapes: [BOX, R(-0.3, -0.25, 0.3, -0.05)] },
  { kind: 'bookshelf', name: 'Bookshelf', group: 'Living', w: 0.8, d: 0.3, h: 2.0, shapes: [BOX, L(-0.17, -0.5, -0.17, 0.5), L(0.17, -0.5, 0.17, 0.5)] },
  { kind: 'plant', name: 'Plant', group: 'Living', w: 0.4, d: 0.4, h: 1.0, round: true, shapes: [E(0, 0, 0.5, 0.5), E(0, 0, 0.2, 0.2), L(-0.35, -0.35, 0.35, 0.35), L(0.35, -0.35, -0.35, 0.35)] },
  // dining
  { kind: 'table4', name: 'Table for 4', group: 'Dining', w: 1.2, d: 0.8, h: 0.75, shapes: [box(0.02)] },
  { kind: 'table6', name: 'Table for 6', group: 'Dining', w: 1.8, d: 0.9, h: 0.75, shapes: [box(0.02)] },
  { kind: 'roundTable', name: 'Round table', group: 'Dining', w: 1.0, d: 1.0, h: 0.75, round: true, shapes: [E(0, 0, 0.5, 0.5)] },
  { kind: 'chair', name: 'Chair', group: 'Dining', w: 0.45, d: 0.5, h: 0.9, shapes: [R(-0.5, -0.3, 0.5, 0.5, 0.03), R(-0.5, -0.5, 0.5, -0.3, 0.02)] },
  // office and other
  { kind: 'desk', name: 'Desk', group: 'Office & other', w: 1.2, d: 0.6, h: 0.75, shapes: [box(0.02)] },
  { kind: 'officeChair', name: 'Office chair', group: 'Office & other', w: 0.6, d: 0.6, h: 1.0, round: true, shapes: [E(0, 0, 0.5, 0.5), R(-0.35, 0.2, 0.35, 0.38, 0.04)] },
  { kind: 'boiler', name: 'Boiler', group: 'Office & other', w: 0.4, d: 0.35, h: 0.7, shapes: [BOX, E(0, 0, 0.25, 0.25)] },
  // a raised floor to stand on: see through on the plan, with its height written on it
  { kind: 'platform', name: 'Platform', group: 'Office & other', w: 1.0, d: 1.0, h: 0.6, shapes: [BOX, R(-0.4, -0.4, 0.4, 0.4)] },
  { kind: 'box', name: 'Box', group: 'Office & other', w: 0.6, d: 0.6, h: 0.9, shapes: [BOX, L(-0.5, -0.5, 0.5, 0.5), L(0.5, -0.5, -0.5, 0.5)] },
];

/** The library entry for a piece; an unknown kind (from a newer version or an AI edit) is drawn as a plain box. */
export const furnitureItem = (kind: string): FurnitureItem =>
  LIBRARY.find((i) => i.kind === kind) ?? { kind, name: kind, group: '', w: 0.6, d: 0.6, h: 0.9, shapes: [BOX] };

export const newFurniture = (kind: string, at: Vec): Furniture => {
  const i = furnitureItem(kind);
  return { id: newId(), kind, x: at.x, y: at.y, w: i.w, d: i.d, h: i.h, angle: 0 };
};

/** Unit vectors: `u` across the piece (its width), `v` from its back to its front. */
export function furnitureAxes(f: Furniture): { u: Vec; v: Vec } {
  const a = (f.angle * Math.PI) / 180;
  return { u: { x: Math.cos(a), y: Math.sin(a) }, v: { x: -Math.sin(a), y: Math.cos(a) } };
}

/** A point in the piece's frame (fractions of its width and depth) on the plan. */
export function furniturePoint(f: Furniture, fx: number, fy: number): Vec {
  const { u, v } = furnitureAxes(f);
  return { x: f.x + u.x * fx * f.w + v.x * fy * f.d, y: f.y + u.y * fx * f.w + v.y * fy * f.d };
}

/** Its footprint on the plan: the box, or the ellipse in it for round pieces. */
export function furnitureOutline(f: Furniture): Vec[] {
  if (furnitureItem(f.kind).round) {
    return Array.from({ length: 24 }, (_, i) => furniturePoint(f, 0.5 * Math.cos((i * Math.PI) / 12), 0.5 * Math.sin((i * Math.PI) / 12)));
  }
  return [furniturePoint(f, -0.5, -0.5), furniturePoint(f, 0.5, -0.5), furniturePoint(f, 0.5, 0.5), furniturePoint(f, -0.5, 0.5)];
}

export function insideFurniture(f: Furniture, p: Vec, margin = 0): boolean {
  const { u, v } = furnitureAxes(f);
  const dx = p.x - f.x;
  const dy = p.y - f.y;
  return Math.abs(dx * u.x + dy * u.y) <= f.w / 2 + margin && Math.abs(dx * v.x + dy * v.y) <= f.d / 2 + margin;
}

/** How far from a wall, in metres, a piece is pulled against it. */
const SNAP = 0.25;

/**
 * Pulls a piece flush against the nearest wall within reach, and into the
 * corner when a second wall across the first is near too. `back`: the piece
 * turns its back to the wall (a WC, a bed); otherwise it keeps whichever side
 * is closest to facing the wall. Under a window open down to the floor, a
 * piece narrow enough goes back into the niche, up to the frame. True when it moved.
 */
export function snapToWalls(plan: Plan, f: Furniture, back: boolean): boolean {
  let first: Vec | undefined;
  for (let pass = 0; pass < 2; pass++) {
    let best: { foot: Vec; n: Vec; gap: number; u: Vec; w: Wall; t: number; len: number } | undefined;
    for (const w of plan.walls) {
      const a = pointById(plan, w.a);
      const b = pointById(plan, w.b);
      if (!a || !b) continue;
      const len = dist(a, b);
      if (len < 1e-6) continue;
      const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
      if (first && Math.abs(u.x * first.x + u.y * first.y) > 0.2) continue; // the second wall goes across the first
      const t = (f.x - a.x) * u.x + (f.y - a.y) * u.y;
      if (t < 0 || t > len) continue;
      const foot = { x: a.x + u.x * t, y: a.y + u.y * t };
      const dd = dist(f, foot);
      if (dd < 1e-6) continue;
      const n = { x: (f.x - foot.x) / dd, y: (f.y - foot.y) / dd }; // from the wall towards the piece
      const half = pass === 0 && back ? f.d / 2 : halfAcross(f, n);
      const gap = dd - half;
      if (gap < SNAP && (!best || gap < best.gap)) best = { foot, n, gap, u, w, t, len };
    }
    if (!best) break;
    const { foot, n } = best;
    if (pass === 0) {
      // square to the wall: back to it, or the nearest quarter turn to how it stands now
      const backAngle = (Math.atan2(-n.x, n.y) * 180) / Math.PI;
      const turns = back ? 0 : Math.round((f.angle - backAngle) / 90);
      f.angle = (((backAngle + turns * 90) % 360) + 360) % 360;
      first = best.u;
    }
    const along = halfAcross(f, best.u);
    const half = halfAcross(f, n) - nicheDepth(plan, best.w, best.len, best.t - along, best.t + along);
    f.x = foot.x + n.x * half;
    f.y = foot.y + n.y * half;
  }
  return first !== undefined;
}

/** How far back from wall `w`'s face the stretch from `s0` to `s1` (metres from `w.a`) can go: into a niche under a window that spans all of it. */
function nicheDepth(plan: Plan, w: Wall, len: number, s0: number, s1: number): number {
  let depth = 0;
  for (const o of plan.openings) {
    if (o.type !== 'window' || !o.niche || !sameWall(w, o.a, o.b)) continue;
    const [o0, o1] = o.a === w.a ? [o.at, o.at + o.width] : [len - o.at - o.width, len - o.at];
    if (s0 >= o0 - 1e-6 && s1 <= o1 + 1e-6) depth = Math.max(depth, windowFrame(o, wallThickness(plan, w.a, w.b)).from);
  }
  return depth;
}

/** Half the piece's extent along direction `n`. */
function halfAcross(f: Furniture, n: Vec): number {
  const { u, v } = furnitureAxes(f);
  return (Math.abs(n.x * u.x + n.y * u.y) * f.w + Math.abs(n.x * v.x + n.y * v.y) * f.d) / 2;
}

const num = (x: number) => +x.toFixed(2);

/** A piece's symbol as SVG elements, centred on 0, 0, `k` drawing units per metre. */
export function symbolSvg(item: FurnitureItem, w: number, d: number, k: number): string {
  const X = (fx: number) => num(fx * w * k);
  const Y = (fy: number) => num(fy * d * k);
  return item.shapes
    .map((s) => {
      if (s.t === 'rect') {
        const [x, y, rw, rh] = [X(Math.min(s.x0, s.x1)), Y(Math.min(s.y0, s.y1)), num(Math.abs(s.x1 - s.x0) * w * k), num(Math.abs(s.y1 - s.y0) * d * k)];
        return `<rect x="${x}" y="${y}" width="${rw}" height="${rh}"${s.r ? ` rx="${num(Math.min(s.r * k, rw / 2, rh / 2))}"` : ''}/>`;
      }
      if (s.t === 'ellipse') return `<ellipse cx="${X(s.cx)}" cy="${Y(s.cy)}" rx="${num(s.rx * w * k)}" ry="${num(s.ry * d * k)}"/>`;
      if (s.t === 'line') return `<line x1="${X(s.x0)}" y1="${Y(s.y0)}" x2="${X(s.x1)}" y2="${Y(s.y1)}"/>`;
      const size = num(Math.min(w, d) * k * 0.3);
      return `<text x="${X(s.x)}" y="${Y(s.y)}" font-size="${size}" text-anchor="middle" dominant-baseline="central" fill="currentColor" stroke="none">${s.s}</text>`;
    })
    .join('');
}

/** A small picture of a library piece for its button, fitted in a 24 x 24 box. */
export const furnitureIcon = (item: FurnitureItem): string =>
  `<svg viewBox="-12 -12 24 24">${symbolSvg(item, item.w, item.d, 20 / Math.max(item.w, item.d))}</svg>`;

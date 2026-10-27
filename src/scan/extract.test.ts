import { describe, expect, it } from 'vitest';
import { Vec, dist } from '../model';
import { Keyframe, extractRoom, polyArea } from './extract';

// small deterministic random numbers so the tests do not flake
function rng(seed: number) {
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
interface TestBox {
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

/** What a phone turning on the spot at each position would see in a room. */
function scan(poly: Vec[], ceiling: number, cams: Vec[], noise = 0.02, camY = 1.4, boxes: TestBox[] = []): Keyframe[] {
  const rand = rng(7);
  return cams.map((c) => {
    const pts: number[] = [];
    for (let az = 0; az < 360; az += 4) {
      for (let el = -60; el <= 60; el += 10) {
        const a = (az * Math.PI) / 180;
        const e = (el * Math.PI) / 180;
        const dx = Math.cos(a);
        const dz = Math.sin(a);
        let t = rayToPolygon(c, dx, dz, poly) / Math.cos(e);
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

const sides = (poly: Vec[]) => poly.map((p, i) => dist(p, poly[(i + 1) % poly.length])).sort((a, b) => a - b);

describe('extractRoom', () => {
  const rect: Vec[] = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 3 },
    { x: 0, y: 3 },
  ];

  it('finds a rectangular room', () => {
    const frames = scan(rect, 2.5, [
      { x: 1, y: 1 },
      { x: 3, y: 1 },
      { x: 1, y: 2 },
      { x: 3, y: 2 },
      { x: 2, y: 1.5 },
    ]);
    const room = extractRoom(frames)!;
    expect(room).not.toBeNull();
    expect(room.corners).toHaveLength(4);
    const s = sides(room.corners);
    expect(s[0]).toBeCloseTo(3, 0);
    expect(s[3]).toBeCloseTo(4, 0);
    expect(Math.abs(polyArea(room.corners))).toBeGreaterThan(11);
    expect(Math.abs(polyArea(room.corners))).toBeLessThan(12.6);
    expect(room.floorY).toBeCloseTo(0, 1);
    expect(room.ceilingY).toBeCloseTo(2.5, 1);
  });

  it('finds the same room when the capture is rotated in the world', () => {
    const a = 0.5;
    const turned = rect.map((p) => ({ x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) }));
    const cams = [
      { x: 1, y: 1 },
      { x: 3, y: 1 },
      { x: 1, y: 2 },
      { x: 3, y: 2 },
    ].map((p) => ({ x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) }));
    const room = extractRoom(scan(turned, 2.5, cams))!;
    expect(room.corners).toHaveLength(4);
    const s = sides(room.corners);
    expect(s[0]).toBeCloseTo(3, 0);
    expect(s[3]).toBeCloseTo(4, 0);
  });

  it('finds an L-shaped room', () => {
    const l: Vec[] = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 2 },
      { x: 3, y: 2 },
      { x: 3, y: 4 },
      { x: 0, y: 4 },
    ];
    const frames = scan(l, 2.5, [
      { x: 1, y: 1 },
      { x: 2.5, y: 1 },
      { x: 4, y: 1 },
      { x: 1, y: 3 },
      { x: 2, y: 2.5 },
      { x: 1.5, y: 1.8 },
    ]);
    const room = extractRoom(frames)!;
    expect(room).not.toBeNull();
    expect(room.corners).toHaveLength(6);
    expect(Math.abs(polyArea(room.corners))).toBeGreaterThan(14.5);
    expect(Math.abs(polyArea(room.corners))).toBeLessThan(16.6);
  });

  it('copes with noisier depth and stray points', () => {
    const frames = scan(
      rect,
      2.5,
      [
        { x: 1, y: 1 },
        { x: 3, y: 1 },
        { x: 1, y: 2 },
        { x: 3, y: 2 },
        { x: 2, y: 1.5 },
      ],
      0.04
    );
    // a few wild readings, like depth bleeding at object edges
    const rand = rng(99);
    for (const f of frames) {
      for (let i = 0; i < f.points.length; i += 3) {
        if (rand() < 0.02) {
          f.points[i] += (rand() - 0.5) * 3;
          f.points[i + 2] += (rand() - 0.5) * 3;
        }
      }
    }
    const room = extractRoom(frames)!;
    expect(room).not.toBeNull();
    expect(room.corners).toHaveLength(4);
    const s = sides(room.corners);
    expect(s[0]).toBeGreaterThan(2.7);
    expect(s[3]).toBeLessThan(4.3);
  });

  it('keeps walls straight behind furniture and finds the furniture', () => {
    const sofa = { x: 0, z: 2.1, w: 2.2, d: 0.9, h: 0.85 }; // against the back wall
    const desk = { x: 3.2, z: 0.4, w: 0.8, d: 1.4, h: 0.75 }; // against the right wall
    const table = { x: 1.4, z: 0.9, w: 1.2, d: 0.8, h: 0.75 }; // free standing
    const frames = scan(
      rect,
      2.5,
      [
        { x: 0.8, y: 0.5 },
        { x: 2.6, y: 0.4 },
        { x: 0.6, y: 1.6 },
        { x: 2.9, y: 1.9 },
      ],
      0.02,
      1.4,
      [sofa, desk, table]
    );
    const room = extractRoom(frames)!;
    expect(room.corners).toHaveLength(4);
    const s = sides(room.corners);
    expect(s[0]).toBeCloseTo(3, 0);
    expect(s[3]).toBeCloseTo(4, 0);
    expect(Math.abs(polyArea(room.corners))).toBeGreaterThan(11);

    // the free-standing table is found where it is, roughly its size
    const found = room.furniture.find((b) => Math.abs(b.x + b.w / 2 - 2.0) < 0.3 && Math.abs(b.y + b.d / 2 - 1.3) < 0.3);
    expect(found).toBeDefined();
    expect(found!.w).toBeGreaterThan(0.9);
    expect(found!.w).toBeLessThan(1.5);
    expect(found!.h).toBeCloseTo(0.75, 1);

    // the sofa is pulled back to the wall it stands against
    const couch = room.furniture.find((b) => b.w > 1.7 && b.y > 1.8);
    expect(couch).toBeDefined();
    expect(couch!.y + couch!.d).toBeCloseTo(Math.max(...room.corners.map((c) => c.y)), 2);
  });

  it('uses marked corners, with the walls fitted to the depth points', () => {
    const l: Vec[] = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 2 },
      { x: 3, y: 2 },
      { x: 3, y: 4 },
      { x: 0, y: 4 },
    ];
    const frames = scan(l, 2.5, [
      { x: 1, y: 1 },
      { x: 4, y: 1 },
      { x: 1, y: 3 },
    ]);
    // marks are off by up to 8 cm, in a random order, one corner marked twice
    const rand = rng(3);
    const off = () => (rand() - 0.5) * 0.16;
    const marked = [l[3], l[0], l[5], l[1], l[4], l[2], l[0]];
    const corners = marked.map((p): [number, number, number] => [p.x + off(), 1.2, p.y + off()]);
    const room = extractRoom(frames, { corners, openings: [] })!;
    expect(room.corners).toHaveLength(6);
    const s = sides(room.corners);
    const truth = sides(l);
    s.forEach((v, i) => expect(Math.abs(v - truth[i])).toBeLessThan(0.05));
  });

  it('places doors and windows on the nearest wall', () => {
    const cams = [
      { x: 1, y: 1 },
      { x: 3, y: 1 },
      { x: 1, y: 2 },
      { x: 3, y: 2 },
    ];
    // a turned capture, so the openings must follow the same rotation as the walls
    const a = 0.3;
    const turn = (p: Vec): Vec => ({ x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) });
    const at = (p: Vec, y: number): [number, number, number] => {
      const t = turn(p);
      return [t.x, y, t.y];
    };
    const frames = scan(rect.map(turn), 2.5, cams.map(turn));
    const room = extractRoom(frames, {
      corners: [],
      openings: [
        { type: 'door', a: at({ x: 0.5, y: 3.02 }, 1), b: at({ x: 1.4, y: 2.97 }, 1) }, // 90 cm, long wall
        { type: 'window', a: at({ x: 4, y: 1.0 }, 1.5), b: at({ x: 4, y: 2.2 }, 1.5) }, // 120 cm, short wall
        { type: 'door', a: at({ x: 2, y: 1.5 }, 1), b: at({ x: 2.5, y: 1.5 }, 1) }, // middle of the room: dropped
      ],
    })!;
    expect(room.openings).toHaveLength(2);
    const wallLen = (i: number) => dist(room.corners[i], room.corners[(i + 1) % room.corners.length]);
    const door = room.openings.find((o) => o.type === 'door')!;
    expect(wallLen(door.wall)).toBeCloseTo(4, 0);
    expect(door.to - door.from).toBeCloseTo(0.9, 1);
    // 50 cm from one end of the wall, whichever end the wall starts at
    expect(Math.min(door.from, wallLen(door.wall) - door.to)).toBeCloseTo(0.5, 1);
    const win = room.openings.find((o) => o.type === 'window')!;
    expect(wallLen(win.wall)).toBeCloseTo(3, 0);
    expect(win.to - win.from).toBeCloseTo(1.2, 1);
  });

  it('finds the wall of a window marked at the back of a deep recess, or through the glass', () => {
    const cams = [
      { x: 1, y: 1 },
      { x: 3, y: 1 },
      { x: 1, y: 2 },
      { x: 3, y: 2 },
    ];
    const frames = scan(rect, 2.5, cams);
    const cam: [number, number, number] = [2, 1.4, 1.2];
    const room = extractRoom(frames, {
      corners: [],
      openings: [
        // 45 cm behind the 4 m wall at y = 3, a 100 cm window
        { type: 'window', a: [1.5, 1.5, 3.45], b: [2.5, 1.5, 3.45], camA: cam, camB: cam },
        // depth through the glass of a window in the 3 m wall at x = 0, seen 3 m outside
        { type: 'window', a: [-3, 1.5, 0.2], b: [-3, 1.5, 2.6], camA: cam, camB: cam },
      ],
    })!;
    expect(room.openings).toHaveLength(2);
    const wallLen = (i: number) => dist(room.corners[i], room.corners[(i + 1) % room.corners.length]);
    const recess = room.openings.find((o) => wallLen(o.wall) > 3.5)!;
    expect(recess.to - recess.from).toBeCloseTo(1.0, 1);
    const glass = room.openings.find((o) => wallLen(o.wall) < 3.5)!;
    expect(glass).toBeDefined();
    // the line of sight from (2, 1.2) to (-3, 0.2) and (-3, 2.6) meets x = 0 at y = 0.8 and y = 1.76
    expect(glass.to - glass.from).toBeCloseTo(0.96, 1);
  });

  it('gives up on too little data', () => {
    expect(extractRoom([])).toBeNull();
    expect(extractRoom([{ cam: [0, 1, 0], points: new Float32Array(30) }])).toBeNull();
  });
});

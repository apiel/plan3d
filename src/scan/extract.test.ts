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

/** What a phone turning on the spot at each position would see in a room. */
function scan(poly: Vec[], ceiling: number, cams: Vec[], noise = 0.02, camY = 1.4): Keyframe[] {
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

  it('gives up on too little data', () => {
    expect(extractRoom([])).toBeNull();
    expect(extractRoom([{ cam: [0, 1, 0], points: new Float32Array(30) }])).toBeNull();
  });
});

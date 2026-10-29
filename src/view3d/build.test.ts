import { describe, expect, it } from 'vitest';
import { Plan, newId, roomFromCorners } from '../model';
import { DEFAULT_HEIGHT, Solid, buildSolids } from './build';

const room = (): Plan => roomFromCorners([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }]);

/** Plan area of a solid's outline. */
const area = (s: Solid) => Math.abs(s.pts.reduce((sum, p, i) => sum + p.x * s.pts[(i + 1) % s.pts.length].y - s.pts[(i + 1) % s.pts.length].x * p.y, 0)) / 2;

const walls = (solids: Solid[]) => solids.filter((s) => s.kind === 'wall');

describe('3D solids', () => {
  it('gives a room four full-height walls, mitred round the outside, and a floor', () => {
    const solids = buildSolids(room());
    expect(walls(solids)).toHaveLength(4);
    for (const w of walls(solids)) expect([w.z0, w.z1]).toEqual([0, DEFAULT_HEIGHT]);
    // mitred bands: inner perimeter 14 m, outer 14.8 m, 10 cm thick
    expect(walls(solids).reduce((s, w) => s + area(w), 0)).toBeCloseTo(((14 + 14.8) / 2) * 0.1, 6);
    const floor = solids.find((s) => s.kind === 'floor')!;
    expect(area(floor)).toBeCloseTo(12, 6);
  });

  it('builds the walls outwards, away from the room', () => {
    for (const w of walls(buildSolids(room()))) {
      for (const p of w.pts) expect(p.x <= 1e-9 || p.x >= 4 - 1e-9 || p.y <= 1e-9 || p.y >= 3 - 1e-9).toBe(true);
    }
  });

  it('cuts doors and windows out of their wall, at the plan height', () => {
    const plan = room();
    plan.height = 2.6;
    const [p0, p1, p2] = plan.points;
    plan.openings.push({ id: newId(), type: 'door', a: p0.id, b: p1.id, at: 1, width: 0.8 });
    // given the other way round: 1 m from p2 going back to p1
    plan.openings.push({ id: newId(), type: 'window', a: p2.id, b: p1.id, at: 1, width: 1.2 });
    const solids = buildSolids(plan);
    // door wall: left, lintel, right; window wall: beside x2, below, above; two plain walls
    expect(walls(solids)).toHaveLength(3 + 4 + 2);
    const lintel = walls(solids).find((w) => w.z0 > 0 && w.pts.every((p) => p.y <= 0))!;
    expect([lintel.z0, lintel.z1]).toEqual([2.05, 2.6]);
    expect(Math.min(...lintel.pts.map((p) => p.x))).toBeCloseTo(1, 9);
    expect(Math.max(...lintel.pts.map((p) => p.x))).toBeCloseTo(1.8, 9);
    const pane = solids.find((s) => s.kind === 'glass')!;
    expect(Math.min(...pane.pts.map((p) => p.y))).toBeCloseTo(0.8, 9);
    expect(Math.max(...pane.pts.map((p) => p.y))).toBeCloseTo(2, 9);
  });

  it('puts the window pane at its frame and leaves a niche under it open', () => {
    const plan = room();
    const [p0, p1] = plan.points;
    plan.walls[0].thickness = 0.4;
    // wall y = 0, room below it (y > 0): outwards is -y
    plan.openings.push({ id: newId(), type: 'window', a: p0.id, b: p1.id, at: 1, width: 1, frameAt: 0.2, niche: true });
    const solids = buildSolids(plan);
    const pane = solids.find((s) => s.kind === 'glass')!;
    expect(Math.max(...pane.pts.map((p) => p.y))).toBeCloseTo(-0.23, 9); // frame 20 to 27 cm out, glass in its middle
    const below = walls(solids).find((w) => w.z0 === 0 && w.pts.every((p) => p.y <= 1e-9) && Math.min(...w.pts.map((p) => p.x)) > 0.99)!;
    expect(Math.max(...below.pts.map((p) => p.y))).toBeCloseTo(-0.2, 9);
    expect(Math.min(...below.pts.map((p) => p.y))).toBeCloseTo(-0.4, 9);
  });

  it('climbs stairs one step at a time', () => {
    const plan = room();
    plan.stairs.push({ id: 's', x: 2, y: 1.5, width: 0.9, length: 2.6, angle: 0, steps: 13 });
    const steps = buildSolids(plan).filter((s) => s.kind === 'stair');
    expect(steps).toHaveLength(13);
    expect(steps[12].z1).toBeCloseTo(13 * 0.175, 9);
  });

  it('climbs the winders of a turn last', () => {
    const plan = room();
    plan.stairs.push({ id: 's', x: 2, y: 1.5, width: 0.9, length: 2.6, angle: 0, steps: 13, top: 'left' });
    const steps = buildSolids(plan).filter((s) => s.kind === 'stair');
    expect(steps).toHaveLength(13);
    expect(steps[12].pts).toHaveLength(3); // a winder: a triangle at the inner corner
    expect(Math.max(...steps[12].pts.map((p) => p.x))).toBeGreaterThan(2 + 1.3);
  });
});

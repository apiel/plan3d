import { describe, expect, it } from 'vitest';
import { Plan, addWallTie, dist, roomFromCorners, setAngle, setDistance, toggleRightAngle } from './model';
import { apply, solve, wallKey } from './solver';

// 4 x 3 m room as the capture sees it: every corner a few cm off.
const noisyRoom = (): Plan =>
  roomFromCorners([
    { x: 0.03, y: -0.04 },
    { x: 4.07, y: 0.05 },
    { x: 4.02, y: 3.08 },
    { x: -0.05, y: 2.96 },
  ]);

const len = (plan: Plan, i: number) => {
  const w = plan.walls[i];
  const a = plan.points.find((p) => p.id === w.a)!;
  const b = plan.points.find((p) => p.id === w.b)!;
  return dist(a, b);
};

const angleDeg = (plan: Plan, i: number) => {
  const p = plan.points;
  const a = p[(i + 3) % 4];
  const b = p[i];
  const c = p[(i + 1) % 4];
  const u = { x: a.x - b.x, y: a.y - b.y };
  const w = { x: c.x - b.x, y: c.y - b.y };
  return (Math.acos((u.x * w.x + u.y * w.y) / (Math.hypot(u.x, u.y) * Math.hypot(w.x, w.y))) * 180) / Math.PI;
};

describe('solver', () => {
  it('leaves an unconstrained plan where the capture put it', () => {
    const plan = noisyRoom();
    const before = plan.points.map((p) => ({ x: p.x, y: p.y }));
    apply(plan, solve(plan));
    plan.points.forEach((p, i) => {
      expect(p.x).toBeCloseTo(before[i].x, 4);
      expect(p.y).toBeCloseTo(before[i].y, 4);
    });
  });

  it('honours a single measured wall', () => {
    const plan = noisyRoom();
    setDistance(plan, plan.points[0].id, plan.points[1].id, 4.0);
    apply(plan, solve(plan));
    expect(len(plan, 0)).toBeCloseTo(4.0, 2);
  });

  it('squares a corner', () => {
    const plan = noisyRoom();
    toggleRightAngle(plan, plan.points[1].id);
    apply(plan, solve(plan));
    expect(angleDeg(plan, 1)).toBeCloseTo(90, 0);
  });

  it('recovers the true rectangle from four sides plus right angles', () => {
    const plan = noisyRoom();
    const [p0, p1, p2, p3] = plan.points.map((p) => p.id);
    setDistance(plan, p0, p1, 4.0);
    setDistance(plan, p1, p2, 3.0);
    setDistance(plan, p2, p3, 4.0);
    setDistance(plan, p3, p0, 3.0);
    for (const p of plan.points) toggleRightAngle(plan, p.id);
    const result = solve(plan);
    apply(plan, result);
    expect(result.conflicts).toHaveLength(0);
    [4, 3, 4, 3].forEach((v, i) => expect(len(plan, i)).toBeCloseTo(v, 3));
    // diagonals equal 5 only if the room really is a rectangle
    expect(dist(plan.points[0], plan.points[2])).toBeCloseTo(5, 2);
    expect(dist(plan.points[1], plan.points[3])).toBeCloseTo(5, 2);
  });

  it('pulls unmeasured walls along when one wall is corrected', () => {
    const plan = noisyRoom();
    for (const p of plan.points) toggleRightAngle(plan, p.id);
    const before = len(plan, 2);
    setDistance(plan, plan.points[0].id, plan.points[1].id, 4.2);
    apply(plan, solve(plan));
    // the opposite wall is not measured, but right angles tie it to the first
    expect(Math.abs(len(plan, 2) - 4.2)).toBeLessThan(Math.abs(before - 4.2));
  });

  it('stretches unmeasured walls in proportion to a measured one', () => {
    const plan = noisyRoom();
    const before = len(plan, 1); // about 3.03 m in the capture
    const scale = 4.4 / len(plan, 0);
    setDistance(plan, plan.points[0].id, plan.points[1].id, 4.4);
    apply(plan, solve(plan));
    expect(len(plan, 0)).toBeCloseTo(4.4, 2);
    // the scan was short by the same factor everywhere
    expect(len(plan, 1)).toBeCloseTo(before * scale, 1);
    expect(len(plan, 2)).toBeCloseTo(4.4, 1);
  });

  it('keeps a measured wall when another one is measured, and shares the rest', () => {
    const plan = noisyRoom();
    const [p0, p1, p2] = plan.points.map((p) => p.id);
    setDistance(plan, p0, p1, 4.4);
    apply(plan, solve(plan));
    setDistance(plan, p1, p2, 3.0);
    const result = solve(plan);
    apply(plan, result);
    expect(result.conflicts).toHaveLength(0);
    expect(len(plan, 0)).toBeCloseTo(4.4, 2);
    expect(len(plan, 1)).toBeCloseTo(3.0, 2);
    // the unmeasured opposite walls follow the measured ones
    expect(len(plan, 2)).toBeGreaterThan(4.2);
    expect(len(plan, 3)).toBeLessThan(3.15);
  });

  it('a second solve does not move anything', () => {
    const plan = noisyRoom();
    setDistance(plan, plan.points[0].id, plan.points[1].id, 4.4);
    apply(plan, solve(plan));
    const once = plan.points.map((p) => ({ x: p.x, y: p.y }));
    apply(plan, solve(plan));
    plan.points.forEach((p, i) => {
      expect(p.x).toBeCloseTo(once[i].x, 3);
      expect(p.y).toBeCloseTo(once[i].y, 3);
    });
  });

  it('scales doors and windows with their wall, except a typed width', () => {
    const plan = noisyRoom();
    const [p0, p1] = plan.points.map((p) => p.id);
    const k = 4.4 / len(plan, 0);
    plan.openings.push({ id: 'd', type: 'door', a: p0, b: p1, at: 1, width: 0.8 });
    plan.openings.push({ id: 'w', type: 'window', a: p0, b: p1, at: 2.5, width: 1, measured: true });
    setDistance(plan, p0, p1, 4.4);
    apply(plan, solve(plan));
    const [door, win] = plan.openings;
    expect(door.at).toBeCloseTo(1 * k, 2);
    expect(door.width).toBeCloseTo(0.8 * k, 2);
    expect(win.width).toBe(1);
    expect(win.at + win.width / 2).toBeCloseTo(3 * k, 2); // its centre moved along
  });

  it('reports contradictory measurements', () => {
    const plan = noisyRoom();
    setDistance(plan, plan.points[0].id, plan.points[1].id, 4.0);
    setDistance(plan, plan.points[1].id, plan.points[2].id, 3.0);
    setDistance(plan, plan.points[0].id, plan.points[2].id, 9.0); // impossible
    const result = solve(plan);
    expect(result.conflicts.length).toBeGreaterThan(0);
  });

  it('holds a corner at a typed angle', () => {
    const plan = noisyRoom();
    setAngle(plan, plan.points[1].id, 100);
    apply(plan, solve(plan));
    expect(angleDeg(plan, 1)).toBeCloseTo(100, 0);
  });

  it('makes two walls parallel', () => {
    const plan = noisyRoom();
    const [p0, p1, p2, p3] = plan.points.map((p) => p.id);
    addWallTie(plan, 'parallel', p0, p1, p2, p3);
    apply(plan, solve(plan));
    const [a, b, c, d] = plan.points;
    const cross = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
    expect(Math.abs(cross) / (dist(a, b) * dist(c, d))).toBeLessThan(0.01); // under half a degree, like a right angle
  });

  it('gives two walls the same length, and a measurement on one sets the other', () => {
    const plan = noisyRoom();
    const [p0, p1, p2, p3] = plan.points.map((p) => p.id);
    addWallTie(plan, 'equal', p0, p1, p2, p3);
    setDistance(plan, p0, p1, 4.3);
    apply(plan, solve(plan));
    expect(len(plan, 0)).toBeCloseTo(4.3, 2);
    expect(len(plan, 2)).toBeCloseTo(4.3, 2);
  });

  it('knows how uncertain each wall still is', () => {
    const plan = noisyRoom();
    const [p0, p1, p2] = plan.points.map((p) => p.id);
    const before = solve(plan).wallSigma;
    // nothing measured: the room's scale is unknown, every wall is very uncertain
    expect(before.get(wallKey(p0, p1))!).toBeGreaterThan(0.5);
    setDistance(plan, p0, p1, 4.0);
    const after = solve(plan).wallSigma;
    // the measured wall is known to the tape's accuracy, the others to the capture's
    expect(after.get(wallKey(p0, p1))!).toBeLessThan(0.005);
    expect(after.get(wallKey(p1, p2))!).toBeGreaterThan(0.02);
    expect(after.get(wallKey(p1, p2))!).toBeLessThan(0.2);
    // measuring the second wall pins it too
    setDistance(plan, p1, p2, 3.0);
    expect(solve(plan).wallSigma.get(wallKey(p1, p2))!).toBeLessThan(0.005);
  });
});

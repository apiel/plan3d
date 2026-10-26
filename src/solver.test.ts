import { describe, expect, it } from 'vitest';
import { Plan, dist, roomFromCorners, setDistance, toggleRightAngle } from './model';
import { apply, solve } from './solver';

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

  it('reports contradictory measurements', () => {
    const plan = noisyRoom();
    setDistance(plan, plan.points[0].id, plan.points[1].id, 4.0);
    setDistance(plan, plan.points[1].id, plan.points[2].id, 3.0);
    setDistance(plan, plan.points[0].id, plan.points[2].id, 9.0); // impossible
    const result = solve(plan);
    expect(result.conflicts.length).toBeGreaterThan(0);
  });
});

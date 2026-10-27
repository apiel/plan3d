import { describe, expect, it } from 'vitest';
import { Plan, Vec, newId, roomFromCorners, setDistance } from './model';
import { apply, solve } from './solver';
import { applyJoins, deleteRoom, joinDoors, openingFrame, roomArea, roomIdsOf, roomComponents } from './rooms';

const square = (plan: Plan, x: number, y: number, w: number, h: number): string[] => {
  const room = roomFromCorners([
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ]);
  plan.points.push(...room.points);
  plan.walls.push(...room.walls);
  return room.points.map((p) => p.id);
};

/** A door on the wall from corner `i` to corner `i + 1`, `at` metres along. */
const door = (plan: Plan, ids: string[], i: number, at: number, width = 0.9): string => {
  const id = newId();
  plan.openings.push({ id, type: 'door', a: ids[i], b: ids[(i + 1) % ids.length], at, width });
  return id;
};

const centre = (plan: Plan, id: string): Vec => {
  const f = openingFrame(plan, plan.openings.find((o) => o.id === id)!)!;
  return { x: (f.p1.x + f.p2.x) / 2, y: (f.p1.y + f.p2.y) / 2 };
};

const roomCentre = (plan: Plan, ids: string[]): Vec => {
  const ps = ids.map((id) => plan.points.find((p) => p.id === id)!);
  return { x: ps.reduce((s, p) => s + p.x, 0) / ps.length, y: ps.reduce((s, p) => s + p.y, 0) / ps.length };
};

describe('joining rooms through a door', () => {
  it('puts the second room on the far side of the first one door', () => {
    const plan = roomFromCorners([]);
    const a = square(plan, 0, 0, 4, 3);
    const b = square(plan, 20, 10, 3, 3);
    const da = door(plan, a, 1, 1); // right wall of A
    const db = door(plan, b, 3, 1); // left wall of B, drawn on the other side of the map
    expect(joinDoors(plan, da, db)).toBeNull();
    const ca = centre(plan, da);
    const cb = centre(plan, db);
    expect(cb.x).toBeCloseTo(ca.x, 6);
    expect(cb.y).toBeCloseTo(ca.y, 6);
    // B lies to the right of A's right wall, A did not move
    expect(roomCentre(plan, b).x).toBeGreaterThan(4);
    expect(plan.points.find((p) => p.id === a[0])).toMatchObject({ x: 0, y: 0 });
    // each door still opens into its own room
    expect(openingFrame(plan, plan.openings[0])!.n.x).toBeLessThan(0);
    expect(openingFrame(plan, plan.openings[1])!.n.x).toBeGreaterThan(0);
  });

  it('turns a room that was scanned at another angle', () => {
    const plan = roomFromCorners([]);
    const a = square(plan, 0, 0, 4, 3);
    const b = square(plan, 10, 10, 3, 3);
    const da = door(plan, a, 1, 1);
    const db = door(plan, b, 0, 1); // top wall of B: B must be turned a quarter turn
    expect(joinDoors(plan, da, db)).toBeNull();
    expect(centre(plan, db).x).toBeCloseTo(centre(plan, da).x, 6);
    expect(centre(plan, db).y).toBeCloseTo(centre(plan, da).y, 6);
    expect(roomCentre(plan, b).x).toBeGreaterThan(4);
    const [p0, p1] = [b[0], b[1]].map((id) => plan.points.find((p) => p.id === id)!);
    expect(Math.abs(p0.x - p1.x)).toBeLessThan(1e-6); // the top wall is now vertical
  });

  it('keeps the doors together when a measurement rescales a room', () => {
    const plan = roomFromCorners([]);
    const a = square(plan, 0, 0, 4, 3);
    const b = square(plan, 10, 0, 3, 3);
    const da = door(plan, a, 1, 1);
    const db = door(plan, b, 3, 1);
    joinDoors(plan, da, db);
    setDistance(plan, b[0], b[1], 4); // B's top wall is really 4 m, not 3
    apply(plan, solve(plan));
    applyJoins(plan);
    expect(centre(plan, db).x).toBeCloseTo(centre(plan, da).x, 6);
    expect(centre(plan, db).y).toBeCloseTo(centre(plan, da).y, 6);
  });

  it('chains a third room and refuses loops, doors in one room and joined doors', () => {
    const plan = roomFromCorners([]);
    const a = square(plan, 0, 0, 4, 3);
    const b = square(plan, 20, 0, 3, 3);
    const c = square(plan, 40, 0, 3, 3);
    const a1 = door(plan, a, 1, 1);
    const b3 = door(plan, b, 3, 1);
    const b1 = door(plan, b, 1, 1);
    const c3 = door(plan, c, 3, 1);
    const a2 = door(plan, a, 2, 1);
    expect(joinDoors(plan, a1, b3)).toBeNull();
    expect(joinDoors(plan, b1, c3)).toBeNull();
    expect(centre(plan, c3).x).toBeCloseTo(centre(plan, b1).x, 6);
    expect(roomCentre(plan, c).x).toBeGreaterThan(roomCentre(plan, b).x);
    expect(joinDoors(plan, a2, c3)).toMatch(/already/); // c3 is taken
    expect(joinDoors(plan, a1, a2)).toMatch(/same room/);
    const c1 = door(plan, c, 1, 1);
    expect(joinDoors(plan, a2, c1)).toMatch(/already joined/); // would close a loop
  });
});

describe('rooms', () => {
  it('finds rooms and their area', () => {
    const plan = roomFromCorners([]);
    const a = square(plan, 0, 0, 4, 3);
    square(plan, 10, 0, 2, 2);
    expect(roomComponents(plan).length).toBe(2);
    expect(roomArea(plan, roomIdsOf(plan, a[0]))).toBeCloseTo(12);
  });

  it('deleting a room removes its walls, doors and joins, and leaves the others', () => {
    const plan = roomFromCorners([]);
    const a = square(plan, 0, 0, 4, 3);
    const b = square(plan, 20, 0, 3, 3);
    const da = door(plan, a, 1, 1);
    const db = door(plan, b, 3, 1);
    joinDoors(plan, da, db);
    deleteRoom(plan, b[0]);
    expect(plan.points.length).toBe(4);
    expect(plan.walls.length).toBe(4);
    expect(plan.openings.map((o) => o.id)).toEqual([da]);
    expect(plan.joins).toEqual([]);
  });
});

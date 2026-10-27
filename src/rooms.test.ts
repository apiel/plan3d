import { describe, expect, it } from 'vitest';
import { DEFAULT_THICKNESS, Plan, Vec, newId, roomFromCorners, setDistance } from './model';
import { apply, solve } from './solver';
import { applyJoins, deleteRoom, insideRoom, joinDoors, openingFrame, roomArea, roomComponents, roomIdsOf, roomOutline, setWallThickness } from './rooms';

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

/** Where door `b` should be: on `a`, one wall thickness out of a's room. */
const expectJoined = (plan: Plan, a: string, b: string, t = DEFAULT_THICKNESS): void => {
  const n = openingFrame(plan, plan.openings.find((o) => o.id === a)!)!.n;
  const ca = centre(plan, a);
  const cb = centre(plan, b);
  expect(cb.x).toBeCloseTo(ca.x - n.x * t, 6);
  expect(cb.y).toBeCloseTo(ca.y - n.y * t, 6);
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
    expectJoined(plan, da, db);
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
    expectJoined(plan, da, db);
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
    expectJoined(plan, da, db);
  });

  it('leaves a gap of the wall thickness, shared by both sides of the wall', () => {
    const plan = roomFromCorners([]);
    const a = square(plan, 0, 0, 4, 3);
    const b = square(plan, 20, 0, 3, 3);
    const da = door(plan, a, 1, 1);
    const db = door(plan, b, 3, 1);
    plan.walls[1].thickness = 0.3; // A's right wall
    joinDoors(plan, da, db);
    expectJoined(plan, da, db, 0.3);
    expect(plan.walls[7].thickness).toBe(0.3); // B's left wall took it
    setWallThickness(plan, b[3], b[0], 0.2); // changing B's side changes A's too
    expect(plan.walls[1].thickness).toBe(0.2);
    applyJoins(plan);
    expectJoined(plan, da, db, 0.2);
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
    expectJoined(plan, b1, c3);
    expect(roomCentre(plan, c).x).toBeGreaterThan(roomCentre(plan, b).x);
    expect(joinDoors(plan, a2, c3)).toMatch(/already/); // c3 is taken
    expect(joinDoors(plan, a1, a2)).toMatch(/same room/);
    const c1 = door(plan, c, 1, 1);
    expect(joinDoors(plan, a2, c1)).toMatch(/already joined/); // would close a loop
  });
});

describe('wall outline', () => {
  it('pushes every wall out by its thickness, mitred at the corners', () => {
    const plan = roomFromCorners([]);
    const a = square(plan, 0, 0, 4, 3);
    plan.walls[0].thickness = 0.3; // top wall
    const o = roomOutline(plan, roomIdsOf(plan, a[0]))!;
    const xs = o.outer.map((p) => p.x);
    const ys = o.outer.map((p) => p.y);
    expect(Math.min(...ys)).toBeCloseTo(-0.3);
    expect(Math.max(...ys)).toBeCloseTo(3.1);
    expect(Math.min(...xs)).toBeCloseTo(-0.1);
    expect(Math.max(...xs)).toBeCloseTo(4.1);
    // outwards is really out of the room, whichever way the corners were listed
    const reversed = roomFromCorners([]);
    const r = square(reversed, 0, 0, 4, 3).reverse();
    const ids = roomIdsOf(reversed, r[0]);
    for (const p of roomOutline(reversed, ids)!.outer) expect(insideRoom(reversed, ids, p)).toBe(false);
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

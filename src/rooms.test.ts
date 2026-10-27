import { describe, expect, it } from 'vitest';
import { DEFAULT_THICKNESS, Plan, Vec, addPoint, newId, roomFromCorners, setDistance } from './model';
import { apply, solve } from './solver';
import { applyJoins, deleteRoom, duplicateRoom, insideRoom, joinWallEnds, loopArea, moveRoom, roomAt, roomName, rooms, setRoomName, joinDoors, openingFrame, roomArea, roomComponents, roomIdsOf, roomOutline, setWallThickness } from './rooms';

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
    deleteRoom(plan, rooms(plan).find((loop) => loop.includes(b[0]))!);
    expect(plan.points.length).toBe(4);
    expect(plan.walls.length).toBe(4);
    expect(plan.openings.map((o) => o.id)).toEqual([da]);
    expect(plan.joins).toEqual([]);
  });
});

describe('duplicating a room', () => {
  it('copies corners, walls, measurements and doors beside the original', () => {
    const plan = roomFromCorners([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }]);
    const [p0, p1, p2] = plan.points;
    setDistance(plan, p0.id, p1.id, 4);
    plan.constraints.push({ type: 'rightAngle', a: p0.id, b: p1.id, c: p2.id });
    plan.openings.push({ id: newId(), type: 'door', a: p0.id, b: p1.id, at: 1, width: 0.8, color: '#f87171' });
    const copy = duplicateRoom(plan, rooms(plan)[0]);
    expect(roomComponents(plan)).toHaveLength(2);
    const ids = roomIdsOf(plan, copy[0]);
    expect(ids.has(p0.id)).toBe(false);
    expect(plan.points.filter((p) => ids.has(p.id)).map((p) => p.x)).toEqual([4.5, 8.5, 8.5, 4.5]);
    expect(plan.walls).toHaveLength(8);
    expect(plan.constraints.filter((c) => ids.has(c.a))).toHaveLength(2);
    const door = plan.openings.find((o) => ids.has(o.a))!;
    expect(door).toMatchObject({ type: 'door', at: 1, width: 0.8, color: '#f87171' });
    expect(ids.has(door.b)).toBe(true);
  });
});

describe('a wall across a room', () => {
  const split = () => {
    const plan = roomFromCorners([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 3 }, { x: 0, y: 3 }]);
    const [p0, , , p3] = plan.points;
    setDistance(plan, p3.id, p0.id, 3);
    plan.openings.push({ id: newId(), type: 'door', a: p3.id, b: p0.id, at: 2.2, width: 0.6 });
    const l = addPoint(plan, { x: 0.01, y: 1.5 });
    const r = addPoint(plan, { x: 2, y: 1.5 });
    plan.walls.push({ a: l.id, b: r.id });
    joinWallEnds(plan);
    return { plan, p0, p3, l, r };
  };

  it('is joined to the walls it ends on, which makes two rooms', () => {
    const { plan, l } = split();
    expect(l.x).toBeCloseTo(0);
    expect(plan.walls).toHaveLength(7);
    expect(roomComponents(plan)).toHaveLength(1);
    expect(rooms(plan).map((loop) => loopArea(plan, loop)).sort()).toEqual([3, 3]);
    expect(roomAt(plan, { x: 1, y: 0.5 })).not.toEqual(roomAt(plan, { x: 1, y: 2.5 }));
  });

  it('keeps doors where they were, and the measurement over the whole wall', () => {
    const { plan, p0, p3, l } = split();
    // the door was 2.2 m from the bottom corner going up: 0.7 m from the new corner, on the top half
    const d = plan.openings[0];
    expect([d.a, d.b].sort()).toEqual([l.id, p0.id].sort());
    expect(openingFrame(plan, d)!.p1.y).toBeCloseTo(0.8);
    expect(plan.constraints).toContainEqual({ type: 'distance', a: p3.id, b: p0.id, value: 3 });
    const s = solve(plan);
    apply(plan, s);
    expect(l.x).toBeCloseTo(0, 3); // held in line
  });

  it('gives each room its own name, and they move with the rooms', () => {
    const { plan } = split();
    setRoomName(plan, roomAt(plan, { x: 1, y: 0.5 })!, 'Bathroom');
    setRoomName(plan, roomAt(plan, { x: 1, y: 2.5 })!, 'Toilet');
    expect(roomName(plan, roomAt(plan, { x: 1, y: 0.5 })!)).toBe('Bathroom');
    moveRoom(plan, plan.points[0].id, { x: 5, y: 0 });
    expect(roomName(plan, roomAt(plan, { x: 6, y: 2.5 })!)).toBe('Toilet');
  });

  it('deleting one of the rooms keeps the wall it shares with the other', () => {
    const { plan } = split();
    deleteRoom(plan, roomAt(plan, { x: 1, y: 0.5 })!);
    expect(rooms(plan)).toHaveLength(1);
    expect(loopArea(plan, rooms(plan)[0])).toBeCloseTo(3);
  });
});

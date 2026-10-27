// Rooms: the areas closed in by walls. Corners joined by walls form a group
// (moved and scaled together); a group holds one room or several, split by
// walls inside it. Also the doors that tie groups together.

import { Constraint, Opening, Plan, Vec, Wall, constraintIds, newId, pointById, removePoint, sameWall, wallThickness, wallUnderCorner } from './model';

const mid = (a: Vec, b: Vec): Vec => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * Every area the walls go round, as its corners in order, with its signed
 * area: positive for a room, negative for the outside of a group of rooms.
 * A wall sticking into a room appears twice in it, once each way.
 */
function faces(plan: Plan): { loop: string[]; area: number }[] {
  const at = new Map(plan.points.map((p) => [p.id, p]));
  const around = new Map<string, string[]>();
  for (const w of plan.walls) {
    if (!at.has(w.a) || !at.has(w.b) || w.a === w.b) continue;
    around.set(w.a, [...(around.get(w.a) ?? []), w.b]);
    around.set(w.b, [...(around.get(w.b) ?? []), w.a]);
  }
  // neighbours of each corner, by direction
  for (const [id, ns] of around) {
    const p = at.get(id)!;
    ns.sort((m, n) => Math.atan2(at.get(m)!.y - p.y, at.get(m)!.x - p.x) - Math.atan2(at.get(n)!.y - p.y, at.get(n)!.x - p.x));
  }
  const seen = new Set<string>();
  const out: { loop: string[]; area: number }[] = [];
  for (const [start, ns] of around) {
    for (const first of ns) {
      if (seen.has(`${start}>${first}`)) continue;
      // walk keeping the area on the left: at each corner, take the next wall clockwise from the one we came along
      const loop: string[] = [];
      let [u, v] = [start, first];
      while (!seen.has(`${u}>${v}`) && loop.length <= plan.walls.length * 2) {
        seen.add(`${u}>${v}`);
        loop.push(u);
        const nv = around.get(v)!;
        const w = nv[(nv.indexOf(u) - 1 + nv.length) % nv.length];
        [u, v] = [v, w];
      }
      let area = 0;
      loop.forEach((id, i) => {
        const p = at.get(id)!;
        const q = at.get(loop[(i + 1) % loop.length])!;
        area += p.x * q.y - q.x * p.y;
      });
      out.push({ loop, area: area / 2 });
    }
  }
  return out;
}

/** The rooms: each area closed in by walls, as its corners in order around it. */
export function rooms(plan: Plan): string[][] {
  return faces(plan)
    .filter((f) => f.area > 1e-6)
    .map((f) => f.loop);
}

/** Whether `p` is inside the area a loop of corners goes round. */
export function insideLoop(plan: Plan, loop: string[], p: Vec): boolean {
  let inside = false;
  loop.forEach((id, i) => {
    const a = pointById(plan, id)!;
    const b = pointById(plan, loop[(i + 1) % loop.length])!;
    if (a.y > p.y !== b.y > p.y && p.x < a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y)) inside = !inside;
  });
  return inside;
}

/** The walls of a room, each once (a wall sticking into it comes up twice in its loop). */
export function loopWalls(plan: Plan, loop: string[]): Wall[] {
  const walls = new Set<Wall>();
  loop.forEach((id, i) => {
    const w = plan.walls.find((x) => sameWall(x, id, loop[(i + 1) % loop.length]));
    if (w) walls.add(w);
  });
  return [...walls];
}

/** The smallest room around a spot. */
export function roomAt(plan: Plan, p: Vec): string[] | undefined {
  return rooms(plan)
    .filter((loop) => insideLoop(plan, loop, p))
    .sort((a, b) => loopArea(plan, a) - loopArea(plan, b))[0];
}

/** Groups of point ids joined by walls. A corner with no wall yet is a group of its own. */
export function roomComponents(plan: Plan): string[][] {
  const adj = new Map<string, string[]>(plan.points.map((p) => [p.id, []]));
  for (const w of plan.walls) {
    adj.get(w.a)?.push(w.b);
    adj.get(w.b)?.push(w.a);
  }
  const seen = new Set<string>();
  const rooms: string[][] = [];
  for (const p of plan.points) {
    if (seen.has(p.id)) continue;
    const room: string[] = [];
    const stack = [p.id];
    seen.add(p.id);
    while (stack.length) {
      const id = stack.pop()!;
      room.push(id);
      for (const n of adj.get(id) ?? []) {
        if (adj.has(n) && !seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    rooms.push(room);
  }
  return rooms;
}

/** The corners of the room this point belongs to. */
export function roomIdsOf(plan: Plan, id: string): Set<string> {
  return new Set(roomComponents(plan).find((r) => r.includes(id)) ?? [id]);
}

/** Whether `p` is inside one of the rooms of a group of corners (not a neighbouring group's). */
export function insideRoom(plan: Plan, ids: Set<string>, p: Vec): boolean {
  const own = rooms(plan).filter((loop) => ids.has(loop[0]));
  if (own.length) return own.some((loop) => insideLoop(plan, loop, p));
  // walls that close nothing yet: even-odd against them
  let inside = false;
  for (const w of plan.walls) {
    if (!ids.has(w.a) || !ids.has(w.b)) continue;
    const a = pointById(plan, w.a);
    const b = pointById(plan, w.b);
    if (!a || !b) continue;
    if (a.y > p.y !== b.y > p.y && p.x < a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y)) inside = !inside;
  }
  return inside;
}

/** The corners in order around the room, when it is one simple closed loop. */
export function roomLoop(plan: Plan, ids: Set<string>): string[] | null {
  const next = new Map<string, string[]>();
  for (const w of plan.walls) {
    if (!ids.has(w.a) || !ids.has(w.b)) continue;
    next.set(w.a, [...(next.get(w.a) ?? []), w.b]);
    next.set(w.b, [...(next.get(w.b) ?? []), w.a]);
  }
  if (ids.size < 3 || [...ids].some((id) => next.get(id)?.length !== 2)) return null;
  const start = [...ids][0];
  const loop = [start];
  let prev = start;
  let cur = next.get(start)![0];
  while (cur !== start) {
    loop.push(cur);
    const [x, y] = next.get(cur)!;
    [prev, cur] = [cur, x === prev ? y : x];
    if (loop.length > ids.size) return null;
  }
  return loop.length === ids.size ? loop : null;
}

/** The corners in order round the outside of a group, also when walls inside it split it into rooms, if that is a simple loop. */
export function groupLoop(plan: Plan, ids: Set<string>): string[] | null {
  return (
    roomLoop(plan, ids) ??
    faces(plan)
      .filter((f) => f.area < -1e-6 && ids.has(f.loop[0]))
      .map((f) => f.loop)
      .find((l) => new Set(l).size === l.length) ??
    null
  );
}

/**
 * The room's walls as a band: `inner` is the line of corners, `outer` the same
 * corners pushed out by each wall's thickness (mitred), when it is a simple loop.
 */
export function roomOutline(plan: Plan, ids: Set<string>): { inner: Vec[]; outer: Vec[] } | null {
  const loop = groupLoop(plan, ids);
  if (!loop) return null;
  const pts = loop.map((id) => pointById(plan, id)!);
  const n = pts.length;
  let area = 0;
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % n];
    area += p.x * q.y - q.x * p.y;
  });
  const dirs = pts.map((p, i) => {
    const q = pts[(i + 1) % n];
    const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    return { x: (q.x - p.x) / len, y: (q.y - p.y) / len };
  });
  // the room is on the left of the walking direction when the area is positive, so out is the right
  const out = dirs.map((d) => (area > 0 ? { x: d.y, y: -d.x } : { x: -d.y, y: d.x }));
  const t = loop.map((id, i) => wallThickness(plan, id, loop[(i + 1) % n]));
  const outer = pts.map((p, i) => {
    const h = (i + n - 1) % n;
    const b1 = { x: pts[h].x + out[h].x * t[h], y: pts[h].y + out[h].y * t[h] };
    const b2 = { x: p.x + out[i].x * t[i], y: p.y + out[i].y * t[i] };
    const cross = dirs[h].x * dirs[i].y - dirs[h].y * dirs[i].x;
    if (Math.abs(cross) < 1e-6) return b2;
    const s = ((b2.x - b1.x) * dirs[i].y - (b2.y - b1.y) * dirs[i].x) / cross;
    const m = { x: b1.x + dirs[h].x * s, y: b1.y + dirs[h].y * s };
    return Math.hypot(m.x - p.x, m.y - p.y) > 4 * Math.max(t[h], t[i]) + 1e-9 ? b2 : m;
  });
  return { inner: pts.map((p) => ({ x: p.x, y: p.y })), outer };
}

/** Floor area of a room in m². */
export function loopArea(plan: Plan, loop: string[]): number {
  const pts = loop.map((id) => pointById(plan, id)!);
  let sum = 0;
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length];
    sum += p.x * q.y - q.x * p.y;
  });
  return Math.abs(sum) / 2;
}

/** Floor area in m², when the group is a simple loop. */
export function roomArea(plan: Plan, ids: Set<string>): number | null {
  const loop = roomLoop(plan, ids);
  return loop ? loopArea(plan, loop) : null;
}

/**
 * Splits wall a-b at corner `p` standing on it, so walls meeting there are
 * joined: the halves keep its thickness, colour, doors and windows, and are
 * held in line. Measurements and angles over the whole wall still hold.
 */
export function splitWall(plan: Plan, wall: Wall, p: string): void {
  const a = pointById(plan, wall.a)!;
  const b = pointById(plan, wall.b)!;
  const at = pointById(plan, p)!;
  const len1 = Math.hypot(at.x - a.x, at.y - a.y);
  const len2 = Math.hypot(b.x - at.x, b.y - at.y);
  plan.walls = plan.walls.filter((w) => w !== wall);
  plan.walls.push({ ...wall, b: p }, { ...wall, a: p });
  for (const o of plan.openings) {
    if (!sameWall(wall, o.a, o.b)) continue;
    // counted from the wall's own a end; a door counted from the other end keeps its hinge where it was
    if (o.a !== wall.a) {
      o.at = len1 + len2 - o.at - o.width;
      if (o.type === 'door') o.hingeAtB = !o.hingeAtB || undefined;
    }
    if (o.at + o.width / 2 <= len1) Object.assign(o, { a: wall.a, b: p, at: Math.max(0, Math.min(o.at, len1 - o.width)) });
    else Object.assign(o, { a: p, b: wall.b, at: Math.max(0, Math.min(o.at - len1, len2 - o.width)) });
  }
  plan.constraints.push({ type: 'parallel', a: wall.a, b: p, c: p, d: wall.b });
}

/** Joins each loose wall end standing on another wall to it, splitting that wall there. */
export function joinWallEnds(plan: Plan): void {
  for (const p of plan.points) {
    if (plan.walls.filter((w) => w.a === p.id || w.b === p.id).length !== 1) continue;
    const host = wallUnderCorner(plan, p.id);
    if (!host) continue;
    // exactly onto the wall, then joined
    const a = pointById(plan, host.a)!;
    const b = pointById(plan, host.b)!;
    const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    const t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len2;
    p.x = a.x + t * (b.x - a.x);
    p.y = a.y + t * (b.y - a.y);
    p.sensor = { x: p.x, y: p.y };
    splitWall(plan, host, p.id);
  }
}

/** A room's name: the name put down inside it. */
export const roomName = (plan: Plan, loop: string[]): string | undefined => plan.names.find((n) => insideLoop(plan, loop, n))?.name;

/** Names a room (an empty name removes it); the name goes in the middle of the room. */
export function setRoomName(plan: Plan, loop: string[], name: string): void {
  plan.names = plan.names.filter((n) => !insideLoop(plan, loop, n));
  if (name) plan.names.push({ ...spotInside(plan, loop), name });
}

/** A spot well inside a room: its centre, or for a room bent round (an L), the spot furthest from its walls. */
export function spotInside(plan: Plan, loop: string[]): Vec {
  const pts = loop.map((id) => pointById(plan, id)!);
  const centre = { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
  if (insideLoop(plan, loop, centre)) return centre;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  let best = centre;
  let bestD = -1;
  for (let i = 1; i < 24; i++) {
    for (let j = 1; j < 24; j++) {
      const s = { x: Math.min(...xs) + ((Math.max(...xs) - Math.min(...xs)) * i) / 24, y: Math.min(...ys) + ((Math.max(...ys) - Math.min(...ys)) * j) / 24 };
      if (!insideLoop(plan, loop, s)) continue;
      const d = Math.min(...pts.map((p, k) => segmentDist(s, p, pts[(k + 1) % pts.length])));
      if (d > bestD) [best, bestD] = [s, d];
    }
  }
  return best;
}

function segmentDist(p: Vec, a: Vec, b: Vec): number {
  const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len2));
  return Math.hypot(p.x - a.x - t * (b.x - a.x), p.y - a.y - t * (b.y - a.y));
}

/** Where a door or window sits: its two ends, the wall direction and the normal pointing into its own room. */
export function openingFrame(plan: Plan, o: Opening): { p1: Vec; p2: Vec; u: Vec; n: Vec } | undefined {
  const a = pointById(plan, o.a);
  const b = pointById(plan, o.b);
  if (!a || !b) return undefined;
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const p1 = { x: a.x + u.x * o.at, y: a.y + u.y * o.at };
  const p2 = { x: p1.x + u.x * o.width, y: p1.y + u.y * o.width };
  let n = { x: -u.y, y: u.x };
  const m = mid(p1, p2);
  if (!insideRoom(plan, roomIdsOf(plan, o.a), { x: m.x + n.x * 0.05, y: m.y + n.y * 0.05 })) n = { x: -n.x, y: -n.y };
  return { p1, p2, u, n };
}

/** Sets a wall's thickness; a wall holding a joined door gives the same thickness to the wall on the other side. */
export function setWallThickness(plan: Plan, a: string, b: string, thickness: number): void {
  const wall = plan.walls.find((w) => sameWall(w, a, b));
  if (!wall) return;
  wall.thickness = thickness;
  for (const o of plan.openings) {
    if (!sameWall(wall, o.a, o.b)) continue;
    const j = joinOf(plan, o.id);
    const other = j && plan.openings.find((x) => x.id === (j.a === o.id ? j.b : j.a));
    const w = other && plan.walls.find((x) => sameWall(x, other.a, other.b));
    if (w) w.thickness = thickness;
  }
}

/** Moves a group of rooms (its corners, where the capture put them, and room names) by `d` metres. */
export function moveRoom(plan: Plan, id: string, d: Vec): void {
  const ids = roomIdsOf(plan, id);
  const own = rooms(plan).filter((loop) => ids.has(loop[0]));
  for (const n of plan.names) {
    if (!own.some((loop) => insideLoop(plan, loop, n))) continue;
    n.x += d.x;
    n.y += d.y;
  }
  for (const p of plan.points) {
    if (!ids.has(p.id)) continue;
    p.x += d.x;
    p.y += d.y;
    p.sensor = { x: p.sensor.x + d.x, y: p.sensor.y + d.y };
  }
}

/**
 * Copies a room with its walls, measurements, angles, doors, windows and
 * name, beside the original (to the right, with a gap). Joins to other rooms
 * are not copied. Returns the copy's loop of corners.
 */
export function duplicateRoom(plan: Plan, loop: string[]): string[] {
  const ids = new Set(loop);
  const pts = plan.points.filter((p) => ids.has(p.id));
  const shift = Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x)) + 0.5;
  const map = new Map(pts.map((p) => [p.id, newId()]));
  const to = (x: string) => map.get(x)!;
  const walls = loopWalls(plan, loop);
  for (const n of plan.names.filter((n) => insideLoop(plan, loop, n))) plan.names.push({ ...n, x: n.x + shift });
  for (const p of pts) plan.points.push({ ...p, id: to(p.id), x: p.x + shift, sensor: { x: p.sensor.x + shift, y: p.sensor.y } });
  for (const w of walls) plan.walls.push({ ...w, a: to(w.a), b: to(w.b) });
  for (const c of plan.constraints.filter((c) => constraintIds(c).every((x) => ids.has(x)))) {
    const copy = { ...c } as Constraint & Record<string, unknown>;
    for (const k of ['a', 'b', 'c', 'd'] as const) if (k in c) copy[k] = to((c as Record<string, unknown>)[k] as string);
    plan.constraints.push(copy);
  }
  for (const o of plan.openings.filter((o) => walls.some((w) => sameWall(w, o.a, o.b)))) plan.openings.push({ ...o, id: newId(), a: to(o.a), b: to(o.b) });
  return loop.map(to);
}

/**
 * Removes a room: its walls with their doors, windows and measurements, but
 * not walls it shares with a neighbouring room; then corners left with no wall.
 */
export function deleteRoom(plan: Plan, loop: string[]): void {
  const shared = new Set(rooms(plan).filter((l) => l.join() !== loop.join()).flatMap((l) => loopWalls(plan, l)));
  const gone = loopWalls(plan, loop).filter((w) => !shared.has(w));
  plan.names = plan.names.filter((n) => !insideLoop(plan, loop, n));
  plan.walls = plan.walls.filter((w) => !gone.includes(w));
  plan.openings = plan.openings.filter((o) => !gone.some((w) => sameWall(w, o.a, o.b)));
  plan.constraints = plan.constraints.filter((c) => !(c.type === 'distance' && gone.some((w) => sameWall(w, c.a, c.b))));
  for (const id of loop) if (!plan.walls.some((w) => w.a === id || w.b === id)) removePoint(plan, id);
  pruneJoins(plan);
}

/** Drops joins whose doors are gone. */
export function pruneJoins(plan: Plan): void {
  const doors = new Set(plan.openings.filter((o) => o.type === 'door').map((o) => o.id));
  plan.joins = plan.joins.filter((j) => doors.has(j.a) && doors.has(j.b));
}

/** The doors a door is joined to are the same door seen from the other room. */
export const joinOf = (plan: Plan, openingId: string) => plan.joins.find((j) => j.a === openingId || j.b === openingId);

/** Corners of every room reachable from this point through joins, itself included. */
function joinedGroup(plan: Plan, start: string): Set<string> {
  const comps = roomComponents(plan);
  const compOf = new Map<string, number>();
  comps.forEach((ids, i) => ids.forEach((id) => compOf.set(id, i)));
  const byId = new Map(plan.openings.map((o) => [o.id, o]));
  const reached = new Set<number>([compOf.get(start)!]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const j of plan.joins) {
      const a = byId.get(j.a);
      const b = byId.get(j.b);
      const ca = a && compOf.get(a.a);
      const cb = b && compOf.get(b.a);
      if (ca === undefined || cb === undefined || reached.has(ca) === reached.has(cb)) continue;
      reached.add(reached.has(ca) ? cb : ca);
      grew = true;
    }
  }
  return new Set([...reached].flatMap((i) => comps[i]));
}

/**
 * Joins door `bId` (which moves) to door `aId` (which stays): the rooms are placed
 * so the doors coincide, with the room of `b` on the other side of the wall.
 * Returns why it cannot be done, or null when joined.
 */
export function joinDoors(plan: Plan, aId: string, bId: string): string | null {
  const a = plan.openings.find((o) => o.id === aId);
  const b = plan.openings.find((o) => o.id === bId);
  if (!a || !b || a.type !== 'door' || b.type !== 'door') return 'Pick a door in the other room.';
  if (roomIdsOf(plan, a.a).has(b.a)) return 'That door is in the same room. Pick one in the other room.';
  if (joinOf(plan, aId) || joinOf(plan, bId)) return 'That door is already joined. Unjoin it first.';
  if (joinedGroup(plan, a.a).has(b.a)) return 'These rooms are already joined.';
  plan.joins.push({ a: aId, b: bId });
  applyJoins(plan, a.a);
  return null;
}

export function unjoin(plan: Plan, openingId: string): void {
  plan.joins = plan.joins.filter((j) => j.a !== openingId && j.b !== openingId);
}

/** Moves a room (corners and their capture positions) so its door `moving` lands on door `fixed`, on the far side of the wall (one wall thickness away). */
function alignRoom(plan: Plan, fixed: Opening, moving: Opening, ids: string[]): void {
  const f = openingFrame(plan, fixed);
  const m = openingFrame(plan, moving);
  if (!f || !m) return;
  // both rooms are measured on their inside faces, so the doors sit one wall thickness apart
  const fw = plan.walls.find((w) => sameWall(w, fixed.a, fixed.b));
  const mw = plan.walls.find((w) => sameWall(w, moving.a, moving.b));
  const t = wallThickness(plan, fixed.a, fixed.b);
  if (fw && mw) mw.thickness = fw.thickness;
  const cf0 = mid(f.p1, f.p2);
  const cf = { x: cf0.x - f.n.x * t, y: cf0.y - f.n.y * t };
  const cm = mid(m.p1, m.p2);
  const theta = Math.atan2(-f.n.y, -f.n.x) - Math.atan2(m.n.y, m.n.x);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const move = (v: Vec): Vec => {
    const x = v.x - cm.x;
    const y = v.y - cm.y;
    return { x: cf.x + x * cos - y * sin, y: cf.y + x * sin + y * cos };
  };
  for (const id of ids) {
    const p = pointById(plan, id);
    if (!p) continue;
    const sensor = move(p.sensor);
    const q = move(p);
    p.x = q.x;
    p.y = q.y;
    p.sensor = sensor;
  }
}

/**
 * Puts every joined room where its doors say. Each tree of joined rooms keeps one
 * room still (the one holding `keep`, else the first join's first door) and the
 * others are placed outwards from it, so a measurement that rescales a room
 * keeps its doors on each other.
 */
export function applyJoins(plan: Plan, keep?: string): void {
  const comps = roomComponents(plan);
  const compOf = new Map<string, number>();
  comps.forEach((ids, i) => ids.forEach((id) => compOf.set(id, i)));
  const byId = new Map(plan.openings.map((o) => [o.id, o]));
  const edges: { a: Opening; b: Opening; ca: number; cb: number }[] = [];
  for (const j of plan.joins) {
    const a = byId.get(j.a);
    const b = byId.get(j.b);
    const ca = a && compOf.get(a.a);
    const cb = b && compOf.get(b.a);
    if (a && b && ca !== undefined && cb !== undefined && ca !== cb) edges.push({ a, b, ca, cb });
  }
  const roots = edges.map((e) => e.ca);
  const keepComp = keep === undefined ? undefined : compOf.get(keep);
  if (keepComp !== undefined) roots.unshift(keepComp);

  const placed = new Set<number>();
  for (const root of roots) {
    if (placed.has(root)) continue;
    placed.add(root);
    let grew = true;
    while (grew) {
      grew = false;
      for (const e of edges) {
        const aPlaced = placed.has(e.ca);
        if (aPlaced === placed.has(e.cb)) continue;
        if (aPlaced) alignRoom(plan, e.a, e.b, comps[e.cb]);
        else alignRoom(plan, e.b, e.a, comps[e.ca]);
        placed.add(aPlaced ? e.cb : e.ca);
        grew = true;
      }
    }
  }
}

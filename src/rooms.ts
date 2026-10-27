// Rooms (points joined by walls), the doors that tie rooms together, and deleting a room.

import { Opening, Plan, Vec, pointById, removePoint } from './model';

const mid = (a: Vec, b: Vec): Vec => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

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

/** Even-odd test against the walls of one room only, so a neighbouring room does not count. */
export function insideRoom(plan: Plan, ids: Set<string>, p: Vec): boolean {
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

/** Floor area in m², when the room is a simple loop. */
export function roomArea(plan: Plan, ids: Set<string>): number | null {
  const loop = roomLoop(plan, ids);
  if (!loop) return null;
  const pts = loop.map((id) => pointById(plan, id)!);
  let sum = 0;
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length];
    sum += p.x * q.y - q.x * p.y;
  });
  return Math.abs(sum) / 2;
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

/** Removes a whole room: its corners, walls, measurements, doors and windows. */
export function deleteRoom(plan: Plan, id: string): void {
  for (const pid of roomIdsOf(plan, id)) removePoint(plan, pid);
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

/** Moves a room (corners and their capture positions) so its door `moving` lands on door `fixed`, on the far side of the wall. */
function alignRoom(plan: Plan, fixed: Opening, moving: Opening, ids: string[]): void {
  const f = openingFrame(plan, fixed);
  const m = openingFrame(plan, moving);
  if (!f || !m) return;
  const cf = mid(f.p1, f.p2);
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

import { describe, expect, it } from 'vitest';
import { addPoint, cornerNeighbours, roomFromCorners, roomName, setAngle, setRoomName } from './model';

describe('a wall ending on another wall', () => {
  it('gets the wall it stands on as its second neighbour, so it can be held at 90°', () => {
    const plan = roomFromCorners([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }]);
    const t = addPoint(plan, { x: 0, y: 1.2 });
    const end = addPoint(plan, { x: 1, y: 1.2 });
    plan.walls.push({ a: t.id, b: end.id });
    expect(cornerNeighbours(plan, t.id)).toEqual([end.id, plan.points[3].id]);
    expect(cornerNeighbours(plan, end.id)).toBeUndefined(); // the loose end stands on nothing
    setAngle(plan, t.id, 90);
    expect(plan.constraints).toContainEqual({ type: 'rightAngle', a: end.id, b: t.id, c: plan.points[3].id });
  });
});

describe('room names', () => {
  it('are kept on the corners, and survive one of them going away', () => {
    const plan = roomFromCorners([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }]);
    const ids = new Set(plan.points.map((p) => p.id));
    expect(roomName(plan, ids)).toBeUndefined();
    setRoomName(plan, ids, 'Kitchen');
    plan.points.shift();
    expect(roomName(plan, new Set(plan.points.map((p) => p.id)))).toBe('Kitchen');
  });
});

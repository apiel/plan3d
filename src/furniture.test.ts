import { describe, expect, it } from 'vitest';
import { parse, roomFromCorners, serialize } from './model';
import { LIBRARY, furnitureIcon, furnitureOutline, insideFurniture, newFurniture, snapToWalls } from './furniture';
import { moveRoom } from './rooms';
import { buildSolids } from './view3d/build';

const room = () => roomFromCorners([{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 3 }, { x: 0, y: 3 }]);

describe('furniture', () => {
  it('stands a piece put near a wall with its back against it', () => {
    const plan = room();
    const top = newFurniture('wc', { x: 1.5, y: 0.2 });
    expect(snapToWalls(plan, top, true)).toBe(true);
    expect(top.angle).toBeCloseTo(0);
    expect(top.y).toBeCloseTo(0.325);
    const bottom = newFurniture('wc', { x: 1.5, y: 2.9 });
    snapToWalls(plan, bottom, true);
    expect(bottom.angle).toBeCloseTo(180);
    expect(bottom.y).toBeCloseTo(3 - 0.325);
    const left = newFurniture('wc', { x: 0.1, y: 1.5 });
    snapToWalls(plan, left, true);
    expect(left.angle).toBeCloseTo(270);
    expect(left.x).toBeCloseTo(0.325);
  });

  it('pushes a piece into a corner and leaves one in the middle alone', () => {
    const plan = room();
    const bath = newFurniture('bath', { x: 0.95, y: 0.45 });
    snapToWalls(plan, bath, true);
    expect(bath.x).toBeCloseTo(0.85);
    expect(bath.y).toBeCloseTo(0.375);
    const table = newFurniture('table4', { x: 1.5, y: 1.5 });
    expect(snapToWalls(plan, table, true)).toBe(false);
    expect(table).toMatchObject({ x: 1.5, y: 1.5, angle: 0 });
  });

  it('keeps a turned piece turned against the wall', () => {
    const plan = room();
    const bed = { ...newFurniture('bedSingle', { x: 1.05, y: 1.5 }), angle: 90 };
    snapToWalls(plan, bed, false);
    expect(bed.angle).toBeCloseTo(90);
    expect(bed.x).toBeCloseTo(1.0); // its long side is 2 m: centre 1 m off the wall
  });

  it('tells inside from outside a turned piece', () => {
    const f = { ...newFurniture('sofa3', { x: 0, y: 0 }), angle: 90 };
    expect(insideFurniture(f, { x: 0, y: 1 })).toBe(true);
    expect(insideFurniture(f, { x: 1, y: 0 })).toBe(false);
    expect(furnitureOutline(newFurniture('roundTable', { x: 0, y: 0 }))).toHaveLength(24);
  });

  it('moves with its room, goes to 3D, survives saving, and drops boxes from older scans', () => {
    const plan = room();
    const f = newFurniture('sofa2', { x: 1, y: 1 });
    plan.furniture.push(f);
    moveRoom(plan, plan.points[0].id, { x: 2, y: 0 });
    expect(f.x).toBeCloseTo(3);
    expect(buildSolids(plan).filter((s) => s.kind === 'furniture')).toHaveLength(1);
    const back = parse(serialize(plan));
    expect(back.furniture).toEqual([f]);
    const old = parse(JSON.stringify({ ...plan, furniture: [{ id: 'b', x: 0, y: 0, w: 1, d: 1, h: 1 }] }));
    expect(old.furniture).toEqual([]);
  });

  it('has an icon for every piece', () => {
    expect(new Set(LIBRARY.map((i) => i.kind)).size).toBe(LIBRARY.length);
    for (const i of LIBRARY) expect(furnitureIcon(i)).not.toMatch(/NaN/);
  });
});

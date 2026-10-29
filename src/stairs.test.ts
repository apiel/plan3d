import { describe, expect, it } from 'vitest';
import { flipStair, insideStair, newStair, resizeStair, stairCorners, stairHandles, stairSteps, stairTreads, stairWalk, straightSteps } from './stairs';

describe('stairs', () => {
  it('lays out a flight along its angle', () => {
    const s = { ...newStair({ x: 0, y: 0 }), width: 1, length: 3, steps: 12 };
    expect(stairTreads(s)).toHaveLength(11);
    expect(insideStair(s, { x: 1.4, y: 0.4 })).toBe(true);
    expect(insideStair(s, { x: 0.4, y: 1.4 })).toBe(false);
    const turned = { ...s, angle: 90 };
    expect(insideStair(turned, { x: 0.4, y: 1.4 })).toBe(true);
    expect(insideStair(turned, { x: 1.4, y: 0.4 })).toBe(false);
    // the bottom of the flight comes first: with angle 90 it goes up towards +y
    const [bottom] = stairCorners(turned);
    expect(bottom.y).toBeCloseTo(-1.5);
  });
});

describe('turning stairs', () => {
  const s = { ...newStair({ x: 0, y: 0 }), width: 1, length: 3, steps: 14 };

  it('adds a square of three winders beyond each turning end', () => {
    const turned = { ...s, bottom: 'left' as const, top: 'right' as const };
    expect(straightSteps(turned)).toBe(8);
    expect(stairSteps(turned)).toHaveLength(14);
    expect(insideStair(turned, { x: 2.4, y: 0 })).toBe(true);
    expect(insideStair(turned, { x: -2.4, y: 0 })).toBe(true);
    expect(insideStair(s, { x: 2.4, y: 0 })).toBe(false);
    // 7 nosings on the straight part, then each turn: its edge with the straight part and two diagonals
    expect(stairTreads(turned)).toHaveLength(7 + 2 * 3);
  });

  it('comes in from the left at the bottom and goes out to the left at the top when turning left', () => {
    // angle 0: up is +x, and the walker's left is -y
    const walk = stairWalk({ ...s, bottom: 'left', top: 'left' });
    expect(walk[0].y).toBeCloseTo(-0.35);
    expect(walk[0].x).toBeCloseTo(-2);
    expect(walk[walk.length - 1].y).toBeCloseTo(-0.45);
    expect(walk[walk.length - 1].x).toBeCloseTo(2);
    // winders fan out from the inner corner, on the left at both ends
    const steps = stairSteps({ ...s, top: 'left' });
    const last = steps[steps.length - 1];
    expect(last.some((p) => Math.abs(p.x - 1.5) < 1e-9 && Math.abs(p.y + 0.5) < 1e-9)).toBe(true);
  });

  it('flips with the turns swapping ends and sides', () => {
    const f = { ...s, bottom: 'left' as const };
    flipStair(f);
    expect(f.angle).toBe(180);
    expect(f.bottom).toBeUndefined();
    expect(f.top).toBe('right');
    // the footprint does not move
    expect(insideStair(f, { x: -2.4, y: 0 })).toBe(true);
  });
});

describe('resizing stairs', () => {
  it('moves the dragged end or side and keeps the opposite one', () => {
    const s = { ...newStair({ x: 0, y: 0 }), width: 1, length: 3, angle: 90 };
    // angle 90: up is +y, and the right side is -x
    const longer = { ...s, ...resizeStair(s, 'top', { x: 0.3, y: 0.5 }) };
    expect(longer.length).toBeCloseTo(3.5);
    expect(stairHandles(longer).bottom.y).toBeCloseTo(-1.5);
    const wider = { ...s, ...resizeStair(s, 'right', { x: -0.2, y: 0 }) };
    expect(wider.width).toBeCloseTo(1.2);
    expect(stairHandles(wider).left.x).toBeCloseTo(0.5);
    // never shorter than a step or two
    expect(resizeStair(s, 'bottom', { x: 0, y: 5 }).length).toBeCloseTo(0.3);
  });
});

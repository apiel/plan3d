import { describe, expect, it } from 'vitest';
import { insideStair, newStair, stairCorners, stairTreads } from './stairs';

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

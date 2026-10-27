import { describe, expect, it } from 'vitest';
import { project, toView, unproject } from './xr';

// a phone camera turned 30 degrees and moved, with an off-centre portrait projection like ARCore gives
const a = Math.PI / 6;
const c = Math.cos(a);
const s = Math.sin(a);
const t = [1.2, 1.4, -0.5];
const matrix = [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, t[0], t[1], t[2], 1];
// inverse of a rigid transform: transposed rotation, translation -Rᵀt
const inverse = [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, -(c * t[0] - s * t[2]), -t[1], -(s * t[0] + c * t[2]), 1];
const [n, f] = [0.1, 100];
const projectionMatrix = [2.1, 0, 0, 0, 0, 1.2, 0, 0, 0.02, -0.01, -(f + n) / (f - n), -1, 0, 0, (-2 * f * n) / (f - n), 0];
const view = { projectionMatrix, transform: { matrix, inverse: { matrix: inverse } } } as unknown as XRView;

describe('xr helpers', () => {
  it('projects a world point back to where it was unprojected from', () => {
    for (const [u, v, d] of [
      [0.5, 0.5, 2],
      [0.1, 0.8, 1.3],
      [0.9, 0.2, 4.5],
    ]) {
      const p = unproject(view, u, v, d);
      const inView = toView(view, p);
      expect(inView[2]).toBeCloseTo(-d, 6);
      const [pu, pv] = project(view, inView);
      expect(pu).toBeCloseTo(u, 6);
      expect(pv).toBeCloseTo(v, 6);
    }
  });
});

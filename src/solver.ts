// Least-squares adjustment of a plan.
//
// Every fact is a residual with a standard deviation: the capture's point
// positions (loose), measured distances (tight), right angles (tight). We
// find the point positions minimising the weighted sum of squared residuals
// with Levenberg-Marquardt. The more tight facts are added, the more the
// result is pinned down, and unmeasured walls get pulled into line through
// the shared corners and right angles.

import { Constraint, Plan, Vec, dist } from './model';

/** Standard deviations: how much each kind of fact is trusted (metres / cosine). */
export const SIGMA = {
  sensor: 0.05,
  distance: 0.003,
  angle: 0.01,
};

export interface SolveResult {
  points: Map<string, Vec>;
  iterations: number;
  /** Measured distances the solution could not honour, with the error in metres. */
  conflicts: { constraint: Constraint; error: number }[];
}

const EPS = 1e-9;

export function solve(plan: Plan, maxIterations = 100): SolveResult {
  const index = new Map(plan.points.map((p, i) => [p.id, i]));
  const n = plan.points.length * 2;
  const x = new Float64Array(n);
  plan.points.forEach((p, i) => {
    x[2 * i] = p.x;
    x[2 * i + 1] = p.y;
  });

  const at = (v: Float64Array, id: string): Vec => {
    const i = index.get(id);
    if (i === undefined) throw new Error(`Unknown point ${id}`);
    return { x: v[2 * i], y: v[2 * i + 1] };
  };

  const residuals = (v: Float64Array): number[] => {
    const r: number[] = [];
    plan.points.forEach((p, i) => {
      r.push((v[2 * i] - p.sensor.x) / SIGMA.sensor);
      r.push((v[2 * i + 1] - p.sensor.y) / SIGMA.sensor);
    });
    for (const c of plan.constraints) {
      if (c.type === 'distance') {
        r.push((dist(at(v, c.a), at(v, c.b)) - c.value) / SIGMA.distance);
      } else {
        const b = at(v, c.b);
        const a = at(v, c.a);
        const cc = at(v, c.c);
        const ux = a.x - b.x;
        const uy = a.y - b.y;
        const wx = cc.x - b.x;
        const wy = cc.y - b.y;
        const cos = (ux * wx + uy * wy) / Math.max(Math.hypot(ux, uy) * Math.hypot(wx, wy), EPS);
        r.push(cos / SIGMA.angle);
      }
    }
    return r;
  };

  const sumSq = (r: number[]) => r.reduce((s, v) => s + v * v, 0);

  let lambda = 1e-3;
  let r = residuals(x);
  let cost = sumSq(r);
  let iterations = 0;

  for (; iterations < maxIterations; iterations++) {
    const m = r.length;
    // numeric Jacobian, forward differences
    const J: Float64Array[] = Array.from({ length: n }, () => new Float64Array(m));
    for (let k = 0; k < n; k++) {
      const h = 1e-6;
      const saved = x[k];
      x[k] = saved + h;
      const r2 = residuals(x);
      x[k] = saved;
      for (let i = 0; i < m; i++) J[k][i] = (r2[i] - r[i]) / h;
    }
    // normal equations: (J^T J + lambda I) dx = -J^T r
    const A: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
    const g = new Array(n).fill(0);
    for (let a = 0; a < n; a++) {
      for (let i = 0; i < m; i++) g[a] -= J[a][i] * r[i];
      for (let b = a; b < n; b++) {
        let s = 0;
        for (let i = 0; i < m; i++) s += J[a][i] * J[b][i];
        A[a][b] = s;
        A[b][a] = s;
      }
    }

    let improved = false;
    for (let attempt = 0; attempt < 12; attempt++) {
      const damped = A.map((row, i) => row.map((val, j) => (i === j ? val + lambda : val)));
      const dx = gaussSolve(damped, g);
      if (!dx) {
        lambda *= 10;
        continue;
      }
      const trial = Float64Array.from(x, (v, i) => v + dx[i]);
      const rt = residuals(trial);
      const ct = sumSq(rt);
      if (ct < cost) {
        const step = Math.max(...dx.map(Math.abs));
        x.set(trial);
        r = rt;
        const gain = cost - ct;
        cost = ct;
        lambda = Math.max(lambda / 10, 1e-12);
        improved = true;
        if (step < 1e-9 || gain < 1e-12) iterations = maxIterations;
        break;
      }
      lambda *= 10;
    }
    if (!improved) break;
  }

  const points = new Map<string, Vec>();
  plan.points.forEach((p, i) => points.set(p.id, { x: x[2 * i], y: x[2 * i + 1] }));

  const conflicts: SolveResult['conflicts'] = [];
  for (const c of plan.constraints) {
    if (c.type !== 'distance') continue;
    const error = dist(points.get(c.a)!, points.get(c.b)!) - c.value;
    if (Math.abs(error) > 0.01) conflicts.push({ constraint: c, error });
  }
  return { points, iterations, conflicts };
}

/** Applies a solution to the plan in place. */
export function apply(plan: Plan, result: SolveResult): void {
  for (const p of plan.points) {
    const s = result.points.get(p.id);
    if (s) {
      p.x = s.x;
      p.y = s.y;
    }
  }
}

/** Solves A x = b by Gaussian elimination with partial pivoting; undefined if singular. */
function gaussSolve(A: number[][], b: number[]): number[] | undefined {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(M[row][col]) > Math.abs(M[pivot][col])) pivot = row;
    if (Math.abs(M[pivot][col]) < 1e-14) return undefined;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    for (let row = col + 1; row < n; row++) {
      const f = M[row][col] / M[col][col];
      for (let k = col; k <= n; k++) M[row][k] -= f * M[col][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let s = M[row][n];
    for (let k = row + 1; k < n; k++) s -= M[row][k] * x[k];
    x[row] = s / M[row][row];
  }
  return x;
}

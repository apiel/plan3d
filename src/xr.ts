// Small helpers for WebXR matrices (column-major 4x4, as WebXR gives them).

export type Vec3 = [number, number, number];

export function mulPoint(m: ArrayLike<number>, [x, y, z]: Vec3): Vec3 {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

/** Normalized view coords (0..1, origin top-left) plus depth along the view axis, to a world point. */
export function unproject(view: XRView, u: number, v: number, depth: number): Vec3 {
  const p = view.projectionMatrix;
  const x = (depth * (2 * u - 1 + p[8])) / p[0];
  const y = (depth * (1 - 2 * v + p[9])) / p[5];
  return mulPoint(view.transform.matrix, [x, y, -depth]);
}

/** The direction the camera looks along, in world space. */
export function forward(view: XRView): Vec3 {
  const m = view.transform.matrix;
  return [-m[8], -m[9], -m[10]];
}

/** World point into view space: camera at the origin, looking down -z. */
export function toView(view: XRView, p: Vec3): Vec3 {
  return mulPoint(view.transform.inverse.matrix, p);
}

/** View-space point in front of the camera to normalized view coords (0..1, origin top-left), the inverse of `unproject`. */
export function project(view: XRView, [x, y, z]: Vec3): [number, number] {
  const m = view.projectionMatrix;
  const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
  const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  return [(cx / w + 1) / 2, (1 - cy / w) / 2];
}

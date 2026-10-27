// AR room scan: sweep the phone around a room and get an outline.
//
// Started straight from the editor's Scan button (an AR session needs a tap
// on the page that asks for it). Depth comes from WebXR depth sensing (see
// depth.html for the raw test). Keyframes are collected while the phone
// moves; on Finish the outline is extracted (src/scan/extract.ts), added to
// the saved plan, and the editor shows it.
// Optionally, the user aims the centre crosshair at corners and at door and
// window edges and taps a button to mark them; the extraction uses them.
// Marks are drawn over the camera view, and the one under the cross can be
// removed.

import './scan.css';
import { Plan, dist, newId, roomFromCorners, toggleRightAngle } from './model';
import { Keyframe, Marks, RoomScan, extractRoom } from './scan/extract';
import { load, save } from './storage';
import { Vec3, forward, project, toView, unproject } from './xr';

const COLS = 24;
const ROWS = 32;
const MIN_DEPTH = 0.3;
const MAX_DEPTH = 6;
const MOVE_STEP = 0.15; // metres between keyframes
const TURN_STEP = Math.cos((12 * Math.PI) / 180);
const MAX_FRAMES = 600;
const MAP_SCALE = 25; // px per metre, the map shows 8 m
const AIM_SPREAD = 0.02; // the crosshair reads depth over a small patch this wide (view fraction) and takes the median
const NEAR = 0.05; // metres: marks closer to the camera plane than this are not drawn
const TARGET_PX = 40; // a mark this close to the cross on screen is the one Remove deletes

type Opening = Marks['openings'][number];
type Mark = { kind: 'corner'; p: Vec3 } | { kind: 'opening'; o: Opening };

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const overlay = $('scanOverlay');
const hud = $('hud');
const arCanvas = $<HTMLCanvasElement>('arDraw');
const arCtx = arCanvas.getContext('2d')!;
const mapCanvas = $<HTMLCanvasElement>('map');
const mapCtx = mapCanvas.getContext('2d')!;
const cross = $('cross');
const aimText = $('aimText');
const removeBtn = $<HTMLButtonElement>('markRemove');
const openingBtn = { door: $<HTMLButtonElement>('markDoor'), window: $<HTMLButtonElement>('markWindow') };

const frames: Keyframe[] = [];
let session: XRSession | null = null;
let refSpace: XRReferenceSpace | null = null;
let gl: WebGLRenderingContext | null = null;
let last: { pos: Vec3; fwd: Vec3 } | null = null;
let origin: Vec3 | null = null;
let totalPoints = 0;
let message = '';
let messageUntil = 0;
let added = false;
/** World point under the crosshair in the latest frame, if depth had one. */
let aim: Vec3 | null = null;
/** Where the phone was in the latest frame. */
let camPos: Vec3 = [0, 0, 0];
const marks: Marks = { corners: [], openings: [] };
/** Marks in the order they were made, for undo. */
const placed: Mark[] = [];
/** First edge of a door or window, waiting for the second. */
let pending: { type: 'door' | 'window'; a: Vec3; camA: Vec3 } | null = null;
/** The mark under the cross in the latest frame. */
let target: Mark | null = null;

const trail = document.createElement('canvas');
trail.width = mapCanvas.width;
trail.height = mapCanvas.height;
const trailCtx = trail.getContext('2d')!;

/** What this phone or browser lacks for a scan, or null when it can try. */
export async function missingForScan(): Promise<string | null> {
  if (!window.isSecureContext) {
    return 'Missing: a secure connection. Open the app over https or localhost, or allow this address in chrome://flags (insecure origins treated as secure).';
  }
  if (!navigator.xr) return 'Missing: WebXR in this browser. Use Chrome on an Android phone.';
  if (!(await navigator.xr.isSessionSupported('immersive-ar'))) {
    return 'Missing: AR on this device. It needs an ARCore phone with Google Play Services for AR.';
  }
  return null;
}

/** Starts the AR scan. `onEnd` runs when it closes, with whether a room was added to the saved plan. */
export async function startScan(onEnd: (added: boolean) => void): Promise<void> {
  frames.length = 0;
  last = null;
  origin = null;
  totalPoints = 0;
  added = false;
  aim = null;
  target = null;
  marks.corners.length = 0;
  marks.openings.length = 0;
  placed.length = 0;
  setPending(null);
  trailCtx.clearRect(0, 0, trail.width, trail.height);

  // depthSensing is not in the DOM typings of every TypeScript version
  const init = {
    requiredFeatures: ['local', 'depth-sensing', 'dom-overlay'],
    depthSensing: { usagePreference: ['cpu-optimized'], dataFormatPreference: ['luminance-alpha', 'float32'] },
    domOverlay: { root: overlay },
  } as XRSessionInit;
  try {
    session = await navigator.xr!.requestSession('immersive-ar', init);
  } catch (e) {
    throw new Error(
      (e as Error).name === 'NotSupportedError'
        ? 'Missing: depth sensing or screen overlay in AR on this phone or browser. Use Chrome on an ARCore phone that supports depth.'
        : `Could not start AR: ${(e as Error).message}`
    );
  }
  gl = document.createElement('canvas').getContext('webgl', { xrCompatible: true } as WebGLContextAttributes);
  await session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl!) });
  refSpace = await session.requestReferenceSpace('local');
  overlay.classList.add('on');
  session.addEventListener('end', () => {
    overlay.classList.remove('on');
    session = null;
    onEnd(added);
  });
  session.requestAnimationFrame(onFrame);
}

/** Whether the last scan left raw data to download. */
export const hasScanData = (): boolean => frames.length > 0;

function flash(text: string): void {
  message = text;
  messageUntil = performance.now() + 3500;
}

function onFrame(_t: number, frame: XRFrame): void {
  const s = frame.session;
  s.requestAnimationFrame(onFrame);

  // keep the XR layer transparent so the camera feed shows through
  const layer = s.renderState.baseLayer!;
  gl!.bindFramebuffer(gl!.FRAMEBUFFER, layer.framebuffer);
  gl!.clearColor(0, 0, 0, 0);
  gl!.clear(gl!.COLOR_BUFFER_BIT | gl!.DEPTH_BUFFER_BIT);

  const pose = frame.getViewerPose(refSpace!);
  if (!pose || !pose.views.length) return;
  const view = pose.views[0];
  const m = view.transform.matrix;
  const pos: Vec3 = [m[12], m[13], m[14]];
  const fwd = forward(view);
  if (!origin) origin = pos;

  let depth: XRCPUDepthInformation | null = null;
  try {
    depth = frame.getDepthInformation(view) ?? null;
  } catch {
    depth = null;
  }

  camPos = pos;
  aim = depth ? aimAt(view, depth) : null;
  cross.classList.toggle('ok', !!aim);
  // while a door or window waits for its second side, show its width so far instead of the distance
  aimText.textContent = !aim
    ? ''
    : pending
      ? `${pending.type} ${Math.round(Math.hypot(aim[0] - pending.a[0], aim[2] - pending.a[2]) * 100)} cm`
      : `${Math.hypot(aim[0] - pos[0], aim[1] - pos[1], aim[2] - pos[2]).toFixed(2)} m`;

  if (depth && frames.length < MAX_FRAMES && shouldKeep(pos, fwd)) {
    const kf = sample(view, depth, pos);
    if (kf.points.length) {
      frames.push(kf);
      totalPoints += kf.points.length / 3;
      plotTrail(kf);
      last = { pos, fwd };
    }
  }

  drawMarks(view);
  updateRemoveButton();
  drawMap(pos, fwd);
  updateHud(depth);
}

function shouldKeep(pos: Vec3, fwd: Vec3): boolean {
  if (!last) return true;
  const moved = Math.hypot(pos[0] - last.pos[0], pos[1] - last.pos[1], pos[2] - last.pos[2]);
  const dot = fwd[0] * last.fwd[0] + fwd[1] * last.fwd[1] + fwd[2] * last.fwd[2];
  return moved >= MOVE_STEP || dot <= TURN_STEP;
}

function sample(view: XRView, depth: XRCPUDepthInformation, cam: Vec3): Keyframe {
  const pts: number[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const d = depth.getDepthInMeters((c + 0.5) / COLS, (r + 0.5) / ROWS);
      if (!(d >= MIN_DEPTH && d <= MAX_DEPTH)) continue;
      pts.push(...unproject(view, (c + 0.5) / COLS, (r + 0.5) / ROWS, d));
    }
  }
  return { cam, points: Float32Array.from(pts) };
}

/** The point under the crosshair: median depth of a small patch, so one bad reading does not move it. */
function aimAt(view: XRView, depth: XRCPUDepthInformation): Vec3 | null {
  const ds: number[] = [];
  for (const du of [-AIM_SPREAD, 0, AIM_SPREAD]) {
    for (const dv of [-AIM_SPREAD, 0, AIM_SPREAD]) {
      const d = depth.getDepthInMeters(0.5 + du, 0.5 + dv);
      if (d >= MIN_DEPTH && d <= MAX_DEPTH) ds.push(d);
    }
  }
  if (ds.length < 5) return null;
  ds.sort((a, b) => a - b);
  return unproject(view, 0.5, 0.5, ds[Math.floor(ds.length / 2)]);
}

// ---------- marks ----------

function setPending(p: typeof pending): void {
  pending = p;
  for (const type of ['door', 'window'] as const) {
    const waiting = pending?.type === type;
    openingBtn[type].classList.toggle('pending', waiting);
    openingBtn[type].textContent = (type === 'door' ? 'Door' : 'Window') + (waiting ? ' 2nd side' : '');
  }
}

function markCorner(): void {
  if (!aim) return flash('No depth under the cross. Step back a little or aim again.');
  marks.corners.push(aim);
  placed.push({ kind: 'corner', p: aim });
  flash(`Corner ${marks.corners.length} marked. Mark every corner of the room, or none.`);
}

function markOpening(type: 'door' | 'window'): void {
  if (!aim) return flash('No depth under the cross. Step back a little or aim again.');
  if (pending?.type !== type) {
    setPending({ type, a: aim, camA: camPos });
    return;
  }
  const o: Opening = { type, a: pending.a, b: aim, camA: pending.camA, camB: camPos };
  marks.openings.push(o);
  placed.push({ kind: 'opening', o });
  setPending(null);
  flash(`${type === 'door' ? 'Door' : 'Window'} marked, about ${Math.round(Math.hypot(o.b[0] - o.a[0], o.b[2] - o.a[2]) * 100)} cm wide.`);
}

function removeMark(mark: Mark): void {
  placed.splice(placed.indexOf(mark), 1);
  if (mark.kind === 'corner') marks.corners.splice(marks.corners.indexOf(mark.p), 1);
  else marks.openings.splice(marks.openings.indexOf(mark.o), 1);
  flash(`${mark.kind === 'corner' ? 'Corner' : mark.o.type === 'door' ? 'Door' : 'Window'} removed.`);
}

/** One button, three jobs: cancel a half-placed door or window, remove the mark under the cross, or undo the last mark. */
function onRemove(): void {
  if (pending) {
    flash(`${pending.type === 'door' ? 'Door' : 'Window'} cancelled.`);
    setPending(null);
  } else if (target) {
    removeMark(target);
    target = null;
  } else if (placed.length) {
    removeMark(placed[placed.length - 1]);
  } else {
    flash('No marks to remove.');
  }
}

function updateRemoveButton(): void {
  const text = pending ? `Cancel ${pending.type}` : target ? 'Remove' : 'Undo';
  if (removeBtn.textContent !== text) removeBtn.textContent = text;
  removeBtn.classList.toggle('pending', !!pending || !!target);
}

// ---------- drawing over the camera ----------

/** The part of a world segment in front of the camera, in screen pixels, or null when all of it is behind. */
function onScreen(view: XRView, a: Vec3, b: Vec3, w: number, h: number): [number, number][] | null {
  let va = toView(view, a);
  let vb = toView(view, b);
  if (va[2] > -NEAR && vb[2] > -NEAR) return null;
  // cut at the near plane so a mark behind the camera does not flip to the other side of the screen
  const cut = (p: Vec3, q: Vec3): Vec3 => {
    const t = (-NEAR - p[2]) / (q[2] - p[2]);
    return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, -NEAR];
  };
  if (va[2] > -NEAR) va = cut(va, vb);
  else if (vb[2] > -NEAR) vb = cut(vb, va);
  return [va, vb].map((v) => {
    const [u, s] = project(view, v);
    return [u * w, s * h];
  });
}

function distToSegment(px: number, py: number, [a, b]: [number, number][]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

/** Draws every mark over the camera view, picks the one under the cross, and draws the half-placed door or window. */
function drawMarks(view: XRView): void {
  const dpr = window.devicePixelRatio || 1;
  const w = arCanvas.clientWidth;
  const h = arCanvas.clientHeight;
  if (arCanvas.width !== Math.round(w * dpr) || arCanvas.height !== Math.round(h * dpr)) {
    arCanvas.width = Math.round(w * dpr);
    arCanvas.height = Math.round(h * dpr);
  }
  arCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  arCtx.clearRect(0, 0, w, h);
  const cx = w / 2;
  const cy = h / 2;

  // pick first, so the picked mark can be drawn highlighted
  let best = TARGET_PX;
  target = null;
  const shapes = placed.map((mark) => {
    const seg = mark.kind === 'corner' ? onScreen(view, mark.p, mark.p, w, h) : onScreen(view, mark.o.a, mark.o.b, w, h);
    if (seg && !pending) {
      const d = distToSegment(cx, cy, seg);
      if (d < best) {
        best = d;
        target = mark;
      }
    }
    return { mark, seg };
  });

  arCtx.lineCap = 'round';
  for (const { mark, seg } of shapes) {
    if (!seg) continue;
    const hit = mark === target;
    const color = hit ? '#ef4444' : mark.kind === 'corner' ? '#f472b6' : mark.o.type === 'door' ? '#60a5fa' : '#22d3ee';
    arCtx.strokeStyle = color;
    arCtx.fillStyle = color;
    if (mark.kind === 'corner') {
      arCtx.beginPath();
      arCtx.arc(seg[0][0], seg[0][1], hit ? 11 : 8, 0, Math.PI * 2);
      arCtx.fill();
    } else {
      arCtx.lineWidth = hit ? 9 : 6;
      arCtx.beginPath();
      arCtx.moveTo(seg[0][0], seg[0][1]);
      arCtx.lineTo(seg[1][0], seg[1][1]);
      arCtx.stroke();
    }
  }

  // the door or window being placed: from its first side to the cross
  if (pending) {
    const end = aim ?? pending.a;
    const seg = onScreen(view, pending.a, end, w, h);
    if (seg) {
      if (!aim) seg[1] = [cx, cy]; // no depth: still follow the cross
      arCtx.strokeStyle = '#f59e0b';
      arCtx.lineWidth = 5;
      arCtx.setLineDash([12, 8]);
      arCtx.beginPath();
      arCtx.moveTo(seg[0][0], seg[0][1]);
      arCtx.lineTo(seg[1][0], seg[1][1]);
      arCtx.stroke();
      arCtx.setLineDash([]);
      arCtx.fillStyle = '#f59e0b';
      arCtx.beginPath();
      arCtx.arc(seg[0][0], seg[0][1], 8, 0, Math.PI * 2);
      arCtx.fill();
    }
  }
}

// ---------- minimap ----------

function mapXY(x: number, z: number): [number, number] {
  const o = origin!;
  return [mapCanvas.width / 2 + (x - o[0]) * MAP_SCALE, mapCanvas.height / 2 + (z - o[2]) * MAP_SCALE];
}

/** Adds this keyframe's wall-height points to the persistent top-down trail. */
function plotTrail(kf: Keyframe): void {
  trailCtx.fillStyle = '#4ade80';
  const lo = kf.cam[1] - 1.0;
  const hi = kf.cam[1] + 0.5;
  for (let i = 0; i < kf.points.length; i += 3) {
    const y = kf.points[i + 1];
    if (y < lo || y > hi) continue;
    const [px, py] = mapXY(kf.points[i], kf.points[i + 2]);
    trailCtx.fillRect(px, py, 2, 2);
  }
}

function drawMap(pos: Vec3, fwd: Vec3): void {
  mapCtx.clearRect(0, 0, mapCanvas.width, mapCanvas.height);
  mapCtx.drawImage(trail, 0, 0);
  const [px, py] = mapXY(pos[0], pos[2]);
  const a = Math.atan2(fwd[2], fwd[0]);
  mapCtx.fillStyle = '#facc15';
  mapCtx.beginPath();
  mapCtx.moveTo(px + Math.cos(a) * 9, py + Math.sin(a) * 9);
  mapCtx.lineTo(px + Math.cos(a + 2.5) * 6, py + Math.sin(a + 2.5) * 6);
  mapCtx.lineTo(px + Math.cos(a - 2.5) * 6, py + Math.sin(a - 2.5) * 6);
  mapCtx.fill();

  mapCtx.fillStyle = '#f472b6';
  for (const c of marks.corners) {
    const [x, y] = mapXY(c[0], c[2]);
    mapCtx.fillRect(x - 3, y - 3, 6, 6);
  }
  mapCtx.lineWidth = 3;
  for (const o of marks.openings) {
    const [ax, ay] = mapXY(o.a[0], o.a[2]);
    const [bx, by] = mapXY(o.b[0], o.b[2]);
    mapCtx.strokeStyle = o.type === 'door' ? '#60a5fa' : '#22d3ee';
    mapCtx.beginPath();
    mapCtx.moveTo(ax, ay);
    mapCtx.lineTo(bx, by);
    mapCtx.stroke();
  }
  if (pending) {
    const [x, y] = mapXY(pending.a[0], pending.a[2]);
    mapCtx.fillStyle = '#f59e0b';
    mapCtx.beginPath();
    mapCtx.arc(x, y, 3, 0, Math.PI * 2);
    mapCtx.fill();
  }
}

function updateHud(depth: XRCPUDepthInformation | null): void {
  const lines: string[] = [];
  if (!depth) lines.push('Waiting for depth... move the phone slowly');
  else lines.push(`${frames.length} views · ${(totalPoints / 1000).toFixed(1)}k points · ${marks.corners.length} corners · ${marks.openings.length} doors/windows`);
  if (performance.now() < messageUntil) {
    lines.push(message);
  } else if (pending) {
    const name = pending.type === 'door' ? 'Door' : 'Window';
    lines.push(`${name}: first side set. Aim at the wall just beside the other side and tap "${name} 2nd side", or "Cancel ${pending.type}".`);
  } else if (target) {
    lines.push('Tap Remove to delete the red mark.');
  } else {
    lines.push(
      'Turn slowly on the spot, aiming at the walls, the floor and the ceiling. Then walk around the room, and into corners and alcoves. Finish when the green outline looks complete.\n' +
        'Optional: put the cross on each corner and tap Corner. For a door or window, aim at the wall just beside each side of the frame and tap Door (or Window) at each. Aim at a mark and tap Remove to delete it.'
    );
  }
  hud.textContent = lines.join('\n');
}

// ---------- finishing ----------

function addRoomToPlan(scan: RoomScan): void {
  const plan: Plan = load();
  const room = roomFromCorners(scan.corners);
  // put the new room to the right of what is already there
  const shift = plan.points.length ? Math.max(...plan.points.map((p) => p.x)) + 1 - Math.min(...room.points.map((p) => p.x)) : 0;
  for (const p of room.points) {
    p.x += shift;
    p.sensor.x += shift;
  }
  plan.points.push(...room.points);
  plan.walls.push(...room.walls);
  plan.constraints.push(...room.constraints);
  // furniture boxes (scan.furniture) are left out of the plan for now
  for (const o of scan.openings) {
    const a = room.points[o.wall].id;
    const b = room.points[(o.wall + 1) % room.points.length].id;
    plan.openings.push({ id: newId(), type: o.type, a, b, at: o.from, width: o.to - o.from });
  }

  // corners that came out near 90 degrees become right-angle constraints
  for (const p of room.points) {
    const nb = room.walls.filter((w) => w.a === p.id || w.b === p.id).map((w) => (w.a === p.id ? w.b : w.a));
    if (nb.length !== 2) continue;
    const a = room.points.find((q) => q.id === nb[0])!;
    const c = room.points.find((q) => q.id === nb[1])!;
    const cos = ((a.x - p.x) * (c.x - p.x) + (a.y - p.y) * (c.y - p.y)) / (dist(a, p) * dist(c, p));
    if (Math.abs(cos) < Math.sin((8 * Math.PI) / 180)) toggleRightAngle(plan, p.id);
  }
  save(plan);
}

async function finish(): Promise<void> {
  const room = extractRoom(frames, marks);
  if (!room || room.corners.length < 3) {
    flash('Could not find a room outline yet. Cover more of the walls, floor and ceiling, then try again.');
    return;
  }
  addRoomToPlan(room);
  added = true;
  await session?.end();
}

/** Saves the raw keyframes and marks of the last scan, to replay on a computer (`npm run replay`). */
export function downloadScan(): void {
  const round = (v: number) => Math.round(v * 1000) / 1000;
  const r3 = (p: Vec3): Vec3 => [round(p[0]), round(p[1]), round(p[2])];
  const data = {
    version: 2,
    date: new Date().toISOString(),
    frames: frames.map((f) => ({ cam: f.cam.map(round), points: Array.from(f.points, round) })),
    marks: { corners: marks.corners.map(r3), openings: marks.openings.map((o) => ({ type: o.type, a: r3(o.a), b: r3(o.b), camA: o.camA && r3(o.camA), camB: o.camB && r3(o.camB) })) },
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `scan-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('markCorner').addEventListener('click', markCorner);
openingBtn.door.addEventListener('click', () => markOpening('door'));
openingBtn.window.addEventListener('click', () => markOpening('window'));
removeBtn.addEventListener('click', onRemove);
$('finish').addEventListener('click', () => void finish());
$('cancel').addEventListener('click', () => void session?.end());
overlay.addEventListener('beforexrselect', (e) => e.preventDefault());

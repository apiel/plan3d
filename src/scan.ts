// AR room scan: sweep the phone around a room and get an outline.
//
// Depth comes from WebXR depth sensing (see depth.html for the raw test).
// Keyframes are collected while the phone moves; on Finish the outline is
// extracted (src/scan/extract.ts) and added to the plan the editor opens.

import { Plan, dist, roomFromCorners, toggleRightAngle } from './model';
import { Keyframe, extractRoom } from './scan/extract';
import { load, save } from './storage';
import { Vec3, forward, unproject } from './xr';

const COLS = 24;
const ROWS = 32;
const MIN_DEPTH = 0.3;
const MAX_DEPTH = 6;
const MOVE_STEP = 0.15; // metres between keyframes
const TURN_STEP = Math.cos((12 * Math.PI) / 180);
const MAX_FRAMES = 600;
const MAP_SCALE = 25; // px per metre, the map shows 8 m

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const supportEl = $('support');
const startBtn = $<HTMLButtonElement>('start');
const overlay = $('overlay');
const hud = $('hud');
const mapCanvas = $<HTMLCanvasElement>('map');
const mapCtx = mapCanvas.getContext('2d')!;

const frames: Keyframe[] = [];
let session: XRSession | null = null;
let refSpace: XRReferenceSpace | null = null;
let gl: WebGLRenderingContext | null = null;
let last: { pos: Vec3; fwd: Vec3 } | null = null;
let origin: Vec3 | null = null;
let totalPoints = 0;
let message = '';
let messageUntil = 0;

const trail = document.createElement('canvas');
trail.width = mapCanvas.width;
trail.height = mapCanvas.height;
const trailCtx = trail.getContext('2d')!;

function addSupport(ok: boolean, text: string): void {
  const li = document.createElement('li');
  li.className = ok ? 'ok' : 'ko';
  li.textContent = text;
  supportEl.append(li);
}

async function checkSupport(): Promise<void> {
  addSupport(window.isSecureContext, 'Secure context (HTTPS or localhost)');
  if (!navigator.xr) {
    addSupport(false, 'WebXR not available in this browser (use Chrome on an Android phone)');
    return;
  }
  const ar = await navigator.xr.isSessionSupported('immersive-ar');
  addSupport(ar, 'AR sessions');
  startBtn.disabled = !ar;
}

async function start(): Promise<void> {
  frames.length = 0;
  last = null;
  origin = null;
  totalPoints = 0;
  trailCtx.clearRect(0, 0, trail.width, trail.height);

  // depthSensing is not in the DOM typings of every TypeScript version
  const init = {
    requiredFeatures: ['local'],
    optionalFeatures: ['depth-sensing', 'dom-overlay'],
    depthSensing: { usagePreference: ['cpu-optimized'], dataFormatPreference: ['luminance-alpha', 'float32'] },
    domOverlay: { root: overlay },
  } as XRSessionInit;
  session = await navigator.xr!.requestSession('immersive-ar', init);
  gl = document.createElement('canvas').getContext('webgl', { xrCompatible: true } as WebGLContextAttributes);
  await session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl!) });
  refSpace = await session.requestReferenceSpace('local');
  overlay.classList.add('on');
  session.addEventListener('end', () => overlay.classList.remove('on'));
  session.requestAnimationFrame(onFrame);
}

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

  if (depth && frames.length < MAX_FRAMES && shouldKeep(pos, fwd)) {
    const kf = sample(view, depth, pos);
    if (kf.points.length) {
      frames.push(kf);
      totalPoints += kf.points.length / 3;
      plotTrail(kf);
      last = { pos, fwd };
    }
  }

  drawMap(pos, fwd);
  updateHud(s, depth);
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
}

function updateHud(s: XRSession, depth: XRCPUDepthInformation | null): void {
  const lines: string[] = [];
  if (!s.depthUsage) lines.push('This device or browser gave no depth sensing');
  else if (!depth) lines.push('Waiting for depth... move the phone slowly');
  else lines.push(`${frames.length} views · ${(totalPoints / 1000).toFixed(1)}k points`);
  lines.push(
    performance.now() < messageUntil
      ? message
      : 'Turn slowly on the spot, aiming at the walls, the floor and the ceiling. Then walk around the room, and into corners and alcoves. Finish when the green outline looks complete.'
  );
  hud.textContent = lines.join('\n');
}

// ---------- finishing ----------

function addRoomToPlan(corners: { x: number; y: number }[]): void {
  const plan: Plan = load();
  const room = roomFromCorners(corners);
  // put the new room to the right of what is already there
  const shift = plan.points.length ? Math.max(...plan.points.map((p) => p.x)) + 1 - Math.min(...room.points.map((p) => p.x)) : 0;
  for (const p of room.points) {
    p.x += shift;
    p.sensor.x += shift;
  }
  plan.points.push(...room.points);
  plan.walls.push(...room.walls);
  plan.constraints.push(...room.constraints);

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
  const room = extractRoom(frames);
  if (!room || room.corners.length < 3) {
    flash('Could not find a room outline yet. Cover more of the walls, floor and ceiling, then try again.');
    return;
  }
  addRoomToPlan(room.corners);
  await session?.end();
  window.location.href = './index.html';
}

$('finish').addEventListener('click', () => void finish());
$('cancel').addEventListener('click', () => void session?.end());
overlay.addEventListener('beforexrselect', (e) => e.preventDefault());
startBtn.addEventListener('click', () => start().catch((e: Error) => addSupport(false, `Start failed: ${e.message}`)));

void checkSupport();

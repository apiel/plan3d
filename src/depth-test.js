// WebXR depth-sensing test: shows the depth the phone provides and measures
// the distance between two tapped points, so it can be compared with a tape.
// No dependencies, no build step. Needs Chrome on Android and a secure context.

const $ = (id) => document.getElementById(id);
const supportEl = $('support');
const startBtn = $('start');
const resultsEl = $('results');
const overlay = $('overlay');
const canvas = $('view');
const hud = $('hud');
const ctx2d = canvas.getContext('2d');

const GRID_COLS = 24;
const GRID_ROWS = 32;
const MAX_DEPTH = 5; // metres, end of the colour scale
const TAP_SAMPLES = 2; // median over (2 * n + 1)^2 samples around a tap
const TAP_STEP = 0.008; // normalized view units between samples

const state = {
  session: null,
  gl: null,
  refSpace: null,
  showDepth: true,
  points: [], // world-space [x, y, z]
  log: [],
  pendingTap: null,
  frameCount: 0,
  depthGrid: [],
  centerDepth: 0,
  depthInfo: null,
};

// column-major 4x4 helpers (WebXR matrices)
const mulPoint = (m, [x, y, z], w = 1) => [
  m[0] * x + m[4] * y + m[8] * z + m[12] * w,
  m[1] * x + m[5] * y + m[9] * z + m[13] * w,
  m[2] * x + m[6] * y + m[10] * z + m[14] * w,
  m[3] * x + m[7] * y + m[11] * z + m[15] * w,
];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

function addSupport(ok, text) {
  const li = document.createElement('li');
  li.className = ok ? 'ok' : 'ko';
  li.textContent = text;
  supportEl.append(li);
}

async function checkSupport() {
  addSupport(window.isSecureContext, `Secure context (HTTPS or localhost)`);
  if (!navigator.xr) {
    addSupport(false, 'WebXR not available in this browser');
    return;
  }
  addSupport(true, 'WebXR available');
  const ar = await navigator.xr.isSessionSupported('immersive-ar');
  addSupport(ar, 'immersive-ar sessions');
  if (ar) startBtn.disabled = false;
}

async function start() {
  const session = await navigator.xr.requestSession('immersive-ar', {
    requiredFeatures: ['local'],
    optionalFeatures: ['depth-sensing', 'dom-overlay'],
    depthSensing: {
      usagePreference: ['cpu-optimized'],
      dataFormatPreference: ['luminance-alpha', 'float32'],
    },
    domOverlay: { root: overlay },
  });
  state.session = session;

  const gl = document.createElement('canvas').getContext('webgl', { xrCompatible: true });
  state.gl = gl;
  await session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });
  state.refSpace = await session.requestReferenceSpace('local');

  state.points = [];
  state.pendingTap = null;
  overlay.classList.add('on');
  resize();

  session.addEventListener('end', () => {
    overlay.classList.remove('on');
    state.session = null;
  });
  session.requestAnimationFrame(onFrame);
}

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

// normalized view coords (0..1, origin top-left) + depth -> world point
function unproject(view, u, v, d) {
  const p = view.projectionMatrix;
  const ndcX = 2 * u - 1;
  const ndcY = 1 - 2 * v;
  const x = (d * (ndcX + p[8])) / p[0];
  const y = (d * (ndcY + p[9])) / p[5];
  const [wx, wy, wz] = mulPoint(view.transform.matrix, [x, y, -d]);
  return [wx, wy, wz];
}

function project(view, world) {
  const viewPt = mulPoint(view.transform.inverse.matrix, world);
  const c = mulPoint(view.projectionMatrix, viewPt.slice(0, 3));
  if (c[3] <= 0) return null;
  return [((c[0] / c[3] + 1) / 2) * canvas.width, ((1 - c[1] / c[3]) / 2) * canvas.height];
}

function sampleDepth(depthInfo, u, v) {
  const d = depthInfo.getDepthInMeters(u, v);
  return d > 0 ? d : 0;
}

function tapDepth(depthInfo, u, v) {
  const vals = [];
  for (let i = -TAP_SAMPLES; i <= TAP_SAMPLES; i++) {
    for (let j = -TAP_SAMPLES; j <= TAP_SAMPLES; j++) {
      const du = Math.min(1, Math.max(0, u + i * TAP_STEP));
      const dv = Math.min(1, Math.max(0, v + j * TAP_STEP));
      const d = sampleDepth(depthInfo, du, dv);
      if (d) vals.push(d);
    }
  }
  return vals.length ? median(vals) : 0;
}

function onFrame(_t, frame) {
  const session = frame.session;
  session.requestAnimationFrame(onFrame);

  // keep the XR layer valid and transparent so the camera feed shows through
  const layer = session.renderState.baseLayer;
  state.gl.bindFramebuffer(state.gl.FRAMEBUFFER, layer.framebuffer);
  state.gl.clearColor(0, 0, 0, 0);
  state.gl.clear(state.gl.COLOR_BUFFER_BIT | state.gl.DEPTH_BUFFER_BIT);

  const pose = frame.getViewerPose(state.refSpace);
  if (!pose || !pose.views.length) return;
  const view = pose.views[0];

  let depthInfo = null;
  try {
    depthInfo = frame.getDepthInformation(view);
  } catch (e) {
    depthInfo = null;
  }
  state.depthInfo = depthInfo;
  state.frameCount++;
  state.centerPoint = null;

  if (depthInfo) {
    if (state.frameCount % 3 === 0) sampleGrid(depthInfo);
    state.centerDepth = tapDepth(depthInfo, 0.5, 0.5);
    if (state.centerDepth) state.centerPoint = unproject(view, 0.5, 0.5, state.centerDepth);
  }

  if (state.pendingTap && depthInfo) {
    handleTap(view, depthInfo, state.pendingTap);
    state.pendingTap = null;
  }

  draw(view);
  updateHud(session, depthInfo);
}

function sampleGrid(depthInfo) {
  const grid = [];
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      grid.push(sampleDepth(depthInfo, (c + 0.5) / GRID_COLS, (r + 0.5) / GRID_ROWS));
    }
  }
  state.depthGrid = grid;
}

function handleTap(view, depthInfo, tap) {
  const d = tapDepth(depthInfo, tap.u, tap.v);
  if (!d) {
    flash('No depth at that point, try a more textured spot');
    return;
  }
  if (state.points.length % 2 === 0 && state.points.length > 0) {
    // third tap starts a new measurement
    state.points = [];
  }
  state.points.push(unproject(view, tap.u, tap.v, d));
  if (state.points.length === 2) {
    const m = dist(state.points[0], state.points[1]);
    state.log.push(m);
    resultsEl.textContent = state.log.map((v, i) => `#${i + 1}: ${(v * 100).toFixed(1)} cm`).join('\n');
  }
}

let flashText = '';
let flashUntil = 0;
function flash(text) {
  flashText = text;
  flashUntil = performance.now() + 2000;
}

function draw(view) {
  const w = canvas.width;
  const h = canvas.height;
  ctx2d.clearRect(0, 0, w, h);

  if (state.showDepth && state.depthGrid.length) {
    const cw = w / GRID_COLS;
    const ch = h / GRID_ROWS;
    for (let i = 0; i < state.depthGrid.length; i++) {
      const d = state.depthGrid[i];
      if (!d) continue;
      const hue = 240 - Math.min(d / MAX_DEPTH, 1) * 240; // blue near ... red far
      ctx2d.fillStyle = `hsla(${hue}, 90%, 50%, 0.35)`;
      ctx2d.fillRect((i % GRID_COLS) * cw, Math.floor(i / GRID_COLS) * ch, cw, ch);
    }
  }

  // with one point placed, preview the segment to whatever is under the crosshair
  const preview = state.points.length === 1 && state.centerPoint;
  const pts = preview ? [state.points[0], state.centerPoint] : state.points;
  const screen = pts.map((p) => project(view, p));
  ctx2d.lineWidth = 3;
  ctx2d.strokeStyle = '#facc15';
  ctx2d.fillStyle = '#facc15';
  if (screen.length >= 2 && screen[0] && screen[1]) {
    ctx2d.beginPath();
    ctx2d.moveTo(...screen[0]);
    ctx2d.lineTo(...screen[1]);
    ctx2d.stroke();
    const m = dist(pts[0], pts[1]);
    ctx2d.font = 'bold 22px system-ui';
    ctx2d.lineWidth = 4;
    ctx2d.strokeStyle = '#000';
    const label = `${(m * 100).toFixed(1)} cm`;
    const mx = (screen[0][0] + screen[1][0]) / 2;
    const my = (screen[0][1] + screen[1][1]) / 2 - 12;
    ctx2d.strokeText(label, mx, my);
    ctx2d.fillText(label, mx, my);
  }
  for (const s of screen) {
    if (!s) continue;
    ctx2d.beginPath();
    ctx2d.arc(s[0], s[1], 7, 0, Math.PI * 2);
    ctx2d.fill();
  }
}

function updateHud(session, depthInfo) {
  const lines = [];
  if (!session.depthUsage) {
    lines.push('Depth sensing NOT granted by this device/browser');
  } else if (!depthInfo) {
    lines.push('Depth granted, waiting for first frame... move the phone');
  } else {
    lines.push(
      `Depth ${depthInfo.width}x${depthInfo.height} · ${session.depthDataFormat} · ` +
        `centre ${state.centerDepth ? state.centerDepth.toFixed(2) + ' m' : 'no data'}`
    );
  }
  if (performance.now() < flashUntil) lines.push(flashText);
  else lines.push(state.points.length === 1 ? 'Aim at the second point, then tap' : 'Aim the crosshair, then tap to add a point');
  hud.textContent = lines.join('\n');
}

// points are always placed at the screen centre (under the crosshair), not at the finger
const placeAtCentre = () => {
  state.pendingTap = { u: 0.5, v: 0.5 };
};
canvas.addEventListener('pointerup', placeAtCentre);
$('add').addEventListener('click', placeAtCentre);
// keep taps on the buttons from also triggering XR select events
overlay.addEventListener('beforexrselect', (e) => e.preventDefault());

$('toggleDepth').addEventListener('click', (e) => {
  state.showDepth = !state.showDepth;
  e.target.textContent = `Depth: ${state.showDepth ? 'on' : 'off'}`;
});
$('reset').addEventListener('click', () => {
  state.points = [];
});
$('exit').addEventListener('click', () => state.session?.end());
window.addEventListener('resize', resize);
startBtn.addEventListener('click', () => start().catch((e) => addSupport(false, `Start failed: ${e.message}`)));

checkSupport();

import './styles.css';
import {
  Opening,
  Plan,
  Vec,
  addPoint,
  clearDistance,
  cornerNeighbours,
  dist,
  emptyPlan,
  newId,
  findDistance,
  findRightAngle,
  parse,
  pointById,
  removePoint,
  serialize,
  setDistance,
  toggleRightAngle,
} from './model';
import { driveEnabled, loadFromDrive, saveToDrive } from './drive';
import { downloadScan, hasScanData, missingForScan, startScan } from './scan';
import { History } from './history';
import { applyJoins, deleteRoom, insideRoom, joinDoors, joinOf, openingFrame, pruneJoins, roomArea, roomComponents, roomIdsOf, roomLoop, unjoin } from './rooms';
import { SolveResult, apply, solve } from './solver';
import { load, save } from './storage';

const POINT_HIT = 12; // px, with a mouse
const WALL_HIT = 8; // px, with a mouse
const TOUCH_HIT = 2.2; // fingers are less precise: hit areas grow by this much
const OPENING_PX = 7; // drawn wall thickness at a door or window
const NEW_WIDTH = { door: 0.8, window: 1.0 }; // metres, for doors and windows added by hand

type Selection =
  | { kind: 'point'; id: string }
  | { kind: 'wall'; a: string; b: string }
  | { kind: 'opening'; id: string }
  | { kind: 'room'; id: string }
  | null;
type Tool = 'wall' | 'door' | 'window' | null;
type Drag =
  | { kind: 'point'; id: string; moved: boolean }
  | { kind: 'pan'; x: number; y: number; moved: boolean }
  | { kind: 'pinch'; d: number; mid: Vec }
  | null;

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = el<HTMLCanvasElement>('canvas');
const ctx = canvas.getContext('2d')!;
const sheet = el('sheet');

let plan: Plan = load();
plan.furniture = []; // furniture is shelved for now: drop boxes older scans added
let view = { scale: 80, ox: 40, oy: 40 };
let selection: Selection = null;
let drag: Drag = null;
let tool: Tool = null;
/** With the wall tool: the corner the next wall starts from. */
let wallFrom: string | null = null;
let cursor: Vec = { x: 0, y: 0 };
let lastSolve: SolveResult | null = null;
/** Wall length labels as drawn, so tapping a number edits that wall. */
let labelBoxes: { a: string; b: string; x: number; y: number; w: number; h: number }[] = [];
/** Door being joined: the next door tapped, in another room, is moved onto it. */
let joinFrom: string | null = null;
/** Fingers or the mouse currently down, for pinch zoom. */
const pointers = new Map<number, Vec>();

// ---------- coordinates ----------

const toScreen = (p: Vec): Vec => ({ x: view.ox + p.x * view.scale, y: view.oy + p.y * view.scale });
const toWorld = (sx: number, sy: number): Vec => ({ x: (sx - view.ox) / view.scale, y: (sy - view.oy) / view.scale });

function fit(): void {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!plan.points.length) {
    view = { scale: 80, ox: 40, oy: 40 };
    return;
  }
  const xs = plan.points.map((p) => p.x);
  const ys = plan.points.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const bw = Math.max(Math.max(...xs) - minX, 0.5);
  const bh = Math.max(Math.max(...ys) - minY, 0.5);
  const scale = Math.min((w - 200) / bw, (h - 200) / bh, 200); // room for labels outside the walls
  view = { scale, ox: (w - bw * scale) / 2 - minX * scale, oy: (h - bh * scale) / 2 - minY * scale };
}

// ---------- solving ----------

const history = new History();

/** Persist the plan and record an undo step if it changed. */
function commit(): void {
  save(plan);
  history.record(JSON.stringify(plan));
  el<HTMLButtonElement>('undo').disabled = !history.canUndo;
  el<HTMLButtonElement>('redo').disabled = !history.canRedo;
}

function restore(snapshot: string | undefined): void {
  if (snapshot === undefined) return;
  plan = parse(snapshot);
  selection = null;
  lastSolve = plan.points.length ? solve(plan) : null;
  save(plan);
  el<HTMLButtonElement>('undo').disabled = !history.canUndo;
  el<HTMLButtonElement>('redo').disabled = !history.canRedo;
  closeSheet();
  render();
  renderUi();
}

function resolve(): void {
  if (plan.points.length) {
    lastSolve = solve(plan);
    apply(plan, lastSolve);
    pruneJoins(plan);
    applyJoins(plan);
  } else {
    lastSolve = null;
  }
  commit();
  render();
  renderUi();
}

// ---------- hit testing ----------

function hitPoint(sx: number, sy: number, tol: number): string | undefined {
  let best: string | undefined;
  let bestD = POINT_HIT * tol;
  for (const p of plan.points) {
    const s = toScreen(p);
    const d = Math.hypot(s.x - sx, s.y - sy);
    if (d <= bestD) {
      best = p.id;
      bestD = d;
    }
  }
  return best;
}

function segDist(px: number, py: number, a: Vec, b: Vec): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

function hitWall(sx: number, sy: number, tol: number): { a: string; b: string } | undefined {
  const label = labelBoxes.find((l) => Math.abs(sx - l.x) <= l.w / 2 + 4 && Math.abs(sy - l.y) <= l.h / 2 + 4);
  if (label) return label;
  let best: { a: string; b: string } | undefined;
  let bestD = WALL_HIT * tol;
  for (const w of plan.walls) {
    const a = pointById(plan, w.a);
    const b = pointById(plan, w.b);
    if (!a || !b) continue;
    const d = segDist(sx, sy, toScreen(a), toScreen(b));
    if (d <= bestD) {
      best = w;
      bestD = d;
    }
  }
  return best;
}

function hitOpening(sx: number, sy: number, tol: number): string | undefined {
  for (const o of plan.openings) {
    const g = openingGeometry(o);
    if (g && segDist(sx, sy, toScreen(g.p1), toScreen(g.p2)) <= WALL_HIT * tol) return o.id;
  }
  return undefined;
}

// ---------- geometry ----------

const openingGeometry = (o: Opening) => openingFrame(plan, o);

// ---------- rendering ----------

function resizeCanvas(): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/** Draws a text label with a dark backing and returns its size. */
function label(text: string, at: Vec, color: string, bold: boolean): { w: number; h: number } {
  ctx.font = `${bold ? 'bold ' : ''}13px system-ui, sans-serif`;
  const w = ctx.measureText(text).width + 8;
  ctx.fillStyle = '#14161acc';
  ctx.fillRect(at.x - w / 2, at.y - 9, w, 18);
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, at.x, at.y);
  return { w, h: 18 };
}

function drawGrid(): void {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const tl = toWorld(0, 0);
  const br = toWorld(w, h);
  ctx.strokeStyle = '#20242b';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = Math.floor(tl.x); x <= br.x; x++) {
    const s = toScreen({ x, y: 0 }).x;
    ctx.moveTo(s, 0);
    ctx.lineTo(s, h);
  }
  for (let y = Math.floor(tl.y); y <= br.y; y++) {
    const s = toScreen({ x: 0, y }).y;
    ctx.moveTo(0, s);
    ctx.lineTo(w, s);
  }
  ctx.stroke();
}

const line = (a: Vec, b: Vec): void => {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
};

/**
 * Doors and windows the way plans draw them: the wall is cut, a door shows
 * its leaf open at 90 degrees and the arc it swings through, a window shows
 * thin lines across the opening.
 */
function drawOpening(o: Opening): void {
  const g = openingGeometry(o);
  if (!g) return;
  const s1 = toScreen(g.p1);
  const s2 = toScreen(g.p2);
  const selected = (selection?.kind === 'opening' && selection.id === o.id) || joinFrom === o.id;
  const color = selected ? '#60a5fa' : joinOf(plan, o.id) ? '#c084fc' : '#e6e8eb';
  const t = OPENING_PX / 2;
  const n = g.n; // screen and plan axes point the same way, so world directions work on screen

  // cut the wall
  ctx.lineCap = 'butt';
  ctx.strokeStyle = '#14161a';
  ctx.lineWidth = OPENING_PX + 2;
  line(s1, s2);

  ctx.strokeStyle = color;
  ctx.lineWidth = selected ? 2.5 : 1.5;
  // jambs
  for (const s of [s1, s2]) line({ x: s.x - n.x * t, y: s.y - n.y * t }, { x: s.x + n.x * t, y: s.y + n.y * t });

  if (o.type === 'window') {
    for (const k of [-t, 0, t]) line({ x: s1.x + n.x * k, y: s1.y + n.y * k }, { x: s2.x + n.x * k, y: s2.y + n.y * k });
    return;
  }
  // door: leaf hinged at one end, open into the room (or out of it), and its swing
  const hinge = o.hingeAtB ? s2 : s1;
  const closed = o.hingeAtB ? { x: -g.u.x, y: -g.u.y } : g.u; // from the hinge along the closed door
  const open = o.outward ? { x: -n.x, y: -n.y } : n;
  const r = o.width * view.scale;
  const leaf = { x: hinge.x + open.x * r, y: hinge.y + open.y * r };
  ctx.lineWidth = selected ? 3 : 2;
  line(hinge, leaf);
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  const from = Math.atan2(open.y, open.x);
  const to = Math.atan2(closed.y, closed.x);
  let sweep = to - from;
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  while (sweep < -Math.PI) sweep += 2 * Math.PI;
  ctx.beginPath();
  ctx.arc(hinge.x, hinge.y, r, from, to, sweep < 0);
  ctx.stroke();
  ctx.setLineDash([]);
}

/** The width, in cm, on the room side of the opening: bold green once typed in, "~" while estimated. */
function drawOpeningLabel(o: Opening): void {
  const g = openingGeometry(o);
  if (!g) return;
  const s1 = toScreen(g.p1);
  const s2 = toScreen(g.p2);
  if (Math.hypot(s2.x - s1.x, s2.y - s1.y) < 30) return; // too small to fit a label
  const m = o.measured === true;
  const at = { x: (s1.x + s2.x) / 2 + g.n.x * 14, y: (s1.y + s2.y) / 2 + g.n.y * 14 };
  label(`${m ? '' : '~'}${(o.width * 100).toFixed(0)}`, at, m ? '#4ade80' : '#c3c9d2', m);
}

function render(): void {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  ctx.clearRect(0, 0, w, h);
  drawGrid();

  // the selected room
  if (selection?.kind === 'room') {
    const loop = roomLoop(plan, roomIdsOf(plan, selection.id));
    if (loop) {
      ctx.fillStyle = '#60a5fa22';
      ctx.beginPath();
      loop.forEach((id, i) => {
        const s = toScreen(pointById(plan, id)!);
        if (i) ctx.lineTo(s.x, s.y);
        else ctx.moveTo(s.x, s.y);
      });
      ctx.closePath();
      ctx.fill();
    }
  }

  // walls
  ctx.lineCap = 'round';
  for (const wall of plan.walls) {
    const a = pointById(plan, wall.a);
    const b = pointById(plan, wall.b);
    if (!a || !b) continue;
    const measured = findDistance(plan, wall.a, wall.b) !== undefined;
    const selected = (selection?.kind === 'wall' && ((selection.a === wall.a && selection.b === wall.b) || (selection.a === wall.b && selection.b === wall.a))) || (selection?.kind === 'room' && roomIdsOf(plan, selection.id).has(wall.a));
    ctx.lineWidth = selected ? 5 : measured ? 4 : 3;
    ctx.strokeStyle = selected ? '#60a5fa' : measured ? '#4ade80' : '#9aa3b0';
    ctx.setLineDash(measured ? [] : [8, 5]);
    line(toScreen(a), toScreen(b));
    ctx.setLineDash([]);
  }

  for (const o of plan.openings) drawOpening(o);
  for (const o of plan.openings) drawOpeningLabel(o);

  // wall lengths, over the openings, and remembered for tapping
  labelBoxes = [];
  for (const wall of plan.walls) {
    const a = pointById(plan, wall.a);
    const b = pointById(plan, wall.b);
    if (!a || !b) continue;
    const measured = findDistance(plan, wall.a, wall.b) !== undefined;
    const text = `${measured ? '' : '~'}${(dist(a, b) * 100).toFixed(0)} cm`;
    // outside the room, clear of doors and windows drawn on the wall
    const u = unit(sub(b, a));
    let n = { x: -u.y, y: u.x };
    if (insideRoom(plan, roomIdsOf(plan, wall.a), { x: (a.x + b.x) / 2 + n.x * 0.05, y: (a.y + b.y) / 2 + n.y * 0.05 })) n = { x: -n.x, y: -n.y };
    ctx.font = `${measured ? 'bold ' : ''}13px system-ui, sans-serif`;
    const away = Math.abs(n.x) * (ctx.measureText(text).width / 2 + 10) + Math.abs(n.y) * 15;
    const at = { x: (toScreen(a).x + toScreen(b).x) / 2 + n.x * away, y: (toScreen(a).y + toScreen(b).y) / 2 + n.y * away };
    const size = label(text, at, measured ? '#4ade80' : '#c3c9d2', measured);
    labelBoxes.push({ a: wall.a, b: wall.b, ...at, ...size });
  }

  // right-angle markers
  ctx.strokeStyle = '#4ade80';
  ctx.lineWidth = 2;
  ctx.lineCap = 'butt';
  for (const p of plan.points) {
    if (!findRightAngle(plan, p.id)) continue;
    const n = cornerNeighbours(plan, p.id);
    if (!n) continue;
    const a = pointById(plan, n[0]);
    const c = pointById(plan, n[1]);
    if (!a || !c) continue;
    const sp = toScreen(p);
    const ua = unit(sub(toScreen(a), sp));
    const uc = unit(sub(toScreen(c), sp));
    const s = 14;
    ctx.beginPath();
    ctx.moveTo(sp.x + ua.x * s, sp.y + ua.y * s);
    ctx.lineTo(sp.x + (ua.x + uc.x) * s, sp.y + (ua.y + uc.y) * s);
    ctx.lineTo(sp.x + uc.x * s, sp.y + uc.y * s);
    ctx.stroke();
  }

  // the wall being drawn, from its first corner to the finger
  if (wallFrom) {
    const last = pointById(plan, wallFrom)!;
    const sl = toScreen(last);
    const sc = toScreen(cursor);
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = '#60a5fa';
    ctx.lineWidth = 2;
    line(sl, sc);
    ctx.setLineDash([]);
    label(`${(dist(last, cursor) * 100).toFixed(0)} cm`, { x: (sl.x + sc.x) / 2, y: (sl.y + sc.y) / 2 }, '#60a5fa', false);
  }

  // points
  for (const p of plan.points) {
    const s = toScreen(p);
    const selected = selection?.kind === 'point' && selection.id === p.id;
    ctx.fillStyle = selected ? '#60a5fa' : '#e6e8eb';
    ctx.beginPath();
    ctx.arc(s.x, s.y, selected ? 7 : 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const unit = (v: Vec): Vec => {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
};

// ---------- bottom sheet and the rest of the UI ----------

const head = (title: string, detail = '') =>
  `<div class="head"><b>${title}</b><span class="muted">${detail}</span><button class="close" id="close" aria-label="Close">×</button></div>`;

/**
 * A number field in cm with an OK button; `onSet` gets metres. It is a form,
 * so the keyboard's Done/Enter submits it. Tapping OK must not take the focus
 * first: on a phone the keyboard would close, the sheet would slide down,
 * and the tap would land on nothing.
 */
function numberRow(value: number | undefined, placeholder: number, onSet: (m: number) => void): string {
  queueMicrotask(() => {
    const input = el<HTMLInputElement>('num');
    el('numForm').onsubmit = (e) => {
      e.preventDefault();
      const cm = parseFloat(input.value.replace(',', '.'));
      if (cm > 0) onSet(cm / 100);
    };
    el('numOk').onmousedown = (e) => e.preventDefault();
    el('numOk').onpointerdown = (e) => e.preventDefault();
    input.focus();
    input.select();
  });
  return `<form id="numForm" class="row"><label class="num"><input id="num" type="text" inputmode="decimal" enterkeyhint="done" autocomplete="off" placeholder="${placeholder.toFixed(0)}" value="${value !== undefined ? +(value * 100).toFixed(1) : ''}"> cm</label><button id="numOk" class="primary">OK</button></form>`;
}

function renderUi(): void {
  // only rebuild the sheet when what it shows changed, so typing is not interrupted
  const key = JSON.stringify(selection);
  if (sheet.dataset.key !== key) {
    sheet.dataset.key = key;
    renderSheet();
  }
  el('empty').hidden = plan.points.length > 0 || tool !== null;
  el('scan').hidden = !sheet.hidden || tool !== null;
  for (const t of ['wall', 'door', 'window'] as const) el(`tool-${t}`).classList.toggle('on', tool === t);

  // one line at the top: what the tool expects, or measurements that disagree
  const conflicts = (lastSolve?.conflicts ?? []).filter((c) => c.constraint.type === 'distance');
  const info = el('info');
  info.classList.toggle('warn', !tool);
  info.textContent =
    tool === 'wall'
      ? wallFrom
        ? 'Tap the next corner. Tap the last corner again, or an existing corner, to stop.'
        : 'Tap where the wall starts (tap a corner to start from it).'
      : tool
        ? `Tap the wall where the ${tool} goes.`
        : conflicts.length
          ? `Measurements disagree: ${conflicts
              .map((c) => (c.constraint.type === 'distance' ? `${(c.constraint.value * 100).toFixed(0)} cm wall is ${(c.error * 100).toFixed(1)} cm off` : ''))
              .join(', ')}`
          : '';
  info.hidden = !info.textContent;
}

function renderSheet(): void {
  sheet.hidden = false;
  const sel = selection;
  if (sel?.kind === 'wall') {
    const a = pointById(plan, sel.a);
    const b = pointById(plan, sel.b);
    if (!a || !b) return closeSheet();
    const measured = findDistance(plan, sel.a, sel.b);
    sheet.innerHTML =
      head('Wall length', measured !== undefined ? '<span class="ok">measured</span>' : `estimated ${(dist(a, b) * 100).toFixed(0)} cm`) +
      numberRow(measured, dist(a, b) * 100, (m) => {
        setDistance(plan, sel.a, sel.b, m);
        closeSheet();
        resolve();
      }) +
      (measured !== undefined ? `<div class="row"><button id="clearLen" class="link">Forget this measurement</button></div>` : '');
    if (measured !== undefined) {
      el('clearLen').onclick = () => {
        clearDistance(plan, sel.a, sel.b);
        closeSheet();
        resolve();
      };
    }
  } else if (sel?.kind === 'opening') {
    const o = plan.openings.find((x) => x.id === sel.id);
    if (!o) return closeSheet();
    sheet.innerHTML =
      head(o.type === 'door' ? 'Door' : 'Window', o.measured ? '<span class="ok">width measured</span>' : `width estimated ${(o.width * 100).toFixed(0)} cm`) +
      numberRow(o.width, o.width * 100, (m) => {
        // keep it centred where it was
        o.at = Math.max(0, o.at + (o.width - m) / 2);
        o.width = m;
        o.measured = true;
        commit();
        closeSheet();
        render();
      }) +
      `<div class="row">` +
      (o.type === 'door'
        ? `<button id="flipHinge" class="icon" title="Hinge on the other side"><svg viewBox="0 0 24 24"><path d="M3 20h18M5 20V8"/><path d="M5 8a12 12 0 0 1 12 12" stroke-dasharray="2 2.2"/><path d="M13 4h8m-2-2 2 2-2 2M21 9h-8m2-2-2 2 2 2"/></svg>Hinge side</button>` +
          `<button id="flipSwing" class="icon" title="Swing ${o.outward ? 'into' : 'out of'} the room"><svg viewBox="0 0 24 24"><path d="M2 12h20M6 12V3M6 12v9"/><path d="M6 3a9 9 0 0 1 9 9" stroke-dasharray="2 2.2"/><path d="M6 21a9 9 0 0 0 9-9" stroke-dasharray="2 2.2"/></svg>Swing ${o.outward ? 'in' : 'out'}</button>`
        : '') +
      (o.type === 'door'
        ? joinOf(plan, o.id)
          ? `<button id="unjoin" class="icon" title="Unjoin from the other room"><svg viewBox="0 0 24 24"><path d="M9 15 6.5 17.5a3.5 3.5 0 0 1-5-5L4 10M15 9l2.5-2.5a3.5 3.5 0 0 1 5 5L20 14M9 9 7 7M15 15l2 2M12 3v2M3 12h2"/></svg>Unjoin</button>`
          : `<button id="join" class="icon" title="Join to the same door in another room"><svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>Join rooms</button>`
        : '') +
      `<button id="delO" class="icon danger" title="Delete"><svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>Delete</button>` +
      `</div>`;
    const flip = (key: 'hingeAtB' | 'outward') => {
      o[key] = !o[key] || undefined;
      commit();
      sheet.dataset.key = '';
      render();
      renderUi();
    };
    if (o.type === 'door') {
      el('flipHinge').onclick = () => flip('hingeAtB');
      el('flipSwing').onclick = () => flip('outward');
    }
    if (o.type === 'door') {
      if (joinOf(plan, o.id)) {
        el('unjoin').onclick = () => {
          unjoin(plan, o.id);
          sheet.dataset.key = '';
          resolve();
        };
      } else {
        el('join').onclick = () => {
          joinFrom = o.id;
          closeSheet();
          showScanMsg('Now tap the same door in the other room. Tap anywhere else to cancel.');
          render();
        };
      }
    }
    el('delO').onclick = () => {
      if (!confirm(`Delete this ${o.type}?`)) return;
      plan.openings = plan.openings.filter((x) => x.id !== sel.id);
      closeSheet();
      resolve();
    };
  } else if (sel?.kind === 'room') {
    const ids = roomIdsOf(plan, sel.id);
    if (ids.size < 3) return closeSheet();
    const area = roomArea(plan, ids);
    const doors = plan.openings.filter((o) => ids.has(o.a)).length;
    sheet.innerHTML =
      head('Room', `${area !== null ? `${area.toFixed(1)} m² · ` : ''}${ids.size} corners · ${doors} door/window${doors === 1 ? '' : 's'}`) +
      `<div class="row"><button id="delRoom" class="icon danger" title="Delete this room"><svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>Delete room</button></div>`;
    el('delRoom').onclick = () => {
      if (!confirm('Delete this whole room, with its walls, doors and windows?')) return;
      deleteRoom(plan, sel.id);
      closeSheet();
      resolve();
    };
  } else if (sel?.kind === 'point') {
    const canSquare = cornerNeighbours(plan, sel.id) !== undefined;
    const square = findRightAngle(plan, sel.id);
    sheet.innerHTML =
      head('Corner', 'drag to move') +
      `<div class="row"><button id="angle" ${canSquare ? '' : 'disabled'} class="${square ? 'on' : ''}">${square ? 'Right angle ✓' : 'Make it a right angle'}</button></div>` +
      `<div class="row"><button id="del" class="link danger">Delete corner</button></div>`;
    el('angle').onclick = () => {
      toggleRightAngle(plan, sel.id);
      sheet.dataset.key = '';
      resolve();
    };
    el('del').onclick = () => {
      if (!confirm('Delete this corner and the walls on it?')) return;
      removePoint(plan, sel.id);
      closeSheet();
      resolve();
    };
  } else {
    sheet.hidden = true;
    sheet.innerHTML = '';
    return;
  }
  el('close').onclick = () => {
    closeSheet();
    render();
  };
}

function closeSheet(): void {
  selection = null;
  renderUi();
}

// ---------- interaction ----------

function eventPos(e: PointerEvent | WheelEvent): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

const hasWall = (id: string) => plan.walls.some((w) => w.a === id || w.b === id);

/** Ends the wall being drawn; a lone first corner with no wall yet goes away. */
function stopWall(): void {
  if (wallFrom && !hasWall(wallFrom)) removePoint(plan, wallFrom);
  wallFrom = null;
}

function setTool(t: Tool): void {
  stopWall();
  tool = t;
  selection = null;
  resolve();
}

/** Wall tool: each tap is a corner; walls join consecutive taps. */
function wallTap(pos: Vec, tol: number): void {
  const hit = hitPoint(pos.x, pos.y, tol);
  if (hit && hit === wallFrom) {
    stopWall();
  } else {
    const id = hit ?? addPoint(plan, toWorld(pos.x, pos.y)).id;
    if (!wallFrom) {
      wallFrom = id;
    } else {
      if (!plan.walls.some((w) => (w.a === wallFrom && w.b === id) || (w.a === id && w.b === wallFrom))) plan.walls.push({ a: wallFrom, b: id });
      // ending on a corner that already had walls closes the shape
      wallFrom = hit && plan.walls.filter((w) => w.a === id || w.b === id).length > 1 ? null : id;
    }
  }
  resolve();
}

/** Door and window tools: put one, centred where the wall was tapped, then show it for its width. */
function openingTap(pos: Vec, tol: number): void {
  const w = hitWall(pos.x, pos.y, tol);
  const a = w && pointById(plan, w.a);
  const b = w && pointById(plan, w.b);
  if (!w || !a || !b || (tool !== 'door' && tool !== 'window')) return;
  const len = dist(a, b);
  const p = toWorld(pos.x, pos.y);
  const along = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (len || 1);
  const width = Math.min(NEW_WIDTH[tool], len);
  const o: Opening = { id: newId(), type: tool, a: w.a, b: w.b, at: Math.max(0, Math.min(len - width, along - width / 2)), width };
  plan.openings.push(o);
  tool = null;
  selection = { kind: 'opening', id: o.id };
  commit();
  render();
  renderUi();
}

function zoomAt(at: Vec, factor: number): void {
  const before = toWorld(at.x, at.y);
  view.scale = Math.max(10, Math.min(500, view.scale * factor));
  view.ox = at.x - before.x * view.scale;
  view.oy = at.y - before.y * view.scale;
}

function pinchState(): { d: number; mid: Vec } {
  const [a, b] = [...pointers.values()];
  return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
}

let selectionBeforeTouch: Selection = null;

canvas.addEventListener('pointerdown', (e) => {
  const pos = eventPos(e);
  pointers.set(e.pointerId, pos);
  canvas.setPointerCapture(e.pointerId);
  e.preventDefault(); // no emulated mouse events: they would move the focus away from the number field
  el('menu').hidden = true;

  // a second finger turns whatever the first one started into a pinch
  if (pointers.size === 2) {
    if (drag?.kind === 'point' && drag.moved) resolve();
    selection = selectionBeforeTouch;
    drag = { kind: 'pinch', ...pinchState() };
    render();
    renderUi();
    return;
  }
  if (pointers.size > 2) return;

  cursor = toWorld(pos.x, pos.y);
  const tol = e.pointerType === 'touch' ? TOUCH_HIT : 1;
  selectionBeforeTouch = selection;

  if (joinFrom) {
    const target = hitOpening(pos.x, pos.y, tol);
    if (target) return joinTap(target);
    joinFrom = null;
    showScanMsg(null);
  }

  if (tool === 'wall') return wallTap(pos, tol);
  if (tool) return openingTap(pos, tol);

  const pid = hitPoint(pos.x, pos.y, tol);
  const oid = pid ? undefined : hitOpening(pos.x, pos.y, tol);
  const w = pid || oid ? undefined : hitWall(pos.x, pos.y, tol);
  if (pid) {
    selection = { kind: 'point', id: pid };
    drag = { kind: 'point', id: pid, moved: false };
  } else if (oid) {
    selection = { kind: 'opening', id: oid };
  } else if (w) {
    selection = { kind: 'wall', a: w.a, b: w.b };
  } else {
    selection = null;
    drag = { kind: 'pan', x: pos.x, y: pos.y, moved: false };
  }
  render();
  renderUi();
});

canvas.addEventListener('pointermove', (e) => {
  const pos = eventPos(e);
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, pos);
  cursor = toWorld(pos.x, pos.y);
  if (drag?.kind === 'pinch') {
    if (pointers.size < 2) return;
    const now = pinchState();
    zoomAt(drag.mid, now.d / drag.d);
    view.ox += now.mid.x - drag.mid.x;
    view.oy += now.mid.y - drag.mid.y;
    drag = { kind: 'pinch', ...now };
    render();
  } else if (drag?.kind === 'point') {
    const p = pointById(plan, drag.id);
    if (p) {
      p.x = cursor.x;
      p.y = cursor.y;
      p.sensor = { x: cursor.x, y: cursor.y };
      drag.moved = true;
    }
    render();
  } else if (drag?.kind === 'pan') {
    if (Math.hypot(pos.x - drag.x, pos.y - drag.y) > 3) drag.moved = true;
    view.ox += pos.x - drag.x;
    view.oy += pos.y - drag.y;
    drag.x = pos.x;
    drag.y = pos.y;
    render();
  } else if (wallFrom) {
    render();
  }
});

const pointerEnd = (e: PointerEvent) => {
  pointers.delete(e.pointerId);
  if (drag?.kind === 'pinch') {
    // lifting one finger of a pinch ends it; the other one does nothing until lifted
    if (!pointers.size) drag = null;
    return;
  }
  const moved = drag?.kind === 'point' && drag.moved;
  const tapped = drag?.kind === 'pan' && !drag.moved && e.type === 'pointerup';
  drag = null;
  if (moved) resolve();
  if (tapped) tapRoom(eventPos(e));
};

/** A tap on empty floor inside a room selects the room. */
function tapRoom(pos: Vec): void {
  const p = toWorld(pos.x, pos.y);
  const room = roomComponents(plan).find((ids) => ids.length >= 3 && insideRoom(plan, new Set(ids), p));
  if (!room) return;
  selection = { kind: 'room', id: room[0] };
  render();
  renderUi();
}

function joinTap(targetId: string): void {
  const from = joinFrom;
  joinFrom = null;
  if (!from) return;
  const error = joinDoors(plan, from, targetId);
  if (error) {
    showScanMsg(error);
    setTimeout(() => showScanMsg(null), 4000);
    render();
    return;
  }
  showScanMsg(null);
  selection = { kind: 'opening', id: from };
  sheet.dataset.key = '';
  fit();
  resolve();
}
canvas.addEventListener('pointerup', pointerEnd);
canvas.addEventListener('pointercancel', pointerEnd);

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    zoomAt(eventPos(e), Math.exp(-e.deltaY * 0.0015));
    render();
  },
  { passive: false }
);

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) {
    if (e.key === 'Escape') closeSheet();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    restore(e.shiftKey ? history.redo() : history.undo());
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    restore(history.redo());
    return;
  }
  if (e.key === 'Escape' && joinFrom) {
    joinFrom = null;
    showScanMsg(null);
    render();
  } else if (e.key === 'Escape' && tool) setTool(null);
  else if (e.key === 'Escape') closeSheet();
  if (e.key !== 'Delete' && e.key !== 'Backspace') return;
  const sel = selection;
  if (sel?.kind === 'point') removePoint(plan, sel.id);
  else if (sel?.kind === 'opening') plan.openings = plan.openings.filter((x) => x.id !== sel.id);
  else return;
  selection = null;
  resolve();
});

window.addEventListener('resize', () => {
  resizeCanvas();
  render();
});

// ---------- scan button ----------

// the AR session must be asked for inside the tap, so support is checked up front
const scanMissing = missingForScan();
const scanMsg = el('scanMsg');
const showScanMsg = (text: string | null) => {
  scanMsg.hidden = !text;
  scanMsg.textContent = text ?? '';
};

el('scan').onclick = async () => {
  const missing = await scanMissing;
  if (missing) return showScanMsg(missing);
  showScanMsg(null);
  try {
    await startScan((added) => {
      el('scanData').hidden = !hasScanData();
      if (!added) return;
      plan = load();
      selection = null;
      fit();
      resolve();
    });
  } catch (err) {
    showScanMsg((err as Error).message);
  }
};

// ---------- undo / redo ----------

el('undo').onclick = () => restore(history.undo());
el('redo').onclick = () => restore(history.redo());

// ---------- menu ----------

el('menuBtn').onclick = () => {
  el('menu').hidden = !el('menu').hidden;
};
// every menu entry closes the menu
el('menu').addEventListener('click', () => {
  el('menu').hidden = true;
});

el('scanData').onclick = downloadScan;

for (const t of ['wall', 'door', 'window'] as const) {
  el(`tool-${t}`).onclick = () => setTool(tool === t ? null : t);
}

el('fit').onclick = () => {
  fit();
  render();
};

el('square').onclick = () => {
  for (const p of plan.points) {
    if (cornerNeighbours(plan, p.id) && !findRightAngle(plan, p.id)) toggleRightAngle(plan, p.id);
  }
  resolve();
};

el('clear').onclick = () => {
  if (plan.points.length && !confirm('Clear the whole plan?')) return;
  plan = emptyPlan();
  selection = null;
  resolve();
};

el('export').onclick = () => {
  const url = URL.createObjectURL(new Blob([serialize(plan)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'plan3d.json';
  a.click();
  URL.revokeObjectURL(url);
};

el('import').onclick = () => el<HTMLInputElement>('file').click();
el<HTMLInputElement>('file').onchange = async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    plan = parse(await file.text());
    selection = null;
    fit();
    resolve();
  } catch (err) {
    alert(`Could not import: ${(err as Error).message}`);
  }
};

// ---------- google drive ----------

if (driveEnabled) {
  el('driveSave').hidden = false;
  el('driveLoad').hidden = false;
}

el('driveSave').onclick = async () => {
  try {
    showScanMsg('Saving to Google Drive…');
    await saveToDrive(serialize(plan));
    showScanMsg('Saved to Google Drive');
  } catch (err) {
    showScanMsg(`Could not save: ${(err as Error).message}`);
  }
  setTimeout(() => showScanMsg(null), 3000);
};

el('driveLoad').onclick = async () => {
  try {
    showScanMsg('Loading from Google Drive…');
    const text = await loadFromDrive();
    if (text === null) return showScanMsg('No plan saved in Google Drive yet');
    if (plan.points.length && !confirm('Replace the current plan with the one from Google Drive?')) {
      return showScanMsg(null);
    }
    plan = parse(text);
    selection = null;
    fit();
    resolve();
    showScanMsg(null);
  } catch (err) {
    showScanMsg(`Could not load: ${(err as Error).message}`);
  }
};

// ---------- start ----------

resizeCanvas();
fit();
resolve();
history.reset(JSON.stringify(plan));
el<HTMLButtonElement>('undo').disabled = true;
el<HTMLButtonElement>('redo').disabled = true;

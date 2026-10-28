import './styles.css';
import {
  Furniture,
  Opening,
  Plan,
  Stair,
  Vec,
  Wall,
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
  sameWall,
  removePoint,
  serialize,
  setDistance,
  WallTie,
  addWallTie,
  findAngle,
  PlanPoint,
  wallUnderCorner,
  removeWallTie,
  setAngle,
  toggleRightAngle,
  wallThickness,
  wallTies,
} from './model';
import { nameFromFile, planFileName, planToSvg, readPlanFile } from './planfile';
import { DriveFile, driveEnabled, loadFromDrive, pickerEnabled, pickFromDrive, saveToDrive } from './drive';
import { downloadScan, hasScanData, missingForScan, startScan } from './scan';
import { History } from './history';
import { applyJoins, deleteRoom, duplicateRoom, groupLoop, joinDoors, joinOf, joinWallEnds, loopArea, loopWalls, moveRoom, insideRoom, openingFrame, pruneJoins, roomAt, roomComponents, roomIdsOf, roomName, rooms, setRoomName, roomOutline, setWallThickness, unjoin } from './rooms';
import { SolveResult, apply, solve, wallKey } from './solver';
import { insideStair, newStair, stairAxes, stairCorners, stairPoint, stairTreads } from './stairs';
import { LIBRARY, furnitureIcon, furnitureItem, furniturePoint, insideFurniture, newFurniture, snapToWalls } from './furniture';
import { load, loadDriveFile, save, saveDriveFile } from './storage';

const POINT_HIT = 12; // px, with a mouse
const WALL_HIT = 8; // px, with a mouse
const TOUCH_HIT = 2.2; // fingers are less precise: hit areas grow by this much
const MIN_OPENING_PX = 5; // an opening is at least this deep on screen, even through a thin wall
const NEW_WIDTH = { door: 0.8, window: 1.0, part: 1.0 }; // metres, for doors, windows and wall parts added by hand

type Selection =
  | { kind: 'point'; id: string }
  | { kind: 'wall'; a: string; b: string }
  | { kind: 'opening'; id: string }
  /** A room: its corners in order round it. */
  | { kind: 'room'; loop: string[] }
  | { kind: 'stair'; id: string }
  | { kind: 'furniture'; id: string }
  | null;
type Tool = 'wall' | 'door' | 'window' | 'part' | 'stair' | 'furniture' | null;
type Drag =
  | { kind: 'point'; id: string; moved: boolean }
  | { kind: 'stair'; id: string; from: Vec; start: Vec; moved: boolean }
  /** `start`: where it stood (centre and angle), so snapping to walls does not build up while dragging. */
  | { kind: 'furniture'; id: string; from: Vec; start: { x: number; y: number; angle: number }; down: Vec; moved: boolean }
  /** `grab`: metres from the start of the opening to where it was picked up; `down`: there on screen. */
  | { kind: 'opening'; id: string; grab: number; down: Vec; moved: boolean }
  | { kind: 'pan'; x: number; y: number; moved: boolean }
  /** The selected room, dragged as a whole from `from` (world). */
  | { kind: 'room'; id: string; from: Vec; down: Vec; moved: boolean }
  | { kind: 'pinch'; d: number; mid: Vec }
  | null;

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = el<HTMLCanvasElement>('canvas');
const ctx = canvas.getContext('2d')!;
const sheet = el('sheet');

let plan: Plan = load();
let view = { scale: 80, ox: 40, oy: 40 };
let selection: Selection = null;
let drag: Drag = null;
let tool: Tool = null;
/** With the wall tool: the corner the next wall starts from. */
let wallFrom: string | null = null;
let cursor: Vec = { x: 0, y: 0 };
/** Hit areas grow for fingers: TOUCH_HIT with touch, 1 with a mouse, as the last pointer was. */
let hitTol = 1;
let lastSolve: SolveResult | null = null;
/** Wall length labels as drawn, so tapping a number edits that wall. */
let labelBoxes: { a: string; b: string; x: number; y: number; w: number; h: number }[] = [];
/** Door being joined: the next door tapped, in another room, is moved onto it. */
let joinFrom: string | null = null;
/** Wall waiting for a second wall to be tapped, to make them parallel or the same length. */
let tiePick: { type: WallTie; a: string; b: string } | null = null;
/** Show the distances between doors, windows and wall ends on every wall; when off, only on the selected or hovered wall. */
let showGaps = (() => {
  try {
    return localStorage.getItem('plan3d.showGaps') === '1';
  } catch {
    return false;
  }
})();
/** Draw the furniture (and show it in 3D); off, it can be neither seen nor tapped. */
let showFurniture = (() => {
  try {
    return localStorage.getItem('plan3d.showFurniture') !== '0';
  } catch {
    return true;
  }
})();
/** The plan as the 3D view shows it: without furniture when it is hidden. */
const plan3d = (): Plan => (showFurniture ? plan : { ...plan, furniture: [] });

/** The furniture library is open in the sheet. */
let library = false;
/** With the furniture tool: the library piece the next tap puts down. */
let furnitureKind = '';
/** With showGaps off: the stretch of wall the mouse is over, as "a,b,index". */
let hoverGap = '';
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
  if (!el('view3d').hidden) void import('./view3d/view').then((v) => v.show3d(plan3d(), false));
}

function resolve(): void {
  if (plan.points.length) {
    joinWallEnds(plan);
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

/** The wall a spot is on, away from its ends (a T junction), and the spot moved onto it; `skip` leaves out the walls of that corner. */
function wallUnder(p: Vec, tol: number, skip?: string): { a: Vec; b: Vec; at: Vec } | undefined {
  const s = toScreen(p);
  let best: { a: Vec; b: Vec; at: Vec } | undefined;
  let bestD = WALL_HIT * tol;
  for (const w of plan.walls) {
    if (w.a === skip || w.b === skip) continue;
    const a = pointById(plan, w.a);
    const b = pointById(plan, w.b);
    if (!a || !b) continue;
    const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1;
    const t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len2;
    if (t <= 0 || t >= 1) continue;
    const at = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
    const d = dist(toScreen(at), s);
    if (d <= bestD) {
      best = { a, b, at };
      bestD = d;
    }
  }
  return best;
}

/** How far along wall a-b, from `a`, the spot `p` is (metres; outside the wall gives below 0 or past its length). */
function alongWall(a: string, b: string, p: Vec): number {
  const pa = pointById(plan, a)!;
  const pb = pointById(plan, b)!;
  const u = unit(sub(pb, pa));
  return (p.x - pa.x) * u.x + (p.y - pa.y) * u.y;
}

/** The wall nearest to a spot on screen, within `max` pixels (wall lines only, not their length labels). */
function nearestWall(s: Vec, max: number): Wall | undefined {
  let best: Wall | undefined;
  let bestD = max;
  for (const w of plan.walls) {
    const a = pointById(plan, w.a);
    const b = pointById(plan, w.b);
    if (!a || !b) continue;
    const d = segDist(s.x, s.y, toScreen(a), toScreen(b));
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

/** Colours of renovation works: walls, doors and windows to build, or to remove. */
/** Colours offered for walls, doors, windows and wall parts; any other can be picked too. */
const COLORS = ['#f87171', '#fb923c', '#facc15', '#4ade80', '#38bdf8', '#a78bfa'];
/** A new wall part starts in this one. */
const PART_COLOR = COLORS[0];

/** The band of a wall on screen: from its line, outwards (away from the room) by its thickness. */
function wallBand(w: Wall, room: Set<string>): Vec[] | undefined {
  const a = pointById(plan, w.a);
  const b = pointById(plan, w.b);
  if (!a || !b) return undefined;
  const u = unit(sub(b, a));
  const t = wallThickness(plan, w.a, w.b);
  let n = { x: -u.y, y: u.x };
  if (insideRoom(plan, room, { x: (a.x + b.x) / 2 + n.x * 0.05, y: (a.y + b.y) / 2 + n.y * 0.05 })) n = { x: -n.x, y: -n.y };
  return [a, b, { x: b.x + n.x * t, y: b.y + n.y * t }, { x: a.x + n.x * t, y: a.y + n.y * t }].map(toScreen);
}

/** Fills a band on screen in a picked colour, see-through, with an outline. */
function paintBand(quad: Vec[], color: string): void {
  ctx.beginPath();
  quad.forEach((v, i) => (i ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y)));
  ctx.closePath();
  ctx.fillStyle = '#14161a';
  ctx.fill();
  ctx.fillStyle = `${color}99`;
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.stroke();
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
  const color = selected ? '#60a5fa' : joinOf(plan, o.id) ? '#c084fc' : o.color ?? '#e6e8eb';
  const n = g.n; // screen and plan axes point the same way, so world directions work on screen
  // the opening goes through the wall: from its face inside the room, outwards by the wall thickness
  const depth = Math.max(wallThickness(plan, o.a, o.b) * view.scale, MIN_OPENING_PX);
  const out = (p: Vec, k: number): Vec => ({ x: p.x - n.x * k, y: p.y - n.y * k });

  // a part of the wall: no cut, its stretch of band in its colour
  if (o.type === 'part') {
    paintBand([s1, s2, out(s2, depth), out(s1, depth)], o.color ?? PART_COLOR);
    if (selected) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.strokeRect(Math.min(s1.x, s2.x, out(s1, depth).x), Math.min(s1.y, s2.y, out(s1, depth).y), Math.abs(s2.x - s1.x) + Math.abs(n.x) * depth, Math.abs(s2.y - s1.y) + Math.abs(n.y) * depth);
    }
    return;
  }

  // cut the wall and its band
  ctx.fillStyle = '#14161a';
  ctx.beginPath();
  for (const [i, v] of [out(s1, -1.5), out(s2, -1.5), out(s2, depth + 1.5), out(s1, depth + 1.5)].entries()) {
    if (i) ctx.lineTo(v.x, v.y);
    else ctx.moveTo(v.x, v.y);
  }
  ctx.closePath();
  ctx.fill();

  ctx.lineCap = 'butt';
  ctx.strokeStyle = color;
  ctx.lineWidth = selected ? 2.5 : 1.5;
  // jambs
  for (const s of [s1, s2]) line(s, out(s, depth));

  if (o.type === 'window') {
    for (const k of [0, depth / 2, depth]) line(out(s1, k), out(s2, k));
    return;
  }
  if (o.noLeaf) return; // only the frame
  // door: leaf hinged at one end, open into the room (or out of it), and its swing
  const hingeAt = o.hingeAtB ? s2 : s1;
  const hinge = o.outward ? out(hingeAt, depth) : hingeAt;
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

/** Stairs the way plans draw them: outline, one line per step, an arrow going up from a dot at the bottom. */
function drawStair(st: Stair): void {
  const selected = selection?.kind === 'stair' && selection.id === st.id;
  const color = selected ? '#60a5fa' : '#c3c9d2';
  const corners = stairCorners(st).map(toScreen);
  ctx.fillStyle = '#1d2129';
  ctx.strokeStyle = color;
  ctx.lineWidth = selected ? 2.5 : 1.5;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  corners.forEach((c, i) => (i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y)));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.lineWidth = 1;
  for (const [a, b] of stairTreads(st)) line(toScreen(a), toScreen(b));
  // walking line up the middle
  const bottom = toScreen(stairPoint(st, -st.length / 2 + 0.15, 0));
  const top = toScreen(stairPoint(st, st.length / 2 - 0.05, 0));
  ctx.lineWidth = selected ? 2 : 1.5;
  line(bottom, top);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(bottom.x, bottom.y, 3.5, 0, Math.PI * 2);
  ctx.fill();
  const { u, v } = stairAxes(st);
  const head = 9;
  ctx.beginPath();
  ctx.moveTo(top.x, top.y);
  ctx.lineTo(top.x - (u.x - v.x * 0.6) * head, top.y - (u.y - v.y * 0.6) * head);
  ctx.lineTo(top.x - (u.x + v.x * 0.6) * head, top.y - (u.y + v.y * 0.6) * head);
  ctx.closePath();
  ctx.fill();
  if (selected) {
    label(`${(st.width * 100).toFixed(0)} cm`, toScreen(stairPoint(st, -st.length / 2 - 0.25, 0)), color, false);
    label(`${(st.length * 100).toFixed(0)} cm`, toScreen(stairPoint(st, 0, st.width / 2 + 0.25)), color, false);
  }
}

/** A piece of furniture: its library symbol, turned with it. */
function drawFurniture(f: Furniture): void {
  const selected = selection?.kind === 'furniture' && selection.id === f.id;
  const color = selected ? '#60a5fa' : '#9aa3b0';
  const s = view.scale;
  const c = toScreen(f);
  const X = (fx: number) => fx * f.w * s;
  const Y = (fy: number) => fy * f.d * s;
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate((f.angle * Math.PI) / 180);
  ctx.fillStyle = '#1d2129';
  ctx.strokeStyle = color;
  ctx.lineWidth = selected ? 2 : 1.2;
  ctx.lineCap = 'round';
  for (const sh of furnitureItem(f.kind).shapes) {
    ctx.beginPath();
    if (sh.t === 'rect') {
      const [x0, y0, x1, y1] = [X(Math.min(sh.x0, sh.x1)), Y(Math.min(sh.y0, sh.y1)), X(Math.max(sh.x0, sh.x1)), Y(Math.max(sh.y0, sh.y1))];
      const r = Math.min((sh.r ?? 0) * s, (x1 - x0) / 2, (y1 - y0) / 2);
      ctx.moveTo(x0 + r, y0);
      ctx.arcTo(x1, y0, x1, y1, r);
      ctx.arcTo(x1, y1, x0, y1, r);
      ctx.arcTo(x0, y1, x0, y0, r);
      ctx.arcTo(x0, y0, x1, y0, r);
      ctx.closePath();
      ctx.fill();
    } else if (sh.t === 'ellipse') {
      ctx.ellipse(X(sh.cx), Y(sh.cy), Math.abs(X(sh.rx)), Math.abs(Y(sh.ry)), 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (sh.t === 'line') {
      ctx.moveTo(X(sh.x0), Y(sh.y0));
      ctx.lineTo(X(sh.x1), Y(sh.y1));
    } else {
      const px = Math.min(f.w, f.d) * s * 0.3;
      if (px >= 7) {
        ctx.fillStyle = color;
        ctx.font = `${px}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(sh.s, X(sh.x), Y(sh.y));
        ctx.fillStyle = '#1d2129';
      }
      continue;
    }
    ctx.stroke();
  }
  ctx.restore();
  if (selected) {
    label(`${(f.w * 100).toFixed(0)} cm`, toScreen(furniturePoint(f, 0, 0.5 + 0.2 / f.d)), color, false);
    label(`${(f.d * 100).toFixed(0)} cm`, toScreen(furniturePoint(f, 0.5 + 0.3 / f.w, 0)), color, false);
  }
}

/** How uncertain a wall's length still is, in metres, from the last solve. */
const wallSigma = (a: string, b: string): number | undefined => lastSolve?.wallSigma.get(wallKey(a, b));

/** In each room, the unmeasured wall whose length is least certain: the one worth measuring next. */
function nextToMeasure(): Set<string> {
  const out = new Set<string>();
  for (const ids of roomComponents(plan)) {
    const set = new Set(ids);
    let best: string | undefined;
    let bestSigma = 0.01; // below 1 cm there is nothing worth measuring
    for (const w of plan.walls) {
      if (!set.has(w.a) || findDistance(plan, w.a, w.b) !== undefined) continue;
      const sg = wallSigma(w.a, w.b) ?? 0;
      if (sg > bestSigma) {
        bestSigma = sg;
        best = wallKey(w.a, w.b);
      }
    }
    if (best) out.add(best);
  }
  return out;
}

/** "± 4 cm", or a hint when the room has no measurement yet and its scale is unknown. */
function sigmaText(a: string, b: string): string {
  const sg = wallSigma(a, b);
  if (sg === undefined) return '';
  if (sg > 0.5) return 'no measurement in this room yet';
  return `± ${Math.max(sg * 100, 0.1).toFixed(sg < 0.01 ? 1 : 0)} cm`;
}

function render(): void {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  ctx.clearRect(0, 0, w, h);
  drawGrid();

  // the selected room
  if (selection?.kind === 'room') {
    const loop = selectedRoom();
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

  // wall thickness: a band outside the line of each room, which is the face inside the room
  ctx.fillStyle = '#2f3540';
  for (const ids of roomComponents(plan)) {
    const set = new Set(ids);
    const outline = roomOutline(plan, set);
    if (outline) {
      ctx.beginPath();
      for (const ring of [outline.outer, outline.inner]) {
        ring.forEach((v, i) => {
          const sv = toScreen(v);
          if (i) ctx.lineTo(sv.x, sv.y);
          else ctx.moveTo(sv.x, sv.y);
        });
        ctx.closePath();
      }
      ctx.fill('evenodd');
      // walls inside the group, between its rooms: a strip each
      const loop = groupLoop(plan, set)!;
      for (const w of plan.walls) {
        if (!set.has(w.a) || loop.some((id, i) => sameWall(w, id, loop[(i + 1) % loop.length]))) continue;
        const quad = wallBand(w, set);
        if (!quad) continue;
        ctx.beginPath();
        quad.forEach((v, i) => (i ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y)));
        ctx.closePath();
        ctx.fill();
      }
      continue;
    }
    // not a simple loop: a plain strip along each wall, on the side away from the room
    for (const w of plan.walls) {
      const quad = set.has(w.a) && wallBand(w, set);
      if (!quad) continue;
      ctx.beginPath();
      quad.forEach((v, i) => (i ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y)));
      ctx.closePath();
      ctx.fill();
    }
  }
  // walls given a colour: their band in it
  for (const w of plan.walls) {
    const quad = w.color && wallBand(w, roomIdsOf(plan, w.a));
    if (quad) paintBand(quad, w.color!);
  }

  const next = nextToMeasure();
  const tied = selection?.kind === 'wall' ? wallTies(plan, selection.a, selection.b) : [];
  const isTied = (a: string, b: string) => tied.find((t) => (t.a === a && t.b === b) || (t.a === b && t.b === a));

  // furniture under the walls, so it does not hide them
  if (showFurniture) for (const f of plan.furniture) drawFurniture(f);

  // walls
  ctx.lineCap = 'round';
  for (const wall of plan.walls) {
    const a = pointById(plan, wall.a);
    const b = pointById(plan, wall.b);
    if (!a || !b) continue;
    const measured = findDistance(plan, wall.a, wall.b) !== undefined;
    const selected = (selection?.kind === 'wall' && ((selection.a === wall.a && selection.b === wall.b) || (selection.a === wall.b && selection.b === wall.a))) || (selection?.kind === 'room' && !!selectedRoom() && loopWalls(plan, selectedRoom()!).includes(wall));
    const tie = isTied(wall.a, wall.b);
    ctx.lineWidth = selected || tie ? 5 : measured ? 4 : 3;
    ctx.strokeStyle = selected ? '#60a5fa' : tie ? '#c084fc' : measured ? '#4ade80' : next.has(wallKey(wall.a, wall.b)) ? '#fbbf24' : '#9aa3b0';
    ctx.setLineDash(measured || tie ? [] : [8, 5]);
    line(toScreen(a), toScreen(b));
    ctx.setLineDash([]);
    if (tie) label(tie.type === 'parallel' ? '∥' : '=', toScreen({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }), '#c084fc', true);
  }

  for (const st of plan.stairs) drawStair(st);
  for (const o of plan.openings) drawOpening(o);
  for (const o of plan.openings) drawOpeningLabel(o);

  // wall lengths, over the openings, and remembered for tapping
  labelBoxes = [];
  dimBoxes = [];
  const groups = roomComponents(plan).map((ids) => new Set(ids));
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
    if (dist(toScreen(a), toScreen(b)) < ctx.measureText(text).width + 16) continue; // zoomed out too far to fit: zoom in to see it
    const away = Math.abs(n.x) * (ctx.measureText(text).width / 2 + 10) + Math.abs(n.y) * 15 + wallThickness(plan, wall.a, wall.b) * view.scale;
    let at = { x: (toScreen(a).x + toScreen(b).x) / 2 + n.x * away, y: (toScreen(a).y + toScreen(b).y) / 2 + n.y * away };
    // a wall shared with a neighbouring room: outside is the neighbour's floor, so the label goes on this room's side
    const atWorld = toWorld(at.x, at.y);
    if (groups.some((ids) => !ids.has(wall.a) && insideRoom(plan, ids, atWorld))) {
      const back = away - wallThickness(plan, wall.a, wall.b) * view.scale;
      at = { x: (toScreen(a).x + toScreen(b).x) / 2 - n.x * back, y: (toScreen(a).y + toScreen(b).y) / 2 - n.y * back };
    }
    const size = label(text, at, measured ? '#4ade80' : next.has(wallKey(wall.a, wall.b)) ? '#fbbf24' : '#c3c9d2', measured);
    labelBoxes.push({ a: wall.a, b: wall.b, ...at, ...size });
  }

  // room names, where they were put down
  for (const n of plan.names) {
    const at = toScreen(n);
    dimBoxes.push({ ...at, ...label(n.name, at, '#e6e8eb', true) });
  }

  // the angle at the selected corner (also while dragging it): a square when it is held at 90 degrees
  const corner = selection?.kind === 'point' ? pointById(plan, selection.id) : undefined;
  const nb = corner && cornerNeighbours(plan, corner.id);
  const wa = nb && pointById(plan, nb[0]);
  const wc = nb && pointById(plan, nb[1]);
  if (corner && wa && wc) {
    const sp = toScreen(corner);
    const ua = unit(sub(toScreen(wa), sp));
    const uc = unit(sub(toScreen(wc), sp));
    const deg = (Math.acos(Math.max(-1, Math.min(1, ua.x * uc.x + ua.y * uc.y))) * 180) / Math.PI;
    const square = findRightAngle(plan, corner.id);
    const held = findAngle(plan, corner.id) !== undefined;
    ctx.strokeStyle = held ? '#4ade80' : '#60a5fa';
    ctx.lineWidth = 2;
    ctx.lineCap = 'butt';
    const s = 14;
    ctx.beginPath();
    if (square) {
      ctx.moveTo(sp.x + ua.x * s, sp.y + ua.y * s);
      ctx.lineTo(sp.x + (ua.x + uc.x) * s, sp.y + (ua.y + uc.y) * s);
      ctx.lineTo(sp.x + uc.x * s, sp.y + uc.y * s);
    } else {
      const from = Math.atan2(ua.y, ua.x);
      let sweep = Math.atan2(uc.y, uc.x) - from;
      while (sweep > Math.PI) sweep -= 2 * Math.PI;
      while (sweep < -Math.PI) sweep += 2 * Math.PI;
      ctx.arc(sp.x, sp.y, s, from, from + sweep, sweep < 0);
    }
    ctx.stroke();
    const bis = unit({ x: ua.x + uc.x, y: ua.y + uc.y });
    const reach = 34;
    label(`${deg.toFixed(deg % 1 < 0.05 || deg % 1 > 0.95 ? 0 : 1)}°`, { x: sp.x + bis.x * reach, y: sp.y + bis.y * reach }, held ? '#4ade80' : '#60a5fa', held);
  }

  // a corner on another wall (a T junction): how far it is from that wall's ends;
  // the loose end of a wall: how far it is from the wall it points at
  for (const p of plan.points) {
    const own = plan.walls.filter((w) => w.a === p.id || w.b === p.id);
    if (!own.length) continue;
    const other = pointById(plan, own[0].a === p.id ? own[0].b : own[0].a);
    drawAlongWall(p, p.id, other);
    if (own.length === 1 && other) drawGap(p, p.id, other);
  }

  // doors and windows: how far from each other and from the wall's ends; when not shown on
  // every wall, on the selected wall (or the selected opening's) and the stretch under the mouse
  const sel = selection;
  const selOpening = sel?.kind === 'opening' ? plan.openings.find((o) => o.id === sel.id) : undefined;
  const [ha, hb, hi] = hoverGap.split(',');
  for (const wall of plan.walls) {
    if (showGaps || (sel?.kind === 'wall' && sameWall(wall, sel.a, sel.b)) || (selOpening && sameWall(wall, selOpening.a, selOpening.b))) drawWallGaps(wall);
    else if (wall.a === ha && wall.b === hb) drawWallGaps(wall, +hi);
  }
  if (tool === 'wall') {
    if (wallFrom && !plan.walls.some((w) => w.a === wallFrom || w.b === wallFrom)) drawAlongWall(pointById(plan, wallFrom)!, wallFrom);
    drawAlongWall(wallEnd(cursor, hitTol));
  }

  // the wall being drawn, from its first corner to the finger
  if (wallFrom) {
    const last = pointById(plan, wallFrom)!;
    const sl = toScreen(last);
    const end = hitPoint(toScreen(cursor).x, toScreen(cursor).y, hitTol) ? cursor : wallEnd(cursor, hitTol);
    const sc = toScreen(end);
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = '#60a5fa';
    ctx.lineWidth = 2;
    line(sl, sc);
    ctx.setLineDash([]);
    label(`${(dist(last, end) * 100).toFixed(0)} cm`, { x: (sl.x + sc.x) / 2, y: (sl.y + sc.y) / 2 }, '#60a5fa', false);
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

/** Distances from a spot on a wall to both ends of it, drawn as dimension lines beside the wall. */
function drawAlongWall(p: Vec, skip?: string, towards?: Vec): void {
  const host = wallUnder(p, 1, skip);
  if (!host) return;
  const sp = toScreen(host.at);
  const u = unit(sub(toScreen(host.b), toScreen(host.a)));
  let n = { x: -u.y * 16, y: u.x * 16 };
  // on the side the corner's own wall goes off to
  if (towards) {
    const st = toScreen(towards);
    if ((st.x - sp.x) * n.x + (st.y - sp.y) * n.y < 0) n = { x: -n.x, y: -n.y };
  }
  for (const end of [host.a, host.b]) {
    const se = toScreen(end);
    dimension({ x: se.x + n.x, y: se.y + n.y }, { x: sp.x + n.x, y: sp.y + n.y }, dist(end, host.at));
  }
}

/** Dimension labels drawn so far in this frame, so the next ones keep clear of them. */
let dimBoxes: { x: number; y: number; w: number; h: number }[] = [];

/** Whether a label at `at` would cover a door, a window, a wall line or another label. */
function crowded(at: Vec, w: number, h: number): boolean {
  const hits = (b: { x: number; y: number; w: number; h: number }) => Math.abs(at.x - b.x) < (w + b.w) / 2 + 2 && Math.abs(at.y - b.y) < (h + b.h) / 2 + 2;
  if (labelBoxes.some(hits) || dimBoxes.some(hits)) return true;
  for (const o of plan.openings) {
    const g = openingGeometry(o);
    if (!g) continue;
    // the opening and, for a door, the square its leaf swings through, on either side of the wall
    const r = o.type === 'door' && !o.noLeaf ? o.width : wallThickness(plan, o.a, o.b);
    const corners = [g.p1, g.p2].flatMap((p) => [-1, 1].map((k) => toScreen({ x: p.x + g.n.x * r * k, y: p.y + g.n.y * r * k })));
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    const box = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2, w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    if (hits(box)) return true;
  }
  for (const wall of plan.walls) {
    const a = pointById(plan, wall.a);
    const b = pointById(plan, wall.b);
    if (!a || !b) continue;
    const sa = toScreen(a);
    const sb = toScreen(b);
    if ([-w / 2, 0, w / 2].some((dx) => segDist(at.x + dx, at.y, sa, sb) < h / 2 + 1)) return true;
  }
  return false;
}

/**
 * A dotted dimension line with its length, the label put where it covers nothing if it can.
 * Too short to hold its number, the number goes beside the line towards `side` (a unit vector
 * on screen) if given, else it is left out: zoom in to see it.
 */
function dimension(s1: Vec, s2: Vec, metres: number, side?: Vec): void {
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 1;
  ctx.lineCap = 'butt';
  ctx.setLineDash([3, 4]);
  line(s1, s2);
  ctx.setLineDash([]);
  const short = dist(s1, s2) < 40;
  if (short && !side) return;
  const text = `${(metres * 100).toFixed(0)} cm`;
  ctx.font = '13px system-ui, sans-serif';
  const w = ctx.measureText(text).width + 8;
  const h = 18;
  const along = (f: number) => ({ x: s1.x + (s2.x - s1.x) * f, y: s1.y + (s2.y - s1.y) * f });
  // beside a short line: far enough out for the label's own size, then further if that is taken
  const beside = (k: number) => {
    const reach = Math.abs(side!.x) * w / 2 + Math.abs(side!.y) * h / 2 + 4 + k * 20;
    return { x: (s1.x + s2.x) / 2 + side!.x * reach, y: (s1.y + s2.y) / 2 + side!.y * reach };
  };
  const spots = short ? [0, 1, 2, 3].map(beside) : [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8].map(along);
  const spot = spots.find((at) => crowded(at, w, h) === false) ?? spots[0];
  if (short) {
    // a tick from the line to its number, so it is clear which line it belongs to
    ctx.strokeStyle = '#38bdf8';
    line(along(0.5), spot);
  }
  label(text, spot, '#38bdf8', false);
  dimBoxes.push({ ...spot, w, h });
}

/** From the loose end `p` of the wall `from`-`p`, carried on straight: the distance to the first wall it meets. */
function drawGap(p: Vec, skip: string, from: Vec): void {
  const d = unit(sub(p, from));
  let best = Infinity;
  for (const w of plan.walls) {
    if (w.a === skip || w.b === skip) continue;
    const a = pointById(plan, w.a);
    const b = pointById(plan, w.b);
    if (!a || !b) continue;
    // p + t d = a + s (b - a)
    const e = sub(b, a);
    const den = d.x * e.y - d.y * e.x;
    if (Math.abs(den) < 1e-9) continue;
    const ap = sub(a, p);
    const t = (ap.x * e.y - ap.y * e.x) / den;
    const s = (ap.x * d.y - ap.y * d.x) / den;
    if (t > 0.005 && s >= 0 && s <= 1 && t < best) best = t;
  }
  if (best === Infinity) return;
  const sp = toScreen(p);
  dimension(sp, toScreen({ x: p.x + d.x * best, y: p.y + d.y * best }), best);
}

/** The stretches of a wall between its ends and its doors, windows and parts, in metres from `a`. Empty without openings. */
function wallGaps(wall: Wall): { s0: number; s1: number }[] {
  const a = pointById(plan, wall.a);
  const b = pointById(plan, wall.b);
  if (!a || !b) return [];
  const len = dist(a, b);
  const cuts = plan.openings
    .filter((o) => sameWall(wall, o.a, o.b))
    .map((o) => (o.a === wall.a ? [o.at, o.at + o.width] : [len - o.at - o.width, len - o.at]))
    .sort((p, q) => p[0] - q[0]);
  if (!cuts.length) return [];
  const out: { s0: number; s1: number }[] = [];
  let from = 0;
  for (const [c0, c1] of cuts) {
    if (c0 - from > 0.005) out.push({ s0: from, s1: c0 });
    from = Math.max(from, c1);
  }
  if (len - from > 0.005) out.push({ s0: from, s1: len });
  return out;
}

/** The wall and stretch of it under the mouse, as "a,b,index", or ''. */
function gapAt(pos: Vec): string {
  const wall = nearestWall(pos, Math.max(WALL_HIT, 0.25 * view.scale));
  if (!wall) return '';
  const s = alongWall(wall.a, wall.b, toWorld(pos.x, pos.y));
  const i = wallGaps(wall).findIndex((g) => g.s0 <= s && s <= g.s1);
  return i < 0 ? '' : `${wall.a},${wall.b},${i}`;
}

/** Dimension lines along a wall, inside its room, for the stretches between its ends and openings (only stretch `only` if given). */
function drawWallGaps(wall: Wall, only?: number): void {
  const a = pointById(plan, wall.a)!;
  const b = pointById(plan, wall.b)!;
  const u = unit(sub(b, a));
  let n = { x: -u.y, y: u.x };
  if (!insideRoom(plan, roomIdsOf(plan, wall.a), { x: (a.x + b.x) / 2 + n.x * 0.05, y: (a.y + b.y) / 2 + n.y * 0.05 })) n = { x: -n.x, y: -n.y };
  const off = { x: n.x * 16, y: n.y * 16 };
  wallGaps(wall).forEach((g, i) => {
    if (only !== undefined && i !== only) return;
    const s1 = toScreen({ x: a.x + u.x * g.s0, y: a.y + u.y * g.s0 });
    const s2 = toScreen({ x: a.x + u.x * g.s1, y: a.y + u.y * g.s1 });
    dimension({ x: s1.x + off.x, y: s1.y + off.y }, { x: s2.x + off.x, y: s2.y + off.y }, g.s1 - g.s0, n);
  });
}

/** The angle at a corner with two walls, in degrees. */
function cornerAngle(id: string): number | undefined {
  const p = pointById(plan, id);
  const n = cornerNeighbours(plan, id);
  const a = n && pointById(plan, n[0]);
  const c = n && pointById(plan, n[1]);
  if (!p || !a || !c) return undefined;
  const ux = a.x - p.x;
  const uy = a.y - p.y;
  const wx = c.x - p.x;
  const wy = c.y - p.y;
  return (Math.atan2(Math.abs(ux * wy - uy * wx), ux * wx + uy * wy) * 180) / Math.PI;
}

const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const unit = (v: Vec): Vec => {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
};

// ---------- bottom sheet and the rest of the UI ----------

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** Colour swatches, a picker for any other colour, and (unless `none` is false) no colour at all. */
function colorRow(current: string | undefined, onSet: (c: string | undefined) => void, none = true): string {
  queueMicrotask(() => {
    document.querySelectorAll<HTMLButtonElement>('#sheet .swatch').forEach((b) => (b.onclick = () => onSet(b.dataset.color || undefined)));
    const pick = document.getElementById('colorPick') as HTMLInputElement | null;
    if (pick) pick.onchange = () => onSet(pick.value);
  });
  const custom = current && !COLORS.includes(current) ? current : undefined;
  const swatch = (c: string | undefined, title: string) =>
    `<button class="swatch ${current === c ? 'on' : ''}" data-color="${c ?? ''}" title="${title}" aria-label="${title}" aria-pressed="${current === c}" style="--swatch:${c ?? 'transparent'}"></button>`;
  return (
    `<div class="row colors">` +
    (none ? swatch(undefined, 'No colour') : '') +
    COLORS.map((c) => swatch(c, c)).join('') +
    `<label class="swatch pick ${custom ? 'on' : ''}" title="Any other colour" style="--swatch:${custom ?? 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)'}"><input id="colorPick" type="color" value="${current ?? COLORS[0]}"></label>` +
    `</div>`
  );
}

const head = (title: string, detail = '') =>
  `<div class="head"><b>${title}</b><span class="muted">${detail}</span><button class="close" id="close" aria-label="Close">×</button></div>`;

/**
 * A number field in cm with an OK button; `onSet` gets metres. It is a form,
 * so the keyboard's Done/Enter submits it. Tapping OK must not take the focus
 * first: on a phone the keyboard would close, the sheet would slide down,
 * and the tap would land on nothing.
 */
function numberRow(
  value: number | undefined,
  placeholder: number,
  onSet: (m: number) => void,
  opts: { id?: string; label?: string; focus?: boolean; unit?: string; factor?: number } = {}
): string {
  const id = opts.id ?? 'num';
  const factor = opts.factor ?? 100; // shown value per stored unit: cm per metre by default
  queueMicrotask(() => {
    const input = el<HTMLInputElement>(id);
    el(`${id}Form`).onsubmit = (e) => {
      e.preventDefault();
      const shown = parseFloat(input.value.replace(',', '.'));
      if (shown > 0) onSet(shown / factor);
    };
    el(`${id}Ok`).onmousedown = (e) => e.preventDefault();
    el(`${id}Ok`).onpointerdown = (e) => e.preventDefault();
    if (opts.focus !== false) {
      input.focus();
      input.select();
    }
  });
  return `<form id="${id}Form" class="row"><label class="num">${opts.label ? `<span class="muted">${opts.label}</span>` : ''}<input id="${id}" type="text" inputmode="decimal" enterkeyhint="done" autocomplete="off" placeholder="${placeholder.toFixed(0)}" value="${value !== undefined ? +(value * factor).toFixed(1) : ''}"> ${opts.unit ?? 'cm'}</label><button id="${id}Ok" class="primary">OK</button></form>`;
}

function renderUi(): void {
  document.title = plan.name ? `${plan.name} · plan3d` : 'plan3d';
  el('rename').firstElementChild!.textContent = plan.name ?? 'Name this plan';
  // only rebuild the sheet when what it shows changed, so typing is not interrupted
  const key = JSON.stringify([selection, library]);
  if (sheet.dataset.key !== key) {
    sheet.dataset.key = key;
    renderSheet();
  }
  el('empty').hidden = plan.points.length > 0 || tool !== null;
  el('scan').hidden = !sheet.hidden || tool !== null;
  for (const t of ['wall', 'door', 'window', 'part', 'stair'] as const) el(`tool-${t}`).classList.toggle('on', tool === t);
  el('tool-furniture').classList.toggle('on', tool === 'furniture' || library);

  // one line at the top: what the tool expects, or measurements that disagree
  const conflicts = (lastSolve?.conflicts ?? []).filter((c) => c.constraint.type === 'distance');
  const info = el('info');
  info.classList.toggle('warn', !tool);
  info.textContent =
    tool === 'wall'
      ? wallFrom
        ? 'Tap the next corner. Tap the last corner again, or an existing corner, to stop.'
        : 'Tap where the wall starts (tap a corner to start from it).'
      : tool === 'stair'
        ? 'Tap where the stairs go. Drag them afterwards to move them.'
        : tool === 'furniture'
        ? `Tap where the ${furnitureItem(furnitureKind).name.toLowerCase()} goes. Near a wall it stands against it.`
        : tool
        ? tool === 'part'
          ? 'Tap the wall where a part of it is to be removed or built.'
          : `Tap the wall where the ${tool} goes.`
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
  if (library && !sel) {
    const groups = [...new Set(LIBRARY.map((i) => i.group))];
    sheet.innerHTML =
      head('Furniture', 'pick one, then tap the plan') +
      `<div class="lib">` +
      groups
        .map(
          (g) =>
            `<p class="muted">${g}</p><div class="row">` +
            LIBRARY.filter((i) => i.group === g)
              .map((i) => `<button class="icon" data-kind="${i.kind}" title="${i.name}, ${(i.w * 100).toFixed(0)} × ${(i.d * 100).toFixed(0)} cm">${furnitureIcon(i)}${i.name}</button>`)
              .join('') +
            `</div>`
        )
        .join('') +
      `</div>`;
    for (const b of sheet.querySelectorAll<HTMLButtonElement>('[data-kind]')) {
      b.onclick = () => {
        furnitureKind = b.dataset.kind!;
        library = false;
        tool = 'furniture';
        if (!showFurniture) setShowFurniture(true);
        render();
        renderUi();
      };
    }
  } else if (sel?.kind === 'wall') {
    const a = pointById(plan, sel.a);
    const b = pointById(plan, sel.b);
    if (!a || !b) return closeSheet();
    const measured = findDistance(plan, sel.a, sel.b);
    sheet.innerHTML =
      head(
        'Wall length',
        measured !== undefined
          ? '<span class="ok">measured</span>'
          : `estimated ${(dist(a, b) * 100).toFixed(0)} cm, ${sigmaText(sel.a, sel.b)}${nextToMeasure().has(wallKey(sel.a, sel.b)) ? ' · <span class="next">measure this one next</span>' : ''}`
      ) +
      numberRow(measured, dist(a, b) * 100, (m) => {
        setDistance(plan, sel.a, sel.b, m);
        closeSheet();
        resolve();
      }) +
      numberRow(wallThickness(plan, sel.a, sel.b), wallThickness(plan, sel.a, sel.b) * 100, (m) => {
        setWallThickness(plan, sel.a, sel.b, m);
        closeSheet();
        resolve();
      }, { id: 'thick', label: 'Thickness', focus: false }) +
      colorRow(plan.walls.find((w) => sameWall(w, sel.a, sel.b))?.color, (c) => {
        const wall = plan.walls.find((w) => sameWall(w, sel.a, sel.b));
        if (wall) wall.color = c;
        commit();
        sheet.dataset.key = '';
        render();
        renderUi();
      }) +
      `<div class="row">` +
      `<button id="tieParallel" class="icon" title="Make another wall parallel to this one"><svg viewBox="0 0 24 24"><path d="M7 4 4 20M20 4l-3 16"/></svg>Parallel to…</button>` +
      `<button id="tieEqual" class="icon" title="Give another wall the same length"><svg viewBox="0 0 24 24"><path d="M4 9h16M4 15h16"/></svg>Same length…</button>` +
      `</div>` +
      wallTies(plan, sel.a, sel.b)
        .map((t, i) => `<div class="row"><span class="tie">${t.type === 'parallel' ? '∥ parallel to' : '= same length as'} the purple wall</span><button id="untie${i}" class="link">Remove</button></div>`)
        .join('') +
      `<div class="row"><button id="thickAll" class="link">Same thickness for the whole room</button>${measured !== undefined ? '<button id="clearLen" class="link">Forget the length</button>' : ''}</div>`;
    const pickTie = (type: WallTie) => {
      tiePick = { type, a: sel.a, b: sel.b };
      showScanMsg(`Now tap the wall that should be ${type === 'parallel' ? 'parallel to this one' : 'the same length'}. Tap anywhere else to cancel.`);
      sheet.hidden = true;
    };
    el('tieParallel').onclick = () => pickTie('parallel');
    el('tieEqual').onclick = () => pickTie('equal');
    wallTies(plan, sel.a, sel.b).forEach((t, i) => {
      el(`untie${i}`).onclick = () => {
        removeWallTie(plan, t.type, sel.a, sel.b, t.a, t.b);
        sheet.dataset.key = '';
        resolve();
      };
    });
    el('thickAll').onclick = () => {
      const t = wallThickness(plan, sel.a, sel.b);
      const ids = roomIdsOf(plan, sel.a);
      for (const w of plan.walls) if (ids.has(w.a)) setWallThickness(plan, w.a, w.b, t);
      closeSheet();
      resolve();
    };
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
      head(o.type === 'door' ? 'Door' : o.type === 'window' ? 'Window' : 'Part of the wall', o.measured ? '<span class="ok">width measured</span>' : `width estimated ${(o.width * 100).toFixed(0)} cm`) +
      numberRow(o.width, o.width * 100, (m) => {
        // keep it centred where it was
        o.at = Math.max(0, o.at + (o.width - m) / 2);
        o.width = m;
        o.measured = true;
        commit();
        closeSheet();
        render();
      }) +
      colorRow(o.type === 'part' ? o.color ?? PART_COLOR : o.color, (c) => {
        o.color = c;
        commit();
        sheet.dataset.key = '';
        render();
        renderUi();
      }, o.type !== 'part') +
      `<div class="row">` +
      (o.type === 'door'
        ? `<button id="noLeaf" class="icon ${o.noLeaf ? 'on' : ''}" title="${o.noLeaf ? 'Hang a door in the frame' : 'Only the frame, no door'}" aria-pressed="${!!o.noLeaf}"><svg viewBox="0 0 24 24"><path d="M2 20h4M18 20h4" stroke-width="3"/><path d="M6 20V6h12v14"/></svg>No door</button>`
        : '') +
      (o.type === 'door' && !o.noLeaf
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
    const flip = (key: 'hingeAtB' | 'outward' | 'noLeaf') => {
      o[key] = !o[key] || undefined;
      commit();
      sheet.dataset.key = '';
      render();
      renderUi();
    };
    if (o.type === 'door') el('noLeaf').onclick = () => flip('noLeaf');
    if (o.type === 'door' && !o.noLeaf) {
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
      if (!confirm(`Delete this ${o.type === 'part' ? 'part of the wall' : o.type}?`)) return;
      plan.openings = plan.openings.filter((x) => x.id !== sel.id);
      closeSheet();
      resolve();
    };
  } else if (sel?.kind === 'stair') {
    const st = plan.stairs.find((x) => x.id === sel.id);
    if (!st) return closeSheet();
    const update = (change: () => void) => {
      change();
      commit();
      sheet.dataset.key = '';
      render();
      renderUi();
    };
    sheet.innerHTML =
      head('Stairs', `${st.steps} steps of ${((st.length / st.steps) * 100).toFixed(0)} cm · drag to move`) +
      numberRow(st.width, st.width * 100, (m) => update(() => (st.width = m)), { id: 'stW', label: 'Width', focus: false }) +
      numberRow(st.length, st.length * 100, (m) => update(() => (st.length = m)), { id: 'stL', label: 'Length', focus: false }) +
      numberRow(st.steps, st.steps, (n) => update(() => (st.steps = Math.max(1, Math.round(n)))), { id: 'stN', label: 'Steps', focus: false, unit: '', factor: 1 }) +
      `<div class="row">` +
      `<button id="stRot" class="icon" title="Turn a quarter turn"><svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/></svg>Turn 90°</button>` +
      `<button id="stFlip" class="icon" title="Go up the other way"><svg viewBox="0 0 24 24"><path d="M8 20V4M4 8l4-4 4 4M16 4v16M12 16l4 4 4-4"/></svg>Up/down</button>` +
      `<button id="stDel" class="icon danger" title="Delete these stairs"><svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>Delete</button>` +
      `</div>`;
    el('stRot').onclick = () => update(() => (st.angle = (st.angle + 90) % 360));
    el('stFlip').onclick = () => update(() => (st.angle = (st.angle + 180) % 360));
    el('stDel').onclick = () => {
      if (!confirm('Delete these stairs?')) return;
      plan.stairs = plan.stairs.filter((x) => x.id !== st.id);
      commit();
      closeSheet();
      render();
    };
  } else if (sel?.kind === 'furniture') {
    const f = plan.furniture.find((x) => x.id === sel.id);
    if (!f) return closeSheet();
    const update = (change: () => void) => {
      change();
      snapToWalls(plan, f, false);
      commit();
      sheet.dataset.key = '';
      render();
      renderUi();
    };
    sheet.innerHTML =
      head(furnitureItem(f.kind).name, 'drag to move') +
      numberRow(f.w, f.w * 100, (m) => update(() => (f.w = m)), { id: 'fuW', label: 'Width', focus: false }) +
      numberRow(f.d, f.d * 100, (m) => update(() => (f.d = m)), { id: 'fuD', label: 'Depth', focus: false }) +
      numberRow(f.h, f.h * 100, (m) => update(() => (f.h = m)), { id: 'fuH', label: 'Height', focus: false }) +
      `<div class="row">` +
      `<button id="fuRot" class="icon" title="Turn a quarter turn"><svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/></svg>Turn 90°</button>` +
      `<button id="fuDup" class="icon" title="Put a copy beside it"><svg viewBox="0 0 24 24"><rect x="8" y="8" width="13" height="13" rx="1"/><path d="M16 8V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h4"/></svg>Copy</button>` +
      `<button id="fuDel" class="icon danger" title="Delete this piece"><svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>Delete</button>` +
      `</div>`;
    el('fuRot').onclick = () => update(() => (f.angle = (f.angle + 90) % 360));
    el('fuDup').onclick = () => {
      // beside it, along its width: kitchen units or chairs in a row
      const copy = { ...f, id: newId(), ...furniturePoint(f, 1 + 0.02 / f.w, 0) };
      snapToWalls(plan, copy, false);
      plan.furniture.push(copy);
      selection = { kind: 'furniture', id: copy.id };
      commit();
      render();
      renderUi();
    };
    el('fuDel').onclick = () => {
      plan.furniture = plan.furniture.filter((x) => x.id !== f.id);
      commit();
      closeSheet();
      render();
    };
  } else if (sel?.kind === 'room') {
    const loop = selectedRoom();
    if (!loop) return closeSheet();
    const walls = loopWalls(plan, loop);
    const area = loopArea(plan, loop);
    const doors = plan.openings.filter((o) => o.type !== 'part' && walls.some((w) => sameWall(w, o.a, o.b))).length;
    sheet.innerHTML =
      head(escapeHtml(roomName(plan, loop) ?? 'Room'), `${area.toFixed(1)} m² · ${new Set(loop).size} corners · ${doors} door/window${doors === 1 ? '' : 's'}`) +
      `<form id="nameForm" class="row"><label class="num"><span class="muted">Name</span><input id="name" type="text" enterkeyhint="done" autocomplete="off" placeholder="Kitchen, bedroom…" value="${escapeHtml(roomName(plan, loop) ?? '')}"></label><button id="nameOk" class="primary">OK</button></form>` +
      `<div class="row">` +
      `<button id="dupRoom" class="icon" title="Make a copy of this room beside it"><svg viewBox="0 0 24 24"><rect x="8" y="8" width="13" height="13" rx="1"/><path d="M16 8V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h4"/></svg>Duplicate</button>` +
      `<button id="delRoom" class="icon danger" title="Delete this room"><svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>Delete room</button></div>`;
    el('nameForm').onsubmit = (e) => {
      e.preventDefault();
      setRoomName(plan, loop, el<HTMLInputElement>('name').value.trim());
      el<HTMLInputElement>('name').blur();
      sheet.dataset.key = '';
      commit();
      render();
      renderUi();
    };
    el('nameOk').onmousedown = (e) => e.preventDefault();
    el('nameOk').onpointerdown = (e) => e.preventDefault();
    el('dupRoom').onclick = () => {
      selection = { kind: 'room', loop: duplicateRoom(plan, loop) };
      sheet.dataset.key = '';
      resolve();
      showScanMsg('Copy made beside the room. Drag inside it to move it.');
    };
    el('delRoom').onclick = () => {
      if (!confirm('Delete this room, with its walls, doors and windows? Walls it shares with another room stay.')) return;
      deleteRoom(plan, loop);
      closeSheet();
      resolve();
    };
  } else if (sel?.kind === 'point') {
    const canSquare = cornerNeighbours(plan, sel.id) !== undefined;
    const square = findRightAngle(plan, sel.id);
    const held = findAngle(plan, sel.id);
    const now = cornerAngle(sel.id);
    sheet.innerHTML =
      head('Corner', 'drag to move') +
      `<div class="row">` +
      `<button id="angle" class="icon ${square ? 'on' : ''}" ${canSquare ? '' : 'disabled'} title="${square ? 'Held at 90°, tap to release' : 'Hold this corner at 90°'}" aria-pressed="${square}"><svg viewBox="0 0 24 24"><path d="M5 3v16h16"/><path d="M5 13h6v6"/></svg>${square ? '90° on' : '90° off'}</button>` +
      `<button id="del" class="icon danger" title="Delete this corner"><svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>Delete</button>` +
      `</div>` +
      (canSquare
        ? numberRow(held, now ?? 90, (deg) => {
            if (deg >= 180) return;
            setAngle(plan, sel.id, deg);
            sheet.dataset.key = '';
            resolve();
          }, { id: 'deg', label: 'Angle', focus: false, unit: '°', factor: 1 }) +
          (held !== undefined && !square ? `<div class="row"><button id="freeAngle" class="link">Let the angle free</button></div>` : '')
        : '');
    if (held !== undefined && !square) {
      el('freeAngle').onclick = () => {
        setAngle(plan, sel.id, undefined);
        sheet.dataset.key = '';
        resolve();
      };
    }
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
  library = false;
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
  library = false;
  resolve();
}

/** How close to square a new wall must be drawn to snap, in degrees. */
const SQUARE_SNAP = 5;

/**
 * Where a new corner goes for a tap at `at`: the wall from the last corner
 * snaps square to the walls already there (or to the screen when there are
 * none) if drawn nearly so, and a tap on a wall puts the corner exactly on it.
 */
function wallEnd(at: Vec, tol: number): Vec {
  const from = wallFrom ? pointById(plan, wallFrom) : undefined;
  if (from) {
    const refs = plan.walls
      .filter((w) => w.a === from.id || w.b === from.id)
      .map((w) => pointById(plan, w.a === from.id ? w.b : w.a))
      .filter((p): p is PlanPoint => !!p)
      .map((p) => unit(sub(p, from)));
    const host = wallUnderCorner(plan, from.id);
    const ha = host && pointById(plan, host.a);
    const hb = host && pointById(plan, host.b);
    if (ha && hb) refs.push(unit(sub(hb, ha)));
    if (!refs.length) refs.push({ x: 1, y: 0 });
    const v = sub(at, from);
    const len = Math.hypot(v.x, v.y);
    const square = refs
      .flatMap((r) => [r, { x: -r.y, y: r.x }, { x: -r.x, y: -r.y }, { x: r.y, y: -r.x }])
      .find((d) => (v.x * d.x + v.y * d.y) / (len || 1) > Math.cos((SQUARE_SNAP * Math.PI) / 180));
    if (square) at = { x: from.x + square.x * len, y: from.y + square.y * len };
  }
  return wallUnder(at, tol, wallFrom ?? undefined)?.at ?? at;
}

/** Wall tool: each tap is a corner; walls join consecutive taps. */
function wallTap(pos: Vec, tol: number): void {
  const hit = hitPoint(pos.x, pos.y, tol);
  if (hit && hit === wallFrom) {
    stopWall();
  } else {
    const id = hit ?? addPoint(plan, wallEnd(toWorld(pos.x, pos.y), tol)).id;
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
  if (!w || !a || !b || (tool !== 'door' && tool !== 'window' && tool !== 'part')) return;
  const len = dist(a, b);
  const p = toWorld(pos.x, pos.y);
  const along = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (len || 1);
  const width = Math.min(NEW_WIDTH[tool], len);
  const o: Opening = { id: newId(), type: tool, a: w.a, b: w.b, at: Math.max(0, Math.min(len - width, along - width / 2)), width };
  if (tool === 'part') o.color = PART_COLOR;
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
  library = false;

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
  hitTol = tol;
  selectionBeforeTouch = selection;

  if (tiePick) {
    const pick = tiePick;
    tiePick = null;
    showScanMsg(null);
    const w = hitWall(pos.x, pos.y, tol);
    if (w && !((w.a === pick.a && w.b === pick.b) || (w.a === pick.b && w.b === pick.a))) {
      addWallTie(plan, pick.type, pick.a, pick.b, w.a, w.b);
      selection = { kind: 'wall', a: pick.a, b: pick.b };
      sheet.dataset.key = '';
      resolve();
      return;
    }
    sheet.dataset.key = '';
  }

  if (joinFrom) {
    const target = hitOpening(pos.x, pos.y, tol);
    if (target) return joinTap(target);
    joinFrom = null;
    showScanMsg(null);
  }

  if (tool === 'wall') return wallTap(pos, tol);
  if (tool === 'stair') return stairTap(pos);
  if (tool === 'furniture') return furnitureTap(pos);
  if (tool) return openingTap(pos, tol);

  const pid = hitPoint(pos.x, pos.y, tol);
  const oid = pid ? undefined : hitOpening(pos.x, pos.y, tol);
  // before walls: a piece stands against a wall, and a tap on its back half is meant for it
  const fu = pid || oid || !showFurniture ? undefined : [...plan.furniture].reverse().find((x) => insideFurniture(x, cursor));
  const w = pid || oid || fu ? undefined : hitWall(pos.x, pos.y, tol);
  const st = pid || oid || fu || w ? undefined : [...plan.stairs].reverse().find((x) => insideStair(x, cursor));
  if (pid) {
    selection = { kind: 'point', id: pid };
    drag = { kind: 'point', id: pid, moved: false };
  } else if (oid) {
    selection = { kind: 'opening', id: oid };
    const o = plan.openings.find((x) => x.id === oid)!;
    drag = { kind: 'opening', id: oid, grab: alongWall(o.a, o.b, cursor) - o.at, down: pos, moved: false };
  } else if (fu) {
    selection = { kind: 'furniture', id: fu.id };
    drag = { kind: 'furniture', id: fu.id, from: cursor, start: { x: fu.x, y: fu.y, angle: fu.angle }, down: pos, moved: false };
  } else if (w) {
    selection = { kind: 'wall', a: w.a, b: w.b };
  } else if (st) {
    selection = { kind: 'stair', id: st.id };
    drag = { kind: 'stair', id: st.id, from: cursor, start: { x: st.x, y: st.y }, moved: false };
  } else if (selection?.kind === 'room' && insideRoom(plan, roomIdsOf(plan, selection.loop[0]), cursor)) {
    drag = { kind: 'room', id: selection.loop[0], from: cursor, down: pos, moved: false };
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
  hitTol = e.pointerType === 'touch' ? TOUCH_HIT : 1;
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
      // near another wall, the corner slides along it
      const to = wallUnder(cursor, e.pointerType === 'touch' ? TOUCH_HIT : 1, drag.id)?.at ?? cursor;
      p.x = to.x;
      p.y = to.y;
      p.sensor = { x: to.x, y: to.y };
      drag.moved = true;
    }
    render();
  } else if (drag?.kind === 'stair') {
    const d = drag;
    const st = plan.stairs.find((x) => x.id === d.id);
    if (st) {
      st.x = d.start.x + cursor.x - d.from.x;
      st.y = d.start.y + cursor.y - d.from.y;
      d.moved = true;
    }
    render();
  } else if (drag?.kind === 'furniture') {
    const d = drag;
    const f = plan.furniture.find((x) => x.id === d.id);
    if (f && (d.moved || dist(pos, d.down) > 6)) {
      f.x = d.start.x + cursor.x - d.from.x;
      f.y = d.start.y + cursor.y - d.from.y;
      f.angle = d.start.angle;
      snapToWalls(plan, f, true);
      d.moved = true;
    }
    render();
  } else if (drag?.kind === 'opening') {
    const d = drag;
    const o = plan.openings.find((x) => x.id === d.id);
    // a finger tapping it to select it wobbles a little: that is no move
    if (o && (d.moved || dist(pos, d.down) > 6)) {
      // dragged onto another wall: it moves there
      const w = nearestWall(pos, WALL_HIT * hitTol);
      if (w && !sameWall(w, o.a, o.b) && !joinOf(plan, o.id)) {
        o.a = w.a;
        o.b = w.b;
        d.grab = Math.min(d.grab, o.width);
      }
      const len = dist(pointById(plan, o.a)!, pointById(plan, o.b)!);
      o.width = Math.min(o.width, len);
      o.at = Math.max(0, Math.min(len - o.width, alongWall(o.a, o.b, cursor) - d.grab));
      d.moved = true;
    }
    render();
  } else if (drag?.kind === 'room') {
    if (drag.moved || dist(pos, drag.down) > 6) {
      moveRoom(plan, drag.id, sub(cursor, drag.from));
      drag.from = cursor;
      drag.moved = true;
      render();
    }
  } else if (drag?.kind === 'pan') {
    if (Math.hypot(pos.x - drag.x, pos.y - drag.y) > 3) drag.moved = true;
    view.ox += pos.x - drag.x;
    view.oy += pos.y - drag.y;
    drag.x = pos.x;
    drag.y = pos.y;
    render();
  } else if (tool === 'wall') {
    render();
  } else if (!drag && e.pointerType === 'mouse' && !showGaps) {
    const g = gapAt(pos);
    if (g !== hoverGap) {
      hoverGap = g;
      render();
    }
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
  if ((drag?.kind === 'stair' || drag?.kind === 'furniture') && drag.moved) commit();
  if (drag?.kind === 'room') {
    const moved = drag.moved;
    drag = null;
    showScanMsg(null);
    if (moved) resolve();
    return;
  }
  if (drag?.kind === 'opening' && drag.moved) {
    drag = null;
    resolve(); // a joined door moved: its rooms follow
    return;
  }
  const tapped = drag?.kind === 'pan' && !drag.moved && e.type === 'pointerup';
  drag = null;
  if (moved) resolve();
  if (tapped) tapRoom(eventPos(e));
};

/** Furniture tool: the picked piece where tapped, against the wall when near one. */
function furnitureTap(pos: Vec): void {
  const f = newFurniture(furnitureKind, toWorld(pos.x, pos.y));
  snapToWalls(plan, f, true);
  plan.furniture.push(f);
  tool = null;
  selection = { kind: 'furniture', id: f.id };
  commit();
  render();
  renderUi();
}

/** Stairs tool: a flight centred where tapped, then its panel for the size. */
function stairTap(pos: Vec): void {
  const st = newStair(toWorld(pos.x, pos.y));
  plan.stairs.push(st);
  tool = null;
  selection = { kind: 'stair', id: st.id };
  commit();
  render();
  renderUi();
}

/** The selected room as it is now (walls may have moved or changed since it was tapped). */
function selectedRoom(): string[] | undefined {
  if (selection?.kind !== 'room') return undefined;
  const key = [...selection.loop].sort().join();
  return rooms(plan).find((loop) => [...loop].sort().join() === key);
}

/** A tap on empty floor inside a room selects the room. */
function tapRoom(pos: Vec): void {
  const p = toWorld(pos.x, pos.y);
  const room = roomAt(plan, p);
  if (!room) return;
  selection = { kind: 'room', loop: room };
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
canvas.addEventListener('pointerleave', () => {
  if (!hoverGap) return;
  hoverGap = '';
  render();
});

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    zoomAt(eventPos(e), Math.exp(-e.deltaY * 0.0015));
    render();
  },
  { passive: false }
);

const ARROWS: Record<string, Vec> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };
/** Something was moved with the arrow keys: solved and recorded once the key is let go, not at every repeat. */
let nudged = false;

/**
 * Moves the selection `step` metres the way an arrow key points: a door,
 * window or wall part slides along its wall (the arrow closest to the wall's
 * direction), anything else moves freely. False when nothing selected moves.
 */
function nudge(dir: Vec, step: number): boolean {
  const sel = selection;
  const d = { x: dir.x * step, y: dir.y * step };
  const shift = (p: PlanPoint) => {
    p.x += d.x;
    p.y += d.y;
    p.sensor = { x: p.x, y: p.y };
  };
  if (sel?.kind === 'point') {
    const p = pointById(plan, sel.id);
    if (!p) return false;
    shift(p);
  } else if (sel?.kind === 'wall') {
    for (const id of [sel.a, sel.b]) {
      const p = pointById(plan, id);
      if (p) shift(p);
    }
  } else if (sel?.kind === 'opening') {
    const o = plan.openings.find((x) => x.id === sel.id);
    const a = o && pointById(plan, o.a);
    const b = o && pointById(plan, o.b);
    if (!o || !a || !b) return false;
    const u = unit(sub(b, a));
    const along = dir.x * u.x + dir.y * u.y;
    if (Math.abs(along) < 0.5) return true; // an arrow across the wall: nothing to do, but the key is still used
    o.at = Math.max(0, Math.min(dist(a, b) - o.width, o.at + Math.sign(along) * step));
  } else if (sel?.kind === 'room') {
    moveRoom(plan, sel.loop[0], d);
  } else if (sel?.kind === 'stair' || sel?.kind === 'furniture') {
    const x = sel.kind === 'stair' ? plan.stairs.find((s) => s.id === sel.id) : plan.furniture.find((f) => f.id === sel.id);
    if (!x) return false;
    x.x += d.x;
    x.y += d.y;
  } else {
    return false;
  }
  nudged = true;
  render();
  return true;
}

window.addEventListener('keyup', (e) => {
  if (!nudged || !ARROWS[e.key]) return;
  nudged = false;
  if (selection?.kind === 'stair' || selection?.kind === 'furniture') commit();
  else resolve(); // corners moved: the solver settles them, and joined rooms follow a door
  sheet.dataset.key = '';
  renderUi();
});

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) {
    if (e.key === 'Escape') closeSheet();
    // the panel's number field has the focus but nothing typed in it yet: arrows still move the selection
    const untouched = sheet.contains(e.target) && e.target.value === e.target.defaultValue;
    if (untouched && ARROWS[e.key] && nudge(ARROWS[e.key], e.shiftKey ? 0.1 : 0.01)) e.preventDefault();
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
  if (ARROWS[e.key] && nudge(ARROWS[e.key], e.shiftKey ? 0.1 : 0.01)) {
    e.preventDefault();
    return;
  }
  if (e.key === 'Escape' && (joinFrom || tiePick)) {
    joinFrom = null;
    tiePick = null;
    showScanMsg(null);
    render();
  } else if (e.key === 'Escape' && tool) setTool(null);
  else if (e.key === 'Escape') closeSheet();
  if (e.key !== 'Delete' && e.key !== 'Backspace') return;
  const sel = selection;
  if (sel?.kind === 'point') removePoint(plan, sel.id);
  else if (sel?.kind === 'opening') plan.openings = plan.openings.filter((x) => x.id !== sel.id);
  else if (sel?.kind === 'stair') plan.stairs = plan.stairs.filter((x) => x.id !== sel.id);
  else if (sel?.kind === 'furniture') plan.furniture = plan.furniture.filter((x) => x.id !== sel.id);
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
    await startScan((added, note) => {
      el('scanData').hidden = !hasScanData();
      if (!added) return;
      plan = load();
      selection = null;
      fit();
      resolve();
      if (note) {
        showScanMsg(note);
        setTimeout(() => showScanMsg(null), 10000);
      }
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

/** Asks for the plan's name. False when cancelled. */
function askName(why = ''): boolean {
  const name = prompt(`${why}Name of this plan:`, plan.name ?? '');
  if (name === null) return false;
  if (name.trim()) plan.name = name.trim();
  else delete plan.name;
  commit();
  renderUi();
  return true;
}

el('rename').onclick = () => askName();

function renderGapsToggle(): void {
  el('gaps').lastElementChild!.textContent = showGaps ? '✓' : '';
}
el('gaps').onclick = () => {
  showGaps = !showGaps;
  hoverGap = '';
  try {
    localStorage.setItem('plan3d.showGaps', showGaps ? '1' : '0');
  } catch {
    // storage blocked: the choice lasts until the page is reloaded
  }
  renderGapsToggle();
  render();
};
renderGapsToggle();

function setShowFurniture(on: boolean): void {
  showFurniture = on;
  try {
    localStorage.setItem('plan3d.showFurniture', on ? '1' : '0');
  } catch {
    // storage blocked: the choice lasts until the page is reloaded
  }
  el('furnitureToggle').lastElementChild!.textContent = on ? '✓' : '';
  if (!on && selection?.kind === 'furniture') selection = null;
  if (!el('view3d').hidden) void import('./view3d/view').then((v) => v.show3d(plan3d(), false));
}
el('furnitureToggle').onclick = () => {
  setShowFurniture(!showFurniture);
  render();
  renderUi();
};
setShowFurniture(showFurniture);

el('tool-furniture').onclick = () => {
  const open = tool === 'furniture' || library;
  setTool(null);
  if (open) return;
  library = true;
  renderUi();
};

for (const t of ['wall', 'door', 'window', 'part', 'stair'] as const) {
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
  setDriveFile(null);
  selection = null;
  resolve();
};

function download(text: string, type: string, name: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

// the SVG is a picture of the plan carrying the same JSON, to share or to have an AI edit
el('export').onclick = () => download(planToSvg(plan), 'image/svg+xml', planFileName(plan, 'svg'));
el('exportJson').onclick = () => download(serialize(plan), 'application/json', planFileName(plan, 'json'));

/** A plan read from a file without a name of its own takes the file's ("Flat 2.svg": "Flat 2"). */
function nameFrom(file: string): void {
  const name = nameFromFile(file);
  if (!plan.name && name && name !== 'plan3d') plan.name = name;
}

el('import').onclick = () => el<HTMLInputElement>('file').click();
el<HTMLInputElement>('file').onchange = async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const before = plan;
    plan = readPlanFile(await file.text());
    nameFrom(file.name);
    // another plan (or a copy): Drive saving goes by its name, not into the file loaded before
    if (plan.name !== before.name) setDriveFile(null);
    selection = null;
    fit();
    resolve(); // one undo step: undo goes back to the plan before the import
    showScanMsg(importSummary(before, plan));
  } catch (err) {
    alert(`Could not import:\n${(err as Error).message}`);
  }
};

/** What an import changed, counted: "Imported: 2 walls added, 1 door removed…". */
function importSummary(before: Plan, after: Plan): string {
  const parts: string[] = [];
  const count = (what: string, a: number, b: number) => {
    if (b > a) parts.push(`${b - a} ${what}${b - a > 1 ? 's' : ''} added`);
    if (b < a) parts.push(`${a - b} ${what}${a - b > 1 ? 's' : ''} removed`);
  };
  count('corner', before.points.length, after.points.length);
  count('wall', before.walls.length, after.walls.length);
  count('measurement', before.constraints.length, after.constraints.length);
  count('door or window', before.openings.length, after.openings.length);
  count('room name', before.names.length, after.names.length);
  count('stair', before.stairs.length, after.stairs.length);
  return `Imported${parts.length ? `: ${parts.join(', ')}` : ', same size as before'}. Undo goes back.`;
}

// ---------- 3D view ----------

// three.js only loads when the view is first opened
el('open3d').onclick = async () => (await import('./view3d/view')).show3d(plan3d());
el('close3d').onclick = async () => (await import('./view3d/view')).hide3d();

const heightInput = el<HTMLInputElement>('height3d');
async function setHeight(): Promise<void> {
  const cm = parseFloat(heightInput.value.replace(',', '.'));
  if (cm >= 100 && cm <= 1000 && Math.abs(cm / 100 - (plan.height ?? 0)) > 1e-6) {
    plan.height = Math.round(cm) / 100;
    commit();
  }
  (await import('./view3d/view')).show3d(plan3d(), false);
}
el('heightForm').onsubmit = (e) => {
  e.preventDefault();
  heightInput.blur();
};
heightInput.onchange = () => void setHeight();

// ---------- google drive ----------

if (driveEnabled) {
  el('driveSave').hidden = false;
  el('driveLoad').hidden = false;
}

// the Drive file this plan was loaded from or last saved to
let driveFile = loadDriveFile();
function setDriveFile(file: DriveFile | null): void {
  driveFile = file;
  saveDriveFile(file);
}

el('driveSave').onclick = async () => {
  if (!plan.name && !askName('Saved in Google Drive under its name. ')) return;
  try {
    showScanMsg('Saving to Google Drive…');
    setDriveFile(await saveToDrive(planToSvg(plan), planFileName(plan, 'svg'), driveFile));
    showScanMsg(`Saved to Google Drive as ${driveFile!.name}`);
  } catch (err) {
    showScanMsg(`Could not save: ${(err as Error).message}`);
  }
  setTimeout(() => showScanMsg(null), 3000);
};

el('driveLoad').onclick = async () => {
  try {
    showScanMsg('Loading from Google Drive…');
    const got = pickerEnabled ? await pickFromDrive() : await loadFromDrive();
    if (got === null) return showScanMsg(pickerEnabled ? null : 'No plan saved in Google Drive yet');
    if (plan.points.length && !confirm(`Replace the current plan with ${got.file.name} from Google Drive?`)) {
      return showScanMsg(null);
    }
    plan = readPlanFile(got.text);
    nameFrom(got.file.name);
    // an old .json save becomes an .svg next to it on the next save
    setDriveFile(/\.svg$/i.test(got.file.name) ? got.file : null);
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

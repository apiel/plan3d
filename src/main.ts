import './styles.css';
import {
  Plan,
  Vec,
  addPoint,
  clearDistance,
  cornerNeighbours,
  dist,
  emptyPlan,
  findDistance,
  findRightAngle,
  parse,
  pointById,
  removePoint,
  roomFromCorners,
  serialize,
  setDistance,
  toggleRightAngle,
} from './model';
import { downloadScan, hasScanData, missingForScan, startScan } from './scan';
import { SolveResult, apply, solve } from './solver';
import { load, save } from './storage';

const POINT_HIT = 12; // px
const WALL_HIT = 8; // px

type Selection =
  | { kind: 'point'; id: string }
  | { kind: 'wall'; a: string; b: string }
  | { kind: 'furniture'; id: string }
  | null;
type Drag =
  | { kind: 'point'; id: string; moved: boolean }
  | { kind: 'furniture'; id: string; x: number; y: number; moved: boolean }
  | { kind: 'pan'; x: number; y: number }
  | null;

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = el<HTMLCanvasElement>('canvas');
const ctx = canvas.getContext('2d')!;

let plan: Plan = load();
let view = { scale: 80, ox: 40, oy: 40 };
let selection: Selection = null;
let drag: Drag = null;
let drawing: string[] | null = null; // point ids of the room being drawn
let cursor: Vec = { x: 0, y: 0 };
let lastSolve: SolveResult | null = null;

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
  const scale = Math.min((w - 140) / bw, (h - 140) / bh, 200);
  view = { scale, ox: (w - bw * scale) / 2 - minX * scale, oy: (h - bh * scale) / 2 - minY * scale };
}

// ---------- solving ----------

function resolve(): void {
  if (plan.points.length) {
    lastSolve = solve(plan);
    apply(plan, lastSolve);
  } else {
    lastSolve = null;
  }
  save(plan);
  render();
  renderPanel();
}

// ---------- hit testing ----------

function hitPoint(sx: number, sy: number): string | undefined {
  let best: string | undefined;
  let bestD = POINT_HIT;
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

function hitWall(sx: number, sy: number): { a: string; b: string } | undefined {
  let best: { a: string; b: string } | undefined;
  let bestD = WALL_HIT;
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

function hitFurniture(sx: number, sy: number): string | undefined {
  const w = toWorld(sx, sy);
  // last drawn is on top
  for (let i = plan.furniture.length - 1; i >= 0; i--) {
    const f = plan.furniture[i];
    if (w.x >= f.x && w.x <= f.x + f.w && w.y >= f.y && w.y <= f.y + f.d) return f.id;
  }
  return undefined;
}

// ---------- rendering ----------

function resizeCanvas(): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function label(text: string, at: Vec, color: string, bold: boolean): void {
  ctx.font = `${bold ? 'bold ' : ''}13px system-ui, sans-serif`;
  const w = ctx.measureText(text).width + 8;
  ctx.fillStyle = '#14161acc';
  ctx.fillRect(at.x - w / 2, at.y - 9, w, 18);
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, at.x, at.y);
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

function render(): void {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  ctx.clearRect(0, 0, w, h);
  drawGrid();

  // furniture, under the walls
  for (const f of plan.furniture) {
    const s = toScreen(f);
    const selected = selection?.kind === 'furniture' && selection.id === f.id;
    ctx.fillStyle = selected ? '#1e3a5f' : '#262b34';
    ctx.strokeStyle = selected ? '#60a5fa' : '#4b5563';
    ctx.lineWidth = selected ? 2 : 1;
    ctx.fillRect(s.x, s.y, f.w * view.scale, f.d * view.scale);
    ctx.strokeRect(s.x, s.y, f.w * view.scale, f.d * view.scale);
    if (f.w * view.scale > 50 && f.d * view.scale > 22) {
      label(`${(f.w * 100).toFixed(0)}×${(f.d * 100).toFixed(0)}`, { x: s.x + (f.w * view.scale) / 2, y: s.y + (f.d * view.scale) / 2 }, '#8d95a1', false);
    }
  }

  // walls
  for (const wall of plan.walls) {
    const a = pointById(plan, wall.a);
    const b = pointById(plan, wall.b);
    if (!a || !b) continue;
    const measured = findDistance(plan, wall.a, wall.b) !== undefined;
    const selected = selection?.kind === 'wall' && ((selection.a === wall.a && selection.b === wall.b) || (selection.a === wall.b && selection.b === wall.a));
    const sa = toScreen(a);
    const sb = toScreen(b);
    ctx.lineWidth = selected ? 5 : measured ? 4 : 3;
    ctx.strokeStyle = selected ? '#60a5fa' : measured ? '#4ade80' : '#9aa3b0';
    ctx.setLineDash(measured ? [] : [8, 5]);
    ctx.beginPath();
    ctx.moveTo(sa.x, sa.y);
    ctx.lineTo(sb.x, sb.y);
    ctx.stroke();
    ctx.setLineDash([]);
    const len = dist(a, b);
    label(`${measured ? '' : '~'}${(len * 100).toFixed(0)} cm`, { x: (sa.x + sb.x) / 2, y: (sa.y + sb.y) / 2 }, measured ? '#4ade80' : '#c3c9d2', measured);
  }

  // doors and windows, over their wall
  for (const o of plan.openings) {
    const a = pointById(plan, o.a);
    const b = pointById(plan, o.b);
    if (!a || !b) continue;
    const len = dist(a, b) || 1;
    const at = (d: number) => toScreen({ x: a.x + ((b.x - a.x) * d) / len, y: a.y + ((b.y - a.y) * d) / len });
    const s1 = at(o.at);
    const s2 = at(o.at + o.width);
    const color = o.type === 'door' ? '#f97316' : '#22d3ee';
    ctx.lineWidth = 7;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(s1.x, s1.y);
    ctx.lineTo(s2.x, s2.y);
    ctx.stroke();
    if (o.width * view.scale > 40) {
      label(`${o.type === 'door' ? 'door' : 'window'} ${(o.width * 100).toFixed(0)}`, { x: (s1.x + s2.x) / 2, y: (s1.y + s2.y) / 2 + 16 }, color, false);
    }
  }

  // right-angle markers
  ctx.strokeStyle = '#4ade80';
  ctx.lineWidth = 2;
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

  // draft room
  if (drawing && drawing.length) {
    const last = pointById(plan, drawing[drawing.length - 1])!;
    const sl = toScreen(last);
    const sc = toScreen(cursor);
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = '#60a5fa';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sl.x, sl.y);
    ctx.lineTo(sc.x, sc.y);
    ctx.stroke();
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

// ---------- side panel ----------

function renderPanel(): void {
  const sel = el('selection');
  const measuredWalls = plan.walls.filter((w) => findDistance(plan, w.a, w.b) !== undefined).length;
  const squared = plan.points.filter((p) => findRightAngle(plan, p.id)).length;

  if (drawing) {
    sel.innerHTML = `<h2>Drawing</h2><p class="muted">Click to add corners. Click the first corner to close the room. Esc to cancel.</p>`;
  } else if (selection?.kind === 'wall') {
    const a = pointById(plan, selection.a);
    const b = pointById(plan, selection.b);
    if (a && b) {
      const measured = findDistance(plan, selection.a, selection.b);
      sel.innerHTML = `
        <h2>Wall</h2>
        <p>${(dist(a, b) * 100).toFixed(1)} cm · ${measured !== undefined ? '<span class="ok">measured</span>' : '<span class="muted">estimated</span>'}</p>
        <div class="row">
          <input id="len" type="number" step="0.1" min="1" placeholder="cm" value="${measured !== undefined ? (measured * 100).toFixed(1) : ''}">
          <button id="setLen">Set length</button>
          <button id="clearLen" ${measured === undefined ? 'disabled' : ''}>Clear</button>
        </div>`;
      const input = el<HTMLInputElement>('len');
      const set = () => {
        const cm = parseFloat(input.value);
        if (cm > 0 && selection?.kind === 'wall') {
          setDistance(plan, selection.a, selection.b, cm / 100);
          resolve();
        }
      };
      el('setLen').onclick = set;
      input.onkeydown = (e) => e.key === 'Enter' && set();
      el('clearLen').onclick = () => {
        if (selection?.kind === 'wall') clearDistance(plan, selection.a, selection.b);
        resolve();
      };
    }
  } else if (selection?.kind === 'furniture') {
    const id = selection.id;
    const f = plan.furniture.find((x) => x.id === id);
    if (f) {
      sel.innerHTML = `
        <h2>Furniture</h2>
        <p>${(f.w * 100).toFixed(0)} × ${(f.d * 100).toFixed(0)} cm, ${(f.h * 100).toFixed(0)} cm high</p>
        <div class="row"><button id="delF" class="danger">Delete</button></div>
        <p class="muted">Drag to move it.</p>`;
      el('delF').onclick = () => {
        plan.furniture = plan.furniture.filter((x) => x.id !== id);
        selection = null;
        resolve();
      };
    }
  } else if (selection?.kind === 'point') {
    const id = selection.id;
    const canSquare = cornerNeighbours(plan, id) !== undefined;
    sel.innerHTML = `
      <h2>Corner</h2>
      <div class="row">
        <button id="angle" ${canSquare ? '' : 'disabled'} class="${findRightAngle(plan, id) ? 'on' : ''}">Right angle</button>
        <button id="del" class="danger">Delete corner</button>
      </div>
      <p class="muted">Drag to move it. Click a wall to enter its measured length.</p>`;
    el('angle').onclick = () => {
      toggleRightAngle(plan, id);
      resolve();
    };
    el('del').onclick = () => {
      removePoint(plan, id);
      selection = null;
      resolve();
    };
  } else {
    sel.innerHTML = `<h2>Selection</h2><p class="muted">Click a wall to set its measured length, or a corner to square it. Drag corners to move them, drag the background to pan, scroll to zoom.</p>`;
  }

  const status = el('status');
  const conflicts = lastSolve?.conflicts ?? [];
  status.innerHTML = `
    <h2>Plan</h2>
    <div>${plan.points.length} corners · ${plan.walls.length} walls · ${plan.furniture.length} furniture</div>
    <div>${measuredWalls} measured · ${squared} squared corners</div>
    ${
      conflicts.length
        ? `<div class="warn">Measurements disagree:</div><ul class="conflicts">${conflicts
            .map((c) => {
              const k = c.constraint;
              return k.type === 'distance' ? `<li class="warn">${(k.value * 100).toFixed(1)} cm wall is ${(c.error * 100).toFixed(1)} cm off</li>` : '';
            })
            .join('')}</ul>`
        : ''
    }`;

  el('draw').classList.toggle('on', drawing !== null);
  el('draw').textContent = drawing ? 'Cancel drawing' : 'Draw room';
}

// ---------- interaction ----------

function eventPos(e: PointerEvent | WheelEvent): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function finishDrawing(close: boolean): void {
  if (drawing && close && drawing.length >= 3) {
    plan.walls.push({ a: drawing[drawing.length - 1], b: drawing[0] });
  } else if (drawing) {
    // cancelled or too short: drop the corners that were just added
    for (const id of drawing) removePoint(plan, id);
  }
  drawing = null;
  resolve();
}

canvas.addEventListener('pointerdown', (e) => {
  const pos = eventPos(e);
  cursor = toWorld(pos.x, pos.y);
  canvas.setPointerCapture(e.pointerId);

  if (drawing) {
    if (drawing.length >= 3 && hitPoint(pos.x, pos.y) === drawing[0]) {
      finishDrawing(true);
      return;
    }
    const p = addPoint(plan, toWorld(pos.x, pos.y));
    if (drawing.length) plan.walls.push({ a: drawing[drawing.length - 1], b: p.id });
    drawing.push(p.id);
    render();
    return;
  }

  const pid = hitPoint(pos.x, pos.y);
  if (pid) {
    selection = { kind: 'point', id: pid };
    drag = { kind: 'point', id: pid, moved: false };
  } else {
    const w = hitWall(pos.x, pos.y);
    const fid = w ? undefined : hitFurniture(pos.x, pos.y);
    if (w) {
      selection = { kind: 'wall', a: w.a, b: w.b };
    } else if (fid) {
      selection = { kind: 'furniture', id: fid };
      drag = { kind: 'furniture', id: fid, x: cursor.x, y: cursor.y, moved: false };
    } else {
      selection = null;
      drag = { kind: 'pan', x: pos.x, y: pos.y };
    }
  }
  render();
  renderPanel();
});

canvas.addEventListener('pointermove', (e) => {
  const pos = eventPos(e);
  cursor = toWorld(pos.x, pos.y);
  if (drag?.kind === 'point') {
    const p = pointById(plan, drag.id);
    if (p) {
      p.x = cursor.x;
      p.y = cursor.y;
      p.sensor = { x: cursor.x, y: cursor.y };
      drag.moved = true;
    }
    render();
  } else if (drag?.kind === 'furniture') {
    const f = plan.furniture.find((x) => x.id === (drag as { id: string }).id);
    if (f) {
      f.x += cursor.x - drag.x;
      f.y += cursor.y - drag.y;
      drag.x = cursor.x;
      drag.y = cursor.y;
      drag.moved = true;
    }
    render();
  } else if (drag?.kind === 'pan') {
    view.ox += pos.x - drag.x;
    view.oy += pos.y - drag.y;
    drag.x = pos.x;
    drag.y = pos.y;
    render();
  } else if (drawing) {
    render();
  }
});

canvas.addEventListener('pointerup', () => {
  const moved = drag?.kind === 'point' && drag.moved;
  const movedFurniture = drag?.kind === 'furniture' && drag.moved;
  drag = null;
  if (moved) resolve();
  else if (movedFurniture) save(plan);
});

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const pos = eventPos(e);
    const before = toWorld(pos.x, pos.y);
    view.scale = Math.max(10, Math.min(500, view.scale * Math.exp(-e.deltaY * 0.0015)));
    view.ox = pos.x - before.x * view.scale;
    view.oy = pos.y - before.y * view.scale;
    render();
  },
  { passive: false }
);

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === 'Escape' && drawing) finishDrawing(false);
  if ((e.key === 'Delete' || e.key === 'Backspace') && selection?.kind === 'point') {
    removePoint(plan, selection.id);
    selection = null;
    resolve();
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && selection?.kind === 'furniture') {
    const id = selection.id;
    plan.furniture = plan.furniture.filter((x) => x.id !== id);
    selection = null;
    resolve();
  }
});

window.addEventListener('resize', () => {
  resizeCanvas();
  render();
});

// ---------- toolbar ----------

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

el('scanData').onclick = downloadScan;

el('draw').onclick = () => {
  if (drawing) {
    finishDrawing(false);
  } else {
    selection = null;
    drawing = [];
    render();
    renderPanel();
  }
};

el('sample').onclick = () => {
  // an L-shaped room as a capture would give it: every corner a few cm off
  plan = roomFromCorners([
    { x: 0.04, y: -0.03 },
    { x: 5.06, y: 0.05 },
    { x: 4.97, y: 2.24 },
    { x: 3.03, y: 2.18 },
    { x: 2.95, y: 4.06 },
    { x: -0.04, y: 3.96 },
  ]);
  selection = null;
  fit();
  resolve();
};

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

// ---------- start ----------

resizeCanvas();
fit();
resolve();

// The README screenshots, from the demo plan, with headless Chrome:
//   npx vite-node scripts/demo-plan.ts /tmp/demo.json
//   npm run build && npx vite preview --port 4180 &
//   npm i --no-save puppeteer-core && node scripts/screenshots.mjs /tmp/demo.json http://localhost:4180/
// Writes docs/screenshots/*.png (or into a folder given as a third argument). Set CHROME to the browser's path if it is not /usr/bin/google-chrome.
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';

const [planFile, url, outDir] = process.argv.slice(2);
const out = outDir ? `${outDir.replace(/\/$/, '')}/` : new URL('../docs/screenshots/', import.meta.url).pathname;
const plan = readFileSync(planFile, 'utf8');
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(w, h) {
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 2 });
  await page.goto(url);
  await page.evaluate((p) => {
    localStorage.clear();
    localStorage.setItem('plan3d.plan', p);
  }, plan);
  await page.reload();
  await wait(800);
}

// screen position of a plan point, as the editor's fit() places the 8 x 6 m demo
const at = (x, y) =>
  page.evaluate(
    (x, y) => {
      const c = document.getElementById('canvas');
      const [w, h, bw, bh] = [c.clientWidth, c.clientHeight, 8, 6];
      const s = Math.min((w - 200) / bw, (h - 200) / bh, 200);
      return { x: (w - bw * s) / 2 + x * s, y: (h - bh * s) / 2 + y * s };
    },
    x,
    y
  );

await open(412, 870);
await page.screenshot({ path: `${out}phone-plan.png` });
const win = await at(3.2, -0.05); // the window open below, with the desk in its niche
await page.mouse.click(win.x, win.y);
await wait(400);
await page.screenshot({ path: `${out}phone-window.png` });
await page.click('#close').catch(() => {});
await wait(300);
await page.click('#open3d');
await wait(3000);
await page.screenshot({ path: `${out}phone-3d.png` });

// The scan screen cannot be captured without a phone in AR: this is the real overlay
// (buttons, cross, HUD, mini map) over a drawn room standing in for the camera, with
// marks drawn the way src/scan.ts draws them, halfway through marking a door.
await open(412, 870);
await page.evaluate(() => {
  const W = innerWidth;
  const H = innerHeight;
  const cx = W / 2;
  const cy = H / 2;
  const cam = document.createElement('canvas');
  cam.width = W * 2;
  cam.height = H * 2;
  const g = cam.getContext('2d');
  g.scale(2, 2);
  const poly = (pts, fill) => {
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.fillStyle = fill;
    g.fill();
  };
  const lin = (x0, y0, x1, y1, stops) => {
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    stops.forEach(([o, c]) => gr.addColorStop(o, c));
    return gr;
  };
  // back wall, seen straight on, and the room around it in perspective
  const [bl, br, bt, bb] = [40, 372, 250, 590];
  poly([[0, 0], [W, 0], [br, bt], [bl, bt]], lin(0, 0, 0, bt, [[0, '#cfc8bd'], [1, '#e4ded4']])); // ceiling
  poly([[0, 0], [bl, bt], [bl, bb], [0, H]], lin(0, 0, bl, 0, [[0, '#b9b1a5'], [1, '#d6cfc4']])); // left wall
  poly([[W, 0], [br, bt], [br, bb], [W, H]], lin(W, 0, br, 0, [[0, '#aaa296'], [1, '#cdc6ba']])); // right wall
  poly([[bl, bt], [br, bt], [br, bb], [bl, bb]], lin(0, bt, 0, bb, [[0, '#ebe6dd'], [1, '#ddd6cb']])); // back wall
  poly([[bl, bb], [br, bb], [W, H], [0, H]], lin(0, bb, 0, H, [[0, '#a07a55'], [1, '#7a5638']])); // wooden floor
  g.strokeStyle = '#6b4a2f55';
  g.lineWidth = 1;
  for (let i = -6; i <= 6; i++) {
    g.beginPath();
    g.moveTo(cx + i * 28, bb);
    g.lineTo(cx + i * 70, H);
    g.stroke();
  }
  poly([[bl, bb - 10], [br, bb - 10], [br, bb], [bl, bb]], '#f4f1ea'); // skirting
  // a window, daylight through it
  poly([[222, 315], [342, 315], [342, 455], [222, 455]], '#f7f5f0');
  poly([[230, 323], [334, 323], [334, 447], [230, 447]], lin(0, 323, 0, 447, [[0, '#9cc7ec'], [1, '#dcebf5']]));
  poly([[280, 323], [284, 323], [284, 447], [280, 447]], '#f7f5f0');
  poly([[214, 455], [350, 455], [354, 463], [210, 463]], '#ffffff'); // sill
  // a door, its first side already marked
  poly([[78, 372], [cx, 372], [cx, bb], [78, bb]], '#f5f2ec');
  poly([[86, 380], [cx - 8, 380], [cx - 8, bb], [86, bb]], lin(86, 0, cx, 0, [[0, '#d9d1c4'], [1, '#e9e3d8']]));
  g.fillStyle = '#9b9384';
  g.beginPath();
  g.arc(cx - 22, 492, 4, 0, Math.PI * 2);
  g.fill();
  // a sofa under the window and a plant in the corner
  poly([[232, 520], [370, 520], [372, 600], [230, 600]], '#55606e');
  poly([[226, 552], [380, 552], [384, 612], [222, 612]], '#64707f');
  poly([[50, 545], [70, 545], [66, 590], [54, 590]], '#8a6a4c');
  g.fillStyle = '#4f7a4b';
  for (const [x, y, r] of [[60, 520, 18], [48, 505, 13], [72, 500, 14], [60, 488, 12]]) {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const overlay = document.getElementById('scanOverlay');
  overlay.style.background = `url(${cam.toDataURL()}) center / cover`;
  overlay.classList.add('on');

  // marks over the camera, as drawMarks draws them
  const ar = document.getElementById('arDraw');
  ar.width = W * 2;
  ar.height = H * 2;
  const a = ar.getContext('2d');
  a.scale(2, 2);
  a.lineCap = 'round';
  a.fillStyle = '#f472b6'; // corners
  for (const [x, y] of [[bl, bb], [br, bb], [bl, bt], [br, bt]]) {
    a.beginPath();
    a.arc(x, y, 8, 0, Math.PI * 2);
    a.fill();
  }
  a.strokeStyle = '#22d3ee'; // the window, marked
  a.lineWidth = 6;
  a.beginPath();
  a.moveTo(222, 470);
  a.lineTo(342, 470);
  a.stroke();
  a.strokeStyle = '#f59e0b'; // the door: first side, then dashed to the cross
  a.lineWidth = 5;
  a.setLineDash([12, 8]);
  a.beginPath();
  a.moveTo(78, cy);
  a.lineTo(cx, cy);
  a.stroke();
  a.setLineDash([]);
  a.fillStyle = '#f59e0b';
  a.beginPath();
  a.arc(78, cy, 8, 0, Math.PI * 2);
  a.fill();

  document.getElementById('cross').classList.add('ok');
  document.getElementById('aimText').textContent = 'door 83 cm';
  document.getElementById('hud').textContent =
    '86 views · 52.4k points · 4 corners · 1 doors/windows\nDoor: first side set. Aim at the wall just beside the other side and tap "Door 2nd side", or "Cancel door".';
  const door = document.getElementById('markDoor');
  door.textContent = 'Door 2nd side';
  door.classList.add('pending');
  const remove = document.getElementById('markRemove');
  remove.textContent = 'Cancel door';
  remove.classList.add('pending');

  // the mini map: wall-height points seen so far, the phone, the marks
  const map = document.getElementById('map');
  const m = map.getContext('2d');
  const S = 25;
  const [ox, oy] = [100 - 2.3 * S, 100 - 3 * S]; // a 4.6 x 6 m room
  let seed = 3;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  m.fillStyle = '#4ade80';
  const seen = [[[0, 0], [4.6, 0], 1], [[4.6, 0], [4.6, 6], 0.8], [[0, 0], [0, 6], 1], [[0, 6], [2.2, 6], 1]];
  for (const [[x0, y0], [x1, y1], part] of seen) {
    for (let i = 0; i < 160 * part; i++) {
      const t = rand() * part;
      m.fillRect(ox + (x0 + (x1 - x0) * t) * S + (rand() - 0.5) * 3, oy + (y0 + (y1 - y0) * t) * S + (rand() - 0.5) * 3, 2, 2);
    }
  }
  m.fillStyle = '#f472b6';
  for (const [x, y] of [[0, 0], [4.6, 0], [0, 6], [4.6, 6]]) m.fillRect(ox + x * S - 3, oy + y * S - 3, 6, 6);
  m.strokeStyle = '#22d3ee';
  m.lineWidth = 3;
  m.beginPath();
  m.moveTo(ox + 2.6 * S, oy);
  m.lineTo(ox + 3.8 * S, oy);
  m.stroke();
  m.fillStyle = '#f59e0b';
  m.beginPath();
  m.arc(ox + 0.6 * S, oy, 3, 0, Math.PI * 2);
  m.fill();
  const [px, py, ang] = [ox + 2.2 * S, oy + 3.6 * S, -Math.PI / 2];
  m.fillStyle = '#facc15';
  m.beginPath();
  m.moveTo(px + Math.cos(ang) * 9, py + Math.sin(ang) * 9);
  m.lineTo(px + Math.cos(ang + 2.5) * 6, py + Math.sin(ang + 2.5) * 6);
  m.lineTo(px + Math.cos(ang - 2.5) * 6, py + Math.sin(ang - 2.5) * 6);
  m.fill();
});
await wait(300);
await page.screenshot({ path: `${out}phone-scan.png` });

await open(1280, 800);
await page.screenshot({ path: `${out}desktop-plan.png` });
await page.click('#open3d');
await wait(3000);
await page.screenshot({ path: `${out}desktop-3d.png` });
await browser.close();

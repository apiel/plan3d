// The README's scan figure: a simulated scan of an L-shaped room (a sofa in it,
// an open doorway to a corridor) put through the real extraction, drawn as the
// depth points seen from above next to the room that comes out.
//
//   npx vite-node scripts/scan-figure.ts     (writes docs/scan.svg)

import { writeFileSync } from 'node:fs';
import { Vec } from '../src/model';
import { extractRoom } from '../src/scan/extract';
import { scan } from '../src/scan/simulate';

const room: Vec[] = [
  { x: 0, y: 0 },
  { x: 5, y: 0 },
  { x: 5, y: 2.8 },
  { x: 3, y: 2.8 },
  { x: 3, y: 4.2 },
  { x: 0, y: 4.2 },
];
const sofa = { x: 0.25, z: 1.2, w: 0.9, d: 2.0, h: 0.8 };
const doorway = { a: { x: 1.0, y: 4.2 }, b: { x: 1.9, y: 4.2 }, bottom: 0, top: 2.05, beyond: [{ x: 0, y: 4.2 }, { x: 3, y: 4.2 }, { x: 3, y: 6 }, { x: 0, y: 6 }] };
const walk: Vec[] = [
  { x: 1.6, y: 1.0 },
  { x: 2.6, y: 0.9 },
  { x: 3.7, y: 1.2 },
  { x: 4.3, y: 2.0 },
  { x: 3.2, y: 2.0 },
  { x: 2.1, y: 2.4 },
  { x: 1.8, y: 3.4 },
];
const frames = scan(room, 2.5, walk, 0.03, 1.4, [sofa], [doorway]);
const result = extractRoom(frames)!;

const S = 64; // px per metre
const PAD = 40;
const TOP = 70;
const BG = '#14161a';
const f1 = (n: number) => n.toFixed(1);
const out: string[] = [];

// left: the depth points from above, coloured by height
const pts: { x: number; z: number; y: number }[] = [];
for (const f of frames) for (let i = 0; i < f.points.length; i += 3) pts.push({ x: f.points[i], y: f.points[i + 1], z: f.points[i + 2] });
const minX = Math.min(...pts.map((p) => p.x));
const minZ = Math.min(...pts.map((p) => p.z));
const rawW = (Math.max(...pts.map((p) => p.x)) - minX) * S;
const rawH = (Math.max(...pts.map((p) => p.z)) - minZ) * S;
const L = (x: number) => PAD + (x - minX) * S;
const T = (z: number) => TOP + (z - minZ) * S;
// one path of small squares per colour keeps the file small; floor and ceiling are everywhere and say nothing
const dots = new Map<string, string[]>();
for (const p of pts) {
  if (p.y < 0.05 || p.y > 2.45) continue;
  const color = p.y > 1.5 ? '#4ade80' : p.y > 0.9 ? '#60a5fa' : '#8d95a1';
  dots.set(color, [...(dots.get(color) ?? []), `M${Math.round(L(p.x))} ${Math.round(T(p.z))}h2v2h-2z`]);
}
for (const [color, d] of dots) out.push(`<path d="${d.join('')}" fill="${color}" fill-opacity=".6"/>`);
out.push(`<polyline points="${walk.map((c) => `${f1(L(c.x))},${f1(T(c.y))}`).join(' ')}" fill="none" stroke="#f87171" stroke-width="2" stroke-dasharray="5 4"/>`);
for (const c of walk) out.push(`<circle cx="${f1(L(c.x))}" cy="${f1(T(c.y))}" r="4.5" fill="#f87171"/>`);

// right: the extracted room, the way the editor draws it
const xs = result.corners.map((p) => p.x);
const ys = result.corners.map((p) => p.y);
const ox = PAD + rawW + 210 - Math.min(...xs) * S;
const oy = TOP + (rawH - (Math.max(...ys) - Math.min(...ys)) * S) / 2 - Math.min(...ys) * S;
const R = (p: Vec) => `${f1(ox + p.x * S)},${f1(oy + p.y * S)}`;
const rightEdge = ox + Math.max(...xs) * S;
out.push(`<polygon points="${result.corners.map(R).join(' ')}" fill="#1d2129" stroke="#2f3540" stroke-width="14" stroke-linejoin="miter"/>`);
out.push(`<polygon points="${result.corners.map(R).join(' ')}" fill="none" stroke="#e6e8eb" stroke-width="3"/>`);
for (const b of result.furniture) {
  out.push(`<rect x="${f1(ox + b.x * S)}" y="${f1(oy + b.y * S)}" width="${f1(b.w * S)}" height="${f1(b.d * S)}" rx="4" fill="#1d2129" stroke="#9aa3b0" stroke-width="1.5"/>`);
}
const n = result.corners.length;
const inside = (v: Vec) => {
  let yes = false;
  result.corners.forEach((a, i) => {
    const b = result.corners[(i + 1) % n];
    if (a.y > v.y !== b.y > v.y && v.x < a.x + ((v.y - a.y) * (b.x - a.x)) / (b.y - a.y)) yes = !yes;
  });
  return yes;
};
result.corners.forEach((p, i) => {
  const q = result.corners[(i + 1) % n];
  const len = Math.hypot(q.x - p.x, q.y - p.y);
  // the label goes on the side of the wall outside the room
  let [nx, ny] = [-(q.y - p.y) / len, (q.x - p.x) / len];
  if (inside({ x: (p.x + q.x) / 2 + nx * 0.1, y: (p.y + q.y) / 2 + ny * 0.1 })) [nx, ny] = [-nx, -ny];
  // beside an upright wall the text starts (or ends) at the band, above or below one it is centred
  const upright = Math.abs(nx) > 0.7;
  const k = upright ? 16 : 24;
  const mx = ox + ((p.x + q.x) / 2) * S + nx * k;
  const my = oy + ((p.y + q.y) / 2) * S + ny * k + 5;
  const anchor = upright ? (nx > 0 ? 'start' : 'end') : 'middle';
  out.push(`<text x="${f1(mx)}" y="${f1(my)}" fill="#8d95a1" font-size="14" text-anchor="${anchor}">~${Math.round(len * 100)} cm</text>`);
});
for (const o of result.openings) {
  const p = result.corners[o.wall];
  const q = result.corners[(o.wall + 1) % n];
  const len = Math.hypot(q.x - p.x, q.y - p.y);
  const at = (d: number): Vec => ({ x: p.x + ((q.x - p.x) * d) / len, y: p.y + ((q.y - p.y) * d) / len });
  out.push(`<line x1="${f1(ox + at(o.from).x * S)}" y1="${f1(oy + at(o.from).y * S)}" x2="${f1(ox + at(o.to).x * S)}" y2="${f1(oy + at(o.to).y * S)}" stroke="${BG}" stroke-width="16"/>`);
  out.push(`<line x1="${f1(ox + at(o.from).x * S)}" y1="${f1(oy + at(o.from).y * S)}" x2="${f1(ox + at(o.to).x * S)}" y2="${f1(oy + at(o.to).y * S)}" stroke="#fbbf24" stroke-width="4"/>`);
}

// arrow between, titles, legend
const arrowX = PAD + rawW + 45;
const midY = TOP + rawH / 2;
out.push(`<path d="M${arrowX} ${midY}h60m-12-10 12 10-12 10" fill="none" stroke="#3b82f6" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`);
const W = Math.max(rightEdge + PAD + 70, PAD * 2 + rawW);
const H = TOP + Math.max(rawH, (Math.max(...ys) - Math.min(...ys)) * S) + 80;
const title = (x: number, text: string, sub: string) =>
  `<text x="${f1(x)}" y="30" fill="#e6e8eb" font-size="18" font-weight="600">${text}</text><text x="${f1(x)}" y="52" fill="#8d95a1" font-size="13">${sub}</text>`;
const total = frames.reduce((s, f) => s + f.points.length / 3, 0);
out.push(title(PAD, 'What the phone sees', `${total.toLocaleString('en')} depth points from ${walk.length} spots, seen from above`));
out.push(title(ox + Math.min(...xs) * S - 20, 'What plan3d makes of it', 'walls, the sofa it saw, and the open doorway it found'));
const legend: [string, string][] = [
  ['#4ade80', 'near the ceiling: walls'],
  ['#60a5fa', 'chest height'],
  ['#8d95a1', 'low: furniture'],
  ['#f87171', 'where the phone was'],
];
legend.forEach(([c, t], i) => {
  const x = PAD + i * 190;
  out.push(`<circle cx="${x + 5}" cy="${H - 30}" r="5" fill="${c}"/><text x="${x + 16}" y="${H - 25}" fill="#8d95a1" font-size="13">${t}</text>`);
});

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(W)}" height="${Math.ceil(H)}" viewBox="0 0 ${Math.ceil(W)} ${Math.ceil(H)}" font-family="system-ui, -apple-system, Segoe UI, sans-serif"><rect width="100%" height="100%" rx="12" fill="${BG}"/>${out.join('')}</svg>\n`;
writeFileSync(new URL('../docs/scan.svg', import.meta.url), svg);
console.log(`docs/scan.svg: ${result.corners.length} corners, ${result.furniture.length} furniture, ${result.openings.length} openings, ${(svg.length / 1024).toFixed(0)} kB`);

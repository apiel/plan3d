// Replays a scan data file (downloaded from scan.html) through the room
// extraction and writes an SVG next to it, to debug and tune on a computer.
//
//   npm run replay -- scan-2026-10-27-10-00-00.json

import { readFileSync, writeFileSync } from 'node:fs';
import { Keyframe, extractRoom } from '../src/scan/extract';

const file = process.argv[2];
if (!file) {
  console.error('usage: npm run replay -- <scan.json>');
  process.exit(1);
}
const raw = JSON.parse(readFileSync(file, 'utf8')) as { frames: { cam: number[]; points: number[] }[] };
const frames: Keyframe[] = raw.frames.map((f) => ({ cam: [f.cam[0], f.cam[1], f.cam[2]], points: Float32Array.from(f.points) }));
const total = frames.reduce((n, f) => n + f.points.length / 3, 0);
console.log(`${frames.length} keyframes, ${total} points`);

const t0 = performance.now();
const room = extractRoom(frames);
console.log(`extracted in ${(performance.now() - t0).toFixed(0)} ms`);
if (!room) {
  console.log('no room found');
  process.exit(0);
}
console.log(`floor ${room.floorY.toFixed(2)} m, ceiling ${room.ceilingY.toFixed(2)} m, height ${(room.ceilingY - room.floorY).toFixed(2)} m`);
console.log('walls (cm):', room.corners.map((p, i) => Math.round(Math.hypot(room.corners[(i + 1) % room.corners.length].x - p.x, room.corners[(i + 1) % room.corners.length].y - p.y) * 100)).join(', '));
for (const f of room.furniture) console.log(`furniture ${Math.round(f.w * 100)}×${Math.round(f.d * 100)} cm, ${Math.round(f.h * 100)} cm high at (${f.x.toFixed(2)}, ${f.y.toFixed(2)})`);

// left: raw top-down points (grey all, green near wall height); right: result
const S = 60;
const xs: number[] = [];
const zs: number[] = [];
for (const f of frames) for (let i = 0; i < f.points.length; i += 3) {
  xs.push(f.points[i]);
  zs.push(f.points[i + 2]);
}
const minX = Math.min(...xs);
const minZ = Math.min(...zs);
const rawW = (Math.max(...xs) - minX) * S + 20;
const rawH = (Math.max(...zs) - minZ) * S + 20;
const dots: string[] = [];
frames.forEach((f) => {
  for (let i = 0; i < f.points.length; i += 9) {
    const y = f.points[i + 1] - room.floorY;
    const color = y > 1.4 ? '#16a34a' : y < 0.1 ? '#d1d5db' : '#9ca3af';
    dots.push(`<circle cx="${((f.points[i] - minX) * S + 10).toFixed(1)}" cy="${((f.points[i + 2] - minZ) * S + 10).toFixed(1)}" r="0.8" fill="${color}"/>`);
  }
  dots.push(`<circle cx="${((f.cam[0] - minX) * S + 10).toFixed(1)}" cy="${((f.cam[2] - minZ) * S + 10).toFixed(1)}" r="2" fill="#dc2626"/>`);
});
const ox = rawW + 40;
const poly = room.corners.map((p) => `${(p.x * S + ox).toFixed(1)},${(p.y * S + 10).toFixed(1)}`).join(' ');
const boxes = room.furniture
  .map((f) => `<rect x="${(f.x * S + ox).toFixed(1)}" y="${(f.y * S + 10).toFixed(1)}" width="${(f.w * S).toFixed(1)}" height="${(f.d * S).toFixed(1)}" fill="#e5e7eb" stroke="#6b7280"/>`)
  .join('');
const resW = Math.max(...room.corners.map((p) => p.x)) * S + 20;
const resH = Math.max(...room.corners.map((p) => p.y)) * S + 20;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${(ox + resW).toFixed(0)}" height="${Math.max(rawH, resH).toFixed(0)}" style="background:#fff">${dots.join('')}${boxes}<polygon points="${poly}" fill="none" stroke="#2563eb" stroke-width="3"/></svg>`;
const out = file.replace(/\.json$/, '') + '.svg';
writeFileSync(out, svg);
console.log(`wrote ${out}`);

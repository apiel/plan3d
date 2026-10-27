// Replays a scan data file (downloaded from the editor after a scan) through the room
// extraction and writes an SVG next to it, to debug and tune on a computer.
//
//   npm run replay -- scan-2026-10-27-10-00-00.json

import { readFileSync, writeFileSync } from 'node:fs';
import { Keyframe, Marks, extractRoom } from '../src/scan/extract';

const file = process.argv[2];
if (!file) {
  console.error('usage: npm run replay -- <scan.json>');
  process.exit(1);
}
const raw = JSON.parse(readFileSync(file, 'utf8')) as { frames: { cam: number[]; points: number[] }[]; marks?: Marks };
const frames: Keyframe[] = raw.frames.map((f) => ({ cam: [f.cam[0], f.cam[1], f.cam[2]], points: Float32Array.from(f.points) }));
const marks: Marks = raw.marks ?? { corners: [], openings: [] }; // version 1 files have none
const total = frames.reduce((n, f) => n + f.points.length / 3, 0);
console.log(`${frames.length} keyframes, ${total} points, ${marks.corners.length} corners and ${marks.openings.length} doors/windows marked`);

const t0 = performance.now();
const room = extractRoom(frames, marks);
console.log(`extracted in ${(performance.now() - t0).toFixed(0)} ms`);
if (!room) {
  console.log('no room found');
  process.exit(0);
}
console.log(`floor ${room.floorY.toFixed(2)} m, ceiling ${room.ceilingY.toFixed(2)} m, height ${(room.ceilingY - room.floorY).toFixed(2)} m`);
console.log('walls (cm):', room.corners.map((p, i) => Math.round(Math.hypot(room.corners[(i + 1) % room.corners.length].x - p.x, room.corners[(i + 1) % room.corners.length].y - p.y) * 100)).join(', '));
for (const o of room.openings) console.log(`${o.type} ${Math.round((o.to - o.from) * 100)} cm on wall ${o.wall}, ${Math.round(o.from * 100)} cm from its start`);
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
// marks on the raw side: corners pink, doors blue, windows cyan
const rx = (x: number) => ((x - minX) * S + 10).toFixed(1);
const rz = (z: number) => ((z - minZ) * S + 10).toFixed(1);
for (const c of marks.corners) dots.push(`<rect x="${(+rx(c[0]) - 4).toFixed(1)}" y="${(+rz(c[2]) - 4).toFixed(1)}" width="8" height="8" fill="#db2777"/>`);
for (const o of marks.openings) {
  dots.push(`<line x1="${rx(o.a[0])}" y1="${rz(o.a[2])}" x2="${rx(o.b[0])}" y2="${rz(o.b[2])}" stroke="${o.type === 'door' ? '#2563eb' : '#0891b2'}" stroke-width="4"/>`);
}
const ox = rawW + 40;
const poly = room.corners.map((p) => `${(p.x * S + ox).toFixed(1)},${(p.y * S + 10).toFixed(1)}`).join(' ');
const boxes = room.furniture
  .map((f) => `<rect x="${(f.x * S + ox).toFixed(1)}" y="${(f.y * S + 10).toFixed(1)}" width="${(f.w * S).toFixed(1)}" height="${(f.d * S).toFixed(1)}" fill="#e5e7eb" stroke="#6b7280"/>`)
  .join('');
const openings = room.openings
  .map((o) => {
    const p = room.corners[o.wall];
    const q = room.corners[(o.wall + 1) % room.corners.length];
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    const at = (d: number) => [(p.x + ((q.x - p.x) * d) / len) * S + ox, (p.y + ((q.y - p.y) * d) / len) * S + 10];
    const [x1, y1] = at(o.from);
    const [x2, y2] = at(o.to);
    return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${o.type === 'door' ? '#f97316' : '#06b6d4'}" stroke-width="7"/>`;
  })
  .join('');
const resW = Math.max(...room.corners.map((p) => p.x)) * S + 20;
const resH = Math.max(...room.corners.map((p) => p.y)) * S + 20;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${(ox + resW).toFixed(0)}" height="${Math.max(rawH, resH).toFixed(0)}" style="background:#fff">${dots.join('')}${boxes}<polygon points="${poly}" fill="none" stroke="#2563eb" stroke-width="3"/>${openings}</svg>`;
const out = file.replace(/\.json$/, '') + '.svg';
writeFileSync(out, svg);
console.log(`wrote ${out}`);

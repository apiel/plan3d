// A made-up flat for the README screenshots (never put a real plan in this public repo).
// npx vite-node scripts/demo-plan.ts demo.json
import { writeFileSync } from 'node:fs';
import { addPoint, emptyPlan, serialize, setDistance, toggleRightAngle } from '../src/model';
import { newFurniture, snapToWalls } from '../src/furniture';

const plan = emptyPlan();
plan.name = 'Demo flat';
plan.height = 2.6;
const P = (x: number, y: number) => addPoint(plan, { x, y }).id;
const A = P(0, 0), B = P(4.6, 0), C = P(8, 0), D = P(8, 3.4), E = P(8, 6), F = P(4.6, 6), G = P(0, 6), H = P(4.6, 3.4);
const wall = (a: string, b: string, thickness: number) => plan.walls.push({ a, b, thickness });
wall(A, B, 0.4); wall(B, C, 0.4); wall(C, D, 0.4); wall(D, E, 0.4); wall(E, F, 0.4); wall(F, G, 0.4); wall(G, A, 0.4);
wall(B, H, 0.1); wall(H, F, 0.1); wall(H, D, 0.1);
setDistance(plan, A, B, 4.6); setDistance(plan, G, A, 6); setDistance(plan, B, C, 3.4); setDistance(plan, H, D, 3.4);
for (const p of [A, C, E, G]) toggleRightAngle(plan, p);

let n = 0;
const o = (type: 'door' | 'window', a: string, b: string, at: number, width: number, extra = {}) =>
  plan.openings.push({ id: `o${n++}`, type, a, b, at, width, measured: true, ...extra });
o('window', A, B, 0.7, 1.4, { frameAt: 0.25 });
o('window', A, B, 2.6, 1.2, { frameAt: 0.25, niche: true });
o('window', G, A, 1.4, 1.2, { frameAt: 0.25 });
o('window', B, C, 1.0, 1.4, { frameAt: 0.25 });
o('window', D, E, 0.9, 0.8, { frameAt: 0.25 });
o('door', B, H, 2.2, 0.8, { hingeAtB: true });
o('door', H, F, 0.5, 0.8);
o('door', F, G, 0.3, 0.9, { outward: false });

const put = (kind: string, x: number, y: number, angle = 0, back = true) => {
  const f = { ...newFurniture(kind, { x, y }), angle };
  snapToWalls(plan, f, back);
  plan.furniture.push(f);
  return f;
};
// living room
const sofa = newFurniture('sofa3', { x: 2.1, y: 2.75 });
sofa.angle = 180;
plan.furniture.push(sofa);
plan.furniture.push(newFurniture('coffeeTable', { x: 2.1, y: 1.85 }));
put('tvUnit', 1.4, 0.3);
put('armchair', 0.5, 1.9, 270);
put('plant', 4.2, 0.3, 0, false);
put('desk', 3.2, 0.2); // into the niche under the window
const chair = newFurniture('officeChair', { x: 3.2, y: 0.75 });
plan.furniture.push(chair);
// kitchen along the bottom wall, dining table
put('kitchenSink', 0.6, 5.8, 180); put('dishwasher', 1.3, 5.8, 180); put('counter', 1.9, 5.8, 180); put('hob', 2.5, 5.8, 180); put('fridge', 3.1, 5.8, 180);
plan.furniture.push(newFurniture('roundTable', { x: 1.5, y: 4.2 }));
for (const [x, y, a] of [[0.75, 4.2, 270], [2.25, 4.2, 90], [1.5, 3.45, 0], [1.5, 4.95, 180]] as const) {
  const c = newFurniture('chair', { x, y });
  c.angle = a;
  plan.furniture.push(c);
}
// bedroom
put('bedQueen', 6.3, 0.2);
put('bedside', 5.2, 0.2); put('bedside', 7.4, 0.2);
put('wardrobe', 7.7, 2.6, 270);
// bathroom
put('bath', 6.9, 5.8, 180);
put('wc', 7.8, 4.0, 270);
put('basin', 6.0, 3.6);
put('washer', 5.0, 5.2, 90);

plan.names.push({ name: 'Living room', x: 3.4, y: 1.4 }, { name: 'Bedroom', x: 6.0, y: 2.7 }, { name: 'Bathroom', x: 6.3, y: 4.7 });
writeFileSync(process.argv[2], serialize(plan));

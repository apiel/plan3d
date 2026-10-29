// The plan as a file: an SVG picture of it that carries the plan itself (the
// same JSON as `serialize`) in <metadata>, with instructions for an AI asked
// to edit it. The app only ever reads the JSON back; the picture is a preview.

import { Plan, Vec, Wall, constraintIds, dist, parse, pointById, serialize, wallThickness, windowFrame } from './model';
import { groupLoop, insideLoop, insideRoom, loopArea, loopWalls, openingFrame, roomIdsOf, roomName, roomOutline, rooms, spotInside } from './rooms';
import { stairCorners, stairTreads } from './stairs';
import { LIBRARY, furnitureItem, symbolSvg } from './furniture';

const DATA_ID = 'plan3d-data';

/** For an AI assistant asked to change the plan. An XML comment: no double hyphens in here. */
const INSTRUCTIONS = `
PLAN3D FLOOR PLAN (file format version 1)

This SVG is a floor plan made with the plan3d app. The plan itself is the JSON
inside <metadata id="${DATA_ID}"> below. The drawing is only a preview: the app
ignores it and redraws everything from the JSON.

If you are an AI assistant asked to change this plan:
  * Change the JSON in the metadata. Then give back the WHOLE file (the drawing
    may stay as it was), so the user can save it as .svg and import it in plan3d.
    Giving back only the JSON, as a .json file, works too.
  * Do not change anything you were not asked to. Keep every existing id.

The JSON:
  * Units are metres, angles degrees. x goes right, y goes DOWN.
  * name: the project's name (optional), also used as the file name.
  * height: floor to ceiling in metres (optional, default 2.5).
  * points: corners {id, x, y, sensor: {x, y}}. sensor is where the camera put the
    corner; for a new corner, make sensor the same as x, y.
  * walls: {a, b, thickness?, color?}: a straight wall between corners a and b. The
    line a-b is the face of the wall inside the room; thickness (default 0.1) grows
    outwards, away from the room.
  * Rooms are not stored: a room is any area closed in by walls. A wall that ends
    on another wall must end on a corner of it: split that wall (replace a-b by a-p
    and p-b, same thickness and color) and add
    {"type": "parallel", "a": a, "b": p, "c": p, "d": b} to keep its halves in line.
  * constraints: measurements the app holds exactly; coordinates are only a first
    guess that the app corrects to fit them:
      {"type": "distance", a, b, value}       corners a and b are value metres apart
      {"type": "rightAngle", a, b, c}         the angle at corner b, between a and c, is 90
      {"type": "angle", a, b, c, value}       the same, at another angle
      {"type": "parallel", a, b, c, d}        wall a-b runs parallel to wall c-d
      {"type": "equal", a, b, c, d}           wall a-b is as long as wall c-d
    PREFER ADDING CONSTRAINTS TO COMPUTING COORDINATES: put a new corner roughly
    where it goes and add the distances and right angles the user gave; the app
    works out the exact positions.
  * openings: {id, type, a, b, at, width, measured?, hingeAtB?, outward?, noLeaf?, frameAt?, niche?, color?}
    in the wall between corners a and b, starting at metres from a, width metres
    wide. type is door, window, or part (a stretch of the wall shown in its color,
    for example to demolish). hingeAtB: the door hangs at the b end. outward: it
    opens out of the room. noLeaf: a doorway with only its frame. measured: the
    width was measured, keep it. frameAt: metres from the wall's face inside the
    room to the window frame (centred in the wall when missing). niche: under the
    window the wall is open down to the floor between the room and the frame.
  * joins: {a, b}: two doors (opening ids), in two rooms, that are the same door.
  * stairs: {id, x, y, width, length, angle, steps, bottom, top}: a flight whose
    straight part is centred on x, y, turned by angle, going up towards its
    length. bottom and top, "left" or "right" (or missing for straight): the
    stairs turn a quarter turn that way at that end, going up, with 3 winder
    steps in a square as wide as the flight beyond the straight part. steps
    counts them all. down: true when the stairs go down to the floor under this
    one, with their top at this floor (the 3D view cuts a hole in the floor for
    them); missing: they go up to the floor above.
  * names: {name, x, y}: a room's name, at a spot inside that room.
  * color: "#rrggbb". What a colour means is up to the user (for example red for
    walls to remove, orange for walls to build).
  * furniture: {id, kind, x, y, w, d, h, angle}: a piece of furniture centred on
    x, y, w wide, d deep (back to front), h high, turned by angle degrees (at 0
    its back faces -y). kind is one of: ${LIBRARY.map((i) => i.kind).join(', ')}.
  * version: leave as it is.

Rules:
  * New ids: any short text not used yet, for example "n1", "n2".
  * Everything a wall, constraint, opening or join refers to must exist. Removing a
    corner means removing its walls, constraints and openings too.
  * Valid JSON only: no comments, no trailing commas. Inside the metadata, write
    the characters & < > as &amp; &lt; &gt; (or leave them out).
`;

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unxml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

/** Plan metres to drawing units (cm), rounded. */
const cm = (m: number) => Math.round(m * 1000) / 10;
const num = (x: number) => +x.toFixed(2);
const pt = (p: Vec) => `${cm(p.x)},${cm(p.y)}`;
const poly = (pts: Vec[]) => `M${pts.map(pt).join('L')}Z`;

/** The band of a wall, outwards (away from its room) by its thickness. */
function band(plan: Plan, w: Wall): Vec[] | undefined {
  const a = pointById(plan, w.a);
  const b = pointById(plan, w.b);
  if (!a || !b) return undefined;
  const len = dist(a, b) || 1;
  let n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
  if (insideRoom(plan, roomIdsOf(plan, w.a), { x: (a.x + b.x) / 2 + n.x * 0.05, y: (a.y + b.y) / 2 + n.y * 0.05 })) n = { x: -n.x, y: -n.y };
  const t = wallThickness(plan, w.a, w.b);
  return [a, b, { x: b.x + n.x * t, y: b.y + n.y * t }, { x: a.x + n.x * t, y: a.y + n.y * t }];
}

/** The plan drawn as an SVG file, carrying the plan's JSON and the instructions above. */
export function planToSvg(plan: Plan): string {
  const all: Vec[] = [...plan.points, ...plan.stairs.flatMap(stairCorners)];
  const pad = 0.8;
  const minX = all.length ? Math.min(...all.map((p) => p.x)) - pad : 0;
  const minY = all.length ? Math.min(...all.map((p) => p.y)) - pad : 0;
  const w = all.length ? Math.max(...all.map((p) => p.x)) + pad - minX : 4;
  const h = all.length ? Math.max(...all.map((p) => p.y)) + pad - minY : 3;
  const out: string[] = [];

  // walls: bands, mitred round each group when it can be, then a strip for each wall inside a group
  const done = new Set<Wall>();
  const groups = new Map<string, Set<string>>();
  for (const p of plan.points) groups.set([...roomIdsOf(plan, p.id)].sort().join(), roomIdsOf(plan, p.id));
  for (const ids of groups.values()) {
    const o = roomOutline(plan, ids);
    if (!o) continue;
    out.push(`<path d="${poly(o.outer)}${poly(o.inner)}" fill="#3a3f47" fill-rule="evenodd"/>`);
    for (const wall of loopWalls(plan, groupLoop(plan, ids)!)) done.add(wall);
  }
  for (const wall of plan.walls) {
    const q = !done.has(wall) && band(plan, wall);
    if (q) out.push(`<path d="${poly(q)}" fill="#3a3f47"/>`);
  }
  for (const wall of plan.walls) {
    const q = wall.color && band(plan, wall);
    if (q) out.push(`<path d="${poly(q)}" fill="${xml(wall.color!)}" fill-opacity=".7" stroke="${xml(wall.color!)}" stroke-width="1"/>`);
  }

  // doors, windows and parts of walls
  for (const o of plan.openings) {
    const g = openingFrame(plan, o);
    if (!g) continue;
    const t = wallThickness(plan, o.a, o.b);
    const out1 = { x: g.p1.x - g.n.x * t, y: g.p1.y - g.n.y * t };
    const out2 = { x: g.p2.x - g.n.x * t, y: g.p2.y - g.n.y * t };
    const color = o.color ? xml(o.color) : '#222';
    if (o.type === 'part') {
      out.push(`<path d="${poly([g.p1, g.p2, out2, out1])}" fill="${o.color ? xml(o.color) : '#f87171'}" fill-opacity=".7"/>`);
      continue;
    }
    out.push(`<path d="${poly([g.p1, g.p2, out2, out1])}" fill="#fff"/>`);
    out.push(`<path d="M${pt(g.p1)}L${pt(out1)}M${pt(g.p2)}L${pt(out2)}" stroke="${color}" stroke-width="1.5"/>`);
    if (o.type === 'window') {
      const f = windowFrame(o, t);
      const at = (k: number) => [g.p1, g.p2].map((p) => ({ x: p.x - g.n.x * k, y: p.y - g.n.y * k }));
      if (!o.niche && f.from > 0) out.push(`<path d="${poly([g.p1, g.p2, ...at(f.from).reverse()])}" fill="#e5e7eb"/>`);
      for (const k of [...(o.niche ? [] : [0]), f.from, f.to, t]) out.push(`<path d="M${pt(at(k)[0])}L${pt(at(k)[1])}" stroke="${color}" stroke-width="1"/>`);
      const glass = at((f.from + f.to) / 2);
      out.push(`<path d="M${pt(glass[0])}L${pt(glass[1])}" stroke="${color}" stroke-width=".5"/>`);
      if (o.niche) out.push(`<path d="M${pt(g.p1)}L${pt(g.p2)}" stroke="${color}" stroke-width="1" stroke-dasharray="3 3"/>`);
      continue;
    }
    if (o.noLeaf) continue;
    const hingeAt = o.hingeAtB ? g.p2 : g.p1;
    const hinge = o.outward ? { x: hingeAt.x - g.n.x * t, y: hingeAt.y - g.n.y * t } : hingeAt;
    const open = o.outward ? { x: -g.n.x, y: -g.n.y } : g.n;
    const closedDir = o.hingeAtB ? { x: -g.u.x, y: -g.u.y } : g.u;
    const leaf = { x: hinge.x + open.x * o.width, y: hinge.y + open.y * o.width };
    const closed = { x: hinge.x + closedDir.x * o.width, y: hinge.y + closedDir.y * o.width };
    const sweep = open.x * closedDir.y - open.y * closedDir.x > 0 ? 1 : 0;
    out.push(`<path d="M${pt(hinge)}L${pt(leaf)}" stroke="${color}" stroke-width="2"/>`);
    out.push(`<path d="M${pt(leaf)}A${cm(o.width)},${cm(o.width)} 0 0 ${sweep} ${pt(closed)}" fill="none" stroke="${color}" stroke-width="1" stroke-dasharray="4 3"/>`);
  }

  // the lines of the walls (their face inside the room), and their lengths
  for (const wall of plan.walls) {
    const a = pointById(plan, wall.a);
    const b = pointById(plan, wall.b);
    if (a && b) out.push(`<path d="M${pt(a)}L${pt(b)}" stroke="#111" stroke-width="1.5"/>`);
  }
  for (const wall of plan.walls) {
    const q = band(plan, wall);
    if (!q) continue;
    const len = dist(q[0], q[1]);
    if (len < 0.4) continue;
    const measured = plan.constraints.some((c) => c.type === 'distance' && constraintIds(c).sort().join() === [wall.a, wall.b].sort().join());
    const n = { x: (q[3].x - q[0].x) / (dist(q[3], q[0]) || 1), y: (q[3].y - q[0].y) / (dist(q[3], q[0]) || 1) };
    const text = `${measured ? '' : '~'}${Math.round(len * 100)} cm`;
    // clear of the band: half the text's width beside an upright wall, half its height beside a level one
    const off = dist(q[3], q[0]) + 0.05 + Math.abs(n.x) * text.length * 0.035 + Math.abs(n.y) * 0.07;
    const at = { x: (q[0].x + q[1].x) / 2 + n.x * off, y: (q[0].y + q[1].y) / 2 + n.y * off };
    out.push(`<text x="${cm(at.x)}" y="${cm(at.y)}" font-size="11"${measured ? ' font-weight="bold"' : ''} fill="${measured ? '#15803d' : '#555'}">${text}</text>`);
  }

  for (const s of plan.stairs) {
    out.push(`<path d="${poly(stairCorners(s))}" fill="none" stroke="#333" stroke-width="1.2"/>`);
    out.push(`<path d="${stairTreads(s).map(([p, q]) => `M${pt(p)}L${pt(q)}`).join('')}" stroke="#333" stroke-width=".8"/>`);
  }

  for (const f of plan.furniture) {
    out.push(
      `<g transform="translate(${cm(f.x)} ${cm(f.y)}) rotate(${num(f.angle)})" fill="#fff" stroke="#555" stroke-width=".8" color="#555">${symbolSvg(furnitureItem(f.kind), f.w, f.d, 100)}</g>`
    );
  }

  // rooms: name and floor area
  for (const loop of rooms(plan)) {
    const name = roomName(plan, loop);
    const spot = plan.names.find((n) => insideLoop(plan, loop, n)) ?? spotInside(plan, loop);
    const area = `${loopArea(plan, loop).toFixed(1)} m²`;
    out.push(
      `<text x="${cm(spot.x)}" y="${cm(spot.y)}" font-size="${name ? 15 : 11}" font-weight="${name ? 'bold' : 'normal'}" fill="#222">${name ? `${xml(name)}<tspan x="${cm(spot.x)}" dy="15" font-size="11" font-weight="normal" fill="#555">${area}</tspan>` : area}</text>`
    );
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<!--${INSTRUCTIONS}-->`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${cm(minX)} ${cm(minY)} ${cm(w)} ${cm(h)}" width="${Math.round(w * 160)}" height="${Math.round(h * 160)}" font-family="system-ui, sans-serif" stroke-linecap="round">`,
    '<style>text { text-anchor: middle; dominant-baseline: middle; }</style>',
    `<title>${plan.name ? xml(plan.name) : 'plan3d floor plan'}</title>`,
    '<desc>Floor plan made with plan3d. The plan data is the JSON in the metadata element; see the comment at the top of the file before editing it.</desc>',
    `<metadata id="${DATA_ID}">`,
    xml(serialize(plan)),
    '</metadata>',
    `<rect x="${cm(minX)}" y="${cm(minY)}" width="${cm(w)}" height="${cm(h)}" fill="#fff"/>`,
    ...out,
    '</svg>',
    '',
  ].join('\n');
}

/** A file name for the plan: its name without characters file systems refuse, or "plan3d". */
export function planFileName(plan: Plan, ext: string): string {
  const base = (plan.name ?? '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '-').trim() || 'plan3d';
  return `${base}.${ext}`;
}

/** The plan name a file name suggests: "Flat 2.svg" gives "Flat 2". */
export const nameFromFile = (file: string): string => file.replace(/\.(svg|json)$/i, '').trim();

/** A plan from an exported file: the SVG's metadata, or a plain JSON file. Throws with what is wrong. */
export function readPlanFile(text: string): Plan {
  let json = text.trim();
  if (!json.startsWith('{')) {
    // not in a comment: the instructions talk about the metadata element too
    const m = text.replace(/<!--[\s\S]*?-->/g, '').match(new RegExp(`<metadata[^>]*id=["']${DATA_ID}["'][^>]*>([\\s\\S]*?)</metadata>`));
    if (!m) throw new Error('no plan data in this file (an SVG needs the <metadata id="plan3d-data"> that plan3d writes)');
    json = m[1].trim();
    // also take a CDATA section, the other way to put JSON in XML
    const cdata = json.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
    json = cdata ? cdata[1] : unxml(json);
  }
  let plan: Plan;
  try {
    plan = parse(json);
  } catch (err) {
    throw new Error(`the plan data is not valid JSON: ${(err as Error).message}`);
  }
  // corners added by hand (or by an AI) may come without where the camera saw them
  for (const p of plan.points) if (!p.sensor) p.sensor = { x: p.x, y: p.y };
  const problems = planProblems(plan);
  if (problems.length) throw new Error(problems.slice(0, 8).join('\n') + (problems.length > 8 ? `\n…and ${problems.length - 8} more` : ''));
  return plan;
}

/** What is broken in a plan: ids used twice, references to things that are not there, numbers that are not numbers. */
export function planProblems(plan: Plan): string[] {
  const out: string[] = [];
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  const ids = new Set<string>();
  for (const p of plan.points) {
    if (ids.has(p.id)) out.push(`corner id "${p.id}" is used twice`);
    ids.add(p.id);
    if (!num(p.x) || !num(p.y) || !num(p.sensor?.x) || !num(p.sensor?.y)) out.push(`corner "${p.id}" has no proper x, y`);
  }
  const has = (id: string) => ids.has(id);
  for (const w of plan.walls) {
    if (!has(w.a) || !has(w.b)) out.push(`wall ${w.a}-${w.b} goes to a corner that does not exist`);
    if (w.thickness !== undefined && !(num(w.thickness) && w.thickness > 0)) out.push(`wall ${w.a}-${w.b} has a bad thickness`);
  }
  for (const c of plan.constraints) {
    if (!['distance', 'rightAngle', 'angle', 'parallel', 'equal'].includes(c.type)) out.push(`unknown constraint type "${c.type}"`);
    else if (!constraintIds(c).every(has)) out.push(`a ${c.type} constraint refers to a corner that does not exist`);
    if ((c.type === 'distance' || c.type === 'angle') && !(num(c.value) && c.value > 0)) out.push(`a ${c.type} constraint has a bad value`);
  }
  const openings = new Set<string>();
  for (const o of plan.openings) {
    if (openings.has(o.id)) out.push(`opening id "${o.id}" is used twice`);
    openings.add(o.id);
    if (!['door', 'window', 'part'].includes(o.type)) out.push(`opening "${o.id}" has unknown type "${o.type}"`);
    if (!plan.walls.some((w) => (w.a === o.a && w.b === o.b) || (w.a === o.b && w.b === o.a))) out.push(`${o.type} "${o.id}" is not on a wall`);
    if (!num(o.at) || !num(o.width) || o.width <= 0) out.push(`${o.type} "${o.id}" has a bad position or width`);
  }
  for (const j of plan.joins) if (!openings.has(j.a) || !openings.has(j.b)) out.push(`a join refers to a door that does not exist`);
  for (const s of plan.stairs) {
    if (![s.x, s.y, s.width, s.length, s.angle, s.steps].every(num)) out.push(`stairs "${s.id}" have a bad number`);
    for (const end of ['bottom', 'top'] as const) if (s[end] !== undefined && s[end] !== 'left' && s[end] !== 'right') out.push(`stairs "${s.id}" have ${end} "${s[end]}", not left or right`);
  }
  for (const n of plan.names) if (typeof n.name !== 'string' || !num(n.x) || !num(n.y)) out.push(`a room name is not {name, x, y}`);
  return out;
}

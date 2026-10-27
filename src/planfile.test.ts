import { describe, expect, it } from 'vitest';
import { addPoint, newId, parse, roomFromCorners, serialize, setDistance } from './model';
import { planToSvg, readPlanFile } from './planfile';
import { joinWallEnds, roomAt, setRoomName } from './rooms';

const sample = () => {
  const plan = roomFromCorners([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 3 }, { x: 0, y: 3 }]);
  const [p0, p1, , p3] = plan.points;
  setDistance(plan, p0.id, p1.id, 2);
  plan.walls[0].color = '#f87171';
  plan.openings.push({ id: newId(), type: 'door', a: p3.id, b: p0.id, at: 2.2, width: 0.6 });
  plan.openings.push({ id: newId(), type: 'window', a: p0.id, b: p1.id, at: 0.5, width: 1 });
  const l = addPoint(plan, { x: 0, y: 1.5 });
  const r = addPoint(plan, { x: 2, y: 1.5 });
  plan.walls.push({ a: l.id, b: r.id });
  joinWallEnds(plan);
  setRoomName(plan, roomAt(plan, { x: 1, y: 0.5 })!, 'Bath & <shower>');
  return plan;
};

describe('the plan as an SVG file', () => {
  it('gives back exactly the same plan', () => {
    const plan = sample();
    const svg = planToSvg(plan);
    expect(svg).toContain('<svg');
    expect(svg).toContain('PREFER ADDING CONSTRAINTS');
    expect(serialize(readPlanFile(svg))).toBe(serialize(plan));
  });

  it('keeps its instructions a proper XML comment', () => {
    const svg = planToSvg(sample());
    const comment = svg.slice(svg.indexOf('<!--') + 4, svg.indexOf('-->'));
    expect(comment).not.toContain('--');
  });

  it('still reads a plain JSON file', () => {
    const plan = sample();
    expect(serialize(readPlanFile(serialize(plan)))).toBe(serialize(plan));
  });

  it('takes JSON an AI wrote in a CDATA section, and corners without sensor', () => {
    const plan = parse(serialize(sample()));
    plan.points.push({ id: 'n1', x: 5, y: 5 } as never);
    const svg = planToSvg(sample()).replace(/<metadata id="plan3d-data">[\s\S]*<\/metadata>/, `<metadata id="plan3d-data"><![CDATA[${serialize(plan)}]]></metadata>`);
    const back = readPlanFile(svg);
    expect(back.points.find((p) => p.id === 'n1')!.sensor).toEqual({ x: 5, y: 5 });
  });

  it('says what is wrong instead of loading a broken plan', () => {
    const plan = sample();
    plan.walls.push({ a: plan.points[0].id, b: 'nope' });
    plan.openings[0].a = 'gone';
    expect(() => readPlanFile(planToSvg(plan))).toThrow(/does not exist[\s\S]*not on a wall/);
    expect(() => readPlanFile('<svg></svg>')).toThrow(/no plan data/);
  });
});

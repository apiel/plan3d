import { Plan, emptyPlan, parse, serialize } from './model';

const STORAGE_KEY = 'plan3d.plan';

export function load(): Plan {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    if (text) return parse(text);
  } catch {
    // unreadable storage or a corrupt save: start empty
  }
  return emptyPlan();
}

export function save(plan: Plan): void {
  try {
    localStorage.setItem(STORAGE_KEY, serialize(plan));
  } catch {
    // storage blocked or full: the plan stays in memory
  }
}
